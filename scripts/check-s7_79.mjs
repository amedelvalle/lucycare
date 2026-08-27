#!/usr/bin/env node
/**
 * check-s7_79.mjs — ADMIN-DOCTOR-EXPORT-URL-P0
 *
 * Guardas ESTÁTICAS sobre `migrations/s7_79_admin_doctor_export_slug.sql`, su
 * rollback y el frontend. No toca la base.
 *
 * Lo que persigue: que `s7_79` añada EXACTAMENTE el slug y nada más, que
 * `s7_78` quede intacta, y que no se haya degradado en silencio ninguna de las
 * propiedades que costó establecer — seguridad, filtros, tope, orden y
 * auditoría.
 *
 *   node scripts/check-s7_79.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIG79 = 'migrations/s7_79_admin_doctor_export_slug.sql';
const MIG78 = 'migrations/s7_78_admin_doctor_export.sql';
const RB = 'docs/rollbacks/s7_79_rollback.sql';
const SVC = 'src/services/admin.service.ts';

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
const ejecutable = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
// TypeScript sin comentarios.
//
// ⚠️ Solo se quitan las líneas que EMPIEZAN por dos barras, no cualquier
// aparición de dos barras. Un replace global sobre "dos barras hasta fin de
// línea" se come la mitad de `const X = 'https://lucycare.app'`, porque el
// esquema del enlace las lleva: la constante desaparecía del texto analizado y
// la aserción daba un falso FAIL.
const ejecutableTs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const s79 = read(MIG79), s78 = read(MIG78), rb = read(RB), svc = read(SVC);
const ex79 = ejecutable(s79), ex78 = ejecutable(s78), exRb = ejecutable(rb);
const exSvc = ejecutableTs(svc);

/** Cuerpo de la función, sin las guardas POST: esas nombran a propósito lo
 *  prohibido y contra el archivo entero se delatarían solas. */
const cuerpo = (ex) => ex.slice(
  ex.indexOf('CREATE OR REPLACE FUNCTION public.admin_export_doctors'),
  ex.indexOf('COMMENT ON FUNCTION public.admin_export_doctors')
);
const c79 = cuerpo(ex79), c78 = cuerpo(ex78);

console.log('\ncheck-s7_79 — slug y URL pública en el export de médicos\n');

