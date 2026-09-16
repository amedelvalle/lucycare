#!/usr/bin/env node
/**
 * check-s7_96.mjs — F3E-1: dos RPC de lectura del catálogo territorial.
 *
 * s7_96 crea SOLO public.directory_countries() y public.directory_territory_units(text, bigint),
 * SECURITY DEFINER, STABLE, search_path fijo, EXECUTE solo para anon y authenticated. Sin tocar la
 * base hay que demostrar:
 *   · el contrato exacto (firmas, columnas, filtros, vacío en vez de excepción, ISO exacto);
 *   · los cuerpos solo leen countries, country_levels y administrative_units, calificados, sin SQL
 *     dinámico, sin auth.uid(), sin datos de tenant ni columnas internas (legacy_id, official_*,
 *     booking_enabled, cierre, has_children);
 *   · el PASO 2 solo contiene BEGIN RR, lock_timeout, GUARDA, instantánea, las 2 funciones, dueño,
 *     REVOKE a PUBLIC/anon/authenticated/service_role, GRANT a anon/authenticated, comentarios,
 *     POST y COMMIT: ni tablas, ni policies, ni RLS, ni roles, ni grants de tabla, ni escrituras;
 *   · PRE y GUARDA idénticas; constantes del preflight F3E-1A iguales en todos los artefactos;
 *   · md5 de los cuerpos incrustados = cuerpos reales (LF y CRLF);
 *   · el POST cubre forma, ACL exacta, catálogo cerrado, instantánea (+2 funciones), consumidores
 *     y comportamiento bajo anon/authenticated/service_role;
 *   · rollback propio: forma+md5+ACL+dependientes, DROP ensamblado, VERIFICA con instantánea (-2);
 *   · bloques read-only sin escrituras; reglas del SQL Editor; artefactos históricos intactos;
 *   · mutaciones con expectativa INVERTIDA: cada regla detecta su violación.
 *
 *   node scripts/check-s7_96.mjs
 *
 * No toca la base de datos ni la red.
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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

console.log('\ncheck-s7_96 — F3E-1 · RPC de lectura del catálogo territorial\n');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const P = {
  mig: path.join('migrations', 's7_96_geo_foundation_3e1_directory_read_rpcs.sql'),
  rb: path.join('docs', 'rollbacks', 's7_96_rollback.sql'),
  st: path.join('docs', 'smokes', 's7_96_state_readonly.sql'),
  po: path.join('docs', 'smokes', 's7_96_post_verification_readonly.sql'),
  rbk: path.join('docs', 'OWNER_S7_96_APPLY.md'),
};
const T0 = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, leerLF(p)]));

const sinComentarios = (sql) => sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
const entre = (s, a, b) => { const i = s.indexOf(a); if (i === -1) return ''; const j = s.indexOf(b, i + a.length); return j === -1 ? '' : s.slice(i, j + b.length); };
const bloque = (s, tag) => entre(s, `DO $${tag}$`, `$${tag}$;`);
const cuerpos = (s) => [...s.matchAll(/AS \$fn\$([\s\S]*?)\$fn\$;/g)].map((x) => x[1]);
const md5 = (t) => crypto.createHash('md5').update(t, 'utf8').digest('hex');
const instantaneas = (s) => [...s.matchAll(/    -- instantanea:ini\n([\s\S]*?)    -- instantanea:fin/g)].map((x) => x[1]);

// ── Constantes del preflight F3E-1A de producción (2026-09-16), aprobadas por el owner ──
const C = {
  v_c2: '7cef00d1d24a004edbc4678fe6d41948',
  v_estados: '119|59|24|36|0',
  v_lista: '36|783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8',
  v_publicados: '46|46|0',
  v_visibles: '43|43|0',
  v_paises: 'SV',
  v_niveles: 'SV:1,2,3',
  v_unidades: '14|44|262|0',
  v_clinics: '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}|true|false',
  v_policies: '20ad37b9',
  v_geo: 'administrative_unit_closure={postgres=arwdDxtm/postgres}|true|false|postgres|0;administrative_units={postgres=arwdDxtm/postgres}|true|false|postgres|0;countries={postgres=arwdDxtm/postgres}|true|false|postgres|0;country_levels={postgres=arwdDxtm/postgres}|true|false|postgres|0',
};
const ACL = 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres';
const FIRMA_C = 'CREATE FUNCTION public.directory_countries()\nRETURNS TABLE (country_id smallint, iso_alpha2 text, country_name text, level smallint, level_label text)\nLANGUAGE sql\nSTABLE\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$';
const FIRMA_U = 'CREATE FUNCTION public.directory_territory_units(p_country_iso text, p_parent_id bigint DEFAULT NULL)\nRETURNS TABLE (id bigint, name text, level smallint, parent_id bigint)\nLANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$';

// ═══════════════════════════════════════════════════════════
// REGLAS — cada una recibe el conjunto de textos y devuelve true si se cumple.
// ═══════════════════════════════════════════════════════════
const R = {};

// 0 · SQL Editor
R.sinEtiquetasEnComentarios = (T) => ['mig', 'rb', 'st', 'po'].every((k) => !T[k].split('\n').some((l) => { const i = l.indexOf('--'); return i !== -1 && /\$[A-Za-z0-9_]*\$/.test(l.slice(i)); }));
R.rollbackSinDDLNombrado = (T) => !/DROP\s+FUNCTION\s+(public\.)?directory_/i.test(T.rb) && ocur(T.rb, "format('DROP FUNCTION %I.%I(%s)'") === 2;
R.sinCreateTableNiTemporales = (T) => ['mig', 'rb', 'st', 'po'].every((k) => !/CREATE\s+(TEMP|TEMPORARY|UNLOGGED\s+)?\s*TABLE/i.test(T[k]));

// 1 · PRE / GUARDA
const normal = (b, tag) => b.split(`$${tag}$`).join('$X$').replace(/v_etapa\s+CONSTANT text := '[A-Z]+';/, "v_etapa CONSTANT text := 'X';");
R.preIgualGuarda = (T) => { const a = bloque(T.mig, 'PRE'), b = bloque(T.mig, 'GUARDA'); return a !== '' && normal(a, 'PRE') === normal(b, 'GUARDA'); };
const constantesDe = (b) => Object.fromEntries(Object.keys(C).map((k) => { const m = b.match(new RegExp(`${k}\\s+CONSTANT text := '([^']*)'`)); return [k, m ? m[1] : null]; }));
R.constantesPre = (T) => JSON.stringify(constantesDe(bloque(T.mig, 'PRE'))) === JSON.stringify(C);
R.preSoloLectura = (T) => { const b = sinLiterales(sinComentarios(bloque(T.mig, 'PRE'))); return !/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT)\b/i.test(b.replace(/FILTER \(WHERE/g, '')) && !/set_config/i.test(b); };
R.preExigePostgresYCreate = (T) => { const b = bloque(T.mig, 'PRE'); return b.includes("IF current_user <> 'postgres' THEN") && b.includes("has_schema_privilege(current_user, 'public', 'CREATE')"); };
R.preNoReaplica = (T) => bloque(T.mig, 'PRE').includes("SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');");
R.preCatalogoCerrado = (T) => { const b = bloque(T.mig, 'PRE'); return b.includes('IS DISTINCT FROM v_geo') && b.includes("unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol)"); };
R.preSinConsumidores = (T) => bloque(T.mig, 'PRE').includes("p.prosrc ~ '\\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\\M'");
R.preDatos = (T) => { const b = bloque(T.mig, 'PRE'); return ['IS DISTINCT FROM v_c2', 'IS DISTINCT FROM v_estados', 'IS DISTINCT FROM v_lista', "IS DISTINCT FROM v_publicados || '#' || v_visibles", 'IS DISTINCT FROM v_unidades', 'IS DISTINCT FROM v_niveles', 'IS DISTINCT FROM v_paises', 'IS DISTINCT FROM v_clinics', 'IS DISTINCT FROM v_policies'].every((x) => b.includes(x)); };
R.svPorIso = (T) => !/country_id\s*=\s*1\b/.test(sinComentarios(T.mig)) && !/\bv_sv\s*:=\s*\d/.test(T.mig);

// 2 · orden y alcance del PASO 2
const paso2 = (s) => entre(s, 'BEGIN ISOLATION LEVEL REPEATABLE READ;', '\nCOMMIT;');
const fuera = (s) => { let t = paso2(s); for (const tag of ['GUARDA', 'SNAP', 'POST']) t = t.split(bloque(t, tag)).join(`<${tag}>;`); for (const c of cuerpos(s)) t = t.split(c).join('<CUERPO>'); return sinComentarios(t); };
R.ordenPaso2 = (T) => {
  const t = paso2(T.mig);
  const hitos = ['BEGIN ISOLATION LEVEL REPEATABLE READ;', "SET LOCAL lock_timeout = '5s';", 'DO $GUARDA$', 'DO $SNAP$', FIRMA_C, FIRMA_U,
    'ALTER FUNCTION public.directory_countries() OWNER TO postgres;', 'ALTER FUNCTION public.directory_territory_units(text, bigint) OWNER TO postgres;',
    'REVOKE ALL ON FUNCTION public.directory_countries() FROM PUBLIC, anon, authenticated, service_role;',
    'REVOKE ALL ON FUNCTION public.directory_territory_units(text, bigint) FROM PUBLIC, anon, authenticated, service_role;',
    'GRANT EXECUTE ON FUNCTION public.directory_countries() TO anon, authenticated;',
    'GRANT EXECUTE ON FUNCTION public.directory_territory_units(text, bigint) TO anon, authenticated;',
    'COMMENT ON FUNCTION public.directory_countries() IS', 'COMMENT ON FUNCTION public.directory_territory_units(text, bigint) IS', 'DO $POST$'];
  let pos = -1;
  for (const h of hitos) { const i = t.indexOf(h); if (i <= pos || ocur(t, h) !== 1) return false; pos = i; }
  return ocur(T.mig, '\nCOMMIT;') === 1 && T.mig.trimEnd().endsWith('COMMIT;') && ocur(T.mig, 'BEGIN ISOLATION LEVEL') === 1 && !/^BEGIN\s*;/m.test(T.mig);
};
R.soloSentenciasPermitidas = (T) => {
  const sentencias = sinLiterales(fuera(T.mig)).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const permitidas = [/^BEGIN ISOLATION LEVEL REPEATABLE READ$/, /^SET LOCAL lock_timeout = ''$/, /^<(GUARDA|SNAP|POST)>$/, /^COMMIT$/,
    /^CREATE FUNCTION public\.directory_(countries|territory_units)\(.*\$fn\$<CUERPO>\$fn\$$/,
    /^ALTER FUNCTION public\.directory_(countries\(\)|territory_units\(text, bigint\)) OWNER TO postgres$/,
    /^REVOKE ALL ON FUNCTION public\.directory_(countries\(\)|territory_units\(text, bigint\)) FROM PUBLIC, anon, authenticated, service_role$/,
    /^GRANT EXECUTE ON FUNCTION public\.directory_(countries\(\)|territory_units\(text, bigint\)) TO anon, authenticated$/,
    /^COMMENT ON FUNCTION public\.directory_(countries\(\)|territory_units\(text, bigint\)) IS ''( '')*$/];
  return sentencias.length === 16 && sentencias.every((x) => permitidas.some((re) => re.test(x)));
};
R.sinTocarTablasNiSeguridad = (T) => {
  const t = sinLiterales(sinComentarios(T.mig));
  return !/\b(CREATE|ALTER|DROP)\s+(TABLE|POLICY|VIEW|ROLE|USER|TRIGGER|SCHEMA|INDEX|MATERIALIZED)\b/i.test(t)
    && !/ALTER\s+DEFAULT\s+PRIVILEGES/i.test(t) && !/ROW\s+LEVEL\s+SECURITY/i.test(t)
    && !/\bGRANT\b(?![^;]*ON FUNCTION)/i.test(t) && !/\bREVOKE\b(?![^;]*ON FUNCTION)/i.test(t)
    && !/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE)\b/i.test(t) && !/auth\.users/i.test(t);
};
R.grantSoloAnonAuthenticated = (T) => [...T.mig.matchAll(/^GRANT[^;]*;/gm)].every((m) => / TO anon, authenticated;$/.test(m[0])) && ocur(T.mig, '\nGRANT ') === 2;
R.revokeCuatroRoles = (T) => [...T.mig.matchAll(/^REVOKE[^;]*;/gm)].length === 2 && [...T.mig.matchAll(/^REVOKE[^;]*;/gm)].every((m) => m[0].endsWith(' FROM PUBLIC, anon, authenticated, service_role;'));

// 3 · contrato de las funciones
R.firmas = (T) => ocur(T.mig, FIRMA_C) === 1 && ocur(T.mig, FIRMA_U) === 1;
R.dosCuerpos = (T) => cuerpos(T.mig).length === 2;
const cuerpoC = (T) => cuerpos(T.mig)[0] || '', cuerpoU = (T) => cuerpos(T.mig)[1] || '';
R.cuerposSinDinamicoNiAuth = (T) => [cuerpoC(T), cuerpoU(T)].every((b) => !/\bEXECUTE\b|format\s*\(|auth\.|current_setting|set_config|current_user|session_user|\bRAISE\b|\bPERFORM\b/i.test(b));
R.cuerposSoloCatalogo = (T) => [cuerpoC(T), cuerpoU(T)].every((b) => {
  const refs = [...sinComentarios(b).matchAll(/\b(FROM|JOIN)\s+([a-z_.]+)/gi)].map((m) => m[2]);
  return refs.length > 0 && refs.every((r) => ['public.countries', 'public.country_levels', 'public.administrative_units'].includes(r));
});
R.cuerposSinColumnasInternas = (T) => [cuerpoC(T), cuerpoU(T)].every((b) => !/legacy_id|official_|booking_enabled|closure|has_children|clinic|doctor|profile|patient|member|audit/i.test(b));
R.countriesContrato = (T) => { const b = cuerpoC(T).replace(/\s+/g, ' ').trim(); return b === 'SELECT c.id, c.iso_alpha2, c.name, l.level, l.label_singular FROM public.countries c LEFT JOIN public.country_levels l ON l.country_id = c.id WHERE c.directory_enabled ORDER BY c.iso_alpha2, l.level;'; };
R.unitsIsoExactoYHabilitado = (T) => { const b = cuerpoU(T); return b.includes('WHERE c.iso_alpha2 = p_country_iso\n     AND c.directory_enabled;') && !/upper|lower|btrim|ilike/i.test(b); };
R.unitsVacioSinExcepcion = (T) => { const b = cuerpoU(T); return b.includes('  IF v_country IS NULL THEN\n    RETURN;\n  END IF;') && !/RAISE/i.test(b); };
R.unitsRaiz = (T) => cuerpoU(T).includes('       WHERE u.country_id = v_country\n         AND u.level = 1\n         AND u.parent_id IS NULL\n         AND u.is_active\n       ORDER BY u.name, u.id;');
R.unitsHijosDelPaisYActivos = (T) => { const b = cuerpoU(T); return b.includes('     WHERE u.parent_id = p_parent_id\n       AND u.country_id = v_country\n       AND u.is_active\n')
  && b.includes('                    WHERE pa.id = p_parent_id\n                      AND pa.country_id = v_country\n                      AND pa.is_active)'); };
R.unitsColumnasDevueltas = (T) => ocur(cuerpoU(T), 'SELECT u.id, u.name, u.level, u.parent_id\n') === 2;
R.unitsVariableConflict = (T) => cuerpoU(T).startsWith('\n#variable_conflict use_column\n');

// 4 · md5 incrustados
const md5s = (T) => { const [c, u] = [cuerpoC(T), cuerpoU(T)]; return [md5(c), md5(c.split('\n').join('\r\n')), md5(u), md5(u.split('\n').join('\r\n'))]; };
R.md5Incrustados = (T) => {
  const [cl, cc, ul, uc] = md5s(T);
  const arr = (a, b) => `ARRAY['${a}', '${b}']`;
  return ocur(T.mig, arr(cl, cc)) === 1 && ocur(T.mig, arr(ul, uc)) === 1 && ocur(T.rb, arr(cl, cc)) === 1 && ocur(T.rb, arr(ul, uc)) === 1
    && ocur(T.st, `IN ('${cl}', '${cc}')`) === 1 && ocur(T.st, `IN ('${ul}', '${uc}')`) === 1
    && ocur(T.po, `IN ('${cl}', '${cc}')`) === 1 && ocur(T.po, `IN ('${ul}', '${uc}')`) === 1
    && !/__MD5_/.test(T.mig + T.rb + T.st + T.po);
};

// 5 · POST
R.postForma = (T) => { const b = bloque(T.mig, 'POST'); return b.includes("vol=s def=true lang=sql cfg={\"search_path=public, pg_temp\"} owner=postgres args=") && b.includes('vol=s def=true lang=plpgsql cfg={"search_path=public, pg_temp"} owner=postgres args=p_country_iso text, p_parent_id bigint DEFAULT NULL::bigint'); };
R.postAclExacta = (T) => { const b = bloque(T.mig, 'POST'); return b.includes(`v_acl        CONSTANT text := '${ACL}';`) && b.includes("has_function_privilege('service_role', k, 'EXECUTE')"); };
R.postCatalogoCerrado = (T) => bloque(T.mig, 'POST').includes("-- 6.3 Catalogo GEO sigue cerrado al cliente.\n  IF (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))\n        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),\n             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),");
R.postInstantaneaIdentica = (T) => { const a = instantaneas(T.mig); return a.length === 2 && a[0] === a[1] && bloque(T.mig, 'SNAP').includes(a[0]) && bloque(T.mig, 'POST').includes(a[0]); };
R.postInstantaneaCompleta = (T) => ['policies', 'relaciones', 'columnas', 'funciones', 'triggers', 'default_acl', 'roles', 'membresias', 'esquemas', 'catalogo_geo', 'clinics_c2', 'n_funciones_public'].every((k) => (instantaneas(T.mig)[0] || '').includes(`'${k}',`));
R.postMasDos = (T) => bloque(T.mig, 'POST').includes("(v_ahora ->> k)::bigint <> (v_antes ->> k)::bigint + 2");
R.postConsumidores = (T) => { const b = bloque(T.mig, 'POST'); return b.includes("IS DISTINCT FROM 'directory_countries,directory_territory_units'") && b.includes("consumidores del cierre (s7_94)"); };
R.postComportamiento = (T) => { const b = bloque(T.mig, 'POST'); return b.includes("FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated']") && ocur(b, "EXECUTE 'SET LOCAL ROLE service_role';") === 2
  && ["directory_territory_units('XX')", 'directory_territory_units(NULL)', "directory_territory_units('')", "directory_territory_units('sv')", "directory_territory_units('XX', v_par)", "directory_territory_units('SV', -1)", "directory_territory_units('SV', v_hoja)"].every((x) => b.includes(x))
  && b.includes('EXCEPTION WHEN insufficient_privilege THEN') && b.includes("RAISE EXCEPTION 's7_96 POST fallo:%', v_fallos;"); };
R.postPaisesDescubribles = (T) => { const b = bloque(T.mig, 'POST'); return b.includes("INTO v_esp FROM public.countries c LEFT JOIN public.country_levels l ON l.country_id = c.id WHERE c.directory_enabled;")
  && b.includes("coalesce(f.level::text, 'NULL') || '|' || coalesce(f.level_label, 'NULL')")
  && b.includes("SELECT coalesce(string_agg(iso_alpha2, ',' ORDER BY iso_alpha2), '') INTO v_esp FROM public.countries WHERE directory_enabled;")
  && b.includes("SELECT coalesce(string_agg(DISTINCT f.iso_alpha2, ',' ORDER BY f.iso_alpha2), '') INTO v_txt FROM public.directory_countries() f;")
  && b.includes("IF v_txt IS DISTINCT FROM v_esp THEN v_fallos := v_fallos || ' | ' || v_rol || ' paises descubribles: '"); };
R.smokePaisesDescubribles = (T) => T.po.includes("INTO v_esp FROM public.countries c LEFT JOIN public.country_levels l ON l.country_id = c.id WHERE c.directory_enabled;")
  && T.po.includes("paises descubribles = todos los habilitados (tambien sin niveles)") && T.po.includes("coalesce(f.level::text, 'NULL') || '|' || coalesce(f.level_label, 'NULL')");
R.postConstantes = (T) => { const b = bloque(T.mig, 'POST'); return b.includes(`v_c2         CONSTANT text := '${C.v_c2}';`) && b.includes(`v_publicados CONSTANT text := '${C.v_publicados}';`) && b.includes(`v_visibles   CONSTANT text := '${C.v_visibles}';`); };

// 6 · rollback
R.rbOrdenYAviso = (T) => T.rb.includes('revertir frontend F3E-2 -> rollback de s7_96 -> s7_95 -> s7_94 -> s7_93 R2') && /no es detectable desde la base/i.test(T.rb) && T.rb.includes('NO EJECUTAR SIN ORDEN EXPLICITA DEL OWNER');
R.rbTransaccion = (T) => { const t = T.rb; const i = [t.indexOf('BEGIN ISOLATION LEVEL REPEATABLE READ;'), t.indexOf("SET LOCAL lock_timeout = '5s';"), t.indexOf('DO $PREVIA$'), t.indexOf('DO $RETIRO$'), t.indexOf('DO $VERIFICA$'), t.lastIndexOf('\nCOMMIT;')]; return i.every((x, k) => x > (k ? i[k - 1] : -1)) && ocur(t, '\nCOMMIT;') === 1; };
R.rbPreviaValida = (T) => { const b = bloque(T.rb, 'PREVIA'); return b.includes('IF v_n <> 2 THEN') && b.includes(`v_acl           CONSTANT text := '${ACL}';`) && b.includes("d.refclassid = 'pg_proc'::regclass") && b.includes("p.prosrc ~ '\\m(directory_countries|directory_territory_units)\\M'") && b.includes('FROM pg_policies'); };
R.rbVerificaMenosDos = (T) => { const b = bloque(T.rb, 'VERIFICA'); return b.includes('(v_antes ->> k)::bigint - 2') && b.includes("administrative_unit_closure)\\M')") && b.includes('has_table_privilege(r.rol, t.tbl, x.priv)'); };
R.rbInstantaneaIgualMigracion = (T) => { const a = instantaneas(T.rb); return a.length === 2 && a[0] === a[1] && a[0] === instantaneas(T.mig)[0]; };
R.rbSinEscrituras = (T) => !/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE|GRANT|REVOKE|ALTER|CREATE)\b/i.test(sinLiterales(sinComentarios(T.rb)));

// 7 · bloques read-only
R.estadoUnaSentencia = (T) => { const t = sinComentarios(T.st).trim(); return t.startsWith('WITH') && t.endsWith('ORDER BY orden;') && ocur(sinLiterales(t), ';') === 1; };
R.estadoClasifica = (T) => ['S7_96 NO APLICADA', 'S7_96 APLICADA COMPLETA', 'MIXTO', 'ANOMALIA'].every((x) => T.st.includes(x));
R.postSmokeReadOnly = (T) => { const t = sinComentarios(T.po).trim(); return t.startsWith('BEGIN READ ONLY;') && t.endsWith('ROLLBACK;') && !/\bCOMMIT\b/.test(t)
  && !/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE|GRANT|REVOKE|ALTER|CREATE|DROP)\b/i.test(sinLiterales(t)); };
R.readOnlySinAuthUsers = (T) => ![T.st, T.po].some((x) => /auth\.users/.test(sinComentarios(x)));

// 8 · runbook
R.runbook = (T) => ['PASO 1', 'PASO 2', 'docs/smokes/s7_96_state_readonly.sql', 'docs/smokes/s7_96_post_verification_readonly.sql',
  'frontend F3E-2 → s7_96 → s7_95 → s7_94 → s7_93 R2 → verificar → s7_92', 'NOT APPLIED', 'service_role'].every((x) => T.rbk.includes(x));

function ocur(s, needle) { return s.split(needle).length - 1; }

// ═══════════════════════════════════════════════════════════
console.log('0 · archivos, posición y artefactos históricos');
const migs = fs.readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
check('s7_96 es la migración 117 en orden', migs.indexOf(path.basename(P.mig)) + 1, 117);
check('hay 117 migraciones', migs.length, 117);
let rastreados = '';
try { rastreados = execSync(`git ls-files -- ${[P.mig, P.rb, P.st, P.po, P.rbk, 'scripts/check-s7_96.mjs'].join(' ')}`, { encoding: 'utf8' }); } catch { rastreados = ''; }
check('los 6 artefactos están rastreados por git (los .sql de docs requieren git add -f)', rastreados.trim().split('\n').filter(Boolean).length, 6);
let difHist = 'error';
try {
  difHist = execSync('git diff --name-only origin/main -- migrations/s7_87* migrations/s7_88* migrations/s7_89* migrations/s7_9[0-5]* docs/rollbacks/s7_9[0-5]_rollback.sql docs/smokes/s7_9[1-5]_*', { encoding: 'utf8' }).trim();
} catch { difHist = 'error'; }
check('migraciones, rollbacks y smokes históricos intactos respecto de origin/main', difHist, '');

const nombres = Object.keys(R);
const ejecutar = (T) => Object.fromEntries(nombres.map((n) => { try { return [n, R[n](T) === true]; } catch { return [n, false]; } }));
const base = ejecutar(T0);
console.log('\n1 · reglas sobre los artefactos');
for (const n of nombres) check(n, base[n], true);

console.log('\n2 · valores');
check('md5 LF/CRLF de directory_countries', md5s(T0).slice(0, 2).join('|'), 'd3fa8ee9a257868fc75480860ed7c4a6|54aeee13db6d9cc1ddf02f121839d674');
check('md5 LF/CRLF de directory_territory_units', md5s(T0).slice(2).join('|'), '3083c7c5ad5a790c044e89bd7d554afc|243b51249cb406b28b90fe5087387229');
for (const [k, v] of Object.entries({ v_c2: C.v_c2, v_estados: C.v_estados, v_lista: C.v_lista })) check(`constante ${k} = preflight`, constantesDe(bloque(T0.mig, 'GUARDA'))[k], v);
check('smoke POST: C2 y directorio de referencia', T0.po.includes(`'e', '${C.v_c2}'`) && T0.po.includes("'e', '46|46|0#43|43|0'") && T0.po.includes("'e', '119|59|24|36|0'"), true);

// ═══════════════════════════════════════════════════════════
console.log('\n3 · mutaciones con expectativa INVERTIDA (cada una debe romper su regla)');
const M = [
  ['comentario con etiqueta $x$', 'mig', '-- Migracion 117.', '-- Migracion 117 $PRE$.', 'sinEtiquetasEnComentarios'],
  ['rollback con DROP FUNCTION literal', 'rb', "EXECUTE format('DROP FUNCTION %I.%I(%s)', 'public', 'directory_countries', '');", 'DROP FUNCTION public.directory_countries();', 'rollbackSinDDLNombrado'],
  ['CREATE TABLE en un literal', 'st', "'orden de reversion'", "'CREATE TABLE public.zz (id int)'", 'sinCreateTableNiTemporales'],
  ['GUARDA distinta del PRE', 'mig', "IF v_n <> 0 THEN\n    RAISE EXCEPTION 's7_96 %: ya existen", "IF v_n <> 9 THEN\n    RAISE EXCEPTION 's7_96 %: ya existen", 'preIgualGuarda'],
  ['constante C2 cambiada en el PRE', 'mig', "v_c2         CONSTANT text := '7cef00d1d24a004edbc4678fe6d41948';", "v_c2         CONSTANT text := '00000000000000000000000000000000';", 'constantesPre'],
  ['PRE escribe', 'mig', "  RAISE NOTICE 's7_96 % OK", "  UPDATE public.clinics SET name = name;\n  RAISE NOTICE 's7_96 % OK", 'preSoloLectura'],
  ['PRE sin comprobar CREATE', 'mig', "has_schema_privilege(current_user, 'public', 'CREATE')", "true", 'preExigePostgresYCreate'],
  ['PRE sin no-reaplicar', 'mig', "SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');", 'v_n := 0;', 'preNoReaplica'],
  ['PRE sin catálogo cerrado', 'mig', 'IS DISTINCT FROM v_geo', 'IS DISTINCT FROM v_txt', 'preCatalogoCerrado'],
  ['PRE sin consumidores', 'mig', "p.prosrc ~ '\\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\\M'", "false", 'preSinConsumidores'],
  ['PRE sin directorio', 'mig', "IS DISTINCT FROM v_publicados || '#' || v_visibles", 'IS NULL', 'preDatos'],
  ['SV por id numérico', 'mig', "SELECT id INTO STRICT v_sv FROM public.countries WHERE iso_alpha2 = 'SV';", 'v_sv := 1;', 'svPorIso'],
  ['GRANT antes del REVOKE', 'mig', 'REVOKE ALL ON FUNCTION public.directory_countries() FROM PUBLIC, anon, authenticated, service_role;\n', '', 'ordenPaso2'],
  ['sentencia extra: grant de tabla', 'mig', 'COMMENT ON FUNCTION public.directory_countries() IS', 'GRANT SELECT ON public.countries TO anon;\nCOMMENT ON FUNCTION public.directory_countries() IS', 'soloSentenciasPermitidas'],
  ['policy nueva', 'mig', 'COMMENT ON FUNCTION public.directory_countries() IS', 'CREATE POLICY p ON public.clinics FOR SELECT USING (true);\nCOMMENT ON FUNCTION public.directory_countries() IS', 'sinTocarTablasNiSeguridad'],
  ['RLS forzada', 'mig', 'COMMENT ON FUNCTION public.directory_countries() IS', 'ALTER TABLE public.countries FORCE ROW LEVEL SECURITY;\nCOMMENT ON FUNCTION public.directory_countries() IS', 'sinTocarTablasNiSeguridad'],
  ['GRANT a PUBLIC', 'mig', 'GRANT EXECUTE ON FUNCTION public.directory_countries() TO anon, authenticated;', 'GRANT EXECUTE ON FUNCTION public.directory_countries() TO PUBLIC;', 'grantSoloAnonAuthenticated'],
  ['REVOKE sin service_role', 'mig', 'REVOKE ALL ON FUNCTION public.directory_countries() FROM PUBLIC, anon, authenticated, service_role;', 'REVOKE ALL ON FUNCTION public.directory_countries() FROM PUBLIC, anon, authenticated;', 'revokeCuatroRoles'],
  ['SECURITY INVOKER', 'mig', 'LANGUAGE sql\nSTABLE\nSECURITY DEFINER', 'LANGUAGE sql\nSTABLE\nSECURITY INVOKER', 'firmas'],
  ['VOLATILE', 'mig', 'LANGUAGE plpgsql\nSTABLE', 'LANGUAGE plpgsql\nVOLATILE', 'firmas'],
  ['search_path sin pg_temp', 'mig', 'SET search_path = public, pg_temp\nAS $fn$\n  SELECT', 'SET search_path = public\nAS $fn$\n  SELECT', 'firmas'],
  ['columna extra en el retorno', 'mig', 'level smallint, parent_id bigint)', 'level smallint, parent_id bigint, has_children boolean)', 'firmas'],
  ['SQL dinámico en el cuerpo', 'mig', '  IF v_country IS NULL THEN', "  EXECUTE 'SELECT 1';\n  IF v_country IS NULL THEN", 'cuerposSinDinamicoNiAuth'],
  ['auth.uid() en el cuerpo', 'mig', '     AND c.directory_enabled;', '     AND c.directory_enabled AND auth.uid() IS NULL;', 'cuerposSinDinamicoNiAuth'],
  ['tabla sin calificar', 'mig', '    LEFT JOIN public.country_levels l', '    LEFT JOIN country_levels l', 'cuerposSoloCatalogo'],
  ['países sin niveles omitidos (JOIN interno)', 'mig', '    LEFT JOIN public.country_levels l ON l.country_id = c.id\n   WHERE c.directory_enabled', '    JOIN public.country_levels l ON l.country_id = c.id\n   WHERE c.directory_enabled', 'countriesContrato'],
  ['POST sin países descubribles', 'mig', "    IF v_txt IS DISTINCT FROM v_esp THEN v_fallos := v_fallos || ' | ' || v_rol || ' paises descubribles: '", "    IF false THEN v_fallos := v_fallos || ' | ' || v_rol || ' paises descubribles: '", 'postPaisesDescubribles'],
  ['POST esperado con JOIN interno', 'mig', 'INTO v_esp FROM public.countries c LEFT JOIN public.country_levels l ON l.country_id = c.id WHERE c.directory_enabled;', 'INTO v_esp FROM public.countries c JOIN public.country_levels l ON l.country_id = c.id WHERE c.directory_enabled;', 'postPaisesDescubribles'],
  ['smoke POST sin fila de países descubribles', 'po', 'paises descubribles = todos los habilitados (tambien sin niveles)', 'paises', 'smokePaisesDescubribles'],
  ['lee clinics', 'mig', '    LEFT JOIN public.country_levels l ON l.country_id = c.id\n   WHERE', '    LEFT JOIN public.country_levels l ON l.country_id = c.id\n    JOIN public.clinics k ON k.country_id = c.id\n   WHERE', 'cuerposSoloCatalogo'],
  ['devuelve legacy_id', 'mig', 'SELECT u.id, u.name, u.level, u.parent_id\n        FROM', 'SELECT u.id, u.name, u.level, u.legacy_id\n        FROM', 'cuerposSinColumnasInternas'],
  ['countries sin directory_enabled', 'mig', '   WHERE c.directory_enabled\n   ORDER BY c.iso_alpha2, l.level;', '   ORDER BY c.iso_alpha2, l.level;', 'countriesContrato'],
  ['countries devuelve booking_enabled', 'mig', 'l.level, l.label_singular\n', 'l.level, l.label_singular, c.booking_enabled\n', 'cuerposSinColumnasInternas'],
  ['ISO normalizado', 'mig', 'WHERE c.iso_alpha2 = p_country_iso\n', 'WHERE c.iso_alpha2 = upper(p_country_iso)\n', 'unitsIsoExactoYHabilitado'],
  ['units sin directory_enabled', 'mig', '   WHERE c.iso_alpha2 = p_country_iso\n     AND c.directory_enabled;', '   WHERE c.iso_alpha2 = p_country_iso;', 'unitsIsoExactoYHabilitado'],
  ['ISO inválido lanza excepción', 'mig', '  IF v_country IS NULL THEN\n    RETURN;', "  IF v_country IS NULL THEN\n    RAISE EXCEPTION 'pais';", 'unitsVacioSinExcepcion'],
  ['raíz incluye inactivas', 'mig', '         AND u.parent_id IS NULL\n         AND u.is_active\n', '         AND u.parent_id IS NULL\n', 'unitsRaiz'],
  ['hijos sin validar país del padre', 'mig', '                      AND pa.country_id = v_country\n', '', 'unitsHijosDelPaisYActivos'],
  ['hijos sin padre activo', 'mig', '                      AND pa.is_active)', '                      )', 'unitsHijosDelPaisYActivos'],
  ['units sin #variable_conflict', 'mig', '#variable_conflict use_column\n', '', 'unitsVariableConflict'],
  ['units devuelve columnas en otro orden', 'mig', 'SELECT u.id, u.name, u.level, u.parent_id\n        FROM', 'SELECT u.id, u.level, u.name, u.parent_id\n        FROM', 'unitsColumnasDevueltas'],
  ['POST no exige STABLE', 'mig', "TABLE(id bigint, name text, level smallint, parent_id bigint) vol=s def=true lang=plpgsql", "TABLE(id bigint, name text, level smallint, parent_id bigint) vol=v def=true lang=plpgsql", 'postForma'],
  ['md5 incrustado desactualizado', 'mig', '  ORDER BY c.iso_alpha2, l.level;', '  ORDER BY c.iso_alpha2 DESC, l.level;', 'md5Incrustados'],
  ['POST sin ACL exacta de service_role', 'mig', "has_function_privilege('service_role', k, 'EXECUTE')", 'false', 'postAclExacta'],
  ['POST sin catálogo cerrado', 'mig', '-- 6.3 Catalogo GEO sigue cerrado al cliente.\n  IF (SELECT bool_or(', '-- 6.3 Catalogo GEO sigue cerrado al cliente.\n  IF (SELECT false AND bool_or(', 'postCatalogoCerrado'],
  ['instantánea del POST distinta', 'mig', "      'n_funciones_public', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace)\n    )\n    -- instantanea:fin\n  );", "      'n_funciones_public', (SELECT 0)\n    )\n    -- instantanea:fin\n  );", 'postInstantaneaIdentica'],
  ['instantánea sin policies', 'mig', "      'policies', (SELECT md5", "      'politicas', (SELECT md5", 'postInstantaneaCompleta'],
  ['POST sin +2', 'mig', '(v_antes ->> k)::bigint + 2', '(v_antes ->> k)::bigint', 'postMasDos'],
  ['POST sin consumidores esperados', 'mig', "IS DISTINCT FROM 'directory_countries,directory_territory_units'", "IS NULL", 'postConsumidores'],
  ['POST sin prueba de service_role', 'mig', "EXECUTE 'SET LOCAL ROLE service_role';", "NULL;", 'postComportamiento'],
  ['POST sin contrato sv minúsculas', 'mig', "(SELECT count(*) FROM public.directory_territory_units('sv'))", '0', 'postComportamiento'],
  ['POST con C2 cambiada', 'mig', "v_c2         CONSTANT text := '7cef00d1d24a004edbc4678fe6d41948';\n  v_publicados", "v_c2         CONSTANT text := 'x';\n  v_publicados", 'postConstantes'],
  ['rollback sin aviso de frontend', 'rb', 'NO es detectable desde la base', 'no aplica', 'rbOrdenYAviso'],
  ['rollback con COMMIT extra', 'rb', 'DO $RETIRO$', 'COMMIT;\nDO $RETIRO$', 'rbTransaccion'],
  ['rollback sin dependientes', 'rb', "d.refclassid = 'pg_proc'::regclass", "true", 'rbPreviaValida'],
  ['rollback VERIFICA sin -2', 'rb', '(v_antes ->> k)::bigint - 2', '(v_antes ->> k)::bigint', 'rbVerificaMenosDos'],
  ['rollback instantánea distinta', 'rb', "      'roles', (SELECT md5", "      'roles_', (SELECT md5", 'rbInstantaneaIgualMigracion'],
  ['rollback con REVOKE', 'rb', 'DO $VERIFICA$', "REVOKE SELECT ON public.countries FROM anon;\nDO $VERIFICA$", 'rbSinEscrituras'],
  ['ESTADO con dos sentencias', 'st', 'ORDER BY orden;', 'ORDER BY orden;\nSELECT 1;', 'estadoUnaSentencia'],
  ['ESTADO sin MIXTO', 'st', "ELSE 'MIXTO — '", "ELSE 'OTRO — '", 'estadoClasifica'],
  ['smoke POST con COMMIT', 'po', 'ROLLBACK;', 'COMMIT;', 'postSmokeReadOnly'],
  ['smoke POST escribe', 'po', "SET LOCAL statement_timeout = '60s';", "SET LOCAL statement_timeout = '60s';\nUPDATE public.clinics SET name = name;", 'postSmokeReadOnly'],
  ['smoke lee auth.users', 'st', 'UNION ALL SELECT 9, ', "UNION ALL SELECT 10, 'x', (SELECT count(*)::text FROM auth.users)\nUNION ALL SELECT 9, ", 'readOnlySinAuthUsers'],
  ['runbook sin cadena de rollback', 'rbk', 'frontend F3E-2 → s7_96 → s7_95 → s7_94 → s7_93 R2 → verificar → s7_92', 'x', 'runbook'],
];
for (const [nombre, k, de, a, regla] of M) {
  if (!T0[k].includes(de)) { check(`mutación «${nombre}»: ancla presente`, false, true); continue; }
  const T = { ...T0, [k]: T0[k].replace(de, a) };
  let r; try { r = R[regla](T) === true; } catch { r = false; }
  check(`mutación «${nombre}» rompe ${regla}`, r, false);
}

console.log(`\nRESULTADO check-s7_96: ${pass}/${pass + fail} ok${fail ? ` · ${fail} FAIL` : ''}`);
process.exit(fail ? 1 : 0);
