/**
 * SMOKE s7_41 — Lista de espera global cross-médicos (admin_list_waitlist).
 *
 * Corre con la SESIÓN del ADMIN de plataforma (test phone 50378056365) para
 * que el gate is_admin() pase. Crea fixtures aisladas en DOS médicos distintos
 * (Camilo + otro doctor cualquiera) vía service_role (bypass RLS), y valida la
 * lectura cross-doctor + filtros + total_count + cambio de estado. Limpia todo
 * en finally (cleanup obligatorio — sin datos basura).
 *
 * Cubre:
 *  1. Sin filtros → trae entries de AMBOS médicos (cross-doctor) + total_count.
 *  2. Filtro por médico (p_doctor_id) → solo ese médico.
 *  3. Filtro por estado (pending) → solo pendientes.
 *  4. Búsqueda por nombre de paciente.
 *  5. Búsqueda por teléfono crudo (8 dígitos) → match contra phone_normalized.
 *  6. Rango de fechas (date_to inclusivo: hoy debe incluir lo creado hoy).
 *  7. Join: doctor_name presente.
 *  8. Cambio de estado vía admin_update_waitlist_entry (reutilizado) → contacted.
 *  9. Autorización: sesión de paciente (no admin) → rechazo.
 *
 * Uso (SOLO después de aplicar s7_41): node scripts/_smoke-s7_41.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const PATIENT_PHONE = '50375000001';
const OTP = '123456';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5';

// Fixtures: teléfonos/marcadores improbables.
const A_NAME = 'S741 Alfa Paciente';
const A_PHONE_DISP = '7000 9101';
const A_PHONE_NORM = '50370009101';
const A_LOCAL = '70009101';
const B_NAME = 'S741 Beta Paciente';
const B_PHONE_DISP = '+503 7000-9102';
const B_PHONE_NORM = '50370009102';

const adminCli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const patient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

let aId = null, bId = null, otherDoctor = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

const call = (client, args) => client.rpc('admin_list_waitlist', args);
const today = new Date().toISOString().slice(0, 10);

console.log('═══ SMOKE s7_41 (admin_list_waitlist) ═══\n');

try {
  await login(adminCli, ADMIN_PHONE);
  await login(patient, PATIENT_PHONE);

  // Otro médico distinto a Camilo.
  const { data: od, error: odErr } = await admin
    .from('doctors').select('id').neq('id', CAMILO_DOCTOR).limit(1).single();
  if (odErr || !od) throw new Error('No hay otro médico para el fixture: ' + (odErr?.message || 'vacío'));
  otherDoctor = od.id;

  // Fixture A → Camilo (pending).
  const { data: a, error: ea } = await admin.from('waitlist_entries').insert({
    doctor_id: CAMILO_DOCTOR, patient_name: A_NAME,
    patient_phone: A_PHONE_DISP, patient_phone_normalized: A_PHONE_NORM,
    patient_message: 'fixture A', status: 'pending', source: 'public_directory',
  }).select('id').single();
  if (ea) throw new Error('insert A falló: ' + ea.message);
  aId = a.id;

  // Fixture B → otro médico (pending).
  const { data: b, error: eb } = await admin.from('waitlist_entries').insert({
    doctor_id: otherDoctor, patient_name: B_NAME,
    patient_phone: B_PHONE_DISP, patient_phone_normalized: B_PHONE_NORM,
    patient_message: 'fixture B', status: 'pending', source: 'public_directory',
  }).select('id').single();
  if (eb) throw new Error('insert B falló: ' + eb.message);
  bId = b.id;
  ok('Fixtures: entry A (Camilo) + entry B (otro médico)');

  const has = (rows, id) => (rows ?? []).some((r) => r.id === id);

  // 1. Sin filtros → ambos presentes + total_count numérico.
  {
    const { data, error } = await call(adminCli, { p_limit: 200 });
    if (error) ko('1 sin filtros error: ' + error.message);
    else if (has(data, aId) && has(data, bId) && typeof data[0]?.total_count !== 'undefined')
      ok('1 Cross-doctor: trae A y B + total_count presente');
    else ko('1 Cross-doctor falló (¿faltó A o B?): ' + JSON.stringify((data ?? []).map((r) => r.id)));
  }

  // 2. Filtro por médico → solo Camilo (A sí, B no).
  {
    const { data, error } = await call(adminCli, { p_doctor_id: CAMILO_DOCTOR, p_limit: 200 });
    if (error) ko('2 filtro médico error: ' + error.message);
    else if (has(data, aId) && !has(data, bId)) ok('2 Filtro por médico → solo ese médico');
    else ko('2 Filtro por médico falló: ' + JSON.stringify((data ?? []).map((r) => r.id)));
  }

  // 3. Filtro por estado pending → A y B presentes (ambos pending).
  {
    const { data, error } = await call(adminCli, { p_status: 'pending', p_limit: 200 });
    if (error) ko('3 filtro estado error: ' + error.message);
    else if (has(data, aId) && has(data, bId)) ok('3 Filtro estado=pending → incluye A y B');
    else ko('3 Filtro estado falló: ' + JSON.stringify((data ?? []).map((r) => r.id)));
  }

  // 4. Búsqueda por nombre de paciente (A).
  {
    const { data, error } = await call(adminCli, { p_search: 'S741 Alfa', p_limit: 200 });
    if (error) ko('4 search nombre error: ' + error.message);
    else if (has(data, aId) && !has(data, bId)) ok('4 Búsqueda por nombre → solo A');
    else ko('4 Búsqueda por nombre falló: ' + JSON.stringify((data ?? []).map((r) => r.id)));
  }

  // 5. Búsqueda por teléfono crudo (8 dígitos) → A por phone_normalized.
  {
    const { data, error } = await call(adminCli, { p_search: A_LOCAL, p_limit: 200 });
    if (error) ko('5 search teléfono error: ' + error.message);
    else if (has(data, aId) && !has(data, bId)) ok(`5 Búsqueda por teléfono crudo "${A_LOCAL}" → solo A`);
    else ko('5 Búsqueda por teléfono falló: ' + JSON.stringify((data ?? []).map((r) => r.id)));
  }

  // 6. Rango de fechas (date_to=hoy inclusivo) → A y B (creados hoy) presentes.
  {
    const { data, error } = await call(adminCli, { p_date_from: today, p_date_to: today, p_limit: 200 });
    if (error) ko('6 rango fechas error: ' + error.message);
    else if (has(data, aId) && has(data, bId)) ok('6 Rango fechas (date_to inclusivo) → incluye lo creado hoy');
    else ko('6 Rango fechas falló: ' + JSON.stringify((data ?? []).map((r) => r.id)));
  }

  // 7. Join: doctor_name presente en la fila de A.
  {
    const { data } = await call(adminCli, { p_doctor_id: CAMILO_DOCTOR, p_limit: 5 });
    const row = (data ?? []).find((r) => r.id === aId);
    if (row && typeof row.doctor_name === 'string' && row.doctor_name.length > 0)
      ok(`7 Join: doctor_name presente ("${row.doctor_name}")`);
    else ko('7 Join doctor_name ausente: ' + JSON.stringify(row));
  }

  // 8. Cambio de estado reutilizando admin_update_waitlist_entry → contacted.
  {
    const { error: uErr } = await adminCli.rpc('admin_update_waitlist_entry', {
      p_entry_id: aId, p_status: 'contacted', p_notes: 'smoke s7_41',
    });
    if (uErr) { ko('8 update estado error: ' + uErr.message); }
    else {
      const { data } = await call(adminCli, { p_status: 'contacted', p_limit: 200 });
      if (has(data, aId)) ok('8 Cambio de estado → A aparece como contacted');
      else ko('8 Cambio de estado: A no aparece en contacted');
    }
  }

  // 9. Autorización: paciente (no admin) → rechazo.
  {
    const { error } = await call(patient, { p_limit: 1 });
    if (error && (error.code === 'P0001' || /No autorizado/i.test(error.message)))
      ok('9 No-admin rechazado');
    else ko('9 No-admin NO fue rechazado: ' + JSON.stringify(error));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    if (aId) await admin.from('waitlist_entries').delete().eq('id', aId);
    if (bId) await admin.from('waitlist_entries').delete().eq('id', bId);
    await adminCli.auth.signOut().catch(() => {});
    await patient.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_41 OK' : '❌ SMOKE s7_41 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
