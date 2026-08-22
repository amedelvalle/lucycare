/**
 * check-s7_73.mjs — ADMIN-DOCTOR-SEED-P0, verificación ESTÁTICA.
 *
 *   node scripts/check-s7_73.mjs
 *
 * Sin red, sin Supabase, sin service_role, sin datos: analiza el texto de la
 * migración, la Edge Function y el frontend. Verifica las invariantes que el
 * owner fijó y que NO deben poder romperse por descuido.
 *
 * El E2E vive en `_smoke-s7_73.mjs` y requiere la migración aplicada.
 */
import fs from 'node:fs';

const MIG = 'migrations/s7_73_admin_seed_doctor.sql';
const EDGE = 'supabase/functions/admin-create-seed-doctor/index.ts';
const SVC = 'src/services/adminDoctorSeed.service.ts';
const UI = 'src/pages/admin/components/AdminCreateSeedDoctorModal.tsx';

let pass = 0;
let fail = 0;
const check = (desc, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok || !extra ? '' : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};

const sql = fs.readFileSync(MIG, 'utf8');
const edge = fs.readFileSync(EDGE, 'utf8');
const svc = fs.readFileSync(SVC, 'utf8');
const ui = fs.readFileSync(UI, 'utf8');

/** SQL sin comentarios: las prohibiciones se evalúan sobre CÓDIGO, no sobre prosa. */
const code = sql.replace(/--.*$/gm, '');

/**
 * Mismo criterio para TS/TSX. Sin esto, la prosa del encabezado —que explica
 * justamente por qué NO se usa `service_role` en el cliente— haría fallar las
 * aserciones. Se evalúa CÓDIGO, no prosa.
 */
const BLOCK_COMMENT = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
const LINE_COMMENT = new RegExp('^\\s*//.*$', 'gm');
const stripTs = (src) => src.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
const edgeCode = stripTs(edge);
const svcCode = stripTs(svc);
const uiCode = stripTs(ui);

console.log('\ncheck-s7_73 — ADMIN-DOCTOR-SEED-P0 (estático)\n');

// ─── A. auth.users: JAMÁS por SQL ────────────────────────────
console.log('  A) auth.users intocable desde SQL\n');
check('la migración NO inserta en auth.users', !/INSERT\s+INTO\s+auth\.users/i.test(code));
check('la migración NO actualiza auth.users', !/UPDATE\s+auth\.users/i.test(code));
check('la migración NO borra de auth.users', !/DELETE\s+FROM\s+auth\.users/i.test(code));
check('solo LEE auth.users (en el lookup)', /FROM\s+auth\.users/i.test(code));
check('no toca la FK profiles → auth.users',
  !/profiles_id_fkey|DROP\s+CONSTRAINT|ALTER\s+TABLE\s+(public\.)?profiles/i.test(code));

// ─── B. Invariantes del médico sembrado ──────────────────────
console.log('\n  B) invariantes del médico creado\n');
const insertDoctors = code.match(/INSERT\s+INTO\s+public\.doctors[\s\S]*?;/i)?.[0] ?? '';
check('hay exactamente un INSERT INTO doctors',
  (code.match(/INSERT\s+INTO\s+public\.doctors/gi) || []).length === 1);
check('se localizó el INSERT de doctors', insertDoctors.length > 0);
check('booking_enabled se pasa como literal false',
  /true,\s*false\s*\)/.test(insertDoctors.replace(/\s+/g, ' ')));
check('booking_enabled NUNCA sale de un parámetro',
  !/booking_enabled\s*(:?=|=>)\s*(p_|v_publish|v_booking)/i.test(code));
check("lucy_status es 'listed_only' literal", /'listed_only'::lucy_status/.test(insertDoctors));
check('is_operational va en la lista de columnas', /is_operational, booking_enabled/.test(insertDoctors));
check('is_published depende de D1', /v_publish\s+AND\s+v_cumple_d1/.test(code));
check('NO se crea clinic_members', !/INSERT\s+INTO\s+public\.clinic_members/i.test(code));
check('NO se escribe doctors.license_number', !/license_number\s*(=|,)/.test(code));
check('la credencial va a doctor_credentials', /INSERT\s+INTO\s+public\.doctor_credentials/i.test(code));
check("la credencial nace 'pending'", /'JVPM',\s*v_jvpm,\s*'pending'/.test(code));

// ─── C. Máquina de estados y transiciones ────────────────────
console.log('\n  C) transiciones cerradas\n');
for (const fn of ['admin_claim_seed_operation', 'admin_lookup_seed_user',
                  'admin_seed_operation_set_auth_created', 'admin_seed_operation_mark_failed',
                  'admin_create_seed_doctor']) {
  check(`existe ${fn}`, new RegExp(`FUNCTION\\s+public\\.${fn}\\s*\\(`).test(code));
}
check('NO existe una RPC genérica de set_status',
  !/FUNCTION\s+public\.admin_seed_operation_set_status/i.test(code));
