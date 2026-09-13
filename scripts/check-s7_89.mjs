#!/usr/bin/env node
/**
 * check-s7_89.mjs — Fundación 3A: columnas territoriales en `clinics`.
 *
 * F3A añade dos columnas NULL que nadie usa. Lo que hay que demostrar no es
 * que existan, sino que **siguen sin consumidores**: después de aplicarla,
 * todos los flujos dependen exclusivamente del modelo legacy. Por eso el grueso
 * del check es un **barrido de la superficie real** —`src/`, `middleware.ts`,
 * `og-meta.mjs`, Edge Functions y el **cuerpo vigente** de cada función SQL—
 * buscando cualquier lectura o escritura de las columnas nuevas.
 *
 * Sobre SQL, se toma la ÚLTIMA definición de cada función: una función puede
 * redefinirse después en un archivo que ya no toca la columna, y un barrido por
 * archivo daría falsos positivos o falsos negativos.
 *
 *   node scripts/check-s7_89.mjs
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

console.log('\ncheck-s7_89 — Fundación 3A · columnas territoriales en clinics\n');

const P89 = path.join('migrations', 's7_89_geo_foundation_3a_clinics_columns.sql');
const PRB = path.join('docs', 'rollbacks', 's7_89_rollback.sql');
const PTY = path.join('src', 'types', 'database.types.ts');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const raw = leerLF(P89);
const rawRb = leerLF(PRB);
const types = leerLF(PTY);

const sinComentarios = (sql) => sql.split('\n').map((l) => {
  const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i);
}).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
const exe = sinComentarios(raw);
const exeIdent = sinLiterales(exe);

/** El DDL puro: entre el BEGIN y el bloque POST. */
const ddlDe = (s) => {
  const e = sinLiterales(sinComentarios(s));
  const a = e.indexOf('BEGIN;'), b = e.indexOf('DO $POST$');
  return a === -1 || b === -1 ? '' : e.slice(a, b);
};
const ddl = ddlDe(raw);

// ═══════════════════════════════════════════════════════════
// 0 · ATOMICIDAD
// ═══════════════════════════════════════════════════════════
console.log('0 · atomicidad');
const pos = (n) => exe.indexOf(n);
check('exactamente un BEGIN', (exe.match(/^BEGIN;/gm) || []).length, 1);
check('exactamente un COMMIT', (exe.match(/^COMMIT;/gm) || []).length, 1);
check('el PRE queda FUERA de la transacción', pos('END $PRE$;') < pos('BEGIN;'), true);
check('el POST corre DENTRO y antes del COMMIT',
  pos('DO $POST$') > pos('BEGIN;') && pos('END $POST$;') < pos('COMMIT;'), true);
check('nada después del COMMIT', exe.slice(pos('COMMIT;') + 'COMMIT;'.length).trim(), '');
check('sin CREATE INDEX CONCURRENTLY (no admite transacción)',
  /CONCURRENTLY/i.test(exe), false);

// ═══════════════════════════════════════════════════════════
// 1 · EL DDL EXACTO
// ═══════════════════════════════════════════════════════════
console.log('\n1 · el DDL');
has('añade country_id smallint', ddl, 'ADD COLUMN country_id        smallint');
has('añade territory_unit_id bigint', ddl, 'ADD COLUMN territory_unit_id bigint');
has('FK individual country_id → countries', ddl,
  'FOREIGN KEY (country_id) REFERENCES public.countries (id)');
has('FK compuesta → administrative_units (id, country_id)', ddl,
  'FOREIGN KEY (territory_unit_id, country_id)\n  REFERENCES public.administrative_units (id, country_id)');
has('CHECK que exige país cuando hay unidad', ddl,
  'CHECK (territory_unit_id IS NULL OR country_id IS NOT NULL)');
has('índice de country_id', ddl, 'CREATE INDEX clinics_country_id_idx        ON public.clinics (country_id)');
has('índice de territory_unit_id', ddl,
  'CREATE INDEX clinics_territory_unit_id_idx ON public.clinics (territory_unit_id)');
check('exactamente 2 índices', (ddl.match(/CREATE\s+INDEX/gi) || []).length, 2);
check('exactamente 3 constraints', (ddl.match(/ADD\s+CONSTRAINT/gi) || []).length, 3);

