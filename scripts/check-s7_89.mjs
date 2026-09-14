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
 * Además verifica la GUARDA TEMPORAL `clinics_geo_f3a_temp_null_chk`: la base
 * midió INSERT/UPDATE de cliente a nivel de tabla sobre `clinics`, que las
 * columnas nuevas heredan, así que F3A las deja bloqueadas en NULL hasta F3B.
 *
 * Y un BARRIDO DE COMODINES (sección 8): ningún consumidor obtiene la fila
 * completa de `clinics` sin nombrar columnas —`.select()`, `select('*')`,
 * `clinics(*)`, `SELECT *`, `alias.*`, `RETURNS SETOF clinics`, fila entera—,
 * porque ese consumidor recibiría las columnas nuevas sin haberlas pedido.
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
check('exactamente 4 constraints', (ddl.match(/ADD\s+CONSTRAINT/gi) || []).length, 4);
has('GUARDA TEMPORAL: ambas columnas NULL, con su nombre', ddl,
  'ADD CONSTRAINT clinics_geo_f3a_temp_null_chk\n  CHECK (country_id IS NULL AND territory_unit_id IS NULL)');
has('la guarda queda marcada como TEMPORAL DE F3A en la base (COMMENT)', exe,
  "COMMENT ON CONSTRAINT clinics_geo_f3a_temp_null_chk ON public.clinics IS\n  'TEMPORAL DE FUNDACION 3A.");
has('el comentario la hace removible solo en F3B con el dual-write', exe,
  "'Fundacion 3B, dentro de la misma transicion que establezca el dual-write '");
check('la guarda va DESPUÉS del CHECK estructural, que se conserva',
  ddl.indexOf('clinics_territory_requires_country_chk') < ddl.indexOf('clinics_geo_f3a_temp_null_chk')
  && ddl.indexOf('clinics_territory_requires_country_chk') !== -1, true);

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
check('sin NOT VALID: los CHECK se validan al crearse', /NOT\s+VALID/i.test(ddl), false);
check('sin tocar RLS', /ROW\s+LEVEL\s+SECURITY/i.test(ddl), false);
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
has('PRE aborta si la guarda temporal ya existe', raw, 'ya existe clinics_geo_f3a_temp_null_chk — no reaplicar');

console.log('\n3.b · guardas POST');
has('POST exige los tipos', raw, 'clinics.territory_unit_id deberia ser bigint');
has('POST exige nullable y sin default', raw, 'deben ser NULLABLE y SIN DEFAULT');
has('POST verifica la FK compuesta de 2 columnas', raw, 'no existe o no tiene 2 columnas');
has('POST verifica el CHECK estructural', raw, 'falta el CHECK que exige pais cuando hay unidad');
has('POST verifica la definición de la guarda temporal', raw,
  'la guarda temporal clinics_geo_f3a_temp_null_chk falta o no es la esperada');
has('POST exige la guarda VALIDADA (convalidated)', raw, 'la guarda temporal no esta validada');
has('POST exige la marca TEMPORAL en la base', raw, 'la guarda temporal no esta marcada como temporal de F3A');

// La guarda SQL compara pg_get_constraintdef normalizado (sin paréntesis ni
// espacios, en minúsculas). Lección de s7_82: el literal esperado del POST y la
// expresión del DDL deben normalizar IGUAL, o las dos guardas miden textos
// distintos y solo se nota al aplicar.
const normCheck = (s) => s.toLowerCase().replace(/[()\s]/g, '');
const esperadoPost = (nombre) => {
  const i = raw.indexOf(`con.conname = '${nombre}'`);
  const m = raw.slice(i).match(/IS DISTINCT FROM '([a-z_]+)'/);
  return m ? m[1] : null;
};
check('POST de la guarda normaliza igual que su DDL',
  esperadoPost('clinics_geo_f3a_temp_null_chk'),
  normCheck('CHECK (country_id IS NULL AND territory_unit_id IS NULL)'));
check('POST del CHECK estructural normaliza igual que su DDL',
  esperadoPost('clinics_territory_requires_country_chk'),
  normCheck('CHECK (territory_unit_id IS NULL OR country_id IS NOT NULL)'));
