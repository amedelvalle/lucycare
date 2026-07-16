/**
 * check-s7_60.mjs — verifica el hardening de grants sobre public.doctors.
 *
 *   node scripts/check-s7_60.mjs
 *
 * Qué verifica (todo con la ANON key — sin service_role):
 *   1. anon NO puede leer license_number
 *   2. anon NO puede leer is_operational
 *   3. anon NO puede leer tos_accepted_at
 *   4. anon SÍ puede leer las columnas del directorio (sin regresión)
 *   5. anon NO puede insertar en doctors
 *   6. anon NO puede actualizar doctors
 *
 * ── Por qué es seguro correrlo contra producción ──
 * Todas las pruebas filtran por un UUID inexistente, así que matchean CERO
 * filas. Postgres evalúa el privilegio de COLUMNA al planificar la query,
 * ANTES de filtrar filas: si falta el grant devuelve 42501; si sobra, devuelve
 * vacío. O sea que distingue perfectamente los dos estados SIN leer ni
 * modificar un solo dato real. Ningún JVPM real cruza la red.
 *
 * Antes de aplicar s7_60 este script debe FALLAR (los grants sobran).
 * Después de aplicarlo debe pasar 6/6. Ese es el A/B.
 */
import { supabaseAnon } from './_lib/supabase-anon.mjs';

const NOWHERE = '00000000-0000-0000-0000-000000000000';
const DENIED = '42501'; // insufficient_privilege

let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

/** Intenta leer `column` como anon sobre cero filas. */
async function probeSelect(column) {
  const { error } = await supabaseAnon
    .from('doctors')
    .select(column)
    .eq('id', NOWHERE);
  return error;
}

async function main() {
  console.log('\ncheck-s7_60 — grants de public.doctors\n');

  // ─── anon: columnas que NO debe ver ───────────────────────
  for (const col of ['license_number', 'is_operational', 'tos_accepted_at']) {
    const error = await probeSelect(col);
    if (error?.code === DENIED) {
      ok(`anon NO puede leer ${col} (42501 permission denied)`);
    } else if (error) {
      no(`anon ${col}: error inesperado ${error.code} — ${error.message}`);
    } else {
      no(`anon PUEDE leer ${col} — el grant sigue abierto (¿migración aplicada?)`);
    }
  }

  // ─── anon: columnas que SÍ necesita el directorio ─────────
  const publicCols =
    'id,slug,profile_id,clinic_id,specialty_id,bio,consultation_fee,' +
    'experience_years,languages,education,is_verified,lucy_status,' +
    'booking_enabled,is_published,created_at,updated_at';
  const selErr = await probeSelect(publicCols);
  if (!selErr) {
    ok('anon SÍ puede leer las 16 columnas del directorio (sin regresión)');
  } else {
    no(`anon perdió acceso a columnas públicas: ${selErr.code} — ${selErr.message}`);
  }

  // ─── anon: escritura ──────────────────────────────────────
  // NOTA: este test asserta el RESULTADO (anon no inserta), no el grant.
  // anon nunca satisface la policy doctors_insert (WITH CHECK profile_id =
  // auth.uid(), y auth.uid() es NULL) → la RLS lo bloquea con 42501 aunque
  // el grant esté abierto. Pasa antes y después de la migración; sirve como
  // no-regresión, no como prueba del grant. El grant de INSERT sí se prueba
  // de verdad en _smoke-s7_60 T21, con una sesión que sí puede satisfacer
  // la policy.
  const { error: insErr } = await supabaseAnon
    .from('doctors')
    .insert({ profile_id: NOWHERE, clinic_id: NOWHERE });
  if (insErr) {
    ok(`anon NO puede insertar en doctors (${insErr.code}; hoy vía RLS, tras s7_60 también vía grants)`);
  } else {
    no('anon PUDO insertar en doctors — CRÍTICO');
  }

  const { error: updErr } = await supabaseAnon
    .from('doctors')
    .update({ bio: 'probe' })
    .eq('id', NOWHERE);
  if (updErr?.code === DENIED) {
    ok('anon NO puede actualizar doctors (42501)');
  } else if (updErr) {
    ok(`anon NO puede actualizar doctors (${updErr.code} — ${updErr.message})`);
  } else {
    no('anon PUDO ejecutar un UPDATE sobre doctors — el grant sigue abierto');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_60: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e);
  process.exit(1);
});
