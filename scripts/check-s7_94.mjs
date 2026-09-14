#!/usr/bin/env node
/**
 * check-s7_94.mjs — Fundación 3D: cierre transitivo del árbol territorial.
 *
 * s7_94 crea public.administrative_unit_closure (variante N1 aprobada por el owner)
 * y la carga desde el árbol vivo. Lo que hay que demostrar sin tocar la base:
 *   · las constantes del preflight de producción (888, reparto, huella del cierre
 *     y huella del catálogo) están incrustadas con la MISMA expresión en PRE,
 *     GUARDA, POST y rollback;
 *   · el orden de la transacción y el lock (sin ADD CONSTRAINT: la UNIQUE del
 *     catálogo es un índice único, que no toma AccessExclusiveLock);
 *   · el esquema N1 exacto: filas propias, país y niveles, FK compuestas al
 *     índice único, CHECK de depth y de fila propia, índice inverso con INCLUDE;
 *   · F3D es SOLO estructura: sin funciones, triggers, vistas, policies ni GRANT;
 *     REVOKE explícito a PUBLIC, anon, authenticated y service_role, y RLS;
 *   · la carga es un único INSERT recursivo sin literales territoriales y exige
 *     exactamente 888 filas;
 *   · el POST cubre forma, contenido, deriva, sondas de comportamiento,
 *     seguridad, «nada más cambió» y la ejecutabilidad de la cadena de rollbacks;
 *   · el rollback se niega ante consumidores o cambios posteriores, retira con
 *     DDL ensamblado (regla 3 del SQL Editor) y verifica antes de comitear;
 *   · el bloque de deriva versionado es genérico y compara las 6 columnas;
 *   · mutaciones con expectativa INVERTIDA: cada regla detecta su violación.
 *
 *   node scripts/check-s7_94.mjs
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

console.log('\ncheck-s7_94 — Fundación 3D · cierre territorial\n');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const P94 = path.join('migrations', 's7_94_geo_foundation_3d_unit_closure.sql');
const PRB = path.join('docs', 'rollbacks', 's7_94_rollback.sql');
const PDR = path.join('docs', 'smokes', 's7_94_closure_drift_readonly.sql');
const raw = leerLF(P94);
const rawRb = leerLF(PRB);
const rawDr = leerLF(PDR);

const sinComentarios = (sql) => sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
const bloque = (s, tag) => {
  const a = s.indexOf(`DO $${tag}$`), b = s.indexOf(`END $${tag}$;`);
  return a === -1 || b === -1 ? '' : s.slice(a, b + `END $${tag}$;`.length);
};
const ocurrencias = (s, needle) => s.split(needle).length - 1;
const sinDolarEnComentarios = (s) => s.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length === 0;
// DDL con nombre de objeto a continuación (regla 3 del SQL Editor).
const RE_DDL_NOMBRE = /\b(create|drop)\s+(unique\s+)?(temp(orary)?\s+)?(table|view|function|trigger|index|policy|rule|sequence)\s+(if\s+(not\s+)?exists\s+)?[a-z_"]/gi;

// ── Constantes del preflight de producción (2026-09-14, Z = 0) ──
const HUELLA_CATALOGO = '460e807050a0da8bea0891965b1b9fd7';
const HUELLA_CIERRE = 'af230f5086d871b1cce24e34de4b6cec';
const EXPR_HUELLA_CATALOGO = "md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active,\n                        E'\\n' ORDER BY u.id))";
const EXPR_HUELLA_CIERRE = "md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\\n' ORDER BY ancestor_unit_id, descendant_unit_id))";
const EXPR_HUELLA_CIERRE_PRE = "md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\\n'\n                                ORDER BY ancestor_unit_id, descendant_unit_id))";
const REVOKE = 'REVOKE ALL ON TABLE public.administrative_unit_closure FROM PUBLIC, anon, authenticated, service_role;';

// ═══════════════════════════════════════════════════════════
// 0 · ARCHIVOS
// ═══════════════════════════════════════════════════════════
console.log('0 · archivos');
const migs = fs.readdirSync('migrations').filter((f) => f.endsWith('.sql'));
check('s7_94 es la migración 115 en orden', [...migs].sort().indexOf(path.basename(P94)) + 1, 115);
check('control: hay al menos 115 migraciones', migs.length >= 115, true);
const rastreado = (p) => { try { execSync(`git ls-files --error-unmatch "${p}"`, { stdio: 'ignore' }); return true; } catch { return false; } };
check('el rollback está rastreado por git (la regla *.sql exige git add -f)', rastreado(PRB.split(path.sep).join('/')), true);
check('el bloque de deriva está rastreado por git (git add -f)', rastreado(PDR.split(path.sep).join('/')), true);
for (const [n, s] of [['migración', raw], ['rollback', rawRb], ['deriva', rawDr]]) {
  check(`sin etiquetas $…$ en comentarios (${n})`, sinDolarEnComentarios(s), true);
  check(`solo ASCII y español (${n})`, /[Ѐ-ӿ]/.test(s), false);
}
const ddlNombrado = (s) => (sinLiterales(s).match(RE_DDL_NOMBRE) || []).map((x) => x.replace(/\s+/g, ' ').toUpperCase());
const reglaDdlMigracion = (s) => ddlNombrado(s).join('|') === 'CREATE UNIQUE INDEX A|CREATE TABLE P|CREATE INDEX A'
  && ddlNombrado(sinLiterales(sinComentarios(s)).replace(/CREATE UNIQUE INDEX au_id_country_level_key\n|CREATE TABLE public\.administrative_unit_closure \(\n|CREATE INDEX auc_descendant_level_idx\n/g, '')).length === 0;
check('regla 3: la migración solo tiene DDL con nombre para los 3 objetos que existirán al terminar, y ninguno en comentarios', reglaDdlMigracion(raw), true);
const reglaDdlRollback = (s) => ddlNombrado(s).length === 0;
check('regla 3: el rollback no nombra objetos junto a una orden de retiro (DDL ensamblado)', reglaDdlRollback(rawRb), true);
check('regla 3: el bloque de deriva no tiene DDL', ddlNombrado(rawDr).length === 0 && !/\b(INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE)\b/i.test(sinLiterales(sinComentarios(rawDr))), true);

// ═══════════════════════════════════════════════════════════
// 1 · CONSTANTES DEL PREFLIGHT
// ═══════════════════════════════════════════════════════════
console.log('\n1 · constantes del preflight');
const huellaConst = (b, nombre) => { const m = b.match(new RegExp(`${nombre}\\s+CONSTANT text := '([0-9a-f]{32})';`)); return m ? m[1] : null; };
const reglaConstantes = (s, rb) =>
  ['PRE', 'GUARDA', 'POST'].every((t) => huellaConst(bloque(s, t), 'v_huella_catalogo') === HUELLA_CATALOGO)
  && ['PRE', 'POST'].every((t) => huellaConst(bloque(s, t), 'v_huella_cierre') === HUELLA_CIERRE)
  && huellaConst(bloque(rb, 'PREVIA'), 'v_huella_catalogo') === HUELLA_CATALOGO
  && huellaConst(bloque(rb, 'PREVIA'), 'v_huella_cierre') === HUELLA_CIERRE
  && huellaConst(bloque(rb, 'VERIFICA'), 'v_huella_catalogo') === HUELLA_CATALOGO;
check('huellas del catálogo y del cierre idénticas en PRE, GUARDA, POST y rollback', reglaConstantes(raw, rawRb), true);
const reglaExprCatalogo = (s) => ['PRE', 'GUARDA', 'POST'].every((t) => bloque(s, t).includes(EXPR_HUELLA_CATALOGO));
check('la huella del catálogo se calcula con la expresión de la fila 62 del preflight', reglaExprCatalogo(raw), true);
const reglaExprCierre = (s) => bloque(s, 'PRE').includes(EXPR_HUELLA_CIERRE_PRE) && bloque(s, 'POST').includes(EXPR_HUELLA_CIERRE)
  && bloque(rawRb, 'PREVIA').includes(EXPR_HUELLA_CIERRE);
check('la huella del cierre se calcula con la expresión de la fila 61 del preflight', reglaExprCierre(raw), true);
const reglaPreEsperado = (s) => bloque(s, 'PRE').includes("IF v_txt IS DISTINCT FROM '0|888|0=320,1=306,2=262|' || v_huella_cierre THEN");
check('PRE: exige 0 ciclos, 888 filas, reparto 0=320,1=306,2=262 y la huella del cierre esperado', reglaPreEsperado(raw), true);
const reglaPostContenido = (s) => { const p = sinComentarios(bloque(s, 'POST'));
  return p.includes("IF v_n <> 888 THEN RAISE EXCEPTION 's7_94 POST: el cierre tiene % filas, se esperaban 888', v_n; END IF;")
    && p.includes("IF v_txt IS DISTINCT FROM '0=320,1=306,2=262' THEN")
    && p.includes("IF v_txt IS DISTINCT FROM v_huella_cierre THEN RAISE EXCEPTION 's7_94 POST: la huella del cierre no es la del preflight (%)', v_txt; END IF;"); };
check('POST: 888 filas, reparto y huella del preflight', reglaPostContenido(raw), true);

// ═══════════════════════════════════════════════════════════
// 2 · ORDEN DE LA TRANSACCIÓN Y LOCK
// ═══════════════════════════════════════════════════════════
console.log('\n2 · orden de la transacción');
const ex = sinComentarios(raw);
const exSL = sinLiterales(ex);
check('un único BEGIN; y un único COMMIT;', `${(ex.match(/^BEGIN;/gm) || []).length},${(ex.match(/^COMMIT;/gm) || []).length}`, '1,1');
check('nada después del COMMIT', ex.slice(ex.indexOf('\nCOMMIT;') + '\nCOMMIT;'.length).trim(), '');
const PASOS = [
  'END $PRE$;', '\nBEGIN;', "SET LOCAL lock_timeout = '5s';", 'LOCK TABLE public.administrative_units IN SHARE ROW EXCLUSIVE MODE;',
  'DO $GUARDA$', 'END $GUARDA$;', 'CREATE UNIQUE INDEX au_id_country_level_key', 'CREATE TABLE public.administrative_unit_closure (',
  'CREATE INDEX auc_descendant_level_idx', 'DO $CARGA$', 'END $CARGA$;',
  'ALTER TABLE public.administrative_unit_closure ENABLE ROW LEVEL SECURITY;', REVOKE, 'ANALYZE public.administrative_unit_closure;',
  'DO $POST$', 'END $POST$;', '\nCOMMIT;',
];
const reglaOrden = (s) => { const e = sinComentarios(s); const p = PASOS.map((x) => (ocurrencias(e, x) === 1 ? e.indexOf(x) : -1));
  return p.every((x, i) => x >= 0 && (i === 0 || x > p[i - 1])); };
for (const x of PASOS) check(`aparece exactamente una vez: ${x.trim().slice(0, 90)}`, ocurrencias(ex, x), 1);
check('orden: PRE → BEGIN → lock_timeout → LOCK → GUARDA → índice único → tabla → índice inverso → CARGA → RLS → REVOKE → ANALYZE → POST → COMMIT', reglaOrden(raw), true);
check('lock_timeout inmediatamente después del BEGIN', /\nBEGIN;\n\nSET LOCAL lock_timeout = '5s';\n/.test(ex), true);
const reglaLock = (s) => { const e = sinLiterales(sinComentarios(s));
  return (e.match(/LOCK TABLE[^;]*;/g) || []).join('|') === 'LOCK TABLE public.administrative_units IN SHARE ROW EXCLUSIVE MODE;'
    && !/\bADD\s+CONSTRAINT\b/i.test(e) && !/\bALTER\s+TABLE\s+public\.administrative_units\b/i.test(e); };
check('lock SHARE ROW EXCLUSIVE; sin ADD CONSTRAINT ni ALTER TABLE del catálogo (evita AccessExclusiveLock)', reglaLock(raw), true);

// ═══════════════════════════════════════════════════════════
// 3 · ESQUEMA N1
// ═══════════════════════════════════════════════════════════
console.log('\n3 · esquema N1');
const tabla = (s) => { const e = sinComentarios(s); const a = e.indexOf('CREATE TABLE public.administrative_unit_closure ('); return a === -1 ? '' : e.slice(a, e.indexOf('\n);', a) + 3); };
const TABLA = `CREATE TABLE public.administrative_unit_closure (
  country_id         smallint NOT NULL,
  ancestor_unit_id   bigint   NOT NULL,
  ancestor_level     smallint NOT NULL,
  descendant_unit_id bigint   NOT NULL,
  descendant_level   smallint NOT NULL,
  depth              smallint NOT NULL,
  CONSTRAINT administrative_unit_closure_pkey PRIMARY KEY (ancestor_unit_id, descendant_unit_id),
  CONSTRAINT auc_ancestor_fkey
    FOREIGN KEY (ancestor_unit_id, country_id, ancestor_level)
    REFERENCES public.administrative_units (id, country_id, level),
  CONSTRAINT auc_descendant_fkey
    FOREIGN KEY (descendant_unit_id, country_id, descendant_level)
    REFERENCES public.administrative_units (id, country_id, level),
  CONSTRAINT auc_depth_levels_chk CHECK (depth >= 0 AND depth = descendant_level - ancestor_level),
  CONSTRAINT auc_self_iff_depth_0_chk CHECK ((depth = 0) = (ancestor_unit_id = descendant_unit_id))
);`;
const reglaTabla = (s) => tabla(s) === TABLA;
check('la tabla es EXACTAMENTE la variante N1 aprobada (6 columnas, PK, 2 FK compuestas con nivel, 2 CHECK)', reglaTabla(raw), true);
const reglaIndices = (s) => { const e = sinComentarios(s);
  return e.includes('CREATE UNIQUE INDEX au_id_country_level_key\n  ON public.administrative_units (id, country_id, level);')
    && e.includes('CREATE INDEX auc_descendant_level_idx\n  ON public.administrative_unit_closure (descendant_unit_id, ancestor_level) INCLUDE (ancestor_unit_id);')
    && (e.match(/CREATE (UNIQUE )?INDEX/g) || []).length === 2; };
check('índices: único (id, country_id, level) en el catálogo e inverso (descendant_unit_id, ancestor_level) INCLUDE (ancestor_unit_id)', reglaIndices(raw), true);
const reglaSinCascada = (s) => !/\bON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT)\b|\bDEFERRABLE\b/i.test(sinLiterales(sinComentarios(s)));
check('FK sin CASCADE ni SET NULL y no diferibles (NO ACTION: borrar una unidad con cierre falla)', reglaSinCascada(raw), true);

// ═══════════════════════════════════════════════════════════
// 4 · CARGA
// ═══════════════════════════════════════════════════════════
console.log('\n4 · carga');
const carga = sinComentarios(bloque(raw, 'CARGA'));
const CARGA_SQL = `  INSERT INTO public.administrative_unit_closure
    (country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth)
  WITH RECURSIVE s (country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth) AS (
    SELECT u.country_id, u.id, u.level, u.id, u.level, 0 FROM public.administrative_units u
    UNION ALL
    SELECT s.country_id, p.id, p.level, s.descendant_unit_id, s.descendant_level, s.depth + 1
      FROM s JOIN public.administrative_units x ON x.id = s.ancestor_unit_id
             JOIN public.administrative_units p ON p.id = x.parent_id
     WHERE s.depth < 64
  )
  SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM s;`;
const reglaCarga = (s) => { const c = sinComentarios(bloque(s, 'CARGA'));
  return c.includes(CARGA_SQL) && c.includes('GET DIAGNOSTICS v_n = ROW_COUNT;\n  IF v_n <> 888 THEN'); };
check('un INSERT recursivo desde TODAS las unidades (filas propias incluidas), hacia arriba, exigiendo 888', reglaCarga(raw), true);
const reglaCargaGenerica = (s) => { const c = sinComentarios(bloque(s, 'CARGA'));
  return !/'[A-Z]{2}'|iso_alpha2|legacy_id|\bWHERE\s+u\./i.test(c.replace("RAISE EXCEPTION 's7_94 CARGA: se insertaron % filas, se esperaban exactamente 888', v_n;", '').replace("RAISE NOTICE 's7_94 CARGA: 888 filas desde el arbol vivo';", '')); };
check('la carga es genérica: sin país, legacy_id ni filtros sobre las unidades', reglaCargaGenerica(raw), true);
const reglaEscrituras = (s) => { const e = sinLiterales(sinComentarios(s));
  const post = sinLiterales(sinComentarios(bloque(s, 'POST')));
  const insertsFueraPost = (e.replace(post, '').match(/\bINSERT\s+INTO\b/gi) || []).length;
  const sondas = (post.match(/\bINSERT INTO public\.administrative_unit_closure\b/g) || []).length;
  const sondasRevertidas = (sinComentarios(bloque(s, 'POST')).match(/RAISE EXCEPTION 's7_94 sonda aceptada';\n  EXCEPTION WHEN OTHERS THEN\n    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;/g) || []).length;
  return insertsFueraPost === 1 && sondas === 5 && sondasRevertidas === 5
    && !/\b(UPDATE\s+\w+|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO)\b/i.test(e) && (post.match(/\bINSERT\s+INTO\b/gi) || []).length === 5; };
check('escrituras: 1 INSERT de carga; en el POST solo 5 sondas, cada una revertida en su subtransacción; sin UPDATE/DELETE/TRUNCATE', reglaEscrituras(raw), true);

// ═══════════════════════════════════════════════════════════
// 5 · SEGURIDAD Y ALCANCE
// ═══════════════════════════════════════════════════════════
console.log('\n5 · seguridad y alcance');
const reglaRevoke = (s) => { const e = sinComentarios(s); return ocurrencias(e, REVOKE) === 1 && ocurrencias(e, 'ALTER TABLE public.administrative_unit_closure ENABLE ROW LEVEL SECURITY;') === 1; };
check('REVOKE ALL a PUBLIC, anon, authenticated y service_role, y RLS habilitada', reglaRevoke(raw), true);
const reglaSoloEstructura = (s) => !/\b(GRANT|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|VIEW|POLICY|RULE|MATERIALIZED)|SECURITY\s+DEFINER|FORCE\s+ROW\s+LEVEL|DISABLE\s+(ROW|TRIGGER)|session_replication_role)\b/i.test(sinLiterales(sinComentarios(s)));
check('solo estructura: sin GRANT, funciones, procedimientos, triggers, vistas, policies, reglas ni SECURITY DEFINER', reglaSoloEstructura(raw), true);
const reglaAlcance = (s) => { const e = sinLiterales(sinComentarios(s));
  return !/\b(profiles|doctors|doctor_affiliation_requests|patients|departments|municipalities)\b/i.test(e)
    && !/\bpublic\.clinics\b/.test(e.replace(/FROM public\.clinics c\b/g, '').replace(/'public\.clinics'::regclass/g, '')); };
check('alcance: clinics solo se LEE (huellas y triggers); no toca profiles, doctors, afiliaciones ni legacy', reglaAlcance(raw), true);
check('no usa teléfonos', /phone|telefono/i.test(ex), false);
const post = sinComentarios(bloque(raw, 'POST'));
const reglaPostSeguridad = (p) => p.includes("IF v_txt IS DISTINCT FROM '{postgres=arwdDxtm/postgres}|true|false' THEN")
  && p.includes("unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN\n    RAISE EXCEPTION 's7_94 POST: un rol cliente tiene privilegios sobre el cierre';")
  && p.includes("RAISE EXCEPTION 's7_94 POST: % privilegios de columna de cliente sobre el cierre', v_n;")
  && p.includes("RAISE EXCEPTION 's7_94 POST: % policies sobre el cierre', v_n;")
  && p.includes("RAISE EXCEPTION 's7_94 POST: % triggers de usuario sobre el cierre', v_n;")
  && p.includes("RAISE EXCEPTION 's7_94 POST: el cierre esta en % publicaciones', v_n;");
check('POST de seguridad: relacl exacto, RLS, 0 privilegios de tabla y columna, 0 policies, 0 triggers, 0 publicaciones', reglaPostSeguridad(post), true);

// ═══════════════════════════════════════════════════════════
// 6 · PRE, GUARDA y POST
// ═══════════════════════════════════════════════════════════
console.log('\n6 · PRE, GUARDA y POST');
const pre = sinComentarios(bloque(raw, 'PRE'));
check('PRE solo lectura', /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ALTER\s|GRANT\s|REVOKE\s|LOCK\s|CREATE\s|DROP\s)/i.test(sinLiterales(pre)), false);
for (const [lbl, x] of [
  ['current_user = postgres', "IF current_user <> 'postgres' THEN"],
  ['no reaplicar (tabla o índice)', "RAISE EXCEPTION 's7_94 PRE: el cierre o su indice unico ya existen — no reaplicar';"],
  ['nombres y unicidad libres', "= ARRAY['country_id', 'id', 'level'])"],
  ['padre de otro país o nivel incorrecto', 'WHERE p.country_id <> h.country_id OR p.level <> h.level - 1;'],
  ['raíz ⇔ nivel 1', 'WHERE (parent_id IS NULL) <> (level = 1);'],
  ['niveles contiguos', 'HAVING min(l.level) <> 1 OR max(l.level) <> count(*)) z;'],
  ['ciclos por recorrido con ruta', 'x.parent_id = ANY (s.ruta)'],
  ['sin consumidores del modelo nuevo', "p.prosrc ~ '\\m(country_id|territory_unit_id|administrative_units|country_levels)\\M';"],
  ['nada nombra ya un cierre', "p.prosrc ~* '(unit_closure|ancestor_unit_id|descendant_unit_id|au_id_country_level_key)';"],
  ['sin triggers en el catálogo', "tgrelid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass);"],
  ['triggers de clinics normales', "IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN"],
  ['funciones de s7_92 por md5', "md5(p.prosrc) IN ('b8a0d02700685b5d340c8ab1ebfcec17', 'bdb0723c0257b31fe1aaa2bfc609dd6c')"],
  ['catálogo cerrado a clientes', "RAISE EXCEPTION 's7_94 PRE: el catalogo tiene privilegios de cliente: STOP';"],
]) has(`PRE: ${lbl}`, pre, x);
const guarda = sinComentarios(bloque(raw, 'GUARDA'));
for (const k of ['catalogo_filas', 'clinics_filas', 'funciones', 'acl_catalogo', 'policies', 'constraints', 'indices', 'triggers']) {
  has(`GUARDA: huella ${k}`, guarda, `PERFORM set_config('s7_94.${k}',`);
  has(`POST: compara ${k}`, post, `current_setting('s7_94.${k}')`);
}
has('GUARDA: no reaplicar bajo lock', guarda, "RAISE EXCEPTION 's7_94 GUARDA: el cierre o su indice unico ya existen — no reaplicar';");
const reglaPost = {
  forma: (p) => p.includes("'country_id:smallint:true,ancestor_unit_id:bigint:true,ancestor_level:smallint:true,'") && p.includes("IS DISTINCT FROM 'postgres|r|p' THEN"),
  constraints: (p) => p.includes("'administrative_unit_closure_pkey:p,auc_ancestor_fkey:f,auc_depth_levels_chk:c,auc_descendant_fkey:f,auc_self_iff_depth_0_chk:c'"),
  fks: (p) => p.includes("'auc_ancestor_fkey(ancestor_unit_id,country_id,ancestor_level)->administrative_units(id,country_id,level):au_id_country_level_key:aas:true:false ; '"),
  indices: (p) => p.includes("'auc_descendant_level_idx:false:true:true:descendant_unit_id,ancestor_level+ancestor_unit_id'"),
  filasPropias: (p) => p.includes("RAISE EXCEPTION 's7_94 POST: % filas propias para % unidades'"),
  paisNiveles: (p) => p.includes("RAISE EXCEPTION 's7_94 POST: % filas con pais o niveles distintos de los del catalogo', v_n;"),
  deriva: (p) => p.includes('JOIN public.administrative_units h ON h.parent_id = b.descendant_unit_id')
    && p.includes('(SELECT count(*) FROM (SELECT * FROM esp EXCEPT SELECT * FROM alm) f)') && p.includes('(SELECT count(*) FROM (SELECT * FROM alm EXCEPT SELECT * FROM esp) s)')
    && p.includes("RAISE EXCEPTION 's7_94 POST: deriva del cierre frente al arbol vivo (Z = %)', v_n;"),
  sondas: (p) => ['auc_self_iff_depth_0_chk', 'auc_depth_levels_chk', 'auc_ancestor_fkey', 'auc_descendant_fkey', 'administrative_unit_closure_pkey']
    .every((c) => p.includes(`IF v_con IS DISTINCT FROM '${c}' THEN`)) && p.includes("RAISE EXCEPTION 's7_94 POST: las sondas dejaron residuos en el cierre';"),
  catalogoIntacto: (p) => p.includes("IF v_txt IS DISTINCT FROM v_huella_catalogo THEN RAISE EXCEPTION 's7_94 POST: cambio la huella del catalogo'; END IF;"),
  rollbacksEjecutables: (p) => p.includes("RAISE EXCEPTION 's7_94 POST: % funciones invalidarian los rollbacks de s7_93 y s7_92', v_n;")
    && p.includes("RAISE EXCEPTION 's7_94 POST: % dependencias de vistas sobre el modelo nuevo', v_n;"),
};
for (const [k, f] of Object.entries(reglaPost)) check(`POST: ${k}`, f(post), true);

// ═══════════════════════════════════════════════════════════
// 7 · ROLLBACK
// ═══════════════════════════════════════════════════════════
console.log('\n7 · rollback');
const exRb = sinComentarios(rawRb);
check('atómico: un BEGIN; y un COMMIT;', `${(exRb.match(/^BEGIN;/gm) || []).length},${(exRb.match(/^COMMIT;/gm) || []).length}`, '1,1');
const PASOS_RB = ['\nBEGIN;', "SET LOCAL lock_timeout = '5s';", 'LOCK TABLE public.administrative_units IN SHARE ROW EXCLUSIVE MODE;',
  'DO $PREVIA$', 'END $PREVIA$;', 'DO $RETIRO$', 'END $RETIRO$;', 'DO $VERIFICA$', 'END $VERIFICA$;', '\nCOMMIT;'];
const reglaOrdenRb = (s) => { const e = sinComentarios(s); const p = PASOS_RB.map((x) => (ocurrencias(e, x) === 1 ? e.indexOf(x) : -1));
  return p.every((x, i) => x >= 0 && (i === 0 || x > p[i - 1])); };
check('orden: BEGIN → lock_timeout → LOCK → PREVIA → RETIRO → VERIFICA → COMMIT', reglaOrdenRb(rawRb), true);
const previa = sinComentarios(bloque(rawRb, 'PREVIA'));
const reglaRbValidez = (p) => [
  "RAISE EXCEPTION 'rollback s7_94: s7_94 no esta aplicada completa (cierre o indice ausente) — clasificar el estado antes de nada';",
  "RAISE EXCEPTION 'rollback s7_94: el catalogo cambio despues de s7_94 (%) — el rollback ya no es valido', v_txt;",
  "IF v_txt IS DISTINCT FROM '888|' || v_huella_cierre THEN",
  "p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';",
  "RAISE EXCEPTION 'rollback s7_94: hay funciones que usan el cierre (%) — el rollback ya no es valido', v_txt;",
  "WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.administrative_unit_closure'::regclass;",
  "RAISE EXCEPTION 'rollback s7_94: % policies usan el cierre — el rollback ya no es valido', v_n;",
  "RAISE EXCEPTION 'rollback s7_94: % triggers de usuario sobre el cierre — el rollback ya no es valido', v_n;",
  "WHERE contype = 'f' AND confrelid = 'public.administrative_unit_closure'::regclass;",
  "IF v_txt IS DISTINCT FROM 'administrative_unit_closure.auc_ancestor_fkey, administrative_unit_closure.auc_descendant_fkey' THEN",
  "RAISE EXCEPTION 'rollback s7_94: un rol cliente tiene privilegios sobre el cierre — ya hay un consumidor habilitado';",
  "RAISE EXCEPTION 'rollback s7_94: el cierre esta en % publicaciones — el rollback ya no es valido', v_n;",
].every((x) => p.includes(x));
check('PREVIA: aplicada completa, catálogo y cierre intactos, sin consumidores (funciones, vistas, policies, triggers, FK, dependientes del índice, privilegios, publicaciones)', reglaRbValidez(previa), true);
const reglaRbRetiro = (s) => { const r = sinComentarios(bloque(s, 'RETIRO'));
  return r.includes("EXECUTE format('DROP TABLE %I.%I', 'public', 'administrative_unit_closure');\n  EXECUTE format('DROP INDEX %I.%I', 'public', 'au_id_country_level_key');")
    && !/CASCADE/i.test(r) && (sinLiterales(sinComentarios(s)).match(/\bEXECUTE\b/g) || []).length === 2; };
check('RETIRO: tabla y luego índice, DDL ensamblado con format(), sin CASCADE; nada más ejecuta DDL', reglaRbRetiro(rawRb), true);
const vrb = sinComentarios(bloque(rawRb, 'VERIFICA'));
for (const k of ['catalogo_filas', 'clinics_filas', 'funciones', 'acl_catalogo', 'policies', 'constraints', 'indices', 'triggers']) {
  has(`PREVIA: huella ${k}`, previa, `PERFORM set_config('s7_94rb.${k}',`);
  has(`VERIFICA: compara ${k}`, vrb, `current_setting('s7_94rb.${k}')`);
}
has('VERIFICA: ambos objetos ausentes', vrb, "RAISE EXCEPTION 'rollback s7_94 VERIFICA: el cierre o el indice siguen existiendo';");
has('VERIFICA: el R2 de s7_93 sigue siendo ejecutable', vrb, "RAISE EXCEPTION 'rollback s7_94 VERIFICA: % funciones invalidarian el R2 de s7_93', v_n;");
const reglaRbSinEscrituras = (s) => !/\b(INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|TRUNCATE|GRANT|REVOKE|CREATE)\b/i.test(sinLiterales(sinComentarios(s)));
check('rollback sin INSERT, UPDATE, DELETE, TRUNCATE, GRANT, REVOKE ni CREATE', reglaRbSinEscrituras(rawRb), true);

// ═══════════════════════════════════════════════════════════
// 8 · BLOQUE DE DERIVA VERSIONADO
// ═══════════════════════════════════════════════════════════
console.log('\n8 · bloque de deriva');
const reglaDeriva = (s) => { const e = sinComentarios(s);
  return e.includes('SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM public.administrative_unit_closure')
    && e.includes('faltan AS (SELECT * FROM esp EXCEPT SELECT * FROM alm)') && e.includes('sobran AS (SELECT * FROM alm EXCEPT SELECT * FROM esp)')
    && e.includes('p.id = ANY (e.ruta)') && !/'[A-Z]{2}'/.test(sinComentarios(s)) && (e.match(/^WITH RECURSIVE/gm) || []).length === 1
    && (e.trim().match(/;/g) || []).length === 1; };
check('deriva: una sentencia, 6 columnas, faltan y sobran, ciclos, genérica (sin códigos de país)', reglaDeriva(rawDr), true);

// ═══════════════════════════════════════════════════════════
// 8.b · BLOQUES READ-ONLY VERSIONADOS (estado, verificación POST, plan)
// ═══════════════════════════════════════════════════════════
console.log('\n8.b · bloques read-only versionados');
const PES = path.join('docs', 'smokes', 's7_94_state_readonly.sql');
const PVE = path.join('docs', 'smokes', 's7_94_post_verification_readonly.sql');
const PPL = path.join('docs', 'smokes', 's7_94_territorial_plan_readonly.sql');
const rawEs = leerLF(PES), rawVe = leerLF(PVE), rawPl = leerLF(PPL);
const reglaSoloLectura = (s) => { const e = sinLiterales(sinComentarios(s));
  return ddlNombrado(s).length === 0 && !/\b(INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|TRUNCATE|ALTER|GRANT|REVOKE|CREATE|DROP|BEGIN|COMMIT|LOCK|SET\s)\b/i.test(e)
    && (e.trim().match(/;/g) || []).length === 1 && e.trim().endsWith(';') && sinDolarEnComentarios(s); };
for (const [n, p, s] of [['estado', PES, rawEs], ['verificación POST', PVE, rawVe], ['plan territorial', PPL, rawPl]]) {
  check(`${n}: rastreado por git (git add -f)`, rastreado(p.split(path.sep).join('/')), true);
  check(`${n}: una sola sentencia, solo lectura, sin DDL, sin $…$ en comentarios`, reglaSoloLectura(s), true);
}
const reglaEstado = (s) => { const e = sinComentarios(s);
  return e.includes("to_regclass('public.administrative_unit_closure') AS t") && e.includes("to_regclass('public.au_id_country_level_key')     AS i")
    && e.includes("CASE WHEN e.t IS NULL THEN NULL") && !/'public\.administrative_unit_closure'::regclass/.test(e)
    && e.includes(`filas = '888' AND huella = '${HUELLA_CIERRE}'`) && e.includes("seguridad = '{postgres=arwdDxtm/postgres}|true|false' AND policies = 0 AND fk_al_indice = 2")
    && e.includes("THEN 'S7_94 APLICADA COMPLETA'") && e.includes("WHEN NOT hay_tabla AND NOT hay_indice THEN 'S7_94 NO APLICADA'") && e.includes("ELSE 'MIXTO: STOP"); };
check('estado: válido en cualquier estado (to_regclass + CASE, sin ::regclass del cierre) y clasifica APLICADA / NO APLICADA / MIXTO', reglaEstado(rawEs), true);
const reglaVerif = (s) => { const e = sinComentarios(s);
  return [`'${HUELLA_CIERRE}'`, `'${HUELLA_CATALOGO}'`, "'888'", "'0=320,1=306,2=262'", "'{postgres=arwdDxtm/postgres}|true|false'",
    "'7c823ad1f5c30fc7a2b5a33fe62c68a7'", "(SELECT count(*) FROM (SELECT * FROM esp EXCEPT SELECT * FROM alm) f) + (SELECT count(*) FROM (SELECT * FROM alm EXCEPT SELECT * FROM esp) s)",
    "'administrative_unit_closure.auc_ancestor_fkey, administrative_unit_closure.auc_descendant_fkey'",
    "SELECT 999, 'Z veredicto · filas con ok = false'"].every((x) => e.includes(x)); };
check('verificación POST: huellas, 888, reparto, relacl exacto, huella C2 de clinics tras s7_93, deriva, dependientes del índice y veredicto Z', reglaVerif(rawVe), true);
const reglaPlan = (s) => { const e = sinComentarios(s).trim();
  return e.startsWith('EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)\nSELECT') && e.includes('JOIN public.administrative_unit_closure k ON k.descendant_unit_id = c.territory_unit_id')
    && e.includes('AND k.ancestor_unit_id = (SELECT') && !/RECURSIVE/i.test(e); };
check('plan: EXPLAIN de un SELECT con UN join al cierre por ancestor_unit_id, sin recursión', reglaPlan(rawPl), true);
const mutacionesRo = [
  ['estado con ::regclass del cierre (fallaría si no existe)', reglaEstado, rawEs, (s) => R(s, "(SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'administrative_unit_closure') AS policies", "(SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'administrative_unit_closure' AND 'public.administrative_unit_closure'::regclass IS NOT NULL) AS policies")],
  ['estado que da APLICADA sin exigir el relacl', reglaEstado, rawEs, (s) => R(s, "AND seguridad = '{postgres=arwdDxtm/postgres}|true|false' AND policies = 0", 'AND policies = 0')],
  ['verificación con otra huella del cierre', reglaVerif, rawVe, (s) => R(s, `'${HUELLA_CIERRE}'`, "'ffffffffffffffffffffffffffffffff'")],
  ['verificación sin la mitad "sobran" de la deriva', reglaVerif, rawVe, (s) => R(s, ' + (SELECT count(*) FROM (SELECT * FROM alm EXCEPT SELECT * FROM esp) s)', '')],
  ['plan con recursión', reglaPlan, rawPl, (s) => R(s, 'EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)\nSELECT', 'EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)\nWITH RECURSIVE r(x) AS (SELECT 1) SELECT')],
  ['bloque read-only con una escritura', reglaSoloLectura, rawVe, (s) => R(s, "UNION ALL SELECT 61, 'F version del servidor (info)'", "UNION ALL SELECT 61, (SELECT 'x' FROM (UPDATE public.clinics SET name = name RETURNING 1) z)")],
  ['bloque read-only con dos sentencias', reglaSoloLectura, rawEs, (s) => s + '\nSELECT 1;\n'],
];

// ═══════════════════════════════════════════════════════════
// 9 · MUTACIÓN CON EXPECTATIVA INVERTIDA
// ═══════════════════════════════════════════════════════════
const R = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutación sin ancla: ${a.slice(0, 60)}`); return s.split(a).join(b); };
const reglas = {
  constantes: (s) => reglaConstantes(s, rawRb), exprCatalogo: reglaExprCatalogo, exprCierre: reglaExprCierre, preEsperado: reglaPreEsperado,
  postContenido: reglaPostContenido, orden: reglaOrden, lock: reglaLock, tabla: reglaTabla, indices: reglaIndices, sinCascada: reglaSinCascada,
  carga: reglaCarga, cargaGenerica: reglaCargaGenerica, escrituras: reglaEscrituras, revoke: reglaRevoke, soloEstructura: reglaSoloEstructura,
  alcance: reglaAlcance, ddl: reglaDdlMigracion, sinDolar: sinDolarEnComentarios,
  postSeguridad: (s) => reglaPostSeguridad(sinComentarios(bloque(s, 'POST'))),
  postDeriva: (s) => reglaPost.deriva(sinComentarios(bloque(s, 'POST'))),
  postSondas: (s) => reglaPost.sondas(sinComentarios(bloque(s, 'POST'))),
  postRollbacks: (s) => reglaPost.rollbacksEjecutables(sinComentarios(bloque(s, 'POST'))),
};
const reglasRb = { constantesRb: (s) => reglaConstantes(raw, s), ordenRb: reglaOrdenRb, validez: (s) => reglaRbValidez(sinComentarios(bloque(s, 'PREVIA'))),
  retiro: reglaRbRetiro, ddlRb: reglaDdlRollback, sinEscriturasRb: reglaRbSinEscrituras };
const mutaciones = [
  ['huella del catálogo distinta en la GUARDA', 'constantes', (s) => { const g = bloque(s, 'GUARDA'); return s.replace(g, R(g, HUELLA_CATALOGO, '00000000000000000000000000000000')); }],
  ['huella del cierre distinta en el POST', 'constantes', (s) => { const g = bloque(s, 'POST'); return s.replace(g, R(g, HUELLA_CIERRE, 'ffffffffffffffffffffffffffffffff')); }],
  ['huella del catálogo sin is_active', 'exprCatalogo', (s) => R(s, " || '|' || u.level || '|' || u.is_active,", " || '|' || u.level,")],
  ['huella del cierre sin depth en el POST', 'exprCierre', (s) => { const g = bloque(s, 'POST'); return s.replace(g, R(g, "ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\\n' ORDER BY", "ancestor_unit_id || '|' || descendant_unit_id, E'\\n' ORDER BY")); }],
  ['PRE que acepta 887 filas', 'preEsperado', (s) => R(s, "'0|888|0=320,1=306,2=262|'", "'0|887|0=320,1=306,2=262|'")],
  ['POST sin exigir el reparto por depth', 'postContenido', (s) => R(s, "IF v_txt IS DISTINCT FROM '0=320,1=306,2=262' THEN", 'IF false THEN')],
  ['REVOKE después del POST', 'orden', (s) => R(R(s, `${REVOKE}\n`, ''), '\nCOMMIT;\n', `\n${REVOKE}\nCOMMIT;\n`)],
  ['carga antes de crear el índice inverso', 'orden', (s) => { const c = bloque(s, 'CARGA') + '\n'; return R(R(s, c, ''), 'CREATE INDEX auc_descendant_level_idx', c + 'CREATE INDEX auc_descendant_level_idx'); }],
  ['UNIQUE como ALTER TABLE ... ADD CONSTRAINT', 'lock', (s) => R(s, 'CREATE UNIQUE INDEX au_id_country_level_key\n  ON public.administrative_units (id, country_id, level);', 'ALTER TABLE public.administrative_units ADD CONSTRAINT au_id_country_level_key UNIQUE (id, country_id, level);')],
  ['lock ACCESS EXCLUSIVE', 'lock', (s) => R(s, 'IN SHARE ROW EXCLUSIVE MODE;', 'IN ACCESS EXCLUSIVE MODE;')],
  ['sin descendant_level (variante N0)', 'tabla', (s) => R(s, '    FOREIGN KEY (descendant_unit_id, country_id, descendant_level)\n    REFERENCES public.administrative_units (id, country_id, level),', '    FOREIGN KEY (descendant_unit_id, country_id)\n    REFERENCES public.administrative_units (id, country_id),')],
  ['CHECK de depth sin los niveles', 'tabla', (s) => R(s, 'CHECK (depth >= 0 AND depth = descendant_level - ancestor_level)', 'CHECK (depth >= 0)')],
  ['sin la regla de fila propia', 'tabla', (s) => R(s, ',\n  CONSTRAINT auc_self_iff_depth_0_chk CHECK ((depth = 0) = (ancestor_unit_id = descendant_unit_id))', '')],
  ['índice inverso sin INCLUDE', 'indices', (s) => R(s, ' INCLUDE (ancestor_unit_id);', ';')],
  ['FK con ON DELETE CASCADE', 'sinCascada', (s) => R(s, 'REFERENCES public.administrative_units (id, country_id, level),\n  CONSTRAINT auc_descendant_fkey', 'REFERENCES public.administrative_units (id, country_id, level) ON DELETE CASCADE,\n  CONSTRAINT auc_descendant_fkey')],
  ['carga sin filas propias (arranca en las raíces)', 'carga', (s) => R(s, 'SELECT u.country_id, u.id, u.level, u.id, u.level, 0 FROM public.administrative_units u\n    UNION ALL', 'SELECT u.country_id, u.id, u.level, u.id, u.level, 0 FROM public.administrative_units u WHERE u.parent_id IS NULL\n    UNION ALL')],
  ['carga que acepta cualquier número de filas', 'carga', (s) => R(s, 'IF v_n <> 888 THEN\n    RAISE EXCEPTION', 'IF v_n < 0 THEN\n    RAISE EXCEPTION')],
  ['carga filtrada por país', 'cargaGenerica', (s) => R(s, 'FROM public.administrative_units u\n    UNION ALL', "FROM public.administrative_units u JOIN public.countries c ON c.id = u.country_id AND c.iso_alpha2 = 'SV'\n    UNION ALL")],
  ['un UPDATE en la migración', 'escrituras', (s) => R(s, 'ANALYZE public.administrative_unit_closure;', "UPDATE public.administrative_units SET name = name WHERE false;\nANALYZE public.administrative_unit_closure;")],
  ['sonda no revertida', 'escrituras', (s) => R(s, "    RAISE EXCEPTION 's7_94 sonda aceptada';\n  EXCEPTION WHEN OTHERS THEN\n    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;\n  END;\n  IF v_con IS DISTINCT FROM 'auc_self_iff_depth_0_chk'", "    NULL;\n  EXCEPTION WHEN OTHERS THEN\n    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;\n  END;\n  IF v_con IS DISTINCT FROM 'auc_self_iff_depth_0_chk'")],
  ['REVOKE sin service_role', 'revoke', (s) => R(s, 'FROM PUBLIC, anon, authenticated, service_role;\n\nANALYZE', 'FROM PUBLIC, anon, authenticated;\n\nANALYZE')],
  ['sin RLS', 'revoke', (s) => R(s, 'ALTER TABLE public.administrative_unit_closure ENABLE ROW LEVEL SECURITY;\n', '')],
  ['GRANT SELECT a anon', 'soloEstructura', (s) => R(s, '\nANALYZE public.administrative_unit_closure;', '\nGRANT SELECT ON public.administrative_unit_closure TO anon;\nANALYZE public.administrative_unit_closure;')],
  ['función de rebuild persistida', 'soloEstructura', (s) => R(s, '\nANALYZE public.administrative_unit_closure;', "\nCREATE FUNCTION public.rebuild_unit_closure() RETURNS void LANGUAGE sql AS 'SELECT 1';\nANALYZE public.administrative_unit_closure;")],
  ['trigger de mantenimiento', 'soloEstructura', (s) => R(s, '\nANALYZE public.administrative_unit_closure;', "\nCREATE TRIGGER trg_auc AFTER INSERT ON public.administrative_units FOR EACH STATEMENT EXECUTE FUNCTION public.f();\nANALYZE public.administrative_unit_closure;")],
  ['FORCE ROW LEVEL SECURITY', 'soloEstructura', (s) => R(s, 'ENABLE ROW LEVEL SECURITY;', 'ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.administrative_unit_closure FORCE ROW LEVEL SECURITY;')],
  ['toca doctors', 'alcance', (s) => R(s, 'ANALYZE public.administrative_unit_closure;', 'ANALYZE public.administrative_unit_closure;\nANALYZE public.doctors;')],
  ['DDL con nombre de un objeto efímero en un comentario', 'ddl', (s) => R(s, '-- ── ROLLBACK ──', '-- ── ROLLBACK ── (retira con DROP TABLE public.administrative_unit_closure)')],
  ['una etiqueta $…$ en un comentario', 'sinDolar', (s) => R(s, '-- Si el PASO 1 lanza excepcion, NO continuar.', '-- Pegar desde DO $PRE$. Si el PASO 1 lanza excepcion, NO continuar.')],
  ['POST sin exigir relacl exacto', 'postSeguridad', (s) => R(s, "IF v_txt IS DISTINCT FROM '{postgres=arwdDxtm/postgres}|true|false' THEN", 'IF false THEN')],
  ['POST sin la mitad "sobran" de la deriva', 'postDeriva', (s) => R(s, '       + (SELECT count(*) FROM (SELECT * FROM alm EXCEPT SELECT * FROM esp) s)\n', '')],
  ['POST sin la sonda de la FK del descendiente', 'postSondas', (s) => R(s, "IF v_con IS DISTINCT FROM 'auc_descendant_fkey' THEN", 'IF false THEN')],
  ['POST sin comprobar que los rollbacks previos siguen siendo ejecutables', 'postRollbacks', (s) => R(s, "RAISE EXCEPTION 's7_94 POST: % funciones invalidarian los rollbacks de s7_93 y s7_92', v_n;", 'NULL;')],
];
const mutacionesRb = [
  ['rollback con otra huella del cierre', 'constantesRb', (s) => R(s, HUELLA_CIERRE, 'ffffffffffffffffffffffffffffffff')],
  ['retiro antes de la PREVIA', 'ordenRb', (s) => { const r = bloque(s, 'RETIRO') + '\n'; return R(R(s, r, ''), 'DO $PREVIA$', r + 'DO $PREVIA$'); }],
  ['PREVIA sin guarda de funciones consumidoras', 'validez', (s) => R(s, "RAISE EXCEPTION 'rollback s7_94: hay funciones que usan el cierre (%) — el rollback ya no es valido', v_txt;", 'NULL;')],
  ['PREVIA sin comprobar la huella del catálogo', 'validez', (s) => R(s, "RAISE EXCEPTION 'rollback s7_94: el catalogo cambio despues de s7_94 (%) — el rollback ya no es valido', v_txt;", 'NULL;')],
  ['PREVIA sin comprobar privilegios de cliente', 'validez', (s) => R(s, "RAISE EXCEPTION 'rollback s7_94: un rol cliente tiene privilegios sobre el cierre — ya hay un consumidor habilitado';", 'NULL;')],
  ['DROP con CASCADE', 'retiro', (s) => R(s, "format('DROP TABLE %I.%I', 'public', 'administrative_unit_closure')", "format('DROP TABLE %I.%I CASCADE', 'public', 'administrative_unit_closure')")],
  ['DROP con el nombre literal', 'ddlRb', (s) => R(s, "EXECUTE format('DROP TABLE %I.%I', 'public', 'administrative_unit_closure');", 'DROP TABLE public.administrative_unit_closure;')],
  ['rollback que además revoca algo', 'sinEscriturasRb', (s) => R(s, '\nCOMMIT;\n', '\nREVOKE ALL ON public.countries FROM anon;\nCOMMIT;\n')],
];
const mutacionesDr = [
  ['deriva que solo cuenta faltantes', (s) => R(s, 'sobran AS (SELECT * FROM alm EXCEPT SELECT * FROM esp)', 'sobran AS (SELECT * FROM alm WHERE false)')],
  ['deriva que compara solo 3 columnas', (s) => R(s, 'SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM public.administrative_unit_closure', 'SELECT country_id, ancestor_unit_id, 0::smallint, descendant_unit_id, 0::smallint, depth FROM public.administrative_unit_closure')],
  ['deriva acotada a SV', (s) => R(s, 'FROM public.administrative_units u\n  UNION ALL', "FROM public.administrative_units u WHERE u.country_id = (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV')\n  UNION ALL")],
];
console.log('\n9 · reglas sobre los archivos reales (control)');
for (const r of new Set(mutaciones.map((m) => m[1]))) check(`la migración cumple ${r}`, reglas[r](raw), true);
for (const r of new Set(mutacionesRb.map((m) => m[1]))) check(`el rollback cumple ${r}`, reglasRb[r](rawRb), true);
check('el bloque de deriva cumple su regla', reglaDeriva(rawDr), true);
console.log('\n9.b · mutación con expectativa INVERTIDA');
const probar = (f) => { try { return f(); } catch (e) { return e.message; } };
for (const [nombre, regla, mut] of mutaciones) check(`detecta: ${nombre}`, probar(() => reglas[regla](mut(raw))), false);
for (const [nombre, regla, mut] of mutacionesRb) check(`detecta: ${nombre}`, probar(() => reglasRb[regla](mut(rawRb))), false);
for (const [nombre, mut] of mutacionesDr) check(`detecta: ${nombre}`, probar(() => reglaDeriva(mut(rawDr))), false);
for (const [nombre, regla, base, mut] of mutacionesRo) check(`detecta: ${nombre}`, probar(() => regla(mut(base))), false);

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
