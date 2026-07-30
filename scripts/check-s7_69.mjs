/**
 * check-s7_69.mjs — verificación ESTÁTICA de la migración s7_69
 * (otp_consent_events + record_otp_consent). AUTH-P1D2.
 *
 *   node scripts/check-s7_69.mjs
 *
 * Lee migrations/s7_69_otp_consent_events.sql (sin DB, sin service_role).
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const check = (desc, got, expected = true) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok ? '' : ` → ${JSON.stringify(got)} (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};
const src = fs.readFileSync('migrations/s7_69_otp_consent_events.sql', 'utf8');
// SQL EJECUTABLE (sin líneas de comentario `--`): las prohibiciones de contenido
// y de alcance se evalúan sobre lo que realmente corre, no sobre la
// documentación de la migración (que sí nombra lo prohibido para explicarlo).
const sql = src.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const between = (s, a, b) => { const i = s.indexOf(a); const j = b ? s.indexOf(b, i + 1) : s.length; return i < 0 ? '' : s.slice(i, j < 0 ? s.length : j); };
const HASH = '86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692';
/** Hash del copy legal ANTERIOR (descartado): no debe quedar en la migración. */
const OLD_HASH = '378f1365ccfe53c660264d9a46ce37572d78e9a6f5beda79c8e16adfe3e48ba7';

console.log('\ncheck-s7_69 — otp_consent_events + record_otp_consent\n');

// ─── Tabla append-only + columnas mínimas ───
check('CREATE TABLE otp_consent_events', /CREATE TABLE IF NOT EXISTS public\.otp_consent_events/.test(src));
for (const col of ['id', 'phone_e164', 'context', 'consent_version', 'consent_text_hash', 'request_id', 'created_at']) {
  check(`columna ${col}`, new RegExp(`\\b${col}\\b`).test(src));
}
// ─── Constraints exactas ───
check('CHECK teléfono SV +503 + 8 díg', /CHECK \(phone_e164 ~ '\^\\\+503\[0-9\]\{8\}\$'\)/.test(src));
check("CHECK context IN ('login','booking','claim')", /context IN \('login','booking','claim'\)/.test(src));
check("CHECK version = 'otp-consent-v1'", /consent_version = 'otp-consent-v1'/.test(src));
check('CHECK hash exacto (texto visible)', src.includes(`consent_text_hash = '${HASH}'`));
check('sin rastro del hash anterior en la migración', src.includes(OLD_HASH) === false);
check('sin el texto legal anterior en la migración', /cargos de tu operador/.test(src) === false);
check('UNIQUE index request_id (idempotencia)', /CREATE UNIQUE INDEX[^\n]*otp_consent_request_id_uniq[\s\S]*\(request_id\)/.test(src));
check('índice por teléfono+tiempo', /idx_otp_consent_phone_time/.test(src));

// ─── RLS + sin acceso directo anon/authenticated ───
check('RLS habilitado', /ALTER TABLE public\.otp_consent_events ENABLE ROW LEVEL SECURITY/.test(src));
check('REVOKE ALL a anon', /REVOKE ALL ON public\.otp_consent_events FROM anon/.test(src));
check('REVOKE ALL a authenticated', /REVOKE ALL ON public\.otp_consent_events FROM authenticated/.test(src));
check('sin policy (no SELECT/DML directo anon)', /CREATE POLICY/.test(src) === false);
check('sin GRANT SELECT/INSERT a anon en la tabla', /GRANT[^\n]*ON public\.otp_consent_events TO anon/.test(src) === false);

