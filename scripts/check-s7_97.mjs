#!/usr/bin/env node
/**
 * check-s7_97.mjs — F3F: RPC de alcance territorial público.
 *
 * s7_97 crea SOLO public.directory_territory_scope(text, bigint) RETURNS TABLE (unit_id bigint),
 * plpgsql, SECURITY DEFINER, STABLE, search_path fijo, EXECUTE solo para anon y authenticated.
 * Sin tocar la base hay que demostrar:
 *   · el contrato exacto: la unidad y sus descendientes activos con cadena activa hasta la raíz,
 *     desde el cierre de s7_94, solo ids, ordenados, vacío en vez de excepción, ISO exacto;
 *   · el cuerpo solo lee countries, administrative_units y administrative_unit_closure, calificados,
 *     sin SQL dinámico, sin auth.uid(), sin recursión y sin columnas internas;
 *   · el PASO 2 solo contiene BEGIN RR, lock_timeout, GUARDA, instantánea, la función, dueño, REVOKE a
 *     PUBLIC/anon/authenticated/service_role, GRANT a anon/authenticated, comentario, POST y COMMIT;
 *   · PRE y GUARDA idénticas, con constantes estructurales (sin datos de clínicas);
 *   · md5 del cuerpo incrustado = cuerpo real (LF y CRLF) en migración, rollback, ESTADO y smoke POST;
 *   · el POST cubre forma, ACL exacta, catálogo y cierre cerrados, instantánea (+1), consumidores,
 *     cardinalidades contra el árbol, contratos inválidos, navegación de s7_96, roles y consumo;
 *   · rollback propio: forma+md5+ACL+dependientes, REVOKE y DROP ensamblados, VERIFICA con instantánea (-1);
 *   · bloques read-only sin escrituras; reglas del SQL Editor; artefactos históricos intactos;
 *   · mutaciones con expectativa INVERTIDA: cada regla detecta su violación.
 *
 *   node scripts/check-s7_97.mjs
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

console.log('\ncheck-s7_97 — F3F · RPC de alcance territorial\n');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const P = {
  mig: path.join('migrations', 's7_97_geo_f3f_directory_territory_scope.sql'),
  rb: path.join('docs', 'rollbacks', 's7_97_rollback.sql'),
  st: path.join('docs', 'smokes', 's7_97_state_readonly.sql'),
  po: path.join('docs', 'smokes', 's7_97_post_verification_readonly.sql'),
  rbk: path.join('docs', 'OWNER_S7_97_APPLY.md'),
};
const T0 = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, leerLF(p)]));

const sinComentarios = (sql) => sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
const entre = (s, a, b) => { const i = s.indexOf(a); if (i === -1) return ''; const j = s.indexOf(b, i + a.length); return j === -1 ? '' : s.slice(i, j + b.length); };
const bloque = (s, tag) => entre(s, `DO $${tag}$`, `$${tag}$;`);
const cuerpos = (s) => [...s.matchAll(/AS \$fn\$([\s\S]*?)\$fn\$;/g)].map((x) => x[1]);
const md5 = (t) => crypto.createHash('md5').update(t, 'utf8').digest('hex');
const instantaneas = (s) => [...s.matchAll(/    -- instantanea:ini\n([\s\S]*?)    -- instantanea:fin/g)].map((x) => x[1]);
function ocur(s, needle) { return s.split(needle).length - 1; }

// ── Constantes estructurales (preflight F3F PRE-0 de producción, 2026-09-17, y huellas de s7_94) ──
const C = {
  v_paises: 'SV',
  v_niveles: 'SV:1,2,3',
  v_unidades: '14|44|262|0',
  v_catalogo: '460e807050a0da8bea0891965b1b9fd7',
  v_cierre: '888|0=320,1=306,2=262|af230f5086d871b1cce24e34de4b6cec',
  v_geo: 'administrative_unit_closure={postgres=arwdDxtm/postgres}|true|false|postgres|0;administrative_units={postgres=arwdDxtm/postgres}|true|false|postgres|0;countries={postgres=arwdDxtm/postgres}|true|false|postgres|0;country_levels={postgres=arwdDxtm/postgres}|true|false|postgres|0',
  v_acl_96: 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres',
};
const ACL = 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres';
const FIRMA = 'CREATE FUNCTION public.directory_territory_scope(p_country_iso text, p_unit_id bigint)\nRETURNS TABLE (unit_id bigint)\nLANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$';
const FORMA = 'directory_territory_scope(p_country_iso text, p_unit_id bigint) TABLE(unit_id bigint) vol=s def=true lang=plpgsql cfg={"search_path=public, pg_temp"} owner=postgres args=p_country_iso text, p_unit_id bigint';
const PRED_94 = "p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)'";
const PRED_9293 = "p.prosrc ~ '\\m(country_id|territory_unit_id|administrative_units|country_levels)\\M'";

const R = {};

// 0 · SQL Editor
R.sinEtiquetasEnComentarios = (T) => ['mig', 'rb', 'st', 'po'].every((k) => !T[k].split('\n').some((l) => { const i = l.indexOf('--'); return i !== -1 && /\$[A-Za-z0-9_]*\$/.test(l.slice(i)); }));
R.rollbackSinDDLNombrado = (T) => !/(DROP|REVOKE[^;']*)\s+FUNCTION\s+(public\.)?directory_territory_scope/i.test(T.rb)
  && ocur(T.rb, "format('DROP FUNCTION %I.%I(%s)'") === 1 && ocur(T.rb, "format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated, service_role'") === 1;
R.sinCreateTableNiTemporales = (T) => ['mig', 'rb', 'st', 'po'].every((k) => !/CREATE\s+(TEMP|TEMPORARY|UNLOGGED\s+)?\s*TABLE/i.test(T[k]));

// 1 · PRE / GUARDA
const normal = (b, tag) => b.split(`$${tag}$`).join('$X$').replace(/v_etapa\s+CONSTANT text := '[A-Z]+';/, "v_etapa CONSTANT text := 'X';");
R.preIgualGuarda = (T) => { const a = bloque(T.mig, 'PRE'), b = bloque(T.mig, 'GUARDA'); return a !== '' && normal(a, 'PRE') === normal(b, 'GUARDA'); };
const constantesDe = (b) => Object.fromEntries(Object.keys(C).map((k) => { const m = b.match(new RegExp(`${k}\\s+CONSTANT text := '([^']*)'`)); return [k, m ? m[1] : null]; }));
R.constantesPre = (T) => JSON.stringify(constantesDe(bloque(T.mig, 'PRE'))) === JSON.stringify(C);
R.preSoloLectura = (T) => { const b = sinLiterales(sinComentarios(bloque(T.mig, 'PRE'))); return !/\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT)\b/i.test(b.replace(/FILTER \(WHERE/g, '')) && !/set_config/i.test(b); };
R.preExigePostgresYCreate = (T) => { const b = bloque(T.mig, 'PRE'); return b.includes("IF current_user <> 'postgres' THEN") && b.includes("has_schema_privilege(current_user, 'public', 'CREATE')"); };
R.preNoReaplica = (T) => bloque(T.mig, 'PRE').includes("SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'directory_territory_scope';\n  IF v_n <> 0 THEN");
R.preExige96 = (T) => { const b = bloque(T.mig, 'PRE'); return b.includes("SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');\n  IF v_n <> 2 THEN")
  && b.includes("<> ALL (v_md5_c96)") && b.includes("<> ALL (v_md5_u96)") && b.includes('IF v_txt IS DISTINCT FROM v_acl_96 THEN')
  && b.includes("v_md5_c96    CONSTANT text[] := ARRAY['d3fa8ee9a257868fc75480860ed7c4a6', '54aeee13db6d9cc1ddf02f121839d674'];")
  && b.includes("v_md5_u96    CONSTANT text[] := ARRAY['3083c7c5ad5a790c044e89bd7d554afc', '243b51249cb406b28b90fe5087387229'];"); };
R.preCatalogoCerrado = (T) => { const b = bloque(T.mig, 'PRE'); return b.includes('IS DISTINCT FROM v_geo') && b.includes("unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol)"); };
R.preConsumidores = (T) => { const b = bloque(T.mig, 'PRE'); return b.includes(PRED_9293) && b.includes("IS DISTINCT FROM 'directory_countries,directory_territory_units' THEN") && b.includes(PRED_94) && b.includes('ya hay % funciones que leen el cierre'); };
R.preCierreYCatalogo = (T) => { const b = bloque(T.mig, 'PRE'); return b.includes('IS DISTINCT FROM v_catalogo') && b.includes('IS DISTINCT FROM v_cierre') && b.includes('filas del cierre con pais cruzado'); };
R.preSinDatosDeClinicas = (T) => { const b = bloque(T.mig, 'PRE'); return !/v_c2|v_estados|v_publicados|v_visibles|v_lista|FROM public\.clinics|FROM public\.doctors/.test(b); };
R.svPorIso = (T) => !/country_id\s*=\s*1\b/.test(sinComentarios(T.mig)) && !/\bv_sv\s*:=\s*\d/.test(T.mig) && !/'SV',\s*\d+\)/.test(sinComentarios(T.mig + T.po));

// 2 · orden y alcance del PASO 2
const paso2 = (s) => entre(s, 'BEGIN ISOLATION LEVEL REPEATABLE READ;', '\nCOMMIT;');
const fuera = (s) => { let t = paso2(s); for (const tag of ['GUARDA', 'SNAP', 'POST']) t = t.split(bloque(t, tag)).join(`<${tag}>;`); for (const c of cuerpos(s)) t = t.split(c).join('<CUERPO>'); return sinComentarios(t); };
R.ordenPaso2 = (T) => {
  const t = paso2(T.mig);
  const hitos = ['BEGIN ISOLATION LEVEL REPEATABLE READ;', "SET LOCAL lock_timeout = '5s';", 'DO $GUARDA$', 'DO $SNAP$', FIRMA,
    'ALTER FUNCTION public.directory_territory_scope(text, bigint) OWNER TO postgres;',
    'REVOKE ALL ON FUNCTION public.directory_territory_scope(text, bigint) FROM PUBLIC, anon, authenticated, service_role;',
    'GRANT EXECUTE ON FUNCTION public.directory_territory_scope(text, bigint) TO anon, authenticated;',
    'COMMENT ON FUNCTION public.directory_territory_scope(text, bigint) IS', 'DO $POST$'];
  let pos = -1;
  for (const h of hitos) { const i = t.indexOf(h); if (i <= pos || ocur(t, h) !== 1) return false; pos = i; }
  return ocur(T.mig, '\nCOMMIT;') === 1 && T.mig.trimEnd().endsWith('COMMIT;') && ocur(T.mig, 'BEGIN ISOLATION LEVEL') === 1 && !/^BEGIN\s*;/m.test(T.mig);
};
R.soloSentenciasPermitidas = (T) => {
  const sentencias = sinLiterales(fuera(T.mig)).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const permitidas = [/^BEGIN ISOLATION LEVEL REPEATABLE READ$/, /^SET LOCAL lock_timeout = ''$/, /^<(GUARDA|SNAP|POST)>$/, /^COMMIT$/,
    /^CREATE FUNCTION public\.directory_territory_scope\(.*\$fn\$<CUERPO>\$fn\$$/,
    /^ALTER FUNCTION public\.directory_territory_scope\(text, bigint\) OWNER TO postgres$/,
    /^REVOKE ALL ON FUNCTION public\.directory_territory_scope\(text, bigint\) FROM PUBLIC, anon, authenticated, service_role$/,
    /^GRANT EXECUTE ON FUNCTION public\.directory_territory_scope\(text, bigint\) TO anon, authenticated$/,
    /^COMMENT ON FUNCTION public\.directory_territory_scope\(text, bigint\) IS ''( '')*$/];
  return sentencias.length === 11 && sentencias.every((x) => permitidas.some((re) => re.test(x)));
};
R.sinTocarTablasNiSeguridad = (T) => {
  const t = sinLiterales(sinComentarios(T.mig));
  return !/\b(CREATE|ALTER|DROP)\s+(TABLE|POLICY|VIEW|ROLE|USER|TRIGGER|SCHEMA|INDEX|MATERIALIZED)\b/i.test(t)
    && !/ALTER\s+DEFAULT\s+PRIVILEGES/i.test(t) && !/ROW\s+LEVEL\s+SECURITY/i.test(t)
    && !/\bGRANT\b(?![^;]*ON FUNCTION)/i.test(t) && !/\bREVOKE\b(?![^;]*ON FUNCTION)/i.test(t)
    && !/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE)\b/i.test(t) && !/auth\.users/i.test(t);
};
R.grantSoloAnonAuthenticated = (T) => [...T.mig.matchAll(/^GRANT[^;]*;/gm)].every((m) => / TO anon, authenticated;$/.test(m[0])) && ocur(T.mig, '\nGRANT ') === 1;
R.revokeCuatroRoles = (T) => { const r = [...T.mig.matchAll(/^REVOKE[^;]*;/gm)]; return r.length === 1 && r[0][0].endsWith(' FROM PUBLIC, anon, authenticated, service_role;'); };

// 3 · contrato de la función
R.firma = (T) => ocur(T.mig, FIRMA) === 1;
R.unCuerpo = (T) => cuerpos(T.mig).length === 1;
const cuerpo = (T) => cuerpos(T.mig)[0] || '';
R.cuerpoSinDinamicoNiAuth = (T) => !/\bEXECUTE\b|format\s*\(|auth\.|current_setting|set_config|current_user|session_user|\bRAISE\b|\bPERFORM\b/i.test(cuerpo(T));
R.cuerpoSinRecursion = (T) => !/\bRECURSIVE\b|\bWITH\b/i.test(sinComentarios(cuerpo(T)));
R.cuerpoSoloCatalogoYCierre = (T) => {
  const refs = [...sinComentarios(cuerpo(T)).matchAll(/\b(FROM|JOIN)\s+([a-z_.]+)/gi)].map((m) => m[2]);
  return refs.length > 0 && refs.every((r) => ['public.countries', 'public.administrative_units', 'public.administrative_unit_closure'].includes(r));
};
R.cuerpoSinColumnasInternas = (T) => !/legacy_id|official_|booking_enabled|has_children|\.name\b|clinic|doctor|profile|patient|member|audit|country_levels/i.test(cuerpo(T));
R.soloIdsOrdenados = (T) => { const b = cuerpo(T); return ocur(b, 'RETURN QUERY\n    SELECT cl.descendant_unit_id\n      FROM') === 1 && b.includes('     ORDER BY cl.descendant_unit_id;\nEND'); };
R.isoExactoYHabilitado = (T) => { const b = cuerpo(T); return b.includes('   WHERE c.iso_alpha2 = p_country_iso\n     AND c.directory_enabled;') && !/upper|lower|btrim|ilike/i.test(b); };
R.vacioSinExcepcion = (T) => { const b = cuerpo(T); return b.includes('  IF p_unit_id IS NULL THEN\n    RETURN;\n  END IF;') && b.includes('  IF v_country IS NULL THEN\n    RETURN;\n  END IF;') && !/RAISE/i.test(b); };
R.unidadDelPaisYActiva = (T) => cuerpo(T).includes('     WHERE a.id = p_unit_id\n       AND a.country_id = v_country\n       AND a.is_active\n');
R.cierreDelPaisYDescendienteActivo = (T) => { const b = cuerpo(T); return b.includes('        ON cl.ancestor_unit_id = a.id\n       AND cl.country_id = v_country\n') && b.includes('        ON d.id = cl.descendant_unit_id\n       AND d.is_active\n'); };
R.cadenaActiva = (T) => cuerpo(T).includes('       AND NOT EXISTS (SELECT 1\n                         FROM public.administrative_unit_closure up\n                         JOIN public.administrative_units m ON m.id = up.ancestor_unit_id\n                        WHERE up.descendant_unit_id = cl.descendant_unit_id\n                          AND up.depth > 0\n                          AND NOT m.is_active)');
R.variableConflict = (T) => cuerpo(T).startsWith('\n#variable_conflict use_column\n');

// 4 · md5 incrustado
const md5s = (T) => [md5(cuerpo(T)), md5(cuerpo(T).split('\n').join('\r\n'))];
R.md5Incrustados = (T) => {
  const [l, c] = md5s(T);
  return ocur(T.mig, `ARRAY['${l}', '${c}']`) === 1 && ocur(T.rb, `ARRAY['${l}', '${c}']`) === 1
    && ocur(T.st, `IN ('${l}', '${c}')`) === 1 && ocur(T.po, `IN ('${l}', '${c}')`) === 1;
};

// 5 · POST
R.postForma = (T) => bloque(T.mig, 'POST').includes(`IF v_txt IS DISTINCT FROM '${FORMA}' THEN`);
R.postAclExacta = (T) => { const b = bloque(T.mig, 'POST'); return b.includes(`v_acl        CONSTANT text := '${ACL}';`) && b.includes("OR has_function_privilege('service_role', 'public.directory_territory_scope(text, bigint)', 'EXECUTE') THEN"); };
R.postCatalogoCerrado = (T) => bloque(T.mig, 'POST').includes("-- 5.3 Catalogo GEO sigue cerrado al cliente.\n  IF (SELECT bool_or(has_table_privilege(r2.rol, t.tbl, x.priv))\n        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r2(rol),\n             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),");
R.postInstantaneaIdentica = (T) => { const a = instantaneas(T.mig); return a.length === 2 && a[0] === a[1] && bloque(T.mig, 'SNAP').includes(a[0]) && bloque(T.mig, 'POST').includes(a[0]); };
R.postInstantaneaCompleta = (T) => ['policies', 'relaciones', 'columnas', 'funciones', 'triggers', 'default_acl', 'roles', 'membresias', 'esquemas', 'catalogo_geo', 'cierre', 'clinics_c2', 'directorio', 'n_funciones_public'].every((k) => (instantaneas(T.mig)[0] || '').includes(`'${k}',`))
  && (instantaneas(T.mig)[0] || '').includes("AND p.proname <> 'directory_territory_scope'),");
R.postMasUno = (T) => bloque(T.mig, 'POST').includes('(v_ahora ->> k)::bigint <> (v_antes ->> k)::bigint + 1');
R.postConsumidores = (T) => { const b = bloque(T.mig, 'POST'); return b.includes("IS DISTINCT FROM 'directory_countries,directory_territory_scope,directory_territory_units' THEN") && b.includes("IS DISTINCT FROM 'directory_territory_scope' THEN") && b.includes('funciones que usan las RPC de s7_96'); };
R.postCasos = (T) => { const b = bloque(T.mig, 'POST'); return b.includes("VALUES ('departamento grande', v_dgr, 37), ('departamento pequeño', v_dpe, 12),\n                                   ('municipio grande', v_mgr, 21), ('hoja', v_hoja, 1), ('San Salvador', v_ss, 25))")
  && b.includes('UNION SELECT c2.id FROM public.administrative_units c1 JOIN public.administrative_units c2 ON c2.parent_id = c1.id')
  && b.includes(": scope distinto del arbol'") && !/descendant_unit_id[^;]*v_esp :=/.test(b); };
R.postContratosInvalidos = (T) => { const b = bloque(T.mig, 'POST'); return ["directory_territory_scope(NULL, v_dgr)", "directory_territory_scope('', v_dgr)", "directory_territory_scope('sv', v_dgr)", "directory_territory_scope('XX', v_dgr)", "directory_territory_scope('SV', NULL)", "directory_territory_scope('SV', -1)", "directory_territory_scope('HN', v_hoja)"].every((x) => b.includes(x)); };
R.postNavegacionYRoles = (T) => { const b = bloque(T.mig, 'POST'); return b.includes('scope de San Salvador distinto de la navegacion') && b.includes("FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated']")
  && ocur(b, "EXECUTE 'SET LOCAL ROLE service_role';") === 1 && b.includes("ARRAY['countries', 'country_levels', 'administrative_units', 'administrative_unit_closure']")
  && b.includes('EXCEPTION WHEN insufficient_privilege THEN') && b.includes("RAISE EXCEPTION 's7_97 POST fallo:%', v_fallos;"); };
R.postConsumo = (T) => { const b = bloque(T.mig, 'POST'); return b.includes('scope y legacy difieren') && b.includes('clinicas sin territorio dentro de un scope') && b.includes('clinicas con territorio fuera del scope de su departamento'); };

// 6 · rollback
R.rbOrdenYAviso = (T) => T.rb.includes('revertir frontend F3E-3B -> rollback de s7_97 -> revertir frontend F3E-2') && /no es detectable desde la base/i.test(T.rb) && T.rb.includes('NO EJECUTAR SIN ORDEN EXPLICITA DEL OWNER');
R.rbTransaccion = (T) => { const t = T.rb; const i = [t.indexOf('BEGIN ISOLATION LEVEL REPEATABLE READ;'), t.indexOf("SET LOCAL lock_timeout = '5s';"), t.indexOf('DO $PREVIA$'), t.indexOf('DO $RETIRO$'), t.indexOf('DO $VERIFICA$'), t.lastIndexOf('\nCOMMIT;')]; return i.every((x, k) => x > (k ? i[k - 1] : -1)) && ocur(t, '\nCOMMIT;') === 1; };
R.rbPreviaValida = (T) => { const b = bloque(T.rb, 'PREVIA'); return b.includes('IF v_n <> 1 THEN') && b.includes(`v_acl CONSTANT text := '${ACL}';`) && b.includes(`IF v_txt IS DISTINCT FROM '${FORMA}' THEN`)
  && b.includes("d.refclassid = 'pg_proc'::regclass") && b.includes("p.prosrc ~ '\\mdirectory_territory_scope\\M'") && b.includes('FROM pg_policies'); };
R.rbVerifica = (T) => { const b = bloque(T.rb, 'VERIFICA'); return b.includes('(v_antes ->> k)::bigint - 1') && b.includes(PRED_94) && b.includes("IS DISTINCT FROM 'directory_countries,directory_territory_units' THEN") && b.includes('has_table_privilege(r.rol, t.tbl, x.priv)'); };
R.rbInstantaneaIgualMigracion = (T) => { const a = instantaneas(T.rb); return a.length === 2 && a[0] === a[1] && a[0] === instantaneas(T.mig)[0]; };
R.rbSinEscrituras = (T) => !/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE|GRANT|REVOKE|ALTER|CREATE)\b/i.test(sinLiterales(sinComentarios(T.rb)));

// 7 · bloques read-only
R.estadoUnaSentencia = (T) => { const t = sinComentarios(T.st).trim(); return t.startsWith('WITH') && t.endsWith('ORDER BY orden;') && ocur(sinLiterales(t), ';') === 1; };
R.estadoClasifica = (T) => ['S7_97 NO APLICADA', 'S7_97 APLICADA COMPLETA', 'MIXTO', 'ANOMALIA'].every((x) => T.st.includes(x))
  && T.st.includes("m.lectores_cierre = 'directory_territory_scope'") && T.st.includes('m.n_rpc_96 = 2');
R.postSmokeReadOnly = (T) => { const t = sinComentarios(T.po).trim(); return t.startsWith('BEGIN READ ONLY;') && t.endsWith('ROLLBACK;') && !/\bCOMMIT\b/.test(t)
  && !/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE|GRANT|REVOKE|ALTER|CREATE|DROP)\b/i.test(sinLiterales(t)); };
R.postSmokePlanesYConsumo = (T) => T.po.includes('Seq Scan sobre el cierre') && T.po.includes('nodos Recursive Union / CTE Scan') && T.po.includes("'e', '9|9'") && T.po.includes("'e', '46|36'") && T.po.includes("'e', '42501'");
R.readOnlySinAuthUsers = (T) => ![T.st, T.po].some((x) => /auth\.users/.test(sinComentarios(x)));

// 8 · runbook
R.runbook = (T) => ['PASO 1', 'PASO 2', 'docs/smokes/s7_97_state_readonly.sql', 'docs/smokes/s7_97_post_verification_readonly.sql',
  'frontend F3E-3B → s7_97 → frontend F3E-2 → s7_96 → s7_95 → s7_94 → s7_93 R2 → verificar → s7_92', 'NOT APPLIED / DO NOT MERGE', 'service_role', 'cero coincidencias'].every((x) => T.rbk.includes(x));

// ═══════════════════════════════════════════════════════════
console.log('0 · archivos, posición y artefactos históricos');
const migs = fs.readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
check('s7_97 es la migración 118 en orden', migs.indexOf(path.basename(P.mig)) + 1, 118);
let rastreados = '';
try { rastreados = execSync(`git ls-files -- ${[P.mig, P.rb, P.st, P.po, P.rbk, 'scripts/check-s7_97.mjs'].join(' ')}`, { encoding: 'utf8' }); } catch { rastreados = ''; }
check('los 6 artefactos están rastreados por git (los .sql de docs requieren git add -f)', rastreados.trim().split('\n').filter(Boolean).length, 6);
let difHist = 'error';
try {
  difHist = execSync('git diff --name-only origin/main -- migrations/s7_87* migrations/s7_88* migrations/s7_89* migrations/s7_9[0-6]* docs/rollbacks/s7_9[0-6]_rollback.sql docs/smokes/s7_9[1-6]_*', { encoding: 'utf8' }).trim();
} catch { difHist = 'error'; }
check('migraciones, rollbacks y smokes históricos intactos respecto de origin/main', difHist, '');

const nombres = Object.keys(R);
const ejecutar = (T) => Object.fromEntries(nombres.map((n) => { try { return [n, R[n](T) === true]; } catch { return [n, false]; } }));
const base = ejecutar(T0);
console.log('\n1 · reglas sobre los artefactos');
for (const n of nombres) check(n, base[n], true);

console.log('\n2 · valores');
check('md5 LF/CRLF de directory_territory_scope', md5s(T0).join('|'), '08116cf0c80730e76e2cae4531153989|a69870a3a900247ad60d4d9c2730d375');
for (const [k, v] of Object.entries(C)) check(`constante ${k} en la GUARDA`, constantesDe(bloque(T0.mig, 'GUARDA'))[k], v);

console.log('\n3 · mutaciones con expectativa INVERTIDA (cada una debe romper su regla)');
const M = [
  ['comentario con etiqueta $x$', 'mig', '-- Migracion 118.', '-- Migracion 118 $PRE$.', 'sinEtiquetasEnComentarios'],
  ['rollback con DROP literal', 'rb', "EXECUTE format('DROP FUNCTION %I.%I(%s)', 'public', 'directory_territory_scope', 'text, bigint');", 'DROP FUNCTION public.directory_territory_scope(text, bigint);', 'rollbackSinDDLNombrado'],
  ['rollback sin REVOKE ensamblado', 'rb', "EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated, service_role', 'public', 'directory_territory_scope', 'text, bigint');", '', 'rollbackSinDDLNombrado'],
  ['CREATE TABLE en un literal', 'st', "'orden de reversion'", "'CREATE TABLE public.zz (id int)'", 'sinCreateTableNiTemporales'],
  ['GUARDA distinta del PRE', 'mig', "IF v_n <> 0 THEN\n    RAISE EXCEPTION 's7_97 %: ya existen", "IF v_n <> 9 THEN\n    RAISE EXCEPTION 's7_97 %: ya existen", 'preIgualGuarda'],
  ['huella del cierre cambiada en el PRE', 'mig', "v_cierre     CONSTANT text := '888|0=320,1=306,2=262|af230f5086d871b1cce24e34de4b6cec';", "v_cierre     CONSTANT text := '888|0=320,1=306,2=262|00000000000000000000000000000000';", 'constantesPre'],
  ['PRE escribe', 'mig', "  RAISE NOTICE 's7_97 % OK", "  UPDATE public.clinics SET name = name;\n  RAISE NOTICE 's7_97 % OK", 'preSoloLectura'],
  ['PRE sin comprobar CREATE', 'mig', "has_schema_privilege(current_user, 'public', 'CREATE')", 'true', 'preExigePostgresYCreate'],
  ['PRE sin no-reaplicar', 'mig', "SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'directory_territory_scope';\n  IF v_n <> 0 THEN", "v_n := 0;\n  IF v_n <> 0 THEN", 'preNoReaplica'],
  ['PRE sin exigir s7_96', 'mig', '<> ALL (v_md5_c96)', '<> ALL (ARRAY[md5(prosrc)])', 'preExige96'],
  ['PRE sin catálogo cerrado', 'mig', 'IS DISTINCT FROM v_geo', 'IS DISTINCT FROM v_txt', 'preCatalogoCerrado'],
  ['PRE admite lectores del cierre', 'mig', 'ya hay % funciones que leen el cierre', 'lectores admitidos', 'preConsumidores'],
  ['PRE sin huella del cierre', 'mig', 'IS DISTINCT FROM v_cierre', 'IS NULL', 'preCierreYCatalogo'],
  ['PRE con dato de clínicas', 'mig', "  RAISE NOTICE 's7_97 % OK", "  PERFORM 1 FROM public.clinics;\n  RAISE NOTICE 's7_97 % OK", 'preSinDatosDeClinicas'],
  ['SV por id numérico', 'mig', "SELECT id INTO STRICT v_sv FROM public.countries WHERE iso_alpha2 = 'SV';", 'v_sv := 1;', 'svPorIso'],
  ['REVOKE después del GRANT', 'mig', 'REVOKE ALL ON FUNCTION public.directory_territory_scope(text, bigint) FROM PUBLIC, anon, authenticated, service_role;\nGRANT EXECUTE ON FUNCTION public.directory_territory_scope(text, bigint) TO anon, authenticated;', 'GRANT EXECUTE ON FUNCTION public.directory_territory_scope(text, bigint) TO anon, authenticated;\nREVOKE ALL ON FUNCTION public.directory_territory_scope(text, bigint) FROM PUBLIC, anon, authenticated, service_role;', 'ordenPaso2'],
  ['sentencia extra: grant de tabla', 'mig', 'COMMENT ON FUNCTION public.directory_territory_scope(text, bigint) IS', 'GRANT SELECT ON public.administrative_unit_closure TO anon;\nCOMMENT ON FUNCTION public.directory_territory_scope(text, bigint) IS', 'soloSentenciasPermitidas'],
  ['policy nueva', 'mig', 'COMMENT ON FUNCTION public.directory_territory_scope(text, bigint) IS', 'CREATE POLICY p ON public.clinics FOR SELECT USING (true);\nCOMMENT ON FUNCTION public.directory_territory_scope(text, bigint) IS', 'sinTocarTablasNiSeguridad'],
  ['RLS forzada', 'mig', 'COMMENT ON FUNCTION public.directory_territory_scope(text, bigint) IS', 'ALTER TABLE public.administrative_unit_closure FORCE ROW LEVEL SECURITY;\nCOMMENT ON FUNCTION public.directory_territory_scope(text, bigint) IS', 'sinTocarTablasNiSeguridad'],
  ['GRANT a PUBLIC', 'mig', 'GRANT EXECUTE ON FUNCTION public.directory_territory_scope(text, bigint) TO anon, authenticated;', 'GRANT EXECUTE ON FUNCTION public.directory_territory_scope(text, bigint) TO PUBLIC;', 'grantSoloAnonAuthenticated'],
  ['GRANT a service_role', 'mig', 'GRANT EXECUTE ON FUNCTION public.directory_territory_scope(text, bigint) TO anon, authenticated;', 'GRANT EXECUTE ON FUNCTION public.directory_territory_scope(text, bigint) TO anon, authenticated, service_role;', 'grantSoloAnonAuthenticated'],
  ['REVOKE sin service_role', 'mig', 'FROM PUBLIC, anon, authenticated, service_role;\nGRANT', 'FROM PUBLIC, anon, authenticated;\nGRANT', 'revokeCuatroRoles'],
  ['SECURITY INVOKER', 'mig', 'STABLE\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS $fn$', 'STABLE\nSECURITY INVOKER\nSET search_path = public, pg_temp\nAS $fn$', 'firma'],
  ['VOLATILE', 'mig', 'LANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER', 'LANGUAGE plpgsql\nVOLATILE\nSECURITY DEFINER', 'firma'],
  ['search_path sin pg_temp', 'mig', 'SET search_path = public, pg_temp\nAS $fn$', 'SET search_path = public\nAS $fn$', 'firma'],
  ['columna extra en el retorno', 'mig', 'RETURNS TABLE (unit_id bigint)\nLANGUAGE plpgsql', 'RETURNS TABLE (unit_id bigint, level smallint)\nLANGUAGE plpgsql', 'firma'],
  ['SQL dinámico en el cuerpo', 'mig', '  IF v_country IS NULL THEN', "  EXECUTE 'SELECT 1';\n  IF v_country IS NULL THEN", 'cuerpoSinDinamicoNiAuth'],
  ['auth.uid() en el cuerpo', 'mig', '     AND c.directory_enabled;\n\n  IF v_country', '     AND c.directory_enabled AND auth.uid() IS NULL;\n\n  IF v_country', 'cuerpoSinDinamicoNiAuth'],
  ['recursión en el cuerpo', 'mig', '  RETURN QUERY\n    SELECT cl.descendant_unit_id', '  RETURN QUERY\n    WITH RECURSIVE t AS (SELECT 1) SELECT cl.descendant_unit_id', 'cuerpoSinRecursion'],
  ['tabla sin calificar', 'mig', '      JOIN public.administrative_unit_closure cl', '      JOIN administrative_unit_closure cl', 'cuerpoSoloCatalogoYCierre'],
  ['lee clinics', 'mig', '      JOIN public.administrative_units d\n', '      JOIN public.clinics k ON k.territory_unit_id = cl.descendant_unit_id\n      JOIN public.administrative_units d\n', 'cuerpoSoloCatalogoYCierre'],
  ['devuelve nombres', 'mig', '    SELECT cl.descendant_unit_id\n      FROM', '    SELECT cl.descendant_unit_id, d.name\n      FROM', 'cuerpoSinColumnasInternas'],
  ['sin ORDER BY', 'mig', '     ORDER BY cl.descendant_unit_id;\nEND', '     ;\nEND', 'soloIdsOrdenados'],
  ['ISO normalizado', 'mig', '   WHERE c.iso_alpha2 = p_country_iso\n     AND c.directory_enabled;', '   WHERE c.iso_alpha2 = upper(p_country_iso)\n     AND c.directory_enabled;', 'isoExactoYHabilitado'],
  ['sin directory_enabled', 'mig', '   WHERE c.iso_alpha2 = p_country_iso\n     AND c.directory_enabled;', '   WHERE c.iso_alpha2 = p_country_iso;', 'isoExactoYHabilitado'],
  ['unidad NULL = todo el país', 'mig', '  IF p_unit_id IS NULL THEN\n    RETURN;\n  END IF;', '', 'vacioSinExcepcion'],
  ['ISO inválido lanza excepción', 'mig', '  IF v_country IS NULL THEN\n    RETURN;', "  IF v_country IS NULL THEN\n    RAISE EXCEPTION 'pais';", 'vacioSinExcepcion'],
  ['sin validar el país de la unidad', 'mig', '       AND a.country_id = v_country\n', '', 'unidadDelPaisYActiva'],
  ['unidad inactiva admitida', 'mig', '       AND a.country_id = v_country\n       AND a.is_active\n', '       AND a.country_id = v_country\n', 'unidadDelPaisYActiva'],
  ['cierre de cualquier país', 'mig', '        ON cl.ancestor_unit_id = a.id\n       AND cl.country_id = v_country\n', '        ON cl.ancestor_unit_id = a.id\n', 'cierreDelPaisYDescendienteActivo'],
  ['descendientes inactivos admitidos', 'mig', '        ON d.id = cl.descendant_unit_id\n       AND d.is_active\n', '        ON d.id = cl.descendant_unit_id\n', 'cierreDelPaisYDescendienteActivo'],
  ['sin cadena activa', 'mig', '                          AND up.depth > 0\n                          AND NOT m.is_active)', '                          AND false)', 'cadenaActiva'],
  ['sin #variable_conflict', 'mig', '#variable_conflict use_column\n', '', 'variableConflict'],
  ['md5 incrustado desactualizado', 'mig', '     ORDER BY cl.descendant_unit_id;\nEND', '     ORDER BY cl.descendant_unit_id DESC;\nEND', 'md5Incrustados'],
  ['POST no exige STABLE', 'mig', "IF v_txt IS DISTINCT FROM 'directory_territory_scope(p_country_iso text, p_unit_id bigint) TABLE(unit_id bigint) vol=s", "IF v_txt IS DISTINCT FROM 'directory_territory_scope(p_country_iso text, p_unit_id bigint) TABLE(unit_id bigint) vol=v", 'postForma'],
  ['POST sin ACL de service_role', 'mig', "OR has_function_privilege('service_role', 'public.directory_territory_scope(text, bigint)', 'EXECUTE') THEN", 'OR false THEN', 'postAclExacta'],
  ['POST sin catálogo cerrado', 'mig', '-- 5.3 Catalogo GEO sigue cerrado al cliente.\n  IF (SELECT bool_or(', '-- 5.3 Catalogo GEO sigue cerrado al cliente.\n  IF (SELECT false AND bool_or(', 'postCatalogoCerrado'],
  ['instantánea del POST distinta', 'mig', "      'n_funciones_public', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace)\n    )\n    -- instantanea:fin\n  );", "      'n_funciones_public', (SELECT 0)\n    )\n    -- instantanea:fin\n  );", 'postInstantaneaIdentica'],
  ['instantánea sin cierre', 'mig', "      'cierre', (SELECT md5", "      'cierre_', (SELECT md5", 'postInstantaneaCompleta'],
  ['instantánea excluye las RPC de s7_96', 'mig', "AND p.proname <> 'directory_territory_scope'),", "AND p.proname NOT LIKE 'directory_%'),", 'postInstantaneaCompleta'],
  ['POST sin +1', 'mig', '(v_ahora ->> k)::bigint <> (v_antes ->> k)::bigint + 1', '(v_ahora ->> k)::bigint <> (v_antes ->> k)::bigint', 'postMasUno'],
  ['POST sin consumidores del cierre', 'mig', "IS DISTINCT FROM 'directory_territory_scope' THEN", 'IS NULL THEN', 'postConsumidores'],
  ['POST con cardinalidad cambiada', 'mig', "('San Salvador', v_ss, 25)", "('San Salvador', v_ss, 26)", 'postCasos'],
  ['POST sin árbol independiente', 'mig', 'UNION SELECT c2.id FROM public.administrative_units c1 JOIN public.administrative_units c2 ON c2.parent_id = c1.id', 'UNION SELECT 0', 'postCasos'],
  ['POST sin contrato sv minúsculas', 'mig', "directory_territory_scope('sv', v_dgr)", "directory_territory_scope('SV', v_dgr)", 'postContratosInvalidos'],
  ['POST sin prueba de service_role', 'mig', "EXECUTE 'SET LOCAL ROLE service_role';", 'NULL;', 'postNavegacionYRoles'],
  ['POST sin consumo S2', 'mig', 'clinicas sin territorio dentro de un scope', 'x', 'postConsumo'],
  ['rollback sin aviso de frontend', 'rb', 'NO es detectable desde la base', 'no aplica', 'rbOrdenYAviso'],
  ['rollback con COMMIT extra', 'rb', 'DO $RETIRO$', 'COMMIT;\nDO $RETIRO$', 'rbTransaccion'],
  ['rollback sin dependientes', 'rb', "d.refclassid = 'pg_proc'::regclass", 'true', 'rbPreviaValida'],
  ['rollback VERIFICA sin -1', 'rb', '(v_antes ->> k)::bigint - 1', '(v_antes ->> k)::bigint', 'rbVerifica'],
  ['rollback VERIFICA sin lectores del cierre', 'rb', "p.prosrc ~* '(administrative_unit_closure|", "p.prosrc ~* '(xadministrative_unit_closure|", 'rbVerifica'],
  ['rollback instantánea distinta', 'rb', "      'roles', (SELECT md5", "      'roles_', (SELECT md5", 'rbInstantaneaIgualMigracion'],
  ['rollback con GRANT', 'rb', 'DO $VERIFICA$', "GRANT SELECT ON public.countries TO anon;\nDO $VERIFICA$", 'rbSinEscrituras'],
  ['ESTADO con dos sentencias', 'st', 'ORDER BY orden;', 'ORDER BY orden;\nSELECT 1;', 'estadoUnaSentencia'],
  ['ESTADO sin exigir lector único del cierre', 'st', "m.lectores_cierre = 'directory_territory_scope'", "m.lectores_cierre <> ''", 'estadoClasifica'],
  ['smoke POST con COMMIT', 'po', 'ROLLBACK;', 'COMMIT;', 'postSmokeReadOnly'],
  ['smoke POST escribe', 'po', "SET LOCAL statement_timeout = '60s';", "SET LOCAL statement_timeout = '60s';\nUPDATE public.clinics SET name = name;", 'postSmokeReadOnly'],
  ['smoke POST sin Seq Scan del cierre', 'po', 'Seq Scan sobre el cierre', 'x', 'postSmokePlanesYConsumo'],
  ['smoke lee auth.users', 'st', 'UNION ALL SELECT 10, ', "UNION ALL SELECT 11, 'x', (SELECT count(*)::text FROM auth.users)\nUNION ALL SELECT 10, ", 'readOnlySinAuthUsers'],
  ['runbook sin cadena de rollback', 'rbk', 'frontend F3E-3B → s7_97 → frontend F3E-2 → s7_96 → s7_95 → s7_94 → s7_93 R2 → verificar → s7_92', 'x', 'runbook'],
];
for (const [nombre, k, de, a, regla] of M) {
  if (!T0[k].includes(de)) { check(`mutación «${nombre}»: ancla presente`, false, true); continue; }
  const T = { ...T0, [k]: T0[k].replace(de, a) };
  let r; try { r = R[regla](T) === true; } catch { r = false; }
  check(`mutación «${nombre}» rompe ${regla}`, r, false);
}

console.log(`\nRESULTADO check-s7_97: ${pass}/${pass + fail} ok${fail ? ` · ${fail} FAIL` : ''}`);
process.exit(fail ? 1 : 0);
