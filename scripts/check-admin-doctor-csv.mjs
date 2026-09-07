#!/usr/bin/env node
/**
 * check-admin-doctor-csv.mjs — ADMIN-DOCTOR-EXPORT-P0
 *
 * Prueba CONDUCTUAL del CSV de médicos: transpila el servicio REAL con esbuild
 * y ejecuta `buildDoctorsCsv` sobre filas sintéticas. No lee texto: mide lo que
 * el archivo contiene de verdad. No toca red ni base de datos.
 *
 *   node scripts/check-admin-doctor-csv.mjs
 */
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`); }
};

console.log('\ncheck-admin-doctor-csv — export CSV de la base de médicos\n');

// `--packages=external` deja las dependencias fuera: empaquetar el cliente de
// Supabase rompe con `Dynamic require of "stream"`, porque es CJS. El bundle se
// escribe dentro del repo (node_modules/.cache, ignorado) para que Node resuelva
// esas dependencias desde su sitio real.
const cacheDir = path.join('node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const out = path.join(cacheDir, `doccsv-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
execFileSync(process.execPath, [
  esbuildBin, 'src/services/admin.service.ts',
  '--bundle', '--format=esm', '--platform=node', '--packages=external',
  // El alias `@/` vive solo en vite.config.ts, no en tsconfig, así que esbuild
  // no lo conoce y trataría `@/lib/csv` como un paquete externo inexistente.
  '--alias:@/lib=./src/lib',
  '--define:import.meta.env.VITE_SUPABASE_URL="https://fixture.supabase.co"',
  '--define:import.meta.env.VITE_SUPABASE_ANON_KEY="fixture-anon-key"',
  '--define:import.meta.env.VITE_CAPTCHA_ENABLED=""',
  '--define:import.meta.env.VITE_TURNSTILE_SITE_KEY=""',
  `--outfile=${out}`,
], { stdio: 'pipe' });
const svc = await import(pathToFileURL(out).href);

const fila = (over = {}) => ({
  full_name: 'Dra. Ana Pérez',
  specialty: 'Cardiología',
  phone: '50370000000',
  email: 'ana@example.test',
  clinic_name: 'Clínica Central',
  clinic_address: 'Av. Siempre Viva 123',
  department: 'San Salvador',
  municipality: 'Soyapango',
  lucy_status: 'listed_only',
  reclamado: false,
  verificado: false,
  publicado: false,
  agenda: false,
  operativo: false,
  created_at: '2026-08-02T13:49:49.181225-06:00',
  slug: null,
  // s7_86 · onboarding
  onb_stage: 'not_published',
  onb_next_action: 'owner_publish',
  booking_ready: false,
  ...over,
});

const parse = async (rows) => {
  const texto = await svc.buildDoctorsCsv(rows).text();
  const lineas = texto.replace(/^﻿/, '').split('\r\n');
  const split = (linea) => {
    const out = []; let cur = ''; let dentro = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (c === '"') { if (dentro && linea[i + 1] === '"') { cur += '"'; i++; } else dentro = !dentro; }
      else if (c === ',' && !dentro) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  };
  return { headers: split(lineas[0]), datos: lineas.slice(1).map(split), lineas };
};
const col = (h, d, nombre) => d[h.indexOf(nombre)];

// ─── 1 · las 15 columnas exactas, en orden ──────────────────
console.log('1. Columnas');
{
  const { headers } = await parse([fila()]);
  const esperadas = ['Nombre', 'Especialidad', 'Teléfono', 'Correo', 'Clínica',
    'Dirección de clínica', 'Departamento de clínica', 'Municipio de clínica',
    'Estado LucyCare', 'Perfil reclamado', 'Verificado en LucyCare', 'Publicado',
    'Agenda habilitada', 'Operativo', 'Fecha de alta en LucyCare',
    'Slug', 'URL pública',
    'Onboarding', 'Próxima acción', 'Listo para reservas'];
  check('son exactamente 20', headers.length, 20);
  check('en el orden aprobado', headers.join('|'), esperadas.join('|'));
  // Comparación por PALABRA, no por subcadena: `includes('id')` daría un falso
  // positivo con «Especialidad», que sí debe estar.
  const palabras = new Set(
    headers.flatMap(h => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/))
  );
  // `slug` salió de esta lista en ADMIN-DOCTOR-EXPORT-URL-P0: pasó de dato
  // técnico prohibido a columna aprobada. La lista describe lo que NO debe
  // salir hoy, no lo que alguna vez estuvo vedado.
  for (const prohibida of ['id', 'uuid', 'licencia', 'jvpm', 'bio', 'avatar', 'tos', 'stripe', 'token']) {
    check(`no expone «${prohibida}»`, palabras.has(prohibida), false);
  }
  check('sí conserva «Especialidad»', headers.includes('Especialidad'), true);
  check('sí expone «Slug» (aprobado en URL-P0)', headers.includes('Slug'), true);
}