const nFor = (code.match(/FOR\s+UPDATE/gi) || []).length;
check(`las mutaciones bloquean la fila (FOR UPDATE ×${nFor})`, nFor >= 4);
check('set_auth_created rechaza estados terminales',
  /status IN \('completed', 'failed'\)[\s\S]{0,220}P0123/.test(code));
check('set_auth_created no sustituye un seed_user_id distinto',
  /seed_user_id IS NOT NULL AND v_row\.seed_user_id <> p_seed_user_id[\s\S]{0,200}P0124/.test(code));
check('mark_failed no puede sobrescribir completed',
  /v_row\.status = 'completed'[\s\S]{0,200}P0123/.test(code));
check('create_seed_doctor devuelve lo existente si ya está completed',
  /already_completed/.test(code));
check('create_seed_doctor exige estado auth_created',
  /status <> 'auth_created'[\s\S]{0,160}P0123/.test(code));

// ─── C2. Transiciones exactas de la máquina de estados ───────
// Se afirma sobre el CUERPO de cada RPC. Los CHECK de la tabla validan la
// FORMA de cada estado; la legalidad de las transiciones la dan estas RPCs
// más la ausencia de DML de cliente (§E).
console.log('\n  C2) transiciones, una por una\n');
const cuerpo = (fn) =>
  code.match(new RegExp(`FUNCTION public\\.${fn}[\\s\\S]*?\\$\\$;`))?.[0] ?? '';

const bClaim = cuerpo('admin_claim_seed_operation');
const bSet = cuerpo('admin_seed_operation_set_auth_created');
const bFail = cuerpo('admin_seed_operation_mark_failed');
const bCreate = cuerpo('admin_create_seed_doctor');

check('started: lo escribe el claim con DEFAULT', /DEFAULT 'started'/.test(code));
check('started → auth_created lo hace set_auth_created',
  /SET status = 'auth_created'/.test(bSet));
check('→ failed lo hace mark_failed', /SET status = 'failed'/.test(bFail));
check('auth_created → completed lo hace create_seed_doctor',
  /SET status = 'completed'/.test(bCreate));
check('solo esas tres RPCs escriben status',
  (code.match(/SET status = /g) || []).length === 3);
check('completed es terminal en set_auth_created', /status IN \('completed', 'failed'\)/.test(bSet));
check('completed es terminal en mark_failed', /status = 'completed'[\s\S]{0,180}P0123/.test(bFail));
check('failed es terminal en create_seed_doctor', /status = 'failed'[\s\S]{0,180}P0123/.test(bCreate));
check('set_auth_created es idempotente con el MISMO uuid',
  /seed_user_id IS NOT NULL AND v_row\.seed_user_id <> p_seed_user_id/.test(bSet));
check('mark_failed conserva el primer error_code',
  /status = 'failed'[\s\S]{0,200}RETURN jsonb_build_object/.test(bFail));
check('completed devuelve el resultado existente', /already_completed/.test(bCreate));
// La propiedad real: dentro de cada RPC, la guarda de estado terminal ocurre
// ANTES de la escritura de `status`. Así no se puede alcanzar el UPDATE sin
// haberla pasado. (Un regex sobre el archivo completo cruzaría los límites
// entre funciones y sería vacuo.)
check('set_auth_created: la guarda terminal precede a la escritura',
  bSet.indexOf("status IN ('completed', 'failed')") < bSet.indexOf("SET status = 'auth_created'"));
check('mark_failed: la guarda de completed precede a la escritura',
  bFail.indexOf("v_row.status = 'completed'") < bFail.indexOf("SET status = 'failed'"));
check('create_seed_doctor: las guardas preceden a la escritura',
  bCreate.indexOf("status = 'failed'") < bCreate.indexOf("SET status = 'completed'")
  && bCreate.indexOf("status <> 'auth_created'") < bCreate.indexOf("SET status = 'completed'"));
check('ninguna RPC escribe status = started o = auth_created fuera de set_auth_created',
  !/SET status = 'started'/.test(code)
  && (code.match(/SET status = 'auth_created'/g) || []).length === 1);
check('el claim NUNCA cambia status (solo renueva updated_at)',
  /SET updated_at = now\(\)/.test(bClaim) && !/SET status/.test(bClaim));
check('requested_by sale de auth.uid(), no del navegador',
  /VALUES \(p_operation_id, auth\.uid\(\), p_payload_hash\)/.test(bClaim));