// ═══════════════════════════════════════════════════════════
// 2 · LO QUE F3A NO HACE
// ═══════════════════════════════════════════════════════════
console.log('\n2 · alcance: sin datos, sin helper, sin consumidores');
check('sin DEFAULT', /\bDEFAULT\b/i.test(ddl), false);
check('sin NOT NULL en las columnas nuevas', /country_id\s+smallint\s+NOT\s+NULL|territory_unit_id\s+bigint\s+NOT\s+NULL/i.test(ddl), false);
check('sin backfill: cero UPDATE', /\bUPDATE\s+public\./i.test(ddl), false);
check('sin INSERT', /\bINSERT\s+INTO\b/i.test(ddl), false);
check('sin DELETE', /\bDELETE\s+FROM\b/i.test(ddl), false);
check('sin helper: cero CREATE FUNCTION', /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(exeIdent), false);
check('sin trigger', /CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i.test(exeIdent), false);
check('sin grants nuevos', /\bGRANT\b/i.test(exeIdent), false);
check('sin REVOKE', /\bREVOKE\b/i.test(exeIdent), false);
check('sin policies', /CREATE\s+POLICY/i.test(exeIdent), false);
check('sin DROP', /\bDROP\b/i.test(ddl), false);
check('sin RENAME', /\bRENAME\b/i.test(ddl), false);
const alters = ddl.match(/ALTER\s+TABLE\s+public\.(\w+)/gi) || [];
check('solo altera clinics', alters.every((a) => /clinics$/i.test(a)) && alters.length > 0, true);
check('no toca profiles, afiliación ni doctors',
  /ALTER\s+TABLE\s+public\.(profiles|doctor_affiliation_requests|doctors)\b/i.test(ddl), false);
check('no toca las columnas legacy', /department_id|municipality_id/.test(ddl), false);
check('no toca auth', /\bauth\./i.test(exeIdent), false);

// ═══════════════════════════════════════════════════════════
// 3 · GUARDAS
// ═══════════════════════════════════════════════════════════
console.log('\n3 · guardas PRE');
has('PRE exige Fundación 1', raw, 'faltan tablas de Fundacion 1');
has('PRE exige las 320 unidades de F2A', raw, 'esperaba las 320 unidades de SV');
has('PRE exige el soporte de la FK compuesta', raw, 'falta au_id_country_key');
has('PRE aborta si las columnas ya existen (idempotencia)', raw, 'ya tiene % de las columnas nuevas — no reaplicar');
has('PRE ancla las columnas legacy', raw, 'clinics deberia tener department_id y municipality_id');
has('PRE ancla las 7 FK legacy', raw, 'esperaba 7 FK territoriales legacy');

console.log('\n3.b · guardas POST');
has('POST exige los tipos', raw, 'clinics.territory_unit_id deberia ser bigint');
has('POST exige nullable y sin default', raw, 'deben ser NULLABLE y SIN DEFAULT');
has('POST verifica la FK compuesta de 2 columnas', raw, 'no existe o no tiene 2 columnas');
has('POST verifica el CHECK', raw, 'falta el CHECK que exige pais cuando hay unidad');
has('POST exige TODOS los valores nuevos NULL', raw, 'F3A no rellena nada');
has('POST verifica columnas legacy intactas', raw, 'las columnas legacy de clinics cambiaron');
has('POST verifica las 7 FK legacy', raw, 'las 7 FK territoriales legacy cambiaron');
has('POST verifica que F2A no cambió', raw, 'administrative_units cambio');
has('POST verifica que profiles/afiliación/doctors no cambian', raw,
  'profiles, doctor_affiliation_requests o doctors ganaron columnas territoriales');
has('POST verifica doctor_booking_ready', raw, 'doctor_booking_ready fue alterada');
has('POST mide privilegios en vez de suponerlos', raw, 'F3A no puede ampliar acceso');
has('POST reporta los privilegios medidos', raw, 'privilegio medido');

// ═══════════════════════════════════════════════════════════
// 4 · NINGÚN RUNTIME LEE NI ESCRIBE LAS COLUMNAS NUEVAS
// ═══════════════════════════════════════════════════════════
console.log('\n4 · cero lectores y escritores de las columnas nuevas');

