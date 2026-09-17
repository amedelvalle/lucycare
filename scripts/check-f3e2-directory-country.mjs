#!/usr/bin/env node
/**
 * check-f3e2-directory-country.mjs — MULTICOUNTRY-GEO-P0 · F3E-2
 *
 * Prueba CONDUCTUAL del consumo de `directory_countries()` (s7_96) en el
 * directorio: transpila `src/services/directory.service.ts` con esbuild y lo
 * EJECUTA contra un `fetch` instrumentado. Mismo instrumento que
 * `check-directory-booking-ready.mjs`, que existe por el `supabase.rpc`
 * desligado que dejó la reserva caída en producción (#359/#360).
 *
 * Afirma:
 *   1. `fetchDirectoryCountries` emite de verdad 1 POST a la RPC y agrupa por país;
 *   2. un error del proveedor LANZA (fail closed);
 *   3. contexto: 0 países → null, 1 → ese, >1 → null;
 *   4. `fetchDoctors` lleva `clinics.country_id=eq.<id>` sin seleccionar la columna;
 *   5. sin país, `fetchDoctors` lanza y NO emite ninguna petición;
 *   6. ninguna petición toca territorios ni tablas GEO;
 *   7. guarda estática del binding, con control.
 *
 *   node scripts/check-f3e2-directory-country.mjs
 *
 * No toca la red real ni la base de datos: el `fetch` global está sustituido.
 */
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(
  path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild',
);

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = JSON.stringify(actual) === JSON.stringify(esperado);
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else {
    fail++;
    console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`);
  }
};

console.log('\ncheck-f3e2-directory-country — país de contexto del directorio\n');

const FIXTURE_URL = 'https://fixture.supabase.co';

// `fetch` instrumentado — se instala ANTES de importar el servicio, porque el
// cliente de Supabase resuelve `fetch` al construirse.
const llamadas = [];
let respuestas = {};

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  llamadas.push({ url: decodeURIComponent(url), method: init.method ?? 'GET' });
  const key = Object.keys(respuestas).find((k) => url.includes(k));
  const r = key ? respuestas[key] : { status: 200, body: '[]' };
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

function preparar(r = {}) {
  llamadas.length = 0;
  respuestas = r;
}

const cacheDir = path.join('node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const out = path.join(cacheDir, `f3e2-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);

execFileSync(process.execPath, [
  esbuildBin, 'src/services/directory.service.ts',
  '--bundle', '--format=esm', '--platform=node', '--packages=external',
  '--alias:@/lib=./src/lib',
  `--define:import.meta.env.VITE_SUPABASE_URL="${FIXTURE_URL}"`,
  '--define:import.meta.env.VITE_SUPABASE_ANON_KEY="fixture-anon-key"',
  '--define:import.meta.env.VITE_CAPTCHA_ENABLED=""',
  '--define:import.meta.env.VITE_TURNSTILE_SITE_KEY=""',
  `--outfile=${out}`,
], { stdio: ['ignore', 'ignore', 'inherit'] });

const svc = await import(pathToFileURL(path.resolve(out)).href);

const FILAS_SV = JSON.stringify([
  { country_id: 1, iso_alpha2: 'SV', country_name: 'El Salvador', level: 2, level_label: 'Municipio' },
  { country_id: 1, iso_alpha2: 'SV', country_name: 'El Salvador', level: 1, level_label: 'Departamento' },
  { country_id: 1, iso_alpha2: 'SV', country_name: 'El Salvador', level: 3, level_label: 'Distrito' },
]);

// ─── 1 · la RPC sale y agrupa ───
console.log('1 · directory_countries se emite y agrupa por país');
{
  preparar({ 'rpc/directory_countries': { status: 200, body: FILAS_SV } });
  let res = null, err = null;
  try { res = await svc.fetchDirectoryCountries(); } catch (e) { err = String(e?.message); }
  check('no lanza', err, null);
  check('exactamente 1 petición', llamadas.length, 1);
  check('al endpoint de la RPC', llamadas[0]?.url, `${FIXTURE_URL}/rest/v1/rpc/directory_countries`);
  check('es POST', llamadas[0]?.method, 'POST');
  check('3 filas crudas → 1 país', res?.length, 1);
  check('forma del país', res?.[0], {
    countryId: 1, iso: 'SV', name: 'El Salvador',
    levels: [
      { level: 1, label: 'Departamento' },
      { level: 2, label: 'Municipio' },
      { level: 3, label: 'Distrito' },
    ],
  });

  preparar({ 'rpc/directory_countries': { status: 200, body: JSON.stringify([
    { country_id: 9, iso_alpha2: 'XX', country_name: 'Sin niveles', level: null, level_label: null },
  ]) } });
  check('país sin niveles → levels []', (await svc.fetchDirectoryCountries())[0]?.levels, []);
}

