#!/usr/bin/env node
/**
 * check-s7_93.mjs — Fundación 3C: backfill histórico de clinics.country_id / territory_unit_id.
 *
 * s7_93 rellena la geo de exactamente 23 clínicas históricas medidas en el
 * preflight v2 de producción (2026-09-14). Lo que hay que demostrar sin tocar la base:
 *   · C2: la huella C39 y la lista C39.5 incrustadas son EXACTAMENTE las del
 *     preflight, idénticas en PRE, GUARDA y rollback, con la misma expresión;
 *   · el orden de la transacción: lock al inicio, GUARDA, desactivar SOLO el
 *     trigger de updated_at, backfill, restaurarlo, POST, COMMIT;
 *   · C1: trg_clinics_territory_sync nunca se desactiva en la migración;
 *   · el UPDATE toca solo los ids de la lista, con su legacy y geo NULL, toma la
 *     geo EXCLUSIVAMENTE del resolver vivo y exige exactamente 23 filas;
 *   · el POST cubre 96 / 23 / 0 pendientes / 0 divergencias / 0 nivel 2 y la
 *     huella de todas las columnas distintas de la geo;
 *   · C3 · R2: el rollback se limita a la misma lista, verifica cada fila antes
 *     de tocarla, desactiva ambos triggers solo durante el vaciado y los restaura
 *     antes de verificar y comitear;
 *   · mutaciones con expectativa INVERTIDA: cada regla detecta su violación.
 *
 *   node scripts/check-s7_93.mjs
 *
 * No toca la base de datos ni la red.
 */
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

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

console.log('\ncheck-s7_93 — Fundación 3C · backfill histórico de clinics\n');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const P93 = path.join('migrations', 's7_93_geo_foundation_3c_clinics_backfill.sql');
const PRB = path.join('docs', 'rollbacks', 's7_93_rollback.sql');
const raw = leerLF(P93);
const rawRb = leerLF(PRB);

const sinComentarios = (sql) => sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
const bloque = (s, tag) => {
  const a = s.indexOf(`DO $${tag}$`), b = s.indexOf(`END $${tag}$;`);
  return a === -1 || b === -1 ? '' : s.slice(a, b + `END $${tag}$;`.length);
};
const ocurrencias = (s, needle) => s.split(needle).length - 1;
const sinDolarEnComentarios = (s) => s.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length === 0;
const RE_DDL_TEXTO = /\b(create|drop)\s+(temp(orary)?\s+)?(table|view|function|trigger|index)\b/i;

// ── Constantes medidas en el preflight v2 de producción (2026-09-14, Z = 0) ──
const HUELLA_C39 = '63a5e35b49e91f904df565b2d1717475';
const LISTA_C395 = [
  '220fbc6a-91f9-4098-95ab-55cef178dd80|SO|SO-06', '30baca1a-09aa-47d2-9918-ca4b0def6554|LP|LP-15',
  '8319a5ed-1fde-451b-a572-d151c22e6616|SS|SS-12', '8b24611d-6b7d-4f2c-bbf5-ec53f5c4bded|LI|LI-21',
  '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0|SS|SS-12', 'a83a625b-527b-423d-8088-1d79ef494013|SS|SS-12',
  'c0000001-0000-0000-0000-000000000001|SS|SS-12', 'c0000001-0000-0000-0000-000000000002|SA|SA-05',
  'c0000001-0000-0000-0000-000000000003|SS|SS-12', 'c0000001-0000-0000-0000-000000000004|SS|SS-12',
  'c0000001-0000-0000-0000-000000000005|SM|SM-09', 'c0000001-0000-0000-0000-000000000006|SS|SS-12',
  'c0000001-0000-0000-0000-000000000007|SS|SS-12', 'c0000001-0000-0000-0000-000000000008|LI|LI-21',
  'c0000001-0000-0000-0000-000000000009|SS|SS-12', 'c0000001-0000-0000-0000-000000000010|SS|SS-12',
  'c0000001-0000-0000-0000-000000000011|LI|LI-11', 'c0000001-0000-0000-0000-000000000012|SS|SS-12',
  'c3983794-0963-47f4-aea7-c5ec636555b4|SS|SS-12', 'c5061c92-8e19-4244-870f-7d738e5b6fa1|SO|SO-07',
  'cc53c91f-af6f-4873-b7bf-61db7be4306d|SS|SS-12', 'e5d0b444-8fc9-42fa-bfb1-b83b4d057d76|SS|SS-12',
  'f7882a4c-69aa-48fc-aa0b-9d7e2192ec0d|SS|SS-12',
].join(' ; ');
// Expresiones de las filas C39 y C39.5 del preflight v2, a nivel de fila.
const EXPR_HUELLA = "c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|' ||\n           coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'),\n           E'\\n' ORDER BY c.id), ''))";
const EXPR_LISTA = "string_agg(c.id::text || '|' || c.department_id || '|' || coalesce(c.municipality_id, 'NULL'), ' ; ' ORDER BY c.id), '(ninguna)')";

