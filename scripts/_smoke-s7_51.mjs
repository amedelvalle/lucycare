/**
 * SMOKE s7_51 — lista de espera del panel (médico + asistente).
 *
 * Sesiones reales (OTP Test Phones): Camilo (médico dueño de su clínica) + test
 * patient (50375000001, usado como asistente temporal de la clínica de Camilo).
 * Admin (service_role) solo para fixtures aisladas + verificación + cleanup.
 *
 * NOTA: el gate es por médico/clínica, así que probar el camino del médico
 * requiere una sesión de médico real → se usa la clínica de Camilo como host
 * (solo LECTURA de sus entradas reales + fixtures F51_FIXTURE + membresía de
 * asistente TEMPORAL que se elimina en cleanup). 0 entradas reales mutadas;
 * identidad de Camilo intacta. Jamás Katherine.
 *
 * Cubre: T1 médico ve su lista · T2 médico NO ve otra · T3 update (contactado)
 * + audit · T4 update cross-doctor bloqueado · T5 no-miembro bloqueado · T6
 * asistente ve la lista permitida · T7 asistente update · T8 estado inválido.
 *
 * Uso: node scripts/_smoke-s7_51.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const CAMILO_PHONE = '50378627694';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5';
const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const PATIENT_PHONE = '50375000001';
const OTP = '123456';
const TAG = 'F51_FIXTURE';

const camilo = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const patient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

let patientId = null, otherDoctor = null, entryA = null, entryB = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

async function cleanup() {
  try {
    await admin.from('waitlist_entries').delete().like('patient_name', `${TAG}%`);
    if (patientId) await admin.from('clinic_members').delete().eq('clinic_id', CAMILO_CLINIC).eq('profile_id', patientId);
  } catch { /* best-effort */ }
}

console.log('═══ SMOKE s7_51 (lista de espera del panel) ═══\n');

