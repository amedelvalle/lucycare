#!/usr/bin/env node
/**
 * check-s7_88.mjs — Fundación 2A: carga del catálogo territorial de SV.
 *
 * La migración lleva 320 nombres literales. Esa lista es el dato, así que el
 * check no se limita a contarla: valida su **integridad relacional interna**
 * —cada padre citado en un nivel existe como nombre en el nivel de arriba— y
 * comprueba que las **siete correcciones autorizadas** están presentes y que
 * las **cuatro diferencias conservadas** no se «arreglaron» de más.
 *
 * ⚠️ ALCANCE. El CSV del catálogo candidato NO está versionado (decisión del
 * owner), así que este check **no puede re-derivar la lista desde su origen**.
 * Valida la migración contra sí misma y contra las decisiones declaradas. La
 * equivalencia byte a byte con el candidato se demostró al generarla, fuera del
 * repositorio, y su SHA-256 queda citado en la cabecera de la migración.
 *
 *   node scripts/check-s7_88.mjs
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

console.log('\ncheck-s7_88 — Fundación 2A · catálogo territorial de El Salvador\n');

const P88 = path.join('migrations', 's7_88_geo_foundation_2a_sv_catalog.sql');
const PRB = path.join('docs', 'rollbacks', 's7_88_rollback.sql');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const raw = leerLF(P88);
const rawRb = leerLF(PRB);

const sinComentarios = (sql) =>
  sql.split('\n').map((l) => {
    const i = l.indexOf('--');
    return i === -1 ? l : l.slice(0, i);
  }).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");

/** El SQL ejecutable: de la apertura del PRE al final. */
const exe = sinComentarios(raw);

// ═══════════════════════════════════════════════════════════
// 0 · ATOMICIDAD
// ═══════════════════════════════════════════════════════════
console.log('0 · atomicidad');
const pos = (n) => exe.indexOf(n);
check('exactamente un BEGIN', (exe.match(/^BEGIN;/gm) || []).length, 1);
check('exactamente un COMMIT', (exe.match(/^COMMIT;/gm) || []).length, 1);
check('el PRE queda FUERA de la transacción', pos('END $PRE$;') < pos('BEGIN;'), true);
check('la carga va DENTRO', pos('BEGIN;') < pos('DO $CARGA$') && pos('DO $CARGA$') < pos('COMMIT;'), true);
check('el POST va DENTRO y antes del COMMIT',
  pos('DO $POST$') > pos('BEGIN;') && pos('END $POST$;') < pos('COMMIT;'), true);
check('nada después del COMMIT', exe.slice(pos('COMMIT;') + 'COMMIT;'.length).trim(), '');
check('sin sentencias incompatibles con transacción',
  /CREATE\s+INDEX\s+CONCURRENTLY|\bVACUUM\b|ALTER\s+SYSTEM/i.test(exe), false);

// ═══════════════════════════════════════════════════════════
// 1 · SOLO INSERTA, Y SOLO EN administrative_units
// ═══════════════════════════════════════════════════════════
console.log('\n1 · alcance: solo inserta en administrative_units');
const exeIdent = sinLiterales(exe);
check('cero ALTER', /\bALTER\s+TABLE\b/i.test(exeIdent), false);
check('cero DROP', /\bDROP\b/i.test(exeIdent), false);
check('cero CREATE de objetos', /CREATE\s+(TABLE|INDEX|FUNCTION|TRIGGER|POLICY|SEQUENCE)/i.test(exeIdent), false);
check('cero GRANT', /\bGRANT\b/i.test(exeIdent), false);
check('cero UPDATE', /\bUPDATE\s+public\./i.test(exeIdent), false);
check('cero DELETE', /\bDELETE\s+FROM\b/i.test(exeIdent), false);
const inserts = exeIdent.match(/INSERT\s+INTO\s+public\.(\w+)/gi) || [];
check('exactamente 3 INSERT', inserts.length, 3);
check('los 3 INSERT van a administrative_units',
  inserts.every((s) => /administrative_units/i.test(s)), true);
check('no toca auth', /\bauth\./i.test(exeIdent), false);

// ═══════════════════════════════════════════════════════════
// 2 · SIN IDs MÁGICOS: país y padres se resuelven relacionalmente
// ═══════════════════════════════════════════════════════════
console.log('\n2 · sin ids literales');
has('el país se resuelve por iso_alpha2', exe, "FROM public.countries WHERE iso_alpha2 = 'SV'");
check('el país se resuelve con INTO STRICT en la carga',
  (exe.match(/INTO STRICT v_pais/g) || []).length >= 2, true);