// Literal v_lista de un bloque: concatenación de literales adyacentes.
const listaDe = (b) => {
  const a = b.indexOf('v_lista CONSTANT text :=');
  if (a === -1) return null;
  const fin = b.indexOf("';", a);
  return [...b.slice(a, fin + 2).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).join('');
};
const huellaDe = (b) => { const m = b.match(/v_huella CONSTANT text := '([0-9a-f]{32})';/); return m ? m[1] : null; };

// ═══════════════════════════════════════════════════════════
// 0 · ARCHIVOS
// ═══════════════════════════════════════════════════════════
console.log('0 · archivos');
const migs = fs.readdirSync('migrations').filter((f) => f.endsWith('.sql'));
// ⚠️ Reanclado en F3D: s7_94 es posterior. Lo que se fija es la POSICIÓN de s7_93
// (migración 114 en orden), no que sea la última.
check('s7_93 es la migración 114 en orden', [...migs].sort().indexOf(path.basename(P93)) + 1, 114);
check('control: hay al menos 114 migraciones', migs.length >= 114, true);
const rastreado = (p) => { try { execSync(`git ls-files --error-unmatch "${p}"`, { stdio: 'ignore' }); return true; } catch { return false; } };
check('el rollback está rastreado por git (la regla *.sql exige git add -f)', rastreado(PRB.split(path.sep).join('/')), true);
check('sin etiquetas $…$ en comentarios de la migración', sinDolarEnComentarios(raw), true);
check('sin etiquetas $…$ en comentarios del rollback', sinDolarEnComentarios(rawRb), true);
check('regla 3 del SQL Editor: sin texto con forma de CREATE/DROP de objetos en la migración', RE_DDL_TEXTO.test(raw), false);
check('regla 3 del SQL Editor: sin texto con forma de CREATE/DROP de objetos en el rollback', RE_DDL_TEXTO.test(rawRb), false);
check('solo ASCII y español en los archivos (sin caracteres de otros alfabetos)', /[Ѐ-ӿ]/.test(raw + rawRb), false);

// ═══════════════════════════════════════════════════════════
// 1 · C2: HUELLA Y LISTA EXACTAS
// ═══════════════════════════════════════════════════════════
console.log('\n1 · huella C39 y lista C39.5');
check('la lista del preflight tiene 23 entradas', LISTA_C395.split(' ; ').length, 23);
check('la lista está ordenada por id y sin repetidos',
  LISTA_C395.split(' ; ').map((e) => e.split('|')[0]).every((id, i, a) => i === 0 || a[i - 1] < id), true);
check('cada municipio pertenece al departamento de su entrada (prefijo legacy)',
  LISTA_C395.split(' ; ').every((e) => { const [, d, m] = e.split('|'); return m.startsWith(d + '-'); }), true);
const reglaListas = (s, rb) => [listaDe(bloque(s, 'PRE')), listaDe(bloque(s, 'GUARDA')), listaDe(bloque(rb, 'PREVIA'))].every((l) => l === LISTA_C395);
const reglaHuellas = (s) => huellaDe(bloque(s, 'PRE')) === HUELLA_C39 && huellaDe(bloque(s, 'GUARDA')) === HUELLA_C39;
check('PRE, GUARDA y rollback incrustan EXACTAMENTE la lista C39.5', reglaListas(raw, rawRb), true);
check('PRE y GUARDA incrustan EXACTAMENTE la huella C39', reglaHuellas(raw), true);
const reglaExprHuella = (s) => ['PRE', 'GUARDA'].every((t) => { const b = bloque(s, t);
  return b.includes(EXPR_HUELLA) && b.includes('INTO v_txt FROM public.clinics c;\n  IF v_txt IS DISTINCT FROM v_huella THEN'); });