try {
  await login(camilo, CAMILO_PHONE);
  patientId = await login(patient, PATIENT_PHONE);

  // Otro médico publicado (≠ Camilo) para probar aislamiento cross-doctor.
  {
    const { data } = await admin.from('doctors').select('id').eq('is_published', true).neq('id', CAMILO_DOCTOR).limit(1);
    otherDoctor = data?.[0]?.id ?? null;
    if (!otherDoctor) throw new Error('No hay otro médico publicado para el test cross-doctor.');
  }

  await cleanup(); // estado limpio previo

  // Fixtures aisladas (insert directo service_role; phone_norm cumple el CHECK).
  {
    const { data: a, error: ea } = await admin.from('waitlist_entries').insert({
      doctor_id: CAMILO_DOCTOR, patient_name: `${TAG} A`, patient_phone: '+50370000051',
      patient_phone_normalized: '50370000051', status: 'pending', patient_message: 'quiero cita',
    }).select('id').single();
    if (ea) throw new Error('insert fixture A: ' + ea.message);
    entryA = a.id;

    const { data: b, error: eb } = await admin.from('waitlist_entries').insert({
      doctor_id: otherDoctor, patient_name: `${TAG} B`, patient_phone: '+50370000052',
      patient_phone_normalized: '50370000052', status: 'pending',
    }).select('id').single();
    if (eb) throw new Error('insert fixture B: ' + eb.message);
    entryB = b.id;
  }

  // ── T1. Médico ve su propia lista (incluye fixture A) ──
  {
    const { data, error } = await camilo.rpc('clinic_list_waitlist', { p_doctor_id: CAMILO_DOCTOR });
    const rows = data ?? [];
    const found = rows.some((r) => r.id === entryA);
    const hasTotal = rows.length > 0 && rows[0].total_count != null;
    if (!error && found && hasTotal) ok(`T1 médico ve su lista (fixture A presente, total_count=${rows[0].total_count})`);
    else ko(`T1 médico no vio su fixture: error=${error?.message}, found=${found}, hasTotal=${hasTotal}`);
  }

  // ── T2. Médico NO ve la lista de otro médico ──
  {
    const { error } = await camilo.rpc('clinic_list_waitlist', { p_doctor_id: otherDoctor });
    if (error && (error.code === 'P0001' || /No autorizado/i.test(error.message))) ok('T2 médico NO ve lista de otro médico (P0001)');
    else ko('T2 cross-doctor NO bloqueado: ' + JSON.stringify(error));
  }

  // ── T3. Médico marca contactado + nota → audit ──
  {
    const { error } = await camilo.rpc('clinic_update_waitlist_entry', { p_entry_id: entryA, p_status: 'contacted', p_notes: 'Contactado por teléfono (F51)' });
    const { data: row } = await admin.from('waitlist_entries').select('status, contacted_at, notes').eq('id', entryA).single();
    const { count: auditCount } = await admin.from('audit_log').select('id', { count: 'exact', head: true })
      .eq('record_id', entryA).eq('table_name', 'waitlist_entries');
    const okT3 = !error && row?.status === 'contacted' && !!row.contacted_at && !!row.notes?.includes('F51') && (auditCount ?? 0) >= 1;
    if (okT3) ok(`T3 médico marca contactado + nota + audit (contacted_at set, auditRows=${auditCount})`);
    else ko(`T3 update inconsistente: error=${error?.message}, row=${JSON.stringify(row)}, audit=${auditCount}`);
  }

  // ── T4. Médico NO puede actualizar entrada de otro médico ──
  {
    const { error } = await camilo.rpc('clinic_update_waitlist_entry', { p_entry_id: entryB, p_status: 'contacted' });
    const { data: row } = await admin.from('waitlist_entries').select('status').eq('id', entryB).single();
    if (error && (error.code === 'P0001' || /No autorizado/i.test(error.message)) && row?.status === 'pending') ok('T4 update cross-doctor bloqueado (P0001, fixture B intacta)');
    else ko(`T4 cross-doctor update NO bloqueado: error=${error?.message}, statusB=${row?.status}`);
  }

  // ── T5. Usuario NO miembro (paciente sin membresía) → bloqueado ──
  {
    const { error } = await patient.rpc('clinic_list_waitlist', { p_doctor_id: CAMILO_DOCTOR });
    if (error && (error.code === 'P0001' || /No autorizado/i.test(error.message))) ok('T5 no-miembro NO puede leer la lista (P0001)');
    else ko('T5 no-miembro NO fue bloqueado: ' + JSON.stringify(error));
  }

  // ── T6. Asistente de la clínica SÍ ve la lista ──
  {
    await admin.from('clinic_members').insert({ clinic_id: CAMILO_CLINIC, profile_id: patientId, role: 'assistant', is_active: true });
    const { data, error } = await patient.rpc('clinic_list_waitlist', { p_doctor_id: CAMILO_DOCTOR });
    const found = (data ?? []).some((r) => r.id === entryA);
    if (!error && found) ok('T6 asistente de la clínica ve la lista (fixture A presente)');
    else ko(`T6 asistente no vio la lista: error=${error?.message}, found=${found}`);
  }

  // ── T7. Asistente actualiza estado (vuelve a pending) ──
  {
    const { error } = await patient.rpc('clinic_update_waitlist_entry', { p_entry_id: entryA, p_status: 'pending' });
    const { data: row } = await admin.from('waitlist_entries').select('status, contacted_at').eq('id', entryA).single();
    if (!error && row?.status === 'pending' && row.contacted_at === null) ok('T7 asistente actualiza estado (volvió a pending, contacted_at limpio)');
    else ko(`T7 asistente update inconsistente: error=${error?.message}, row=${JSON.stringify(row)}`);
  }

  // ── T8. Estado inválido → P0105 ──
  {
    const { error } = await camilo.rpc('clinic_update_waitlist_entry', { p_entry_id: entryA, p_status: 'bogus' });
    if (error && (error.code === 'P0105' || /Estado inválido/i.test(error.message))) ok('T8 estado inválido rechazado (P0105)');
    else ko('T8 estado inválido NO rechazado: ' + JSON.stringify(error));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  await cleanup();
  let residuals = 0;
  try {
    const { count: wl } = await admin.from('waitlist_entries').select('id', { count: 'exact', head: true }).like('patient_name', `${TAG}%`);
    residuals += wl ?? 0;
    if (patientId) {
      const { count: cm } = await admin.from('clinic_members').select('id', { count: 'exact', head: true }).eq('clinic_id', CAMILO_CLINIC).eq('profile_id', patientId);
      residuals += cm ?? 0;
    }
    if (residuals === 0) ok('cleanup: 0 residuales F51_FIXTURE (entries + membresía temporal)');
    else ko(`cleanup: ${residuals} residuales`);
  } catch (e) { ko('verificación de residuales falló: ' + e.message); }

  await camilo.auth.signOut().catch(() => {});
  await patient.auth.signOut().catch(() => {});
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_51 OK' : '❌ SMOKE s7_51 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
