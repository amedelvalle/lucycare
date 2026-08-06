/**
 * _smoke-s7_71a.mjs — AUDIT-SEC-P0 · PR 1: cobertura server-side de appointments.
 *
 * ── MODOS ──────────────────────────────────────────────────────────────
 *
 *   node scripts/_smoke-s7_71a.mjs
 *       Guard. Imprime la ayuda y sale con 0. NO toca la DB.
 *
 *   ASP0_RUN_ID=<id> node scripts/_smoke-s7_71a.mjs --preflight
 *       READ-ONLY. No escribe, no crea, no llama ninguna RPC. Reporta las
 *       identidades sintéticas EXACTAS que usaría --run, hace un inventario
 *       EXHAUSTIVO de Auth, verifica colisiones y emite un MANIFIESTO con su
 *       huella SHA-256:
 *
 *           ASP0_PREFLIGHT_FINGERPRINT=<sha256>
 *
 *   ASP0_RUN_ID=<id> ASP0_SMOKE_AUTHORIZED=1 \
 *   ASP0_PREFLIGHT_FINGERPRINT=<sha256 aprobado> \
 *     node scripts/_smoke-s7_71a.mjs --run
 *       ESCRIBE. Antes de la primera escritura reconstruye el manifiesto,
 *       exige que la huella coincida y repite las comprobaciones read-only
 *       de colisión. Si cambió una identidad, un catálogo o una condición,
 *       ABORTA sin escribir.
 *
 *   …--run --include-sign
 *       Añade el caso de firma de consulta. SOLO local/staging: en
 *       producción esa ruta se prueba con el bloque owner-only
 *       BEGIN/ROLLBACK de docs/OWNER_S7_71A_APPLY.md §13.
 *
 * `ASP0_RUN_ID` fija las identidades de forma determinista. La huella ata
 * --run a un --preflight concreto ya revisado por el owner: el script nunca
 * inventa ni cambia identidades ni catálogos en silencio.
 *
 * ── REGLAS DE DATOS (vinculantes) ──────────────────────────────────────
 *   • Fixtures SINTÉTICAS marcadas `S7_71_FIXTURE`, con TRES teléfonos
 *     FIJOS y consecutivos dentro del espacio `5037000xxxx` que ya usa
 *     LucyCare, elegidos por barrido read-only del rango completo.
 *   • FORBIDDEN_PHONES es una lista CANÓNICA que combina la configuración
 *     vigente de Supabase Test Phone Numbers, CLAUDE.md, el handoff y el
 *     repositorio — el grep por sí solo NO basta. Solo
 *     actúan como GUARDA que aborta: nunca como fixture, destino, fallback
 *     ni argumento de Auth, tabla o RPC. La comparación es NORMALIZADA
 *     (con y sin prefijo 503).
 *   • Usuarios Auth creados y eliminados SIEMPRE por la Admin API. NUNCA
 *     por SQL sobre `auth.users`.
 *   • Todo el bloque de escrituras va en try/finally.
 *   • El borrado de `audit_log` usa ALLOWLIST explícita de los UUID de la
 *     corrida; `created_at` es condición ADICIONAL, nunca suficiente.
 *   • Verificación final de CERO residuos; si queda alguno, exit ≠ 0.
 *
 * ── QUÉ **NO** SE PRUEBA ACÁ (y dónde sí) ──────────────────────────────
 *   · Explotación del agujero de `audit_log`: solo local/staging.
 *   · `db_direct` y contexto rechazado: bloques owner-only §11 y §12.
 *   · Firma de consulta en producción: bloque owner-only §13.
 *   · Cierre de privilegios: es s7_71b.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { requireEnv } from './_lib/env.mjs';

// ═════════════════════════════════════════════════════════════════════
// MODO Y GUARDS
// ═════════════════════════════════════════════════════════════════════
const ARGV = process.argv.slice(2);
const WANT_PREFLIGHT = ARGV.includes('--preflight');
const WANT_RUN = ARGV.includes('--run');
const INCLUDE_SIGN = ARGV.includes('--include-sign');
const AUTHORIZED = process.env.ASP0_SMOKE_AUTHORIZED === '1';
const RUN_ID = (process.env.ASP0_RUN_ID || '').trim();
const EXPECTED_FINGERPRINT = (process.env.ASP0_PREFLIGHT_FINGERPRINT || '').trim();
const ATT_FLAG = (process.env.ASP0_OWNER_AUTH_ATTESTED || '').trim();
const ATT_DATE = (process.env.ASP0_OWNER_AUTH_ATTESTED_DATE || '').trim();
const ATT_RUN_ID = (process.env.ASP0_OWNER_AUTH_ATTESTED_RUN_ID || '').trim();

const HELP = `
_smoke-s7_71a — modos disponibles

  1) PREFLIGHT (read-only, no escribe nada):
       ASP0_RUN_ID=<id> node scripts/_smoke-s7_71a.mjs --preflight

     Emite al final:  ASP0_PREFLIGHT_FINGERPRINT=<sha256>

  2) CORRIDA (escribe; requiere autorización del owner Y la huella):
       ASP0_RUN_ID=<id> ASP0_SMOKE_AUTHORIZED=1 \\
       ASP0_PREFLIGHT_FINGERPRINT=<sha256> \\
         node scripts/_smoke-s7_71a.mjs --run

  <id>: 4-12 caracteres [a-z0-9]. Fija las identidades de forma
        determinista, para que --preflight y --run usen EXACTAMENTE las
        mismas y el owner pueda autorizarlas antes de escribir.

Requisitos: migración s7_71a aplicada · SUPABASE_URL, SUPABASE_ANON_KEY y
SUPABASE_SERVICE_ROLE_KEY en .env.local.

No se tocó la base de datos.
`;

/**
 * Los guards y la lectura de entorno viven DENTRO de `main()`, no en el
 * cuerpo del módulo: así este archivo puede importarse sin efectos
 * secundarios y `check-s7_71a.mjs` prueba la implementación REAL del
 * fingerprint en vez de una copia.
 */
function enforceGuards() {
  if (!WANT_PREFLIGHT && !WANT_RUN) { console.log(HELP); return false; }
  if (WANT_RUN && !AUTHORIZED) {
    console.log(`\n⛔ --run sin ASP0_SMOKE_AUTHORIZED=1. No se tocó la base de datos.\n${HELP}`);
    return false;
  }
  if (!/^[a-z0-9]{4,12}$/.test(RUN_ID)) {
    console.log(`\n⛔ Falta ASP0_RUN_ID válido (4-12 caracteres [a-z0-9]).\n${HELP}`);
    return false;
  }
  if (WANT_RUN && !/^[0-9a-f]{64}$/.test(EXPECTED_FINGERPRINT)) {
    console.log(`
⛔ --run exige ASP0_PREFLIGHT_FINGERPRINT con la huella SHA-256 emitida por
   --preflight y aprobada por el owner. No se tocó la base de datos.
${HELP}`);
    return false;
  }
  return true;
}

let URL = null, ANON = null, SERVICE = null;
let admin = null;
let anonClient = () => { throw new Error('clientes no inicializados'); };

function initClients() {
  URL = requireEnv('SUPABASE_URL');
  ANON = requireEnv('SUPABASE_ANON_KEY');
  SERVICE = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

const MARK = 'S7_71_FIXTURE';
const NIL = '00000000-0000-0000-0000-000000000000';
const RUN_STARTED_AT = new Date().toISOString();

// ═════════════════════════════════════════════════════════════════════
// TELÉFONOS PROHIBIDOS — GUARDA, no dato
// ═════════════════════════════════════════════════════════════════════

/**
 * LISTA CANÓNICA. Ninguno de estos puede llegar a una fixture, destino,
 * fallback ni a una llamada de Auth, tabla o RPC.
 *
 * ⚠️ La lista NO se deriva de un grep del repositorio. El grep es una de
 * cuatro fuentes, y por sí solo es INSUFICIENTE: los Test Phones vigentes
 * de la sección "Test Phone Numbers" de Supabase Auth NO aparecen en el
 * código (comprobado: 50378873634, 50378590126, 50377507479 y 77316374 dan
 * cero coincidencias en CLAUDE.md, docs/, scripts/ y src/).
 *
 * Fuentes combinadas:
 *   1. Configuración vigente de Supabase → Auth → Test Phone Numbers.
 *   2. CLAUDE.md (tabla de Test Phones y prohibiciones vigentes).
 *   3. docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-03.md (handoff canónico).
 *   4. docs/ y scripts/ (teléfonos de QA reservados en fixtures previas).
 *
 * La comparación es NORMALIZADA: se quitan separadores y el prefijo 503, de
 * modo que `77316374`, `+503 7731 6374` y `50377316374` son equivalentes.
 */
/**
 * (A) TEST PHONES ACTIVOS en Supabase → Auth → Test Phone Numbers.
 *
 * Los 11 fueron verificados DIRECTAMENTE por el owner en el panel de
 * Supabase, no inferidos del repositorio: seis de ellos no aparecen en
 * ningún archivo del proyecto. Esta es la lista vigente y exacta.
 *
 * ⚠️ Si se agrega o quita un Test Phone en Supabase, hay que actualizar
 *    esta constante: el código no puede detectarlo por sí solo.
 * ⚠️ El OTP fijo asociado NO se documenta ni se guarda acá.
 */
export const ACTIVE_SUPABASE_TEST_PHONES = [
  '50378627694',   // Dr. Camilo Carrillo — además cuenta demo oficial
  '50378056365',   // admin de plataforma
  '50378873634',
  '50378590126',
  '50375000001',   // paciente test Fase 1
  '50375000099',
  '50378626108',
  '50377507479',
  '50377316374',   // equivalente normalizado de 77316374
  '50376193396',
  '50370007201',
];

/**
 * (B) Datos REALES y cuentas demo. Prohibidos en toda circunstancia.
 * Camilo aparece también en (A): la unión se deduplica por Set normalizado.
 */
export const REAL_OR_DEMO_PHONES = [
  '50372608827',   // Katherine — dato REAL, ni siquiera read-only
  '50378627694',   // Camilo — cuenta demo oficial (duplicado deliberado con A)
];

/**
 * (C) Históricos y reservados: fueron Test Phones, fixtures previas o
 * números de QA citados en docs/. NO son Test Phones activos hoy.
 */
export const HISTORICAL_OR_RESERVED_PHONES = [
  '50370007202',   // sintético de QA del eje de cancelación — NO activo
  '77316374',      // forma sin prefijo de 50377316374 — normaliza al mismo
  '50377003001',
  '50370069901', '50370069902',
  '50399999999',
];

/**
 * (D) Fixtures anteriores: números usados por smokes previos dentro del
 * espacio sintético 5037000xxxx. Barrido read-only del repositorio.
 */
export const PRIOR_FIXTURE_PHONES = [
  '50370000000', '50370000051', '50370000052', '50370000555',
  '50370000702', '50370000746', '50370000747', '50370000757',
  '50370000758', '50370000777', '50370000799', '50370003737',
  '50370005301', '50370005302', '50370005303', '50370005304',
  '50370005353', '50370005454', '50370005551', '50370005552',
  '50370005757', '50370006301', '50370006302', '50370006303',
  '50370006304', '50370006401', '50370006402', '50370006403',
  '50370006405', '50370006497', '50370006498', '50370006499',
  '50370006501', '50370006502', '50370006601', '50370006602',
  '50370007102', '50370007103', '50370007104', '50370007105',
  '50370007199', '50370007203', '50370007204', '50370007205',
  '50370007206', '50370007207', '50370007208', '50370007299',
  '50370007801', '50370007802', '50370009001', '50370009002',
  '50370009101', '50370009102',
];

/** (E) Placeholders de documentación. No deben usarse como fixture. */
export const DOC_PLACEHOLDER_PHONES = [
  '50312345678', '50322601234', '50361234567', '50371234567', '50391234567',
];

/** Unión de las cinco categorías, en crudo (con duplicados intencionales). */
export const FORBIDDEN_PHONES = [
  ...ACTIVE_SUPABASE_TEST_PHONES,
  ...REAL_OR_DEMO_PHONES,
  ...HISTORICAL_OR_RESERVED_PHONES,
  ...PRIOR_FIXTURE_PHONES,
  ...DOC_PLACEHOLDER_PHONES,
];

/** Normaliza a la parte nacional de 8 dígitos: tolera +503, espacios y guiones. */
export const normalizePhone = (p) => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('503') ? d.slice(3) : d;
};