check('la normalización SQL es la misma: quita paréntesis y espacios, en minúsculas', raw.includes(
  "lower(regexp_replace(pg_get_constraintdef(con.oid), '[()[:space:]]', '', 'g'))"), true);
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

// ⚠️ Reanclado en F3B paso 3: s7_92 instala el resolver y la función del trigger
// de sincronización, que son EXACTAMENTE los dos únicos consumidores admitidos del
// modelo nuevo. La allowlist es cerrada: nombre Y archivo. Cualquier otra función
// —un lector, un escritor, un helper nuevo— sigue haciendo fallar el check.
const SYNC_92 = ['_clinics_territory_sync (s7_92_geo_foundation_3b_territory_sync.sql)',
                 '_territory_from_legacy_sv (s7_92_geo_foundation_3b_territory_sync.sql)'];
const fueraDeAllowlist = (lista) => lista.filter((x) => !SYNC_92.includes(x)).join(', ');
check('ninguna función SQL vigente usa las columnas nuevas de clinics (salvo la sincronización de s7_92)',
  fueraDeAllowlist(funcionesQueUsan(vigentes)), '');
check('control: la función del trigger de s7_92 SÍ se detecta como usuaria de las columnas nuevas',
  funcionesQueUsan(vigentes).includes(SYNC_92[0]), true);

// Más amplio: ninguna función vigente consulta el modelo territorial nuevo en
// absoluto. Una función podría leerlo por `legacy_id` —`JOIN administrative_units
// ON legacy_id = c.municipality_id`— sin tocar ninguna columna nueva, y aun así
// dejaría de depender exclusivamente del legacy.
const funcionesDelModeloNuevo = (mapa) => [...mapa]
  .filter(([, v]) => /\b(administrative_units|administrative_unit_paths|country_levels|countries)\b/.test(v.cuerpo))
  .map(([n, v]) => `${n} (${v.archivo})`);
check('ninguna función SQL vigente consulta el modelo territorial nuevo (salvo el resolver de s7_92)',
  fueraDeAllowlist(funcionesDelModeloNuevo(vigentes)), '');
check('control: el resolver de s7_92 SÍ se detecta como lector del modelo nuevo',
  funcionesDelModeloNuevo(vigentes).includes(SYNC_92[1]), true);
check('se inspeccionaron las funciones vigentes (control: hay más de 100)', vigentes.size > 100, true);

// Control positivo: el mismo método SÍ encuentra los 3 escritores legacy reales.
const escritoresLegacy = [...vigentes]
  .filter(([, v]) => /(INSERT\s+INTO|UPDATE)\s+(public\.)?clinics\b/i.test(v.cuerpo)
                  && /\b(department_id|municipality_id)\b/.test(v.cuerpo))
  .map(([n]) => n).sort();
check('control positivo: el método SÍ encuentra los 3 escritores legacy de ubicación',
  escritoresLegacy.join(', '),
  'admin_approve_and_create_doctor, admin_create_seed_doctor, admin_update_doctor_clinic');

