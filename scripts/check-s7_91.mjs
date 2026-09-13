#!/usr/bin/env node
/**
 * check-s7_91.mjs — Fundación 3B · paso 2: ubicación emparejada en la aprobación.
 *
 * s7_91 reemplaza el cuerpo de admin_approve_and_create_doctor. Lo que hay que
 * demostrar:
 *   · A/B ESTRUCTURAL: quitando exactamente tres hunks marcados (s7_91), la
 *     definición es byte a byte la de s7_64. Nada más cambió;
 *   · la semántica nueva: el municipio nunca se hereda del lead cuando el
 *     override trae departamento, y el par final se valida;
 *   · que las validaciones nuevas corren después de TODAS las existentes y antes
 *     de la primera escritura, así que no cambian qué error recibe hoy una
 *     solicitud inválida;
 *   · que PRE/POST y rollback anclan por md5 los cuerpos exactos;
 *   · que el smoke A/B ejecuta los MISMOS fragmentos, verbatim, que viven en
 *     s7_64 y en esta migración.
 *
 * El A/B CONDUCTUAL (bug actual vs comportamiento corregido) lo ejecuta el owner
 * en la base con docs/smokes/s7_91_ab_smoke.sql, de solo lectura. Este check
 * garantiza que ese smoke prueba el código real.
 *
 *   node scripts/check-s7_91.mjs
 *
 * No toca la base de datos ni la red.
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else {
    fail++;
    const corto = (v) => { const s = JSON.stringify(v); return s && s.length > 300 ? s.slice(0, 300) + '…' : s; };
    console.log(`  FAIL ${label}\n         esperaba: ${corto(esperado)}\n         obtuvo  : ${corto(actual)}`);
  }
};
const has = (label, hay, needle) => check(label, hay.includes(needle), true);

console.log('\ncheck-s7_91 — Fundación 3B · ubicación emparejada en la aprobación\n');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const crlf = (s) => s.split('\n').join('\r\n');
const P91 = path.join('migrations', 's7_91_geo_foundation_3b_approve_location_pairing.sql');
const P64 = path.join('migrations', 's7_64_credentials_logical_retirement.sql');
const PRB = path.join('docs', 'rollbacks', 's7_91_rollback.sql');
const PSM = path.join('docs', 'smokes', 's7_91_ab_smoke.sql');
const raw = leerLF(P91);
const rawRb = leerLF(PRB);
const rawSm = leerLF(PSM);
const s64 = leerLF(P64);

const sinComentarios = (sql) => sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
const bloque = (s, tag) => {
  const a = s.indexOf(`DO $${tag}$`), b = s.indexOf(`END $${tag}$;`);
  return a === -1 || b === -1 ? '' : s.slice(a, b + `END $${tag}$;`.length);
};
/** La definición completa de la función: desde CREATE OR REPLACE hasta el $$; que la cierra. */
const definicion = (s) => {
  const a = s.indexOf('CREATE OR REPLACE FUNCTION admin_approve_and_create_doctor(');
  if (a === -1) return '';
  const c = s.indexOf('AS $$', a) + 'AS $$'.length;
  const b = s.indexOf('$$;', c);
  return s.slice(a, b + '$$;'.length);
};
const cuerpo = (def) => def.slice(def.indexOf('AS $$') + 'AS $$'.length, def.lastIndexOf('$$;'));

const def64 = definicion(s64);
const def91 = definicion(raw);
const defRb = definicion(rawRb);
const c64 = cuerpo(def64);
const c91 = cuerpo(def91);

// Los tres hunks, extraídos de la migración por sus marcadores.
const entre = (s, desde, hasta) => {
  const a = s.indexOf(desde); if (a === -1) return '';
  const b = s.indexOf(hasta, a); return b === -1 ? '' : s.slice(a, b);
};
// El hunk 1 termina en su propia última declaración: en DECLARE le sigue otra
// variable sin línea en blanco, y cortar «hasta la línea en blanco» se llevaba
// v_override_email (lo destapó el propio A/B).
const H1_FIN = '  v_ov_muni_id        text;\n';
const H1 = (() => { const t = entre(def91, '  -- (s7_91) override territorial crudo', H1_FIN); return t ? t + H1_FIN : ''; })();
const H2 = (() => { const t = entre(def91, '  -- (s7_91) Ubicacion EMPAREJADA', '\n  END IF;\n'); return t ? t + '\n  END IF;\n' : ''; })();
const H3 = entre(def91, '  -- ─── (s7_91) Validar la ubicacion final', '  -- ─── Resolver el profile');
const RESOL_64 = "  v_dept_id := COALESCE(NULLIF(p_overrides->>'department_id', ''), v_lead.department_id);\n"
               + "  v_muni_id := COALESCE(NULLIF(p_overrides->>'municipality_id', ''), v_lead.municipality_id);\n";