/** Unión NORMALIZADA y deduplicada: es la que gobierna la guarda. */
export const FORBIDDEN_NORMALIZED = new Set(FORBIDDEN_PHONES.map(normalizePhone));

export const assertNotForbidden = (phone, where) => {
  if (FORBIDDEN_NORMALIZED.has(normalizePhone(phone))) {
    throw new Error(
      `ABORTADO: teléfono prohibido en ${where}. Este smoke jamás usa datos reales, ` +
      'la cuenta demo, Test Phones ni teléfonos de QA reservados.'
    );
  }
  return phone;
};

// ═════════════════════════════════════════════════════════════════════
// IDENTIDADES SINTÉTICAS — deterministas a partir de ASP0_RUN_ID
// ═════════════════════════════════════════════════════════════════════

/**
 * TRES NÚMEROS FIJOS, dentro del espacio sintético que ya usa LucyCare
 * (`5037000xxxx`). NO se generan por hash: un hash sobre todo el rango
 * podría caer sobre cualquiera de los 56 números ya ocupados.
 *
 * Elegidos por barrido read-only del rango completo (10 000 posiciones)
 * contra CLAUDE.md, docs/, scripts/, src/ y migrations/, buscando el primer
 * bloque de TRES CONSECUTIVOS libres a partir de 8800 —lejos de todos los
 * clústeres en uso (0xxx, 53xx-57xx, 63xx-66xx, 71xx-72xx, 78xx, 90xx-91xx)—.
 *
 * Verificado: 0 ocurrencias de cada uno en todo el repositorio, y ninguno
 * está en FORBIDDEN_PHONES. El preflight los revalida contra Auth y tablas
 * antes de emitir la huella.
 *
 * ⚠️ Al ser FIJOS, dos corridas simultáneas colisionan. Es deliberado: el
 * preflight lo detecta y falla cerrado, en vez de inventar números nuevos
 * en silencio. `ASP0_RUN_ID` distingue las corridas por correo.
 */
export const SYNTHETIC_PHONES = ['50370008800', '50370008801', '50370008802'];

export const identitiesFor = (runId) => ['patient', 'doctora', 'doctorb'].map((tag, i) => ({
  tag,
  email: `asp0.${tag}.${runId}@lucycare.test`,
  phone: assertNotForbidden(SYNTHETIC_PHONES[i], `identidad ${tag}`),
}));

const IDENTITIES = identitiesFor(RUN_ID);

// ═════════════════════════════════════════════════════════════════════
// ESTADO Y UTILIDADES
// ═════════════════════════════════════════════════════════════════════
let pass = 0, fail = 0;
const ok = (d) => { console.log(`  ✅ ${d}`); pass++; };
const ko = (d) => { console.log(`  ❌ ${d}`); fail++; };
const check = (d, cond) => (cond ? ok(d) : ko(d));

const ids = {
  users: [], clinicId: null, specialtyId: null,
  doctorId: null, doctorId2: null,
  patientId: null, patientId2: null, extraPatients: [],
  serviceIds: [], ruleIds: [], apptIds: [], consultIds: [], eventApptIds: [],
};

const SMOKE_TABLES = [
  'appointments', 'patients', 'profiles', 'clinics', 'clinic_members',
  'doctors', 'services', 'availability_rules', 'consultations',
  'appointment_patient_cancellations',
];

/** ALLOWLIST: conjunto EXACTO de UUID creados por esta corrida. */
const allowlist = () => [
  ...ids.users, ids.clinicId, ids.doctorId, ids.doctorId2,
  ids.patientId, ids.patientId2, ...ids.extraPatients,
  ...ids.serviceIds, ...ids.ruleIds, ...ids.apptIds, ...ids.consultIds,
].filter(Boolean);

async function auditRows(apptId) {
  const { data, error } = await admin
    .from('audit_log')
    .select('id, action, old_data, new_data, user_id, created_at')
    .eq('table_name', 'appointments').eq('record_id', apptId)
    .gte('created_at', RUN_STARTED_AT).order('id', { ascending: true });
  if (error) throw new Error(`audit_log no legible: ${error.message}`);
  return data ?? [];
}
const kindOf = (row) => row?.new_data?.change_kind ?? null;

// ═════════════════════════════════════════════════════════════════════
// INVENTARIO EXHAUSTIVO DE AUTH
// ═════════════════════════════════════════════════════════════════════

/**
 * Páginas PEQUEÑAS a propósito. Con perPage=1000 la primera llamada falló
 * con `Database error finding users` sin devolver nada, y el diagnóstico
 * quedó ciego. Con 50 se acota el radio del fallo: se sabe qué página lo
 * dispara y cuántos usuarios se alcanzaron antes.
 */
const AUTH_PER_PAGE = 50;
const AUTH_MAX_PAGES = 400;   // tope defensivo: 20 000 usuarios

/**
 * Recorre TODA la lista de usuarios de Auth por la Admin API y DEMUESTRA que
 * el recorrido terminó. Falla CERRADO ante cualquier duda.
 *
 * `batch.length < perPage` NO se usa como prueba de finalización: con un
 * `total` múltiplo exacto de `perPage` la última página viene llena y esa
 * heurística cortaría antes de tiempo o no cortaría nunca. La prueba sale de
 * la METADATA real (`total`, `lastPage`, `nextPage`), y si la metadata no
 * está o es inconsistente, el inventario se declara INCOMPLETO.
 *
 * Detecta: límite silencioso de perPage · metadata ausente o inconsistente ·
 * páginas repetidas · ausencia de avance · discrepancia entre el total
 * anunciado y los ids únicos · exceso del tope defensivo.
 *
 * `profiles` y el resto de tablas son comprobaciones ADICIONALES, nunca un
 * sustituto de este inventario. Nunca se consulta `auth.users` por SQL.
 */
async function listAllAuthUsers() {
  const byId = new Map();
  const seenPages = new Set();
  const notes = [];
  let pages = 0, complete = false, reason = null;
  let total = null, lastPage = null, effectivePerPage = null;
  let failedPage = null;
  /** Metadata de la ÚLTIMA página sana. Nunca contiene datos de usuarios. */
  let lastHealthyMeta = null;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PER_PAGE });
    if (error) {
      failedPage = page;
      reason = `listUsers(page=${page}) falló: ${error.message}`;
      break;
    }

    const batch = data?.users ?? [];
    pages++;

    // ── Metadata real de esta respuesta ──
    const mTotal = num(data?.total);
    const mLast = num(data?.lastPage);
    const mNext = num(data?.nextPage);
    // Solo cifras y banderas: nunca emails, teléfonos ni datos de usuario.
    lastHealthyMeta = { page, batch: batch.length, total: mTotal, lastPage: mLast, nextPage: mNext };

    if (mTotal !== null) {
      if (total !== null && total !== mTotal) {
        reason = `el total anunciado cambió entre páginas (${total} → ${mTotal})`;
        break;
      }
      total = mTotal;
    }
    if (mLast !== null) {
      if (lastPage !== null && lastPage !== mLast) {
        reason = `lastPage cambió entre páginas (${lastPage} → ${mLast})`;
        break;
      }
      lastPage = mLast;
    }

    // ── Límite silencioso de perPage ──
    if (page === 1 && batch.length > 0 && batch.length < AUTH_PER_PAGE) {
      const hayMas = (mNext !== null && mNext > 1)
        || (mLast !== null && mLast > 1)
        || (mTotal !== null && mTotal > batch.length);
      if (hayMas) {
        effectivePerPage = batch.length;
        notes.push(`perPage solicitado ${AUTH_PER_PAGE}, servido ${effectivePerPage} (límite silencioso)`);
      }
    }

    // ── Página repetida ──
    const sig = createHash('sha256').update(batch.map((u) => u.id).join(',')).digest('hex');
    if (batch.length > 0 && seenPages.has(sig)) {
      reason = `la página ${page} repite el contenido de una anterior (paginación rota)`;
      break;
    }
    seenPages.add(sig);

    // ── Ausencia de avance: página no vacía sin ids nuevos ──
    const antes = byId.size;
    for (const u of batch) byId.set(u.id, u);
    if (batch.length > 0 && byId.size === antes) {
      reason = `la página ${page} no aportó ningún id nuevo (sin avance)`;
      break;
    }

    // ── ¿Terminó? SOLO se decide con metadata ──
    if (total !== null && byId.size >= total) { complete = true; break; }
    if (lastPage !== null && page >= lastPage) { complete = true; break; }
    if (mNext !== null && mNext === 0) { complete = true; break; }

    // Página vacía: fin del listado, pero solo vale si hay metadata que lo
    // respalde; si no, se marca como no demostrable más abajo.
    if (batch.length === 0) {
      if (total !== null || lastPage !== null) { complete = true; }
      else { reason = 'la lista terminó pero la API no devolvió metadata (total/lastPage/nextPage): no se puede demostrar el final'; }
      break;
    }

    if (page === AUTH_MAX_PAGES) {
      reason = `tope defensivo de ${AUTH_MAX_PAGES} páginas alcanzado sin llegar al final`;
    }
  }

  // ── Validación final: el total anunciado debe cuadrar con los ids únicos ──
  if (complete && total !== null && byId.size !== total) {
    complete = false;
    reason = `discrepancia: la API anunció total=${total} pero se recogieron ${byId.size} ids únicos`;
  }

  // ── Sin metadata alguna no hay demostración posible ──
  if (complete && total === null && lastPage === null) {
    complete = false;
    reason = 'la API no devolvió total, lastPage ni nextPage: el inventario no es demostrablemente completo';
  }

  return {
    users: [...byId.values()], unique: byId.size, pages, complete, reason,
    perPage: AUTH_PER_PAGE, effectivePerPage, total, lastPage, notes,
    failedPage, lastHealthyMeta,
  };
}