// ─── 2 · fail closed ───
console.log('\n2 · error del proveedor o forma inválida → lanza');
for (const [label, r] of [
  ['error 42501', { status: 403, body: JSON.stringify({ code: '42501', message: 'permission denied', details: null, hint: null }) }],
  ['respuesta no-array', { status: 200, body: 'null' }],
  ['mismo ISO con dos country_id', { status: 200, body: JSON.stringify([
    { country_id: 1, iso_alpha2: 'SV', country_name: 'El Salvador', level: 1, level_label: 'Departamento' },
    { country_id: 2, iso_alpha2: 'SV', country_name: 'El Salvador', level: 2, level_label: 'Municipio' },
  ]) }],
]) {
  preparar({ 'rpc/directory_countries': r });
  let lanzo = false;
  try { await svc.fetchDirectoryCountries(); } catch { lanzo = true; }
  check(`${label} LANZA`, lanzo, true);
}

// ─── 3 · contexto sobre países únicos ───
console.log('\n3 · contexto: 0 → null · 1 → ese · >1 → null');
{
  const sv = { countryId: 1, iso: 'SV', name: 'El Salvador', levels: [] };
  const hn = { countryId: 2, iso: 'HN', name: 'Honduras', levels: [] };
  check('0 países → null', svc.resolveDirectoryCountryContext([]), null);
  check('1 país → ese país', svc.resolveDirectoryCountryContext([sv]), sv);
  check('2 países → null (no elige el primero)', svc.resolveDirectoryCountryContext([sv, hn]), null);
}

// ─── 4 · filtro país en la query de médicos ───
console.log('\n4 · fetchDoctors filtra por clinics.country_id');
const FILTROS = { search: '', specialtyId: null, departmentId: null, municipalityId: null };
{
  preparar();
  let err = null;
  try { await svc.fetchDoctors({ ...FILTROS, countryId: 7 }); } catch (e) { err = String(e?.message); }
  check('no lanza', err, null);
  check('exactamente 1 petición', llamadas.length, 1);
  const u = llamadas[0]?.url ?? '';
  check('va a /rest/v1/doctors', u.startsWith(`${FIXTURE_URL}/rest/v1/doctors?`), true);
  check('lleva clinics.country_id=eq.7', u.includes('clinics.country_id=eq.7'), true);
  const select = new URL(u.replace(/ /g, '%20')).searchParams.get('select') ?? '';
  check('country_id NO está en el select (solo predicado)', select.includes('country_id'), false);
  check('conserva is_published=eq.true', u.includes('is_published=eq.true'), true);

  preparar();
  await svc.fetchDoctors({ ...FILTROS, departmentId: 'SS', municipalityId: 'SS-12', specialtyId: 'x', countryId: 7 });
  const v = llamadas[0]?.url ?? '';
  check('filtros legacy se combinan con el país',
    ['clinics.country_id=eq.7', 'clinics.department_id=eq.SS', 'clinics.municipality_id=eq.SS-12', 'specialty_id=eq.x']
      .every((p) => v.includes(p)), true);
}

// ─── 5 · sin país no hay consulta ───
console.log('\n5 · sin país: lanza y no emite nada');
{
  preparar();
  let lanzo = false;
  try { await svc.fetchDoctors({ ...FILTROS, countryId: null }); } catch { lanzo = true; }
  check('countryId null LANZA', lanzo, true);
  check('0 peticiones', llamadas.length, 0);
}

// ─── 6 · nada de territorios ni tablas GEO ───
console.log('\n6 · ninguna petición a territorios ni tablas GEO');
{
  preparar({ 'rpc/directory_countries': { status: 200, body: FILAS_SV } });
  await svc.fetchDirectoryCountries();
  await svc.fetchDoctors({ ...FILTROS, countryId: 1 });
  const geo = /directory_territory_units|\/rest\/v1\/(countries|country_levels|administrative_units|administrative_unit_closure)\b/;
  check('flujo inicial = 2 peticiones', llamadas.length, 2);
  check('0 peticiones GEO fuera de directory_countries', llamadas.filter((c) => geo.test(c.url)).length, 0);
  check('control: el patrón GEO caza una llamada a territorios',
    geo.test(`${FIXTURE_URL}/rest/v1/rpc/directory_territory_units`), true);
}

// ─── 7 · guarda estática del binding ───
console.log('\n7 · guarda estática (solo código ejecutable)');
{
  const ejecutable = fs.readFileSync(path.join('src', 'services', 'directory.service.ts'), 'utf8')
    .split('\r\n').join('\n').split('\n')
    .filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); })
    .join('\n');
  const ligados = (s) => (s.match(/supabase\.rpc\.bind\(supabase\)/g) ?? []).length;
  const desligado = (s) => /=\s*supabase\.rpc\s+as/.test(s);
  check('las 2 RPC del servicio están ligadas', ligados(ejecutable), 2);
  check('ningún supabase.rpc extraído sin ligar', desligado(ejecutable), false);
  check('control: la guarda caza el patrón desligado',
    desligado(ejecutable.replace('supabase.rpc.bind(supabase)', 'supabase.rpc')), true);

  const home = fs.readFileSync(path.join('src', 'pages', 'home', 'page.tsx'), 'utf8');
  check('Home no llama a directory_territory_units', home.includes('directory_territory_units'), false);
}

fs.rmSync(out, { force: true });

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