// ═══════════════════════════════════════════════════════════
// 0 · ATOMICIDAD Y ORDEN
// ═══════════════════════════════════════════════════════════
console.log('0 · atomicidad y orden');
const exe = sinComentarios(raw);
const pos = (n) => exe.indexOf(n);
check('exactamente un BEGIN;', (exe.match(/^BEGIN;/gm) || []).length, 1);
check('exactamente un COMMIT;', (exe.match(/^COMMIT;/gm) || []).length, 1);
check('el PRE queda FUERA de la transacción', pos('DO $PRE$') > -1 && pos('END $PRE$;') < pos('BEGIN;'), true);
check('orden: BEGIN → GUARDA → CREATE OR REPLACE → POST → COMMIT',
  pos('BEGIN;') < pos('DO $GUARDA$') && pos('END $GUARDA$;') < pos('CREATE OR REPLACE FUNCTION')
  && pos('CREATE OR REPLACE FUNCTION') < pos('DO $POST$') && pos('END $POST$;') < pos('COMMIT;'), true);
check('nada ejecutable después del COMMIT', exe.slice(pos('COMMIT;') + 'COMMIT;'.length).trim(), '');

// ═══════════════════════════════════════════════════════════
// 1 · A/B ESTRUCTURAL CONTRA s7_64
// ═══════════════════════════════════════════════════════════
console.log('\n1 · A/B estructural contra s7_64');
check('los tres hunks se extraen', [H1, H2, H3].every((h) => h.length > 40), true);
check('la definición lleva exactamente 3 marcadores (s7_91)', (def91.match(/\(s7_91\)/g) || []).length, 3);
const revertida = def91.split(H1).join('').split(H2).join(RESOL_64).split(H3).join('');
check('quitando los 3 hunks, la definición es BYTE A BYTE la de s7_64', revertida, def64);
check('cabecera de la función (firma, retorno, DEFINER, search_path) idéntica a s7_64',
  def91.slice(0, def91.indexOf('AS $$')), def64.slice(0, def64.indexOf('AS $$')));
check('cada hunk aparece una sola vez', [H1, H2, H3].map((h) => def91.split(h).length - 1).join(','), '1,1,1');
check('el hunk 2 sustituye EXACTAMENTE las dos líneas COALESCE de s7_64', def64.split(RESOL_64).length - 1, 1);

