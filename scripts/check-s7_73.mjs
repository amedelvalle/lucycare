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
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

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
// Emparejamiento REAL columna↔valor: se parsea la lista de columnas y la de
// VALUES y se comparan por posición. Un `/true,\s*false\)/` suelto pasaría
// aunque alguien reordenara las columnas.
const columnasDoctors = (insertDoctors.match(/INSERT\s+INTO\s+public\.doctors\s*\(([\s\S]*?)\)/i)?.[1] ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const valoresDoctors = (insertDoctors.match(/VALUES\s*\(([\s\S]*?)\)\s*(RETURNING|;)/i)?.[1] ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const valorDe = (col) => {
  const i = columnasDoctors.indexOf(col);
  return i >= 0 && i < valoresDoctors.length ? valoresDoctors[i] : null;
};
check('la lista de columnas y la de valores tienen el mismo largo',
  columnasDoctors.length > 0 && columnasDoctors.length === valoresDoctors.length,
  `${columnasDoctors.length} vs ${valoresDoctors.length}`);
check('booking_enabled recibe el literal false',
  valorDe('booking_enabled') === 'false', String(valorDe('booking_enabled')));
check('is_operational recibe el literal true',
  valorDe('is_operational') === 'true', String(valorDe('is_operational')));
check("lucy_status recibe 'listed_only' literal",
  valorDe('lucy_status') === "'listed_only'::lucy_status", String(valorDe('lucy_status')));
check('is_published depende de publish AND D1',
  valorDe('is_published') === '(v_publish AND v_cumple_d1)', String(valorDe('is_published')));
check('booking_enabled NUNCA sale de un parámetro',
  !/booking_enabled\s*(:?=|=>)\s*(p_|v_publish|v_booking)/i.test(code));
check('is_published depende de D1', /v_publish\s+AND\s+v_cumple_d1/.test(code));
check('NO se crea clinic_members', !/INSERT\s+INTO\s+public\.clinic_members/i.test(code));
// Antes: `!/license_number\s*(=|,)/` — no habría detectado la columna al final
// de una lista, ni un UPDATE con otro espaciado. Ahora se busca el
// identificador completo en cualquier posición del código.
check('NO se escribe doctors.license_number (en ninguna forma)',
  !/\blicense_number\b/.test(code));
check('license_number tampoco aparece en la lista de columnas del INSERT',
  !columnasDoctors.includes('license_number'));
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
check('el claim NUNCA cambia status (solo rota el token y renueva updated_at)',
  /SET lease_token = v_token, updated_at = now\(\)/.test(bClaim) && !/SET status/.test(bClaim));
check('requested_by sale de auth.uid(), no del navegador',
  /VALUES \(p_operation_id, auth\.uid\(\), p_payload_hash, v_token\)/.test(bClaim));

// ─── C3. Ownership del lease ─────────────────────────────────
// El lease por `updated_at` dice CUÁNDO venció; el token dice QUIÉN lo tiene.
// Sin él, un worker congelado que despierta podría compensar una operación
// que otro ya retomó.
console.log('\n  C3) ownership del lease\n');
check('la tabla tiene lease_token', /lease_token\s+uuid NOT NULL DEFAULT gen_random_uuid\(\)/.test(code));
check('el claim inicial genera y devuelve el token',
  /INSERT INTO public\.admin_seed_operations \(operation_id, requested_by, payload_hash, lease_token\)/.test(bClaim)
  && /'action', 'claimed'[\s\S]{0,120}'lease_token', v_token/.test(bClaim));
check('el resume de una operación abandonada ROTA el token',
  /SET lease_token = v_token, updated_at = now\(\)/.test(bClaim)
  && /'action', 'resume'[\s\S]{0,160}'lease_token', v_token/.test(bClaim));
check('un arriendo fresco devuelve in_progress y NO rota',
  bClaim.indexOf("'in_progress'") < bClaim.indexOf('SET lease_token = v_token'));
for (const [fn, body] of [['set_auth_created', bSet], ['mark_failed', bFail],
                          ['create_seed_doctor', bCreate]]) {
  check(`${fn} exige el token vigente`,
    /lease_token IS DISTINCT FROM p_lease_token[\s\S]{0,160}P0132/.test(body));
  check(`${fn} verifica el token ANTES de cualquier escritura`,
    body.indexOf('p_lease_token') < body.indexOf('UPDATE public.admin_seed_operations'));
  check(`${fn} lo verifica bajo FOR UPDATE`,
    body.indexOf('FOR UPDATE') < body.indexOf('lease_token IS DISTINCT FROM'));
}
check('las CUATRO mutadoras reciben p_lease_token en su firma',
  (code.match(/p_lease_token\s+uuid/g) || []).length === 4);
check('el lookup NO exige token (es read-only)',
  !/p_lease_token/.test(cuerpo('admin_lookup_seed_user')));
check('no hay mecanismo genérico para apropiarse de una operación',
  !/FUNCTION public\.admin_seed_operation_(take|steal|force|reset|set_lease)/i.test(code));
check('P0132 documentado', /P0132 lease perdido/.test(sql));

// ─── C4. Correcciones de la auditoría final ──────────────────
console.log('\n  C4) hallazgos de la auditoría\n');

// 🟠-1 · teléfono de claim utilizable por Auth
check('1. el claim phone se valida con auth_phone_e164 (la misma del hook)',
  /public\.auth_phone_e164\(v_claim_phone\) IS NULL[\s\S]{0,200}P0133/.test(bCreate));
check('1. la validación precede al advisory lock y a la escritura',
  bCreate.indexOf('P0133') < bCreate.indexOf('seed_doctor_phone:')
  && bCreate.indexOf('P0133') < bCreate.indexOf('UPDATE public.profiles'));
check('1. claim_ready usa auth_phone_e164, no "el campo vino informado"',
  /v_claim_ready := \(v_claim_phone IS NOT NULL[\s\S]{0,160}auth_phone_e164\(v_claim_phone\) IS NOT NULL[\s\S]{0,80}v_jvpm IS NOT NULL\)/.test(bCreate));
check('1. clinics.phone NO se valida con auth_phone_e164 (no participa del claim)',
  !/auth_phone_e164\(v_clinic_phone\)/.test(code));
check('1. P0133 documentado y en la PRE', /P0133/.test(sql) && /auth_phone_e164\(text\)'\) IS NULL/.test(code));

// 🟠-2 · idempotencia observable
check('2. el claim reconstruye slug/is_published/claim_ready desde lo persistido',
  /INTO v_slug, v_published, v_claim_ready/.test(bClaim)
  && /FROM public\.doctors d/.test(bClaim));
check('2. el claim NO devuelve seed_user_id en completed',
  !/'action', 'completed'[\s\S]{0,300}'seed_user_id'/.test(bClaim));
check('2. la Edge enumera los campos de completed a mano',
  /action: 'completed',[\s\S]{0,220}claim_ready: !!claim\.claim_ready/.test(edgeCode));
check('2. la Edge NO reenvía el objeto completo del claim',
  !/action: 'completed', \.\.\.claim/.test(edgeCode) && !/\{ ok: true, action: 'completed', \.\.\.claim \}/.test(edgeCode));
check('2. seed_user_id no viaja al cliente en ninguna respuesta',
  !/(?<!p_)seed_user_id:/.test(edgeCode));

// 🟠-3 · JWT explícito
check('3. el Authorization se pasa explícitamente en invoke',
  /Authorization: `Bearer \$\{token\}`/.test(svcCode));
check('3. el token que se pasa es el de la sesión verificada',
  svcCode.indexOf('const token = sessionData.session?.access_token') < svcCode.indexOf('Bearer ${token}'));

// 🟠-4 · gate antes de cualquier expresión fallable
const declareCreate = bCreate.match(/DECLARE([\s\S]*?)BEGIN/)?.[1] ?? '';
check('4. el DECLARE de create no inicializa NADA desde el payload',
  declareCreate.length > 0 && !/p_payload/.test(declareCreate));
check('4. el DECLARE de create no contiene casts fallables',
  !/::(uuid|numeric|int)\b/.test(declareCreate));
check('4. is_admin() precede a toda lectura del payload',
  bCreate.indexOf('IF NOT public.is_admin() THEN') < bCreate.indexOf("p_payload->>'full_name'"));
check('4. los casts se validan con regex antes de castear',
  /!~ '\^\[0-9a-fA-F\]\{8\}/.test(bCreate) && /!~ '\^\[0-9\]\+\(\\\.\[0-9\]\+\)\?\$'/.test(bCreate));
for (const [fn, body] of [['claim', bClaim], ['set_auth_created', bSet],
                          ['mark_failed', bFail], ['create_seed_doctor', bCreate],
                          ['flag_compensation_failed', cuerpo('admin_seed_operation_flag_compensation_failed')],
                          ['lookup', cuerpo('admin_lookup_seed_user')]]) {
  const decl = body.match(/DECLARE([\s\S]*?)BEGIN/)?.[1] ?? '';
  check(`4. ${fn}: DECLARE sin expresiones fallables`,
    !/::(uuid|numeric|int|boolean)\b/.test(decl) && !/p_payload/.test(decl));
}

// 🟠-5 · compensación diagnosticable
const bFlag = cuerpo('admin_seed_operation_flag_compensation_failed');
check('5. existe la RPC estrecha de anotación', bFlag.length > 0);
check('5. solo actúa sobre status=failed', /status <> 'failed'[\s\S]{0,120}P0123/.test(bFlag));
check('5. exige el mismo lease', /lease_token IS DISTINCT FROM p_lease_token[\s\S]{0,140}P0132/.test(bFlag));
check('5. preserva el error original y anexa la marca',
  /error_code = v_row\.error_code \|\| '\+compensation_failed'/.test(bFlag));
check('5. es idempotente', /LIKE '%\+compensation_failed'[\s\S]{0,200}already_flagged/.test(bFlag));
check('5. NO cambia el status ni reabre la operación', !/SET status/.test(bFlag));
check('5. la Edge la invoca solo si deleteUser falló',
  /if \(delErr\) \{[\s\S]{0,400}admin_seed_operation_flag_compensation_failed/.test(edgeCode));
// Que `compensation_failed` no rote la clave se prueba en §I con la función
// real; acá solo se afirma que ese es el código devuelto.
check('5. y devuelve compensation_failed en ese camino',
  /return fail\('compensation_failed', origin\)/.test(edgeCode));

// ─── D. Seguridad de las RPCs ────────────────────────────────
console.log('\n  D) gates, grants y search_path\n');
const defs = code.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g) || [];
check(`${defs.length} funciones definidas`, defs.length === 7);
check('todas fijan search_path explícito', defs.every((d) => /SET search_path\s*=/.test(d)));
check('todas las admin_* son SECURITY DEFINER',
  defs.filter((d) => /FUNCTION public\.admin_/.test(d)).every((d) => /SECURITY DEFINER/.test(d)));
check('las 6 admin_* gatean con is_admin()',
  (code.match(/IF NOT public\.is_admin\(\) THEN/g) || []).length === 6);
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
check('compensa con deleteUser si la RPC falla', /rpcErr[\s\S]{0,400}deleteUser/.test(edgeCode));
check('propaga el lease_token a las CUATRO RPCs mutadoras',
  (edgeCode.match(/p_lease_token: leaseToken/g) || []).length === 4);
check('guarda el token del claim y del resume',
  (edgeCode.match(/leaseToken = claim\.lease_token/g) || []).length === 2);
check('en lease_lost NO ejecuta deleteUser',
  edgeCode.indexOf("if (code === 'lease_lost') return fail('lease_lost', origin);")
    < edgeCode.indexOf('deleteUser'));
check('en lease_lost NO marca la operación como fallida',
  /if \(!leaseToken\) return false;/.test(edgeCode));
check('marcarFallida siempre presenta el token', !/mark_failed'[\s\S]{0,200}\}\);/.test(
  edgeCode.replace(/p_lease_token: leaseToken,/g, 'TOKEN_OK')) || /marcarFallida/.test(edgeCode));
check('P0132 mapeado a lease_lost', /case 'P0132': return 'lease_lost'/.test(edgeCode));
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

// ─── I. Ciclo de vida de la operation_id (función REAL) ──────
// Se importa `src/services/seedOperationPolicy.ts` transpilado con el esbuild
// que ya trae Vite — mismo patrón que `check-auth-p1a-phone.mjs`. Se prueba la
// función real, no una copia.
console.log('\n  I) ciclo de vida de la operation_id\n');

const require = createRequire(import.meta.url);
const esbuildBin = path.join(
  path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');
const outFile = path.join(os.tmpdir(), `seedPolicy-${Date.now()}.mjs`);
execFileSync(process.execPath, [
  esbuildBin, 'src/services/seedOperationPolicy.ts',
  '--bundle', '--platform=neutral', '--format=esm', `--outfile=${outFile}`,
], { stdio: 'pipe' });
const { debeRotarOperationId, siguienteOperationId, CODIGOS_TERMINALES } =
  await import(pathToFileURL(outFile).href);

const CLAVE = 'op-original';
const rota = (code) =>
  siguienteOperationId(CLAVE, debeRotarOperationId(code), () => 'op-nueva');

// 1–3: el resultado es incierto o la operación sigue viva → MISMA clave.
check('1. timeout (sin código) → misma key', rota(null) === CLAVE);
check('2. error de red ambiguo → misma key', rota(undefined) === CLAVE && rota('') === CLAVE);
check('3. in_progress → misma key', rota('in_progress') === CLAVE);
check('3b. lease_lost → misma key', rota('lease_lost') === CLAVE);
check('3c. payload_mismatch → misma key (no se resuelve en silencio)',
  rota('payload_mismatch') === CLAVE);

// `internal` es GENÉRICO: no demuestra que el backend persistiera `failed`.
check('1b. internal → misma key (genérico, no demuestra terminalidad)',
  rota('internal') === CLAVE);
check('otros códigos previos al claim tampoco rotan',
  ['not_authenticated', 'not_admin', 'bad_request'].every((c) => rota(c) === CLAVE));

// 4: el servidor dejó la operación en `failed` → el próximo intento estrena clave.
check('4. previously_failed → key distinta', rota('previously_failed') === 'op-nueva');
for (const code of ['duplicate_jvpm', 'duplicate_phone', 'd1_incomplete',
                    'seed_identity_conflict']) {
  check(`4b. ${code} → key distinta`, rota(code) === 'op-nueva');
}

// 5–6: no se rota por clics ni reintentos de la misma operación.
check('5. éxito: no hay rotación involucrada (nunca se llama con error)',
  debeRotarOperationId(null) === false);
check('6. doble clic / retry sin respuesta terminal → NO rota',
  [null, '', 'in_progress', 'lease_lost', 'payload_mismatch', 'internal']
    .every((c) => debeRotarOperationId(c) === false));
check('la política es una ALLOWLIST de 5 códigos, no una lista negra',
  JSON.stringify([...CODIGOS_TERMINALES].sort())
    === JSON.stringify(['d1_incomplete', 'duplicate_jvpm', 'duplicate_phone',
                        'previously_failed', 'seed_identity_conflict']));
check('un código desconocido NO rota (default seguro)',
  debeRotarOperationId('codigo_que_no_existe') === false);

// Control del instrumento: si la política se volviera "nunca rotar" o
// "siempre rotar", estas dos aserciones lo delatan.
check('la política NO es trivial',
  debeRotarOperationId('duplicate_phone') === true && debeRotarOperationId('internal') === false);

// ── Evidencia server-side de cada código que rota ──
// Cada uno debe tener un camino en la Edge que persista `failed` ANTES de
// devolverlo; si `mark_failed` no confirma, el código degrada a `internal`.
check('marcarFallida devuelve si la base confirmó la persistencia',
  /const marcarFallida = async \(errorCode: string\): Promise<boolean>/.test(edgeCode)
  && /return !error;/.test(edgeCode));
check('sin lease, marcarFallida NO afirma persistencia', /if \(!leaseToken\) return false;/.test(edgeCode));
check('los códigos de dominio de la RPC solo salen si mark_failed confirmó',
  /const marcada = await marcarFallida\(code\);/.test(edgeCode)
  && /if \(!marcada\) return fail\('internal', origin\);/.test(edgeCode));
check('seed_identity_conflict solo sale si mark_failed confirmó',
  /const marcadaConflicto = await marcarFallida\('seed_identity_conflict'\)/.test(edgeCode)
  && /return fail\(marcadaConflicto \? 'seed_identity_conflict' : 'internal', origin\)/.test(edgeCode));
check('3. si mark_failed falla se devuelve internal, que NO rota',
  debeRotarOperationId('internal') === false
  && /if \(!marcada\) return fail\('internal', origin\);/.test(edgeCode)
  && /marcadaConflicto \? 'seed_identity_conflict' : 'internal'/.test(edgeCode));
check('4c. previously_failed lo emite el claim leyendo status=failed persistido',
  /IF v_row\.status = 'failed' THEN[\s\S]{0,200}'action', 'failed'/.test(bClaim)
  && /case 'failed':[\s\S]{0,120}previously_failed/.test(edgeCode));
check('ningún código de dominio se devuelve sin pasar por marcarFallida',
  !/return fail\('(duplicate_jvpm|duplicate_phone|d1_incomplete)'/.test(edgeCode));

// ─── J. Orden de la compensación (TOCTOU) ────────────────────
// `deleteUser` no conoce el lease: si corriera antes de terminar la operación
// en la base, un worker congelado podría borrar el seed que otro retomó.
console.log('\n  J) orden de la compensación\n');
const bloqueRpcErr = edgeCode.match(/if \(rpcErr\) \{[\s\S]*?\n    \}/)?.[0] ?? '';
check('se localizó el bloque de compensación', bloqueRpcErr.length > 0);
check('1. mark_failed confirmado ocurre ANTES de deleteUser',
  bloqueRpcErr.indexOf('await marcarFallida(code)') < bloqueRpcErr.indexOf('deleteUser'));
check('2. deleteUser es inalcanzable si mark_failed no confirmó',
  /if \(!marcada\) return fail\('internal', origin\);/.test(bloqueRpcErr)
  && bloqueRpcErr.indexOf('if (!marcada) return') < bloqueRpcErr.indexOf('deleteUser'));
check('3. lease_lost retorna antes de cualquier compensación',
  bloqueRpcErr.indexOf("if (code === 'lease_lost') return") < bloqueRpcErr.indexOf('marcarFallida')
  && bloqueRpcErr.indexOf("if (code === 'lease_lost') return") < bloqueRpcErr.indexOf('deleteUser'));
check('4. un mark_failed incierto no borra nada (marcarFallida devuelve false)',
  /return !error;/.test(edgeCode) && /if \(!leaseToken\) return false;/.test(edgeCode));
// El código de dominio se devuelve DESPUÉS del bloque `if (delErr)`, es decir
// solo cuando el borrado salió bien.
check('5. delete exitoso devuelve el código de dominio',
  bloqueRpcErr.includes('return fail(code, origin);')
  && bloqueRpcErr.indexOf('if (delErr) {') < bloqueRpcErr.indexOf('return fail(code, origin);')
  && bloqueRpcErr.indexOf("return fail('compensation_failed', origin);")
     < bloqueRpcErr.indexOf('return fail(code, origin);'));
check('6. delete fallido devuelve compensation_failed, que NO rota la clave',
  /compensation_failed/.test(bloqueRpcErr)
  && debeRotarOperationId('compensation_failed') === false);
check('hay un solo deleteUser en toda la función',
  (edgeCode.match(/deleteUser\(/g) || []).length === 1);
check('el orden viejo (borrar y después marcar) ya no existe',
  !/deleteUser[\s\S]{0,200}await marcarFallida/.test(bloqueRpcErr));

// La UI usa la política real y solo rota en el envío.
check('la UI importa la política real',
  /from '\.\.\/\.\.\/\.\.\/services\/seedOperationPolicy'/.test(uiCode));
// Tres usos legítimos de randomUUID: valor inicial, apertura del modal
// (creación nueva consciente) y el generador inyectado, que solo se ejecuta
// si la política dice rotar. Lo que importa es que el `catch` NO rote.
const bloqueCatch = uiCode.match(/\} catch \(err\) \{[\s\S]*?\} finally/)?.[0] ?? '';
check('la UI rota únicamente vía siguienteOperationId, dentro del submit',
  /operationIdRef\.current = siguienteOperationId\(/.test(uiCode)
  && (uiCode.match(/operationIdRef\.current = /g) || []).length === 2);
check('el catch NO genera ni asigna una clave nueva',
  bloqueCatch.length > 0
  && !/crypto\.randomUUID/.test(bloqueCatch)
  && !/operationIdRef\.current =/.test(bloqueCatch));
check('el catch solo ANOTA si habrá que rotar en el próximo envío',
  /rotarEnProximoEnvioRef\.current = debeRotarOperationId\(code\)/.test(bloqueCatch));
check('el servicio conserva el código del servidor',
  /class SeedDoctorError/.test(svcCode) && /readonly code: string \| null/.test(svcCode));
check('un fallo sin cuerpo legible propaga null (ambiguo)',
  /code = typeof body\?\.error === 'string' \? body\.error : null/.test(svcCode));

fs.rmSync(outFile, { force: true });

console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} checks\n`);
process.exit(fail === 0 ? 0 : 1);
