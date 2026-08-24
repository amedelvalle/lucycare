/**
 * admin-create-seed-doctor — Edge Function (Deno).
 *
 * ADMIN-DOCTOR-SEED-P0. Crea un perfil médico SEMBRADO: publicable para
 * prospección, sin identidad utilizable para el médico. Él la obtiene después
 * por el flujo normal y reclama el perfil con el Claim EXISTENTE.
 *
 * ── POR QUÉ EXISTE ESTA FUNCIÓN ──
 * `public.profiles.id` tiene FK a `auth.users(id)`: un profile sin identidad
 * Auth es imposible. La fila técnica se crea por **Admin API**, que exige una
 * credencial privilegiada, y esa credencial NUNCA puede vivir en el frontend.
 *
 * ── REPARTO DE CREDENCIALES (invariante) ──
 *   • JWT del admin → TODAS las RPCs de negocio. Así `auth.uid()` es válido
 *     y el gate `is_admin()` vive en la base, no acá.
 *   • secret key     → EXCLUSIVAMENTE `auth.admin.createUser` y el
 *     `auth.admin.deleteUser` compensatorio. Nada más.
 *
 * ── SECRETOS ──
 * No se configura ninguno a mano: el runtime alojado preaprovisiona
 * SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS y SUPABASE_SECRET_KEYS.
 *
 * ⚠️ NO se usan las variables legacy SUPABASE_ANON_KEY ni
 * SUPABASE_SERVICE_ROLE_KEY. Este proyecto tiene las **legacy API keys
 * deshabilitadas**: esos JWT preaprovisionados existen, pero el gateway los
 * rechaza con 401. Las credenciales vigentes son las del formato nuevo
 * (`sb_publishable_…` / `sb_secret_…`), que el runtime entrega como
 * diccionarios JSON indexados por nombre. Usamos la entrada `default`.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

/**
 * Lee una credencial del formato nuevo desde el diccionario JSON que
 * preaprovisiona el runtime —`{"default":"sb_secret_…"}`— y devuelve la
 * entrada `default`.
 *
 * FAIL CLOSED: lanza si la variable falta, no parsea, no es un diccionario, no
 * trae `default`, o el valor no tiene el prefijo esperado. Nunca devuelve una
 * credencial dudosa y JAMÁS cae de vuelta a las variables legacy. El mensaje
 * nombra la variable, nunca su valor.
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

/** Origen permitido: dominio productivo y previews de Vercel del proyecto. */
const ALLOWED_ORIGINS = [/^https:\/\/lucycare\.app$/, /^https:\/\/lucycare-[a-z0-9-]+\.vercel\.app$/];

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = !!origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    /*
     * Los CINCO headers que el navegador pide de verdad. Verificado sobre
     * `supabase-js` 2.57.4 instalado, no por suposición:
     *
     *   apikey          → lo INYECTA `fetchWithAuth` (lib/fetch.js) justo antes
     *                     del fetch real, aunque `FunctionsClient` no lo lleve.
     *   authorization   → lo pone el servicio a mano (el gate is_admin() lo usa).
     *                     `fetchWithAuth` NO lo pisa porque ya viene puesto.
     *   content-type    → lo pone supabase-js porque el body es un objeto.
     *   idempotency-key → lo pone el servicio: es la clave de idempotencia.
     *   x-client-info   → lo agrega supabase-js solo (DEFAULT_HEADERS).
     *
     * CORS exige que TODOS los headers pedidos estén cubiertos: con uno solo
     * fuera, el navegador responde 200 al OPTIONS y aun así RECHAZA el
     * preflight, sin llegar a emitir el POST. Así murieron los dos primeros
     * intentos de QA. Antes de tocar esta lista, revisar qué headers adjunta
     * la versión de supabase-js en uso — incluida la capa del `customFetch`.
     */
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, idempotency-key, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Códigos tipados. El mensaje crudo del proveedor NUNCA sale de acá. */
type ErrCode =
  | 'not_authenticated' | 'not_admin' | 'bad_request' | 'payload_mismatch'
  | 'in_progress' | 'previously_failed' | 'duplicate_jvpm' | 'duplicate_phone'
  | 'd1_incomplete' | 'seed_identity_conflict' | 'lease_lost' | 'invalid_phone'
  | 'compensation_failed' | 'internal';