/** Recorre un directorio devolviendo [ruta, contenido] de .ts/.tsx/.mjs/.js. */
const recorrer = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) acc.push([p, leerLF(p)]);
  }
  return acc;
};

const superficieApp = [
  ...recorrer('src').filter(([p]) => !p.endsWith('database.types.ts')),
  ...['middleware.ts', 'og-meta.mjs'].filter((f) => fs.existsSync(f)).map((f) => [f, leerLF(f)]),
  ...recorrer(path.join('supabase', 'functions')),
];

/**
 * Detector de consumo del modelo territorial nuevo.
 *
 * ⚠️ No basta con buscar nombres de columna. PostgREST lee relaciones con
 * EMBEDS —`clinics(..., administrative_units(name))`— y ese select nunca
 * nombra `territory_unit_id`. Así leen hoy la ubicación legacy `middleware.ts`
 * y `og-meta.mjs` (`municipalities(name)`), y un detector de columnas no los
 * veía: lo destapó el control positivo de abajo.
 *
 * Cuenta como consumo cualquiera de:
 *   · las columnas nuevas, en snake_case o camelCase;
 *   · `.from('<tabla nueva>')`;
 *   · un embed de una tabla nueva (`administrative_units(`, `countries!`, …).
 *
 * `countries` colisiona con arrays JS locales (`authPhone.ts`, `LoginModal`),
 * así que para esa tabla solo cuentan `.from('countries')` o el nombre seguido
 * INMEDIATAMENTE de `(` o `!`, que es la sintaxis de embed.
 */
const RE_CONSUMO_NUEVO = new RegExp([
  String.raw`\bterritory_unit_id\b`, String.raw`\bcountry_id\b`,
  String.raw`\bterritoryUnitId\b`, String.raw`\bcountryId\b`,
  String.raw`\bfrom\(\s*['"\x60](administrative_units|administrative_unit_paths|country_levels|countries)['"\x60]\s*\)`,
  String.raw`\b(administrative_units|administrative_unit_paths|country_levels)\b`,
  String.raw`\bcountries\s*[(!]`,
  // Lector AGUAS ABAJO: accede a la propiedad del objeto ya traído, como hace
  // hoy og-meta.mjs con `clinic.municipalities`. El lookbehind excluye el
  // spread `[...countries]` de authPhone.ts, que si no casaría.
  String.raw`(?<!\.)\.countries\b`,
].join('|'));

const consumidoresApp = (archivos) => archivos
  .filter(([, c]) => RE_CONSUMO_NUEVO.test(c))
  .map(([p]) => p);