check('la huella se recalcula con la expresión de C39 sobre TODAS las clínicas', reglaExprHuella(raw), true);
const reglaExprLista = (s) => ['PRE', 'GUARDA'].every((t) => { const b = bloque(s, t);
  return b.includes(EXPR_LISTA) && b.includes("WHERE c.department_id IS NOT NULL AND c.country_id IS NULL AND c.territory_unit_id IS NULL;\n  IF v_txt IS DISTINCT FROM v_lista THEN"); });
check('el conjunto pendiente se recalcula con la expresión de C39.5 y se exige igual a la lista', reglaExprLista(raw), true);

// ═══════════════════════════════════════════════════════════
// 2 · ORDEN DE LA TRANSACCIÓN
// ═══════════════════════════════════════════════════════════
console.log('\n2 · orden de la transacción');
const ex = sinComentarios(raw);
const exSL = sinLiterales(ex);
check('un único BEGIN; y un único COMMIT;', `${(ex.match(/^BEGIN;/gm) || []).length},${(ex.match(/^COMMIT;/gm) || []).length}`, '1,1');
const PASOS = [
  'END $PRE$;', '\nBEGIN;', "SET LOCAL lock_timeout = '5s';", 'LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;',
  'DO $GUARDA$', 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;', 'DO $BACKFILL$',
  'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;', 'DO $POST$', 'END $POST$;', '\nCOMMIT;',
];
const reglaOrden = (s) => { const e = sinComentarios(s); const p = PASOS.map((n) => (ocurrencias(e, n) === 1 ? e.indexOf(n) : -1));
  return p.every((x, i) => x >= 0 && (i === 0 || x > p[i - 1])); };
for (const n of PASOS) check(`aparece exactamente una vez: ${n.trim()}`, ocurrencias(ex, n), 1);
check('orden: PRE fuera → BEGIN → lock_timeout → LOCK → GUARDA → DISABLE updated_at → BACKFILL → ENABLE updated_at → POST → COMMIT', reglaOrden(raw), true);
check('lock_timeout inmediatamente después del BEGIN', /\nBEGIN;\n\nSET LOCAL lock_timeout = '5s';\n/.test(ex), true);
check('el lock es SHARE ROW EXCLUSIVE (bloquea escrituras, no lecturas)', (exSL.match(/LOCK TABLE[^;]*;/g) || []).join('|'), 'LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;');

// ═══════════════════════════════════════════════════════════
// 3 · C1: SOLO SE DESACTIVA EL TRIGGER DE updated_at
// ═══════════════════════════════════════════════════════════
console.log('\n3 · triggers');
const reglaC1 = (s) => { const e = sinLiterales(sinComentarios(s));
  const dis = e.match(/\b(DISABLE|ENABLE)(\s+(ALWAYS|REPLICA))?\s+TRIGGER\s+\w+/gi) || [];
  return dis.join('|') === 'DISABLE TRIGGER trg_clinics_updated_at|ENABLE TRIGGER trg_clinics_updated_at'
    && !/session_replication_role/i.test(e) && !/DISABLE\s+TRIGGER\s+(ALL|USER)\b/i.test(e); };
check('C1: solo DISABLE/ENABLE de trg_clinics_updated_at; la sincronización nunca se desactiva; sin session_replication_role', reglaC1(raw), true);

// ═══════════════════════════════════════════════════════════
// 4 · BACKFILL
// ═══════════════════════════════════════════════════════════
console.log('\n4 · backfill');
const bBack = sinComentarios(bloque(raw, 'BACKFILL'));
const reglaUnUpdate = (s) => { const e = sinLiterales(sinComentarios(s)); const b = sinLiterales(sinComentarios(bloque(s, 'BACKFILL')));
  return (e.match(/\bUPDATE\s+public\.clinics\b/gi) || []).length === 1 && (b.match(/\bUPDATE\s+public\.clinics\b/gi) || []).length === 1
    && !/\b(INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)\b/i.test(e) && (e.match(/\bUPDATE\s+\w/gi) || []).length === 1; };