const HTTP: Record<ErrCode, number> = {
  not_authenticated: 401, not_admin: 403, bad_request: 400, payload_mismatch: 409,
  in_progress: 409, previously_failed: 409, duplicate_jvpm: 409, duplicate_phone: 409,
  d1_incomplete: 422, seed_identity_conflict: 409, lease_lost: 409, invalid_phone: 422,
  compensation_failed: 500, internal: 500,
};

/** SQLSTATE de la migración s7_73 → código público. */
function mapPgError(err: { code?: string; message?: string } | null): ErrCode {
  switch (err?.code) {
    case 'P0120': return 'not_admin';
    case 'P0122': return 'payload_mismatch';
    case 'P0123': return 'previously_failed';
    case 'P0124':
    case 'P0125':
    case 'P0126':
    case 'P0127': return 'seed_identity_conflict';
    case 'P0128': return 'duplicate_phone';
    case 'P0129': return 'd1_incomplete';
    case 'P0130':
    case 'P0131': return 'bad_request';
    // El teléfono de claim no es utilizable por Auth. Sin este case caía en
    // `internal`, y un error CORREGIBLE por el usuario se presentaba como un
    // fallo transitorio del sistema.
    case 'P0133': return 'invalid_phone';
    case 'P0132': return 'lease_lost';
    case '23505': return 'duplicate_jvpm'; // doctor_credentials_registry_uniq
    default: return 'internal';
  }
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
  });
}

const fail = (code: ErrCode, origin: string | null, extra: Record<string, unknown> = {}) =>
  json({ ok: false, error: code, ...extra }, HTTP[code], origin);

/**
 * Contrato CERRADO del payload. Cualquier campo que el navegador mande y no
 * esté acá se DESCARTA: no entra al hash ni llega a la RPC.
 */
const ALLOWED_FIELDS = [
  'bio', 'claim_phone', 'clinic_address', 'clinic_name', 'clinic_phone',
  'consultation_fee', 'department_id', 'email', 'experience_years',
  'full_name', 'jvpm', 'municipality_id', 'publish', 'specialty_id',
] as const;

/**
 * Normaliza UNA vez sobre la whitelist: `trim`, vacío → null, `publish` a
 * booleano, correo a minúsculas. Las claves quedan ordenadas.
 *
 * La MISMA representación es la que se hashea y la que se envía a la RPC, así
 * que "mismo hash → datos ejecutados distintos" es imposible: no existen dos
 * entradas con igual hash y distinta ejecución, porque lo que se ejecuta ES lo
 * que se hasheó. La normalización específica de dominio (teléfono SV) la sigue
 * haciendo la RPC, para no duplicar `normalize_phone_sv` en dos lenguajes.
 */
function normalizePayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [...ALLOWED_FIELDS].sort()) {
    const v = raw[k];
    if (k === 'publish') {
      out[k] = v === true || v === 'true';
      continue;
    }
    if (typeof v === 'string') {
      const t = v.trim();
      out[k] = t === '' ? null : k === 'email' ? t.toLowerCase() : t;
    } else {
      out[k] = v ?? null;
    }
  }
  return out;
}

