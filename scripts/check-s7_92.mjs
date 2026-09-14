#!/usr/bin/env node
/**
 * check-s7_92.mjs — Fundación 3B · paso 3: sincronización central legacy → modelo nuevo.
 *
 * s7_92 instala el resolver único, la función del trigger y el trigger sobre
 * clinics, y retira la guarda temporal de F3A en la MISMA transacción. Lo que hay
 * que demostrar sin tocar la base:
 *   · el orden de la transacción: pruebas antes del lock, lock al final con
 *     lock_timeout, guarda retirada solo después de instalar el trigger y antes
 *     del POST, todo antes del COMMIT;
 *   · el resolver: INVOKER, STABLE, search_path fijo, referencias calificadas,
 *     SV por iso_alpha2, nunca nivel 2, y los códigos de E3 en el orden correcto;
 *   · el trigger: único DEFINER, sin SQL dinámico, legacy como autoridad (E2),
 *     intento = no NULL en INSERT o distinto de OLD en UPDATE (E1), P0183;
 *   · seguridad: REVOKE explícito a los cuatro roles, cero GRANT de cliente fuera
 *     de la sonda, sin ENABLE ALWAYS, sin backfill;
 *   · la matriz de la sonda: un MODELO independiente en JS de las reglas del
 *     diseño recalcula el resultado de los 41 casos y debe coincidir con lo que
 *     la migración espera;
 *   · el rollback: vuelve a F3A con la guarda y su comentario byte a byte de s7_89;
 *   · mutaciones con expectativa INVERTIDA: cada regla detecta su violación.
 *
 *   node scripts/check-s7_92.mjs
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

console.log('\ncheck-s7_92 — Fundación 3B · sincronización central de clinics\n');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const P92 = path.join('migrations', 's7_92_geo_foundation_3b_territory_sync.sql');
const P89 = path.join('migrations', 's7_89_geo_foundation_3a_clinics_columns.sql');
const PRB = path.join('docs', 'rollbacks', 's7_92_rollback.sql');
const raw = leerLF(P92);
const rawRb = leerLF(PRB);
const s89 = leerLF(P89);

const sinComentarios = (sql) => sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
const bloque = (s, tag) => {
  const a = s.indexOf(`DO $${tag}$`), b = s.indexOf(`END $${tag}$;`);
  return a === -1 || b === -1 ? '' : s.slice(a, b + `END $${tag}$;`.length);
};
const funcion = (s, nombre) => {
  const a = s.indexOf(`CREATE FUNCTION public.${nombre}(`);
  if (a === -1) return '';
  const b = s.indexOf('\n$fn$;', a);
  return b === -1 ? '' : s.slice(a, b + '\n$fn$;'.length);
};
const cuerpo = (def) => { const a = def.indexOf('AS $fn$'); return a === -1 ? '' : def.slice(a + 'AS $fn$'.length, def.lastIndexOf('$fn$;')); };
const ocurrencias = (s, needle) => s.split(needle).length - 1;
const sinDolarEnComentarios = (s) => s.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length === 0;

// ═══════════════════════════════════════════════════════════
// 0 · ARCHIVOS
// ═══════════════════════════════════════════════════════════
console.log('0 · archivos');
const migs = fs.readdirSync('migrations').filter((f) => f.endsWith('.sql'));
// ⚠️ Reanclado en F3C: s7_93 es posterior. Lo que se fija es la POSICIÓN de s7_92
// (migración 113 en orden), no que sea la última.
check('s7_92 es la migración 113 en orden', [...migs].sort().indexOf(path.basename(P92)) + 1, 113);
check('control: hay al menos 113 migraciones', migs.length >= 113, true);
const rastreado = (p) => { try { execSync(`git ls-files --error-unmatch "${p}"`, { stdio: 'ignore' }); return true; } catch { return false; } };
check('el rollback está rastreado por git (la regla *.sql exige git add -f)', rastreado(PRB.split(path.sep).join('/')), true);
check('sin etiquetas $…$ en comentarios de la migración', sinDolarEnComentarios(raw), true);
check('sin etiquetas $…$ en comentarios del rollback', sinDolarEnComentarios(rawRb), true);

// ═══════════════════════════════════════════════════════════
// 1 · ORDEN DE LA TRANSACCIÓN
// ═══════════════════════════════════════════════════════════
console.log('\n1 · orden de la transacción');
const ex = sinComentarios(raw);
const exSL = sinLiterales(ex);
check('un único BEGIN; y un único COMMIT;', `${(ex.match(/^BEGIN;/gm) || []).length},${(ex.match(/^COMMIT;/gm) || []).length}`, '1,1');
const PASOS = [
  'END $PRE$;',
  'BEGIN;',
  "SET LOCAL lock_timeout = '5s';",
  'DO $INICIO$',
  'CREATE FUNCTION public._territory_from_legacy_sv(',
  'REVOKE ALL ON FUNCTION public._territory_from_legacy_sv(text, text) FROM service_role;',
  'CREATE FUNCTION public._clinics_territory_sync()',
  'REVOKE ALL ON FUNCTION public._clinics_territory_sync() FROM service_role;',
  'DO $RESOLVER$',
  'CREATE TABLE public._s7_92_probe (',
  "INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES\n  (1, 'CH', 'CH-16')",
  'CREATE TRIGGER trg_s7_92_probe_sync',
  'DO $SONDA$',
  'DROP TABLE public._s7_92_probe;',
  'LOCK TABLE public.clinics IN ACCESS EXCLUSIVE MODE;',
  'DO $GUARDA$',
  'CREATE TRIGGER trg_clinics_territory_sync',
  'ALTER TABLE public.clinics DROP CONSTRAINT clinics_geo_f3a_temp_null_chk;',
  'DO $POST$',
  'END $POST$;',
  'COMMIT;',
];
const reglaOrden = (s) => { const e = sinComentarios(s); const p = PASOS.map((n) => (ocurrencias(e, n) === 1 ? e.indexOf(n) : -1));
  return p.every((x, i) => x >= 0 && (i === 0 || x > p[i - 1])); };
for (const n of PASOS) check(`aparece exactamente una vez: ${n}`, ocurrencias(ex, n), 1);
check('orden: PRE fuera → BEGIN → lock_timeout → huellas → resolver → trigger fn → pruebas A → sonda → DROP sonda → LOCK → GUARDA → trigger → retiro de guarda → POST → COMMIT', reglaOrden(raw), true);
check('el PRE está fuera de la transacción', ex.indexOf('DO $PRE$') < ex.indexOf('\nBEGIN;'), true);
check('lock_timeout inmediatamente después del BEGIN', /\nBEGIN;\n\nSET LOCAL lock_timeout = '5s';\n/.test(ex), true);
const reglaLockAlFinal = (s) => { const e = sinComentarios(s); const l = e.indexOf('LOCK TABLE public.clinics');
  return l > e.indexOf('DROP TABLE public._s7_92_probe;') && l > e.indexOf('END $SONDA$;') && l > e.indexOf('END $RESOLVER$;')
    && ocurrencias(e, 'LOCK TABLE') === 1; };
check('E4: el lock de clinics se toma después de TODAS las pruebas', reglaLockAlFinal(raw), true);
check('ninguna sentencia menciona clinics antes del LOCK (salvo el PRE, fuera de la transacción)',
  /\bclinics\b/.test(sinLiterales(ex.slice(ex.indexOf('\nBEGIN;'), ex.indexOf('LOCK TABLE public.clinics')))
    .split(funcion(ex, '_clinics_territory_sync')).join('')), false);
const reglaGuarda = (s) => { const e = sinComentarios(s); const d = e.indexOf('ALTER TABLE public.clinics DROP CONSTRAINT clinics_geo_f3a_temp_null_chk;');
  return ocurrencias(e, 'DROP CONSTRAINT') === 1 && d > e.indexOf('CREATE TRIGGER trg_clinics_territory_sync')
    && d < e.indexOf('DO $POST$') && d > e.indexOf('\nBEGIN;') && d < e.indexOf('\nCOMMIT;'); };
check('la guarda F3A se retira SOLO en la transacción que instala y verifica el trigger', reglaGuarda(raw), true);

// ═══════════════════════════════════════════════════════════
// 2 · RESOLVER
// ═══════════════════════════════════════════════════════════
console.log('\n2 · resolver');
const defRes = funcion(raw, '_territory_from_legacy_sv');
const cRes = sinComentarios(cuerpo(defRes));
check('resolver encontrado', defRes.length > 0, true);
has('firma exacta', defRes, 'CREATE FUNCTION public._territory_from_legacy_sv(\n  p_department_id   text,\n  p_municipality_id text,\n  OUT country_id        smallint,\n  OUT territory_unit_id bigint\n)');
const reglaInvoker = (s) => { const d = funcion(s, '_territory_from_legacy_sv'); const h = d.slice(0, d.indexOf('AS $fn$'));
  return h.includes('\nLANGUAGE plpgsql\nSTABLE\nSECURITY INVOKER\nSET search_path = public, pg_temp\n') && !/SECURITY\s+DEFINER/i.test(h); };
check('LANGUAGE plpgsql · STABLE · SECURITY INVOKER · search_path = public, pg_temp', reglaInvoker(raw), true);
const reglaCalificadas = (s) => {
  const cs = [cuerpo(funcion(s, '_territory_from_legacy_sv')), cuerpo(funcion(s, '_clinics_territory_sync'))].map((c) => sinLiterales(sinComentarios(c)));
  return cs.every((c) => c.length > 0 && !/(?<!DISTINCT\s{1,5})\b(FROM|JOIN)\s+(?!public\.)[a-z_]/i.test(c));
};
check('toda tabla de ambas funciones va calificada public.*', reglaCalificadas(raw), true);
check('los OUT params solo se usan en la asignación final (sin columnas ambiguas)',
  `${(cRes.match(/(?<![.\w])country_id\b/g) || []).length},${(cRes.match(/(?<![.\w])territory_unit_id\b/g) || []).length}`, '1,1');
const reglaSvPorIso = (s) => { const c = sinComentarios(cuerpo(funcion(s, '_territory_from_legacy_sv')));
  return c.includes("SELECT c.id INTO v_sv FROM public.countries c WHERE c.iso_alpha2 = 'SV';") && !/country_id\s*=\s*\d/.test(c); };
check('SV por iso_alpha2, sin ids numéricos fijos', reglaSvPorIso(raw), true);
const reglaSinNivel2 = (s) => { const c = sinComentarios(cuerpo(funcion(s, '_territory_from_legacy_sv')));
  const niveles = (c.match(/\.level\s*(=|IN)\s*[^\s;]+/g) || []);
  return niveles.join('|') === '.level = 1|.level = 3|.level = 1' && !/level\s*(=|IN|<>|>|<)\s*\(?\s*2/.test(c); };
check('solo niveles 1 y 3, nunca 2', reglaSinNivel2(raw), true);
has('ambos NULL → sin país ni unidad', cRes, '  IF p_department_id IS NULL AND p_municipality_id IS NULL THEN\n    RETURN;\n  END IF;');
has('P0024 municipio sin departamento (mensaje de s7_91)', cRes,
  "  IF p_department_id IS NULL THEN\n    RAISE EXCEPTION 'El municipio no puede quedar sin departamento' USING ERRCODE = 'P0024';");
has('P0026 departamento inexistente', cRes,
  "  PERFORM 1 FROM public.departments d WHERE d.id = p_department_id;\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'El departamento no existe' USING ERRCODE = 'P0026';");
has('P0025 relacional (mensaje de s7_91)', cRes,
  "    PERFORM 1 FROM public.municipalities m\n     WHERE m.id = p_municipality_id AND m.department_id = p_department_id;\n    IF NOT FOUND THEN\n      RAISE EXCEPTION 'El municipio no existe o no pertenece al departamento indicado' USING ERRCODE = 'P0025';");
check('P0180 en los tres puntos del puente (país, nivel 1, nivel 3)', ocurrencias(cRes, "USING ERRCODE = 'P0180'"), 3);
has('nivel 3 exige el abuelo de nivel 1 = departamento', cRes,
  '      JOIN public.administrative_units u2 ON u2.id = u3.parent_id\n      JOIN public.administrative_units u1 ON u1.id = u2.parent_id\n     WHERE u3.country_id = v_sv AND u3.legacy_id = p_municipality_id AND u3.level = 3\n       AND u1.level = 1 AND u1.legacy_id = p_department_id;');
const iRes = (n) => cRes.indexOf(n);
check('orden de errores: P0024 → P0026 → país (P0180) → P0025 → unidad (P0180)',
  iRes("'P0024'") < iRes("'P0026'") && iRes("'P0026'") < iRes("iso_alpha2 = 'SV'") && iRes("iso_alpha2 = 'SV'") < iRes("'P0025'")
  && iRes("'P0025'") < cRes.lastIndexOf("'P0180'"), true);
check('sin escrituras en el resolver', /\b(INSERT|UPDATE|DELETE|EXECUTE)\b/i.test(sinLiterales(cRes)), false);

// ═══════════════════════════════════════════════════════════
// 3 · FUNCIÓN DEL TRIGGER
// ═══════════════════════════════════════════════════════════
console.log('\n3 · función del trigger');
const defTr = funcion(raw, '_clinics_territory_sync');
const cTr = sinComentarios(cuerpo(defTr));
check('función del trigger encontrada', defTr.length > 0, true);
has('RETURNS trigger · plpgsql · SECURITY DEFINER · search_path fijo', defTr,
  'CREATE FUNCTION public._clinics_territory_sync()\nRETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$');
const reglaUnicoDefiner = (s) => { const e = sinLiterales(sinComentarios(s)); const m = e.match(/SECURITY\s+DEFINER/gi) || [];
  const d = sinLiterales(sinComentarios(funcion(s, '_clinics_territory_sync')));
  return m.length === 1 && /SECURITY\s+DEFINER/i.test(d); };
check('SECURITY DEFINER aparece una sola vez en la migración, y es la función del trigger', reglaUnicoDefiner(raw), true);
const reglaSinDinamico = (s) => !/\b(EXECUTE|format\s*\()/i.test(sinLiterales(sinComentarios(cuerpo(funcion(s, '_clinics_territory_sync')))));
check('sin SQL dinámico en el trigger', reglaSinDinamico(raw), true);
has('UPDATE sin cambios en las 4 columnas: RETURN NEW anidado (OLD no se lee en INSERT)', cTr,
  "  IF TG_OP = 'UPDATE' THEN\n    IF NEW.department_id     IS NOT DISTINCT FROM OLD.department_id\n       AND NEW.municipality_id   IS NOT DISTINCT FROM OLD.municipality_id\n       AND NEW.country_id        IS NOT DISTINCT FROM OLD.country_id\n       AND NEW.territory_unit_id IS NOT DISTINCT FROM OLD.territory_unit_id THEN\n      RETURN NEW;\n    END IF;\n  END IF;");
has('deriva SIEMPRE con el resolver único, desde NEW legacy', cTr,
  '  SELECT t.country_id, t.territory_unit_id INTO r\n    FROM public._territory_from_legacy_sv(NEW.department_id, NEW.municipality_id) AS t;');
const reglaE1 = (s) => { const c = sinComentarios(cuerpo(funcion(s, '_clinics_territory_sync')));
  return c.includes("  IF TG_OP = 'INSERT' THEN\n    v_fija_pais   := NEW.country_id IS NOT NULL;\n    v_fija_unidad := NEW.territory_unit_id IS NOT NULL;\n  ELSE\n    v_fija_pais   := NEW.country_id IS DISTINCT FROM OLD.country_id;\n    v_fija_unidad := NEW.territory_unit_id IS DISTINCT FROM OLD.territory_unit_id;\n  END IF;"); };
check('E1: intento = no NULL en INSERT; distinto de OLD en UPDATE', reglaE1(raw), true);
const reglaContradiccion = (s) => sinComentarios(cuerpo(funcion(s, '_clinics_territory_sync'))).includes(
  "  IF (v_fija_pais AND NEW.country_id IS DISTINCT FROM r.country_id)\n     OR (v_fija_unidad AND NEW.territory_unit_id IS DISTINCT FROM r.territory_unit_id) THEN\n    RAISE EXCEPTION 'Las columnas territoriales se derivan de la ubicacion legacy y no admiten otro valor'\n      USING ERRCODE = 'P0183';\n  END IF;");
check('contradicción → P0183', reglaContradiccion(raw), true);
const reglaAsignaSiempre = (s) => sinComentarios(cuerpo(funcion(s, '_clinics_territory_sync'))).trimEnd().endsWith(
  "USING ERRCODE = 'P0183';\n  END IF;\n\n  \n  NEW.country_id        := r.country_id;\n  NEW.territory_unit_id := r.territory_unit_id;\n  RETURN NEW;\nEND;");
check('E2: asignación incondicional del resultado del resolver, al final', reglaAsignaSiempre(raw), true);
check('la derivación ocurre antes de evaluar la contradicción (errores del legacy primero)',
  cTr.indexOf('_territory_from_legacy_sv(') < cTr.indexOf("'P0183'"), true);
check('RAISE con P0183 solo en la función del trigger', ocurrencias(sinComentarios(raw.split(defTr).join('')), "ERRCODE = 'P0183'"), 0);

// ═══════════════════════════════════════════════════════════
// 4 · SEGURIDAD Y ALCANCE
// ═══════════════════════════════════════════════════════════
console.log('\n4 · seguridad y alcance');
const REVOKES = ['PUBLIC', 'anon', 'authenticated', 'service_role'].flatMap((r) => [
  `REVOKE ALL ON FUNCTION public._territory_from_legacy_sv(text, text) FROM ${r};`,
  `REVOKE ALL ON FUNCTION public._clinics_territory_sync() FROM ${r};`]);
const reglaRevokes = (s) => { const e = sinComentarios(s); return REVOKES.every((r) => ocurrencias(e, r) === 1); };
check('REVOKE EXECUTE explícito de ambas funciones a PUBLIC, anon, authenticated y service_role', reglaRevokes(raw), true);
const reglaSinGrantCliente = (s) => { const g = sinLiterales(sinComentarios(s)).match(/\bGRANT\b[^;]*;/gi) || [];
  return g.length === 1 && g[0] === 'GRANT SELECT, INSERT, UPDATE ON TABLE public._s7_92_probe TO authenticated;'; };
check('único GRANT: la sonda efímera a authenticated', reglaSinGrantCliente(raw), true);
const reglaTriggerNormal = (s) => !/\bENABLE\s+(ALWAYS|REPLICA)\b/i.test(sinComentarios(s)) && !/\b(DISABLE|ENABLE)\s+TRIGGER\b/i.test(sinComentarios(s));
check('D4: trigger normal, sin ENABLE ALWAYS/REPLICA ni DISABLE/ENABLE TRIGGER', reglaTriggerNormal(raw), true);
const reglaSinBackfill = (s) => !/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(TABLE\s+)?public\.clinics\b/i.test(sinLiterales(sinComentarios(s)))
  && !/\bUPDATE\s+clinics\b/i.test(sinLiterales(sinComentarios(s)));
check('sin backfill: ninguna escritura sobre clinics', reglaSinBackfill(raw), true);
check('ALTER TABLE sobre clinics: solo el retiro de la guarda',
  (exSL.match(/ALTER TABLE public\.clinics[^;]*;/g) || []).join('|'), 'ALTER TABLE public.clinics DROP CONSTRAINT clinics_geo_f3a_temp_null_chk;');
check('sin ALTER DEFAULT PRIVILEGES, POLICY ni ROW LEVEL SECURITY sobre tablas reales',
  /ALTER\s+DEFAULT\s+PRIVILEGES|\bPOLICY\b/i.test(exSL) || (exSL.match(/ROW LEVEL SECURITY/g) || []).length !== 1, false);
has('la única línea de RLS es la sonda', exSL, 'ALTER TABLE public._s7_92_probe DISABLE ROW LEVEL SECURITY;');
check('no toca profiles, doctor_affiliation_requests ni otras funciones existentes',
  /\b(profiles|doctor_affiliation_requests)\b|CREATE\s+OR\s+REPLACE/i.test(exSL), false);
check('solo crea dos funciones', (exSL.match(/CREATE\s+FUNCTION/gi) || []).length, 2);
check('no usa teléfonos', /phone/i.test(ex), false);
const DEF_TRIGGER = (tabla, nombre) => `CREATE TRIGGER ${nombre}\n  BEFORE INSERT OR UPDATE OF department_id, municipality_id, country_id, territory_unit_id\n  ON public.${tabla}\n  FOR EACH ROW EXECUTE FUNCTION public._clinics_territory_sync();`;
has('trigger sobre clinics: BEFORE INSERT OR UPDATE OF las 4 columnas, FOR EACH ROW', ex, DEF_TRIGGER('clinics', 'trg_clinics_territory_sync'));
has('la sonda usa el MISMO trigger (misma función y mismas columnas)', ex, DEF_TRIGGER('_s7_92_probe', 'trg_s7_92_probe_sync'));
check('dos CREATE TRIGGER en total', (exSL.match(/CREATE\s+TRIGGER/gi) || []).length, 2);

// ═══════════════════════════════════════════════════════════
// 5 · PRE
// ═══════════════════════════════════════════════════════════
console.log('\n5 · PRE');
const pre = sinComentarios(bloque(raw, 'PRE'));
check('PRE solo lectura', /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s|ALTER\s|DROP\s|GRANT\s|REVOKE\s|LOCK\s)/i.test(sinLiterales(pre)), false);
for (const [lbl, n] of [
  ['guarda F3A en pie', "conname = 'clinics_geo_f3a_temp_null_chk'"],
  ['CHECK estructural en pie', "conname = 'clinics_territory_requires_country_chk'"],
  ['0 clinicas con geo', 'WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL'],
  ['0 pares legacy incoherentes', 'AND (c.department_id IS NULL OR m.department_id IS DISTINCT FROM c.department_id)'],
  ['0 departamentos inexistentes', 'NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = c.department_id)'],
  ['SV exactamente una vez', "(SELECT count(*) FROM public.countries WHERE iso_alpha2 = 'SV') <> 1"],
  ['puente de nivel 1 completo', 'u.level = 1 AND u.legacy_id = d.id'],
  ['puente de nivel 3 completo', 'u1.level = 1 AND u1.legacy_id = m.department_id'],
  ['0 nivel 2 con legacy_id', 'WHERE level = 2 AND legacy_id IS NOT NULL'],
  ['solo trg_clinics_updated_at', "IS DISTINCT FROM 'trg_clinics_updated_at'"],
  ['sin reglas', "FROM pg_rewrite WHERE ev_class = 'public.clinics'::regclass"],
  ['s7_90 aplicada', "id = 'CH-16' AND name = 'San Miguel de Mercedes'"],
  ['s7_91 aplicada por md5 LF/CRLF', "IN ('a249f92a4b7d3388ee49a11f56edb4b3', 'd36698a985b73a457b87bfa12b23cb75')"],
  ['nombres libres', "proname IN ('_territory_from_legacy_sv', '_clinics_territory_sync')"],
  ['códigos libres', "prosrc ~ 'P0026|P0180|P0183'"],
  ['current_user = postgres', "current_user <> 'postgres'"],
  ['postgres con bypassrls', "rolbypassrls FROM pg_roles WHERE rolname = 'postgres'"],
  ['postgres miembro de authenticated', "pg_has_role(current_user, 'authenticated', 'MEMBER')"],
  ['H: ningún rol cliente con CREATE en public', "has_schema_privilege('authenticated', 'public', 'CREATE')"],
  ['H: PUBLIC sin CREATE', "a.grantee = 0 AND a.privilege_type = 'CREATE'"],
  ['catálogo sin SELECT de cliente', "has_table_privilege(r.rol, t.tabla, 'SELECT')"],
]) has(`PRE: ${lbl}`, pre, n);

// ═══════════════════════════════════════════════════════════
// 6 · PRUEBAS A (resolver) · GUARDA · POST
// ═══════════════════════════════════════════════════════════
console.log('\n6 · pruebas del resolver, GUARDA y POST');
const bRes = sinComentarios(bloque(raw, 'RESOLVER'));
check('pruebas A sin escrituras', /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)/i.test(sinLiterales(bRes)), false);
has('recorre los departamentos', bRes, 'FOR d IN SELECT dd.id FROM public.departments dd ORDER BY dd.id LOOP');
has('recorre los municipios', bRes, 'FOR m IN SELECT mm.id, mm.department_id FROM public.municipalities mm ORDER BY mm.id LOOP');
has('exige 14 + 262 y 0 nivel 2', bRes, 'IF v_n1 <> 14 OR v_n3 <> 262 OR v_nivel2 <> 0 THEN');
for (const [cod, dep, mun] of [['P0024', 'NULL::text', "'CH-16'::text"], ['P0025', "'CH'", 'v_m2'], ['P0025', "'CH'", "'XX-99'"], ['P0026', "'ZZ'", 'NULL::text']]) {
  check(`error exacto ${cod} (${dep}, ${mun})`, new RegExp(`\\('${cod}',\\s+${dep.replace(/[()]/g, '\\$&')},\\s+${mun.replace(/[()]/g, '\\$&')}\\)`).test(bRes), true);
}
check('negativos de privilegio bajo authenticated: EXECUTE del resolver y SELECT del catálogo → 42501',
  ocurrencias(bRes, "EXECUTE 'SET LOCAL ROLE authenticated';") === 2 && ocurrencias(bRes, "IS DISTINCT FROM '42501'") === 2
  && bRes.includes('PERFORM 1 FROM public.administrative_units LIMIT 1;'), true);
check('pruebas A exigen el privilegio directamente (el negativo conductual no discrimina: el INVOKER falla igual al leer el catálogo)',
  ['authenticated', 'anon', 'service_role'].every((x) => bRes.includes(`has_function_privilege('${x}', 'public._territory_from_legacy_sv(text, text)', 'EXECUTE')`)), true);
check('el rol vuelve a postgres (RESET ROLE tras cada negativo, y se verifica)',
  ocurrencias(bRes, "EXECUTE 'RESET ROLE';") === 2 && bRes.includes("IF current_user <> 'postgres' THEN"), true);

const guarda = sinComentarios(bloque(raw, 'GUARDA'));
has('GUARDA: la guarda F3A tiene la definición de s7_89', guarda, "= 'checkcountry_idisnullandterritory_unit_idisnull'");
has('GUARDA: huella de filas de clinics', guarda, "PERFORM set_config('s7_92.clinics_filas',");
has('GUARDA: huella de privilegios y RLS', guarda, "PERFORM set_config('s7_92.clinics_acl',");
has('GUARDA: huella de policies', guarda, "PERFORM set_config('s7_92.clinics_policies',");

const post = sinComentarios(bloque(raw, 'POST'));
const reglaPost = {
  tgtype: (p) => p.includes('IF r.tgtype <> 23 THEN'),
  tgenabled: (p) => p.includes("IF r.habilitado <> 'O' THEN"),
  columnas: (p) => p.includes("IF r.columnas IS DISTINCT FROM 'country_id,department_id,municipality_id,territory_unit_id' THEN"),
  soloDos: (p) => p.includes("IS DISTINCT FROM 'trg_clinics_territory_sync,trg_clinics_updated_at' THEN"),
  definer: (p) => p.includes("IF (r.proname = '_clinics_territory_sync') IS DISTINCT FROM r.prosecdef THEN"),
  config: (p) => p.includes("IF r.config IS DISTINCT FROM 'search_path=public,pg_temp' OR r.dueno <> 'postgres' THEN"),
  stable: (p) => p.includes("IF r.proname = '_territory_from_legacy_sv' AND r.vol <> 's' THEN"),
  execute: (p) => ['anon', 'authenticated', 'service_role'].every((x) => p.includes(`has_function_privilege('${x}', r.oid, 'EXECUTE')`))
    && p.includes("a.grantee = 0 AND a.privilege_type = 'EXECUTE'"),
  guardaFuera: (p) => p.includes("IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinics_geo_f3a_temp_null_chk') THEN"),
  estructurales: (p) => p.includes("conname IN ('clinics_territory_requires_country_chk', 'clinics_country_fkey', 'clinics_territory_unit_country_fkey')"),
  filas: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_92.clinics_filas') THEN"),
  acl: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_92.clinics_acl') THEN"),
  policies: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_92.clinics_policies') THEN"),
  catalogo: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_92.acl_catalogo') THEN"),
  otras: (p) => p.includes("IF v_txt IS DISTINCT FROM current_setting('s7_92.otras_funciones') THEN"),
  approve: (p) => p.includes("p.proname = 'admin_approve_and_create_doctor'") && p.includes("IN ('a249f92a4b7d3388ee49a11f56edb4b3', 'd36698a985b73a457b87bfa12b23cb75')"),
  dbr: (p) => p.includes("p.proname = 'doctor_booking_ready'") && p.includes("IN ('901a951f179018d53979c421c0728f3c', 'fe96306a162b95754fe224a6fcd24ba8')"),
  sonda: (p) => p.includes("IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '_s7_92_probe') THEN"),
};
for (const [k, f] of Object.entries(reglaPost)) check(`POST: ${k}`, f(post), true);
check('POST y huellas de INICIO usan la MISMA expresión de funciones',
  sinComentarios(bloque(raw, 'INICIO')).includes("|| md5(p.prosrc) || coalesce(p.proacl::text, ''), ','") && post.includes("|| md5(p.prosrc) || coalesce(p.proacl::text, ''), ','"), true);
check('GUARDA y POST usan la MISMA expresión de filas',
  guarda.includes("(SELECT md5(coalesce(string_agg(c::text, E'\\n' ORDER BY c.id), '')) FROM public.clinics c)")
  && post.includes("SELECT md5(coalesce(string_agg(c::text, E'\\n' ORDER BY c.id), '')) INTO v_txt FROM public.clinics c;"), true);

// ═══════════════════════════════════════════════════════════
// 7 · SONDA: MODELO INDEPENDIENTE DE LAS REGLAS DEL DISEÑO
// ═══════════════════════════════════════════════════════════
console.log('\n7 · sonda: modelo independiente');
// Catálogo simbólico: CH con CH-16; D2 con M2; ZZ no existe. U(x) = unidad con legacy x; N2 = padre de nivel 2 de CH-16.
const DEPTS = new Set(['CH', 'D2']);
const MUNIS = { 'CH-16': 'CH', M2: 'D2' };
const error = (c) => { const e = new Error(c); e.codigo = c; return e; };
const resolver = (dep, mun) => {
  if (dep == null && mun == null) return [null, null];
  if (dep == null) throw error('P0024');
  if (!DEPTS.has(dep)) throw error('P0026');
  if (mun == null) return ['SV', `U(${dep})`];
  if (MUNIS[mun] !== dep) throw error('P0025');
  return ['SV', `U(${mun})`];
};
const COLS = ['dep', 'mun', 'pais', 'unidad'];
const trigger = (op, OLD, NEW) => {
  if (op === 'UPDATE' && COLS.every((k) => OLD[k] === NEW[k])) return NEW;
  const [p, u] = resolver(NEW.dep, NEW.mun);
  const fp = op === 'INSERT' ? NEW.pais != null : NEW.pais !== OLD.pais;
  const fu = op === 'INSERT' ? NEW.unidad != null : NEW.unidad !== OLD.unidad;
  if ((fp && NEW.pais !== p) || (fu && NEW.unidad !== u)) throw error('P0183');
  return { ...NEW, pais: p, unidad: u };
};
const vacia = { dep: null, mun: null, pais: null, unidad: null, nota: null };
const filas = new Map();
for (const id of [1, 2, 3, 5, 6]) filas.set(id, { ...vacia, dep: 'CH', mun: 'CH-16' });   // históricas, sin trigger
filas.set(4, { ...vacia });
const ins = (id, v) => { const n = trigger('INSERT', null, { ...vacia, ...v }); if (filas.has(id)) throw error('23505'); filas.set(id, n); };
const upd = (id, v) => { const o = filas.get(id); const n = { ...o, ...v };
  const dispara = Object.keys(v).some((k) => COLS.includes(k));   // UPDATE OF las 4 columnas
  filas.set(id, dispara ? trigger('UPDATE', o, n) : n); };
const ups = (id, vIns, vUpd) => { trigger('INSERT', null, { ...vacia, ...vIns }); if (!filas.has(id)) return ins(id, vIns); upd(id, vUpd); };
const CHM = { dep: 'CH', mun: 'CH-16' };
const casos = [
  ['I1 sin ubicacion', 101, () => ins(101, {}), ['INSERT INTO public._s7_92_probe (id) VALUES (101)']],
  ['I2 solo departamento', 102, () => ins(102, { dep: 'CH' }), ["(id, department_id) VALUES (102, %L)', 'CH'"]],
  ['I3 departamento + municipio', 103, () => ins(103, CHM), ["(id, department_id, municipality_id) VALUES (103, %L, %L)', 'CH', 'CH-16'"]],
  ['I4 geo coincidente', 104, () => ins(104, { ...CHM, pais: 'SV', unidad: 'U(CH-16)' }), ["VALUES (104, %L, %L, %s, %s)', 'CH', 'CH-16', v_sv, v_u_ch16"]],
  ['I5 geo contradictoria', 105, () => ins(105, { ...CHM, pais: 'SV', unidad: 'U(CH)' }), ["VALUES (105, %L, %L, %s, %s)', 'CH', 'CH-16', v_sv, v_u_ch)"]],
  ['I6 pais sin ubicacion', 106, () => ins(106, { pais: 'SV' }), ["(id, country_id) VALUES (106, %s)', v_sv"]],
  ['I7 municipio sin departamento', 107, () => ins(107, { mun: 'CH-16' }), ["(id, municipality_id) VALUES (107, %L)', 'CH-16'"]],
  ['I8 par incoherente', 108, () => ins(108, { dep: 'CH', mun: 'M2' }), ["VALUES (108, %L, %L)', 'CH', v_m2"]],
  ['I9 departamento inexistente', 109, () => ins(109, { dep: 'ZZ' }), ["(id, department_id) VALUES (109, %L)', 'ZZ'"]],
  ['I10 unidad de nivel 2', 110, () => ins(110, { ...CHM, pais: 'SV', unidad: 'U(N2)' }), ["VALUES (110, %L, %L, %s, %s)', 'CH', 'CH-16', v_sv, v_u_n2"]],
  ...Array.from({ length: 11 }, (_, i) => [`S derivada ${201 + i}`, 201 + i, () => ins(201 + i, CHM),
    [`(id, department_id, municipality_id) VALUES (${201 + i}, %L, %L)', 'CH', 'CH-16'`]]),
  ['U1 solo legacy', 201, () => upd(201, { dep: 'D2', mun: 'M2' }), ["SET department_id = %L, municipality_id = %L WHERE id = 201', v_d2, v_m2"]],
  ['U2 solo geo coincidente en fila historica', 1, () => upd(1, { pais: 'SV', unidad: 'U(CH-16)' }), ["SET country_id = %s, territory_unit_id = %s WHERE id = 1', v_sv, v_u_ch16"]],
  ['U3 solo geo contradictoria en fila historica', 2, () => upd(2, { pais: 'SV', unidad: 'U(CH)' }), ["SET country_id = %s, territory_unit_id = %s WHERE id = 2', v_sv, v_u_ch)"]],
  ['U4 geo a NULL en fila derivada', 202, () => upd(202, { unidad: null }), ['SET territory_unit_id = NULL WHERE id = 202']],
  ['U5 legacy + geo coincidente', 203, () => upd(203, { dep: 'D2', mun: 'M2', pais: 'SV', unidad: 'U(M2)' }), ["country_id = %s, territory_unit_id = %s WHERE id = 203', v_d2, v_m2, v_sv, v_u_m2"]],
  ['U6 legacy + geo contradictoria', 204, () => upd(204, { dep: 'D2', mun: 'M2', unidad: 'U(CH)' }), ["municipality_id = %L, territory_unit_id = %s WHERE id = 204', v_d2, v_m2, v_u_ch)"]],
  ['U7 legacy + geo anterior reenviado', 205, () => upd(205, { dep: 'D2', mun: 'M2', pais: 'SV', unidad: 'U(CH-16)' }), ["country_id = %s, territory_unit_id = %s WHERE id = 205', v_d2, v_m2, v_sv, v_u_ch16"]],
  ['U8 cambio de departamento con municipio anterior', 206, () => upd(206, { dep: 'D2' }), ["SET department_id = %L WHERE id = 206', v_d2"]],
  ['U9 municipio sin departamento', 207, () => upd(207, { dep: null }), ['SET department_id = NULL WHERE id = 207']],
  ['U10 par legacy incoherente', 208, () => upd(208, { mun: 'M2' }), ["SET municipality_id = %L WHERE id = 208', v_m2"]],
  ['U11 re-guardar misma ubicacion en fila historica', 3, () => upd(3, { dep: 'CH', mun: 'CH-16' }), ['SET department_id = department_id, municipality_id = municipality_id WHERE id = 3']],
  ['U12 columna ajena', 210, () => upd(210, { nota: 'x' }), ["SET nota = ''x'' WHERE id = 210"]],
  ['U13 vaciar ubicacion', 209, () => upd(209, { dep: null, mun: null }), ['SET department_id = NULL, municipality_id = NULL WHERE id = 209']],
  ['U14 upsert contradictorio', 211, () => ups(211, CHM, { unidad: 'U(CH)' }), ["VALUES (211, %L, %L) ON CONFLICT (id) DO UPDATE SET territory_unit_id = %s', 'CH', 'CH-16', v_u_ch)"]],
  ['U15 pais en fila historica sin ubicacion', 4, () => upd(4, { pais: 'SV' }), ["SET country_id = %s WHERE id = 4', v_sv"]],
  ['U16 cambio legacy en fila historica (dual-write)', 5, () => upd(5, { mun: null }), ['SET municipality_id = NULL WHERE id = 5']],
  ['R1 insert coherente', 301, () => ins(301, CHM), ["VALUES (301, %L, %L)', 'CH', 'CH-16'"]],
  ['R2 insert contradictorio', 302, () => ins(302, { ...CHM, unidad: 'U(CH)' }), ["territory_unit_id) VALUES (302, %L, %L, %s)', 'CH', 'CH-16', v_u_ch)"]],
  ['R3 geo contradictoria en fila historica', 6, () => upd(6, { unidad: 'U(CH)' }), ["SET territory_unit_id = %s WHERE id = 6', v_u_ch)"]],
  ['R4 cambio de departamento con municipio anterior', 301, () => upd(301, { dep: 'D2' }), ["SET department_id = %L WHERE id = 301', v_d2"]],
];
const simbolo = (f) => {
  if (f.pais == null && f.unidad == null) return "'NULL|NULL'";
  return { 'U(CH-16)': 'e_ch16', 'U(CH)': 'e_ch', 'U(M2)': 'e_m2' }[f.unidad] || `?${f.unidad}`;
};
const modelo = casos.map(([lbl, id, op]) => { try { op(); return [lbl, simbolo(filas.get(id))]; } catch (e) { if (!e.codigo) throw e; return [lbl, `'ERROR:${e.codigo}'`]; } });

const RE_CASO = /^\s*jsonb_build_array\('([^']+)', '(postgres|authenticated)', (\d+), (.*), (e_ch16|e_ch|e_m2|'NULL\|NULL'|'ERROR:P0\d{3}')\),?$/;
const casosSql = (s) => sinComentarios(bloque(s, 'SONDA')).split('\n').map((l) => l.match(RE_CASO)).filter(Boolean)
  .map((m) => ({ lbl: m[1], rol: m[2], id: +m[3], sentencia: m[4], esperado: m[5] }));
const reglaModelo = (s) => { const sq = casosSql(s);
  return sq.length === casos.length && modelo.every(([lbl, esp], i) => sq[i].lbl === lbl && sq[i].esperado === esp && sq[i].id === casos[i][1]
    && casos[i][3].every((fr) => (sq[i].sentencia + ')').includes(fr))); };
const sq = casosSql(raw);
check('la sonda tiene 41 casos y el bloque exige 41', `${sq.length},${bloque(raw, 'SONDA').includes('IF v_n <> 41 THEN')}`, '41,true');
for (let i = 0; i < casos.length; i++) {
  const s = sq[i] || {};
  check(`${casos[i][0]}: modelo ${modelo[i][1]} = migración`, `${s.lbl}|${s.id}|${s.esperado}|${casos[i][3].every((fr) => ((s.sentencia || '') + ')').includes(fr))}`,
    `${casos[i][0]}|${casos[i][1]}|${modelo[i][1]}|true`);
}
check('regla del modelo sobre la migración real', reglaModelo(raw), true);
check('los casos R corren bajo authenticated y el resto como postgres',
  sq.filter((c) => c.rol === 'authenticated').map((c) => c.lbl.split(' ')[0]).join(','), 'R1,R2,R3,R4');
check('cobertura: los 5 códigos esperados aparecen en la matriz',
  ['P0183', 'P0024', 'P0025', 'P0026'].every((c) => sq.some((x) => x.esperado === `'ERROR:${c}'`)) && sq.some((x) => x.esperado === "'NULL|NULL'"), true);
const bSonda = sinComentarios(bloque(raw, 'SONDA'));
has('SONDA: captura la excepción y la compara como ERROR:SQLSTATE', bSonda, "v_obt := 'ERROR:' || SQLSTATE;");
has('SONDA: lee la fila de vuelta', bSonda, "INTO v_obt FROM public._s7_92_probe p WHERE p.id = (c->>2)::int;");
has('SONDA: falla visible', bSonda, "RAISE EXCEPTION 's7_92 SONDA FAIL:%', v_fallos;");
has('SONDA: nunca nivel 2 en la tabla resultante', bSonda, 'WHERE u.level NOT IN (1, 3)) THEN');
const reglaSondaEfimera = (s) => { const e = sinComentarios(s);
  return ocurrencias(e, 'CREATE TABLE public._s7_92_probe (') === 1 && ocurrencias(e, 'DROP TABLE public._s7_92_probe;') === 1
    && e.indexOf('DROP TABLE public._s7_92_probe;') < e.indexOf('\nCOMMIT;'); };
check('la sonda se crea y se borra dentro de la transacción', reglaSondaEfimera(raw), true);
has('filas históricas insertadas ANTES del trigger de la sonda', ex,
  "INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES\n  (1, 'CH', 'CH-16'), (2, 'CH', 'CH-16'), (3, 'CH', 'CH-16'),\n  (4, NULL, NULL),    (5, 'CH', 'CH-16'), (6, 'CH', 'CH-16');\n\nCREATE TRIGGER trg_s7_92_probe_sync");

// ═══════════════════════════════════════════════════════════
// 8 · ROLLBACK
// ═══════════════════════════════════════════════════════════
console.log('\n8 · rollback');
const exRb = sinComentarios(rawRb);
check('atómico: un BEGIN; y un COMMIT;', `${(exRb.match(/^BEGIN;/gm) || []).length},${(exRb.match(/^COMMIT;/gm) || []).length}`, '1,1');
const PASOS_RB = [
  'BEGIN;', "SET LOCAL lock_timeout = '5s';", 'LOCK TABLE public.clinics IN ACCESS EXCLUSIVE MODE;', 'DO $PREVIA$', 'END $PREVIA$;',
  'DROP TRIGGER trg_clinics_territory_sync ON public.clinics;', 'DROP FUNCTION public._clinics_territory_sync();',
  'DROP FUNCTION public._territory_from_legacy_sv(text, text);',
  'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;',
  'UPDATE public.clinics\n   SET country_id = NULL, territory_unit_id = NULL\n WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;',
  'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;',
  'ADD CONSTRAINT clinics_geo_f3a_temp_null_chk', 'COMMENT ON CONSTRAINT clinics_geo_f3a_temp_null_chk ON public.clinics IS',
  'DO $VERIFICA$', 'END $VERIFICA$;', 'COMMIT;',
];
const reglaOrdenRb = (s) => { const e = sinComentarios(s); const p = PASOS_RB.map((n) => (ocurrencias(e, n) === 1 ? e.indexOf(n) : -1));
  return p.every((x, i) => x >= 0 && (i === 0 || x > p[i - 1])); };
check('orden: BEGIN → lock_timeout → LOCK → PREVIA → DROP trigger/funciones → DISABLE updated_at → UPDATE → ENABLE → guarda + comentario → VERIFICA → COMMIT', reglaOrdenRb(rawRb), true);
const guardaDe = (s) => { const a = s.indexOf('  ADD CONSTRAINT clinics_geo_f3a_temp_null_chk'); return a === -1 ? '' : s.slice(a, s.indexOf(';', a) + 1); };
const comentarioDe = (s) => { const a = s.indexOf('COMMENT ON CONSTRAINT clinics_geo_f3a_temp_null_chk'); return a === -1 ? '' : s.slice(a, s.indexOf("';", a) + 2); };
const reglaRbGuardaIdentica = (s) => guardaDe(s) !== '' && guardaDe(s) === guardaDe(s89) && comentarioDe(s) !== '' && comentarioDe(s) === comentarioDe(s89);
check('la guarda y su COMMENT reinstalados son byte a byte los de s7_89', reglaRbGuardaIdentica(rawRb), true);
const textoComentario89 = comentarioDe(s89).split('\n').slice(1).map((l) => l.trim()).join('\n').replace(/;$/, '');
check('VERIFICA compara el comentario completo de s7_89', sinComentarios(bloque(rawRb, 'VERIFICA')).split('\n').map((l) => l.trim()).join('\n')
  .includes(`obj_description(con.oid, 'pg_constraint') =\n${textoComentario89}`), true);
const reglaRbUpdatedAt = (s) => { const e = sinComentarios(s); const u = e.indexOf('UPDATE public.clinics');
  return u > e.indexOf('DISABLE TRIGGER trg_clinics_updated_at;') && u < e.indexOf('ENABLE TRIGGER trg_clinics_updated_at;')
    && e.indexOf('DISABLE TRIGGER') > -1 && sinComentarios(bloque(s, 'VERIFICA')).includes("IS DISTINCT FROM 'trg_clinics_updated_at[O]' THEN"); };
check('updated_at intacto: trigger desactivado solo durante el UPDATE y verificado en modo O', reglaRbUpdatedAt(rawRb), true);
check('el UPDATE del rollback solo vacía las dos columnas nuevas', (sinLiterales(exRb).match(/UPDATE public\.clinics[\s\S]*?;/g) || []).length === 1
  && /SET country_id = NULL, territory_unit_id = NULL\n/.test(exRb), true);
const reglaRbE5 = (s) => { const p = sinComentarios(bloque(s, 'PREVIA'));
  return p.includes("p.prosrc ~ '\\m(country_id|territory_unit_id|administrative_units|country_levels)\\M'")
    && p.includes("d.classid = 'pg_rewrite'::regclass") && p.includes("a.attname IN ('country_id', 'territory_unit_id')"); };
check('E5: la PREVIA aborta si hay consumidores (funciones o vistas) del modelo nuevo', reglaRbE5(rawRb), true);
const vRb = sinComentarios(bloque(rawRb, 'VERIFICA'));
has('huella de todas las demás columnas (updated_at incluido)', sinComentarios(bloque(rawRb, 'PREVIA')),
  "string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\\n' ORDER BY c.id)");
has('VERIFICA: misma huella', vRb, "IF v_txt IS DISTINCT FROM current_setting('s7_92rb.filas') THEN");
has('VERIFICA: 0 clínicas con geo', vRb, 'WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;');
has('VERIFICA: privilegios y RLS intactos', vRb, "current_setting('s7_92rb.acl')");
has('VERIFICA: policies intactas', vRb, "current_setting('s7_92rb.policies')");
has('VERIFICA: otras funciones intactas', vRb, "current_setting('s7_92rb.otras_funciones')");
has('VERIFICA: objetos de s7_92 ausentes', vRb, "proname IN ('_territory_from_legacy_sv', '_clinics_territory_sync')");
check('rollback sin GRANT ni REVOKE', /\b(GRANT|REVOKE)\b/i.test(sinLiterales(exRb)), false);

// ═══════════════════════════════════════════════════════════
// 9 · MUTACIÓN CON EXPECTATIVA INVERTIDA
// ═══════════════════════════════════════════════════════════
const R = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutación sin ancla: ${a.slice(0, 60)}`); return s.split(a).join(b); };
const reglas = {
  orden: reglaOrden, lockAlFinal: reglaLockAlFinal, guarda: reglaGuarda, invoker: reglaInvoker, calificadas: reglaCalificadas,
  svPorIso: reglaSvPorIso, sinNivel2: reglaSinNivel2, unicoDefiner: reglaUnicoDefiner, sinDinamico: reglaSinDinamico, e1: reglaE1,
  contradiccion: reglaContradiccion, asignaSiempre: reglaAsignaSiempre, revokes: reglaRevokes, sinGrantCliente: reglaSinGrantCliente,
  triggerNormal: reglaTriggerNormal, sinBackfill: reglaSinBackfill, modelo: reglaModelo, sondaEfimera: reglaSondaEfimera,
  postTgenabled: (s) => reglaPost.tgenabled(sinComentarios(bloque(s, 'POST'))),
  postExecute: (s) => reglaPost.execute(sinComentarios(bloque(s, 'POST'))),
  sinDolar: sinDolarEnComentarios,
};
const reglasRb = { ordenRb: reglaOrdenRb, rbGuardaIdentica: reglaRbGuardaIdentica, rbUpdatedAt: reglaRbUpdatedAt, rbE5: reglaRbE5, sinDolar: sinDolarEnComentarios };
const mutaciones = [
  ['trigger ENABLE ALWAYS', 'triggerNormal', (s) => R(s, "  'rechaza con P0183 cualquier country_id / territory_unit_id contradictorio. Trigger normal.';\n",
    "  'rechaza con P0183 cualquier country_id / territory_unit_id contradictorio. Trigger normal.';\nALTER TABLE public.clinics ENABLE ALWAYS TRIGGER trg_clinics_territory_sync;\n")],
  ['resolver SECURITY DEFINER', 'invoker', (s) => R(s, 'STABLE\nSECURITY INVOKER\n', 'STABLE\nSECURITY DEFINER\n')],
  ['resolver SECURITY DEFINER (regla de unicidad)', 'unicoDefiner', (s) => R(s, 'STABLE\nSECURITY INVOKER\n', 'STABLE\nSECURITY DEFINER\n')],
  ['trigger sin SECURITY DEFINER', 'unicoDefiner', (s) => R(s, 'RETURNS trigger\nLANGUAGE plpgsql\nSECURITY DEFINER\n', 'RETURNS trigger\nLANGUAGE plpgsql\nSECURITY INVOKER\n')],
  ['olvidar el REVOKE de authenticated', 'revokes', (s) => R(s, 'REVOKE ALL ON FUNCTION public._clinics_territory_sync() FROM authenticated;\n', '')],
  ['GRANT EXECUTE a authenticated', 'sinGrantCliente', (s) => R(s, '\nCOMMIT;\n', '\nGRANT EXECUTE ON FUNCTION public._clinics_territory_sync() TO authenticated;\nCOMMIT;\n')],
  ['retirar la guarda antes de instalar el trigger', 'guarda', (s) => { const d = 'ALTER TABLE public.clinics DROP CONSTRAINT clinics_geo_f3a_temp_null_chk;\n';
    return R(R(s, d, ''), 'CREATE TRIGGER trg_clinics_territory_sync\n', d + '\nCREATE TRIGGER trg_clinics_territory_sync\n'); }],
  ['retirar la guarda después del COMMIT', 'guarda', (s) => { const d = 'ALTER TABLE public.clinics DROP CONSTRAINT clinics_geo_f3a_temp_null_chk;\n';
    return R(R(s, d, ''), '\nCOMMIT;\n', '\nCOMMIT;\n' + d); }],
  ['tomar el lock antes de la sonda', 'lockAlFinal', (s) => { const l = 'LOCK TABLE public.clinics IN ACCESS EXCLUSIVE MODE;\n';
    return R(R(s, l, ''), 'CREATE TABLE public._s7_92_probe (', l + 'CREATE TABLE public._s7_92_probe ('); }],
  ['sin lock_timeout', 'orden', (s) => R(s, "SET LOCAL lock_timeout = '5s';\n", '')],
  ['tabla sin calificar en el resolver', 'calificadas', (s) => R(s, 'PERFORM 1 FROM public.departments d WHERE d.id = p_department_id;', 'PERFORM 1 FROM departments d WHERE d.id = p_department_id;')],
  ['tabla sin calificar en el trigger', 'calificadas', (s) => R(s, '    FROM public._territory_from_legacy_sv(NEW.department_id', '    FROM _territory_from_legacy_sv(NEW.department_id')],
  ['SV por id numérico', 'svPorIso', (s) => R(s, "SELECT c.id INTO v_sv FROM public.countries c WHERE c.iso_alpha2 = 'SV';", 'SELECT c.id INTO v_sv FROM public.countries c WHERE c.id = 1;')],
  ['derivar nivel 2', 'sinNivel2', (s) => R(s, 'u.legacy_id = p_department_id AND u.level = 1;', 'u.legacy_id = p_department_id AND u.level IN (1, 2);')],
  ['SQL dinámico en el trigger', 'sinDinamico', (s) => R(s, '  -- El valor del cliente nunca es autoridad', "  EXECUTE 'SELECT 1';\n  -- El valor del cliente nunca es autoridad")],
  ['E1 violado: en UPDATE todo valor no NULL cuenta como intento', 'e1', (s) => R(s, '    v_fija_pais   := NEW.country_id IS DISTINCT FROM OLD.country_id;', '    v_fija_pais   := NEW.country_id IS NOT NULL;')],
  ['aceptar la contradicción', 'contradiccion', (s) => R(s, "      USING ERRCODE = 'P0183';", "      USING ERRCODE = 'P0001';")],
  ['E2 violado: respetar el valor del cliente si viene', 'asignaSiempre', (s) => R(s, '  NEW.country_id        := r.country_id;\n  NEW.territory_unit_id := r.territory_unit_id;\n',
    '  IF NEW.country_id IS NULL THEN\n    NEW.country_id        := r.country_id;\n    NEW.territory_unit_id := r.territory_unit_id;\n  END IF;\n')],
  ['backfill de clinics', 'sinBackfill', (s) => R(s, 'ALTER TABLE public.clinics DROP CONSTRAINT clinics_geo_f3a_temp_null_chk;\n',
    'ALTER TABLE public.clinics DROP CONSTRAINT clinics_geo_f3a_temp_null_chk;\nUPDATE public.clinics SET department_id = department_id;\n')],
  ['expectativa de la sonda contraria al modelo (U7 rechazado)', 'modelo', (s) => R(s, "v_d2, v_m2, v_sv, v_u_ch16), e_m2),", "v_d2, v_m2, v_sv, v_u_ch16), 'ERROR:P0183'),")],
  ['caso de la sonda con otra sentencia (U2 sobre fila derivada)', 'modelo', (s) => R(s, "territory_unit_id = %s WHERE id = 1', v_sv, v_u_ch16)", "territory_unit_id = %s WHERE id = 201', v_sv, v_u_ch16)")],
  ['caso de la sonda omitido', 'modelo', (s) => R(s, "    jsonb_build_array('U12 columna ajena', 'postgres', 210, 'UPDATE public._s7_92_probe SET nota = ''x'' WHERE id = 210', e_ch16),\n", '')],
  ['la sonda sobrevive al COMMIT', 'sondaEfimera', (s) => R(s, 'DROP TABLE public._s7_92_probe;\n', '')],
  ['POST sin comprobar tgenabled', 'postTgenabled', (s) => R(s, "IF r.habilitado <> 'O' THEN", 'IF false THEN')],
  ['POST sin comprobar EXECUTE de service_role', 'postExecute', (s) => R(s, "has_function_privilege('service_role', r.oid, 'EXECUTE')", 'false')],
  ['una etiqueta $…$ en un comentario', 'sinDolar', (s) => R(s, '-- Si el PASO 1 lanza excepcion, NO continuar.', '-- Pegar desde DO $PRE$. Si el PASO 1 lanza excepcion, NO continuar.')],
];
const mutacionesRb = [
  ['rollback: comentario de la guarda distinto del de s7_89', 'rbGuardaIdentica', (s) => R(s, "  'controlado y su proteccion. No retirarla sola.';", "  'controlado y su proteccion.';")],
  ['rollback: guarda con otra definición', 'rbGuardaIdentica', (s) => R(s, '  CHECK (country_id IS NULL AND territory_unit_id IS NULL);', '  CHECK (territory_unit_id IS NULL);')],
  ['rollback: UPDATE sin desactivar updated_at', 'rbUpdatedAt', (s) => R(s, 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;\n', '')],
  ['rollback: sin comprobar consumidores (E5)', 'rbE5', (s) => R(s, "d.classid = 'pg_rewrite'::regclass", "d.classid = 0")],
  ['rollback: UPDATE antes de quitar el trigger', 'ordenRb', (s) => { const d = 'DROP TRIGGER trg_clinics_territory_sync ON public.clinics;\n';
    return R(R(s, d, ''), 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;\n', 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;\n' + d); }],
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