// ─── 1 · el ÚNICO cambio funcional ──────────────────────────
console.log('1. El cambio, y solo el cambio');
check('s7_79 emite d.slug', /'slug',\s*d\.slug/.test(c79));
check('s7_78 NO lo emitía (A/B)', !/'slug',\s*d\.slug/.test(c78));
check('NO genera slugs (slugify_name)', !c79.includes('slugify_name'));
check('NO genera slugs (_doctor_next_slug)', !c79.includes('_doctor_next_slug'));
check('la URL NO se construye en la RPC', !/lucycare\.app/.test(c79) && !/https:\/\//.test(c79));

// ─── 2 · A/B estructural: cuerpo idéntico salvo el slug ─────
console.log('\n2. A/B · el resto del cuerpo es idéntico a s7_78');
{
  // Se quita la clave del slug de s7_79 y se colapsa TODO el espacio en blanco
  // —no solo el que rodea los paréntesis—: al borrar la última clave queda una
  // coma colgando y el sangrado deja de coincidir, lo que produciría una
  // diferencia falsa por formato en vez de por contenido.
  const norm = (s) => s.replace(/,?\s*'slug',\s*d\.slug/g, '').replace(/\s+/g, '');
  check('sin la clave slug, los cuerpos son idénticos', norm(c79) === norm(c78));
}

// ─── 3 · s7_78 permanece intacta ────────────────────────────
console.log('\n3. s7_78 sin tocar');
{
  let gitLimpio = true, sinCommitsNuevos = true;
  try {
    const st = execFileSync('git', ['status', '--porcelain', '--', MIG78],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    gitLimpio = st === '';
  } catch { gitLimpio = false; }
  check('git no reporta modificaciones en s7_78', gitLimpio);
  check('s7_78 sigue existiendo', existsSync(resolve(ROOT, MIG78)));
  check('s7_78 conserva su encabezado', /s7_78 · ADMIN-DOCTOR-EXPORT/.test(s78));
  check('s7_79 declara que no la reaplica', /`s7_78` NO se modifica ni se reaplica/.test(s79));
  check('s7_79 no ejecuta s7_78', !/s7_78_admin_doctor_export\.sql/.test(ex79));
  void sinCommitsNuevos;
}

// ─── 4 · seguridad preservada ───────────────────────────────
console.log('\n4. Seguridad');
check('SECURITY DEFINER', /RETURNS jsonb\s*\nLANGUAGE plpgsql\s*\nSECURITY DEFINER/.test(ex79));
check('NO se declara STABLE', !/\nSTABLE\n/.test(ex79));
check('search_path fijo', /SET search_path = public, pg_catalog/.test(ex79));
check('firma idéntica', /p_search\s+text[\s\S]{0,240}p_published\s+boolean[\s\S]{0,160}p_operational\s+boolean[\s\S]{0,160}p_lucy_status\s+lucy_status[\s\S]{0,160}p_formato\s+text/.test(ex79));
check('gate is_admin() con P0140', /IF NOT public\.is_admin\(\)[\s\S]{0,120}P0140/.test(ex79));
check('solo csv → P0142', /btrim\(lower\(p_formato\)\), ''\) <> 'csv'/.test(ex79) && /P0142/.test(ex79));
for (const r of ['PUBLIC', 'anon', 'service_role']) {
  check(`REVOKE de ${r}`, new RegExp(`REVOKE ALL ON FUNCTION public\\.admin_export_doctors[\\s\\S]{0,140}FROM ${r}`).test(ex79));
}
check('GRANT solo a authenticated', /GRANT EXECUTE ON FUNCTION public\.admin_export_doctors[\s\S]{0,140}TO authenticated/.test(ex79));

// ─── 5 · filtros, tope y orden ──────────────────────────────
console.log('\n5. Filtros, tope y orden');
check('sigue reutilizando admin_list_doctors', /FROM public\.admin_list_doctors\(/.test(c79));
check('le pasa los 4 filtros tal cual', /admin_list_doctors\(\s*\n?\s*p_search, p_published, p_operational, p_lucy_status/.test(ex79));
check('NO reimplementa la búsqueda', !/ILIKE\s*'%'\s*\|\|/.test(c79));
check('NO reimplementa los filtros', !/p_published\s+IS NULL OR/.test(c79));
check('MAX_EXPORT sigue en 10000', /MAX_EXPORT constant int := 10000;/.test(ex79));
check('pide MAX_EXPORT + 1', /MAX_EXPORT \+ 1/.test(c79));
check('aborta con P0146', /v_n > MAX_EXPORT[\s\S]{0,160}P0146/.test(c79));
check('NO trunca', !/LIMIT MAX_EXPORT\b/.test(c79));
check('ORDER BY dentro de jsonb_agg', /jsonb_agg\(\s*x\.fila\s+ORDER BY\s+x\.created_at DESC,\s*x\.id\s*\)/.test(c79));
check('NO modifica admin_list_doctors', !/FUNCTION public\.admin_list_doctors|FUNCTION admin_list_doctors/.test(ex79));
check('el POST vigila que el listado no gane slug', /fue modificada para incluir slug/.test(s79));

// ─── 6 · auditoría sin cambios ──────────────────────────────
console.log('\n6. Auditoría');
check('un solo INSERT, el de auditoría', (c79.match(/INSERT INTO/g) || []).length === 1);
check('table_name admin_doctor_export', /'admin_doctor_export'/.test(c79));
check('con_busqueda sigue siendo booleano', /'con_busqueda',\s*\(nullif\(btrim\(coalesce\(p_search, ''\)\), ''\) IS NOT NULL\)/.test(c79));
check('NO guarda el texto buscado', !/'busqueda',\s*p_search/.test(c79) && !/'search',\s*p_search/.test(c79));
check('NO audita el slug ni las filas', !/'slug'[\s\S]{0,40}audit/.test(c79) && !/'rows',\s*v_rows[\s\S]{0,80}audit/.test(c79));
check('audita después de P0146', c79.indexOf('P0146') < c79.indexOf('INSERT INTO public.audit_log'));
{
  // El bloque de auditoría debe ser idéntico al de s7_78.
  const bloque = (c) => c.slice(c.indexOf('INSERT INTO public.audit_log'), c.indexOf('RETURN jsonb_build_object'));
  check('bloque de auditoría idéntico a s7_78 (A/B)',
    bloque(c79).replace(/\s+/g, ' ') === bloque(c78).replace(/\s+/g, ' '));
}

// ─── 7 · allowlist sin filtraciones nuevas ──────────────────
console.log('\n7. Allowlist');
for (const c of ['full_name', 'specialty', 'phone', 'email', 'clinic_name',
                 'clinic_address', 'department', 'municipality', 'lucy_status',
                 'reclamado', 'verificado', 'publicado', 'agenda', 'operativo',
                 'created_at', 'slug']) {
  check(`emite ${c}`, new RegExp(`'${c}',`).test(c79));
}
{
  // Contar sobre el cuerpo entero da 25: también matchean los valores del
  // `lucy_status IN ('claimed', …)` y las claves del bloque de auditoría. Se
  // acota al `jsonb_build_object` de la FILA, que es la allowlist real.
  const inicio = c79.indexOf('jsonb_build_object(');
  const allowlist = c79.slice(inicio, c79.indexOf(') AS fila', inicio));
  const claves = [...new Set((allowlist.match(/'([a-z_]+)',/g) || [])
    .filter((k) => !['\'claimed\',', '\'booking_enabled\','].includes(k)))];
  check('son 16 claves en la allowlist, ni una más', claves.length === 16);
}
for (const p of ['license_number', 'doctor_credentials', 'tos_accepted_at', 'avatar_url', 'stripe', 'd.bio']) {
  check(`NO referencia ${p}`, !c79.includes(p));
}
check('sin SELECT *', !/SELECT\s+\*/.test(c79));

// ─── 8 · guardas POST de la migración ───────────────────────
console.log('\n8. Guardas POST');
for (const g of ['la allowlist no emite d.slug', 'estaría GENERANDO slugs',
                 'la URL pública no debe construirse en la RPC',
                 'dejó de reutilizar admin_list_doctors', 'MAX_EXPORT ya no es 10000',
                 'se perdió el ORDER BY dentro de jsonb_agg',
                 'la auditoría quedó antes del control del tope',
                 'columna prohibida', 'la firma cambió',
                 'service_role conserva EXECUTE', 'PUBLIC conserva privilegios',
                 'esperaba 1 \\(¿cambió la firma\\?\\)']) {
  check(`verifica: ${g.replace(/\\/g, '')}`, new RegExp(g).test(s79));
}
check('el POST mira el cuerpo SIN comentarios', /regexp_replace\(regexp_replace\(prosrc/.test(s79));

// ─── 9 · rollback ───────────────────────────────────────────
console.log('\n9. Rollback');
check('existe', rb.length > 0);
check('restaura la función SIN slug', !/'slug',\s*d\.slug/.test(cuerpo(exRb) || exRb.slice(0, exRb.indexOf('COMMENT ON FUNCTION'))));
check('conserva el gate y el tope', /P0140/.test(exRb) && /P0146/.test(exRb) && /10000/.test(exRb));
check('conserva la reutilización del listado', /admin_list_doctors/.test(exRb));
check('repone los grants de los 4 roles',
  /FROM PUBLIC/.test(exRb) && /FROM anon/.test(exRb) && /FROM service_role/.test(exRb) && /TO authenticated/.test(exRb));
check('NO reaplica s7_78 desde su archivo', !/s7_78_admin_doctor_export\.sql/.test(exRb));
check('NO toca admin_list_doctors', !/(DROP|CREATE OR REPLACE) FUNCTION[^;]*admin_list_doctors/.test(exRb));
check('NO borra auditoría', !/(DELETE|UPDATE)[^;]*audit_log/i.test(exRb));
check('verifica que el slug desapareció', /el slug sigue en la allowlist/.test(rb));
check('el regex de esa verificación está bien escapado', /'''slug'',\\s\*d\\\.slug'/.test(rb));

// ─── 10 · frontend ──────────────────────────────────────────
console.log('\n10. Frontend');
check('17 columnas declaradas', (svc.match(/\{ header: '/g) || []).length === 17);
check('columna Slug', /header: 'Slug'/.test(svc));
check('columna URL pública', /header: 'URL pública'/.test(svc));
check('slug en la interfaz de la fila', /slug: string \| null;/.test(svc));
check('dominio como constante literal', /const LUCYCARE_PUBLIC_ORIGIN = 'https:\/\/lucycare\.app'/.test(exSvc));
check('NO usa window.location.origin', !/window\.location\.origin/.test(exSvc));
check('la URL exige slug Y publicado', /if \(!slug \|\| !row\.publicado\) return '';/.test(exSvc));
check('la ruta es /doctor/<slug>', /\/doctor\/\$\{slug\}/.test(exSvc));
check('el slug se escribe tal cual', /header: 'Slug', value: \(r\) => r\.slug \?\? ''/.test(svc));
check('el frontend NO genera slugs', !/slugify|toLowerCase\(\)\.replace/.test(exSvc));

// ─── 11 · nada más se tocó ──────────────────────────────────
console.log('\n11. Aislamiento');
check('patientCrm.service.ts sin referencias a médicos',
  !/admin_export_doctors|buildDoctorsCsv/.test(read('src/services/patientCrm.service.ts')));
check('src/lib/csv.ts sin dominio ni rutas',
  !/lucycare\.app|\/doctor\//.test(read('src/lib/csv.ts')));
check('admin_list_doctors (s7_04) sin modificar',
  execFileSync('git', ['status', '--porcelain', '--', 'migrations/s7_04_admin_doctors_search_paginate.sql'],
    { cwd: ROOT, encoding: 'utf8' }).trim() === '');

console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${pass} PASS · ${fail} FAIL`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail === 0 ? 0 : 1);