// ─── RPC ───
check('RPC record_otp_consent', /CREATE OR REPLACE FUNCTION public\.record_otp_consent/.test(src));
check('SECURITY DEFINER', /SECURITY DEFINER/.test(src));
check('search_path fijo', /SET search_path = pg_catalog, public, pg_temp/.test(src));
check('GRANT EXECUTE a anon', /GRANT EXECUTE ON FUNCTION public\.record_otp_consent\([^)]*\) TO anon/.test(src));
check('valida teléfono SV en la RPC', /p_phone !~ '\^\\\+503\[0-9\]\{8\}\$'/.test(src));
check('valida contexto en la RPC', /p_context NOT IN \('login','booking','claim'\)/.test(src));
check('valida versión+hash en la RPC', /'otp-consent-v1'/.test(src) && src.includes(HASH));
check('dedup/límite por teléfono+ventana', /now\(\) - interval '10 minutes'/.test(src) && /too_many_requests/.test(src));
check('append-only idempotente (ON CONFLICT DO NOTHING)', /ON CONFLICT \(request_id\) DO NOTHING/.test(src));
check('errores genéricos (invalid_request)', /RAISE EXCEPTION 'invalid_request'/.test(src));

// ─── Idempotencia SEGURA por request_id (4 campos) ───
{
  const body = between(sql, 'CREATE OR REPLACE FUNCTION public.record_otp_consent', 'REVOKE ALL ON FUNCTION');
  check('declara v_existing con %ROWTYPE (no `record`)',
    /v_existing\s+public\.otp_consent_events%ROWTYPE/.test(body));
  check('lookup previo por request_id',
    /SELECT \* INTO v_existing[\s\S]{0,120}?WHERE e\.request_id = p_request_id/.test(body));
  // (1) mismo request_id + mismo payload → éxito idempotente, sin insertar.
  check('compara los 4 campos (teléfono, contexto, versión, hash)',
    /v_existing\.phone_e164\s*=\s*p_phone/.test(body) &&
    /v_existing\.context\s*=\s*p_context/.test(body) &&
    /v_existing\.consent_version\s*=\s*p_consent_version/.test(body) &&
    /v_existing\.consent_text_hash\s*=\s*p_consent_text_hash/.test(body));
  check('coincidencia exacta → RETURN sin insertar (idempotente)',
    /THEN\s*(--[^\n]*\n\s*)*RETURN;/.test(body));
  // (2)(3) mismo request_id + cualquier campo distinto → invalid_request, sin insertar.
  check('cualquier diferencia → invalid_request',
    /IF FOUND THEN[\s\S]*?RAISE EXCEPTION 'invalid_request'[\s\S]*?END IF;/.test(body));
  // (4) el reintento idempotente NO vuelve a consumir el límite.
  check('el límite se evalúa DESPUÉS del lookup (solo request_id nuevo)',
    body.indexOf('WHERE e.request_id = p_request_id') < body.indexOf("interval '10 minutes'"), true);
  // Carrera: releer y validar antes de dar éxito.
  check('conflicto concurrente: GET DIAGNOSTICS + relectura',
    /GET DIAGNOSTICS v_rows = ROW_COUNT/.test(body) &&
    /IF v_rows = 0 THEN[\s\S]*?SELECT \* INTO v_existing/.test(body));
  check('carrera: éxito solo si coincide exactamente',
    /IF NOT FOUND[\s\S]*?<>\s*p_phone[\s\S]*?<>\s*p_context[\s\S]*?<>\s*p_consent_version[\s\S]*?<>\s*p_consent_text_hash[\s\S]*?RAISE EXCEPTION 'invalid_request'/.test(body));
  check('el error no revela qué campo difiere',
    /invalid_request[^\n]*p_phone|invalid_request[^\n]*campo/.test(body) === false);

  // ─── Serialización atómica por teléfono (advisory lock transaccional) ───
  check('usa pg_advisory_xact_lock (lock transaccional, sin tabla de locks)',
    /pg_advisory_xact_lock\(/.test(body));
  check('la clave del lock deriva del TELÉFONO (teléfonos distintos no se bloquean)',
    /pg_advisory_xact_lock\(hashtextextended\('otp_consent:' \|\| p_phone, 0\)\)/.test(body));
  check('sin tabla de locks ni estado persistente', /locks?_table|FOR UPDATE/.test(body) === false);
  const iLock = body.indexOf('pg_advisory_xact_lock(');
  const iCount = body.indexOf("interval '10 minutes'");
  const iInsert = body.indexOf('INSERT INTO public.otp_consent_events');
  const iFirstLookup = body.indexOf('WHERE e.request_id = p_request_id');
  check('lookup idempotente ANTES del lock (reintento exacto no toma lock)',
    iFirstLookup >= 0 && iFirstLookup < iLock, true);
  check('el lock ocurre ANTES del conteo del límite', iLock < iCount, true);
  check('el lock ocurre ANTES de la inserción', iLock < iInsert, true);
  check('doble comprobación del request_id BAJO el lock',
    body.indexOf('WHERE e.request_id = p_request_id', iLock) > iLock &&
    body.indexOf('WHERE e.request_id = p_request_id', iLock) < iCount, true);
}

// ─── Smoke transaccional preparado (sin ejecutar) ───
{
  // El SQL del owner se versiona como doc (convención docs/OWNER_*.md; los
  // .sql sueltos están gitignored salvo migrations/).
  const smokeDoc = fs.readFileSync('docs/OWNER_S7_69_SMOKE.md', 'utf8');
  // Solo el BLOQUE SQL del doc (la prosa del encabezado nombra lo prohibido
  // justamente para prohibirlo).
  const smoke = (smokeDoc.match(/```sql\n([\s\S]*?)```/) || [, ''])[1];
  // SQL ejecutable del smoke (sin comentarios), igual criterio que la migración.
  const smokeSql = smoke.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  check('smoke abre con BEGIN', /^BEGIN;/m.test(smoke));
  check('smoke termina con ROLLBACK', /^ROLLBACK;/m.test(smoke));
  check('smoke SIN COMMIT', /^COMMIT;/m.test(smokeSql) === false);
  check('smoke sin service_role (SQL real)', /service_role/.test(smokeSql) === false);
  check('smoke con salida única consolidada', (smoke.match(/^SELECT case_name/gm) || []).length, 1);
  check('smoke usa tabla temporal ON COMMIT DROP', /CREATE TEMP TABLE[\s\S]*ON COMMIT DROP/.test(smoke));
  // Los 10 casos requeridos.
  for (const c of ['1_primer_registro', '2_idempotente_exacto', '3_rid_reusado_otro_telefono',
                   '4_diez_permitidas', '5_onceava_bloqueada', '6_idempotente_pese_al_limite',
                   '7a_telefono_no_sv', '8_', '9_', '10_pre_rollback']) {
    check(`smoke cubre el caso ${c}`, smoke.includes(c));
  }
  check('smoke usa fixtures sintéticas (+503 7006 99xx)', /\+50370069901/.test(smoke));
  check('smoke NO usa números reales (Katherine/Camilo)',
    /50372608827|50378627694/.test(smokeSql) === false);
  // Balance de dollar-quoting del bloque DO.
  check('dollar-quoting balanceado ($smoke$)', (smoke.match(/\$smoke\$/g) || []).length % 2, 0);
}

// ─── No guarda datos prohibidos ───
check('no guarda OTP/captcha/ip/user-agent (SQL real)', /\b(otp_code|captcha|ip_address|user_agent)\b/i.test(sql) === false);

// ─── Additive-only (sobre el SQL real) ───
check('sin DROP TABLE (SQL real)', /DROP\s+TABLE/i.test(sql) === false);
check('el único ALTER TABLE es sobre otp_consent_events (RLS)',
  (sql.match(/ALTER\s+TABLE\s+\S+/gi) || []).every((m) => /otp_consent_events/i.test(m)));
check('sin purga automática (sin DELETE/cron)', /DELETE\s+FROM|pg_cron|cron\.schedule/i.test(sql) === false);
check('sin service_role fuera de GRANT explícito', /SET ROLE|service_role\b[^;]*LOGIN/.test(sql) === false);

console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_69: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