check('un único UPDATE en toda la migración, dentro de BACKFILL; sin INSERT/DELETE/TRUNCATE', reglaUnUpdate(raw), true);
const reglaResolver = (s) => sinComentarios(bloque(s, 'BACKFILL')).includes(
  '     SET (country_id, territory_unit_id) =\n         (SELECT t.country_id, t.territory_unit_id\n            FROM public._territory_from_legacy_sv(c.department_id, c.municipality_id) t)');
check('la geo sale EXCLUSIVAMENTE del resolver vivo, con el legacy de la propia fila', reglaResolver(raw), true);
const reglaAlcance = (s) => { const b = sinComentarios(bloque(s, 'BACKFILL'));
  return b.includes("FROM regexp_split_to_table(current_setting('s7_93.lista'), ' ; ') AS x(item)) l")
    && b.includes('   WHERE c.id = l.id\n     AND c.department_id = l.dep\n     AND c.municipality_id = l.mun\n     AND c.country_id IS NULL\n     AND c.territory_unit_id IS NULL;'); };
check('alcance: solo ids de la lista, con su legacy listado y geo NULL', reglaAlcance(raw), true);
const reglaExactas23 = (s) => sinComentarios(bloque(s, 'BACKFILL')).includes('GET DIAGNOSTICS v_n = ROW_COUNT;\n  IF v_n <> 23 THEN');
check('exige exactamente 23 filas actualizadas', reglaExactas23(raw), true);
has('la lista viaja desde la GUARDA como ajuste local a la transacción', sinComentarios(bloque(raw, 'GUARDA')), "PERFORM set_config('s7_93.lista', v_lista, true);");

// ═══════════════════════════════════════════════════════════
// 5 · PRE y GUARDA
// ═══════════════════════════════════════════════════════════
console.log('\n5 · PRE y GUARDA');
const pre = sinComentarios(bloque(raw, 'PRE'));
check('PRE solo lectura', /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ALTER\s|GRANT\s|REVOKE\s|LOCK\s)/i.test(sinLiterales(pre)), false);
for (const [lbl, n] of [
  ['sin incoherencias', "IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 PRE: % clinicas incoherentes: STOP', v_n; END IF;"],
  ['sin geo previa (no reaplicar)', "IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 PRE: % clinicas ya tienen geo — no reaplicar', v_n; END IF;"],
  ['recuentos 119 / 96 / 0', "IF (SELECT count(*) FROM public.clinics) <> 119"],
  ['triggers normales', "IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN"],
  ['funciones de s7_92 por md5', "md5(p.prosrc) IN ('b8a0d02700685b5d340c8ab1ebfcec17', 'bdb0723c0257b31fe1aaa2bfc609dd6c')"],
  ['guarda F3A ausente', "IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinics_geo_f3a_temp_null_chk') THEN"],
  ['sin consumidores del modelo nuevo', "p.prosrc ~ '\\m(country_id|territory_unit_id|administrative_units|country_levels)\\M';"],
  ['current_user = postgres', "IF current_user <> 'postgres' THEN"],
]) has(`PRE: ${lbl}`, pre, n);
const guarda = sinComentarios(bloque(raw, 'GUARDA'));
for (const [lbl, n] of [
  ['incoherencias bajo lock', "IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 GUARDA: % clinicas incoherentes: STOP', v_n; END IF;"],
  ['triggers normales bajo lock', "RAISE EXCEPTION 's7_93 GUARDA: triggers de clinics inesperados (%)', v_txt;"],
  ['huella de columnas no geo', "PERFORM set_config('s7_93.no_geo',"],
  ['huella de privilegios y RLS', "PERFORM set_config('s7_93.acl',"],
  ['huella de policies', "PERFORM set_config('s7_93.policies',"],
  ['huella de funciones de public', "PERFORM set_config('s7_93.funciones',"],
]) has(`GUARDA: ${lbl}`, guarda, n);