/**
 * Diagnóstico estructurado del fallo de inventario. Solo cifras y banderas:
 * NUNCA emails, teléfonos ni ningún dato de usuario.
 */
export function authFailureReport(auth) {
  return [
    `motivo                       : ${auth.reason ?? '(sin motivo registrado)'}`,
    `página exacta que falló      : ${auth.failedPage ?? '(no aplica)'}`,
    `perPage solicitado           : ${auth.perPage}`,
    `perPage efectivo             : ${auth.effectivePerPage ?? auth.perPage}`,
    `páginas sanas recorridas     : ${auth.pages}`,
    `usuarios únicos acumulados   : ${auth.unique}`,
    `metadata última página sana  : ${auth.lastHealthyMeta
      ? `page=${auth.lastHealthyMeta.page} batch=${auth.lastHealthyMeta.batch}`
        + ` total=${auth.lastHealthyMeta.total ?? 'ausente'}`
        + ` lastPage=${auth.lastHealthyMeta.lastPage ?? 'ausente'}`
        + ` nextPage=${auth.lastHealthyMeta.nextPage ?? 'ausente'}`
      : '(ninguna página sana)'}`,
  ];
}

// ═════════════════════════════════════════════════════════════════════
// MANIFIESTO Y HUELLA
// ═════════════════════════════════════════════════════════════════════

/** Hostname del proyecto a partir de SUPABASE_URL. NUNCA la clave. */
const projectHost = () => {
  try { return new globalThis.URL(URL).hostname; } catch { return null; }
};

/**
 * SHA-256 del archivo de la migración: ata la huella a ESE s7_71a.
 *
 * DETERMINISMO: se hashea el contenido NORMALIZADO A LF, no el binario
 * exacto. En Windows el checkout de git deja CRLF y en Linux LF; hashear el
 * binario daría huellas distintas para el mismo archivo según la máquina, y
 * el owner (que corre --preflight) y el dev podrían estar en sistemas
 * distintos. La misma función se usa en --preflight y en --run.
 */
export const MIGRATION_PATH = 'migrations/s7_71a_audit_appointments_coverage.sql';

/** Checksum determinista de un archivo, normalizado a LF. */
export const fileSha256 = (path) => {
  try {
    const lf = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    return createHash('sha256').update(lf, 'utf8').digest('hex');
  } catch (e) {
    throw new Error(`no se pudo leer ${path} para la huella: ${e.message}`);
  }
};

export const migrationSha256 = (path = MIGRATION_PATH) => fileSha256(path);

/**
 * Checksum de ESTE archivo. El manifiesto protegía la migración pero no el
 * código del smoke: una corrección de flujo podía cambiar el comportamiento
 * sin mover la huella. Con esto, cualquier edición del smoke la invalida.
 *
 * La ruta sale de `import.meta.url`, no de un literal relativo: así no
 * depende del directorio desde el que se invoque.
 */
export const SMOKE_PATH = fileURLToPath(import.meta.url);
export const smokeSha256 = (path = SMOKE_PATH) => fileSha256(path);

/**
 * Serialización CANÓNICA: ordena recursivamente las claves de todo objeto
 * anidado y conserva el orden de los arrays.
 *
 * ⚠️ NO usar `JSON.stringify(obj, Object.keys(obj).sort())`: el replacer en
 * forma de array filtra por nombre en TODOS los niveles, así que las claves
 * de un objeto anidado que no coincidan con las de primer nivel se
 * DESCARTAN silenciosamente del resultado. Con un manifiesto anidado eso
 * dejaba los ids de estado fuera del hash.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Manifiesto read-only de todo lo que determina la corrida: entorno,
 * versión de la migración, identidades y los IDs de catálogo.
 *
 * NUNCA incluye SUPABASE_SERVICE_ROLE_KEY, la anon key ni ningún token: solo
 * el hostname del proyecto e identificadores públicos de catálogo.
 */
async function buildManifest(authState = {}) {
  const { data: spec, error: eSpec } = await admin
    .from('specialties').select('id').order('id').limit(1).maybeSingle();
  if (eSpec) throw new Error(`manifiesto/specialties: ${eSpec.message}`);

  const { data: sts, error: eSts } = await admin
    .from('appointment_statuses').select('id, name').order('name');
  if (eSts) throw new Error(`manifiesto/appointment_statuses: ${eSts.message}`);

  const { data: reason, error: eR } = await admin
    .from('cancel_reasons').select('id').order('id').limit(1).maybeSingle();
  if (eR) throw new Error(`manifiesto/cancel_reasons: ${eR.message}`);

  const statusOf = (n) => (sts ?? []).find((s) => s.name === n)?.id ?? null;

  return flatManifest({
    projectHost: projectHost(),
    migrationSha: migrationSha256(),
    smokeSha: smokeSha256(),
    runId: RUN_ID,
    identities: IDENTITIES,
    specialtyId: spec?.id ?? null,
    programadaId: statusOf('programada'),
    confirmadaId: statusOf('confirmada'),
    canceladaId: statusOf('cancelada'),
    cancelReasonId: reason?.id ?? null,
    ...authState,
  });
}

/**
 * Manifiesto COMPLETAMENTE PLANO. Sin objetos anidados: cada dato que
 * gobierna la corrida es una clave de primer nivel, así que ninguna puede
 * quedar fuera del hash por accidente.
 *
 * NUNCA incluye SUPABASE_SERVICE_ROLE_KEY, la anon key ni ningún token.
 */
export function flatManifest({
  projectHost: host, migrationSha, smokeSha, runId, identities,
  specialtyId, programadaId, confirmadaId, canceladaId, cancelReasonId,
  // Estado del inventario de Auth y de la atestación. Forman parte del
  // fingerprint: si el modo de verificación cambia, la huella cambia.
  authInventoryComplete = null, authVerificationMode = null,
  authUsersInspected = null, authTotalAnnounced = null, authFailedPage = null,
  ownerAttestedNoCollisions = null, ownerAttestedDate = null,
  ownerAttestedIdentitiesSha256 = null,
}) {
  const m = {
    v: 5,
    project_host: host,
    migration_version: 's7_71a',
    migration_sha256: migrationSha,
    smoke_sha256: smokeSha,
    run_id: runId,
    specialty_id: specialtyId,
    programada_status_id: programadaId,
    confirmada_status_id: confirmadaId,
    cancelada_status_id: canceladaId,
    cancel_reason_id: cancelReasonId,
    auth_inventory_complete: authInventoryComplete,
    auth_verification_mode: authVerificationMode,
    auth_users_inspected: authUsersInspected,
    auth_total_announced: authTotalAnnounced,
    auth_failed_page: authFailedPage,
    owner_attested_no_collisions: ownerAttestedNoCollisions,
    owner_attested_date: ownerAttestedDate,
    owner_attested_identities_sha256: ownerAttestedIdentitiesSha256,
  };
  identities.forEach((id, i) => {
    m[`email_${i}`] = id.email;
    m[`phone_${i}`] = id.phone;
  });
  return m;
}

/** SHA-256 sobre la serialización canónica del manifiesto. */
export function fingerprintOf(manifest) {
  return createHash('sha256').update(stableStringify(manifest), 'utf8').digest('hex');
}

/**
 * Validación de catálogos sobre el manifiesto PLANO.
 *
 * Función PURA y exportada a propósito: es exactamente la lógica que usa
 * `preflight()`, y `check-s7_71a.mjs` la ejercita con manifiestos de ejemplo.
 * Así, si alguien vuelve a leer una clave que no existe —como el
 * `manifest.appointment_statuses` que quedó tras aplanar el manifiesto—, el
 * check falla ANTES de producción en vez de reventar en la corrida.
 *
 * Devuelve pares [descripción, ok]. Nunca lanza: una clave ausente es un
 * `false`, no un TypeError.
 */
export function catalogChecks(manifest) {
  const m = manifest ?? {};
  return [
    ['hay especialidad', !!m.specialty_id],
    ["estado 'programada' existe", !!m.programada_status_id],
    ["estado 'confirmada' existe", !!m.confirmada_status_id],
    ["estado 'cancelada' existe", !!m.cancelada_status_id],
    ['cancel_reasons tiene al menos un motivo', !!m.cancel_reason_id],
  ];
}

// ═════════════════════════════════════════════════════════════════════
// ATESTACIÓN MANUAL DEL OWNER — excepción acotada al fail-closed
// ═════════════════════════════════════════════════════════════════════

/**
 * El comportamiento por DEFECTO sigue siendo fail-closed: si el inventario
 * de Auth no es demostrablemente completo, el preflight aborta.
 *
 * Esta excepción existe porque `auth.admin.listUsers` falla en `page=3` con
 * `perPage=50` en este proyecto, y sin ese tramo no se puede DEMOSTRAR por
 * API que las identidades candidatas estén libres. El owner verificó a mano
 * en Authentication → Users la ausencia exacta de las seis, y esa
 * atestación se registra como evidencia explícita y trazable.
 *
 * NO relaja nada más: la búsqueda de colisiones sobre los usuarios que SÍ se
 * recuperaron, las lecturas de tablas, los catálogos y la validación de
 * checksum/proyecto/identidades siguen corriendo, y cualquier colisión
 * aborta aunque haya atestación.
 *
 * La atestación está ATADA a un conjunto exacto de identidades: el hash
 * canónico se recalcula en cada corrida y debe coincidir. Cambiar un correo,
 * un teléfono o el RUN_ID la invalida.
 */
export const OWNER_ATTESTATION = {
  run_id: 's771a0805a',
  date: '2026-08-06',
  // sha256 de stableStringify({emails:[...minúsculas], phones:[...normalizados]})
  identities_sha256: '1d597f006b4ffc971c402a21b2f95c1d46356e439926728cd6c5d7a150f1ed1f',
};

/** Hash canónico del conjunto EXACTO de identidades (orden significativo). */
export function identitiesFingerprint(identities) {
  return createHash('sha256').update(stableStringify({
    emails: identities.map((i) => i.email.toLowerCase()),
    phones: identities.map((i) => normalizePhone(i.phone)),
  }), 'utf8').digest('hex');
}

/**
 * Evalúa la atestación. Devuelve `{ valid, sha, reasons }`. Exige las TRES
 * variables simultáneamente, con valores exactos, y que el hash de las
 * identidades vigentes coincida con el atestado.
 */
export function evaluateAttestation({ attested, date, attestedRunId, runId, identities }) {
  const sha = identitiesFingerprint(identities);
  const reasons = [];
  if (attested !== '1') reasons.push('falta ASP0_OWNER_AUTH_ATTESTED=1');
  if (date !== OWNER_ATTESTATION.date) {
    reasons.push(`ASP0_OWNER_AUTH_ATTESTED_DATE debe ser ${OWNER_ATTESTATION.date}`);
  }
  if (attestedRunId !== OWNER_ATTESTATION.run_id) {
    reasons.push(`ASP0_OWNER_AUTH_ATTESTED_RUN_ID debe ser ${OWNER_ATTESTATION.run_id}`);
  }
  if (attestedRunId !== runId) {
    reasons.push('la atestación es de otro RUN_ID: no puede reutilizarse');
  }
  if (sha !== OWNER_ATTESTATION.identities_sha256) {
    reasons.push('las identidades NO son las atestadas por el owner (hash distinto)');
  }
  return { valid: reasons.length === 0, sha, reasons };
}

