#!/usr/bin/env node
/**
 * check-s7_78.mjs — ADMIN-DOCTOR-EXPORT-P0
 *
 * Guardas ESTÁTICAS sobre `migrations/s7_78_admin_doctor_export.sql`, su
 * rollback y el frontend. No toca la base: da el mismo resultado antes y
 * después del apply.
 *
 * Lo que persigue: que el export REUTILICE el universo del listado en vez de
 * duplicar el predicado, que la allowlist no deje escapar nada protegido, que
 * la auditoría no guarde PII, y que el frente de pacientes quede intacto.
 *
 *   node scripts/check-s7_78.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = 'migrations/s7_78_admin_doctor_export.sql';
const RB = 'docs/rollbacks/s7_78_rollback.sql';
const SVC = 'src/services/admin.service.ts';
const PAGE = 'src/pages/admin/AdminDoctorsPage.tsx';
const LIST = 'migrations/s7_04_admin_doctors_search_paginate.sql';

let pass = 0, fail = 0;
const check = (label, ok) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};
const read = (p) => {
  const f = resolve(ROOT, p);
  if (!existsSync(f)) { console.error(`\nNo existe ${p}`); process.exit(1); }
  return readFileSync(f, 'utf8');
};
/** Cuerpo EJECUTABLE: sin comentarios. Los comentarios de esta migración nombran
 *  a propósito lo prohibido, así que inspeccionar el texto crudo da falsos
 *  positivos — la lección que ya costó dos correcciones en s7_77. */
const ejecutable = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const sql = read(MIG), rb = read(RB), svc = read(SVC), page = read(PAGE), list = read(LIST);
const ex = ejecutable(sql), exRb = ejecutable(rb);

/**
 * CUERPO de la función, sin las guardas POST.
 *
 * Las guardas nombran A PROPÓSITO lo que está prohibido —`license_number`,
 * `SELECT *`, `stripe`— para poder buscarlo. Comprobar la prohibición contra el
 * archivo entero da 8 falsos positivos: el propio control dispara la alarma.
 * Es la misma lección que costó dos correcciones en s7_77, ahora aplicada al
 * eje correcto: recortar el ALCANCE, no solo quitar comentarios.
 */
const cuerpo = ex.slice(
  ex.indexOf('CREATE OR REPLACE FUNCTION public.admin_export_doctors'),
  ex.indexOf('COMMENT ON FUNCTION public.admin_export_doctors')
);

console.log('\ncheck-s7_78 — exportación de la base de médicos\n');