// Los tres escritores de ubicación siguen en una definición conocida.
// ⚠️ Reanclado en F3B paso 2: s7_91 redefine admin_approve_and_create_doctor
// para EMPAREJAR departamento y municipio, sin tocar las columnas nuevas. La
// garantía de F3A no era «el archivo se llama s7_64», sino «ningún escritor usa
// el modelo nuevo», y eso lo siguen afirmando las aserciones de arriba sobre la
// ÚLTIMA definición. Aquí solo se fija el conjunto de migraciones admitidas.
for (const [fn, migs] of [['admin_update_doctor_clinic', ['s7_57']],
                          ['admin_approve_and_create_doctor', ['s7_64', 's7_91']],
                          ['admin_create_seed_doctor', ['s7_75']]]) {
  check(`escritor ${fn} definido en ${migs.join(' o ')}`,
    migs.some((m) => vigentes.get(fn)?.archivo.startsWith(m)), true);
}
check('control: la definición vigente del escritor de aprobación es la de s7_91',
  vigentes.get('admin_approve_and_create_doctor')?.archivo.startsWith('s7_91'), true);

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
has('suelta la guarda temporal', exeRb, 'DROP CONSTRAINT IF EXISTS clinics_geo_f3a_temp_null_chk');
has('verifica que no queda ningún constraint de s7_89', rawRb, 'quedan % constraints de s7_89');
check('el rollback suelta los 4 constraints que crea la migración',
  (exeRb.match(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+\w+/gi) || []).map((d) => d.split(/\s+/).pop()).sort().join(','),
  (ddl.match(/ADD\s+CONSTRAINT\s+\w+/gi) || []).map((d) => d.split(/\s+/).pop()).sort().join(','));

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
  { nombre: 'la falta de la guarda temporal',
    ok: (s) => ddlDe(s).includes('CHECK (country_id IS NULL AND territory_unit_id IS NULL)'),
    mut: (s) => R(s, 'CHECK (country_id IS NULL AND territory_unit_id IS NULL)', 'CHECK (true)') },
  { nombre: 'una guarda temporal debilitada a OR',
    ok: (s) => ddlDe(s).includes('CHECK (country_id IS NULL AND territory_unit_id IS NULL)'),
    mut: (s) => R(s, 'CHECK (country_id IS NULL AND territory_unit_id IS NULL)', 'CHECK (country_id IS NULL OR territory_unit_id IS NULL)') },
  { nombre: 'una guarda temporal NOT VALID', ok: (s) => !/NOT\s+VALID/i.test(ddlDe(s)),
    mut: (s) => R(s, 'CHECK (country_id IS NULL AND territory_unit_id IS NULL);', 'CHECK (country_id IS NULL AND territory_unit_id IS NULL) NOT VALID;') },
  { nombre: 'la guarda sin marca TEMPORAL',
    ok: (s) => sinComentarios(s).includes("clinics_geo_f3a_temp_null_chk ON public.clinics IS\n  'TEMPORAL DE FUNDACION 3A."),
    mut: (s) => R(s, "'TEMPORAL DE FUNDACION 3A. Mantiene", "'Mantiene") },
  { nombre: 'un POST que no exige convalidated',
    ok: (s) => sinComentarios(s).includes('IF v_bool IS DISTINCT FROM true THEN\n    RAISE EXCEPTION \'s7_89 POST: la guarda temporal no esta validada'),
    mut: (s) => R(s, "IF v_bool IS DISTINCT FROM true THEN\n    RAISE EXCEPTION 's7_89 POST: la guarda temporal no esta validada", "IF false THEN\n    RAISE EXCEPTION 's7_89 POST: la guarda temporal no esta validada") },
  { nombre: 'un POST que acepta la guarda debilitada',
    ok: (s) => s.includes("IS DISTINCT FROM 'checkcountry_idisnullandterritory_unit_idisnull'"),
    mut: (s) => R(s, "IS DISTINCT FROM 'checkcountry_idisnullandterritory_unit_idisnull'", "IS DISTINCT FROM 'checkcountry_idisnullorterritory_unit_idisnull'") },
  { nombre: 'el POST fuera de la transacción', ok: (s) => { const e = sinComentarios(s); return e.indexOf('DO $POST$') < e.indexOf('COMMIT;'); },
    mut: (s) => { const i = s.indexOf('-- ─── Guardas POST'); const j = s.indexOf('COMMIT;\n', i);
      return s.slice(0, i) + 'COMMIT;\n' + s.slice(i, j) + s.slice(j + 'COMMIT;\n'.length); } },
];

console.log('\n7 · guardas de la migración (control)');
for (const g of guardasMig) check(`la migración no contiene ${g.nombre}`, g.ok(raw), true);
console.log('\n7.b · mutación con expectativa INVERTIDA');
// Una mutación sin ancla es un FAIL visible, no un abort: así el resto del
// check sigue corriendo y un A/B contra una versión anterior se lee entero.
for (const g of guardasMig) {
  let r;
  try { r = g.ok(g.mut(raw)); } catch (e) { r = e.message; }
  check(`detecta ${g.nombre}`, r, false);
}

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

{
  let r;
  try {
    const rbSinGuarda = R(rawRb, '  DROP CONSTRAINT IF EXISTS clinics_geo_f3a_temp_null_chk,\n', '');
    r = (sinComentarios(rbSinGuarda).match(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+\w+/gi) || []).length
      === (ddl.match(/ADD\s+CONSTRAINT/gi) || []).length;
  } catch (e) { r = e.message; }
  check('mutación: un rollback que no suelte la guarda deja de casar con la migración', r, false);
}

