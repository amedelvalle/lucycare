/**
 * notify-owner-doctor-events — Edge Function (Deno).
 *
 * DOCTOR-OWNER-NOTIFICATIONS-P0. Drena la outbox `doctor_owner_notifications`
 * y manda por Resend un aviso al owner por cada evento:
 *   · un médico completó el formulario de afiliación;
 *   · un médico reclamó un perfil.
 *
 * ── QUIÉN LA LLAMA ──
 * Una Database Webhook sobre INSERT en la outbox. Nadie más.
 *
 * ── IGNORA EL PAYLOAD, A PROPÓSITO ──
 * El cuerpo de la petición NI SIQUIERA SE LEE. La webhook es solo una señal de
 * "despierta": la fuente autoritativa es la RPC. Consecuencia buscada — aunque
 * alguien lograra invocar esta función con un cuerpo falsificado, NO puede
 * inyectar un evento inventado; a lo sumo provoca un drenado de una cola
 * vacía. El secreto protege contra abuso de invocación, no contra
 * falsificación de contenido, porque el contenido no viene de fuera.
 *
 * Efecto secundario útil: drenar TODA la cola hace el sistema autorreparable.
 * `pg_net` entrega at-most-once; si un despertar se pierde, el siguiente
 * evento arrastra lo que quedó pendiente.
 *
 * ── AUTENTICACIÓN ──
 * Se despliega SIN verificación de JWT, con la bandera explícita del comando:
 *
 *     supabase functions deploy notify-owner-doctor-events --no-verify-jwt
 *
 * La bandera es por invocación y afecta SOLO a esta función. El proyecto
 * deliberadamente NO tiene `supabase/config.toml`: un archivo de configuración
 * parcial es superficie para `supabase config push`, que podría empujar
 * defaults de la CLI sobre la configuración remota del proyecto (Auth,
 * Turnstile, SMTP). Una bandera en el comando no tiene ese alcance.
 *
 * El control de acceso REAL es `X-Lucycare-Notify-Secret`, comparado en tiempo
 * constante y fail-closed aquí abajo. Que no haya JWT no relaja nada: la
 * llamante es una Database Webhook, no un usuario, y no hay sesión de la que
 * sacar un JWT. La alternativa sería poner una clave de Supabase en la
 * configuración del webhook — una credencial más que rotar y que puede
 * filtrarse, y que no identificaría a nadie.
 *
 * ── SECRETOS ──
 *   DOCTOR_NOTIFICATION_WEBHOOK_SECRET  gate de invocación
 *   RESEND_API_KEY                      key NUEVA, separada de la de Auth SMTP
 *   DOCTOR_NOTIFICATION_EMAIL           destinatario(s), separados por comas
 * `SUPABASE_URL` y `SUPABASE_SECRET_KEYS` los preaprovisiona el runtime.
 *
 * ⚠️ La key de Resend NO puede ser la del SMTP de Auth: si el owner rotara esa,
 * se caería el recovery por email de todos los usuarios.
 *
 * ⚠️ Este proyecto tiene las legacy API keys DESHABILITADAS. Las credenciales
 * vigentes son `sb_publishable_…` / `sb_secret_…`, que el runtime entrega como
 * diccionarios JSON indexados por nombre. Se usa la entrada `default`.
 *
 * Ningún secreto se registra, se refleja en una respuesta ni aparece en un
 * mensaje de error.
 */
import { errorCode, renderEmail, type OutboxItem } from './render.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

/** Remitente. Decisión del owner; debe vivir bajo el dominio verificado. */
const FROM = 'LucyCare <notificaciones@lucycare.app>';

/** Tope por invocación: 4 lotes de 25. Acota el tiempo de una sola llamada. */
const MAX_LOTES = 4;
const TAM_LOTE = 25;

/**
 * Lee una credencial del formato nuevo desde el diccionario JSON que
 * preaprovisiona el runtime —`{"default":"sb_secret_…"}`— y devuelve `default`.
 *
 * FAIL CLOSED: lanza si falta, no parsea, no es diccionario, no trae `default`
 * o el valor no tiene el prefijo esperado. El mensaje nombra la variable,
 * JAMÁS su valor.
 */
function runtimeKey(varName: string, prefix: 'sb_publishable_' | 'sb_secret_'): string {
  const raw = Deno.env.get(varName);
  if (!raw) throw new Error(`${varName}: ausente`);
  let dict: unknown;
  try {
    dict = JSON.parse(raw);
  } catch {
    throw new Error(`${varName}: no parsea como JSON`);
  }
  if (typeof dict !== 'object' || dict === null || Array.isArray(dict)) {
    throw new Error(`${varName}: no es un diccionario`);
  }
  const value = (dict as Record<string, unknown>).default;
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length <= prefix.length) {
    throw new Error(`${varName}: entrada 'default' ausente o con formato inesperado`);
  }
  return value;
}