// ─── 1 · la RPC ─────────────────────────────────────────────
console.log('1. RPC');
check('se llama admin_export_doctors', /CREATE OR REPLACE FUNCTION public\.admin_export_doctors\(/.test(ex));
// `\s+`, no un espacio: la firma está alineada en columnas.
check('firma con los 4 filtros + formato', /p_search\s+text[\s\S]{0,240}p_published\s+boolean[\s\S]{0,160}p_operational\s+boolean[\s\S]{0,160}p_lucy_status\s+lucy_status[\s\S]{0,160}p_formato\s+text/.test(ex));
check('devuelve jsonb', /admin_export_doctors\([\s\S]*?\)\s*RETURNS jsonb/.test(ex));
check('SECURITY DEFINER', /RETURNS jsonb\s*\nLANGUAGE plpgsql\s*\nSECURITY DEFINER/.test(ex));
check('search_path fijo', /SET search_path = public, pg_catalog/.test(ex));
check('NO se declara STABLE (audita, debe ser VOLATILE)', !/\nSTABLE\n/.test(ex));

// ─── 2 · universo compartido ────────────────────────────────
console.log('\n2. Universo compartido con el listado');
check('invoca admin_list_doctors', /FROM public\.admin_list_doctors\(/.test(ex));
check('le pasa los 4 filtros tal cual', /admin_list_doctors\(\s*\n?\s*p_search, p_published, p_operational, p_lucy_status/.test(ex));
check('NO duplica el WHERE de búsqueda', !/ILIKE\s*'%'\s*\|\|/.test(ex));
check('NO reimplementa los filtros booleanos', !/p_published\s+IS NULL OR/.test(ex));
check('enriquece por id, no por otro criterio', /JOIN\s+public\.doctors\s+d\s+ON d\.id\s+=\s+l\.id/.test(ex));
check('trae correo desde profiles', /LEFT JOIN public\.profiles\s+p\s+ON p\.id\s+=\s+d\.profile_id/.test(ex));
check('trae dirección desde clinics', /LEFT JOIN public\.clinics\s+c\s+ON c\.id\s+=\s+d\.clinic_id/.test(ex));
check('trae departamento y municipio', /departments\s+dp/.test(ex) && /municipalities mu/.test(ex));

// ─── 3 · el listado sigue sin techo (lo que hace viable el tope) ───
console.log('\n3. admin_list_doctors admite 10001');
check('aplica GREATEST(p_limit, 1) — piso, no techo', /LIMIT GREATEST\(p_limit, 1\)/.test(ejecutable(list)));
check('NO tiene LEAST ni clamp superior', !/LEAST/.test(ejecutable(list)));
check('la migración verifica ese supuesto en POST', /GREATEST\(p_limit, 1\)[\s\S]{0,200}revisar si adquirió un clamp/.test(sql));

// ─── 4 · tope y exceso ──────────────────────────────────────
console.log('\n4. Tope de exportación');
check('MAX_EXPORT = 10000', /MAX_EXPORT constant int := 10000;/.test(ex));
check('pide MAX_EXPORT + 1 para detectar exceso', /MAX_EXPORT \+ 1/.test(ex));
check('aborta con P0146 si excede', /v_n > MAX_EXPORT[\s\S]{0,160}P0146/.test(ex));
check('NO trunca con LIMIT MAX_EXPORT', !/LIMIT MAX_EXPORT\b/.test(ex));

// ─── 5 · gate y formato ─────────────────────────────────────
console.log('\n5. Autorización y formato');
check('gate is_admin() con P0140', /IF NOT public\.is_admin\(\)[\s\S]{0,120}P0140/.test(ex));
check('solo acepta csv', /btrim\(lower\(p_formato\)\), ''\) <> 'csv'/.test(ex));
check('otro formato → P0142', /P0142/.test(ex));
check('anon sin EXECUTE', /REVOKE ALL ON FUNCTION public\.admin_export_doctors[\s\S]{0,120}FROM anon/.test(ex));
check('authenticated con EXECUTE', /GRANT EXECUTE ON FUNCTION public\.admin_export_doctors[\s\S]{0,120}TO authenticated/.test(ex));
check('PUBLIC revocado — no hereda el default', /REVOKE ALL ON FUNCTION public\.admin_export_doctors[\s\S]{0,140}FROM PUBLIC/.test(ex));
check('service_role REVOCADO explícitamente', /REVOKE ALL ON FUNCTION public\.admin_export_doctors[\s\S]{0,140}FROM service_role/.test(ex));
check('documenta el privilegio de los 4 roles', /service_role\s+→ REVOKE/.test(sql));
check('el POST comprueba service_role', /service_role conserva EXECUTE/.test(sql));
check('el POST comprueba el ACL de PUBLIC', /PUBLIC conserva privilegios sobre la función/.test(sql));
check('el POST rechaza proacl nula (defaults vigentes)', /privilegios por defecto \(PUBLIC con EXECUTE\)/.test(sql));

// ─── 6 · allowlist ──────────────────────────────────────────
console.log('\n6. Allowlist de columnas');
for (const c of ['full_name', 'specialty', 'phone', 'email', 'clinic_name',
                 'clinic_address', 'department', 'municipality', 'lucy_status',
                 'reclamado', 'verificado', 'publicado', 'agenda', 'operativo', 'created_at']) {
  check(`incluye ${c}`, new RegExp(`'${c}',`).test(ex));
}
// Sobre el CUERPO: la guarda POST contiene el patrón 'SELECT\s+\*' como texto
// para poder buscarlo, y contra el archivo entero se delataría a sí misma.
check('sin SELECT * en el cuerpo', !/SELECT\s+\*/.test(cuerpo));
for (const p of ['license_number', 'doctor_credentials', 'tos_accepted_at', 'avatar_url', 'stripe', 'd.bio']) {
  check(`NO referencia ${p}`, !cuerpo.includes(p));
}
check('reclamado se deriva del enum canónico', /lucy_status IN \('claimed', 'booking_enabled', 'verified'\)/.test(ex));
check('verificado se deriva del enum canónico', /'verificado',\s*\(l\.lucy_status = 'verified'\)/.test(ex));

// ─── 7 · orden determinista ─────────────────────────────────
console.log('\n7. Orden');
// El ORDER BY tiene que estar DENTRO de `jsonb_agg`: es la única construcción
// que PostgreSQL garantiza para el orden de un agregado. Uno en la subconsulta
// «parecería» correcto y no obligaría a nada.
check('ORDER BY dentro de jsonb_agg', /jsonb_agg\(\s*x\.fila\s+ORDER BY\s+x\.created_at DESC,\s*x\.id\s*\)/.test(cuerpo));
check('desempate explícito por id', /ORDER BY\s+x\.created_at DESC,\s*x\.id/.test(cuerpo));
check('sin ORDER BY externo del que fiarse', !/\)\s*x\s*;\s*ORDER BY/.test(cuerpo));
check('el POST exige el ORDER BY en el agregado', /no está dentro de jsonb_agg/.test(sql));
check('el orden se aplica DESPUÉS del JOIN', ex.indexOf('jsonb_agg') < ex.indexOf('FROM public.admin_list_doctors'));

// ─── 8 · auditoría sin PII ──────────────────────────────────
console.log('\n8. Auditoría');
check('escribe en audit_log', /INSERT INTO public\.audit_log/.test(ex));
check('table_name propio', /'admin_doctor_export'/.test(ex));
check('registra el conteo', /'registros',\s*v_n/.test(ex));
check('con_busqueda es BOOLEANO', /'con_busqueda',\s*\(nullif\(btrim\(coalesce\(p_search, ''\)\), ''\) IS NOT NULL\)/.test(ex));
check('NO guarda el texto buscado', !/'busqueda',\s*p_search/.test(ex) && !/'search',\s*p_search/.test(ex));
check('registra los filtros normalizados', /'filtro_published'/.test(ex) && /'filtro_operational'/.test(ex) && /'filtro_lucy_status'/.test(ex));
check('NO guarda nombres, correos ni teléfonos', !/'(full_name|email|phone)',\s*(p\.|l\.)/.test(ex.slice(ex.indexOf('INSERT INTO public.audit_log'))));
check('NO guarda las filas exportadas', !/'rows',\s*v_rows[\s\S]{0,80}audit/.test(ex));
// Secuencia: un intento rechazado por >10 000 no debe dejar fila de export.
check('audita DESPUÉS del gate P0140', cuerpo.indexOf('P0140') < cuerpo.indexOf('INSERT INTO public.audit_log'));
check('audita DESPUÉS del formato P0142', cuerpo.indexOf('P0142') < cuerpo.indexOf('INSERT INTO public.audit_log'));
check('audita DESPUÉS del tope P0146', cuerpo.indexOf('P0146') < cuerpo.indexOf('INSERT INTO public.audit_log'));
check('el POST verifica esa secuencia', /la auditoría se escribe antes de alguna validación/.test(sql));

// ─── 9 · no escribe en tablas de negocio ────────────────────
console.log('\n9. Solo lectura sobre el negocio');
check('sin UPDATE/DELETE', !/\b(UPDATE|DELETE)\s+(FROM\s+)?(public\.)?(doctors|profiles|clinics)\b/i.test(ex));
check('el único INSERT del cuerpo es el de auditoría', (cuerpo.match(/INSERT INTO/g) || []).length === 1);
check('no toca auth.users', !/auth\.users/.test(ex));
check('no crea ni altera tablas', !/CREATE TABLE|ALTER TABLE/.test(ex));

// ─── 10 · guardas POST dentro de la migración ───────────────
console.log('\n10. Guardas POST');
for (const g of ['no es SECURITY DEFINER', 'debe ser VOLATILE', 'falta SET search_path fijo',
                 'anon conserva EXECUTE', 'no reutiliza admin_list_doctors',
                 'MAX_EXPORT no es 10000', 'no está dentro de jsonb_agg',
                 'columna prohibida', 'SELECT \\* — la allowlist',
                 'guardaría el texto buscado', 'tabla de negocio']) {
  check(`verifica: ${g.replace('\\\\', '')}`, new RegExp(g).test(sql));
}
check('el POST analiza el cuerpo SIN comentarios', /regexp_replace\(regexp_replace\(prosrc/.test(sql));

// ─── 11 · rollback ──────────────────────────────────────────
console.log('\n11. Rollback');
check('elimina solo la función nueva', /DROP FUNCTION IF EXISTS public\.admin_export_doctors/.test(exRb));
check('NO toca admin_list_doctors', !/DROP FUNCTION[^;]*admin_list_doctors/.test(exRb));
check('NO borra auditoría', !/(DELETE|UPDATE)[^;]*audit_log/i.test(exRb));
check('verifica que el listado sigue intacto', /admin_list_doctors[\s\S]{0,200}esperaba 1/.test(rb));
check('verifica que el export desapareció', /admin_export_doctors sigue existiendo/.test(rb));

// ─── 12 · frontend ──────────────────────────────────────────
console.log('\n12. Frontend');
check('el servicio llama a la RPC', /supabase\.rpc\('admin_export_doctors'/.test(svc));
check('reutiliza buildCsv de lib/csv', /import \{ buildCsv \} from '@\/lib\/csv'/.test(svc));
check('tope espejo 10000', /DOCTOR_EXPORT_MAX = 10000/.test(svc));
check('traduce P0140/P0142/P0146', /P0140:/.test(svc) && /P0142:/.test(svc) && /P0146:/.test(svc));
check('fecha con timeZone fija', /timeZone: CSV_TIMEZONE/.test(svc) && /America\/El_Salvador/.test(svc));
check('hourCycle h23', /hourCycle: 'h23'/.test(svc));
check('usa formatToParts', /formatToParts/.test(svc));
// El CONTEO total de columnas dejó de ser invariante de este frente:
// ADMIN-DOCTOR-EXPORT-URL-P0 (s7_79) añadió «Slug» y «URL pública», y lo
// verifica `check-s7_79`. Lo que s7_78 debe seguir garantizando es que sus 15
// columnas no sufrieron regresión — eso es lo que se comprueba acá.
{
  const suyas = ['Nombre', 'Especialidad', 'Teléfono', 'Correo', 'Clínica',
    'Dirección de clínica', 'Departamento de clínica', 'Municipio de clínica',
    'Estado LucyCare', 'Perfil reclamado', 'Verificado en LucyCare', 'Publicado',
    'Agenda habilitada', 'Operativo', 'Fecha de alta en LucyCare'];
  check('las 15 columnas de s7_78 siguen declaradas',
    suyas.every((h) => svc.includes(`header: '${h}'`)));
  // Se captura el GRUPO, no el match entero: quedarse con el match dejaba la
  // comilla de cierre pegada al nombre y la comparación fallaba por eso, no
  // por el orden.
  const encabezados = [...svc.matchAll(/\{ header: '([^']+)'/g)].map((m) => m[1]);
  check('y siguen siendo las 15 primeras, en orden',
    encabezados.slice(0, 15).join('|') === suyas.join('|'));
  check('el total lo gobierna check-s7_79', (svc.match(/\{ header: '/g) || []).length >= 15);
}
check('encabezado «Perfil reclamado»', /header: 'Perfil reclamado'/.test(svc));
check('encabezado «Verificado en LucyCare»', /header: 'Verificado en LucyCare'/.test(svc));
check('sin encabezados ambiguos', !/header: 'Reclamado'/.test(svc) && !/header: 'Verificado'/.test(svc));
check('botón Exportar CSV', /Exportar CSV/.test(page));
check('estado de carga', /Preparando CSV…/.test(page));
check('disabled mientras exporta', /disabled=\{exportando\}/.test(page));
check('guarda contra doble clic', /if \(exportando\) return;/.test(page));
check('el botón vive en OwnerDoctorsView, no en el dispatcher',
  page.indexOf('function OwnerDoctorsView') < page.indexOf('Exportar CSV'));
check('DirectoryDoctorsList NO tiene export',
  !readFileSync(resolve(ROOT, 'src/pages/admin/components/DirectoryDoctorsList.tsx'), 'utf8').includes('Exportar CSV'));
check('el export usa los MISMOS filtros que el listado',
  /fetchDoctorsForExport\(\{\s*\n\s*search: search \|\| undefined,\s*\n\s*published: triToBool\(published\),\s*\n\s*operational: triToBool\(operational\),\s*\n\s*lucyStatus: lucy \|\| null,/.test(page));
check('el export NO pasa limit/offset de la tabla', !/fetchDoctorsForExport\([\s\S]{0,220}limit:/.test(page));

// ─── 13 · aislamiento del frente de pacientes ───────────────
console.log('\n13. Frente de pacientes intacto');
check('patientCrm.service.ts sin referencias a médicos',
  !/admin_export_doctors|buildDoctorsCsv/.test(readFileSync(resolve(ROOT, 'src/services/patientCrm.service.ts'), 'utf8')));
check('src/lib/csv.ts sin fechas ni zona horaria',
  !/Intl\.DateTimeFormat|El_Salvador/.test(readFileSync(resolve(ROOT, 'src/lib/csv.ts'), 'utf8')));

console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${pass} PASS · ${fail} FAIL`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail === 0 ? 0 : 1);