/**
 * Decide si se puede continuar tras el inventario de Auth, y con qué modo.
 * PURA y exportada: es la lógica exacta que usan `preflight()` y `--run`, y
 * `check-s7_71a.mjs` la ejercita con entradas sintéticas (casos A–E).
 */
export function resolveAuthState({ auth, attestation }) {
  const comun = {
    authUsersInspected: auth.unique ?? null,
    authTotalAnnounced: auth.total ?? null,
  };
  if (auth.complete) {
    return {
      proceed: true, mode: 'listusers_exhaustive', reasons: [],
      authState: {
        ...comun,
        authInventoryComplete: true,
        authVerificationMode: 'listusers_exhaustive',
        authFailedPage: null,
        ownerAttestedNoCollisions: null,
        ownerAttestedDate: null,
        ownerAttestedIdentitiesSha256: null,
      },
    };
  }
  if (!attestation?.valid) {
    return { proceed: false, mode: null, reasons: attestation?.reasons ?? ['sin atestación'], authState: null };
  }
  return {
    proceed: true, mode: 'owner_manual_exact_search', reasons: [],
    authState: {
      ...comun,
      authInventoryComplete: false,
      authVerificationMode: 'owner_manual_exact_search',
      authFailedPage: auth.failedPage ?? null,
      ownerAttestedNoCollisions: true,
      ownerAttestedDate: OWNER_ATTESTATION.date,
      ownerAttestedIdentitiesSha256: attestation.sha,
    },
  };
}

/**
 * Veredicto final del preflight. PURA y exportada.
 * Una colisión —en Auth o en tablas— o un catálogo faltante BLOQUEAN la
 * emisión de la huella AUNQUE la atestación sea válida.
 */
/**
 * Veredicto de colisiones. PURA y exportada.
 *
 * Separa EXPLÍCITAMENTE las tres condiciones. No existe ningún bypass del
 * tipo `allowIncomplete || auth.complete`: un inventario incompleto solo es
 * aceptable si la atestación del owner es VÁLIDA, y aun así una colisión
 * real —en Auth o en tablas— hace `ok = false`.
 *
 * `ownerAttestationValid` es un parámetro para poder probar esta función en
 * aislamiento, pero en producción SOLO puede venir de `evaluateAttestation`,
 * que exige las tres variables de entorno y el hash de las seis identidades.
 * `verifyNoCollisions` lo deriva internamente: no lo acepta de su llamador.
 */
export function collisionVerdict({ authComplete, ownerAttestationValid, authHits, tableHits }) {
  const auth_inventory_acceptable = authComplete === true || ownerAttestationValid === true;
  const no_auth_collisions = authHits === 0;
  const no_table_collisions = tableHits === 0;
  return {
    ok: auth_inventory_acceptable && no_auth_collisions && no_table_collisions,
    auth_inventory_acceptable, no_auth_collisions, no_table_collisions,
  };
}

export function preflightVerdict({ authProceed, noCollisions, catalogsOk }) {
  const blockers = [];
  if (!authProceed) blockers.push('inventario de Auth incompleto sin atestación válida');
  if (!noCollisions) blockers.push('colisión detectada');
  if (!catalogsOk) blockers.push('catálogo requerido faltante');
  return { emitFingerprint: blockers.length === 0, exitCode: blockers.length === 0 ? 0 : 1, blockers };
}

/** HEAD del repositorio, para el encabezado del preflight. Solo lectura. */
function repoHead() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return '(no disponible)'; }
}

/**
 * Comprobaciones de colisión, read-only. Las ejecuta --preflight y las
 * REPITE --run antes de la primera escritura.
 */
async function verifyNoCollisions({ verbose, auth: authPrevio }) {
  const emails = IDENTITIES.map((i) => i.email);
  const phones = IDENTITIES.map((i) => i.phone);
  const emailSet = new Set(emails.map((e) => e.toLowerCase()));
  const phoneSet = new Set(phones.map(normalizePhone));

  // ── Auth: inventario EXHAUSTIVO (se reutiliza si ya se hizo) ──
  const auth = authPrevio ?? await listAllAuthUsers();
  if (verbose && !authPrevio) {
    console.log(`   páginas recorridas: ${auth.pages} · perPage solicitado: ${auth.perPage}`
      + (auth.effectivePerPage ? ` · servido: ${auth.effectivePerPage}` : ''));
    console.log(`   metadata → total: ${auth.total ?? 'ausente'} · lastPage: ${auth.lastPage ?? 'ausente'}`);
    console.log(`   ids únicos recogidos: ${auth.unique}`);
  }
  // La aceptabilidad del inventario se DERIVA acá, nunca se recibe: el
  // llamador no puede inyectar un booleano libre.
  const ownerAttestationValid = evaluateAttestation({
    attested: ATT_FLAG, date: ATT_DATE, attestedRunId: ATT_RUN_ID,
    runId: RUN_ID, identities: IDENTITIES,
  }).valid;

  const authHits = [];
  for (const u of auth.users) {
    if (u.email && emailSet.has(u.email.toLowerCase())) authHits.push(`email ${u.email}`);
    if (u.phone && phoneSet.has(normalizePhone(u.phone))) authHits.push(`phone ${u.phone}`);
  }
  check(`sin colisiones exactas en Auth (${authHits.length})`, authHits.length === 0);
  authHits.forEach((h) => console.log(`      ⚠️  ${h}`));

  // ── Tablas de negocio: comprobación ADICIONAL, no sustituto ──
  const like = `${MARK}%`;
  const probes = [
    ['profiles · email', admin.from('profiles').select('id', { count: 'exact', head: true }).in('email', emails)],
    ['profiles · phone', admin.from('profiles').select('id', { count: 'exact', head: true }).in('phone', phones)],
    ['patients · marca', admin.from('patients').select('id', { count: 'exact', head: true }).like('full_name', like)],
    ['clinics · marca',  admin.from('clinics').select('id', { count: 'exact', head: true }).like('name', like)],
    ['services · marca', admin.from('services').select('id', { count: 'exact', head: true }).like('name', like)],
  ];
  let tableHits = 0;
  for (const [label, q] of probes) {
    const { count, error } = await q;
    if (error) {
      // Una sonda no consultable cuenta como colisión potencial: no se puede
      // afirmar que esté libre.
      ko(`${label}: no consultable (${error.message})`);
      tableHits += 1;
    } else {
      const n = count ?? 0;
      check(`${label}: 0 filas previas (${n})`, n === 0);
      tableHits += n;
    }
  }

  // ── Decisión EXPLÍCITA, sin bypass ──
  const v = collisionVerdict({
    authComplete: auth.complete,
    ownerAttestationValid,
    authHits: authHits.length,
    tableHits,
  });
  if (verbose || !v.ok) {
    console.log(`   veredicto de colisiones:`
      + ` inventario_aceptable=${v.auth_inventory_acceptable}`
      + ` · sin_colisiones_auth=${v.no_auth_collisions}`
      + ` · sin_colisiones_tablas=${v.no_table_collisions}`);
  }
  return v.ok;
}