// ─── D. Seguridad de las RPCs ────────────────────────────────
console.log('\n  D) gates, grants y search_path\n');
const defs = code.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) || [];
check(`${defs.length} funciones definidas`, defs.length === 6);
check('todas fijan search_path explícito', defs.every((d) => /SET search_path\s*=/.test(d)));
check('todas las admin_* son SECURITY DEFINER',
  defs.filter((d) => /FUNCTION public\.admin_/.test(d)).every((d) => /SECURITY DEFINER/.test(d)));
check('las 5 admin_* gatean con is_admin()',
  (code.match(/IF NOT public\.is_admin\(\) THEN/g) || []).length === 5);
check('REVOKE de PUBLIC y anon presente',
  /REVOKE ALL ON FUNCTION %s FROM PUBLIC/.test(code) && /REVOKE ALL ON FUNCTION %s FROM anon/.test(code));
check('GRANT EXECUTE solo a authenticated', /GRANT EXECUTE ON FUNCTION %s TO authenticated/.test(code));
check('NO se otorga EXECUTE a anon en ninguna función', !/GRANT EXECUTE[^;]*TO anon/i.test(code));
check('el helper de email es privado (sin grant a authenticated)',
  /_seed_doctor_email\(uuid\) FROM authenticated/.test(code));

// ─── E. Tabla de operaciones sin DML de cliente ──────────────
console.log('\n  E) admin_seed_operations\n');
check('RLS habilitada', /ALTER TABLE public\.admin_seed_operations ENABLE ROW LEVEL SECURITY/.test(code));
check('REVOKE ALL a authenticated', /REVOKE ALL ON public\.admin_seed_operations FROM authenticated/.test(code));
check('solo GRANT SELECT a authenticated',
  /GRANT SELECT ON public\.admin_seed_operations TO authenticated/.test(code)
  && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*admin_seed_operations/i.test(code));
check('única policy es de SELECT',
  (code.match(/CREATE POLICY[^;]*admin_seed_operations/gi) || []).length === 1
  && /FOR SELECT USING \(public\.is_admin\(\)\)/.test(code));