// ═══════════════════════════════════════════════════════════
// 6 · POST
// ═══════════════════════════════════════════════════════════
console.log('\n6 · POST');
const post = sinComentarios(bloque(raw, 'POST'));
const reglaPost = {
  triggers: (p) => p.includes("RAISE EXCEPTION 's7_93 POST: los triggers no quedaron normales (%)', v_txt;"),
  total: (p) => p.includes('IF (SELECT count(*) FROM public.clinics) <> 119 THEN'),
  sinUbicacion96: (p) => p.includes('IF v_n <> 96 THEN'),
  sinUbicacionSinGeo: (p) => p.includes("RAISE EXCEPTION 's7_93 POST: % clinicas sin ubicacion recibieron geo', v_n;"),
  pendientes0: (p) => p.includes("RAISE EXCEPTION 's7_93 POST: quedan % pendientes o con geo parcial', v_n;"),
  derivadas23: (p) => p.includes("WHERE u.level = 3 AND u.legacy_id = l.mun AND u.country_id = c.country_id AND co.iso_alpha2 = 'SV'")
    && p.includes('AND c.country_id = t.country_id AND c.territory_unit_id = t.territory_unit_id;') && p.includes("IF v_n <> 23 THEN RAISE EXCEPTION 's7_93 POST: solo %"),
  soloLista: (p) => p.includes("RAISE EXCEPTION 's7_93 POST: % clinicas fuera de la lista tienen geo', v_n;"),
  divergencias0: (p) => p.includes("RAISE EXCEPTION 's7_93 POST: % divergencias entre legacy y geo', v_n;"),
  nivel2: (p) => p.includes("WHERE u.level = 2;\n  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 POST: % clinicas apuntan a nivel 2', v_n;"),
  noGeo: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_93.no_geo') THEN"),
  acl: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_93.acl') THEN"),
  policies: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_93.policies') THEN"),
  funciones: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_93.funciones') THEN"),
};
for (const [k, f] of Object.entries(reglaPost)) check(`POST: ${k}`, f(post), true);
check('GUARDA y POST usan la MISMA huella de columnas no geo',
  guarda.includes("(SELECT md5(string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\\n' ORDER BY c.id)) FROM public.clinics c)")
  && post.includes("SELECT md5(string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\\n' ORDER BY c.id)) INTO v_txt FROM public.clinics c;"), true);

// ═══════════════════════════════════════════════════════════
// 7 · ALCANCE Y SEGURIDAD
// ═══════════════════════════════════════════════════════════
console.log('\n7 · alcance y seguridad');
const reglaSinPrivilegios = (s) => !/\b(GRANT|REVOKE|CREATE|DROP)\b/i.test(sinLiterales(sinComentarios(s)));
check('sin GRANT, REVOKE, CREATE ni DROP', reglaSinPrivilegios(raw), true);
check('no toca profiles, doctor_affiliation_requests ni otras tablas', /\b(profiles|doctor_affiliation_requests|doctors|patients)\b/i.test(exSL), false);
check('no usa teléfonos', /phone|telefono/i.test(ex), false);
check('sin inferencia para clínicas sin ubicación: ninguna escritura fuera de la lista', reglaAlcance(raw) && reglaUnUpdate(raw), true);

// ═══════════════════════════════════════════════════════════
// 8 · ROLLBACK R2
// ═══════════════════════════════════════════════════════════
console.log('\n8 · rollback R2');
const exRb = sinComentarios(rawRb);
check('atómico: un BEGIN; y un COMMIT;', `${(exRb.match(/^BEGIN;/gm) || []).length},${(exRb.match(/^COMMIT;/gm) || []).length}`, '1,1');
const PASOS_RB = [
  '\nBEGIN;', "SET LOCAL lock_timeout = '5s';", 'LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;', 'DO $PREVIA$', 'END $PREVIA$;',
  'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_territory_sync;', 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;',
  'DO $VACIADO$', 'END $VACIADO$;',
  'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;', 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_territory_sync;',
  'DO $VERIFICA$', 'END $VERIFICA$;', '\nCOMMIT;',
];
const reglaOrdenRb = (s) => { const e = sinComentarios(s); const p = PASOS_RB.map((n) => (ocurrencias(e, n) === 1 ? e.indexOf(n) : -1));
  return p.every((x, i) => x >= 0 && (i === 0 || x > p[i - 1])); };