check('nunca un country_id literal', /country_id\s*(=|:)\s*\d/.test(exeIdent), false);
check('nunca un parent_id literal', /parent_id\s*=\s*\d/.test(exeIdent), false);
has('el nivel 2 resuelve su padre por nombre en el nivel 1', exe,
  'ON p.country_id = v_pais AND p.level = 1 AND p.name = d.padre');
has('el nivel 3 resuelve su padre por nombre en el nivel 2', exe,
  'ON p.country_id = v_pais AND p.level = 2 AND p.name = d.padre');
// Cada INSERT verifica cuántas filas entró: un JOIN sin padre no puede pasar.
check('los 3 INSERT comprueban su ROW_COUNT',
  (exe.match(/GET DIAGNOSTICS v_n = ROW_COUNT/g) || []).length, 3);
has('nivel 1 exige 14', exe, "nivel 1 inserto % filas, esperaba 14");
has('nivel 2 exige 44', exe, "nivel 2 inserto % filas, esperaba 44");
has('nivel 3 exige 262', exe, "nivel 3 inserto % filas, esperaba 262");

// ═══════════════════════════════════════════════════════════
// 3 · LOS 320 REGISTROS Y SU INTEGRIDAD RELACIONAL
// ═══════════════════════════════════════════════════════════
console.log('\n3 · los 320 registros');
/** Extrae las tuplas literales de cada bloque VALUES, en orden. */
function tuplas(sql, desde, hasta) {
  const a = sql.indexOf(desde), b = sql.indexOf(hasta, a);
  const trozo = sql.slice(a, b === -1 ? undefined : b);
  return [...trozo.matchAll(/^\s*\((.+)\),?\s*$/gm)]
    .map((m) => [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'")))
    // La lista de columnas del INSERT también abre y cierra paréntesis, pero no
    // lleva literales. Una fila de VALUES siempre los lleva.
    .filter((t) => t.length > 0);
}
// Delimitadores ÚNICOS. El encabezado del archivo también dice «nivel 3 · 262
// distritos», así que se usan los marcadores de sección (con ──) y la firma
// `AS d(...)` de cada bloque, que es distinta en cada nivel.
const M1 = ['── nivel 1 ·', 'AS d(nombre, legacy)'];
const M2 = ['── nivel 2 ·', 'AS d(padre, nombre)'];
const M3 = ['── nivel 3 ·', 'AS d(padre, nombre, legacy)'];
const n1 = tuplas(raw, ...M1);
const n2 = tuplas(raw, ...M2);
const n3 = tuplas(raw, ...M3);

check('nivel 1 · 14 tuplas', n1.length, 14);
check('nivel 2 · 44 tuplas', n2.length, 44);
check('nivel 3 · 262 tuplas', n3.length, 262);
check('total 320', n1.length + n2.length + n3.length, 320);

const nom1 = n1.map((t) => t[0]);
const nom2 = n2.map((t) => t[1]);
check('nombres de departamento únicos', new Set(nom1).size, 14);
check('nombres de municipio únicos', new Set(nom2).size, 44);
check('legacy de nivel 1 únicos', new Set(n1.map((t) => t[1])).size, 14);
check('legacy de nivel 3 únicos', new Set(n3.map((t) => t[2])).size, 262);

// Integridad relacional DE LA PROPIA LISTA: todo padre citado existe.
const padres2 = [...new Set(n2.map((t) => t[0]))];
check('todo padre del nivel 2 existe en el nivel 1',
  padres2.filter((p) => !nom1.includes(p)).join(', '), '');
const padres3 = [...new Set(n3.map((t) => t[0]))];
check('todo padre del nivel 3 existe en el nivel 2',
  padres3.filter((p) => !nom2.includes(p)).join(', '), '');
check('los 44 municipios tienen al menos un distrito',
  nom2.filter((m) => !padres3.includes(m)).join(', '), '');
check('los 14 departamentos tienen al menos un municipio',
  nom1.filter((d) => !padres2.includes(d)).join(', '), '');

// Los prefijos legacy tienen que corresponder al departamento. Es la única
// comprobación que mira el FORMATO del legacy_id, y solo como control cruzado
// interno: el formato no es contrato, pero si un distrito 'SS-12' colgara de
// Ahuachapán, algo se torció al generar.
const legacyDeDep = new Map(n1.map((t) => [t[0], t[1]]));
const depDeMun = new Map(n2.map((t) => [t[1], t[0]]));
const descuadres = n3.filter((t) => {
  const dep = depDeMun.get(t[0]);
  return !String(t[2]).startsWith(`${legacyDeDep.get(dep)}-`);
}).map((t) => `${t[2]} bajo ${t[0]}`);
check('el prefijo de cada legacy de nivel 3 casa con su departamento',
  descuadres.join(', '), '');

// ═══════════════════════════════════════════════════════════
// 4 · legacy_id SOLO DONDE HAY PUENTE REAL
// ═══════════════════════════════════════════════════════════
console.log('\n4 · legacy_id');
check('las tuplas de nivel 2 no llevan legacy', n2.every((t) => t.length === 2), true);
has('el nivel 2 inserta NULL como legacy_id', exe, '2, d.nombre, NULL, NULL, c_src, c_date');
has('el POST prohíbe legacy_id en el nivel 2', raw,
  'municipios con legacy_id — los de 2023 NO tienen equivalente legacy');
has('el POST exige legacy_id en niveles 1 y 3', raw,
  'unidades de nivel 1 o 3 SIN legacy_id');
has('el POST exige correspondencia con departments', raw,
  'legacy_id de nivel 1 no existen en departments');
has('el POST exige correspondencia con municipalities', raw,
  'legacy_id de nivel 3 no existen en municipalities');
has('el POST comprueba también el sentido inverso (nivel 1)', raw,
  'departamentos legacy sin unidad que los puentee');
has('el POST comprueba también el sentido inverso (nivel 3)', raw,
  'municipios legacy sin unidad que los puentee');

// ═══════════════════════════════════════════════════════════
// 5 · official_code NULL, fuente y fecha registradas
// ═══════════════════════════════════════════════════════════
console.log('\n5 · metadatos oficiales');
check('official_code se inserta NULL en los 3 niveles',
  (exe.match(/NULL, c_src, c_date/g) || []).length, 3);
has('la fuente cita DL 762 y su reforma DL 978', exe,
  "'DL 762 (DO 110, T.439, 14/06/2023), reformado por DL 978 (DO 63, T.443, 05/04/2024)'");
has('la fecha de fuente es la de la reforma vigente', exe, "DATE '2024-04-05'");
has('el POST prohíbe cualquier official_code', raw,
  'unidades con official_code — no se infiere ninguno');
has('el POST exige fuente y fecha en todas', raw, 'unidades sin fuente o sin fecha de fuente');
has('el POST exige una sola fuente', raw, 'la fuente deberia ser una sola');

// ═══════════════════════════════════════════════════════════
// 6 · LAS SIETE CORRECCIONES, PRESENTES
// ═══════════════════════════════════════════════════════════
console.log('\n6 · las 7 correcciones autorizadas');
const buscar3 = (nombre) => n3.find((t) => t[1] === nombre);
const conLegacy = (legacy) => n3.find((t) => t[2] === legacy);

check('CH-16 es San Miguel de Mercedes', conLegacy('CH-16')?.[1], 'San Miguel de Mercedes');
check('ya no existe ningún «Cancasque» suelto', !!buscar3('Cancasque'), false);
check('San José Cancasque sigue existiendo', !!buscar3('San José Cancasque'), true);
check('SS-12 es San Salvador y Capital de la República',
  conLegacy('SS-12')?.[1], 'San Salvador y Capital de la República');
check('LU-09 es San José La Fuente', conLegacy('LU-09')?.[1], 'San José La Fuente');
check('SM-07 es San Antonio del Mosco', conLegacy('SM-07')?.[1], 'San Antonio del Mosco');
check('CU-06 (Santa Cruz Michapa) cuelga de Cuscatlán Sur', conLegacy('CU-06')?.[0], 'Cuscatlán Sur');
check('CU-07 (Tenancingo) cuelga de Cuscatlán Sur', conLegacy('CU-07')?.[0], 'Cuscatlán Sur');
check('US-23 (California) cuelga de Usulután Este', conLegacy('US-23')?.[0], 'Usulután Este');

console.log('\n6.b · los padres afectados quedan con su tamaño correcto');
const cuenta = (mun) => n3.filter((t) => t[0] === mun).length;
check('Cuscatlán Norte con 5', cuenta('Cuscatlán Norte'), 5);
check('Cuscatlán Sur con 11', cuenta('Cuscatlán Sur'), 11);
check('Usulután Norte con 9', cuenta('Usulután Norte'), 9);
check('Usulután Este con 10', cuenta('Usulután Este'), 10);
check('Chalatenango Sur con 20', cuenta('Chalatenango Sur'), 20);
check('San Salvador Centro con 5', cuenta('San Salvador Centro'), 5);

// ═══════════════════════════════════════════════════════════
// 7 · LAS CUATRO DIFERENCIAS CONSERVADAS, NO «ARREGLADAS»
// ═══════════════════════════════════════════════════════════
console.log('\n7 · las 4 diferencias conservadas a propósito');
check('SO-01 conserva Juayúa con tilde', conLegacy('SO-01')?.[1], 'Juayúa');
check('CH-27 conserva «de la Cruz» en minúscula', conLegacy('CH-27')?.[1], 'San Antonio de la Cruz');
check('SA-13 conserva «de la Frontera» en minúscula', conLegacy('SA-13')?.[1], 'Santiago de la Frontera');
check('SM-05 conserva «de la Reina» en minúscula', conLegacy('SM-05')?.[1], 'San Luis de la Reina');

// ═══════════════════════════════════════════════════════════
// 8 · GUARDAS PRE Y POST
// ═══════════════════════════════════════════════════════════
console.log('\n8 · guardas');
has('PRE exige las 3 tablas de Fundación 1', raw, 'faltan tablas de Fundacion 1');
has('PRE resuelve el país y aborta si falta', raw, 'no existe el pais SV en countries');
has('PRE exige los 3 niveles declarados', raw, 'debe tener los niveles 1, 2 y 3 declarados');
has('PRE aborta si ya hay unidades de SV (idempotencia)', raw,
  'ya tiene % unidades de SV — no reaplicar');
has('PRE ancla el catálogo legacy', raw, 'esperaba 14 departamentos');
has('PRE ancla las 7 FK', raw, 'esperaba 7 FK territoriales');

console.log('\n8.b · POST: conteos, jerarquía, huérfanos, cruces de país');
has('POST exige 320', raw, 'esperaba 320 unidades de SV');
has('POST exige 14 / 44 / 262', raw, 'nivel 3 tiene %, esperaba 262');
has('POST prohíbe unidades de otro país', raw, 'unidades de otro pais');
has('POST prohíbe raíces con padre', raw, 'raices con padre');
has('POST prohíbe huérfanas', raw, 'unidades no raiz SIN padre (huerfanas)');
has('POST verifica padre existente, mismo país y nivel correcto', raw,
  'unidades con padre inexistente, de otro pais o de nivel incorrecto');
has('POST verifica que los 262 alcanzan su raíz en dos saltos', raw,
  'distritos alcanzan su raiz en dos saltos');
has('POST prohíbe municipios sin distritos', raw, 'municipios sin ningun distrito');
has('POST prohíbe departamentos sin municipios', raw, 'departamentos sin ningun municipio');

console.log('\n8.c · POST: nada del modelo vigente cambió');
has('POST reverifica departments', raw, 'departments cambio de tamano');
has('POST reverifica municipalities', raw, 'municipalities cambio de tamano');
has('POST reverifica las 7 FK', raw, 'las 7 FK territoriales cambiaron');
has('POST exige que clinics NO cambie', raw, 'clinics NO debe cambiar en Fundacion 2A');
has('POST verifica doctor_booking_ready', raw, 'doctor_booking_ready fue alterada');
has('POST verifica que no se abrieron privilegios', raw, 'privilegios de cliente');
has('POST exige que ninguna unidad nazca inactiva', raw, 'unidades nacieron inactivas');

// ═══════════════════════════════════════════════════════════
// 9 · ROLLBACK
// ═══════════════════════════════════════════════════════════
console.log('\n9 · rollback');
const exeRb = sinComentarios(rawRb);
check('borra por nivel, de hijos a padres',
  exeRb.indexOf('level = 3') < exeRb.indexOf('level = 2')
  && exeRb.indexOf('level = 2') < exeRb.indexOf('level = 1'), true);
check('acota el borrado al país SV',
  (exeRb.match(/iso_alpha2 = 'SV'/g) || []).length >= 3, true);
check('el rollback NO borra countries ni country_levels',
  /DELETE\s+FROM\s+public\.(countries|country_levels)/i.test(exeRb), false);
check('el rollback NO toca el legacy',
  /DELETE\s+FROM\s+public\.(departments|municipalities|clinics)/i.test(exeRb), false);
check('es atómico', (exeRb.match(/^BEGIN;/gm) || []).length, 1);
check('el COMMIT va después de la verificación',
  exeRb.indexOf('END $ROLLBACK$;') < exeRb.indexOf('COMMIT;'), true);
has('advierte sobre dependencias de Fundación 3', rawRb, 'territory_unit_id');

// ═══════════════════════════════════════════════════════════
// 10 · MUTACIÓN CON EXPECTATIVA INVERTIDA
// ═══════════════════════════════════════════════════════════
// Una lista de 320 nombres no se valida a ojo: estas guardas tienen que
// demostrar que detectan una lista corrompida.
const guardas = [
  {
    nombre: 'detecta un padre inexistente en el nivel 3',
    prueba: (s) => {
      const t3 = tuplas(s, ...M3);
      const t2 = tuplas(s, ...M2).map((t) => t[1]);
      return [...new Set(t3.map((t) => t[0]))].every((p) => t2.includes(p));
    },
    mutar: (s) => s.replace("('Cabañas Este', 'Dolores', 'CA-03')",
                            "('Cabañas Inexistente', 'Dolores', 'CA-03')"),
  },
  {
    nombre: 'detecta un conteo de nivel alterado',
    prueba: (s) => tuplas(s, ...M3).length === 262,
    mutar: (s) => s.replace("    ('Cabañas Este', 'Dolores', 'CA-03'),\n", ''),
  },
  {
    nombre: 'detecta una corrección deshecha',
    prueba: (s) => {
      const t3 = tuplas(s, ...M3);
      return t3.find((t) => t[2] === 'CH-16')?.[1] === 'San Miguel de Mercedes';
    },
    mutar: (s) => s.replace("'San Miguel de Mercedes', 'CH-16'", "'Cancasque', 'CH-16'"),
  },
  {
    nombre: 'detecta un legacy_id inventado en el nivel 2',
    prueba: (s) => tuplas(s, ...M2).every((t) => t.length === 2),
    mutar: (s) => s.replace("('Cabañas', 'Cabañas Este')", "('Cabañas', 'Cabañas Este', 'CA-M01')"),
  },
  {
    nombre: 'detecta un prefijo legacy que no casa con su departamento',
    prueba: (s) => {
      const t1 = tuplas(s, ...M1);
      const t2 = tuplas(s, ...M2);
      const t3 = tuplas(s, ...M3);
      const legDep = new Map(t1.map((t) => [t[0], t[1]]));
      const depMun = new Map(t2.map((t) => [t[1], t[0]]));
      return t3.every((t) => String(t[2]).startsWith(`${legDep.get(depMun.get(t[0]))}-`));
    },
    mutar: (s) => s.replace("'Dolores', 'CA-03'", "'Dolores', 'AH-03'"),
  },
  {
    nombre: 'detecta un id de país literal',
    prueba: (s) => !/country_id\s*(=|:)\s*\d/.test(sinLiterales(sinComentarios(s))),
    mutar: (s) => s.replace('SELECT id INTO STRICT v_pais FROM public.countries', 'SELECT 1 AS id INTO STRICT v_pais FROM public.countries WHERE country_id = 1 --'),
  },
  {
    nombre: 'detecta un official_code inventado',
    prueba: (s) => (sinComentarios(s).match(/NULL, c_src, c_date/g) || []).length === 3,
    mutar: (s) => s.replace("1, d.nombre, d.legacy, NULL, c_src, c_date",
                            "1, d.nombre, d.legacy, 'SV-' || d.legacy, c_src, c_date"),
  },
  {
    nombre: 'detecta un ALTER colado',
    prueba: (s) => !/\bALTER\s+TABLE\b/i.test(sinLiterales(sinComentarios(s))),
    mutar: (s) => s.replace('BEGIN;\n', 'BEGIN;\nALTER TABLE public.clinics ADD COLUMN territory_unit_id bigint;\n'),
  },
  {
    nombre: 'detecta que el POST salga de la transacción',
    prueba: (s) => {
      const e = sinComentarios(s);
      return e.indexOf('DO $POST$') < e.indexOf('COMMIT;');
    },
    mutar: (s) => s.replace('COMMIT;\n-- ═', 'COMMIT;\nDO $POST$ BEGIN END $POST$;\n-- ═')
                   .replace(/DO \$POST\$\nDECLARE[\s\S]*?END \$POST\$;\n/, ''),
  },
];

console.log('\n10 · guardas de la lista (control)');
for (const g of guardas) check(g.nombre.replace('detecta', 'la lista cumple:'), g.prueba(raw), true);

console.log('\n10.b · mutación con expectativa INVERTIDA');
for (const g of guardas) {
  const mutado = g.mutar(raw);
  check(`«${g.nombre}» con el defecto inyectado`, g.prueba(mutado), false);
}
console.log('\n10.c · control del instrumento');
check('ninguna guarda salta con un cambio inocuo',
  guardas.filter((g) => !g.prueba(`${raw}\n-- comentario final\n`)).length, 0);

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
