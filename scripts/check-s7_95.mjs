#!/usr/bin/env node
/**
 * check-s7_95.mjs — F3E-0 · M0.5: país atestado por el owner para 36 clínicas del lote Importar_100.
 *
 * s7_95 asigna country_id = SV (sin territorio ni legacy) a las 36 clínicas del conjunto medido en
 * el preflight H, desactivando los triggers de clinics SOLO dentro de la transacción. Sin tocar la
 * base hay que demostrar:
 *   · las constantes del preflight H (lista, huellas, directorio, autor, seguridad) son idénticas en
 *     PRE, GUARDA, rollback y bloques read-only, y la lista literal reproduce sus huellas;
 *   · PRE y GUARDA ejecutan exactamente las mismas comprobaciones;
 *   · el orden de la transacción: locks de clinics y doctors → GUARDA → DISABLE → BACKFILL →
 *     ENABLE → POST → COMMIT, sin DDL persistente, sin GRANT/REVOKE, sin funciones ni tablas;
 *   · la única escritura de datos es country_id de la lista (ni legacy, ni territorio, ni
 *     updated_at) más una fila de auditoría por clínica, sin datos personales;
 *   · SV se resuelve por iso_alpha2, nunca por id numérico; el teléfono del owner no aparece;
 *   · el POST cubre runtime, seguridad, objetos, datos, invariante v2, auditoría y directorio;
 *   · el rollback solo desactiva trg_clinics_updated_at, se niega ante cambios y verifica;
 *   · los bloques read-only no escriben y son una sola sentencia;
 *   · reglas del SQL Editor (sin $…$ en comentarios, sin DDL nombrado);
 *   · mutaciones con expectativa INVERTIDA: cada regla detecta su violación.
 *
 *   node scripts/check-s7_95.mjs
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

console.log('\ncheck-s7_95 — F3E-0 · M0.5 · país atestado\n');

const leerLF = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');
const P = {
  mig: path.join('migrations', 's7_95_geo_foundation_3e0_attested_country_backfill.sql'),
  rb: path.join('docs', 'rollbacks', 's7_95_rollback.sql'),
  st: path.join('docs', 'smokes', 's7_95_state_readonly.sql'),
  po: path.join('docs', 'smokes', 's7_95_post_verification_readonly.sql'),
  inv: path.join('docs', 'smokes', 's7_95_territorial_invariant_readonly.sql'),
};
const T = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, leerLF(p)]));

const sinComentarios = (sql) => sql.split('\n').map((l) => { const i = l.indexOf('--'); return i === -1 ? l : l.slice(0, i); }).join('\n');
const sinLiterales = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
const bloque = (s, tag) => { const a = s.indexOf(`DO $${tag}$`), b = s.indexOf(`END $${tag}$;`); return a === -1 || b === -1 ? '' : s.slice(a, b + `END $${tag}$;`.length); };
const ocurrencias = (s, needle) => s.split(needle).length - 1;
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ── Constantes del preflight H de producción (2026-09-15), aprobadas por el owner ──
const C = {
  n: '36', lote: '100',
  sha_pares: '68ff3c1509311c975e22b1df77990622a7247a7a1840e9c76ae7833062f7303c',
  sha_clinicas: '783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8',
  sha_estado: 'e12195c655220975ce87fabc6c4e8875bfa4ef59427c018a2f26532051819a18',
  c2: '7c823ad1f5c30fc7a2b5a33fe62c68a7',
  ini: '2026-05-21 13:58:28.852053-06', fin: '2026-05-21 13:59:37.125681-06',
  publicados: '46|9|37', visibles: '43|8|35', publicados_post: '46|45|1', visibles_post: '43|42|1',
  owner: '739cac58-4ad2-4efe-9fbf-91921e208b8f',
  relacl: '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}|true|false',
  policies: '20ad37b9',
  escritores: 'admin_approve_and_create_doctor,admin_create_seed_doctor,admin_update_doctor_clinic',
  fn: "ARRAY['d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202']",
  casoD: '96dffdc8-0764-4adb-a4eb-3a7a198cf51d',
};

// ═══════════════════════════════════════════════════════════
console.log('0 · archivos y reglas del SQL Editor');
const migs = fs.readdirSync('migrations').filter((f) => f.endsWith('.sql'));
check('s7_95 es la migración 116 en orden', [...migs].sort().indexOf(path.basename(P.mig)) + 1, 116);
const rastreado = (p) => { try { execSync(`git ls-files --error-unmatch "${p}"`, { stdio: 'ignore' }); return true; } catch { return false; } };
for (const k of ['rb', 'st', 'po', 'inv']) {
  const p = P[k].split(path.sep).join('/');
  if (rastreado(p)) check(`rastreado por git: ${p}`, true, true);
  else console.log(`  nota ${p} aún no está rastreado: la regla *.sql de .gitignore exige git add -f al preparar el PR`);
}
const sinDolarEnComentarios = (s) => s.split('\n').filter((l) => /^\s*--/.test(l) && l.includes('$')).length === 0;
const RE_DDL_NOMBRE = /\b(create|drop)\s+(or\s+replace\s+)?(unique\s+)?(temp(orary)?\s+)?(table|view|function|trigger|index|policy|rule|sequence|type|schema)\s+/gi;
const reglaDdl = (s) => (s.match(RE_DDL_NOMBRE) || []).length === 0;
const reglaSinPermisos = (s) => !/\b(GRANT|REVOKE|SECURITY\s+DEFINER|OWNER\s+TO)\b/i.test(sinLiterales(sinComentarios(s)));
for (const [k, s] of Object.entries(T)) {
  check(`sin etiquetas $…$ en comentarios (${k})`, sinDolarEnComentarios(s), true);
  check(`regla 3: sin DDL con nombre de objeto, ni siquiera en comentarios o literales (${k})`, reglaDdl(s), true);
  check(`sin GRANT, REVOKE, SECURITY DEFINER ni OWNER TO (${k})`, reglaSinPermisos(s), true);
  check(`el teléfono del owner no aparece (${k})`, /7862\D?7694|78627694/.test(s), false);
}

// ═══════════════════════════════════════════════════════════
console.log('\n1 · lista literal y constantes');
const literales = (s) => (s.match(/^    '[0-9a-f-]{36}\|[0-9a-f-]{36}(?: ; )?'/gm) || []).map((l) => l.trim().slice(1, -1).replace(/ ; $/, ''));
const reglaLista = (s) => {
  const l = literales(s); if (l.length === 0) return false;
  const n = Number(C.n), bloques = l.length / n;
  if (!Number.isInteger(bloques)) return false;
  for (let b = 0; b < bloques; b++) {
    const x = l.slice(b * n, (b + 1) * n);
    if (sha(x.join('\n')) !== C.sha_pares) return false;
    if (new Set(x.map((p) => p.split('|')[0])).size !== n || new Set(x.map((p) => p.split('|')[1])).size !== n) return false;
    if (sha(x.map((p) => p.split('|')[1]).sort().join('\n')) !== C.sha_clinicas) return false;
  }
  return true;
};
check('migración: la lista literal (PRE y GUARDA) son 36 pares distintos con las huellas 68ff3c15… y 783399dc…', reglaLista(T.mig) && literales(T.mig).length === 72, true);
check('rollback: misma lista literal', reglaLista(T.rb) && literales(T.rb).length === 36, true);
check('ESTADO y POST: misma lista literal', reglaLista(T.st) && reglaLista(T.po) && literales(T.st).length === 36 && literales(T.po).length === 36, true);
const constante = (b, nombre) => { const m = b.match(new RegExp(`\\b${nombre}\\s+CONSTANT [a-z\\[\\]]+ := ([^;]+);`)); return m ? m[1].trim() : null; };
const q = (v) => `'${v}'`;
const reglaConstantes = (s) => ['PRE', 'GUARDA'].every((t) => { const b = bloque(s, t);
  return constante(b, 'v_n') === C.n && constante(b, 'v_lote') === C.lote && constante(b, 'v_sha_pares') === q(C.sha_pares)
    && constante(b, 'v_sha_clinicas') === q(C.sha_clinicas) && constante(b, 'v_sha_estado') === q(C.sha_estado) && constante(b, 'v_huella_c2') === q(C.c2)
    && constante(b, 'v_ventana_ini') === q(C.ini) && constante(b, 'v_ventana_fin') === q(C.fin)
    && constante(b, 'v_publicados') === q(C.publicados) && constante(b, 'v_visibles') === q(C.visibles)
    && constante(b, 'v_publicados_post') === q(C.publicados_post) && constante(b, 'v_visibles_post') === q(C.visibles_post)
    && constante(b, 'v_owner') === q(C.owner) && constante(b, 'v_relacl') === q(C.relacl) && constante(b, 'v_policies_prefijo') === q(C.policies)
    && constante(b, 'v_escritores') === q(C.escritores) && constante(b, 'v_fn_md5') === C.fn; });
check('PRE y GUARDA: todas las constantes son las del preflight H', reglaConstantes(T.mig), true);
const cuerpoChecks = (s, t) => { const b = bloque(s, t); const i = b.indexOf('\nBEGIN\n'); const f = t === 'PRE' ? b.indexOf("  RAISE NOTICE 's7_95 PRE OK") : b.indexOf('  -- Parametros para BACKFILL y POST');
  return i === -1 || f === -1 ? null : b.slice(i, f).split(`s7_95 ${t}:`).join('s7_95 X:').trim(); };
const reglaPreIgualGuarda = (s) => { const a = cuerpoChecks(s, 'PRE'), b = cuerpoChecks(s, 'GUARDA'); return !!a && a === b && a.length > 5000; };
check('PRE y GUARDA ejecutan exactamente las mismas comprobaciones (texto idéntico salvo el prefijo del mensaje)', reglaPreIgualGuarda(T.mig), true);
const reglaRbConstantes = (s) => { const b = bloque(s, 'PREVIA');
  return constante(b, 'v_n') === C.n && constante(b, 'v_sha_pares') === q(C.sha_pares) && constante(b, 'v_sha_estado') === q(C.sha_estado) && constante(b, 'v_owner') === q(C.owner) && constante(b, 'v_fn_md5') === C.fn; };
check('rollback: constantes n, huellas, autor y md5 de la función idénticas', reglaRbConstantes(T.rb), true);
const reglaSmokeConstantes = () => T.po.includes(q(C.sha_estado)) && T.po.includes(q(C.c2)) && T.po.includes(q(C.sha_pares)) && T.po.includes(q(C.owner))
  && T.po.includes(q(C.publicados_post)) && T.po.includes(q(C.visibles_post)) && T.po.includes(q(C.casoD)) && T.po.includes(q(C.relacl)) && T.po.includes(q(C.escritores))
  && T.inv.includes(q(C.owner)) && T.inv.includes(C.sha_clinicas);
check('VERIFICACIÓN POST e invariante: huellas, autor, directorio 46|45|1 · 43|42|1 y caso D esperados', reglaSmokeConstantes(), true);
const reglaSvPorIso = (s) => bloque(s, 'PRE').includes("SELECT co.id INTO STRICT v_sv FROM public.countries co WHERE co.iso_alpha2 = 'SV';")
  && bloque(s, 'GUARDA').includes("SELECT co.id INTO STRICT v_sv FROM public.countries co WHERE co.iso_alpha2 = 'SV';")
  && !/country_id\s*=\s*\d/.test(sinComentarios(s)) && !/v_sv\s*(smallint)?\s*:=\s*\d/.test(s);
check('SV se resuelve por iso_alpha2 con INTO STRICT; ningún id numérico de país', reglaSvPorIso(T.mig), true);

// ═══════════════════════════════════════════════════════════
console.log('\n2 · orden de la transacción');
const ex = sinComentarios(T.mig);
check('un único BEGIN; y un único COMMIT;', `${(ex.match(/^BEGIN;/gm) || []).length},${(ex.match(/^COMMIT;/gm) || []).length}`, '1,1');
check('nada después del COMMIT', ex.slice(ex.indexOf('\nCOMMIT;') + '\nCOMMIT;'.length).trim(), '');
const PASOS = [
  'END $PRE$;', '\nBEGIN;', "SET LOCAL lock_timeout = '5s';", 'LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;', 'LOCK TABLE public.doctors IN SHARE ROW EXCLUSIVE MODE;',
  'DO $GUARDA$', 'END $GUARDA$;',
  'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_territory_sync;', 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;',
  'DO $BACKFILL$', 'END $BACKFILL$;',
  'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_territory_sync;', 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;',
  'DO $POST$', 'END $POST$;', '\nCOMMIT;',
];
const reglaOrden = (s) => { const e = sinComentarios(s); const p = PASOS.map((x) => (ocurrencias(e, x) === 1 ? e.indexOf(x) : -1)); return p.every((x, i) => x >= 0 && (i === 0 || x > p[i - 1])); };
for (const x of PASOS) check(`aparece exactamente una vez: ${x.trim()}`, ocurrencias(ex, x), 1);
check('orden: PRE → BEGIN → lock_timeout → LOCK clinics → LOCK doctors → GUARDA → DISABLE ×2 → BACKFILL → ENABLE ×2 → POST → COMMIT', reglaOrden(T.mig), true);
check('lock_timeout inmediatamente después del BEGIN', /\nBEGIN;\n\nSET LOCAL lock_timeout = '5s';\n/.test(ex), true);
const reglaSoloAlters = (s) => { const a = sinLiterales(sinComentarios(s)).match(/\bALTER\s+\w+[^;]*;/gi) || []; return a.length === 4 && a.every((x) => /^ALTER TABLE public\.clinics (DISABLE|ENABLE) TRIGGER trg_clinics_(territory_sync|updated_at);$/.test(x)); };
check('los únicos ALTER son los 4 DISABLE/ENABLE de los dos triggers de clinics', reglaSoloAlters(T.mig), true);
const reglaSinOtrasSentencias = (s) => !/\b(DELETE|TRUNCATE|ANALYZE|VACUUM|CLUSTER|REINDEX|COPY|EXECUTE\s+format|SET\s+ROLE|session_replication_role)\b/i.test(sinLiterales(sinComentarios(s)));
check('sin DELETE, TRUNCATE, SQL dinámico, SET ROLE ni session_replication_role', reglaSinOtrasSentencias(T.mig), true);

// ═══════════════════════════════════════════════════════════
console.log('\n3 · escritura de datos');
const UPDATE_M = 'UPDATE public.clinics c\n     SET country_id = v_sv\n   WHERE c.id = ANY (v_lista)\n     AND c.department_id IS NULL AND c.municipality_id IS NULL\n     AND c.country_id IS NULL AND c.territory_unit_id IS NULL;\n  GET DIAGNOSTICS v_i = ROW_COUNT;\n  IF v_i <> v_n THEN';
const reglaUpdate = (s) => { const b = sinComentarios(bloque(s, 'BACKFILL')); return b.includes(UPDATE_M) && (sinLiterales(sinComentarios(s)).match(/\bUPDATE\s+public\./gi) || []).length === 1; };
check('BACKFILL: un único UPDATE, solo country_id = v_sv, solo la lista y solo S0, con ROW_COUNT = v_n', reglaUpdate(T.mig), true);
const reglaNoEscribeOtrasColumnas = (s) => !/SET\s[^;]*\b(department_id|municipality_id|territory_unit_id|updated_at|owner_id)\s*=/i.test(sinLiterales(sinComentarios(s)));
check('no asigna legacy, territorio, updated_at ni dueño', reglaNoEscribeOtrasColumnas(T.mig), true);
const CLAVES = ['batch', 'batch_membership', 'country_id', 'country_iso', 'edited_via', 'evidence', 'migration', 'source', 'territory', 'territory_unit_id'];
const clavesAudit = (s) => { const b = bloque(s, 'BACKFILL'); const i = b.indexOf('jsonb_build_object(\n'); if (i === -1) return null;
  const f = b.indexOf('    FROM unnest(v_lista) AS x(id);', i); return [...b.slice(i, f).matchAll(/^\s+'([a-z_]+)',/gm)].map((m) => m[1]).sort(); };
const reglaAuditoria = (s) => { const b = sinComentarios(bloque(s, 'BACKFILL'));
  return (sinLiterales(sinComentarios(s)).match(/\bINSERT\s+INTO\s+(\S+)/gi) || []).join() === 'INSERT INTO public.audit_log'
    && b.includes("  SELECT v_owner, 'update', 'clinics', x.id,")
    && b.includes("jsonb_build_object('country_id', NULL, 'territory_unit_id', NULL, 'department_id', NULL, 'municipality_id', NULL)")
    && JSON.stringify(clavesAudit(s)) === JSON.stringify(CLAVES)
    && b.includes("'edited_via', 'owner_attestation_f3e0'") && b.includes("'source', 'owner_attestation'") && b.includes("'batch', 'Importar_100'")
    && b.includes("'batch_membership', 'measured'") && b.includes("'territory', 'unknown'")
    && b.includes("RAISE EXCEPTION 's7_95 BACKFILL: % filas de auditoria, se esperaban %', v_i, v_n;"); };
check('auditoría: único INSERT, en audit_log, autor v_owner, una fila por clínica, procedencia explícita y claves exactas sin datos personales', reglaAuditoria(T.mig), true);
check('las claves de auditoría no incluyen datos personales', CLAVES.some((k) => /name|phone|email|address|license|jvpm|dui|document|tel/i.test(k)), false);

// ═══════════════════════════════════════════════════════════
console.log('\n4 · GUARDA y POST');
const GUARDA_MSG = ['la lista literal no es la del preflight H', 'la huella de la lista de clinicas no es la del preflight H', 'la ventana del lote tiene',
  'el conjunto vivo no coincide con la lista', 'S0 de la lista | clinicas compartidas', 'el estado del conjunto cambio desde el preflight H',
  'la huella C2 de clinics cambio desde el preflight H', 'ya existen % clinicas con pais sin legacy', 'el directorio cambio desde el preflight H',
  'el perfil autor no existe, no es admin o no esta activo', 'el id de SV no coincide con el pais de las clinicas S1', 'triggers de clinics inesperados',
  'la definicion de trg_clinics_territory_sync no es la de s7_92', '_clinics_territory_sync no es la de s7_92', 'ACL o RLS de clinics cambio',
  'las policies de clinics cambiaron', 'escritores de clinics inesperados', 'consumidores o escritores nuevos del modelo territorial',
  'no puede escribir en audit_log', 's7_95 ya esta aplicada'];
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tieneRaise = (b, pref, m) => new RegExp(`RAISE EXCEPTION '${esc(pref)}: (% )?${esc(m)}`).test(b);
const reglaGuarda = (s) => GUARDA_MSG.every((m) => tieneRaise(sinComentarios(bloque(s, 'GUARDA')), 's7_95 GUARDA', m));
check(`GUARDA: las ${GUARDA_MSG.length} comprobaciones del preflight H, con RAISE`, reglaGuarda(T.mig), true);
const POST_MSG = ['_clinics_territory_sync cambio', 'los triggers de clinics cambiaron (OID, definicion o estado)', 'los triggers no quedaron en modo normal',
  'ACL, RLS, policies o privilegios de columna de clinics cambiaron', 'aparecieron o cambiaron objetos', 'cambio alguna columna distinta de country_id',
  'cambio alguna clinica fuera de la lista', 'de % clinicas en S2 SV', 'la C2 reconstruida no es la del preflight H', 'anomalias del invariante territorial v2',
  'auditoria inesperada', 'directorio inesperado tras el backfill', 'los publicados que siguen sin pais no son los previstos'];
const reglaPost = (s) => POST_MSG.every((m) => tieneRaise(sinComentarios(bloque(s, 'POST')), 's7_95 POST', m));
check(`POST: las ${POST_MSG.length} comprobaciones, con RAISE`, reglaPost(T.mig), true);
const reglaPostAuditClaves = (s) => bloque(s, 'POST').includes(`= ARRAY[${CLAVES.map((k) => `'${k}'`).join(', ')}]`) && bloque(s, 'POST').includes("a.id > current_setting('s7_95.audit_max')::bigint");
check('POST: auditoría acotada a las filas nuevas y con el conjunto exacto de claves', reglaPostAuditClaves(T.mig), true);

// ═══════════════════════════════════════════════════════════
console.log('\n5 · rollback');
const exRb = sinComentarios(T.rb);
const PASOS_RB = ['\nBEGIN;', "SET LOCAL lock_timeout = '5s';", 'LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;', 'LOCK TABLE public.doctors IN SHARE ROW EXCLUSIVE MODE;',
  'DO $PREVIA$', 'END $PREVIA$;', 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;', 'DO $REVIERTE$', 'END $REVIERTE$;',
  'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;', 'DO $VERIFICA$', 'END $VERIFICA$;', '\nCOMMIT;'];
const reglaOrdenRb = (s) => { const e = sinComentarios(s); const p = PASOS_RB.map((x) => (ocurrencias(e, x) === 1 ? e.indexOf(x) : -1)); return p.every((x, i) => x >= 0 && (i === 0 || x > p[i - 1])); };
check('rollback: BEGIN → lock_timeout → LOCKs → PREVIA → DISABLE updated_at → REVIERTE → ENABLE → VERIFICA → COMMIT', reglaOrdenRb(T.rb), true);
const reglaRbSyncActiva = (s) => !/trg_clinics_territory_sync;/.test(sinComentarios(s).replace(/tgname = 'trg_clinics_territory_sync'/g, '')) && (sinLiterales(sinComentarios(s)).match(/\bALTER\s/gi) || []).length === 2;
check('rollback: la sincronización de s7_92 sigue ACTIVA (solo se desactiva trg_clinics_updated_at)', reglaRbSyncActiva(T.rb), true);
const reglaRbUpdate = (s) => sinComentarios(bloque(s, 'REVIERTE')).includes('UPDATE public.clinics c\n     SET country_id = NULL\n   WHERE c.id = ANY (v_lista)\n     AND c.country_id = v_sv AND c.territory_unit_id IS NULL\n     AND c.department_id IS NULL AND c.municipality_id IS NULL;')
  && (sinLiterales(sinComentarios(s)).match(/\bUPDATE\s+public\./gi) || []).length === 1 && !/\bDELETE\b/i.test(sinLiterales(sinComentarios(s)));
check('rollback: un único UPDATE, country_id = NULL solo en S2 SV de la lista; nunca borra auditoría', reglaRbUpdate(T.rb), true);
const RB_MSG = ['la lista literal no es la de s7_95', 'no puede escribir en audit_log', 'auditoria neta (aplicacion - reversion)', 'clinicas siguen en S2 SV — no se revierte',
  'el estado de las clinicas cambio despues de s7_95', 'triggers de clinics inesperados', '_clinics_territory_sync no es la de s7_92', 'consumidores del modelo territorial'];
const reglaRbPrevia = (s) => RB_MSG.every((m) => sinComentarios(bloque(s, 'PREVIA')).includes(m));
check('rollback PREVIA: lista, auditoría neta, S2, huella del estado, runtime, consumidores y permiso de auditoría', reglaRbPrevia(T.rb), true);
const RBV_MSG = ['la funcion o los triggers de clinics cambiaron', 'volvieron a S0', 'el estado no volvio exactamente al del preflight H', 'cambio alguna columna distinta de country_id',
  'cambio alguna clinica fuera de la lista', 'filas de auditoria de reversion'];
const reglaRbVerifica = (s) => RBV_MSG.every((m) => sinComentarios(bloque(s, 'VERIFICA')).includes(m));
check('rollback VERIFICA: runtime, S0, estado del preflight H, resto de filas y auditoría de reversión', reglaRbVerifica(T.rb), true);

// ═══════════════════════════════════════════════════════════
console.log('\n6 · bloques read-only');
const reglaReadOnly = (s) => { const e = sinLiterales(sinComentarios(s));
  return !/\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|CREATE|DROP|COPY|DO)\b/i.test(e) && e.trim().startsWith('WITH') && ocurrencias(e, ';') === 1 && e.trim().endsWith(';'); };
for (const k of ['st', 'po', 'inv']) check(`${k}: una sola sentencia WITH … ; y ninguna escritura`, reglaReadOnly(T[k]), true);
const reglaEstado = (s) => ["'S7_95 NO APLICADA'", "'S7_95 APLICADA COMPLETA'", "'S7_95 REVERTIDA'", 'MIXTO', 'ANOMALIA — triggers de clinics no normales'].every((x) => s.includes(x))
  && s.includes('m.aud_aplicacion - m.aud_reversion = m.n');
check('ESTADO: clasifica NO APLICADA / APLICADA / evolucionada / REVERTIDA / MIXTO / ANOMALIA con auditoría neta', reglaEstado(T.st), true);
const reglaZ = (s) => s.includes("SELECT 'Z resultado', 99,") && s.includes('(SELECT count(*) FROM res WHERE ok = false) = 0');
check('POST e invariante: fila Z con el número de fallos', reglaZ(T.po) && reglaZ(T.inv), true);
const reglaInvariante = (s) => s.includes("lista AS MATERIALIZED (SELECT clinic_id FROM neto WHERE n = 1)") && s.includes("THEN 'S0'") && s.includes("THEN 'S1'") && s.includes("THEN 'S2'")
  && s.includes("ELSE 'ANOMALIA'") && s.includes('pasaron a S0 (riesgo residual aceptado)') && s.includes('gate F3E-2');
check('invariante v2: S0/S1/S2 por auditoría neta, S2→S0 informativo (no anomalía) y gate de F3E-2', reglaInvariante(T.inv), true);
// Operación inválida: saltarse el rollback de s7_95. Los verificadores no pueden depender del runtime de s7_92.
const reglaSinRuntime = (s) => { const e = sinComentarios(s).split("to_regprocedure('public._territory_from_legacy_sv(text, text)')").join('');
  return !/_territory_from_legacy_sv\s*\(/.test(e) && !/'::regprocedure/.test(e); };
for (const k of ['st', 'po', 'inv']) check(`${k}: no llama al resolver ni usa ::regprocedure (clasifica aunque falte el runtime de s7_92)`, reglaSinRuntime(T[k]), true);
const reglaInvalidaEstado = (s) => { const e = sinComentarios(s);
  return e.includes("WHEN NOT m.runtime_s7_92 AND m.aud_aplicacion - m.aud_reversion > 0\n           THEN 'OPERACION INVALIDA")
    && e.indexOf("'OPERACION INVALIDA") < e.indexOf("'ANOMALIA — triggers de clinics no normales") && e.indexOf("'OPERACION INVALIDA") < e.indexOf("'S7_95 NO APLICADA'")
    && e.includes("to_regprocedure('public._territory_from_legacy_sv(text, text)') IS NOT NULL"); };
check('ESTADO: OPERACION INVALIDA (s7_95 aplicada sin runtime de s7_92) evaluada antes que cualquier otro estado', reglaInvalidaEstado(T.st), true);
const reglaInvalidaInv = (s) => sinComentarios(s).includes("'OPERACION INVALIDA: s7_95 sigue aplicada sin runtime de s7_92 (rollback de s7_92 fuera de orden)',\n         (CASE WHEN NOT (SELECT presente FROM rt) AND (SELECT count(*) FROM lista) > 0 THEN 'INVALIDA' ELSE 'no' END), 'no'")
  && s.includes('Orden obligatorio de reversion: s7_95 -> s7_94 -> s7_93 R2 -> verificar -> s7_92.');
check('invariante: fila de OPERACION INVALIDA que cuenta en Z y orden obligatorio documentado', reglaInvalidaInv(T.inv), true);
const leerRunbook = leerLF(path.join('docs', 'OWNER_S7_95_APPLY.md'));
const reglaRunbookOrden = (s) => s.includes('**s7_95 → s7_94 → s7_93 R2 → verificar → s7_92**') && s.includes('OPERACION INVALIDA') && s.includes('el rollback histórico de `s7_92` **no se niega** si s7_95 sigue aplicada');
check('runbook: orden obligatorio, hallazgo del rollback de s7_92 y OPERACION INVALIDA', reglaRunbookOrden(leerRunbook), true);

// ═══════════════════════════════════════════════════════════
console.log('\n7 · mutaciones (expectativa invertida)');
const R = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutación no aplicable: ${a.slice(0, 80)}`); return s.split(a).join(b); };
const MUT = [
  ['comentario con etiqueta $PRE$', 'mig', (s) => R(s, '-- Runbook: docs/OWNER_S7_95_APPLY.md.', '-- Runbook DO $PRE$'), sinDolarEnComentarios],
  ['DDL con nombre en un literal', 'po', (s) => R(s, "'(info)'\n  UNION ALL SELECT 'E directorio', 54", "'CREATE TABLE public.zz (id int)'\n  UNION ALL SELECT 'E directorio', 54"), reglaDdl],
  ['GRANT añadido', 'mig', (s) => R(s, '\nCOMMIT;', '\nGRANT SELECT ON public.clinics TO anon;\nCOMMIT;'), reglaSinPermisos],
  ['un par de la lista cambiado en GUARDA', 'mig', (s) => { const i = s.indexOf('DO $GUARDA$'); return s.slice(0, i) + s.slice(i).replace("'01eb36db-1ccd-4a38-b54c-726847fe52ec|", "'01eb36db-1ccd-4a38-b54c-726847fe52ed|"); }, reglaLista],
  ['un par duplicado en el rollback', 'rb', (s) => s.replace(/^    '05ae4d89[^\n]*\n/m, (l) => l.replace('05ae4d89-9a42-4136-be51-de5256ec3115', '01eb36db-1ccd-4a38-b54c-726847fe52ec')), reglaLista],
  ['huella C2 distinta en PRE', 'mig', (s) => R(s, `v_huella_c2        CONSTANT text := '${C.c2}';\n  v_ventana_ini`, `v_huella_c2        CONSTANT text := '00000000000000000000000000000000';\n  v_ventana_ini`).replace(/(DO \$GUARDA\$[\s\S]*?)'00000000000000000000000000000000'/, `$1'${C.c2}'`), reglaConstantes],
  ['autor distinto en GUARDA', 'mig', (s) => { const i = s.indexOf('DO $GUARDA$'); return s.slice(0, i) + s.slice(i).replace(`'${C.owner}'`, "'00000000-0000-0000-0000-000000000000'"); }, reglaConstantes],
  ['PRE sin la comprobación de clínicas compartidas', 'mig', (s) => { const i = s.indexOf('DO $GUARDA$'); return s.slice(0, i).replace("d.id NOT IN (SELECT l.d FROM l))", "false)") + s.slice(i); }, reglaPreIgualGuarda],
  ['SV por id numérico', 'mig', (s) => R(s, "  v_sv  smallint;\n  v_i   bigint;\n  v_txt text;\nBEGIN\n  IF current_user <> 'postgres' THEN\n    RAISE EXCEPTION 's7_95 PRE", "  v_sv  smallint := 1;\n  v_i   bigint;\n  v_txt text;\nBEGIN\n  IF current_user <> 'postgres' THEN\n    RAISE EXCEPTION 's7_95 PRE"), reglaSvPorIso],
  ['LOCK de doctors omitido', 'mig', (s) => R(s, 'LOCK TABLE public.doctors IN SHARE ROW EXCLUSIVE MODE;\n', ''), reglaOrden],
  ['ENABLE del trigger de sincronización después del POST', 'mig', (s) => R(R(s, 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_territory_sync;\n', ''), '\nCOMMIT;', '\nALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_territory_sync;\nCOMMIT;'), reglaOrden],
  ['ALTER adicional (ENABLE ALWAYS)', 'mig', (s) => R(s, 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;\n', 'ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;\nALTER TABLE public.clinics ENABLE ALWAYS TRIGGER trg_clinics_territory_sync;\n'), reglaSoloAlters],
  ['session_replication_role en lugar de DISABLE', 'mig', (s) => R(s, "SET LOCAL lock_timeout = '5s';", "SET LOCAL lock_timeout = '5s';\nSET LOCAL session_replication_role = replica;"), reglaSinOtrasSentencias],
  ['UPDATE sin filtro de lista', 'mig', (s) => R(s, '   WHERE c.id = ANY (v_lista)\n     AND c.department_id IS NULL AND c.municipality_id IS NULL\n     AND c.country_id IS NULL', '   WHERE c.department_id IS NULL AND c.municipality_id IS NULL\n     AND c.country_id IS NULL'), reglaUpdate],
  ['UPDATE que escribe territorio', 'mig', (s) => R(s, '     SET country_id = v_sv\n', '     SET country_id = v_sv, territory_unit_id = NULL\n'), reglaNoEscribeOtrasColumnas],
  ['UPDATE que escribe updated_at', 'mig', (s) => R(s, '     SET country_id = v_sv\n', '     SET country_id = v_sv, updated_at = now()\n'), reglaNoEscribeOtrasColumnas],
  ['auditoría con clave de nombre', 'mig', (s) => R(s, "           'territory', 'unknown',", "           'territory', 'unknown',\n           'full_name', 'x',"), reglaAuditoria],
  ['auditoría con autor distinto de v_owner', 'mig', (s) => R(s, "  SELECT v_owner, 'update', 'clinics', x.id,", "  SELECT gen_random_uuid(), 'update', 'clinics', x.id,"), reglaAuditoria],
  ['GUARDA sin la comprobación de permiso de auditoría', 'mig', (s) => { const i = s.indexOf('DO $GUARDA$'); return s.slice(0, i) + s.slice(i).replace("RAISE EXCEPTION 's7_95 GUARDA: % no puede escribir en audit_log", "RAISE NOTICE 's7_95 GUARDA: % no puede escribir en audit_log"); }, reglaGuarda],
  ['POST sin la C2 reconstruida', 'mig', (s) => R(s, "RAISE EXCEPTION 's7_95 POST: la C2 reconstruida no es la del preflight H (%)', v_txt;", "RAISE NOTICE 'C2 %', v_txt;"), reglaPost],
  ['POST sin exigir triggers normales', 'mig', (s) => R(s, "RAISE EXCEPTION 's7_95 POST: los triggers no quedaron en modo normal (%)', v_txt;", 'NULL;'), reglaPost],
  ['POST sin acotar la auditoría a filas nuevas', 'mig', (s) => R(s, "a.id > current_setting('s7_95.audit_max')::bigint", 'true'), reglaPostAuditClaves],
  ['rollback que desactiva la sincronización', 'rb', (s) => R(s, 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;\n', 'ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;\nALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_territory_sync;\n'), reglaRbSyncActiva],
  ['rollback que borra la auditoría', 'rb', (s) => R(s, "ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;", "ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;\nDELETE FROM public.audit_log WHERE new_data ->> 'migration' = 's7_95';"), reglaRbUpdate],
  ['rollback sin la huella del estado', 'rb', (s) => R(s, "RAISE EXCEPTION 'rollback s7_95: el estado de las clinicas cambio despues de s7_95 (%) — no se revierte', v_txt;", 'NULL;'), reglaRbPrevia],
  ['rollback sin VERIFICA del resto de filas', 'rb', (s) => R(s, "RAISE EXCEPTION 'rollback s7_95 VERIFICA: cambio alguna clinica fuera de la lista';", 'NULL;'), reglaRbVerifica],
  ['smoke POST que escribe', 'po', (s) => R(s, "ORDER BY seccion, orden;", "ORDER BY seccion, orden;\nUPDATE public.clinics SET name = name;"), reglaReadOnly],
  ['ESTADO con auditoría absoluta en lugar de neta', 'st', (s) => R(s, 'm.aud_aplicacion - m.aud_reversion = m.n', 'm.aud_aplicacion = m.n'), reglaEstado],
  ['invariante con S2 por EXCEPT (no neto)', 'inv', (s) => R(s, 'lista AS MATERIALIZED (SELECT clinic_id FROM neto WHERE n = 1)', 'lista AS MATERIALIZED (SELECT clinic_id FROM neto)'), reglaInvariante],
  ['invariante que vuelve a llamar al resolver', 'inv', (s) => R(s, 'FROM deriv c\n),', 'FROM deriv c\n  LEFT JOIN LATERAL public._territory_from_legacy_sv(c.department_id, c.municipality_id) t ON true\n),'), reglaSinRuntime],
  ['ESTADO con ::regprocedure', 'st', (s) => R(s, "WHERE p.oid = to_regprocedure('public._clinics_territory_sync()')", "WHERE p.oid = 'public._clinics_territory_sync()'::regprocedure"), reglaSinRuntime],
  ['ESTADO sin OPERACION INVALIDA', 'st', (s) => R(s, "WHEN NOT m.runtime_s7_92 AND m.aud_aplicacion - m.aud_reversion > 0", "WHEN false"), reglaInvalidaEstado],
  ['invariante sin la fila de OPERACION INVALIDA', 'inv', (s) => R(s, "THEN 'INVALIDA' ELSE 'no' END), 'no'", "THEN 'INVALIDA' ELSE 'no' END), '(info)'"), reglaInvalidaInv],
  ['teléfono del owner en un comentario', 'mig', (s) => R(s, '-- Runbook: docs/OWNER_S7_95_APPLY.md.', '-- Runbook: docs/OWNER_S7_95_APPLY.md. Autor 50378627694'), (x) => !/7862\D?7694|78627694/.test(x)],
];
for (const [nombre, k, f, regla] of MUT) {
  check(`control: la regla de «${nombre}» pasa sobre el original`, regla(T[k]), true);
  check(`mutación detectada: ${nombre}`, regla(f(T[k])), false);
}

console.log(`\nRESULTADO check-s7_95: ${pass}/${pass + fail} ok${fail ? ` · ${fail} FAIL` : ''}`);
process.exit(fail ? 1 : 0);