check('orden: BEGIN → lock_timeout → LOCK → PREVIA → DISABLE ambos → VACIADO → ENABLE ambos → VERIFICA → COMMIT', reglaOrdenRb(rawRb), true);
const reglaRbFila = (s) => { const p = sinComentarios(bloque(s, 'PREVIA'));
  return p.includes('    LEFT JOIN LATERAL public._territory_from_legacy_sv(l.dep, l.mun) t ON true\n   WHERE c.id IS NULL\n      OR c.department_id IS DISTINCT FROM l.dep\n      OR c.municipality_id IS DISTINCT FROM l.mun\n      OR c.country_id IS NULL\n      OR c.territory_unit_id IS NULL\n      OR c.country_id IS DISTINCT FROM t.country_id\n      OR c.territory_unit_id IS DISTINCT FROM t.territory_unit_id;')
    && p.includes("RAISE EXCEPTION 'rollback s7_93: estas filas cambiaron despues de s7_93 (%) — no se revierte', v_txt;"); };
check('PREVIA verifica cada una de las 23 filas (existe, legacy listado, geo = resolver) y aborta si alguna cambió', reglaRbFila(rawRb), true);
const reglaRbConsumidores = (s) => { const p = sinComentarios(bloque(s, 'PREVIA'));
  return p.includes("p.prosrc ~ '\\m(country_id|territory_unit_id|administrative_units|country_levels)\\M';")
    && p.includes("WHERE d.classid = 'pg_rewrite'::regclass"); };
check('PREVIA: válido solo sin consumidores (funciones y vistas) · antes de F3D/F3E', reglaRbConsumidores(rawRb), true);
const reglaRbVaciado = (s) => { const b = sinComentarios(bloque(s, 'VACIADO'));
  return b.includes('     SET country_id = NULL, territory_unit_id = NULL')
    && b.includes("FROM regexp_split_to_table(current_setting('s7_93rb.lista'), ' ; ') AS x(item)) l")
    && b.includes('   WHERE c.id = l.id\n     AND c.department_id = l.dep\n     AND c.municipality_id = l.mun\n     AND c.country_id IS NOT NULL\n     AND c.territory_unit_id IS NOT NULL;')
    && b.includes('IF v_n <> 23 THEN')
    && (sinLiterales(sinComentarios(s)).match(/\bUPDATE\s+\w/gi) || []).length === 1; };
check('VACIADO: único UPDATE, solo la lista con su legacy, exactamente 23', reglaRbVaciado(rawRb), true);
const vrb = sinComentarios(bloque(rawRb, 'VERIFICA'));
for (const [lbl, n] of [
  ['triggers restaurados a O', "RAISE EXCEPTION 'rollback s7_93 VERIFICA: los triggers no quedaron normales (%)', v_txt;"],
  ['23 filas con legacy intacto y geo NULL', 'IF v_n <> 23 THEN RAISE EXCEPTION'],
  ['huella de columnas no geo (updated_at incluido)', "IF v_txt IS DISTINCT FROM current_setting('s7_93rb.no_geo') THEN"],
  ['geo de las clínicas fuera de la lista intacta', "IF v_txt IS DISTINCT FROM current_setting('s7_93rb.geo_resto') THEN"],
  ['privilegios y RLS', "current_setting('s7_93rb.acl')"],
  ['policies', "current_setting('s7_93rb.policies')"],
  ['funciones', "current_setting('s7_93rb.funciones')"],
]) has(`VERIFICA: ${lbl}`, vrb, n);
check('rollback sin GRANT, REVOKE, CREATE ni DROP', reglaSinPrivilegios(rawRb), true);

