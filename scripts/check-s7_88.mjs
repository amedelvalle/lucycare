#!/usr/bin/env node
/**
 * check-s7_88.mjs — Fundación 1 del modelo territorial genérico.
 *
 * El harness es deliberadamente más chico que el de `s7_86`: esta migración
 * solo CREA. Hay cuatro cosas que demostrar y ninguna más — **aditividad**,
 * **constraints**, **semilla** e **inexistencia de impacto** sobre lo vigente.
 *
 * La aserción decisiva de aditividad es una sola: el **DDL** —el texto entre
 * la guarda PRE y la guarda POST— no puede nombrar ningún objeto preexistente.
 * Las guardas sí los nombran, porque su trabajo es verificarlos, así que se
 * miden aparte. Esa separación es la lección de `s7_82` y de la primera
 * versión de `check-s7_86`: dos instrumentos que miden textos distintos dan
 * resultados distintos, y solo se nota al aplicar.
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

console.log('\ncheck-s7_88 — Fundación 1 del modelo territorial\n');

const P88 = path.join('migrations', 's7_88_geo_foundation_1.sql');
const PRB = path.join('docs', 'rollbacks', 's7_88_rollback.sql');
const PTY = path.join('src', 'types', 'database.types.ts');

/** CRLF → LF: `core.autocrlf=true` deja los .sql con CRLF en el working tree. */
const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');

const raw = leerLF(P88);
const rawRb = leerLF(PRB);
const types = leerLF(PTY);

const sinComentarios = (sql) =>
  sql.split('\n').map((l) => {
    const i = l.indexOf('--');
    return i === -1 ? l : l.slice(0, i);
  }).join('\n');

/** El DDL puro: lo que hay entre el cierre del PRE y la apertura del POST. */
const ddlDe = (sql) => {
  const s = sinComentarios(sql);
  const i = s.indexOf('END $PRE$;');
  const j = s.indexOf('DO $POST$');
  return i === -1 || j === -1 ? '' : s.slice(i + 'END $PRE$;'.length, j);
};

/**
 * Retira los literales de cadena. Un `COMMENT ON` es SQL EJECUTABLE, así que
 * `sinComentarios` no lo toca — y su texto nombra `doctors.booking_enabled`
 * para documentar que ese eje NO se mezcla. Una guarda que busca objetos
 * preexistentes tiene que mirar IDENTIFICADORES, no prosa dentro de comillas,
 * o convierte una nota de diseño en un FAIL.
 */
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");

const ddl = ddlDe(raw);
const ddlIdent = (r) => sinLiterales(ddlDe(r));
check('el DDL se aísla de las guardas', ddl.length > 500 && ddl.length < raw.length / 2, true);
check('el DDL no arrastra prosa', ddl.includes('POR QUE ESTO NO PUEDE ROMPER'), false);

// ═══════════════════════════════════════════════════════════
// 1 · LAS TRES TABLAS Y SU FORMA
// ═══════════════════════════════════════════════════════════
console.log('\n1 · las tres tablas');
has('crea countries', ddl, 'CREATE TABLE public.countries');
has('crea country_levels', ddl, 'CREATE TABLE public.country_levels');
has('crea administrative_units', ddl, 'CREATE TABLE public.administrative_units');
check('crea EXACTAMENTE 3 tablas', (ddl.match(/CREATE TABLE/g) || []).length, 3);