/** Secreto de texto plano, fail-closed. Nunca devuelve algo vacío o dudoso. */
function requiredSecret(varName: string): string {
  const v = (Deno.env.get(varName) ?? '').trim();
  if (v === '') throw new Error(`${varName}: ausente`);
  return v;
}

/**
 * Comparación en TIEMPO CONSTANTE.
 *
 * Se comparan los digests SHA-256, no las cadenas: además de igualar el coste,
 * fuerza longitud idéntica (32 bytes), con lo que desaparece la fuga por
 * diferencia de longitud que tendría una comparación directa.
 */
async function secretoCoincide(recibido: string, esperado: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(recibido)),
    crypto.subtle.digest('SHA-256', enc.encode(esperado)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let dif = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) dif |= x[i] ^ y[i];
  return dif === 0;
}

/** POST a una RPC de PostgREST con la credencial de servicio. */
async function rpc(nombre: string, cuerpo: unknown, secret: string): Promise<unknown> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });
  const texto = await resp.text();
  if (!resp.ok) throw new Error(`rpc ${nombre}: HTTP ${resp.status}`);
  return texto ? JSON.parse(texto) : null;
}

interface ResultadoEnvio {
  ok: boolean;
  messageId?: string;
  code?: string;
}

/** Un envío por Resend, con la clave de idempotencia derivada del outbox.id. */
async function enviar(item: OutboxItem, destinatarios: string[], apiKey: string): Promise<ResultadoEnvio> {
  const { subject, text, idempotencyKey } = renderEmail(item);
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // Determinística por fila: un reintento tras timeout devuelve el
        // mensaje original en vez de mandar un segundo correo.
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ from: FROM, to: destinatarios, subject, text }),
    });
    const texto = await resp.text();
    if (!resp.ok) return { ok: false, code: errorCode(resp.status, 'resend') };
    let id: string | undefined;
    try {
      id = (JSON.parse(texto) as { id?: string }).id;
    } catch {
      id = undefined;
    }
    return { ok: true, messageId: id };
  } catch {
    // Sin `status`: no llegamos a tener respuesta (red, DNS, timeout).
    return { ok: false, code: errorCode(null, 'network') };
  }
}

Deno.serve(async (req) => {
  // Sin CORS: no hay llamador de navegador. Solo POST.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let secretoWebhook: string;
  let resendKey: string;
  let destinatarios: string[];
  let serviceKey: string;
  try {
    secretoWebhook = requiredSecret('DOCTOR_NOTIFICATION_WEBHOOK_SECRET');
    resendKey = requiredSecret('RESEND_API_KEY');
    destinatarios = requiredSecret('DOCTOR_NOTIFICATION_EMAIL')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (destinatarios.length === 0) throw new Error('DOCTOR_NOTIFICATION_EMAIL: sin destinatarios');
    serviceKey = runtimeKey('SUPABASE_SECRET_KEYS', 'sb_secret_');
  } catch (e) {
    // Config incompleta. El mensaje nombra la variable, nunca su valor.
    console.error('config:', e instanceof Error ? e.message : 'error');
    return new Response(JSON.stringify({ error: 'misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Gate. Respuesta genérica: no se dice qué cabecera faltó ni por qué.
  const recibido = req.headers.get('X-Lucycare-Notify-Secret') ?? '';
  if (!(await secretoCoincide(recibido, secretoWebhook))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // El cuerpo de la webhook NO se lee. Ver la cabecera del archivo.

  let procesados = 0;
  let enviados = 0;
  let fallidos = 0;

  try {
    for (let lote = 0; lote < MAX_LOTES; lote++) {
      const items = (await rpc(
        'notify_owner_claim_batch',
        { p_limit: TAM_LOTE },
        serviceKey,
      )) as OutboxItem[] | null;

      if (!items || items.length === 0) break;

      for (const item of items) {
        procesados++;
        const r = await enviar(item, destinatarios, resendKey);
        if (r.ok) enviados++;
        else fallidos++;
        await rpc(
          'notify_owner_mark_result',
          {
            p_id: item.id,
            p_status: r.ok ? 'sent' : 'failed',
            p_provider_message_id: r.messageId ?? null,
            p_error_code: r.code ?? null,
          },
          serviceKey,
        );
      }

      // Lote incompleto ⇒ no queda nada más por drenar.
      if (items.length < TAM_LOTE) break;
    }
  } catch (e) {
    // Fallo de la RPC o de la propia función. Lo ya enviado queda marcado; lo
    // que se quedó en `sending` lo recupera el próximo drenado pasado el
    // umbral de antigüedad, con la MISMA Idempotency-Key.
    console.error('drain:', e instanceof Error ? e.message : 'error');
    return new Response(
      JSON.stringify({ error: 'drain_failed', processed: procesados, sent: enviados, failed: fallidos }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Resumen sin PII: cuántos, nunca quiénes.
  return new Response(JSON.stringify({ ok: true, processed: procesados, sent: enviados, failed: fallidos }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