// ═══════════════════════════════════════════════════════════
// 8 · BARRIDO DE COMODINES SOBRE clinics
// ═══════════════════════════════════════════════════════════
// Un consumidor que obtiene la fila COMPLETA de clinics sin nombrar columnas
// recibiría country_id / territory_unit_id sin pedirlas: un lector del modelo
// nuevo que el barrido de la sección 4 no vería. Precheck read-only del
// 2026-09-13: cero en la app, cero funciones de tipo clinics, y los 5 cuerpos
// que la base marcó por un patrón grueso resultaron falsos positivos.
console.log('\n8 · barrido de comodines sobre clinics');

/** Lecturas de clinics en la app, con la forma de su selección. */
const lectoresClinicsApp = (archivos) => {
  const out = [];
  for (const [archivo, t] of archivos) {
    // Embeds: clinics(…), clinics!inner(…), clinic:clinics(…). Se lee la lista
    // de primer nivel respetando paréntesis anidados.
    for (const m of t.matchAll(/\bclinics(?:![a-z_]+)?\s*\(/g)) {
      let depth = 1, i = m.index + m[0].length, item = '', items = [];
      for (; i < t.length && depth > 0; i++) {
        const ch = t[i];
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth === 1 && ch === ',') { items.push(item); item = ''; }
        else if (depth >= 1) item += ch;
      }
      items.push(item);
      out.push({ archivo, forma: 'embed', comodin: items.some((x) => x.replace(/\s/g, '') === '*') });
    }
    // .from('clinics') y lo que selecciona su cadena, hasta ';' o línea en blanco.
    for (const m of t.matchAll(/\.from\(\s*['"`]clinics['"`]\s*\)/g)) {
      const resto = t.slice(m.index, m.index + 700);
      const fin = resto.search(/;\s*\n|\n\s*\n/);
      const cadena = fin === -1 ? resto : resto.slice(0, fin);
      const sel = cadena.match(/\.select\(\s*(?:(['"`])([\s\S]*?)\1)?\s*\)/);
      const escribe = /\.(insert|update|upsert|delete)\(/.test(cadena);
      const comodin = sel ? (sel[2] === undefined || /(^|,)\s*\*\s*(,|$)/.test(sel[2])) : !escribe;
      out.push({ archivo, forma: 'from', comodin });
    }
  }
  return out;
};
const comodinesApp = (archivos) => lectoresClinicsApp(archivos)
  .filter((x) => x.comodin).map((x) => x.archivo.split(path.sep).join('/'));

const lectoresReales = lectoresClinicsApp(superficieApp);
check('app: ningún lector obtiene la fila completa de clinics', comodinesApp(superficieApp).join(', '), '');
// Control positivo: el mismo detector SÍ ve los lectores reales de clinics.
const lectoresPorArchivo = (forma) => [...new Set(lectoresReales.filter((x) => x.forma === forma)
  .map((x) => x.archivo.split(path.sep).join('/')))].sort().join(', ');
check('control positivo: ve los embeds reales de clinics',
  lectoresPorArchivo('embed'), 'middleware.ts, src/services/directory.service.ts');
check('control positivo: ve el .from(\'clinics\') real',
  lectoresPorArchivo('from'), 'src/services/doctorActivation.service.ts');

console.log('\n8.b · detector de la app (mutación)');
const casoApp = (codigo) => comodinesApp([['src/services/falso.ts', codigo]]).length;
check('detecta .from(\'clinics\').select(\'*\')', casoApp("supabase.from('clinics').select('*').eq('id', x);\n"), 1);
check('detecta .from(\'clinics\').select()', casoApp("supabase.from('clinics').select().eq('id', x);\n"), 1);
check('detecta .from(\'clinics\') sin select', casoApp("supabase.from('clinics').eq('id', x).maybeSingle();\n"), 1);
check('detecta insert(...).select() que devuelve la fila', casoApp("supabase.from('clinics').insert(row).select().single();\n"), 1);
check('detecta embed clinics(*)', casoApp("select('id, clinics(*)')"), 1);
check('detecta embed clinics!inner( * )', casoApp("select('id, clinics!inner( * )')"), 1);
check('detecta embed con alias clinic:clinics(*)', casoApp("select('id, clinic:clinics(*)')"), 1);
check('detecta el * junto a otros campos del embed', casoApp("select('clinics(*, municipalities(name))')"), 1);
check('NO marca un select explícito', casoApp("supabase.from('clinics').select('name, address_line').eq('id', x);\n"), 0);
check('NO marca un embed explícito con anidados', casoApp("'clinics!inner(name,municipalities(name),departments(name))'"), 0);
check('NO marca el * de la tabla raíz', casoApp("supabase.from('doctors').select('*, clinics(id, name)');\n"), 0);
check('NO marca un municipalities(*) dentro de un embed explícito', casoApp("'clinics(name, municipalities(*))'"), 0);
check('NO marca un update sin select', casoApp("supabase.from('clinics').update({ name }).eq('id', x);\n"), 0);

console.log('\n8.c · SQL: funciones y vistas vigentes');
// ── SQL: última definición de cada función, respetando el orden DROP/CREATE ──
// ⚠️ Dentro de un mismo archivo, `DROP FUNCTION f; CREATE FUNCTION f` debe
// dejar f VIVA. Una primera versión de este barrido procesaba todos los CREATE
// antes que los DROP y daba por eliminada a admin_get_doctor_detail (s7_25): lo
// destapó el control positivo de abajo.
const limpiarSql = (s) => sinLiterales(sinComentarios(s.replace(/\/\*[\s\S]*?\*\//g, ' ')));
const funcionesOrdenadas = (lista) => {
  const vivas = new Map();
  for (const [f, t] of lista) {
    const ev = [];
    for (const m of t.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) ev.push(['c', m]);
    for (const m of t.matchAll(/^\s*DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gim)) ev.push(['d', m]);
    ev.sort((a, b) => a[1].index - b[1].index);
    for (const [k, m] of ev) {
      const n = m[1].toLowerCase();
      if (k === 'd') { vivas.delete(n); continue; }
      const ab = t.slice(m.index).match(/AS\s+(\$[a-zA-Z0-9_]*\$)/);
      if (!ab) continue;
      const ini = m.index + ab.index + ab[0].length;
      const fin = t.indexOf(ab[1], ini);
      if (fin === -1) continue;
      const bruto = t.slice(ini, fin);
      vivas.set(n, { archivo: f, firma: limpiarSql(t.slice(m.index, m.index + ab.index)),
                     cuerpo: limpiarSql(bruto), bruto });
    }
  }
  return vivas;
};

const PALABRAS = /^(where|join|left|right|inner|outer|full|cross|on|group|order|limit|using|set|values|returning|lateral|natural|union|for|having|window|offset)$/i;
/** Formas que expanden la fila completa de clinics. Firma y cuerpo ya limpios. */
const comodinSql = (firma, cuerpo) => {
  const q = [];
  if (/RETURNS\s+(SETOF\s+)?(public\.)?clinics\b/i.test(firma)) q.push('RETURNS clinics');
  if (/\(\s*[^)]*\b(public\.)?clinics\b\s*[,)]/i.test(firma.replace(/RETURNS[\s\S]*/i, ''))) q.push('argumento clinics');
  if (/\bclinics%ROWTYPE\b/i.test(cuerpo)) q.push('clinics%ROWTYPE');
  if (/::\s*(public\.)?clinics\b/i.test(cuerpo)) q.push('::clinics');
  if (/\bclinics\.\*/i.test(cuerpo)) q.push('clinics.*');
  if (/INSERT\s+INTO\s+(public\.)?clinics\s+(SELECT|VALUES)\b/i.test(cuerpo)) q.push('INSERT sin columnas');
  for (const st of cuerpo.split(';')) {
    const refs = [...st.matchAll(/\b(FROM|JOIN)\s+(?:ONLY\s+)?(?:public\.)?clinics\b(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi)];
    if (!refs.length) continue;
    if (/\bSELECT\s+(DISTINCT\s+)?\*/i.test(st)) q.push('SELECT * sobre clinics');
    const alias = new Set(['clinics', ...refs.map((r) => r[2]).filter((a) => a && !PALABRAS.test(a))]);
    for (const al of alias) {
      if (new RegExp(String.raw`\b${al}\.\*`, 'i').test(st)) q.push(`${al}.*`);
      const fe = st.match(new RegExp(String.raw`\b([a-z_][a-z0-9_]*)\s*\(\s*${al}\s*\)`, 'i'));
      if (fe && !/^(count|coalesce)$/i.test(fe[1])) q.push(`fila entera ${fe[1]}(${al})`);
      if (new RegExp(String.raw`\bSELECT\s+${al}\s+(INTO|FROM)\b`, 'i').test(st)) q.push(`fila entera SELECT ${al}`);
    }
  }
  return q;
};
const funcionesComodin = (mapa) => [...mapa]
  .filter(([, v]) => comodinSql(v.firma, v.cuerpo).length > 0).map(([n, v]) => `${n} (${v.archivo})`);

const vivas = funcionesOrdenadas(listaMigs);
check('SQL: ninguna función vigente obtiene la fila completa de clinics', funcionesComodin(vivas).join(', '), '');

// Vistas versionadas: la última definición de cada una.
// ⚠️ El ';' que cierra la vista se busca sobre el SQL YA LIMPIO: la definición
// de crm_patient_identity lleva un ';' dentro de un comentario y, sin limpiar,
// la captura se cortaba antes de llegar a clinics. Lo destapó el control
// positivo de abajo.
const vistas = new Map();
for (const [f, t] of listaMigs) {
  for (const m of limpiarSql(t).matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?([a-z0-9_]+)\s+AS\s+([\s\S]*?);/gi)) {
    vistas.set(m[1], { archivo: f, def: m[2] });
  }
}
check('SQL: ninguna vista versionada proyecta la fila completa de clinics',
  [...vistas].filter(([, v]) => comodinSql('', v.def).length > 0).map(([n]) => n).join(', '), '');
check('control positivo: ve la vista real crm_patient_identity, que lee clinics sin comodín',
  /\bclinics\b/.test(vistas.get('crm_patient_identity')?.def ?? '')
  && comodinSql('', vistas.get('crm_patient_identity').def).length === 0, true);

// Control positivo: el parser ve las lectoras reales de clinics, incluida la
// que se redefine con DROP + CREATE en el mismo archivo.
const lectorasSql = [...vivas].filter(([, v]) => /\b(FROM|JOIN)\s+(?:public\.)?clinics\b/i.test(v.cuerpo)).map(([n]) => n);
for (const f of ['admin_export_doctors', 'directory_get_doctor_detail', 'admin_get_doctor_detail']) {
  check(`control positivo: ${f} aparece como lectora vigente de clinics`, lectorasSql.includes(f), true);
}

// CONTROL CRUZADO CON LA BASE. La sonda F2 marcó 5 cuerpos con un patrón
// GRUESO (cuerpo con comentarios; cualquier mención de clinics más cualquier
// comodín). Aplicado aquí, sobre los cuerpos versionados sin limpiar, tiene que
// reproducir exactamente esos 5 —prueba que ambos instrumentos miran los
// mismos cuerpos— y el detector preciso tiene que descartarlos todos.
const gruesos = [...vivas].filter(([, v]) => /\bclinics\b/i.test(v.bruto) && (
  /select\s+(distinct\s+)?\*/i.test(v.bruto) || /\b[a-z_][a-z0-9_]*\.\*/i.test(v.bruto)
  || /clinics%rowtype/i.test(v.bruto) || /::\s*(public\.)?clinics\b/i.test(v.bruto)
  || /insert\s+into\s+(public\.)?clinics\s+(select|values)/i.test(v.bruto))).map(([n]) => n).sort();
const F2_BASE = ['admin_approve_and_create_doctor', 'admin_create_seed_doctor', 'admin_export_doctors',
  'admin_list_patient_merge_candidates', 'admin_list_unlinked_patients'];
check('control cruzado: el patrón grueso reproduce los 5 cuerpos que marcó la base', gruesos.join(', '), F2_BASE.join(', '));
check('control cruzado: el detector preciso descarta los 5',
  F2_BASE.filter((n) => comodinSql(vivas.get(n).firma, vivas.get(n).cuerpo).length > 0).join(', '), '');

console.log('\n8.d · detector SQL (mutación)');
const F = 'CREATE FUNCTION x() RETURNS jsonb LANGUAGE plpgsql AS ';
const casoSql = (firma, cuerpo) => comodinSql(limpiarSql(firma), limpiarSql(cuerpo)).length > 0;
for (const [n, firma, cuerpo, espera] of [
  ['RETURNS SETOF clinics', 'CREATE FUNCTION x() RETURNS SETOF public.clinics AS ', 'SELECT id FROM clinics', true],
  ['RETURNS clinics', 'CREATE FUNCTION x() RETURNS clinics AS ', 'SELECT id FROM clinics', true],
  ['argumento de tipo clinics', 'CREATE FUNCTION x(p public.clinics) RETURNS int AS ', 'SELECT 1', true],
  ['SELECT * FROM clinics', F, 'SELECT * INTO v FROM public.clinics WHERE id = p', true],
  ['SELECT * sobre un join con clinics', F, 'SELECT * FROM doctors d JOIN clinics c ON c.id = d.clinic_id', true],
  ['c.*', F, 'SELECT c.* FROM public.clinics c', true],
  ['alias AS cl.*', F, 'SELECT d.id, cl.* FROM doctors d LEFT JOIN public.clinics AS cl ON cl.id = d.clinic_id', true],
  ['to_jsonb(c)', F, 'SELECT to_jsonb(c) INTO r FROM clinics c WHERE c.id = p', true],
  ['row_to_json(c)', F, 'SELECT row_to_json(c) FROM clinics c', true],
  ['clinics%ROWTYPE', F, 'DECLARE v clinics%ROWTYPE; BEGIN NULL; END', true],
  ['cast ::clinics', F, 'SELECT jsonb_populate_record(NULL::clinics, p)', true],
  ['INSERT INTO clinics sin columnas', F, 'INSERT INTO clinics SELECT * FROM tmp', true],
  ['SELECT c INTO', F, 'SELECT c INTO v FROM clinics c', true],
  ['NEG columnas explícitas', F, 'SELECT c.id, c.name FROM public.clinics c JOIN doctors d ON d.clinic_id = c.id', false],
  ['NEG count(*)', F, 'SELECT count(*) INTO n FROM public.clinics', false],
  ['NEG SELECT * de otra tabla', F, 'SELECT * INTO v_lead FROM doctor_affiliation_requests WHERE id = p', false],
  ['NEG comentario', F, '-- SELECT * FROM clinics\nSELECT 1', false],
  ['NEG comentario de bloque', F, '/* SELECT * FROM clinics */ SELECT 1', false],
  ['NEG literal', F, "RAISE NOTICE 'SELECT * FROM clinics'", false],
  ['NEG EXISTS (SELECT 1 FROM clinics)', F, 'IF EXISTS (SELECT 1 FROM clinics c WHERE c.id = p) THEN NULL; END IF', false],
  ['NEG count(c.id)', F, 'SELECT count(c.id) FROM clinics c', false],
]) check(`${espera ? 'detecta' : 'no marca'}: ${n.replace(/^NEG /, '')}`, casoSql(firma, cuerpo), espera);

const mapaDrop = funcionesOrdenadas([['s7_98_a.sql', 'CREATE FUNCTION public.fz() RETURNS SETOF clinics AS $$ SELECT * FROM clinics $$ LANGUAGE sql;'],
  ['s7_98_b.sql', 'DROP FUNCTION IF EXISTS public.fz();']]);
check('una función eliminada después no cuenta', funcionesComodin(mapaDrop).join(', '), '');
const mapaRecreada = funcionesOrdenadas([['s7_98_a.sql',
  'DROP FUNCTION IF EXISTS public.fz();\nCREATE FUNCTION public.fz() RETURNS SETOF clinics AS $$ SELECT * FROM clinics $$ LANGUAGE sql;']]);
check('DROP + CREATE en el mismo archivo deja la función VIVA', funcionesComodin(mapaRecreada).length, 1);
check('una redefinición posterior con comodín SÍ cuenta', funcionesComodin(funcionesOrdenadas([...listaMigs,
  ['s7_99_falsa.sql', 'CREATE OR REPLACE FUNCTION public.admin_list_unlinked_patients() RETURNS jsonb AS $$ SELECT to_jsonb(c) FROM public.clinics c $$ LANGUAGE sql;']]))
  .some((x) => x.startsWith('admin_list_unlinked_patients ')), true);

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