console.log('\n1.b · identidad interna y opaca');
has('countries.id es smallint identity', ddl,
  'id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
has('administrative_units.id es bigint identity', ddl,
  'id               bigint   GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
check('ninguna PK es un código externo',
  /PRIMARY KEY\s*\(\s*(iso_alpha2|official_code|legacy_id)/i.test(ddl), false);
has('iso_alpha2 es UNIQUE', ddl, 'CONSTRAINT countries_iso_alpha2_key   UNIQUE (iso_alpha2)');
has('el CHECK de formato vive en iso_alpha2, no en la PK', ddl,
  "CONSTRAINT countries_iso_alpha2_chk   CHECK (iso_alpha2 ~ '^[A-Z]{2}$')");

console.log('\n1.c · columnas de administrative_units');
for (const c of ['country_id', 'parent_id', 'level', 'name', 'legacy_id',
                 'official_code', 'official_source', 'official_version', 'is_active']) {
  has(`columna ${c}`, ddl, c);
}
check('legacy_id es anulable', /legacy_id\s+text,/.test(ddl), true);
check('official_code es anulable', /official_code\s+text,/.test(ddl), true);

// ═══════════════════════════════════════════════════════════
// 2 · CONSTRAINTS
// ═══════════════════════════════════════════════════════════
console.log('\n2 · constraints');
has('FK (country_id, level) → country_levels', ddl,
  'FOREIGN KEY (country_id, level) REFERENCES public.country_levels (country_id, level)');
has('UNIQUE (id, country_id) de soporte', ddl,
  'CONSTRAINT au_id_country_key UNIQUE (id, country_id)');
has('FK compuesta padre↔país', ddl,
  'FOREIGN KEY (parent_id, country_id)\n    REFERENCES public.administrative_units (id, country_id)');
has('check raíz ⇔ nivel 1', ddl,
  'CHECK ((parent_id IS NULL) = (level = 1))');
has('PK (country_id, level) en country_levels', ddl, 'PRIMARY KEY (country_id, level)');
has('level >= 1', ddl, 'CHECK (level >= 1)');

console.log('\n2.b · índices');
has('unique parcial de legacy_id (idempotencia del backfill de F2)', ddl,
  'CREATE UNIQUE INDEX au_country_legacy_key');
has('el unique de legacy_id es parcial', ddl, 'WHERE legacy_id IS NOT NULL');
has('unique parcial de official_code', ddl, 'CREATE UNIQUE INDEX au_country_level_official_code_key');
has('índice de primer nivel por país', ddl, 'au_country_level_active_idx');
has('índice de hijos por padre', ddl, 'au_parent_active_idx');
check('no hay índices de más', (ddl.match(/CREATE (UNIQUE )?INDEX/g) || []).length, 4);

// ═══════════════════════════════════════════════════════════
// 3 · SEMILLA
// ═══════════════════════════════════════════════════════════
console.log('\n3 · semilla');
has('siembra El Salvador', ddl, "VALUES ('SV', 'El Salvador', true, true)");
has('nivel 1 Departamento', ddl, "'Departamento', 'Departamentos'");
has('nivel 2 Municipio', ddl, "'Municipio',    'Municipios'");
has('nivel 3 Distrito', ddl, "'Distrito',     'Distritos'");
check('EXACTAMENTE 2 INSERT (país y niveles)', (ddl.match(/INSERT INTO/g) || []).length, 2);
check('NINGUNA unidad territorial se carga',
  /INSERT INTO public\.administrative_units/i.test(ddl), false);
has('el POST exige que administrative_units quede VACÍA', raw,
  'administrative_units debe quedar VACIA');

// ═══════════════════════════════════════════════════════════
// 4 · MÍNIMO PRIVILEGIO
// ═══════════════════════════════════════════════════════════
console.log('\n4 · mínimo privilegio');
check('RLS en las tres tablas', (ddl.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, 3);
check('CERO policies', /CREATE POLICY/i.test(ddl), false);
check('CERO grants', /\bGRANT\b/i.test(ddl), false);
check('REVOKE en las tres tablas', (ddl.match(/REVOKE ALL ON TABLE/g) || []).length, 3);
has('el REVOKE alcanza a service_role', ddl,
  'FROM PUBLIC, anon, authenticated, service_role');
has('el POST exige 0 policies', raw, 'policies, esperaba 0 (nadie la consume aun)');
has('el POST exige 0 privilegios de cliente', raw, 'privilegios de cliente, esperaba 0');

// ═══════════════════════════════════════════════════════════
// 5 · ADITIVIDAD — la aserción decisiva, con mutación invertida
// ═══════════════════════════════════════════════════════════
// El DDL no puede nombrar ni un solo objeto preexistente. Las guardas PRE/POST
// sí los nombran —es su trabajo— y por eso se miden por separado.
const guardas = [
  {
    nombre: 'el DDL no nombra clinics',
    ok: (d) => !/\bclinics\b/i.test(d),
    mutacion: (s) => s.replace('CREATE TABLE public.countries',
      'ALTER TABLE public.clinics ADD COLUMN country_id smallint;\n\nCREATE TABLE public.countries'),
  },
  {
    nombre: 'el DDL no nombra departments ni municipalities',
    ok: (d) => !/\b(departments|municipalities)\b/i.test(d),
    mutacion: (s) => s.replace('CREATE TABLE public.countries',
      'ALTER TABLE public.departments ADD COLUMN country_id smallint;\n\nCREATE TABLE public.countries'),
  },
  {
    nombre: 'el DDL no nombra doctors, profiles ni afiliación',
    ok: (d) => !/\b(doctors|profiles|doctor_affiliation_requests)\b/i.test(d),
    mutacion: (s) => s.replace('CREATE TABLE public.countries',
      'ALTER TABLE public.doctors ADD COLUMN country_id smallint;\n\nCREATE TABLE public.countries'),
  },
  {
    nombre: 'no borra nada',
    ok: (d) => !/\bDROP\b/i.test(d),
    mutacion: (s) => s.replace('CREATE TABLE public.countries',
      'DROP TABLE public.municipalities;\n\nCREATE TABLE public.countries'),
  },
  {
    nombre: 'no renombra nada',
    ok: (d) => !/\bRENAME\b/i.test(d),
    mutacion: (s) => s.replace('CREATE TABLE public.countries',
      'ALTER TABLE public.departments RENAME COLUMN id TO iso_code;\n\nCREATE TABLE public.countries'),
  },
  {
    nombre: 'no crea funciones ni triggers',
    ok: (d) => !/CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER)/i.test(d),
    mutacion: (s) => s.replace('CREATE TABLE public.countries',
      'CREATE FUNCTION public.rebuild_administrative_unit_paths() RETURNS void AS $x$ SELECT $x$ LANGUAGE sql;\n\nCREATE TABLE public.countries'),
  },
  {
    nombre: 'no adelanta administrative_unit_paths',
    ok: (d) => !/administrative_unit_paths/i.test(d),
    mutacion: (s) => s.replace('CREATE TABLE public.countries',
      'CREATE TABLE public.administrative_unit_paths (ancestor_id bigint, unit_id bigint);\n\nCREATE TABLE public.countries'),
  },
  {
    nombre: 'no adelanta Honduras',
    norm: 'literales',            // esta guarda vive justo dentro de un literal
    ok: (d) => !/'HN'/.test(d),
    mutacion: (s) => s.replace("VALUES ('SV', 'El Salvador', true, true)",
      "VALUES ('SV', 'El Salvador', true, true), ('HN', 'Honduras', false, false)"),
  },
  {
    nombre: 'no toca auth',
    ok: (d) => !/\bauth\./i.test(d),
    mutacion: (s) => s.replace('CREATE TABLE public.countries',
      "UPDATE auth.users SET phone = NULL;\n\nCREATE TABLE public.countries"),
  },
];

/** Cada guarda declara sobre qué texto es válida. */
const textoDe = (g, r) => (g.norm === 'literales' ? ddlDe(r) : ddlIdent(r));

console.log('\n5 · aditividad (control sobre el DDL)');
for (const g of guardas) check(g.nombre, g.ok(textoDe(g, raw)), true);

console.log('\n5.b · mutación con expectativa INVERTIDA');
for (const g of guardas) {
  check(`«${g.nombre}» SALTA con el defecto inyectado`, g.ok(textoDe(g, g.mutacion(raw))), false);
}

console.log('\n5.c · control del instrumento');
// Una mutación inocua no debe hacer saltar ninguna guarda.
const inocuo = raw + '\n-- comentario final\n';
check('ninguna guarda salta con un cambio inocuo',
  guardas.filter((g) => !g.ok(textoDe(g, inocuo))).length, 0);
// Y sobre el archivo COMPLETO varias saltan: las guardas PRE/POST nombran los
// objetos vigentes porque su trabajo es verificarlos. Por eso el DDL se aísla.
check('el archivo completo produce falsos positivos (por eso se aísla el DDL)',
  guardas.filter((g) => !g.ok(sinLiterales(sinComentarios(raw)))).length > 0, true);

// ═══════════════════════════════════════════════════════════
// 6 · CERO IMPACTO — lo verifica el POST en la base
// ═══════════════════════════════════════════════════════════
console.log('\n6 · guardas de cero impacto');
has('PRE exige los tres nombres libres', raw, 'de las tres tablas ya existen');
has('PRE ancla el catálogo legacy', raw, 'esperaba 14 departamentos');
has('PRE ancla las 7 FK', raw, 'esperaba 7 FK territoriales');
has('POST reverifica departments', raw, 'departments cambio de tamano');
has('POST reverifica municipalities', raw, 'municipalities cambio de tamano');
has('POST reverifica las 7 FK', raw, 'FK territoriales previas debian seguir intactas');
has('POST exige que clinics NO cambie', raw, 'clinics NO debe cambiar en Fundacion 1');
has('POST verifica doctor_booking_ready', raw, 'doctor_booking_ready fue alterada');
has('POST acota countries a 5 columnas', raw, 'countries debe tener 5 columnas');
has('POST acota administrative_units a 10 columnas', raw, 'administrative_units debe tener 10 columnas');
has('POST verifica que las PK son IDENTITY', raw, 'no es IDENTITY');

// ═══════════════════════════════════════════════════════════
// 7 · ROLLBACK
// ═══════════════════════════════════════════════════════════
console.log('\n7 · rollback');
has('borra administrative_units', rawRb, 'DROP TABLE IF EXISTS public.administrative_units');
has('borra country_levels', rawRb, 'DROP TABLE IF EXISTS public.country_levels');
has('borra countries', rawRb, 'DROP TABLE IF EXISTS public.countries');
check('borra EXACTAMENTE 3 tablas', (sinComentarios(rawRb).match(/DROP TABLE/g) || []).length, 3);
has('advierte si ya hay catálogo cargado', rawRb, 'ESTE ROLLBACK LO BORRA');
has('se verifica a sí mismo', rawRb, 'DO $ROLLBACK$');
has('exige conservar el catálogo legacy', rawRb, 'debian quedar las 7 FK territoriales');
check('el rollback NO toca objetos legacy',
  /DROP[^;]*\b(departments|municipalities|clinics|doctors)\b/i.test(sinComentarios(rawRb)), false);

// ═══════════════════════════════════════════════════════════
// 8 · TIPOS
// ═══════════════════════════════════════════════════════════
console.log('\n8 · database.types.ts');
has('declara countries', types, 'countries: {');
has('declara country_levels', types, 'country_levels: {');
has('declara administrative_units', types, 'administrative_units: {');
has('countries.id es number', types, 'iso_alpha2: string');
has('las PK IDENTITY no son insertables', types, 'id?: never');
has('relación au_country_level_fkey', types, 'foreignKeyName: "au_country_level_fkey"');
has('relación au_parent_country_fkey', types, 'foreignKeyName: "au_parent_country_fkey"');
has('la FK compuesta declara sus dos columnas', types, 'columns: ["parent_id", "country_id"]');
check('los tipos NO declaran administrative_unit_paths',
  types.includes('administrative_unit_paths'), false);
check('clinics NO gana columnas en los tipos',
  /clinics: \{[\s\S]{0,600}?territory_unit_id/.test(types), false);

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