/** Mismo criterio para el legacy: columnas o embeds de sus catálogos. */
const RE_CONSUMO_LEGACY = /\bdepartment_id\b|\bmunicipality_id\b|\b(departments|municipalities)\s*[(!]|from\(\s*['"`](departments|municipalities)['"`]\s*\)|(?<!\.)\.(departments|municipalities)\b/;

check('src/, middleware, og-meta y Edge Functions no usan las columnas nuevas',
  consumidoresApp(superficieApp).join(', '), '');
check('la superficie inspeccionada no está vacía (si lo estuviera, el cero no mediría nada)',
  superficieApp.length > 50, true);

// CONTROL POSITIVO SOBRE DATOS REALES. Un cero solo significa algo si el mismo
// barrido, sobre la misma superficie, SÍ encuentra lo que sabemos que existe.
// Los lectores legacy conocidos de la ubicación tienen que aparecer.
const consumidoresLegacy = superficieApp
  .filter(([, c]) => RE_CONSUMO_LEGACY.test(c)).map(([p]) => p.split(path.sep).join('/'));
for (const conocido of ['src/services/directory.service.ts', 'middleware.ts', 'og-meta.mjs']) {
  check(`control positivo: el barrido SÍ ve el consumidor legacy ${conocido}`,
    consumidoresLegacy.includes(conocido), true);
}

// ── SQL: cuerpo vigente de cada función ──
const claveMig = (f) => f.replace(/\.sql$/, '').split('_').map((p) => {
  const m = p.match(/^(\d+)([a-z]?)$/); return m ? `${m[1].padStart(4, '0')}${m[2]}` : p;
}).join('_');
const migs = fs.readdirSync('migrations').filter((f) => f.endsWith('.sql'))
  .sort((a, b) => claveMig(a).localeCompare(claveMig(b)));

const cuerposVigentes = (lista) => {
  const ultima = new Map();
  for (const [f, t] of lista) {
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    let m;
    while ((m = re.exec(t)) !== null) {
      const ab = t.slice(m.index).match(/AS\s+(\$[a-zA-Z0-9_]*\$)/);
      if (!ab) continue;
      const ini = m.index + ab.index + ab[0].length;
      const fin = t.indexOf(ab[1], ini);
      if (fin === -1) continue;
      ultima.set(m[1], { archivo: f, cuerpo: sinComentarios(t.slice(ini, fin)) });
    }
  }
  return ultima;
};
const listaMigs = migs.map((f) => [f, leerLF(path.join('migrations', f))]);
const vigentes = cuerposVigentes(listaMigs);

const funcionesQueUsan = (mapa) => [...mapa]
  .filter(([, v]) => /\bterritory_unit_id\b/.test(v.cuerpo)
                  || /\bclinics\b[\s\S]{0,400}\bcountry_id\b/.test(v.cuerpo) && /\bclinics\b/.test(v.cuerpo)
                     && /c\.country_id|clinics\.country_id|clinics[^;]*country_id/.test(v.cuerpo))
  .map(([n, v]) => `${n} (${v.archivo})`);

check('ninguna función SQL vigente usa las columnas nuevas de clinics',
  funcionesQueUsan(vigentes).join(', '), '');

// Más amplio: ninguna función vigente consulta el modelo territorial nuevo en
// absoluto. Una función podría leerlo por `legacy_id` —`JOIN administrative_units
// ON legacy_id = c.municipality_id`— sin tocar ninguna columna nueva, y aun así
// dejaría de depender exclusivamente del legacy.
const funcionesDelModeloNuevo = (mapa) => [...mapa]
  .filter(([, v]) => /\b(administrative_units|administrative_unit_paths|country_levels|countries)\b/.test(v.cuerpo))
  .map(([n, v]) => `${n} (${v.archivo})`);
check('ninguna función SQL vigente consulta el modelo territorial nuevo',
  funcionesDelModeloNuevo(vigentes).join(', '), '');
check('se inspeccionaron las funciones vigentes (control: hay más de 100)', vigentes.size > 100, true);

// Control positivo: el mismo método SÍ encuentra los 3 escritores legacy reales.
const escritoresLegacy = [...vigentes]
  .filter(([, v]) => /(INSERT\s+INTO|UPDATE)\s+(public\.)?clinics\b/i.test(v.cuerpo)
                  && /\b(department_id|municipality_id)\b/.test(v.cuerpo))
  .map(([n]) => n).sort();
check('control positivo: el método SÍ encuentra los 3 escritores legacy de ubicación',
  escritoresLegacy.join(', '),
  'admin_approve_and_create_doctor, admin_create_seed_doctor, admin_update_doctor_clinic');

// Los tres escritores de ubicación siguen en su definición previa a F3.
for (const [fn, mig] of [['admin_update_doctor_clinic', 's7_57'],
                         ['admin_approve_and_create_doctor', 's7_64'],
                         ['admin_create_seed_doctor', 's7_75']]) {
  check(`escritor ${fn} sigue definido en ${mig}`, vigentes.get(fn)?.archivo.startsWith(mig), true);
}

// doctor_booking_ready: su última definición sigue siendo la de s7_85.
check('doctor_booking_ready sigue definida en s7_85',
  vigentes.get('doctor_booking_ready')?.archivo.startsWith('s7_85'), true);

// ═══════════════════════════════════════════════════════════
// 5 · TIPOS
// ═══════════════════════════════════════════════════════════
console.log('\n5 · database.types.ts');
const bloqueClinics = (() => {
  const a = types.indexOf('      clinics: {');
  const b = types.indexOf('\n      }\n', a);
  return types.slice(a, b);
})();
has('Row declara country_id nullable', bloqueClinics, 'country_id: number | null');
has('Row declara territory_unit_id nullable', bloqueClinics, 'territory_unit_id: number | null');
has('Insert admite country_id opcional', bloqueClinics, 'country_id?: number | null');
has('Insert admite territory_unit_id opcional', bloqueClinics, 'territory_unit_id?: number | null');
has('relación clinics_country_fkey', bloqueClinics, 'foreignKeyName: "clinics_country_fkey"');
has('relación clinics_territory_unit_country_fkey', bloqueClinics,
  'foreignKeyName: "clinics_territory_unit_country_fkey"');
has('la compuesta declara sus dos columnas', bloqueClinics,
  'columns: ["territory_unit_id", "country_id"]');
has('las FK legacy siguen declaradas', bloqueClinics, 'foreignKeyName: "fk_clinics_municipality"');

// ═══════════════════════════════════════════════════════════
// 6 · ROLLBACK
// ═══════════════════════════════════════════════════════════
console.log('\n6 · rollback');
const exeRb = sinComentarios(rawRb);
check('es atómico', (exeRb.match(/^BEGIN;/gm) || []).length, 1);
check('el COMMIT va después de la verificación',
  exeRb.indexOf('END $ROLLBACK$;') < exeRb.indexOf('COMMIT;'), true);
has('aborta si ya hay datos en las columnas (fases posteriores)', rawRb,
  'hay fases posteriores aplicadas, NO se revierte');
check('la guarda de datos corre ANTES de soltar columnas',
  exeRb.indexOf('$PREVIA$') < exeRb.indexOf('DROP COLUMN'), true);
has('suelta territory_unit_id', exeRb, 'DROP COLUMN IF EXISTS territory_unit_id');
has('suelta country_id', exeRb, 'DROP COLUMN IF EXISTS country_id');
check('no toca columnas legacy',
  /DROP\s+COLUMN[^;]*(department_id|municipality_id)/i.test(exeRb), false);
has('verifica que las columnas legacy sobreviven', rawRb, 'se perdieron columnas legacy');

// ═══════════════════════════════════════════════════════════
// 7 · MUTACIÓN CON EXPECTATIVA INVERTIDA
// ═══════════════════════════════════════════════════════════
const R = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutación sin ancla: ${a}`); return s.replace(a, b); };
const guardasMig = [
  { nombre: 'un DEFAULT', ok: (s) => !/\bDEFAULT\b/i.test(ddlDe(s)),
    mut: (s) => R(s, 'ADD COLUMN country_id        smallint', "ADD COLUMN country_id        smallint DEFAULT 1") },
  { nombre: 'un backfill', ok: (s) => !/\bUPDATE\s+public\./i.test(ddlDe(s)),
    mut: (s) => R(s, 'CREATE INDEX clinics_country_id_idx', "UPDATE public.clinics SET country_id = 1;\nCREATE INDEX clinics_country_id_idx") },
  { nombre: 'un GRANT', ok: (s) => !/\bGRANT\b/i.test(sinLiterales(sinComentarios(s))),
    mut: (s) => R(s, 'CREATE INDEX clinics_country_id_idx', 'GRANT SELECT ON public.clinics TO anon;\nCREATE INDEX clinics_country_id_idx') },
  { nombre: 'un NOT NULL', ok: (s) => !/territory_unit_id\s+bigint\s+NOT\s+NULL/i.test(ddlDe(s)),
    mut: (s) => R(s, 'ADD COLUMN territory_unit_id bigint', 'ADD COLUMN territory_unit_id bigint NOT NULL') },
  { nombre: 'un helper', ok: (s) => !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sinLiterales(sinComentarios(s))),
    mut: (s) => R(s, 'CREATE INDEX clinics_country_id_idx', 'CREATE FUNCTION public._territory_unit_from_legacy() RETURNS bigint AS $x$ SELECT 1 $x$ LANGUAGE sql;\nCREATE INDEX clinics_country_id_idx') },
  { nombre: 'un DROP de columna legacy', ok: (s) => !/department_id|municipality_id/.test(ddlDe(s)),
    mut: (s) => R(s, 'CREATE INDEX clinics_country_id_idx', 'ALTER TABLE public.clinics DROP COLUMN municipality_id;\nCREATE INDEX clinics_country_id_idx') },
  { nombre: 'la falta del CHECK', ok: (s) => ddlDe(s).includes('CHECK (territory_unit_id IS NULL OR country_id IS NOT NULL)'),
    mut: (s) => R(s, 'CHECK (territory_unit_id IS NULL OR country_id IS NOT NULL)', 'CHECK (true)') },
  { nombre: 'la falta de la FK compuesta', ok: (s) => ddlDe(s).includes('FOREIGN KEY (territory_unit_id, country_id)'),
    mut: (s) => R(s, 'FOREIGN KEY (territory_unit_id, country_id)', 'FOREIGN KEY (territory_unit_id)') },
  { nombre: 'el POST fuera de la transacción', ok: (s) => { const e = sinComentarios(s); return e.indexOf('DO $POST$') < e.indexOf('COMMIT;'); },
    mut: (s) => { const i = s.indexOf('-- ─── Guardas POST'); const j = s.indexOf('COMMIT;\n', i);
      return s.slice(0, i) + 'COMMIT;\n' + s.slice(i, j) + s.slice(j + 'COMMIT;\n'.length); } },
];

console.log('\n7 · guardas de la migración (control)');
for (const g of guardasMig) check(`la migración no contiene ${g.nombre}`, g.ok(raw), true);
console.log('\n7.b · mutación con expectativa INVERTIDA');
for (const g of guardasMig) check(`detecta ${g.nombre}`, g.ok(g.mut(raw)), false);

console.log('\n7.c · el barrido de consumidores detecta de verdad');
check('detecta un lector nuevo en src/',
  consumidoresApp([['src/services/falso.ts', "supabase.from('clinics').select('territory_unit_id')"]]).length, 1);
check('detecta un lector que use countryId en frontend',
  consumidoresApp([['src/pages/falso.tsx', 'const x = clinic.countryId']]).length, 1);
check('no confunde código sin relación',
  consumidoresApp([['src/pages/falso.tsx', 'const department = clinic.departmentId']]).length, 0);
// El punto ciego que destapó el control positivo: un embed sin nombrar la columna.
check('detecta un lector por EMBED que nunca nombra territory_unit_id',
  consumidoresApp([['middleware.ts', "'clinics!inner(name,administrative_units(name))'"]]).length, 1);
check('detecta un embed de countries',
  consumidoresApp([['og-meta.mjs', "'clinics!inner(name,countries(iso_alpha2))'"]]).length, 1);
check('detecta from(\'countries\')',
  consumidoresApp([['src/services/falso.ts', "supabase.from('countries').select('*')"]]).length, 1);
check('NO confunde el array JS local `countries` de authPhone/LoginModal',
  consumidoresApp([['src/lib/authPhone.ts',
    'export function assertNoDuplicateCodes(countries: readonly AuthCountry[]) { return countries.map((c) => c.code) }\nconst countries = [1]']]).length, 0);
check('NO confunde el spread `[...countries]` (colisión real de authPhone.ts:84)',
  consumidoresApp([['src/lib/authPhone.ts', 'const byLongestCode = [...countries].sort()']]).length, 0);
check('SÍ detecta un lector aguas abajo `clinic.countries`, como og-meta con municipalities',
  consumidoresApp([['og-meta.mjs', 'const pais = one(clinic.countries)']]).length, 1);
check('SÍ detecta un lector aguas abajo `clinic.administrative_units`',
  consumidoresApp([['og-meta.mjs', 'const unidad = one(clinic.administrative_units)']]).length, 1);
const mapaMutado = cuerposVigentes([...listaMigs,
  ['s7_99_falsa.sql', 'CREATE OR REPLACE FUNCTION public.admin_update_doctor_clinic() RETURNS void AS $$ UPDATE clinics SET territory_unit_id = 1; $$ LANGUAGE sql;']]);
check('detecta un escritor SQL redefinido que empiece a usarlas',
  funcionesQueUsan(mapaMutado).length > 0, true);
check('y la redefinición sustituye a la anterior (se mira la ÚLTIMA)',
  mapaMutado.get('admin_update_doctor_clinic')?.archivo, 's7_99_falsa.sql');
const mapaPorLegacy = cuerposVigentes([...listaMigs,
  ['s7_99_falsa.sql', 'CREATE OR REPLACE FUNCTION public.admin_export_doctors() RETURNS void AS $$ SELECT au.name FROM clinics c JOIN administrative_units au ON au.legacy_id = c.municipality_id; $$ LANGUAGE sql;']]);
check('detecta una función que lea el modelo nuevo por legacy_id sin tocar columnas nuevas',
  funcionesDelModeloNuevo(mapaPorLegacy).length > 0, true);

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