// ═════════════════════════════════════════════════════════════════════
// PREFLIGHT — READ-ONLY
// ═════════════════════════════════════════════════════════════════════
async function preflight() {
  console.log('\n_smoke-s7_71a — PREFLIGHT (read-only, no escribe nada)\n');

  // ── 0. Metadatos seguros, ANTES de tocar Auth ──
  //    Se imprimen primero para que sigan disponibles aunque el inventario
  //    falle. Solo el hostname: nunca la URL completa ni ninguna clave.
  console.log('0. Metadatos de la corrida');
  console.log(`   project_host      : ${projectHost() ?? '(no derivable)'}`);
  console.log(`   migration_version : s7_71a`);
  console.log(`   migration_sha256  : ${migrationSha256()}`);
  console.log(`   HEAD              : ${repoHead()}`);
  console.log(`   ASP0_RUN_ID       : ${RUN_ID}`);
  console.log(`   marca             : ${MARK}`);
  console.log('   candidatos:');
  for (const id of IDENTITIES) {
    console.log(`     ${id.tag.padEnd(8)} ${id.email}   ${id.phone}`);
  }

  // ── 1. Identidades propuestas ──
  console.log('1. Identidades sintéticas propuestas (las mismas que usará --run)');
  for (const id of IDENTITIES) {
    console.log(`   · ${id.tag.padEnd(8)} email=${id.email}   phone=${id.phone}`);
  }
  console.log(`   · prefijo de nombres: "${MARK} …"`);
  console.log('   · los tres teléfonos son FIJOS y consecutivos, dentro del espacio');
  console.log('     sintético 5037000xxxx que ya usa LucyCare. No se generan por hash.');
  console.log('   · 0 ocurrencias de cada uno en CLAUDE.md, docs/, scripts/, src/ y migrations/.');
  console.log('   · los UUID los asigna la DB al crear; no son predecibles.');
  console.log('   ⚠️  requieren AUTORIZACIÓN del owner antes de --run.');

  // ── 2. Lista canónica, por categorías ──
  console.log('\n2. Teléfonos prohibidos — categorías');
  console.log('   Fuentes: Supabase → Auth → Test Phone Numbers (verificado por el');
  console.log('   owner) · CLAUDE.md · handoff canónico · docs/ y scripts/.');
  console.log('   El grep del repo NO basta: 6 de los activos no están en el código.');

  const cat = (nombre, lista) => {
    console.log(`\n   ${nombre}: ${lista.length}`);
    for (let i = 0; i < lista.length; i += 6) {
      console.log(`     ${lista.slice(i, i + 6).join('  ')}`);
    }
  };
  cat('ACTIVE_SUPABASE_TEST_PHONES', ACTIVE_SUPABASE_TEST_PHONES);
  cat('HISTORICAL_OR_RESERVED_PHONES', HISTORICAL_OR_RESERVED_PHONES);
  cat('REAL_OR_DEMO_PHONES', REAL_OR_DEMO_PHONES);
  cat('PRIOR_FIXTURE_PHONES', PRIOR_FIXTURE_PHONES);
  cat('DOC_PLACEHOLDER_PHONES', DOC_PLACEHOLDER_PHONES);
  console.log(`\n   TOTAL crudo: ${FORBIDDEN_PHONES.length}`
    + ` · TOTAL normalizado único (FORBIDDEN_NORMALIZED): ${FORBIDDEN_NORMALIZED.size}`);
  console.log(`   deduplicadas por normalización: ${FORBIDDEN_PHONES.length - FORBIDDEN_NORMALIZED.size}`
    + ' (Camilo, activo y demo · alias sin prefijo 503)\n');

  check(`ACTIVE_SUPABASE_TEST_PHONES son exactamente 11 (${ACTIVE_SUPABASE_TEST_PHONES.length})`,
    ACTIVE_SUPABASE_TEST_PHONES.length === 11);
  for (const id of IDENTITIES) {
    check(`${id.tag}: no colisiona con ningún prohibido (normalizado)`,
      !FORBIDDEN_NORMALIZED.has(normalizePhone(id.phone)));
    check(`${id.tag}: correo en dominio de prueba`, id.email.endsWith('@lucycare.test'));
  }
  check('Katherine está en la lista', FORBIDDEN_NORMALIZED.has(normalizePhone('50372608827')));
  check('Camilo (demo) está en la lista', FORBIDDEN_NORMALIZED.has(normalizePhone('50378627694')));
  check('los Test Phones documentados están en la lista',
    ['50378056365', '50375000001'].every((p) => FORBIDDEN_NORMALIZED.has(normalizePhone(p))));
  check('los sintéticos 50370007201/2 están en la lista',
    ['50370007201', '50370007202'].every((p) => FORBIDDEN_NORMALIZED.has(normalizePhone(p))));
  check('los Test Phones que NO están en el repo también están en la lista',
    ['50378873634', '50378590126', '50377507479', '77316374']
      .every((p) => FORBIDDEN_NORMALIZED.has(normalizePhone(p))));
  check('77316374 y 50377316374 son equivalentes tras normalizar',
    normalizePhone('77316374') === normalizePhone('50377316374')
    && FORBIDDEN_NORMALIZED.has(normalizePhone('50377316374')), true);
  check('la comparación tolera el formato sin 503',
    FORBIDDEN_NORMALIZED.has(normalizePhone('78627694')));

  // ── 3. Inventario de Auth — PUERTA DE ENTRADA ──
  //    Si no es demostrablemente completo, se corta ACÁ: no se leen
  //    catálogos, no se construye manifiesto, no se calcula huella y no se
  //    toca ninguna propiedad posterior. `profiles` NO es sustituto.
  console.log('\n3. Inventario de Auth');
  const auth = await listAllAuthUsers();
  console.log(`   páginas recorridas: ${auth.pages} · perPage solicitado: ${auth.perPage}`
    + (auth.effectivePerPage ? ` · servido: ${auth.effectivePerPage}` : ''));
  console.log(`   metadata → total: ${auth.total ?? 'ausente'} · lastPage: ${auth.lastPage ?? 'ausente'}`);
  console.log(`   ids únicos recogidos: ${auth.unique}`);
  auth.notes.forEach((n) => console.log(`   ⚠️  ${n}`));

  const attestation = evaluateAttestation({
    attested: ATT_FLAG, date: ATT_DATE, attestedRunId: ATT_RUN_ID,
    runId: RUN_ID, identities: IDENTITIES,
  });
  const authRes = resolveAuthState({ auth, attestation });
  const authState = authRes.authState;

  if (!auth.complete) {
    // NO se contabiliza como fallo acá: el desenlace lo decide la atestación.
    // Sin atestación válida se sale con exit 1 (fail-closed); con atestación
    // válida el hecho queda registrado en el manifiesto —y por tanto en la
    // huella— como auth_inventory_complete = false.
    console.log('\n   ⛔ inventario de Auth INCOMPLETO');
    console.log('   DIAGNÓSTICO DEL FALLO (solo cifras, sin datos de usuario):');
    authFailureReport(auth).forEach((l) => console.log(`      ${l}`));

    // ── Excepción: atestación manual del owner ──
    const att = attestation;

    if (!authRes.proceed) {
      console.log([
        '',
        '   La Admin API no permitió DEMOSTRAR que el inventario está completo,',
        '   y NO hay atestación manual válida del owner:',
        ...att.reasons.map((r) => `      · ${r}`),
        '',
        '   FALLA CERRADO: no se leen catálogos, no se construye manifiesto, no',
        '   se calcula huella y --run queda bloqueado.',
        '   La tabla profiles NO se usa como sustituto de Auth.',
        '',
      ].join('\n'));
      console.log(`❌ preflight: ${pass} OK, ${fail} fallos — ABORTADO en el inventario de Auth\n`);
      process.exit(1);
    }

    console.log([
      '',
      '   ⚠️  EXCEPCIÓN: atestación manual del owner ACEPTADA.',
      `      fecha de atestación          : ${OWNER_ATTESTATION.date}`,
      `      RUN_ID atestado              : ${OWNER_ATTESTATION.run_id}`,
      `      sha256 de las 6 identidades  : ${att.sha}`,
      '      alcance: EXCLUSIVAMENTE esas 3 direcciones y 3 teléfonos.',
      '',
      '      El inventario de Auth SIGUE marcado como INCOMPLETO. La',
      '      atestación no lo sustituye: registra que el owner verificó a mano',
      '      en Authentication → Users la ausencia exacta de las seis.',
      '      Todo lo demás se sigue comprobando, y cualquier colisión aborta.',
      '',
    ].join('\n'));

    ok('atestación manual del owner válida y atada a estas identidades');
  } else {
    ok(`inventario de Auth COMPLETO (${auth.unique} usuarios únicos)`);
  }

  // ── 4. Colisiones ──
  //    Se ejecutan SIEMPRE, haya atestación o no: sobre los usuarios que sí
  //    se recuperaron y sobre las tablas de negocio. Cualquier colisión
  //    aborta, aunque la atestación sea válida.
  console.log('\n4. Colisiones');
  console.log(`   (búsqueda sobre los ${auth.unique} usuarios recuperados por listUsers`
    + `${auth.complete ? '' : ', inventario incompleto'})`);
  const sinColisiones = await verifyNoCollisions({ verbose: true, auth });
  console.log('   ℹ️  profiles y el resto de tablas son comprobaciones ADICIONALES:');
  console.log('       no sustituyen el inventario de Auth, que debe estar COMPLETO.');

  for (const t of ['doctors', 'clinic_members', 'appointments', 'booking_intents', 'auth_creation_grants']) {
    const { error } = await admin.from(t).select('*', { count: 'exact', head: true }).limit(1);
    check(`${t}: legible para la verificación de residuos`, !error);
    if (error) console.log(`      ⚠️  ${error.message}`);
  }

  // ── 5. Catálogos — sobre el manifiesto PLANO ──
  console.log('\n5. Catálogos requeridos');
  const manifest = await buildManifest(authState);
  const catRes = catalogChecks(manifest);
  for (const [desc, okCat] of catRes) check(desc, okCat);
  const catalogsOk = catRes.every(([, c]) => c === true);
  if (!manifest.cancel_reason_id) {
    console.log('      ⚠️  sin motivos: el caso 5.6/5.7 fallaría en --run.');
  }

  // ── 5. Contrato de las RPC de booking ──
  console.log('\n5. Contrato de las RPC de booking');
  console.log(`
   ⚠️  CONTRATO ESPERADO SEGÚN CÓDIGO, TODAVÍA NO VALIDADO MEDIANTE
       EJECUCIÓN. No se llama a ninguna RPC: el preflight es read-only.

   register_booking_intent(p_doctor_id uuid, p_service_id uuid,
                           p_start_local timestamp, p_phone text) → jsonb
       clave de id esperada: intent_id | id | booking_intent_id
   create_booking_with_intent(p_intent_id uuid, p_patient_name text,
                              p_notes text) → jsonb
       clave de cita esperada: appointment_id | id

   --run falla de inmediato e imprime las claves reales si el contrato no
   coincide; nunca continúa en silencio.`);

  // ── 6. Migración ──
  console.log('\n6. Migración s7_71a aplicada');
  console.log(`
   No se comprueba desde acá: verificar trigger, SECURITY DEFINER,
   search_path y REVOKE de EXECUTE con las consultas read-only de
   docs/OWNER_S7_71A_APPLY.md §4. Este preflight no ejecuta ninguna RPC,
   ni siquiera para sondear: una llamada es una llamada.`);

  // ── 7. Manifiesto y huella ──
  const fp = fingerprintOf(manifest);
  console.log('\n7. Manifiesto de la corrida (sin claves ni secretos)');
  console.log(JSON.stringify(manifest, null, 2).split('\n').map((l) => `   ${l}`).join('\n'));

  // Veredicto por la función PURA: una colisión o un catálogo faltante
  // bloquean la huella aunque la atestación sea válida.
  const verdict = preflightVerdict({
    authProceed: authRes.proceed, noCollisions: sinColisiones, catalogsOk,
  });
  // Cada gate bloqueante se CONTABILIZA como fallo: la salida no puede
  // volver a decir "0 fallos" y a la vez bloquear la corrida.
  verdict.blockers.forEach((b) => ko(`GATE BLOQUEANTE — ${b}`));

  const usable = verdict.emitFingerprint && fail === 0;

  console.log('\n8. Veredicto');
  console.log(`   inventario Auth completo     : ${authRes.authState.authInventoryComplete}`);
  console.log(`   modo de verificación         : ${authRes.authState.authVerificationMode}`);
  console.log(`   atestación del owner válida  : ${attestation.valid}`);
  console.log(`   colisiones reales            : ${sinColisiones ? 'ninguna' : 'SÍ (ver arriba)'}`);
  console.log(`   catálogos completos          : ${catalogsOk}`);
  console.log(`   gates bloqueantes            : ${verdict.blockers.length === 0 ? 'ninguno' : verdict.blockers.join(' · ')}`);
  console.log(`   VEREDICTO FINAL              : ${usable ? 'APTO — se emite huella' : 'BLOQUEADO'}`);

  console.log(`\n${usable ? '✅' : '❌'} preflight: ${pass} OK, ${fail} fallos`);
  if (usable) {
    console.log('\n   Nada se escribió. Autorizá estas identidades y pasá la huella a --run:\n');
    console.log(`ASP0_PREFLIGHT_FINGERPRINT=${fp}\n`);
  } else {
    console.log('\n   ⛔ Colisiones, inventario incompleto o precondiciones incumplidas.');
    console.log('      NO se emite huella: --run queda bloqueado.\n');
  }
  process.exit(usable ? 0 : 1);
}

// ═════════════════════════════════════════════════════════════════════
// VERIFICACIÓN PREVIA A LA PRIMERA ESCRITURA
// ═════════════════════════════════════════════════════════════════════
async function verifyFingerprintBeforeWriting() {
  console.log('\n0. Verificación previa a la primera escritura (read-only)');

  // El inventario de Auth se rehace. Si sigue incompleto, --run exige la
  // MISMA atestación que el preflight: no basta con la huella.
  const auth = await listAllAuthUsers();
  const attestation = evaluateAttestation({
    attested: ATT_FLAG, date: ATT_DATE, attestedRunId: ATT_RUN_ID,
    runId: RUN_ID, identities: IDENTITIES,
  });
  const authRes = resolveAuthState({ auth, attestation });

  if (!authRes.proceed) {
    authFailureReport(auth).forEach((l) => console.log(`      ${l}`));
    authRes.reasons.forEach((r) => console.log(`      · ${r}`));
    throw new Error('ABORTADO antes de escribir: inventario de Auth incompleto y sin atestación válida del owner.');
  }
  const authState = authRes.authState;
  ok(authRes.mode === 'listusers_exhaustive'
    ? `inventario de Auth completo (${auth.unique} usuarios)`
    : 'atestación manual del owner válida (inventario de Auth incompleto)');

  const manifest = await buildManifest(authState);
  const fp = fingerprintOf(manifest);

  check('la huella coincide con la aprobada por el owner', fp === EXPECTED_FINGERPRINT);
  if (fp !== EXPECTED_FINGERPRINT) {
    console.log(`      esperada: ${EXPECTED_FINGERPRINT}`);
    console.log(`      actual:   ${fp}`);
    console.log('      Cambió una identidad, un catálogo o una condición desde el preflight.');
    throw new Error('ABORTADO antes de escribir: la huella del manifiesto no coincide.');
  }

  // Colisiones SIEMPRE, aunque haya atestación: sobre lo recuperado y sobre
  // las tablas. Cualquier colisión aborta.
  const sinColisiones = await verifyNoCollisions({ verbose: false, auth });
  if (!sinColisiones) {
    throw new Error('ABORTADO antes de escribir: colisión detectada.');
  }
  ok('comprobaciones de colisión repetidas y superadas');
  return manifest;
}

