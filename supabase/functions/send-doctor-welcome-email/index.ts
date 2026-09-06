/**
 * send-doctor-welcome-email · DOCTOR-WELCOME-EMAIL-P0
 *
 * Envía al médico el correo de bienvenida, disparado A MANO por el owner desde
 * LucyAdmin después de aprobar y publicar el perfil. NO hay trigger, ni outbox,
 * ni pg_net, ni cron: publicar no envía nada.
 *
 * Contrato de entrada: UN solo campo, `affiliation_request_id`. Correo, nombre
 * y slug se resuelven SERVER-SIDE en `admin_welcome_email_claim`. Nada de lo
 * que manda el navegador acaba en el mensaje.
 *
 * Autorización en tres capas:
 *   1. `verify_jwt` POR DEFECTO (true). A diferencia de
 *      `notify-owner-doctor-events`, ésta la invoca un NAVEGADOR con sesión,
 *      así que NO se despliega con --no-verify-jwt.
 *   2. El cliente de negocio lleva el JWT del admin, así que las RPCs corren
 *      como ese usuario.
 *   3. `is_admin()` dentro de cada RPC — el mismo gate que el resto de las
 *      RPCs de afiliación. El borde real de seguridad vive en la base.
 *
 * NO construye cliente privilegiado: este flujo no necesita `service_role` en
 * ningún punto.
 *
 * ⚠️ NO se usan las variables legacy SUPABASE_ANON_KEY ni
 * SUPABASE_SERVICE_ROLE_KEY: este proyecto tiene las legacy API keys
 * DESACTIVADAS y el gateway rechaza con 401. La credencial vigente es
 * SUPABASE_PUBLISHABLE_KEYS, en formato nuevo.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

/** Origen permitido: dominio productivo y previews de Vercel del proyecto. */
const ALLOWED_ORIGINS = [/^https:\/\/lucycare\.app$/, /^https:\/\/lucycare-[a-z0-9-]+\.vercel\.app$/];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function runtimeKey(varName: string, prefix: 'sb_publishable_'): string {
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

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    /*
     * Misma lista que `admin-create-seed-doctor`, y por la misma razón: CORS
     * exige que TODOS los headers pedidos estén cubiertos. Con uno solo fuera,
     * el navegador responde 200 al OPTIONS y aun así RECHAZA el preflight sin
     * llegar a emitir el POST. Antes de recortarla, revisar qué adjunta la
     * versión de supabase-js en uso.
     */
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, idempotency-key, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Códigos tipados. El mensaje crudo del proveedor NUNCA sale de acá. */
type ErrCode =
  | 'not_authenticated' | 'not_admin' | 'bad_request'
  | 'not_sendable' | 'provider_error' | 'internal';

const HTTP: Record<ErrCode, number> = {
  not_authenticated: 401,
  not_admin: 403,
  bad_request: 400,
  not_sendable: 409,
  provider_error: 502,
  internal: 500,
};

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });

const fail = (code: ErrCode, origin: string | null, extra: Record<string, unknown> = {}) =>
  json({ ok: false, error: code, ...extra }, HTTP[code], origin);

/**
 * Reduce el fallo del proveedor a un código corto. Lo que se persiste NUNCA es
 * el cuerpo del error: puede arrastrar direcciones. La RPC además rechaza
 * cualquier cosa fuera de [a-z0-9_]{1,40}.
 */
function providerErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'provider_auth';
  if (status === 422) return 'provider_rejected';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return `provider_http_${status}`;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('bad_request', origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return fail('not_authenticated', origin);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return fail('bad_request', origin, { detail: 'json' });
  }

  // Contrato CERRADO: un único campo. Todo lo demás se descarta.
  const requestId = payload['affiliation_request_id'];
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) {
    return fail('bad_request', origin, { detail: 'affiliation_request_id' });
  }

  let publishableKey: string;
  try {
    publishableKey = runtimeKey('SUPABASE_PUBLISHABLE_KEYS', 'sb_publishable_');
  } catch {
    return fail('internal', origin, { detail: 'key_config' });
  }

  const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
  if (!resendKey) return fail('internal', origin, { detail: 'provider_config' });

  // Cliente de NEGOCIO: JWT del admin. El gate is_admin() vive en la base.
  const asAdmin = createClient(SUPABASE_URL, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Reclamo atómico. Acá se aplican TODOS los gates y se resuelve el
  //       destinatario. Si esto no concede, no se envía nada.
  const { data: claim, error: claimError } = await asAdmin.rpc(
    'admin_welcome_email_claim',
    { p_request_id: requestId },
  );

  if (claimError) {
    // P0160 = el gate is_admin() de la RPC. Cualquier otra cosa es interna.
    if (claimError.code === 'P0160') return fail('not_admin', origin);
    return fail('internal', origin, { detail: 'claim' });
  }
  if (!claim?.ok) {
    // La RPC ya devolvió el estado con su motivo en clave estable.
    return fail('not_sendable', origin, { state: claim?.state ?? null });
  }

  // ── 2. Render. Solo con lo que devolvió la base.
  const { renderWelcomeEmail } = await import('./render.ts');
  const { subject, text } = renderWelcomeEmail({ name: claim.name, slug: claim.slug });

  // ── 3. Envío.
  let ok = false;
  let errorCode = 'unknown_error';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        /*
         * Clave ESTABLE = el id de la solicitud. Nunca se manda más de una
         * bienvenida por afiliación, así que la misma clave siempre. Resend la
         * conserva 24 h: por eso la ventana de reclamo de la base son 23 h.
         * Pasado ese plazo la protección ya no existe y la RPC deja de
         * conceder el reintento.
         */
        'Idempotency-Key': requestId,
      },
      body: JSON.stringify({
        from: 'LucyCare para Médicos <medicos@lucycare.app>',
        to: [claim.email],
        reply_to: 'medicos@lucycare.app',
        subject,
        text,
      }),
    });
    if (res.ok) {
      ok = true;
    } else {
      errorCode = providerErrorCode(res.status);
    }
  } catch {
    // Red caída, DNS, TLS. No se sabe si salió; la ventana de 23 h protege el
    // reintento manual posterior.
    errorCode = 'provider_unreachable';
  }

  // ── 4. Resultado. Se marca SIEMPRE, incluso al fallar: dejar la fila en
  //       'sending' sin marca la haría depender del vencimiento de 10 minutos.
  const { error: markError } = await asAdmin.rpc('admin_welcome_email_mark', {
    p_request_id: requestId,
    p_status: ok ? 'sent' : 'failed',
    p_error_code: ok ? null : errorCode,
  });

  if (markError) {
    // El correo pudo haber salido. Se responde ambiguo A PROPÓSITO: la fila
    // queda en 'sending' y solo se podrá reintentar tras 10 minutos, con la
    // misma Idempotency-Key, que impide el duplicado dentro de las 24 h.
    return fail('internal', origin, { detail: 'mark' });
  }

  if (!ok) return fail('provider_error', origin);
  return json({ ok: true }, 200, origin);
});