// ═══════════════════════════════════════════════════════════
// 2 · SEMÁNTICA NUEVA
// ═══════════════════════════════════════════════════════════
console.log('\n2 · semántica');
const ex91 = sinComentarios(c91);
check('ya no hay COALESCE entre override y lead para la ubicación',
  /COALESCE\(NULLIF\(p_overrides->>'(department_id|municipality_id)'/.test(ex91), false);
has('override crudo de departamento', H2, "v_ov_dept_id := NULLIF(p_overrides->>'department_id', '');");
has('override crudo de municipio', H2, "v_ov_muni_id := NULLIF(p_overrides->>'municipality_id', '');");
has('reglas 2-4: con departamento de override, el municipio sale SOLO del override',
  H2, '  IF v_ov_dept_id IS NOT NULL THEN\n    v_dept_id := v_ov_dept_id;\n    v_muni_id := v_ov_muni_id;\n  ELSE');
has('regla 1: sin departamento de override, el par completo del lead',
  H2, '  ELSE\n    v_dept_id := v_lead.department_id;\n    v_muni_id := v_lead.municipality_id;\n  END IF;');
check('el municipio del lead solo se usa en la rama sin departamento de override',
  (ex91.match(/v_lead\.municipality_id/g) || []).length, 1);
has('regla 5: override con municipio y sin departamento → P0024', H3,
  "  IF v_ov_muni_id IS NOT NULL AND v_ov_dept_id IS NULL THEN\n    RAISE EXCEPTION 'El override trae municipio sin departamento' USING ERRCODE = 'P0024';");
has('regla 5: par final con municipio y sin departamento → P0024', H3,
  "  IF v_muni_id IS NOT NULL AND v_dept_id IS NULL THEN\n    RAISE EXCEPTION 'El municipio no puede quedar sin departamento' USING ERRCODE = 'P0024';");
has('regla 6: validación relacional municipality.department_id = department_id → P0025', H3,
  "    PERFORM 1 FROM municipalities WHERE id = v_muni_id AND department_id = v_dept_id;\n    IF NOT FOUND THEN\n      RAISE EXCEPTION 'El municipio no existe o no pertenece al departamento indicado' USING ERRCODE = 'P0025';");
check('los códigos nuevos solo aparecen en el hunk 3',
  (c91.match(/P002[45]/g) || []).length === (H3.match(/P002[45]/g) || []).length && /P0024/.test(H3) && /P0025/.test(H3), true);
check('P0024/P0025 no se usan en ninguna otra migración',
  fs.readdirSync('migrations').filter((f) => f !== path.basename(P91) && /P002[45]/.test(leerLF(path.join('migrations', f)))).join(','), '');

// ═══════════════════════════════════════════════════════════
// 3 · COLOCACIÓN: DESPUÉS DE TODAS LAS VALIDACIONES, ANTES DE ESCRIBIR
// ═══════════════════════════════════════════════════════════
console.log('\n3 · colocación');
const p = (n) => c91.indexOf(n);
const pH2 = p(H2), pH3 = p(H3);
for (const [n, marca] of [
  ['gate is_admin (42501)', "USING ERRCODE = '42501'"], ['lead no encontrado (P0001)', "USING ERRCODE = 'P0001'"],
  ['estado approved (P0002)', "ERRCODE = 'P0002'"], ['ya vinculada (P0003)', "ERRCODE = 'P0003'"],
  ['email (P0005)', "ERRCODE = 'P0005'"], ['especialidad (P0004)', "ERRCODE = 'P0004'"],
  ['block_doctor (P0010)', "ERRCODE = 'P0010'"], ['block_sensitive (P0011)', "ERRCODE = 'P0011'"],
  ['identidad (P0012)', "ERRCODE = 'P0012'"], ['confirmación de reuso (P0013)', "ERRCODE = 'P0013'"],
]) check(`la validación nueva va DESPUÉS de ${n}`, p(marca) > -1 && p(marca) < pH3, true);
for (const [n, marca] of [['UPDATE profiles', 'UPDATE profiles'], ['INSERT INTO auth.users', 'INSERT INTO auth.users'],
  ['INSERT INTO profiles', 'INSERT INTO profiles'], ['INSERT INTO clinics', 'INSERT INTO clinics']]) {
  check(`la validación nueva va ANTES de ${n}`, p(marca) > pH3, true);
}
check('la resolución (hunk 2) va antes de la validación (hunk 3)', pH2 > -1 && pH2 < pH3, true);
const tramo = sinComentarios(c91.slice(pH2 + H2.length, pH3));
check('entre resolución y validación nadie reasigna la ubicación',
  /\b(v_dept_id|v_muni_id|v_ov_dept_id|v_ov_muni_id)\s*:=/.test(tramo), false);
const tras = sinComentarios(c91.slice(pH3 + H3.length));
check('después de validar, la ubicación solo se lee (INSERT de clinics)',
  /\b(v_dept_id|v_muni_id)\s*:=/.test(tras), false);
has('el INSERT de clinics sigue usando v_dept_id y v_muni_id', tras, 'v_profile_id, true, v_dept_id, v_muni_id');

// ═══════════════════════════════════════════════════════════
// 4 · ALCANCE
// ═══════════════════════════════════════════════════════════
console.log('\n4 · alcance');
const fuera = sinLiterales(sinComentarios(raw.split(def91).join('')));
check('una sola función creada o reemplazada', (sinComentarios(raw).match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/gi) || []).length, 1);
for (const [n, re] of [['GRANT', /\bGRANT\b/i], ['REVOKE', /\bREVOKE\b/i], ['ALTER', /\bALTER\b/i],
  ['DROP', /\bDROP\b/i], ['CREATE TABLE', /CREATE\s+TABLE/i], ['TRIGGER', /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i],
  ['POLICY', /\bPOLICY\b/i], ['INSERT', /\bINSERT\s+INTO\b/i], ['UPDATE', /\bUPDATE\s+\w/i], ['DELETE', /\bDELETE\s+FROM\b/i]]) {
  check(`fuera de la función: sin ${n}`, re.test(fuera), false);
}
check('la función no menciona country_id ni territory_unit_id', /\b(country_id|territory_unit_id)\b/.test(c91), false);
check('la función no toca administrative_units ni countries', /\b(administrative_units|countries)\b/.test(c91), false);
check('regla del 2026-09-13: ningún $ en comentarios (migración, rollback, smoke)',
  [raw, rawRb, rawSm].map((s) => s.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length).join(','), '0,0,0');

// ═══════════════════════════════════════════════════════════
// 5 · PRE / GUARDA / POST
// ═══════════════════════════════════════════════════════════
console.log('\n5 · PRE, GUARDA y POST');
const pre = bloque(raw, 'PRE'), guarda = bloque(raw, 'GUARDA'), post = bloque(raw, 'POST');
const M64 = [md5(c64), md5(crlf(c64))], M91 = [md5(c91), md5(crlf(c91))];
check('los md5 de s7_64 son los medidos en vivo en F3A (CRLF = 73ffe497…)', M64[1], '73ffe4972c87e3ca580a8e40778d1328');
has('PRE exige el cuerpo vivo = s7_64 (LF o CRLF)', pre, `IN ('${M64[0]}', '${M64[1]}')`);
has('GUARDA re-exige el cuerpo vivo = s7_64', guarda, `IN ('${M64[0]}', '${M64[1]}')`);
has('POST exige el cuerpo vivo = s7_91 (LF o CRLF)', post, `IN ('${M91[0]}', '${M91[1]}')`);
has('PRE: una sola definición', pre, 'esperaba 1 definicion');
has('PRE: firma exacta', pre, "'p_request_id uuid, p_overrides jsonb'");
has('PRE: retorno jsonb', pre, "r.retorno IS DISTINCT FROM 'jsonb'");
has('PRE: SECURITY DEFINER', pre, 'deberia ser SECURITY DEFINER');
has('PRE: search_path', pre, "'search_path=public,auth'");
has('PRE: P0024/P0025 libres', pre, "prosrc ~ 'P002[45]'");
has('PRE: s7_90 aplicada', pre, "name = 'San Miguel de Mercedes'");
has('PRE: guarda F3A en pie', pre, 'clinics_geo_f3a_temp_null_chk');
for (const s of ['acl', 'dueno', 'otras_funciones']) has(`GUARDA toma la huella ${s}`, guarda, `set_config('s7_91.${s}'`);
has('POST: privilegios idénticos', post, "r.acl IS DISTINCT FROM current_setting('s7_91.acl')");
has('POST: dueño idéntico', post, "current_setting('s7_91.dueno')");
has('POST: ninguna otra función cambió', post, "current_setting('s7_91.otras_funciones')");
has('POST: firma, retorno, DEFINER y search_path', post, 'cambio la firma, el retorno, SECURITY DEFINER o el search_path');
has('POST: sin sobrecarga nueva', post, 'sobrecarga nueva');
has('POST: guarda F3A en pie', post, 'clinics_geo_f3a_temp_null_chk');
has('POST: columnas territoriales nuevas vacías', post, 'country_id IS NOT NULL OR territory_unit_id IS NOT NULL');
has('POST: sin trigger nuevo en clinics', post, "tgname <> 'trg_clinics_updated_at'");

// ═══════════════════════════════════════════════════════════
// 6 · ROLLBACK
// ═══════════════════════════════════════════════════════════
console.log('\n6 · rollback');
const exRb = sinComentarios(rawRb);
const pr = (n) => exRb.indexOf(n);
check('atómico: un BEGIN; y un COMMIT;', `${(exRb.match(/^BEGIN;/gm) || []).length},${(exRb.match(/^COMMIT;/gm) || []).length}`, '1,1');
check('orden: BEGIN → PREVIA → CREATE OR REPLACE → verificación → COMMIT',
  pr('BEGIN;') < pr('DO $PREVIA$') && pr('END $PREVIA$;') < pr('CREATE OR REPLACE FUNCTION')
  && pr('CREATE OR REPLACE FUNCTION') < pr('DO $ROLLBACK$') && pr('END $ROLLBACK$;') < pr('COMMIT;'), true);
check('restaura la definición BYTE A BYTE de s7_64', defRb, def64);
has('solo revierte si el cuerpo vivo es el de s7_91', bloque(rawRb, 'PREVIA'), `IN ('${M91[0]}', '${M91[1]}')`);
has('verifica que el cuerpo restaurado es el de s7_64', bloque(rawRb, 'ROLLBACK'), `IN ('${M64[0]}', '${M64[1]}')`);
has('verifica privilegios intactos', bloque(rawRb, 'ROLLBACK'), "current_setting('s7_91rb.acl')");
check('sin GRANT ni REVOKE', /\b(GRANT|REVOKE)\b/i.test(sinLiterales(exRb.split(defRb).join(''))), false);

// ═══════════════════════════════════════════════════════════
// 7 · SMOKE A/B: PRUEBA EL CÓDIGO REAL
// ═══════════════════════════════════════════════════════════
console.log('\n7 · smoke A/B');
const ab = bloque(rawSm, 'AB');
check('el smoke es un único bloque DO', sinComentarios(rawSm).trim(), sinComentarios(ab).trim());
const tramoA = entre(ab, '    -- ── A · fragmento ACTUAL', '    -- ── B · fragmento CORREGIDO');
const tramoB = entre(ab, '    -- ── B · fragmento CORREGIDO', '    IF v_actual IS DISTINCT FROM');
check('el fragmento ACTUAL del smoke es VERBATIM el de s7_64 (L147-L148)', tramoA.includes('    BEGIN\n' + RESOL_64 + '      v_actual :='), true);
check('el fragmento CORREGIDO del smoke es VERBATIM hunk 2 + hunk 3 de s7_91',
  tramoB.includes('    BEGIN\n' + H2 + H3 + '      v_corregido :='), true);
check('el smoke no escribe ni crea nada',
  /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s|ALTER\s|DROP\s|GRANT\s|TRUNCATE)\b/i.test(sinLiterales(sinComentarios(rawSm))), false);