// ═══════════════════════════════════════════════════════════
// 9 · MUTACIÓN CON EXPECTATIVA INVERTIDA
// ═══════════════════════════════════════════════════════════
const R = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutación sin ancla: ${a.slice(0, 60)}`); return s.split(a).join(b); };
const reglas = {
  listas: (s) => reglaListas(s, rawRb), huellas: reglaHuellas, exprHuella: reglaExprHuella, exprLista: reglaExprLista,
  orden: reglaOrden, c1: reglaC1, unUpdate: reglaUnUpdate, resolver: reglaResolver, alcance: reglaAlcance, exactas23: reglaExactas23,
  sinPrivilegios: reglaSinPrivilegios, sinDolar: sinDolarEnComentarios, sinDDLTexto: (s) => !RE_DDL_TEXTO.test(s),
  postNoGeo: (s) => reglaPost.noGeo(sinComentarios(bloque(s, 'POST'))),
  postDivergencias: (s) => reglaPost.divergencias0(sinComentarios(bloque(s, 'POST'))),
  postSinUbicacion: (s) => reglaPost.sinUbicacionSinGeo(sinComentarios(bloque(s, 'POST'))),
};
const reglasRb = { listasRb: (s) => reglaListas(raw, s), ordenRb: reglaOrdenRb, fila: reglaRbFila, consumidores: reglaRbConsumidores, vaciado: reglaRbVaciado };
const U = "'c0000001-0000-0000-0000-000000000012|SS|SS-12 ; '";
const mutaciones = [
  ['huella distinta a la del preflight en la GUARDA', 'huellas', (s) => { const g = bloque(s, 'GUARDA'); return s.replace(g, R(g, HUELLA_C39, '00000000000000000000000000000000')); }],
  ['lista con una entrada de menos en la GUARDA', 'listas', (s) => { const g = bloque(s, 'GUARDA'); return s.replace(g, R(g, `    ${U}\n`, '')); }],
  ['lista con un municipio cambiado en el PRE', 'listas', (s) => { const g = bloque(s, 'PRE'); return s.replace(g, R(g, '|SM|SM-09 ; ', '|SM|SM-10 ; ')); }],
  ['huella calculada sin las columnas geo', 'exprHuella', (s) => R(s, " || '|' ||\n           coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'),", ",")],
  ['conjunto pendiente sin exigir geo NULL', 'exprLista', (s) => R(s, "WHERE c.department_id IS NOT NULL AND c.country_id IS NULL AND c.territory_unit_id IS NULL;\n  IF v_txt IS DISTINCT FROM v_lista THEN",
    "WHERE c.department_id IS NOT NULL;\n  IF v_txt IS DISTINCT FROM v_lista THEN")],
  ['desactivar también la sincronización', 'c1', (s) => R(s, 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;\n',
    'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;\nALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_territory_sync;\n')],
  ['DISABLE TRIGGER USER', 'c1', (s) => R(s, 'DISABLE TRIGGER trg_clinics_updated_at;', 'DISABLE TRIGGER USER;')],
  ['session_replication_role en lugar de desactivar un trigger', 'c1', (s) => R(s, 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;\n', "SET LOCAL session_replication_role = replica;\nALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;\n")],
  ['olvidar restaurar el trigger de updated_at', 'orden', (s) => R(s, 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;\n', '')],
  ['lock después del backfill', 'orden', (s) => { const l = 'LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;\n'; return R(R(s, l, ''), 'DO $POST$', l + 'DO $POST$'); }],
  ['geo desde un literal en vez del resolver', 'resolver', (s) => R(s, 'FROM public._territory_from_legacy_sv(c.department_id, c.municipality_id) t)', 'FROM (SELECT 1::smallint AS country_id, 1::bigint AS territory_unit_id) t)')],
  ['UPDATE sin exigir el legacy listado', 'alcance', (s) => R(s, '     AND c.department_id = l.dep\n     AND c.municipality_id = l.mun\n', '')],
  ['UPDATE que pisa geo existente', 'alcance', (s) => R(s, '     AND c.country_id IS NULL\n     AND c.territory_unit_id IS NULL;', ';')],
  ['aceptar 24 filas', 'exactas23', (s) => R(s, 'IF v_n <> 23 THEN\n    RAISE EXCEPTION \'s7_93 BACKFILL', 'IF v_n > 24 THEN\n    RAISE EXCEPTION \'s7_93 BACKFILL')],
  ['un segundo UPDATE (backfill de las sin ubicación)', 'unUpdate', (s) => R(s, 'GET DIAGNOSTICS v_n = ROW_COUNT;', "UPDATE public.clinics SET country_id = 1 WHERE department_id IS NULL;\n  GET DIAGNOSTICS v_n = ROW_COUNT;")],
  ['un GRANT', 'sinPrivilegios', (s) => R(s, '\nCOMMIT;\n', '\nGRANT SELECT ON public.countries TO anon;\nCOMMIT;\n')],
  ['POST sin huella de columnas no geo', 'postNoGeo', (s) => R(s, "IF v_txt IS DISTINCT FROM current_setting('s7_93.no_geo') THEN", 'IF false THEN')],
  ['POST sin buscar divergencias', 'postDivergencias', (s) => R(s, "RAISE EXCEPTION 's7_93 POST: % divergencias entre legacy y geo', v_n;", "NULL;")],
  ['POST sin exigir geo NULL en las sin ubicación', 'postSinUbicacion', (s) => R(s, "RAISE EXCEPTION 's7_93 POST: % clinicas sin ubicacion recibieron geo', v_n;", "NULL;")],
  ['una etiqueta $…$ en un comentario', 'sinDolar', (s) => R(s, '-- Si el PASO 1 lanza excepcion, NO continuar.', '-- Pegar desde DO $PRE$. Si el PASO 1 lanza excepcion, NO continuar.')],
  ['texto con forma de CREATE TABLE en un comentario', 'sinDDLTexto', (s) => R(s, '-- No crea objetos,', '-- No hace CREATE TABLE public._s7_93_tmp,')],
];
const mutacionesRb = [
  ['rollback con otra lista', 'listasRb', (s) => R(s, `    ${U}\n`, '')],
  ['rollback sin desactivar la sincronización', 'ordenRb', (s) => R(s, 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_territory_sync;\n', '')],
  ['rollback que no restaura la sincronización', 'ordenRb', (s) => R(s, 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_territory_sync;\n', '')],
  ['rollback que verifica antes de restaurar los triggers', 'ordenRb', (s) => { const e = 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;\nALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_territory_sync;\n';
    return R(R(s, e, ''), '\nCOMMIT;\n', '\n' + e + 'COMMIT;\n'); }],
  ['PREVIA sin comprobar el legacy de cada fila', 'fila', (s) => R(s, '      OR c.department_id IS DISTINCT FROM l.dep\n      OR c.municipality_id IS DISTINCT FROM l.mun\n', '')],
  ['PREVIA sin comprobar que la geo sigue siendo la derivada', 'fila', (s) => R(s, '      OR c.country_id IS DISTINCT FROM t.country_id\n      OR c.territory_unit_id IS DISTINCT FROM t.territory_unit_id;', ';')],
  ['PREVIA sin guarda de consumidores', 'consumidores', (s) => R(s, "WHERE d.classid = 'pg_rewrite'::regclass", "WHERE d.classid = 0")],
  ['vaciado de TODA la geo (R1)', 'vaciado', (s) => R(s, '   WHERE c.id = l.id\n     AND c.department_id = l.dep\n     AND c.municipality_id = l.mun\n', '   WHERE true\n')],
  ['vaciado que acepta cualquier número de filas', 'vaciado', (s) => R(s, 'IF v_n <> 23 THEN', 'IF false THEN')],
];
console.log('\n9 · reglas sobre los archivos reales (control)');
for (const r of new Set(mutaciones.map((m) => m[1]))) check(`la migración cumple ${r}`, reglas[r](raw), true);
for (const r of new Set(mutacionesRb.map((m) => m[1]))) check(`el rollback cumple ${r}`, reglasRb[r](rawRb), true);
console.log('\n9.b · mutación con expectativa INVERTIDA');
for (const [nombre, regla, mut] of mutaciones) {
  let r;
  try { r = reglas[regla](mut(raw)); } catch (e) { r = e.message; }
  check(`detecta: ${nombre}`, r, false);
}
for (const [nombre, regla, mut] of mutacionesRb) {
  let r;
  try { r = reglasRb[regla](mut(rawRb)); } catch (e) { r = e.message; }
  check(`detecta: ${nombre}`, r, false);
}

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
