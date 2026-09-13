#!/usr/bin/env node
/**
 * check-s7_90.mjs — Fundación 3B · paso 1: corrección M2 de CH-16.
 *
 * s7_90 cambia UN nombre de UNA fila legacy. Lo que hay que demostrar:
 *   · que solo puede cambiar ese nombre, con el valor previo exacto;
 *   · que solo procede con CERO referencias, contadas DENTRO de la transacción
 *     y con la fila bloqueada ANTES de contar;
 *   · que el descubrimiento de referencias es el mismo en PRE, guarda, POST y
 *     rollback, y que tiene la semántica del precheck versionado (§6.4);
 *   · que el POST demuestra que nada más cambió;
 *   · que el rollback es atómico y se niega a revertir con referencias.
 *
 *   node scripts/check-s7_90.mjs
 *
 * No toca la base de datos ni la red.
 */
import path from 'path';
import fs from 'fs';

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else {
    fail++;
    console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`);
  }
};
const has = (label, hay, needle) => check(label, hay.includes(needle), true);

console.log('\ncheck-s7_90 — Fundación 3B · M2 de CH-16\n');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const P90 = path.join('migrations', 's7_90_geo_foundation_3b_ch16_name.sql');
const PRB = path.join('docs', 'rollbacks', 's7_90_rollback.sql');
const P88 = path.join('migrations', 's7_88_geo_foundation_2a_sv_catalog.sql');
const PDOC = path.join('docs', 'ANALISIS_MULTICOUNTRY_GEO.md');
const raw = leerLF(P90);
const rawRb = leerLF(PRB);

const sinComentarios = (sql) => sql.split('\n').map((l) => {
  const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i);
}).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");

/** Bloque DO por etiqueta, desde «DO $X$» hasta «END $X$;». */
const bloque = (s, tag) => {
  const a = s.indexOf(`DO $${tag}$`), b = s.indexOf(`END $${tag}$;`);
  return a === -1 || b === -1 ? '' : s.slice(a, b + `END $${tag}$;`.length);
};
/** Lo que queda FUERA de todo bloque DO: las sentencias SQL de nivel superior. */
const fueraDeDo = (s) => {
  let out = s;
  for (const m of [...s.matchAll(/DO \$([A-Z]+)\$/g)]) out = out.replace(bloque(s, m[1]), '');
  return out;
};
/** El texto entre los marcadores del descubrimiento, en orden de aparición. */
const descubrimientos = (s) => [...s.matchAll(
  /-- >> descubrimiento de referencias a CH-16 \(identico en todos los bloques\)\n([\s\S]*?)\n\s*-- << descubrimiento de referencias a CH-16/g,
)].map((m) => m[1]);

const exe = sinComentarios(raw);
const pos = (n) => exe.indexOf(n);

// ═══════════════════════════════════════════════════════════
// 0 · ATOMICIDAD Y ORDEN
// ═══════════════════════════════════════════════════════════
console.log('0 · atomicidad y orden');
check('exactamente un BEGIN;', (exe.match(/^BEGIN;/gm) || []).length, 1);
check('exactamente un COMMIT;', (exe.match(/^COMMIT;/gm) || []).length, 1);
check('el PRE queda FUERA de la transacción', pos('END $PRE$;') < pos('BEGIN;') && pos('DO $PRE$') > -1, true);
check('orden: BEGIN → GUARDA → UPDATE → POST → COMMIT',
  pos('BEGIN;') < pos('DO $GUARDA$') && pos('END $GUARDA$;') < pos('UPDATE public.municipalities')
  && pos('UPDATE public.municipalities') < pos('DO $POST$') && pos('END $POST$;') < pos('COMMIT;'), true);
check('nada ejecutable después del COMMIT', exe.slice(pos('COMMIT;') + 'COMMIT;'.length).trim(), '');

// ═══════════════════════════════════════════════════════════
// 1 · ALCANCE: UN NOMBRE, UNA FILA
// ═══════════════════════════════════════════════════════════
console.log('\n1 · alcance');
const top = sinComentarios(fueraDeDo(raw));
const sentencias = top.split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
check('fuera de los bloques DO solo hay BEGIN, un UPDATE y COMMIT',
  sentencias.map((x) => x.split(' ')[0].toUpperCase()).join(','), 'BEGIN,UPDATE,COMMIT');
const upd = sentencias.find((x) => /^UPDATE/i.test(x)) || '';
check('el UPDATE exacto',
  upd,
  "UPDATE public.municipalities SET name = 'San Miguel de Mercedes' WHERE id = 'CH-16' AND name = 'Cancasque' AND department_id = 'CH' AND district = 'Chalatenango Sur'");
check('el SET toca SOLO name', (upd.match(/SET (.*) WHERE/i) || [])[1], "name = 'San Miguel de Mercedes'");
const exeId = sinLiterales(exe);
for (const [n, re] of [
  ['INSERT', /\bINSERT\s+INTO\b/i], ['DELETE', /\bDELETE\s+FROM\b/i], ['TRUNCATE', /\bTRUNCATE\b/i],
  ['ALTER', /\bALTER\b/i], ['CREATE', /\bCREATE\b/i], ['DROP', /\bDROP\b/i], ['GRANT', /\bGRANT\b/i],
  ['REVOKE', /\bREVOKE\b/i], ['POLICY', /\bPOLICY\b/i], ['TRIGGER', /\bTRIGGER\b/i],
  ['ROW LEVEL SECURITY', /ROW\s+LEVEL\s+SECURITY/i],
]) check(`sin ${n}`, re.test(exeId), false);
check('un solo UPDATE en todo el archivo', (exeId.match(/\bUPDATE\s+(public\.)?\w+/gi) || []).length, 1);
check('ningún bloque DO escribe: solo lee y fija configuración local',
  ['PRE', 'GUARDA', 'POST'].some((t) => /\b(INSERT|UPDATE|DELETE)\s/i.test(sinLiterales(sinComentarios(bloque(raw, t)))
    .replace(/FOR UPDATE/gi, ''))), false);
check('no escribe clinics, administrative_units, departments ni countries',
  /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(public\.)?(clinics|administrative_units|departments|countries|profiles|doctor_affiliation_requests)\b/i.test(exe), false);
// `name` suelto o calificado (m.name), nunca como sufijo de otra columna
// (c.column_name ILIKE … del descubrimiento es legítimo). La primera versión de
// esta regla no excluía el sufijo y dio un falso positivo sobre ese ILIKE.
const RE_NOMBRE_DIFUSO = /(?<!\w)name\s+(NOT\s+)?(I?LIKE|~|SIMILAR)/i;
check('Cancasque se compara con igualdad EXACTA (existe «San José Cancasque»)',
  RE_NOMBRE_DIFUSO.test(exe), false);
check('control: la regla SÍ detecta una comparación difusa sobre name',
  RE_NOMBRE_DIFUSO.test("WHERE m.name ILIKE '%Cancasque%'"), true);
check('control: la regla NO confunde column_name ILIKE',
  RE_NOMBRE_DIFUSO.test("c.column_name ILIKE '%municipality%'"), false);
check('regla del 2026-09-13: ningún $ dentro de comentarios de la migración',
  raw.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length, 0);
check('regla del 2026-09-13: ningún $ dentro de comentarios del rollback',
  rawRb.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length, 0);
check('sin marcadores posicionales $1 (se usa %L, ya probado en el SQL Editor)', /\$\d/.test(raw + rawRb), false);

// ═══════════════════════════════════════════════════════════
// 2 · PRE
// ═══════════════════════════════════════════════════════════
console.log('\n2 · guardas PRE');
const pre = bloque(raw, 'PRE');
has('PRE exige que CH-16 exista', pre, 'IF NOT FOUND THEN');
for (const [c, v] of [['name', 'Cancasque'], ['department_id', 'CH'], ['district', 'Chalatenango Sur']]) {
  has(`PRE exige ${c} = ${v}`, pre, `v_fila.${c} IS DISTINCT FROM '${v}'`);
}
has('PRE exige exactamente 1 Cancasque', pre, "WHERE name = 'Cancasque';\n  IF v_n <> 1 THEN");
has('PRE exige 0 San Miguel de Mercedes previos', pre, "WHERE name = 'San Miguel de Mercedes';\n  IF v_n <> 0 THEN");
has('PRE ancla 14 departamentos', pre, 'IF v_n <> 14 THEN');
has('PRE ancla 262 municipios legacy', pre, 'IF v_n <> 262 THEN');
has('PRE ancla 7 FK legacy', pre, 'IF v_n <> 7 THEN');
has('PRE ancla 320 unidades de SV', pre, 'IF v_n <> 320 THEN');
has('PRE exige que el catálogo nuevo ya diga San Miguel de Mercedes bajo Chalatenango Sur / CH', pre,
  "u3.name = 'San Miguel de Mercedes'\n     AND u2.name = 'Chalatenango Sur' AND u1.legacy_id = 'CH'");
has('PRE aborta si la sonda no midió (< 3 columnas)', pre, 'IF v_cols < 3 THEN');
has('PRE aborta con cualquier referencia', pre, 'IF v_refs <> 0 THEN');

// ═══════════════════════════════════════════════════════════
// 3 · GUARDA DENTRO DE LA TRANSACCIÓN
// ═══════════════════════════════════════════════════════════
console.log('\n3 · guarda con bloqueo');
const guarda = bloque(raw, 'GUARDA');
has('GUARDA bloquea CH-16 con FOR UPDATE', guarda, "WHERE m.id = 'CH-16'\n     FOR UPDATE;");
check('GUARDA comprueba FOUND en su propio IF, sin leer campos de un record vacío',
  guarda.includes("FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION"), true);
check('el rollback también', rawRb.includes("FOR UPDATE;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION"), true);
check('el FOR UPDATE va ANTES del recuento', guarda.indexOf('FOR UPDATE') > -1
  && guarda.indexOf('FOR UPDATE') < guarda.indexOf('-- >> descubrimiento'), true);
for (const [c, v] of [['name', 'Cancasque'], ['department_id', 'CH'], ['district', 'Chalatenango Sur']]) {
  has(`GUARDA re-exige ${c} = ${v}`, guarda, `v_fila.${c} IS DISTINCT FROM '${v}'`);
}
has('GUARDA aborta si la sonda no midió', guarda, 'IF v_cols < 3 THEN');
has('GUARDA aborta con cualquier referencia', guarda, 'IF v_refs <> 0 THEN');
for (const h of ['huella_otras_municipalities', 'ch16_sin_nombre', 'huella_departments', 'huella_administrative_units']) {
  has(`GUARDA toma la huella ${h}`, guarda, `set_config('s7_90.${h}'`);
}
check('las huellas son LOCALES a la transacción (tercer argumento true)',
  (guarda.match(/set_config\('s7_90\.[a-z_0-9]+',[\s\S]*?, true\);/g) || []).length, 4);

// ═══════════════════════════════════════════════════════════
// 4 · POST
// ═══════════════════════════════════════════════════════════
console.log('\n4 · guardas POST');
const post = bloque(raw, 'POST');
has('POST: CH-16 = San Miguel de Mercedes', post, "CH-16 deberia llamarse San Miguel de Mercedes");
has('POST: id, departamento, agrupador y demás columnas idénticos', post, 'CH-16 cambio algo mas que el nombre');
has('POST: ya no existe Cancasque', post, "WHERE name = 'Cancasque';\n  IF v_n <> 0 THEN");
has('POST: exactamente 1 San Miguel de Mercedes', post, 'esperaba 1 San Miguel de Mercedes');
has('POST: ninguna otra fila de municipalities cambió (huella)', post, 'cambiaron otras filas de municipalities');
has('POST: 262 filas legacy', post, 'IF v_n <> 262 THEN');
has('POST: departments intacta (huella)', post, 'departments cambio');
has('POST: 7 FK legacy', post, 'IF v_n <> 7 THEN');
has('POST: administrative_units intacta (huella)', post, 'administrative_units cambio');
has('POST: catálogo nuevo 14 / 44 / 262', post, "IS DISTINCT FROM '1:14,2:44,3:262'");
has('POST: legacy y catálogo nuevo coinciden para CH-16', post, 'legacy y catalogo nuevo no coinciden para CH-16');
has('POST: referencias siguen en 0', post, 'IF v_cols < 3 OR v_refs <> 0 THEN');
has('POST: la guarda de F3A sigue en pie', post, "conname = 'clinics_geo_f3a_temp_null_chk'");
check('POST usa las cuatro huellas que tomó la GUARDA',
  ['huella_otras_municipalities', 'ch16_sin_nombre', 'huella_departments', 'huella_administrative_units']
    .every((h) => post.includes(`current_setting('s7_90.${h}')`)), true);

// ═══════════════════════════════════════════════════════════
// 5 · UN SOLO DESCUBRIMIENTO, CON LA SEMÁNTICA DE §6.4
// ═══════════════════════════════════════════════════════════
console.log('\n5 · descubrimiento de referencias');
const dMig = descubrimientos(raw);
const dRb = descubrimientos(rawRb);
check('la migración lo contiene en PRE, GUARDA y POST', dMig.length, 3);
check('el rollback lo contiene en su guarda', dRb.length, 1);
check('los cuatro son IDÉNTICOS', new Set([...dMig, ...dRb]).size, 1);
check('cada bloque tiene exactamente un descubrimiento',
  ['PRE', 'GUARDA', 'POST'].map((t) => descubrimientos(bloque(raw, t)).length).join(','), '1,1,1');
const d = dMig[0] || '';
has('descubre FK desde pg_constraint', d, "WHERE con.contype = 'f'");
has('incluye FK compuestas (unnest de conkey / confkey)', d, 'unnest(con.conkey, con.confkey)');
has('apunta a public.municipalities.id', d, "tgt_ns.nspname = 'public' AND tgt.relname = 'municipalities'\n       AND a_tgt.attname = 'id'");
has('incluye columnas *municipality* SIN FK', d, "c.column_name ILIKE '%municipality%'");
has('UNION: una columna con FK no se cuenta dos veces', d, '\n    UNION\n');
has('cuenta con literal %L sobre CH-16', d, "WHERE %I = %L', r.esquema, r.tabla, r.columna, 'CH-16')");
const doc = leerLF(PDOC);
const q64 = (() => { const i = doc.indexOf('### 6.4'); const a = doc.indexOf('```sql', i); return doc.slice(a, doc.indexOf('\n```', a + 6)); })();
for (const frag of ["con.contype = 'f'", 'unnest(con.conkey, con.confkey)', "tgt.relname = 'municipalities'",
  "a_tgt.attname = 'id'", "c.column_name ILIKE '%municipality%'", "c.table_name <> 'municipalities'"]) {
  check(`misma semántica que el precheck versionado §6.4: ${frag}`, q64.includes(frag) && d.includes(frag), true);
}

// ═══════════════════════════════════════════════════════════
// 6 · ANCLAJE CONTRA LO YA VERSIONADO
// ═══════════════════════════════════════════════════════════
console.log('\n6 · anclaje con s7_88');
const s88 = leerLF(P88);
has('s7_88 sembró CH-16 como San Miguel de Mercedes bajo Chalatenango Sur', s88,
  "('Chalatenango Sur', 'San Miguel de Mercedes', 'CH-16')");
has('s7_88 cuelga Chalatenango Sur de Chalatenango', s88, "('Chalatenango', 'Chalatenango Sur')");
has('s7_88 da a Chalatenango el legacy CH', s88, "('Chalatenango', 'CH')");
has('s7_88 conserva San José Cancasque como distrito distinto', s88, "'San José Cancasque'");
check('el nombre destino de s7_90 es exactamente el de s7_88', upd.includes("SET name = 'San Miguel de Mercedes'"), true);

// ═══════════════════════════════════════════════════════════
// 7 · ROLLBACK
// ═══════════════════════════════════════════════════════════
console.log('\n7 · rollback');
const exeRb = sinComentarios(rawRb);
const posRb = (n) => exeRb.indexOf(n);
check('atómico: un BEGIN; y un COMMIT;',
  `${(exeRb.match(/^BEGIN;/gm) || []).length},${(exeRb.match(/^COMMIT;/gm) || []).length}`, '1,1');
check('orden: BEGIN → PREVIA → UPDATE → verificación → COMMIT',
  posRb('BEGIN;') < posRb('DO $PREVIA$') && posRb('END $PREVIA$;') < posRb('UPDATE public.municipalities')
  && posRb('UPDATE public.municipalities') < posRb('DO $ROLLBACK$') && posRb('END $ROLLBACK$;') < posRb('COMMIT;'), true);
const previa = bloque(rawRb, 'PREVIA');
has('bloquea CH-16 con FOR UPDATE', previa, 'FOR UPDATE;');
check('el FOR UPDATE va antes del recuento', previa.indexOf('FOR UPDATE') < previa.indexOf('-- >> descubrimiento'), true);
has('exige el estado exacto que dejó s7_90', previa, "v_fila.name IS DISTINCT FROM 'San Miguel de Mercedes'");
has('se niega con referencias', previa, 'ya significan San Miguel de Mercedes, NO se revierte');
const updRb = sinComentarios(fueraDeDo(rawRb)).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).find((x) => /^UPDATE/i.test(x));
check('UPDATE inverso exacto', updRb,
  "UPDATE public.municipalities SET name = 'Cancasque' WHERE id = 'CH-16' AND name = 'San Miguel de Mercedes' AND department_id = 'CH' AND district = 'Chalatenango Sur'");
const verRb = bloque(rawRb, 'ROLLBACK');
has('verifica Cancasque', verRb, 'CH-16 deberia volver a Cancasque');
has('verifica que solo cambió el nombre', verRb, 'CH-16 cambio algo mas que el nombre');
has('verifica las otras 261 filas', verRb, 'cambiaron otras filas de municipalities');

// ═══════════════════════════════════════════════════════════
// 8 · BLOQUES AUTÓNOMOS DEL RUNBOOK
// ═══════════════════════════════════════════════════════════
console.log('\n8 · bloques autónomos');
const paso1 = raw.slice(raw.indexOf('DO $PRE$'), raw.indexOf('END $PRE$;') + 'END $PRE$;'.length);
const paso2 = raw.slice(raw.indexOf('\nBEGIN;') + 1, raw.indexOf('\nCOMMIT;') + '\nCOMMIT;'.length);
check('PASO 1 empieza en DO $PRE$ y termina en END $PRE$;', paso1.startsWith('DO $PRE$') && paso1.endsWith('END $PRE$;'), true);
check('PASO 1 no abre transacción', /^BEGIN;/m.test(sinComentarios(paso1)), false);
check('PASO 2 empieza en BEGIN; y termina en COMMIT;', paso2.startsWith('BEGIN;') && paso2.endsWith('COMMIT;'), true);
check('PASO 2 contiene GUARDA, UPDATE y POST', ['DO $GUARDA$', 'UPDATE public.municipalities', 'DO $POST$'].every((x) => paso2.includes(x)), true);
check('ningún bloque tiene $ en comentarios',
  [paso1, paso2].some((b) => b.split('\n').some((l) => /^\s*--/.test(l) && l.includes('$'))), false);

// ═══════════════════════════════════════════════════════════
// 9 · MUTACIÓN CON EXPECTATIVA INVERTIDA
// ═══════════════════════════════════════════════════════════
const R = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutación sin ancla: ${a}`); return s.replace(a, b); };
const reglas = {
  forUpdate: (s) => { const g = bloque(s, 'GUARDA'); return g.includes('FOR UPDATE') && g.indexOf('FOR UPDATE') < g.indexOf('-- >> descubrimiento'); },
  refsCero: (s) => ['PRE', 'GUARDA'].every((t) => bloque(s, t).includes('IF v_refs <> 0 THEN')),
  soloNombre: (s) => { const u = sinComentarios(fueraDeDo(s)).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).find((x) => /^UPDATE/i.test(x)) || ''; return (u.match(/SET (.*) WHERE/i) || [])[1] === "name = 'San Miguel de Mercedes'"; },
  wherePrevio: (s) => sinComentarios(fueraDeDo(s)).includes("AND name = 'Cancasque'\n   AND department_id = 'CH'\n   AND district = 'Chalatenango Sur'"),
  huellaOtras: (s) => bloque(s, 'POST').includes("current_setting('s7_90.huella_otras_municipalities')"),
  districtPre: (s) => bloque(s, 'PRE').includes("v_fila.district IS DISTINCT FROM 'Chalatenango Sur'"),
  sinDolarComentario: (s) => s.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length === 0,
  postDentro: (s) => { const e = sinComentarios(s); return e.indexOf('DO $POST$') < e.indexOf('COMMIT;'); },
  descIdenticos: (s) => new Set(descubrimientos(s)).size === 1 && descubrimientos(s).length === 3,
  minimoColumnas: (s) => bloque(s, 'GUARDA').includes('IF v_cols < 3 THEN'),
};
const mutaciones = [
  ['quitar el FOR UPDATE', 'forUpdate', (s) => R(s, "WHERE m.id = 'CH-16'\n     FOR UPDATE;", "WHERE m.id = 'CH-16';")],
  ['tolerar referencias en la GUARDA', 'refsCero', (s) => s.replace(bloque(s, 'GUARDA'), R(bloque(s, 'GUARDA'), 'IF v_refs <> 0 THEN', 'IF v_refs > 1000 THEN'))],
  ['cambiar también el departamento', 'soloNombre', (s) => R(s, "SET name = 'San Miguel de Mercedes'\n", "SET name = 'San Miguel de Mercedes', department_id = 'CH'\n")],
  ['UPDATE sin el valor previo en el WHERE', 'wherePrevio', (s) => R(s, "\n   AND name = 'Cancasque'\n   AND department_id = 'CH'\n   AND district = 'Chalatenango Sur';", ';')],
  ['POST sin huella de las otras filas', 'huellaOtras', (s) => R(s, "IS DISTINCT FROM current_setting('s7_90.huella_otras_municipalities')", "IS DISTINCT FROM v_txt")],
  ['PRE sin exigir el agrupador', 'districtPre', (s) => s.replace(bloque(s, 'PRE'), R(bloque(s, 'PRE'), "\n     OR v_fila.district IS DISTINCT FROM 'Chalatenango Sur'", ''))],
  ['una etiqueta $…$ en un comentario', 'sinDolarComentario', (s) => R(s, '-- Si el PASO 1 lanza excepcion, NO continuar.', '-- Pegar desde DO $PRE$. Si el PASO 1 lanza excepcion, NO continuar.')],
  ['COMMIT antes del POST', 'postDentro', (s) => R(s, '-- ─── 3. Guardas POST', 'COMMIT;\n-- ─── 3. Guardas POST')],
  ['un descubrimiento divergente en el POST', 'descIdenticos', (s) => s.replace(bloque(s, 'POST'), R(bloque(s, 'POST'), "c.column_name ILIKE '%municipality%'", "c.column_name = 'municipality_id'"))],
  ['GUARDA sin mínimo de columnas', 'minimoColumnas', (s) => s.replace(bloque(s, 'GUARDA'), R(bloque(s, 'GUARDA'), 'IF v_cols < 3 THEN', 'IF v_cols < 0 THEN'))],
];
console.log('\n9 · reglas sobre la migración real (control)');
for (const [, regla] of mutaciones) check(`la migración cumple ${regla}`, reglas[regla](raw), true);
console.log('\n9.b · mutación con expectativa INVERTIDA');
for (const [nombre, regla, mut] of mutaciones) {
  let r;
  try { r = reglas[regla](mut(raw)); } catch (e) { r = e.message; }
  check(`detecta: ${nombre}`, r, false);
}
{
  let r;
  try {
    const m = rawRb.replace(bloque(rawRb, 'PREVIA'), R(bloque(rawRb, 'PREVIA'), 'IF v_refs <> 0 THEN', 'IF false THEN'));
    r = bloque(m, 'PREVIA').includes('IF v_refs <> 0 THEN');
  } catch (e) { r = e.message; }
  check('detecta: un rollback que revierte con referencias', r, false);
}

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