// ─── 2 · fechas ─────────────────────────────────────────────
console.log('\n2. Fecha de alta');
{
  const { headers, datos } = await parse([fila()]);
  const v = col(headers, datos[0], 'Fecha de alta en LucyCare');
  check('DD/MM/YYYY HH:mm', v, '02/08/2026 13:49');
  check('sin la T de ISO', /T/.test(v), false);
  check('sin segundos ni microsegundos', /:\d{2}:\d{2}|\.\d+/.test(v), false);
  check('sin offset', /[+-]\d{2}:\d{2}$/.test(v), false);
  check('sin coma', /,/.test(v), false);
}
{
  // UTC que cruza el día al convertir a El Salvador (UTC-6)
  const { headers, datos } = await parse([fila({ created_at: '2026-08-03T03:15:00.000Z' })]);
  check('03:15Z → 21:15 del día anterior', col(headers, datos[0], 'Fecha de alta en LucyCare'), '02/08/2026 21:15');
}
{
  const { headers, datos } = await parse([fila({ created_at: '2026-08-02T06:15:00Z' })]);
  check('medianoche → 00:15, no 24:15', col(headers, datos[0], 'Fecha de alta en LucyCare'), '02/08/2026 00:15');
}
{
  const { headers, datos } = await parse([fila({ created_at: 'no-es-fecha' })]);
  check('fecha inválida conserva el original', col(headers, datos[0], 'Fecha de alta en LucyCare'), 'no-es-fecha');
}

// ─── 3 · NULL → celda vacía ─────────────────────────────────
console.log('\n3. NULL / vacío');
{
  const { headers, datos } = await parse([fila({
    email: null, clinic_address: null, department: null, municipality: null,
    phone: null, specialty: null,
  })]);
  for (const c of ['Correo', 'Dirección de clínica', 'Departamento de clínica',
                   'Municipio de clínica', 'Teléfono', 'Especialidad']) {
    check(`${c} vacío`, col(headers, datos[0], c), '');
  }
}

// ─── 4 · Sí/No y estado traducido ───────────────────────────
console.log('\n4. Booleanos y estado');
{
  const { headers, datos } = await parse([fila({
    lucy_status: 'verified', reclamado: true, verificado: true,
    publicado: true, agenda: true, operativo: false,
  })]);
  check('Estado LucyCare traducido', col(headers, datos[0], 'Estado LucyCare'), 'Verificado');
  check('Perfil reclamado', col(headers, datos[0], 'Perfil reclamado'), 'Sí');
  check('Verificado en LucyCare', col(headers, datos[0], 'Verificado en LucyCare'), 'Sí');
  check('Publicado', col(headers, datos[0], 'Publicado'), 'Sí');
  check('Agenda habilitada', col(headers, datos[0], 'Agenda habilitada'), 'Sí');
  check('Operativo false → No', col(headers, datos[0], 'Operativo'), 'No');
}

