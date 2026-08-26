#!/usr/bin/env node
/**
 * check-crm-csv-fechas.mjs — formato de fecha/hora del export CSV del CRM.
 *
 * Prueba CONDUCTUAL, no textual: transpila el servicio REAL con esbuild y
 * ejecuta `buildPatientsCsv` sobre filas sintéticas. Es el mismo patrón que
 * usa `check-auth-p1d2.mjs` para medir el módulo real en vez de leer su texto.
 *
 * Cubre: microsegundos con offset -06:00 · UTC convertido a El Salvador ·
 * NULL/vacío · fecha inválida · el resto de columnas byte-equivalentes.
 *
 *   node scripts/check-crm-csv-fechas.mjs
 *
 * No toca la base de datos ni la red: el servicio se transpila con el cliente
 * de Supabase stubbeado.
 */
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`); }
};

console.log('\ncheck-crm-csv-fechas — formato DD/MM/YYYY HH:mm en el export\n');

// ─── transpilar el servicio REAL ────────────────────────────
// El cliente de Supabase se construye al importar el módulo, así que recibe
// credenciales SINTÉTICAS por --define (mismo patrón que check-auth-p1d2).
// No se abre ninguna conexión: `buildPatientsCsv` arma el archivo a partir de
// filas ya en memoria, sin tocar la red ni la base.
// `--packages=external` deja las dependencias fuera del bundle: empaquetar el
// cliente de Supabase rompe con `Dynamic require of "stream"`, porque es CJS.
// El bundle se escribe DENTRO del repo (en `node_modules/.cache`, ignorado por
// git) para que Node resuelva esas dependencias desde su sitio real.
const cacheDir = path.join('node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const out = path.join(cacheDir, `crmcsv-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
execFileSync(process.execPath, [
  esbuildBin, 'src/services/patientCrm.service.ts',
  '--bundle', '--format=esm', '--platform=node', '--packages=external',
  '--define:import.meta.env.VITE_SUPABASE_URL="https://fixture.supabase.co"',
  '--define:import.meta.env.VITE_SUPABASE_ANON_KEY="fixture-anon-key"',
  '--define:import.meta.env.VITE_CAPTCHA_ENABLED=""',
  '--define:import.meta.env.VITE_TURNSTILE_SITE_KEY=""',
  `--outfile=${out}`,
], { stdio: 'pipe' });
const svc = await import(pathToFileURL(out).href);

const fila = (over = {}) => ({
  profile_id: '11111111-2222-3333-4444-555555555555',
  full_name: 'Fixture QA',
  phone: '50300000000',
  email: 'fixture@example.test',
  crm_status: 'activo',
  created_at: '2026-08-02T13:49:49.181225-06:00',
  ultima_actividad: null,
  proxima_cita: null,
  citas_total: 3,
  atendidas: 2,
  medicos: 1,
  clinicas: 1,
  canal_primera_cita: 'lucy_directorio',
  tags: [],
  ...over,
});

/** Devuelve las celdas de la fila de datos (sin encabezado ni BOM). */
const celdas = async (row) => {
  const blob = svc.buildPatientsCsv([row]);
  const texto = await blob.text();
  const lineas = texto.replace(/^﻿/, '').split('\r\n');
  return { headers: lineas[0].split(','), datos: lineas[1], todas: lineas };
};