check('el smoke no llama a la función real', /admin_approve_and_create_doctor\s*\(/.test(sinComentarios(rawSm)), false);
check('matriz de 14 casos', (ab.match(/^\s+\((\d+),\s+'/gm) || []).length, 14);
has('A/B: el ACTUAL debe producir 7 pares incoherentes', ab, 'IF v_incoh_actual <> 7 THEN');
has('A/B: el CORREGIDO debe producir 0', ab, 'IF v_incoh_corr <> 0 THEN');
has('el bug está en la matriz: override de departamento con municipio omitido', ab,
  "'BUG · override de departamento, municipio omitido', 'CH',   'CH-16',    '{\"department_id\":\"@D2@\"}',                      '@D2@|CH-16',     '@D2@|NULL'");
has('falla visible si algo no cuadra', ab, "RAISE EXCEPTION 'SMOKE s7_91 FAIL:%', v_fallos;");

// ═══════════════════════════════════════════════════════════
// 8 · MUTACIÓN CON EXPECTATIVA INVERTIDA
// ═══════════════════════════════════════════════════════════
const R = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutación sin ancla: ${a.slice(0, 60)}`); return s.split(a).join(b); };
const reglas = {
  abEstructural: (s) => { const d = definicion(s); const t1 = entre(d, '  -- (s7_91) override territorial crudo', H1_FIN); const h1 = t1 ? t1 + H1_FIN : ' ';
    const t2 = entre(d, '  -- (s7_91) Ubicacion EMPAREJADA', '\n  END IF;\n'); const h2 = t2 ? t2 + '\n  END IF;\n' : ' ';
    const h3 = entre(d, '  -- ─── (s7_91) Validar la ubicacion final', '  -- ─── Resolver el profile') || ' ';
    return d.split(h1).join('').split(h2).join(RESOL_64).split(h3).join('') === def64; },
  sinHerenciaLead: (s) => (sinComentarios(cuerpo(definicion(s))).match(/v_lead\.municipality_id/g) || []).length === 1
    && !/COALESCE\(NULLIF\(p_overrides->>'municipality_id'/.test(sinComentarios(cuerpo(definicion(s)))),
  relacional: (s) => cuerpo(definicion(s)).includes('WHERE id = v_muni_id AND department_id = v_dept_id'),
  validacionTarde: (s) => { const c = cuerpo(definicion(s)); const v = c.indexOf('  -- ─── (s7_91) Validar la ubicacion final'); return v > c.indexOf("ERRCODE = 'P0013'") && v < c.indexOf('UPDATE profiles'); },
  md5Pre: (s) => bloque(s, 'PRE').includes(`IN ('${M64[0]}', '${M64[1]}')`),
  aclPost: (s) => bloque(s, 'POST').includes("r.acl IS DISTINCT FROM current_setting('s7_91.acl')"),
  sinGrant: (s) => !/\bGRANT\b/i.test(sinLiterales(sinComentarios(s.split(definicion(s)).join('')))),
  overrideSinDept: (s) => cuerpo(definicion(s)).includes('IF v_ov_muni_id IS NOT NULL AND v_ov_dept_id IS NULL THEN'),
  sinDolar: (s) => s.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length === 0,
};
const mutaciones = [
  ['heredar otra vez el municipio del lead', 'sinHerenciaLead', (s) => R(s, '    v_muni_id := v_ov_muni_id;', '    v_muni_id := COALESCE(v_ov_muni_id, v_lead.municipality_id);')],
  ['quitar la validación relacional', 'relacional', (s) => R(s, 'WHERE id = v_muni_id AND department_id = v_dept_id', 'WHERE id = v_muni_id')],
  ['validar ANTES de la clasificación', 'validacionTarde', (s) => { const d = definicion(s); const h3 = entre(d, '  -- ─── (s7_91) Validar la ubicacion final', '  -- ─── Resolver el profile');
    return R(R(s, h3, ''), '  -- ─── Clasificación (misma fuente que preflight) ───', h3 + '  -- ─── Clasificación (misma fuente que preflight) ───'); }],
  ['un cambio fuera de los hunks', 'abEstructural', (s) => R(s, "'listed_only'::lucy_status, false, false, false", "'listed_only'::lucy_status, true, false, false")],
  ['PRE sin anclar el cuerpo de s7_64', 'md5Pre', (s) => s.replace(bloque(s, 'PRE'), R(bloque(s, 'PRE'), M64[1], '00000000000000000000000000000000'))],
  ['POST sin comparar privilegios', 'aclPost', (s) => R(s, "IF r.acl IS DISTINCT FROM current_setting('s7_91.acl') THEN", 'IF false THEN')],
  ['un GRANT fuera de la función', 'sinGrant', (s) => R(s, '\nCOMMIT;\n', '\nGRANT EXECUTE ON FUNCTION admin_approve_and_create_doctor(uuid, jsonb) TO anon;\nCOMMIT;\n')],
  ['aceptar municipio de override sin departamento', 'overrideSinDept', (s) => R(s, 'IF v_ov_muni_id IS NOT NULL AND v_ov_dept_id IS NULL THEN', 'IF false THEN')],
  ['una etiqueta $…$ en un comentario', 'sinDolar', (s) => R(s, '-- Si el PASO 1 lanza excepcion, NO continuar.', '-- Pegar desde DO $PRE$. Si el PASO 1 lanza excepcion, NO continuar.')],
];
console.log('\n8 · reglas sobre la migración real (control)');
for (const [, regla] of mutaciones) check(`la migración cumple ${regla}`, reglas[regla](raw), true);
console.log('\n8.b · mutación con expectativa INVERTIDA');
for (const [nombre, regla, mut] of mutaciones) {
  let r;
  try { r = reglas[regla](mut(raw)); } catch (e) { r = e.message; }
  check(`detecta: ${nombre}`, r, false);
}
{
  let r;
  try { r = entre(bloque(R(rawSm, '  v_muni_id := COALESCE(NULLIF(p_overrides->>\'municipality_id\', \'\'), v_lead.municipality_id);\n      v_actual',
    '  v_muni_id := NULLIF(p_overrides->>\'municipality_id\', \'\');\n      v_actual'), 'AB'), '    -- ── A · fragmento ACTUAL', '    -- ── B · fragmento CORREGIDO').includes('    BEGIN\n' + RESOL_64 + '      v_actual :='); }
  catch (e) { r = e.message; }
  check('detecta: un smoke cuyo fragmento ACTUAL no es el de s7_64', r, false);
}
{
  let r;
  try { const m = R(rawRb, "'listed_only'::lucy_status, false, false, false", "'listed_only'::lucy_status, true, false, false"); r = definicion(m) === def64; }
  catch (e) { r = e.message; }
  check('detecta: un rollback que no restaura exactamente s7_64', r, false);
}

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