check('la POST verifica que authenticated no tenga DML',
  /has_table_privilege\('authenticated'[\s\S]{0,200}'INSERT'/.test(code));
for (const c of ['seedops_completed_shape', 'seedops_authcreated_shape',
                 'seedops_failed_shape', 'seedops_status_chk']) {
  check(`constraint ${c}`, code.includes(c));
}

// ─── F. Duplicados ───────────────────────────────────────────
console.log('\n  F) duplicados\n');
check('advisory lock por teléfono antes de verificar',
  /pg_advisory_xact_lock\(hashtextextended\('seed_doctor_phone:/.test(code));
check('el lock precede a la consulta de duplicado',
  code.indexOf('seed_doctor_phone:') < code.indexOf('INTO v_dup_doctor'));
check('normaliza con normalize_phone_sv', /public\.normalize_phone_sv/.test(code));
const bCreateFn = code.match(/FUNCTION public\.admin_create_seed_doctor[\s\S]*?\$\$;/)?.[0] ?? '';
check('el teléfono se escribe DESPUÉS del lock y del check de duplicado',
  bCreateFn.indexOf('seed_doctor_phone:') < bCreateFn.indexOf('INTO v_dup_doctor')
  && bCreateFn.indexOf('INTO v_dup_doctor') < bCreateFn.indexOf('UPDATE public.profiles'));
check('la búsqueda del duplicado ocurre en la MISMA transacción (advisory xact)',
  /pg_advisory_xact_lock/.test(bCreateFn));
check('profiles.phone y clinics.phone son campos distintos',
  /phone      = coalesce\(v_claim_phone, phone\)/.test(bCreateFn)
  && /VALUES \(v_clinic_name, v_address, v_clinic_phone/.test(bCreateFn));

// ─── F2. Payload: whitelist, normalización y hash ────────────
console.log('\n  F2) contrato del payload\n');
check('existe whitelist explícita de campos', /const ALLOWED_FIELDS = \[/.test(edgeCode));
check('la normalización ocurre antes del hash',
  edgeCode.indexOf('normalizePayload(payload)') < edgeCode.indexOf('sha256Hex(canonical('));
check('el hash se calcula sobre la representación normalizada',
  /sha256Hex\(canonical\(normalized\)\)/.test(edgeCode));
check('a la RPC llega esa MISMA representación, no el crudo',
  /p_payload: normalized/.test(edgeCode) && !/p_payload: payload/.test(edgeCode));
check('la normalización solo recorre la whitelist',
  /for \(const k of \[\.\.\.ALLOWED_FIELDS\]\.sort\(\)\)/.test(edgeCode));
check('los campos desconocidos del navegador no pasan',
  !/Object\.keys\(payload\)/.test(edgeCode));
check('el JVPM duplicado lo bloquea el índice único (23505 mapeado en la Edge)',
  /'23505'/.test(edge) && /duplicate_jvpm/.test(edge));

// ─── G. Edge Function ────────────────────────────────────────
console.log('\n  G) Edge Function\n');
check('service_role solo para Admin API',
  (edgeCode.match(/asService\./g) || []).length === (edgeCode.match(/asService\.auth\.admin\./g) || []).length);
check('las RPCs de negocio van con el JWT del admin',
  !/asService\.rpc\(/.test(edgeCode) && /asAdmin\.rpc\(/.test(edgeCode));
check('el payload_hash se calcula server-side (no llega del cliente)',
  /sha256Hex\(canonical\(normalized\)\)/.test(edgeCode)
  && !/payload_hash\s*=\s*(payload|body|req)/.test(edgeCode));
check('NO acepta un hash del cliente', !/payload_hash.*req\.headers|body\.payload_hash/.test(edgeCode));
check('email técnico determinístico', /seed-\$\{operationId\}@doctor-seed\.invalid/.test(edgeCode));

const createUserArgs = edgeCode.match(/createUser\(\{[\s\S]*?\n\s{6}\}\)/)?.[0] ?? '';
check('se localizó la llamada a createUser', createUserArgs.length > 0);
check('createUser sin phone y sin password',
  !!createUserArgs && !/\bphone\s*:/.test(createUserArgs) && !/\bpassword\s*:/.test(createUserArgs));
check('email_confirm en false', /email_confirm:\s*false/.test(createUserArgs));
check('ban largo', /ban_duration:\s*'876000h'/.test(createUserArgs));
check('app_metadata con las tres marcas',
  /lucy_seed_doctor:\s*true/.test(createUserArgs) && /seed_operation_id/.test(createUserArgs)
  && /seeded_at/.test(createUserArgs));
check('sin PII real en user_metadata', !/user_metadata\s*:/.test(edgeCode));
check('duplicate email → lookup, no segundo createUser',
  /already[\s\S]{0,400}admin_lookup_seed_user/.test(edgeCode));
check('si el email existe pero no cumple → fail cerrado', /seed_identity_conflict/.test(edgeCode));
check('NO usa listUsers', !/listUsers/.test(edgeCode));
check('compensa con deleteUser si la RPC falla', /rpcErr[\s\S]{0,300}deleteUser/.test(edgeCode));
check('marca compensation_failed si el borrado falla', /compensation_failed/.test(edgeCode));
check('errores sanitizados por mapPgError', /mapPgError/.test(edgeCode));
check('CORS con allowlist de origen',
  /ALLOWED_ORIGINS/.test(edgeCode) && /Access-Control-Allow-Origin/.test(edgeCode));

// ─── H. Frontend ─────────────────────────────────────────────
console.log('\n  H) frontend\n');
check('el cliente NO usa service_role (mencionarlo en un comentario es válido)',
  !/service_role|SERVICE_ROLE/i.test(svcCode) && !/service_role|SERVICE_ROLE/i.test(uiCode));
check('la Idempotency-Key se genera una vez por intento',
  /operationIdRef\s*=\s*useRef/.test(uiCode) && /crypto\.randomUUID\(\)/.test(uiCode));
check('se envía como cabecera', /'Idempotency-Key': operationId/.test(svcCode));
check('los dos teléfonos son campos separados',
  /claim_phone/.test(uiCode) && /clinic_phone/.test(uiCode));
check('la UI NO copia un teléfono en el otro',
  !/set\('claim_phone',\s*form\.clinic_phone/.test(uiCode)
  && !/set\('clinic_phone',\s*form\.claim_phone/.test(uiCode));
check('advierte sobre el control del teléfono de reclamo',
  /podrá intentar verificar el reclamo/.test(ui));
check('publicar exige D1 en la UI', /cumpleD1/.test(uiCode) && /disabled=\{!cumpleD1\}/.test(uiCode));
check('dice que la agenda queda desactivada', /agenda en línea queda desactivada/.test(ui));
check('copy en tuteo, sin voseo',
  !/(Probá|Refrescá|Ingresá|Elegí|Creá|Confirmá|Verificá|Contactá|podés|tenés)/.test(ui + svc));

// Control del instrumento: los dos guardianes que se corrigieron no pueden
// ser vacuos. Si `stripTs` dejara de funcionar, esto lo delata.
check('los guardianes de código NO son vacuos',
  /service_role/i.test(svc) && !/service_role/i.test(svcCode)
  && /user_metadata/.test(edge) && !/user_metadata\s*:/.test(edgeCode));

console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} checks\n`);
process.exit(fail === 0 ? 0 : 1);