// ═════════════════════════════════════════════════════════════════════
// SESIONES Y FIXTURES
// ═════════════════════════════════════════════════════════════════════
async function createUser(identity) {
  assertNotForbidden(identity.phone, `createUser(${identity.tag})`);
  const { data, error } = await admin.auth.admin.createUser({
    email: identity.email, phone: identity.phone,
    email_confirm: true, phone_confirm: true,
    user_metadata: { fixture: MARK, run_id: RUN_ID },
  });
  if (error) throw new Error(`createUser(${identity.tag}): ${error.message}`);
  ids.users.push(data.user.id);
  return { ...identity, id: data.user.id };
}

async function sessionFor(user) {
  const { data: link, error: eLink } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: user.email,
  });
  if (eLink) throw new Error(`generateLink(${user.tag}): ${eLink.message}`);
  const hashedToken = link?.properties?.hashed_token;
  if (!hashedToken) throw new Error(`generateLink(${user.tag}): sin properties.hashed_token`);
  const c = anonClient();
  const { data, error } = await c.auth.verifyOtp({ token_hash: hashedToken, type: 'email' });
  if (error) throw new Error(`verifyOtp(${user.tag}): ${error.message}`);
  if (data.user?.id !== user.id) throw new Error(`verifyOtp(${user.tag}): la sesión es de otro usuario`);
  return c;
}

let dayOffset = 3;
const nextSlot = () => {
  const start = new Date(Date.now() + dayOffset++ * 86400000);
  start.setUTCHours(15, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 30 * 60000) };
};

async function buildFixtures(manifest) {
  const [idPatient, idDoctorA, idDoctorB] = IDENTITIES;
  const uPatient = await createUser(idPatient);
  const uDoctorA = await createUser(idDoctorA);
  const uDoctorB = await createUser(idDoctorB);

  // handle_new_user ya creó profiles. Se actualiza SOLO `role`: tocar las
  // columnas de identidad dispararía audit_profiles_identity_fn (s7_32),
  // que inserta auth.uid() (NULL bajo service_role) en audit_log.user_id
  // NOT NULL y reventaría.
  for (const [u, role] of [[uPatient, 'patient'], [uDoctorA, 'doctor'], [uDoctorB, 'doctor']]) {
    const { data, error } = await admin.from('profiles').update({ role }).eq('id', u.id).select('id');
    if (error) throw new Error(`profile(${u.tag}): ${error.message}`);
    if (data?.length !== 1) throw new Error(`profile(${u.tag}): handle_new_user no creó exactamente una fila`);
  }

  const cPatient = await sessionFor(uPatient);

  ids.specialtyId = manifest.specialty_id;

  const { data: clinic, error: eClinic } = await admin.from('clinics')
    .insert({ name: `${MARK} Clinica ${RUN_ID}`, owner_id: uDoctorA.id }).select('id').single();
  if (eClinic) throw new Error(`clinic: ${eClinic.message}`);
  ids.clinicId = clinic.id;

  for (const u of [uDoctorA, uDoctorB]) {
    const { error } = await admin.from('clinic_members')
      .insert({ clinic_id: ids.clinicId, profile_id: u.id, role: 'owner', is_active: true });
    if (error) throw new Error(`clinic_member(${u.tag}): ${error.message}`);
  }

  for (const [u, key] of [[uDoctorA, 'doctorId'], [uDoctorB, 'doctorId2']]) {
    const { data, error } = await admin.from('doctors')
      .insert({ clinic_id: ids.clinicId, profile_id: u.id, specialty_id: ids.specialtyId })
      .select('id').single();
    if (error) throw new Error(`doctor(${u.tag}): ${error.message}`);
    ids[key] = data.id;
  }

  for (const n of ['Consulta', 'Control']) {
    const { data, error } = await admin.from('services')
      .insert({ doctor_id: ids.doctorId, name: `${MARK} ${n}`, duration_minutes: 30, is_active: true })
      .select('id').single();
    if (error) throw new Error(`service ${n}: ${error.message}`);
    ids.serviceIds.push(data.id);
  }

  const rules = [];
  for (const docId of [ids.doctorId, ids.doctorId2]) {
    for (let d = 0; d <= 6; d++) {
      rules.push({ clinic_id: ids.clinicId, doctor_id: docId, day_of_week: d,
        start_time: '00:00:00', end_time: '23:59:00', is_active: true });
    }
  }
  const { data: ruleRows, error: eRules } = await admin.from('availability_rules').insert(rules).select('id');
  if (eRules) throw new Error(`availability_rules: ${eRules.message}`);
  ids.ruleIds.push(...(ruleRows ?? []).map((r) => r.id));

  const { data: p1, error: eP1 } = await admin.from('patients').insert({
    clinic_id: ids.clinicId, profile_id: uPatient.id,
    full_name: `${MARK} Paciente Uno`, date_of_birth: '1990-01-01', gender: 'otro',
    link_confirmed_at: new Date().toISOString(), is_active: true,
  }).select('id').single();
  if (eP1) throw new Error(`patient 1: ${eP1.message}`);
  ids.patientId = p1.id;

  const { data: p2, error: eP2 } = await admin.from('patients').insert({
    clinic_id: ids.clinicId, full_name: `${MARK} Paciente Dos`,
    date_of_birth: '1991-02-02', gender: 'otro', is_active: true,
  }).select('id').single();
  if (eP2) throw new Error(`patient 2: ${eP2.message}`);
  ids.patientId2 = p2.id;

  return {
    uPatient, uDoctorA, uDoctorB, cPatient,
    clinicId: ids.clinicId, doctorId: ids.doctorId, doctorId2: ids.doctorId2,
    patientId: ids.patientId, patientId2: ids.patientId2,
    serviceId: ids.serviceIds[0], serviceId2: ids.serviceIds[1],
    statusProgramada: manifest.programada_status_id,
    statusConfirmada: manifest.confirmada_status_id,
    cancelReasonId: manifest.cancel_reason_id,
  };
}

async function insertAppointment(fx, overrides = {}) {
  const { start, end } = nextSlot();
  const { data, error } = await admin.from('appointments').insert({
    clinic_id: fx.clinicId, doctor_id: fx.doctorId, patient_id: fx.patientId,
    service_id: fx.serviceId, status_id: fx.statusProgramada,
    start_time: start.toISOString(), end_time: end.toISOString(),
    source: 'lucy_directorio', price: 25, ...overrides,
  }).select('id, start_time, status_id').single();
  if (error) throw new Error(`insertAppointment: ${error.message}`);
  ids.apptIds.push(data.id);
  return data;
}

async function bookViaIntent(fx) {
  const { start } = nextSlot();
  const startLocal = start.toISOString().replace('Z', '').split('.')[0];

  const { data: intent, error: eIntent } = await fx.cPatient.rpc('register_booking_intent', {
    p_doctor_id: fx.doctorId, p_service_id: fx.serviceId,
    p_start_local: startLocal,
    p_phone: assertNotForbidden(fx.uPatient.phone, 'register_booking_intent'),
  });
  if (eIntent) throw new Error(`register_booking_intent: ${eIntent.message}`);
  const intentId = intent?.intent_id ?? intent?.id ?? intent?.booking_intent_id;
  if (!intentId) throw new Error(`register_booking_intent: contrato inesperado — claves: ${Object.keys(intent ?? {}).join(', ')}`);

  const { data: booking, error: eBook } = await fx.cPatient.rpc('create_booking_with_intent', {
    p_intent_id: intentId, p_patient_name: `${MARK} Paciente Uno`, p_notes: null,
  });
  if (eBook) throw new Error(`create_booking_with_intent: ${eBook.message}`);
  const appointmentId = booking?.appointment_id ?? booking?.id;
  if (!appointmentId) throw new Error(`create_booking_with_intent: contrato inesperado — claves: ${Object.keys(booking ?? {}).join(', ')}`);
  ids.apptIds.push(appointmentId);

  const { data: appt } = await admin.from('appointments')
    .select('patient_id').eq('id', appointmentId).maybeSingle();
  if (appt?.patient_id && ![ids.patientId, ids.patientId2].includes(appt.patient_id)) {
    ids.extraPatients.push(appt.patient_id);
  }
  return { appointmentId, profileId: fx.uPatient.id };
}

async function cancelAsPatient(fx) {
  const appt = await insertAppointment(fx, { status_id: fx.statusProgramada });
  ids.eventApptIds.push(appt.id);
  const note = `${MARK} nota libre que NO debe auditarse`;
  const { data, error } = await fx.cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: appt.id, p_reason: 'no_puedo_asistir', p_note: note,
  });
  if (error) throw new Error(`cancel_my_appointment: ${error.message}`);
  if (data?.outcome !== 'cancelled') throw new Error(`cancel_my_appointment: outcome inesperado ${JSON.stringify(data)}`);
  return { appointmentId: appt.id, profileId: fx.uPatient.id, note };
}

/**
 * Firma una consulta → dispara sync_appointment_on_sign (s6_02).
 *
 * ⚠️ SOLO local/staging (`--include-sign`). En producción esta ruta se
 * prueba con el bloque owner-only BEGIN/ROLLBACK de la guía §13.
 * Reversibilidad verificada por lectura de código: s7_28 restringe UPDATE
 * (policies), NO DELETE; el único trigger sobre consultations es
 * trg_sync_appointment_on_sign; service_role tiene rolbypassrls. Las tablas
 * dependientes son consultation_amendments, prescriptions,
 * consultation_diagnoses y consultation_family_history.
 */
async function signConsultation(fx) {
  const appt = await insertAppointment(fx, { status_id: fx.statusConfirmada });
  const { data: cons, error: eCons } = await admin.from('consultations').insert({
    appointment_id: appt.id, clinic_id: fx.clinicId,
    doctor_id: fx.doctorId, patient_id: fx.patientId,
    status: 'draft', started_at: new Date().toISOString(), chief_complaint: MARK,
  }).select('id').single();
  if (eCons) throw new Error(`consultation: ${eCons.message}`);
  ids.consultIds.push(cons.id);

  const { error: eSign } = await admin.from('consultations')
    .update({ status: 'signed', signed_at: new Date().toISOString() }).eq('id', cons.id);
  if (eSign) throw new Error(`firmar consulta: ${eSign.message}`);
  return { appointmentId: appt.id, consultationId: cons.id };
}