// ─── s7_86 · las tres columnas de onboarding ─────────────
{
  console.log('\nonboarding (s7_86)');
  const { headers, datos } = await parse([
    fila({ onb_stage: 'pending_claim', onb_next_action: 'doctor_claim', booking_ready: false }),
    fila({ onb_stage: 'complete', onb_next_action: 'none', booking_ready: true }),
  ]);
  check('etapa traducida al español', col(headers, datos[0], 'Onboarding'), 'Pendiente de reclamar');
  check('próxima acción traducida', col(headers, datos[0], 'Próxima acción'), 'El médico debe reclamar su perfil');
  check('booking_ready false → No', col(headers, datos[0], 'Listo para reservas'), 'No');
  check('etapa complete', col(headers, datos[1], 'Onboarding'), 'Completo');
  // 'none' mapea a cadena vacía: un CSV no debe decir «ninguna acción».
  check('sin próxima acción → celda vacía', col(headers, datos[1], 'Próxima acción'), '');
  check('booking_ready true → Sí', col(headers, datos[1], 'Listo para reservas'), 'Sí');
}
{
  // Código desconocido: se escribe crudo en vez de dejar la celda vacía. Un
  // hueco silencioso ocultaría una etapa nueva sin traducir.
  const { headers, datos } = await parse([fila({ onb_stage: 'etapa_futura' })]);
  check('etapa desconocida conserva el código', col(headers, datos[0], 'Onboarding'), 'etapa_futura');
}
{
  const { headers, datos } = await parse([fila({ lucy_status: 'booking_enabled' })]);
  check('booking_enabled traducido', col(headers, datos[0], 'Estado LucyCare'), 'Con agenda');
  check('no expone el enum crudo', /booking_enabled/.test(datos[0].join(',')), false);
}

// ─── 5 · caracteres españoles ───────────────────────────────
console.log('\n5. Caracteres españoles');
{
  const { headers, datos, lineas } = await parse([fila({
    full_name: 'Dr. Íñigo Muñoz Ávila', clinic_name: 'Clínica San José — Ñ',
  })]);
  check('tildes y eñes intactas', col(headers, datos[0], 'Nombre'), 'Dr. Íñigo Muñoz Ávila');
  check('em dash y ñ en clínica', col(headers, datos[0], 'Clínica'), 'Clínica San José — Ñ');
  check('encabezados con tilde', lineas[0].includes('Teléfono'), true);
}

// ─── 6 · CSV / formula injection y RFC 4180 ─────────────────
console.log('\n6. Protección CSV');
{
  const { headers, datos } = await parse([fila({
    full_name: '=1+1', phone: '+50378000000', clinic_name: '@SUM(A1)', specialty: '-2+3',
  })]);
  check('=1+1 neutralizado', col(headers, datos[0], 'Nombre'), "'=1+1");
  check('+503 neutralizado', col(headers, datos[0], 'Teléfono'), "'+50378000000");
  check('@SUM neutralizado', col(headers, datos[0], 'Clínica'), "'@SUM(A1)");
  check('-2+3 neutralizado', col(headers, datos[0], 'Especialidad'), "'-2+3");
}
{
  const { headers, datos } = await parse([fila({ full_name: 'Pérez, Ana "La Dra."' })]);
  check('coma y comillas RFC 4180', col(headers, datos[0], 'Nombre'), 'Pérez, Ana "La Dra."');
}
{
  const bytes = new Uint8Array(await svc.buildDoctorsCsv([fila()]).arrayBuffer());
  check('BOM EF BB BF en los bytes',
    `${bytes[0].toString(16)} ${bytes[1].toString(16)} ${bytes[2].toString(16)}`, 'ef bb bf');
  const texto = await svc.buildDoctorsCsv([fila(), fila()]).text();
  check('saltos CRLF', texto.split('\r\n').length, 3);
}

// ─── 7 · volumen: 10 000 filas ──────────────────────────────
console.log('\n7. Volumen');
{
  const muchas = Array.from({ length: 10000 }, (_, i) => fila({ full_name: `Médico ${i}` }));
  const t0 = Date.now();
  const texto = await svc.buildDoctorsCsv(muchas).text();
  const ms = Date.now() - t0;
  check('10 000 filas + encabezado', texto.split('\r\n').length, 10001);
  check(`serializa en menos de 5 s (${ms} ms)`, ms < 5000, true);
  check('tope exportado por el servicio', svc.DOCTOR_EXPORT_MAX, 10000);
}