const col = (datos, headers, header) => {
  // parseo CSV mínimo, suficiente para estas filas (sin comas internas salvo comillas)
  const out = []; let cur = ''; let dentro = false;
  for (let i = 0; i < datos.length; i++) {
    const c = datos[i];
    if (c === '"') { if (dentro && datos[i + 1] === '"') { cur += '"'; i++; } else dentro = !dentro; }
    else if (c === ',' && !dentro) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out[headers.indexOf(header)];
};

// ─── 1 · microsegundos y offset -06:00 ──────────────────────
console.log('1. Timestamp con microsegundos y offset -06:00');
{
  const { datos, headers } = await celdas(fila());
  const v = col(datos, headers, 'Fecha de registro');
  check('formatea a DD/MM/YYYY HH:mm', v, '02/08/2026 13:49');
  check('sin la T de ISO', /T/.test(v), false);
  check('sin segundos', /:\d{2}:\d{2}/.test(v), false);
  check('sin microsegundos', /\.\d+/.test(v), false);
  check('sin offset', /[+-]\d{2}:\d{2}$/.test(v), false);
  check('sin coma (no fuerza entrecomillado)', /,/.test(v), false);
  check('sin 12 horas', /p\.\s?m\.|a\.\s?m\./i.test(v), false);
}

// ─── 2 · UTC convertido a El Salvador ───────────────────────
console.log('\n2. UTC convertido a hora de El Salvador (UTC-6)');
{
  // 03:15Z del día 3 es 21:15 del día 2 en El Salvador: cambia hora Y fecha.
  const { datos, headers } = await celdas(fila({ created_at: '2026-08-03T03:15:00.000Z' }));
  check('03:15Z → 21:15 del día anterior', col(datos, headers, 'Fecha de registro'), '02/08/2026 21:15');
}
{
  const { datos, headers } = await celdas(fila({ created_at: '2026-08-02T19:49:49Z' }));
  check('19:49Z → 13:49 mismo día', col(datos, headers, 'Fecha de registro'), '02/08/2026 13:49');
}
{
  // medianoche: hourCycle h23 debe dar 00, no 24
  const { datos, headers } = await celdas(fila({ created_at: '2026-08-02T06:15:00Z' }));
  check('medianoche → 00:15 (no 24:15)', col(datos, headers, 'Fecha de registro'), '02/08/2026 00:15');
}

// ─── 3 · NULL y vacío ───────────────────────────────────────
console.log('\n3. NULL / vacío');
{
  const { datos, headers } = await celdas(fila({ ultima_actividad: null, proxima_cita: undefined }));
  check('ultima_actividad null → celda vacía', col(datos, headers, 'Última actividad'), '');
  check('proxima_cita undefined → celda vacía', col(datos, headers, 'Próxima cita'), '');
}

// ─── 4 · fecha inválida ─────────────────────────────────────
console.log('\n4. Fecha inválida');
{
  const { datos, headers } = await celdas(fila({ created_at: 'no-es-una-fecha' }));
  check('conserva el valor original', col(datos, headers, 'Fecha de registro'), 'no-es-una-fecha');
  check('no escribe Invalid Date', /Invalid Date/.test(datos), false);
}

// ─── 5 · las demás columnas, byte-equivalentes ──────────────
console.log('\n5. Resto de columnas sin cambios');
{
  const base = fila({
    full_name: 'Ana Pérez',
    tags: ['vip', 'seguimiento'],
    crm_status: 'nuevo',
    ultima_actividad: '2026-08-01T10:00:00-06:00',
    proxima_cita: '2026-09-01T08:30:00-06:00',
  });
  const { datos, headers } = await celdas(base);
  check('ID LucyCare', col(datos, headers, 'ID LucyCare'), base.profile_id);
  check('Nombre', col(datos, headers, 'Nombre'), 'Ana Pérez');
  check('Teléfono', col(datos, headers, 'Teléfono'), '50300000000');
  check('Correo', col(datos, headers, 'Correo'), 'fixture@example.test');
  check('Estado CRM traducido', col(datos, headers, 'Estado CRM'), 'Nuevo');
  check('Total de citas', col(datos, headers, 'Total de citas'), '3');
  check('Total de atenciones', col(datos, headers, 'Total de atenciones'), '2');
  check('Médicos relacionados', col(datos, headers, 'Médicos relacionados'), '1');
  check('Clínicas relacionadas', col(datos, headers, 'Clínicas relacionadas'), '1');
  check('Canal 1.ª cita', col(datos, headers, 'Canal 1.ª cita'), 'lucy_directorio');
  check('Etiquetas con separador', col(datos, headers, 'Etiquetas'), 'vip | seguimiento');
  check('Última actividad formateada', col(datos, headers, 'Última actividad'), '01/08/2026 10:00');
  check('Próxima cita formateada', col(datos, headers, 'Próxima cita'), '01/09/2026 08:30');
  check('14 columnas', headers.length, 14);
}

// ─── 6 · protección contra inyección INTACTA ────────────────
console.log('\n6. Protección CSV / formula injection');
{
  const { datos, headers, todas } = await celdas(fila({ full_name: '=1+1', phone: '+50378000000' }));
  check('nombre =1+1 neutralizado con apóstrofo', col(datos, headers, 'Nombre'), "'=1+1");
  check('teléfono +503 neutralizado', col(datos, headers, 'Teléfono'), "'+50378000000");
  // El BOM se comprueba sobre los BYTES, no sobre `.text()`: ese método
  // decodifica UTF-8 y elimina el BOM por especificación, así que asertar
  // sobre el texto daría un falso FAIL aunque el archivo descargado sí lo
  // lleve. Son los tres bytes EF BB BF.
  const bytes = new Uint8Array(await svc.buildPatientsCsv([fila()]).arrayBuffer());
  check('BOM presente en los bytes (EF BB BF)',
    `${bytes[0].toString(16)} ${bytes[1].toString(16)} ${bytes[2].toString(16)}`, 'ef bb bf');
  check('salto CRLF', todas.length >= 2, true);
}
{
  const { datos, headers } = await celdas(fila({ full_name: 'Pérez, Ana "La Doctora"' }));
  check('coma y comillas escapadas RFC 4180', col(datos, headers, 'Nombre'), 'Pérez, Ana "La Doctora"');
}

try { fs.unlinkSync(out); } catch { /* tmp */ }

console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${pass} PASS · ${fail} FAIL`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail === 0 ? 0 : 1);