// ═════════════════════════════════════════════════════════════════════
// CORRIDA
// ═════════════════════════════════════════════════════════════════════
async function run() {
  console.log('\n_smoke-s7_71a — cobertura server-side de appointments\n');
  console.log(`  ASP0_RUN_ID: ${RUN_ID} · marca: ${MARK} · inicio: ${RUN_STARTED_AT}`);
  console.log(`  firma de consulta: ${INCLUDE_SIGN ? 'INCLUIDA (--include-sign, solo local/staging)' : 'EXCLUIDA (ver guía §13)'}`);

  const manifest = await verifyFingerprintBeforeWriting();

  console.log('\n0-bis. Fixtures sintéticas');
  const fx = await buildFixtures(manifest);
  ok(`clínica ${ids.clinicId.slice(0, 8)}… · 2 médicos · 2 fichas · 2 servicios`);
  ok('sesión authenticated del paciente abierta (sin imprimir credenciales)');

  // ─── 1. INSERT manual (walk-in) ────────────────────────────────────
  console.log('\n1. Creación manual (walk-in)');
  {
    const appt = await insertAppointment(fx, {
      source: 'manual',
      notes: 'NOTA_LIBRE_NO_DEBE_AUDITARSE',
      internal_notes: 'NOTA_INTERNA_NO_DEBE_AUDITARSE',
    });
    const rows = await auditRows(appt.id);
    check('1.1 exactamente 1 fila', rows.length === 1);
    check('1.2 action = insert', rows[0]?.action === 'insert');
    check('1.3 change_kind = appointment_created', kindOf(rows[0]) === 'appointment_created');
    check('1.4 source literal = manual', rows[0]?.new_data?.source === 'manual');
    check('1.5 old_data nulo en INSERT', rows[0]?.old_data === null);
    check('1.6 actor_kind = service_role', rows[0]?.new_data?.actor_kind === 'service_role');
    check('1.7 db_executor presente', typeof rows[0]?.new_data?.db_executor === 'string');
    const blob = JSON.stringify(rows[0]);
    check('1.8 NO contiene la nota libre', !blob.includes('NOTA_LIBRE_NO_DEBE_AUDITARSE'));
    check('1.9 NO contiene la nota interna', !blob.includes('NOTA_INTERNA_NO_DEBE_AUDITARSE'));
  }

  // ─── 2. create_booking_with_intent ─────────────────────────────────
  console.log('\n2. Reserva por create_booking_with_intent (cobertura NUEVA)');
  {
    const r = await bookViaIntent(fx);
    const rows = await auditRows(r.appointmentId);
    check('2.1 exactamente 1 fila', rows.length === 1);
    check('2.2 action = insert', rows[0]?.action === 'insert');
    check('2.3 change_kind = appointment_created', kindOf(rows[0]) === 'appointment_created');
    check('2.4 source literal registrado', typeof rows[0]?.new_data?.source === 'string');
    check('2.5 actor_kind = user', rows[0]?.new_data?.actor_kind === 'user');
    check('2.6 user_id = el paciente (no el centinela)', rows[0]?.user_id === r.profileId);
  }

  // ─── 3. Cambio de estado ───────────────────────────────────────────
  console.log('\n3. Cambio de estado');
  {
    const appt = await insertAppointment(fx);
    const before = (await auditRows(appt.id)).length;
    const { error } = await admin.from('appointments')
      .update({ status_id: fx.statusConfirmada }).eq('id', appt.id);
    if (error) throw new Error(`update estado: ${error.message}`);
    const rows = await auditRows(appt.id);
    check('3.1 se agregó exactamente 1 fila', rows.length === before + 1);
    const last = rows[rows.length - 1];
    check('3.2 action = update', last?.action === 'update');
    check('3.3 change_kind = status_change', kindOf(last) === 'status_change');
    check('3.4 old_data lleva el status anterior', !!last?.old_data?.status_id);
    check('3.5 new_data lleva el status nuevo', last?.new_data?.status_id === fx.statusConfirmada);
    check('3.6 sin context_rejected', last?.new_data?.context_rejected === undefined);
  }

  // ─── 4. Reprogramación ─────────────────────────────────────────────
  console.log('\n4. Reprogramación');
  {
    const appt = await insertAppointment(fx);
    const before = (await auditRows(appt.id)).length;
    const { start, end } = nextSlot();
    const { error } = await admin.from('appointments')
      .update({ start_time: start.toISOString(), end_time: end.toISOString() }).eq('id', appt.id);
    if (error) throw new Error(`reprogramar: ${error.message}`);
    const rows = await auditRows(appt.id);
    check('4.1 se agregó exactamente 1 fila', rows.length === before + 1);
    const last = rows[rows.length - 1];
    check('4.2 change_kind = reschedule', kindOf(last) === 'reschedule');
    check('4.3 old y new llevan start_time', !!last?.old_data?.start_time && !!last?.new_data?.start_time);
    check('4.4 old y new llevan end_time', !!last?.old_data?.end_time && !!last?.new_data?.end_time);
  }

  // ─── 5. Doctor / servicio / precio / motivo ────────────────────────
  console.log('\n5. Doctor / servicio / precio / motivo');
  {
    const a1 = await insertAppointment(fx);
    let n = (await auditRows(a1.id)).length;
    const { error: e1 } = await admin.from('appointments').update({ doctor_id: fx.doctorId2 }).eq('id', a1.id);
    if (e1) throw new Error(`cambio de doctor: ${e1.message}`);
    let rows = await auditRows(a1.id);
    check('5.1 doctor → 1 fila', rows.length === n + 1);
    check('5.2 change_kind = doctor_reassign', kindOf(rows[rows.length - 1]) === 'doctor_reassign');

    const a2 = await insertAppointment(fx);
    n = (await auditRows(a2.id)).length;
    const { error: e2 } = await admin.from('appointments')
      .update({ service_id: fx.serviceId2, price: 42 }).eq('id', a2.id);
    if (e2) throw new Error(`servicio+precio: ${e2.message}`);
    rows = await auditRows(a2.id);
    check('5.3 servicio+precio → 1 fila', rows.length === n + 1);
    check('5.4 change_kind = appointment_update', kindOf(rows[rows.length - 1]) === 'appointment_update');
    check('5.5 registra el precio nuevo', Number(rows[rows.length - 1]?.new_data?.price) === 42);

    if (fx.cancelReasonId) {
      const a3 = await insertAppointment(fx);
      n = (await auditRows(a3.id)).length;
      const { error: e3 } = await admin.from('appointments')
        .update({ cancel_reason_id: fx.cancelReasonId }).eq('id', a3.id);
      if (e3) throw new Error(`motivo: ${e3.message}`);
      rows = await auditRows(a3.id);
      check('5.6 motivo → 1 fila', rows.length === n + 1);
      check('5.7 change_kind = status_change', kindOf(rows[rows.length - 1]) === 'status_change');
    } else {
      ko('5.6/5.7 catálogo cancel_reasons vacío — el preflight debió bloquear la corrida');
    }

    const a4 = await insertAppointment(fx);
    n = (await auditRows(a4.id)).length;
    const slot = nextSlot();
    const { error: e4 } = await admin.from('appointments').update({
      status_id: fx.statusConfirmada,
      start_time: slot.start.toISOString(), end_time: slot.end.toISOString(),
    }).eq('id', a4.id);
    if (e4) throw new Error(`estado+horario: ${e4.message}`);
    rows = await auditRows(a4.id);
    check('5.8 estado+horario → 1 fila', rows.length === n + 1);
    check('5.9 change_kind = mixed', kindOf(rows[rows.length - 1]) === 'mixed');
  }

  // ─── 6. cancel_my_appointment — UNA sola fila ──────────────────────
  console.log('\n6. cancel_my_appointment (prueba central: sin duplicado)');
  {
    const r = await cancelAsPatient(fx);
    const rows = await auditRows(r.appointmentId);
    const updates = rows.filter((x) => x.action === 'update');
    check('6.1 EXACTAMENTE 1 fila de update (sin duplicado)', updates.length === 1);
    const last = updates[0];
    check('6.2 edited_via = patient_self_cancel', last?.new_data?.edited_via === 'patient_self_cancel');
    check('6.3 conserva el motivo', last?.new_data?.reason === 'no_puedo_asistir');
    check('6.4 change_kind = status_change', kindOf(last) === 'status_change');
    check('6.5 contexto ACEPTADO (sin context_rejected)', last?.new_data?.context_rejected === undefined);
    check('6.6 user_id = el paciente', last?.user_id === r.profileId);
    check('6.7 actor_kind = user', last?.new_data?.actor_kind === 'user');
    check('6.8 la nota libre NO está en la auditoría', !JSON.stringify(last).includes(r.note));
  }

  // ─── 7. Reasignación de paciente (merge/unmerge genérico) ──────────
  console.log('\n7. Reasignación de paciente (merge/unmerge, sin setter)');
  {
    const appt = await insertAppointment(fx);
    const n = (await auditRows(appt.id)).length;
    // Ida y vuelta: emula el ciclo merge → unmerge. NO se llama a
    // admin_merge_patients, así que NO se genera patient_merge_log: las
    // fixtures quedan eliminables solo con appointments + patients.
    const { error: e1 } = await admin.from('appointments')
      .update({ patient_id: fx.patientId2 }).eq('id', appt.id);
    if (e1) throw new Error(`reasignar paciente: ${e1.message}`);
    const rowsA = await auditRows(appt.id);
    const lastA = rowsA[rowsA.length - 1];
    check('7.1 ida → 1 fila', rowsA.length === n + 1);
    check('7.2 change_kind = patient_reassign', kindOf(lastA) === 'patient_reassign');
    check('7.3 SIN etiqueta patient_merge inventada', lastA?.new_data?.edited_via === undefined);
    check('7.4 old y new llevan patient_id', !!lastA?.old_data?.patient_id && !!lastA?.new_data?.patient_id);

    const { error: e2 } = await admin.from('appointments')
      .update({ patient_id: fx.patientId }).eq('id', appt.id);
    if (e2) throw new Error(`revertir reasignación: ${e2.message}`);
    const rowsB = await auditRows(appt.id);
    check('7.5 vuelta → 1 fila más', rowsB.length === n + 2);
    check('7.6 vuelta también patient_reassign', kindOf(rowsB[rowsB.length - 1]) === 'patient_reassign');
    check('7.7 la cita vuelve a la ficha original (eliminable)',
      rowsB[rowsB.length - 1]?.new_data?.patient_id === fx.patientId);
  }

  // ─── 8. Firma de consulta ──────────────────────────────────────────
  console.log('\n8. Firma de consulta (cascada de s6_02)');
  if (INCLUDE_SIGN) {
    const r = await signConsultation(fx);
    const rows = await auditRows(r.appointmentId);
    const updates = rows.filter((x) => x.action === 'update');
    check('8.1 la cascada dejó auditoría de appointments', updates.length >= 1);
    const last = updates[updates.length - 1];
    check('8.2 change_kind = status_change', kindOf(last) === 'status_change');
    check('8.3 SIN etiqueta consultation_signed inventada', last?.new_data?.edited_via === undefined);
  } else {
    console.log(`
  ⏭️  NO EJECUTADO en esta corrida (sin --include-sign).
      La firma es irreversible en el sentido de producto, así que en
      producción esta ruta se prueba con el bloque owner-only
      BEGIN/ROLLBACK de docs/OWNER_S7_71A_APPLY.md §13.
      Esta corrida NO cuenta como cobertura de firma.
`);
  }

  // ─── 9. Actualización irrelevante → SIN fila ───────────────────────
  console.log('\n9. Actualización irrelevante (sin ruido)');
  {
    const appt = await insertAppointment(fx);
    const before = (await auditRows(appt.id)).length;
    const { error } = await admin.from('appointments')
      .update({ notes: 'solo notas', internal_notes: 'solo internas' }).eq('id', appt.id);
    if (error) throw new Error(`update irrelevante: ${error.message}`);
    check('9.1 NO se escribió ninguna fila nueva', (await auditRows(appt.id)).length === before);
  }

  // ─── 10. service_role ──────────────────────────────────────────────
  console.log('\n10. Escritura por service_role');
  {
    const appt = await insertAppointment(fx);
    const rows = await auditRows(appt.id);
    const last = rows[rows.length - 1];
    check('10.1 actor_kind = service_role', last?.new_data?.actor_kind === 'service_role');
    check('10.2 user_id = centinela (sin auth.uid())', last?.user_id === NIL);
    check('10.3 NO aborta la escritura de la cita', !!appt.id);
  }

  // ─── 11-12. Owner-only ─────────────────────────────────────────────
  console.log('\n11-12. db_direct y contexto rechazado');
  console.log(`
  ⏭️  NO ALCANZABLES desde supabase-js: exigen conexión SIN JWT y
      set_config server-side, ninguno expuesto por PostgREST (y eso mismo
      es parte de la defensa). Bloques owner-only, transaccionales y con
      ROLLBACK, en docs/OWNER_S7_71A_APPLY.md §11 y §12.
`);
}