// ─── 7.bis · Slug y URL pública ─────────────────────────────
console.log('\n7.bis Slug y URL pública');
{
  // publicado CON slug → las dos columnas llenas
  const { headers, datos } = await parse([fila({ slug: 'dra-ana-perez', publicado: true })]);
  check('Slug tal cual', col(headers, datos[0], 'Slug'), 'dra-ana-perez');
  check('URL pública completa', col(headers, datos[0], 'URL pública'), 'https://lucycare.app/doctor/dra-ana-perez');
  check('dominio exacto de producción', /^https:\/\/lucycare\.app\/doctor\//.test(col(headers, datos[0], 'URL pública')), true);
  check('sin origen de Preview', /vercel\.app/.test(datos[0].join(',')), false);
}
{
  // NO publicado CON slug → slug sí, URL vacía. El slug queda congelado cuando
  // se despublica, y esa URL renderizaría «Médico no encontrado».
  const { headers, datos } = await parse([fila({ slug: 'dr-fidel-hernandez', publicado: false })]);
  check('Slug presente aunque no esté publicado', col(headers, datos[0], 'Slug'), 'dr-fidel-hernandez');
  check('URL pública VACÍA si no está publicado', col(headers, datos[0], 'URL pública'), '');
  check('no escribe la URL a medias', /lucycare\.app/.test(datos[0].join(',')), false);
}
{
  // sin slug → ambas vacías, publicado o no
  const a = await parse([fila({ slug: null, publicado: true })]);
  check('sin slug + publicado → Slug vacío', col(a.headers, a.datos[0], 'Slug'), '');
  check('sin slug + publicado → URL vacía', col(a.headers, a.datos[0], 'URL pública'), '');
  const b = await parse([fila({ slug: '', publicado: true })]);
  check('slug cadena vacía → Slug vacío', col(b.headers, b.datos[0], 'Slug'), '');
  check('slug cadena vacía → URL vacía', col(b.headers, b.datos[0], 'URL pública'), '');
  const c = await parse([fila({ slug: '   ', publicado: true })]);
  check('slug solo espacios → URL vacía', col(c.headers, c.datos[0], 'URL pública'), '');
  const d = await parse([fila({ slug: undefined, publicado: true })]);
  check('slug undefined → ambas vacías',
    col(d.headers, d.datos[0], 'Slug') + '|' + col(d.headers, d.datos[0], 'URL pública'), '|');
}
{
  // NO se genera slug a partir del nombre: si no viene, no se inventa.
  const { headers, datos } = await parse([fila({ full_name: 'Dra. Ana Pérez', slug: null, publicado: true })]);
  check('no reconstruye el slug desde el nombre', /ana-perez|dra-ana/.test(datos[0].join(',')), false);
  check('la celda Slug queda vacía', col(headers, datos[0], 'Slug'), '');
}
{
  // El servicio no debe usar el origen del navegador en ninguna forma.
  const src = fs.readFileSync('src/services/admin.service.ts', 'utf8');
  // SIN comentarios: el propio comentario del servicio explica que NO se usa
  // `window.location.origin`, y buscarlo en el texto crudo se delataría solo.
  // Es la misma lección de s7_77, aplicada al frontend.
  const ejecutable = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('no usa window.location.origin', /window\.location\.origin/.test(ejecutable), false);
  check('dominio como constante literal', /const LUCYCARE_PUBLIC_ORIGIN = 'https:\/\/lucycare\.app'/.test(src), true);
  check('la URL exige slug Y publicado', /if \(!slug \|\| !row\.publicado\) return '';/.test(src), true);
}

// ─── 8 · el export de pacientes NO se tocó ──────────────────
console.log('\n8. Aislamiento del frente de pacientes');
{
  const pac = fs.readFileSync('src/services/patientCrm.service.ts', 'utf8');
  check('patientCrm.service.ts no menciona médicos', /buildDoctorsCsv|admin_export_doctors/.test(pac), false);
  const csv = fs.readFileSync('src/lib/csv.ts', 'utf8');
  check('src/lib/csv.ts sin lógica de fechas', /Intl\.DateTimeFormat|El_Salvador/.test(csv), false);
}

try { fs.unlinkSync(out); } catch { /* cache */ }

console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${pass} PASS · ${fail} FAIL`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail === 0 ? 0 : 1);