/** Serialización determinista de la representación ya normalizada. */
const canonical = (normalized: Record<string, unknown>): string => JSON.stringify(normalized);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const seedEmail = (operationId: string) => `seed-${operationId}@doctor-seed.invalid`;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return fail('bad_request', origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return fail('not_authenticated', origin);

  const operationId = req.headers.get('Idempotency-Key') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return fail('bad_request', origin, { detail: 'idempotency_key' });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return fail('bad_request', origin, { detail: 'json' });
  }

  /**
   * Credenciales del runtime, formato nuevo. Se resuelven ANTES de construir
   * cliente alguno: si algo no cuadra, la request muere acá y ninguna
   * escritura es posible.
   */
  let publishableKey: string;
  let secretKey: string;
  try {
    publishableKey = runtimeKey('SUPABASE_PUBLISHABLE_KEYS', 'sb_publishable_');
    secretKey = runtimeKey('SUPABASE_SECRET_KEYS', 'sb_secret_');
  } catch {
    return fail('internal', origin, { detail: 'key_config' });
  }

  // Cliente de NEGOCIO: JWT del admin. El gate is_admin() vive en la base.
  const asAdmin = createClient(SUPABASE_URL, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Cliente PRIVILEGIADO: solo Admin API. Jamás lógica médica.
  const asService = createClient(SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Whitelist + normalización ANTES del hash. Lo que se hashea es lo que se ejecuta.
  const normalized = normalizePayload(payload);
  const payloadHash = await sha256Hex(canonical(normalized));
  let seedUserId: string | null = null;
  /**
   * Ownership del intento. Sin él, un worker congelado que despierta después
   * de que otro retomó la operación podría compensarla o marcarla fallida.
   * Si alguna RPC responde `lease_lost`, esta request ABANDONA: no borra el
   * auth.user ni marca nada — el worker nuevo es el responsable.
   */
  let leaseToken: string | null = null;

  /**
   * Marca la operación como fallida SOLO si seguimos siendo dueños del lease.
   *
   * Devuelve `true` **únicamente** si la base persistió `status='failed'`. El
   * cliente usa esa evidencia para decidir si puede estrenar `operation_id`:
   * un código de dominio devuelto sin esta confirmación sería ambiguo, porque
   * la operación podría seguir viva.
   */
  const marcarFallida = async (errorCode: string): Promise<boolean> => {
    if (!leaseToken) return false;
    const { error } = await asAdmin.rpc('admin_seed_operation_mark_failed', {
      p_operation_id: operationId,
      p_error_code: errorCode,
      p_lease_token: leaseToken,
    });
    return !error;
  };

  try {
    // ── 1. Reclamo atómico de la operación ──
    const { data: claim, error: claimErr } = await asAdmin.rpc('admin_claim_seed_operation', {
      p_operation_id: operationId,
      p_payload_hash: payloadHash,
    });
    if (claimErr) return fail(mapPgError(claimErr), origin);

    switch (claim.action) {
      case 'completed':
        // Idempotencia observable: el retry ve exactamente el mismo resultado
        // que la primera respuesta. Se enumeran los campos a mano para que
        // `seed_user_id` —interno— nunca llegue al cliente.
        return json({
          ok: true,
          action: 'completed',
          doctor_id: claim.doctor_id,
          clinic_id: claim.clinic_id,
          slug: claim.slug ?? null,
          is_published: !!claim.is_published,
          claim_ready: !!claim.claim_ready,
        }, 200, origin);
      case 'in_progress':
        return fail('in_progress', origin);
      case 'failed':
        return fail('previously_failed', origin, { error_code: claim.error_code });
      case 'resume':
        seedUserId = claim.seed_user_id ?? null;
        leaseToken = claim.lease_token ?? null;
        break;
      case 'claimed':
        leaseToken = claim.lease_token ?? null;
        break;
      default:
        return fail('internal', origin);
    }

    // ── 2. Identidad técnica: recuperar antes de crear ──
    // Cubre `createUser OK → respuesta perdida → retry`: el email es
    // determinístico, así que el usuario se recupera sin enumerar.
    if (!seedUserId) {
      const { data: found, error: lookErr } = await asAdmin.rpc('admin_lookup_seed_user', {
        p_operation_id: operationId,
      });
      if (lookErr) return fail(mapPgError(lookErr), origin);
      seedUserId = (found as string | null) ?? null;
    }

    if (!seedUserId) {
      const { data: created, error: createErr } = await asService.auth.admin.createUser({
        email: seedEmail(operationId),
        email_confirm: false,
        // sin phone, sin password, y SIN PII real en user_metadata:
        // el nombre profesional vive en `profiles`, escrito por la RPC.
        app_metadata: {
          lucy_seed_doctor: true,
          seed_operation_id: operationId,
          seeded_at: new Date().toISOString(),
        },
        ban_duration: '876000h',
      });

      if (createErr) {
        // Email ya existente ⇒ NO crear otra identidad: recuperar la propia.
        const already = createErr.status === 422 || /already|exists|registered/i.test(createErr.message ?? '');
        if (!already) {
          await marcarFallida('create_user_failed');
          return fail('internal', origin);
        }
        const { data: recovered } = await asAdmin.rpc('admin_lookup_seed_user', {
          p_operation_id: operationId,
        });
        seedUserId = (recovered as string | null) ?? null;
        // Existe el email pero NO cumple las condiciones del seed → FAIL cerrado.
        if (!seedUserId) {
          // Mismo criterio: el código de dominio solo sale si la base lo confirmó.
          const marcadaConflicto = await marcarFallida('seed_identity_conflict');
          return fail(marcadaConflicto ? 'seed_identity_conflict' : 'internal', origin);
        }
      } else {
        seedUserId = created.user.id;
      }
    }

    // ── 3. Persistir la transición (compare-and-set en la base) ──
    const { error: setErr } = await asAdmin.rpc('admin_seed_operation_set_auth_created', {
      p_operation_id: operationId,
      p_seed_user_id: seedUserId,
      p_lease_token: leaseToken,
    });
    // Perder el lease acá NO es un error funcional: otro worker retomó la
    // operación y es el responsable de continuar. Abandonamos sin tocar nada.
    if (setErr) return fail(mapPgError(setErr), origin);

    // ── 4. Transacción de negocio, con el JWT del admin ──
    const { data: result, error: rpcErr } = await asAdmin.rpc('admin_create_seed_doctor', {
      p_operation_id: operationId,
      p_seed_user_id: seedUserId,
      p_payload_hash: payloadHash,
      p_payload: normalized,
      p_lease_token: leaseToken,
    });

    if (rpcErr) {
      const code = mapPgError(rpcErr);
      // ⚠️ Si perdimos el lease NO se compensa: borrar el auth.user destruiría
      // el trabajo del worker que retomó la operación. Se abandona la request.
      if (code === 'lease_lost') return fail('lease_lost', origin);

      // ── ORDEN OBLIGATORIO DE COMPENSACIÓN ──
      // 1) Terminar la operación en la base, CON el lease. `deleteUser` no
      //    conoce el arriendo: si lo ejecutáramos primero y el lease hubiera
      //    rotado mientras tanto, borraríamos el seed que otro worker está
      //    retomando. No hace falta atomicidad DB+GoTrue; hace falta que la
      //    operación quede terminal ANTES del efecto externo destructivo.
      const marcada = await marcarFallida(code);

      // 2) Si la base no confirmó —lease perdido, red, respuesta incierta—,
      //    NO se borra nada. Fail cerrado: conservar un seed huérfano es
      //    preferible a destruir una identidad que pudo ser retomada.
      if (!marcada) return fail('internal', origin);

      // 3) Recién ahora el efecto destructivo. Sin clinic ni doctor (la RPC es
      //    atómica), el borrado es limpio y cascadea el profile por la FK.
      const { error: delErr } = await asService.auth.admin.deleteUser(seedUserId);

      if (delErr) {
        // 4) Quedó un auth.user huérfano. Se ANOTA en la operación —que sigue
        //    en `failed`, sin reabrirse ni cambiar de dueño— para poder
        //    distinguir después "cleanup OK" de "cleanup pendiente". Sin esta
        //    marca, ambos casos serían indistinguibles en la base.
        await asAdmin.rpc('admin_seed_operation_flag_compensation_failed', {
          p_operation_id: operationId,
          p_lease_token: leaseToken,
        });
        // No provoca rotación inmediata de la operation_id.
        return fail('compensation_failed', origin);
      }

      // Borrado OK → el código de dominio, que sí autoriza estrenar clave.
      return fail(code, origin);
    }

    return json({ ok: true, ...result }, 200, origin);
  } catch (_e) {
    // Nunca se propaga el error crudo. `marcarFallida` no hace nada si no
    // tenemos lease, y la RPC rechaza con P0132 si ya lo perdimos: en ninguno
    // de los dos casos se pisa el trabajo de otro worker.
    try {
      await marcarFallida('unexpected');
    } catch { /* la operación queda recuperable por operation_id */ }
    return fail('internal', origin);
  }
});