// ═════════════════════════════════════════════════════════════════════
// CLEANUP — corre SIEMPRE desde el finally
// ═════════════════════════════════════════════════════════════════════
const cleanupErrors = [];

async function cleanup() {
  console.log('\n13. Cleanup (se ejecuta aunque la corrida haya fallado)');

  const del = async (label, promise) => {
    try {
      const { error } = await promise;
      if (error) { cleanupErrors.push(`${label}: ${error.message}`); console.error(`  ⚠️  ${label}: ${error.message}`); }
      else console.log(`  🧹 ${label}`);
    } catch (e) {
      cleanupErrors.push(`${label}: ${e.message}`);
      console.error(`  ⚠️  ${label}: ${e.message}`);
    }
  };

  const has = (a) => Array.isArray(a) && a.length > 0;
  const patientIds = [ids.patientId, ids.patientId2, ...ids.extraPatients].filter(Boolean);
  const doctorIds = [ids.doctorId, ids.doctorId2].filter(Boolean);

  if (has(ids.consultIds)) {
    for (const t of ['consultation_amendments', 'prescriptions',
                     'consultation_diagnoses', 'consultation_family_history']) {
      await del(`${t}`, admin.from(t).delete().in('consultation_id', ids.consultIds));
    }
    await del('consultas', admin.from('consultations').delete().in('id', ids.consultIds));
  }

  if (has(ids.eventApptIds)) {
    await del('eventos de cancelación',
      admin.from('appointment_patient_cancellations').delete().in('appointment_id', ids.eventApptIds));
  }
  if (has(ids.apptIds)) await del('citas', admin.from('appointments').delete().in('id', ids.apptIds));

  if (has(ids.users)) {
    await del('booking_intents', admin.from('booking_intents').delete().in('created_by', ids.users));
    await del('auth_creation_grants', admin.from('auth_creation_grants').delete().in('issued_by', ids.users));
  }

  if (has(doctorIds)) {
    await del('reglas de disponibilidad', admin.from('availability_rules').delete().in('doctor_id', doctorIds));
    await del('servicios', admin.from('services').delete().in('doctor_id', doctorIds));
  }

  if (has(patientIds)) await del('pacientes', admin.from('patients').delete().in('id', patientIds));
  if (has(doctorIds)) await del('médicos', admin.from('doctors').delete().in('id', doctorIds));
  if (ids.clinicId) {
    await del('membresías', admin.from('clinic_members').delete().eq('clinic_id', ids.clinicId));
    await del('clínicas', admin.from('clinics').delete().eq('id', ids.clinicId));
  }

  if (has(ids.users)) await del('perfiles', admin.from('profiles').delete().in('id', ids.users));
  for (const uid of ids.users) {
    try {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) { cleanupErrors.push(`auth.user ${uid}: ${error.message}`); console.error(`  ⚠️  auth.user ${uid}: ${error.message}`); }
      else console.log(`  🧹 auth.user ${uid.slice(0, 8)}… (Admin API, nunca SQL)`);
    } catch (e) {
      cleanupErrors.push(`auth.user ${uid}: ${e.message}`);
    }
  }

  await cleanupAuditLog();
  await finalInventory(patientIds, doctorIds);
}

/**
 * Borra la auditoría de las fixtures SOLO por allowlist explícita.
 * `created_at >= RUN_STARTED_AT` es condición ADICIONAL, jamás suficiente.
 * Antes de borrar se reporta lo previsto y se ABORTA si aparece cualquier
 * record_id fuera de la lista.
 */
async function cleanupAuditLog() {
  const allow = allowlist();
  if (allow.length === 0) { console.log('  🧹 audit_log: nada que borrar (allowlist vacía)'); return; }

  const { data: previstas, error: eSel } = await admin.from('audit_log')
    .select('id, table_name, record_id')
    .in('record_id', allow)
    .in('table_name', SMOKE_TABLES)
    .gte('created_at', RUN_STARTED_AT);
  if (eSel) {
    cleanupErrors.push(`audit_log (select previo): ${eSel.message}`);
    console.error(`  ⚠️  audit_log: no se pudo listar (${eSel.message}) — NO se borra nada`);
    return;
  }

  const filas = previstas ?? [];
  const distintos = [...new Set(filas.map((r) => r.record_id))];
  console.log(`  ℹ️  audit_log previsto: ${filas.length} fila(s) sobre ${distintos.length} record_id`);
  distintos.forEach((r) => console.log(`      · ${r}`));

  const fuera = distintos.filter((r) => !allow.includes(r));
  if (fuera.length > 0) {
    cleanupErrors.push(`audit_log: ${fuera.length} record_id FUERA de la allowlist — no se borró nada`);
    console.error(`  ⛔ ABORTADO: record_id fuera de la allowlist: ${fuera.join(', ')}`);
    return;
  }

  const { error: eDel } = await admin.from('audit_log').delete()
    .in('record_id', allow).in('table_name', SMOKE_TABLES).gte('created_at', RUN_STARTED_AT);
  if (eDel) { cleanupErrors.push(`audit_log (delete): ${eDel.message}`); console.error(`  ⚠️  audit_log: ${eDel.message}`); }
  else console.log(`  🧹 audit_log: ${filas.length} fila(s) sintéticas`);
}

/** Inventario final. Falla el proceso si queda CUALQUIER residuo. */
async function finalInventory(patientIds, doctorIds) {
  console.log('\n  Inventario final — verificación de CERO residuos');
  let residuals = 0;

  const countIn = async (table, col, list) => {
    if (!list.length) return 0;
    const { count, error } = await admin.from(table)
      .select('*', { count: 'exact', head: true }).in(col, list);
    if (error) { cleanupErrors.push(`contar ${table}: ${error.message}`); return -1; }
    return count ?? 0;
  };

  const filas = [
    ['appointments', 'id', ids.apptIds],
    ['consultations', 'id', ids.consultIds],
    ['appointment_patient_cancellations', 'appointment_id', ids.eventApptIds],
    ['patients', 'id', patientIds],
    ['services', 'id', ids.serviceIds],
    ['availability_rules', 'id', ids.ruleIds],
    ['doctors', 'id', doctorIds],
    ['clinic_members', 'profile_id', ids.users],
    ['clinics', 'id', [ids.clinicId].filter(Boolean)],
    ['booking_intents', 'created_by', ids.users],
    ['auth_creation_grants', 'issued_by', ids.users],
    ['profiles', 'id', ids.users],
  ];
  for (const [table, col, list] of filas) {
    const n = await countIn(table, col, list);
    if (n > 0) residuals += n;
    console.log(`    · ${String(table).padEnd(36)} ${n}`);
  }

  const allow = allowlist();
  if (allow.length) {
    const { count, error } = await admin.from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in('record_id', allow).in('table_name', SMOKE_TABLES).gte('created_at', RUN_STARTED_AT);
    if (error) cleanupErrors.push(`contar audit_log: ${error.message}`);
    else { residuals += count ?? 0; console.log(`    · ${'audit_log (sintético)'.padEnd(36)} ${count ?? 0}`); }
  }

  let authLeft = 0;
  for (const uid of ids.users) {
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (!error && data?.user?.id) { authLeft++; console.log(`    · auth.user ${uid} → ⚠️ TODAVÍA EXISTE`); }
  }
  residuals += authLeft;
  console.log(`    · ${'auth.users (getUserById)'.padEnd(36)} ${authLeft}`);

  check(`13.1 CERO residuos (${residuals})`, residuals === 0);
  check(`13.2 el cleanup no acumuló errores (${cleanupErrors.length})`, cleanupErrors.length === 0);
  cleanupErrors.forEach((e) => console.log(`      · ${e}`));
}

// ═════════════════════════════════════════════════════════════════════
// ENTRYPOINT — todo lo que escribe va en try/finally
// ═════════════════════════════════════════════════════════════════════
async function main() {
  if (!enforceGuards()) { process.exit(0); }
  initClients();

  if (WANT_PREFLIGHT) { await preflight(); return; }

  let runError = null;
  try {
    await run();
  } catch (e) {
    runError = e;
    console.error(`\n💥 la corrida falló: ${e.message}`);
    fail++;
  } finally {
    try {
      await cleanup();
    } catch (e) {
      cleanupErrors.push(`cleanup abortó: ${e.message}`);
      console.error(`\n💥 el cleanup abortó: ${e.message}`);
      fail++;
    }
  }

  const clean = fail === 0 && cleanupErrors.length === 0 && !runError;
  console.log(`\n${clean ? '✅' : '❌'} _smoke-s7_71a: ${pass} OK, ${fail} fallos, ${cleanupErrors.length} errores de cleanup\n`);
  process.exit(clean ? 0 : 1);
}

// Solo se ejecuta si el archivo se invoca directamente. Importado (por
// check-s7_71a.mjs, para probar el fingerprint real) no hace nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
