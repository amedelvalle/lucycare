/**
 * SMOKE s7_47 — F4-3-search: RPC `admin_list_patient_merge_candidates`.
 *
 * Sesión del admin de plataforma (50378056365 / OTP 123456) para la RPC
 * gated por is_admin(); service_role para fixtures/cleanup. Fixtures aisladas
 * en la clínica de Camilo, vinculadas a profiles de prueba (QA / Camilo);
 * cleanup en finally. READ-ONLY: la RPC no debe cambiar datos.
 *
 * Cubre:
 *  S1. Grupo E3 listado: 2 fichas mismo profile (QA) misma clínica, activas,
 *      no merged → aparece UN grupo con patient_count=2 + ambas fichas.
 *  S2. Conteos por ficha correctos (appointments/consultations/vitals).
 *  S3. Warning de links no confirmados: una ficha con link_confirmed_at NULL
 *      → has_unconfirmed_links=true + W_UNCONFIRMED_LINK + conteos confirmados.
 *  S4. Control profiles distintos: 2 fichas misma clínica, profiles distintos
 *      → NO agrupadas.
 *  S5. Control distinta clínica: 2 fichas mismo profile, clínicas distintas
 *      → NO agrupadas.
 *  S6. Control merged/inactiva: 2 fichas mismo profile pero una merged/inactiva
 *      → el grupo cae bajo 2 vivas → NO listado.
 *  S7. Control walk-ins sin profile (mismo teléfono): NO listados (profile NULL).
 *  S8. Read-only: la RPC no cambió ninguna ficha.
 *
 * Uso (SOLO tras aplicar s7_47): node scripts/_smoke-s7_47.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const QA_PHONE = '50375000099';
const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5';
const CAMILO_PROFILE = 'db1fba98-a299-4f25-82f1-7feff01e58fa';
const OTP = '123456';

const mk = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const login = async (cli, phone) => {
  await cli.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await cli.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error('OTP ' + phone + ': ' + (error?.message || 'sin sesión'));
  return data.user.id;
};

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

const adminCli = mk();
const qaCli = mk();
const created = { patients: [], appointments: [], consultations: [], vitals: [], availability: [] };

let PROFILE_MAIN = null;   // QA (cuenta de prueba)
let PROFILE_OTHER = null;  // admin (cuenta dedicada, SIN fichas de paciente) — perfil "distinto" aislado.
                           // NO usar el profile de Camilo: tiene una ficha real (Pepe Toro) y formaría un grupo legítimo.

const mkPatient = async (clinicId, name, { profileId = null, phone = null, active = true, confirmed = true } = {}) => {
  const { data, error } = await admin.from('patients').insert({
    clinic_id: clinicId, profile_id: profileId, full_name: name,
    document_type: 'dui', document_number: null, date_of_birth: '1990-01-01',
    gender: 'otro', patient_type: 'privado', phone, is_active: active,
    link_confirmed_at: (profileId && confirmed) ? new Date().toISOString() : null,
  }).select('id').single();
  if (error) throw new Error('fixture patient ' + name + ': ' + error.message);
  created.patients.push(data.id);
  return data.id;
};

// Helper: busca el grupo (clinic, profile) en el resultado de la RPC.
const findGroup = (groups, profileId, clinicId = CAMILO_CLINIC) =>
  (groups || []).find((g) => g.profile_id === profileId && g.clinic_id === clinicId);
const groupHasPatient = (g, pid) => (g?.patients || []).some((p) => p.id === pid);

console.log('═══ SMOKE s7_47 (candidatos a merge) ═══\n');

try {
  const adminUid = await login(adminCli, ADMIN_PHONE);
  PROFILE_MAIN = await login(qaCli, QA_PHONE);
  {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', adminUid).single();
    if (prof?.role !== 'admin') throw new Error('La cuenta ' + ADMIN_PHONE + ' no es admin (role=' + prof?.role + ')');
  }
  // Perfil "distinto" aislado para los controles = el del admin (cuenta dedicada,
  // sin fichas de paciente). Evita colisionar con grupos reales (p. ej. Camilo/Pepe).
  PROFILE_OTHER = adminUid;
  // El grupo E3 de QA podría ya existir por fichas previas; medimos el delta.
  const snapshot = async () => {
    const { data, error } = await adminCli.rpc('admin_list_patient_merge_candidates');
    if (error) throw new Error('RPC error: ' + error.message);
    return data || [];
  };

  // ════ S1 + S2 + S3: grupo E3 con conteos y warning de no-confirmada ════
  // Ficha A: confirmada, con expediente (appt + consulta + vitals).
  // Ficha B: NO confirmada (link_confirmed_at NULL) → dispara warning.
  const fichaA = await mkPatient(CAMILO_CLINIC, 'S747 A (confirmada)', { profileId: PROFILE_MAIN, confirmed: true });
  const fichaB = await mkPatient(CAMILO_CLINIC, 'S747 B (no confirmada)', { profileId: PROFILE_MAIN, confirmed: false });

  // Expediente en A (appt + vitals con disponibilidad; consulta firmada sin appt).
  const dowToday = new Date(Date.now() - 6 * 3600_000).getUTCDay();
  const dowTomorrow = (dowToday + 1) % 7;
  for (const dow of [dowToday, dowTomorrow]) {
    const { data: ar, error: arErr } = await admin.from('availability_rules').insert({
      doctor_id: CAMILO_DOCTOR, clinic_id: CAMILO_CLINIC, day_of_week: dow,
      start_time: '00:00:00', end_time: '23:59:59', is_active: true,
    }).select('id').single();
    if (arErr) throw new Error('fixture availability: ' + arErr.message);
    created.availability.push(ar.id);
  }
  const { data: st } = await admin.from('appointment_statuses').select('id').limit(1).single();
  const start = new Date(Date.now() + 3600_000);
  const { data: appt, error: apErr } = await admin.from('appointments').insert({
    clinic_id: CAMILO_CLINIC, doctor_id: CAMILO_DOCTOR, patient_id: fichaA,
    status_id: st.id, start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 30 * 60000).toISOString(), source: 'manual',
  }).select('id').single();
  if (apErr) throw new Error('fixture appointment: ' + apErr.message);
  created.appointments.push(appt.id);
  const { data: cons, error: cErr } = await admin.from('consultations').insert({
    clinic_id: CAMILO_CLINIC, doctor_id: CAMILO_DOCTOR, patient_id: fichaA,
    status: 'signed', signed_at: new Date().toISOString(), chief_complaint: 'S747',
  }).select('id').single();
  if (cErr) throw new Error('fixture consultation: ' + cErr.message);
  created.consultations.push(cons.id);
  const { data: vit, error: vErr } = await admin.from('vitals').insert({
    appointment_id: appt.id, patient_id: fichaA, heart_rate: 70,
  }).select('id').single();
  if (vErr) throw new Error('fixture vitals: ' + vErr.message);
  created.vitals.push(vit.id);

  {
    const groups = await snapshot();
    const g = findGroup(groups, PROFILE_MAIN);
    if (g && groupHasPatient(g, fichaA) && groupHasPatient(g, fichaB) && g.patient_count >= 2)
      ok('S1 grupo E3 listado (mismo profile QA, misma clínica, ambas fichas)');
    else ko('S1 grupo E3 no listado correctamente: ' + JSON.stringify(g));

    // S2 conteos de la ficha A
    const pa = (g?.patients || []).find((p) => p.id === fichaA);
    if (pa && pa.counts?.appointments === 1 && pa.counts?.consultations === 1 && pa.counts?.vitals === 1)
      ok('S2 conteos por ficha correctos (A: 1/1/1)');
    else ko('S2 conteos A inesperados: ' + JSON.stringify(pa?.counts));

    // S3 warning de link no confirmado
    const hasW = (g?.warnings || []).some((w) => w.code === 'W_UNCONFIRMED_LINK');
    if (g?.has_unconfirmed_links === true && g?.unconfirmed_links_count >= 1
        && g?.confirmed_links_count >= 1 && hasW)
      ok('S3 warning W_UNCONFIRMED_LINK + conteos confirmados/no-confirmados');
    else ko('S3 warning/conteos de links inesperados: ' + JSON.stringify({
      has: g?.has_unconfirmed_links, c: g?.confirmed_links_count, u: g?.unconfirmed_links_count, w: g?.warnings }));
  }

  // ════ S4. Control profiles distintos → nunca en el mismo grupo ════
  // Invariante robusto (no depende de si algún profile tiene otras fichas):
  // dos fichas con profile_id distinto JAMÁS comparten grupo.
  {
    const c1 = await mkPatient(CAMILO_CLINIC, 'S747 C prof QA', { profileId: PROFILE_MAIN });
    const c2 = await mkPatient(CAMILO_CLINIC, 'S747 C prof admin', { profileId: PROFILE_OTHER });
    const groups = await snapshot();
    const sharedGroup = (groups || []).find((g) => groupHasPatient(g, c1) && groupHasPatient(g, c2));
    if (!sharedGroup) ok('S4 fichas de profiles distintos NUNCA comparten grupo');
    else ko('S4 profiles distintos agrupados juntos: ' + JSON.stringify({ clinic: sharedGroup.clinic_id, profile: sharedGroup.profile_id }));
    // c1 sí debe estar en el grupo QA (junto a A/B)
    const gMain = findGroup(groups, PROFILE_MAIN);
    if (groupHasPatient(gMain, c1)) ok('S4 c1 (QA) sí está en el grupo de su propio profile');
    else ko('S4 c1 no apareció en el grupo de QA: ' + JSON.stringify(gMain));
  }

  // ════ S5. Control distinta clínica → no agrupada ════
  {
    const { data: otherClinics } = await admin.from('clinics').select('id').neq('id', CAMILO_CLINIC).limit(1);
    if (!otherClinics?.length) { ko('S5 no hay otra clínica'); }
    else {
      const d1 = await mkPatient(otherClinics[0].id, 'S747 D otra-clinica', { profileId: PROFILE_MAIN });
      const groups = await snapshot();
      const gOtherClinic = findGroup(groups, PROFILE_MAIN, otherClinics[0].id);
      // d1 solo en otra clínica (1 ficha) → no grupo allí; y no contamina el grupo de Camilo.
      const gMain = findGroup(groups, PROFILE_MAIN, CAMILO_CLINIC);
      if ((!gOtherClinic || !groupHasPatient(gOtherClinic, d1)) && !groupHasPatient(gMain, d1))
        ok('S5 misma persona en clínica distinta NO se agrupa cross-clínica');
      else ko('S5 cross-clínica se agrupó indebidamente');
    }
  }

  // ════ S6. Control merged/inactiva NO aparece en ningún grupo ════
  // Invariante robusto del filtro `is_active = true AND merged_into IS NULL`:
  // una ficha inactiva o fusionada NUNCA debe figurar en los candidatos,
  // sin importar qué otras fichas existan.
  {
    const m2 = await mkPatient(CAMILO_CLINIC, 'S747 E inactiva', { profileId: PROFILE_OTHER, active: false });
    // m3: fusionada (shell) — mismo profile, marcada merged_into hacia m2 e inactiva.
    const m3 = await mkPatient(CAMILO_CLINIC, 'S747 E merged', { profileId: PROFILE_OTHER });
    await admin.from('patients').update({ merged_into_patient_id: m2, is_active: false }).eq('id', m3);

    const groups = await snapshot();
    const m2Listed = (groups || []).some((gr) => (gr.patients || []).some((p) => p.id === m2));
    const m3Listed = (groups || []).some((gr) => (gr.patients || []).some((p) => p.id === m3));
    if (!m2Listed) ok('S6 ficha INACTIVA no aparece en ningún grupo candidato');
    else ko('S6 ficha inactiva apareció en candidatos');
    if (!m3Listed) ok('S6 ficha FUSIONADA (merged_into) no aparece en ningún grupo candidato');
    else ko('S6 ficha fusionada apareció en candidatos');
  }

  // ════ S7. Control walk-ins sin profile (mismo teléfono) → no listados ════
  {
    const w1 = await mkPatient(CAMILO_CLINIC, 'S747 walkin 1', { profileId: null, phone: '50370000747' });
    const w2 = await mkPatient(CAMILO_CLINIC, 'S747 walkin 2', { profileId: null, phone: '50370000747' });
    const groups = await snapshot();
    const listed = (groups || []).some((g) => (g.patients || []).some((p) => p.id === w1 || p.id === w2));
    if (!listed) ok('S7 walk-ins sin profile (mismo teléfono) NO aparecen (no hay candidatos por teléfono)');
    else ko('S7 ¡walk-ins por teléfono se listaron!');
  }

  // ════ S8. Read-only: una llamada a la RPC no muta el estado ════
  // Snapshot de los campos mutables ANTES y DESPUÉS de una llamada extra a la
  // RPC; deben ser idénticos (la RPC es STABLE/SELECT-only).
  {
    const cols = 'id, is_active, merged_into_patient_id, profile_id, link_confirmed_at, full_name, document_number, updated_at';
    const snap = async () => {
      const { data } = await admin.from('patients').select(cols).in('id', created.patients).order('id');
      return JSON.stringify(data ?? []);
    };
    const before = await snap();
    await adminCli.rpc('admin_list_patient_merge_candidates');  // llamada extra aislada
    const after = await snap();
    if (before === after) ok('S8 read-only: la RPC no mutó ninguna ficha (estado idéntico antes/después)');
    else ko('S8 ¡la RPC cambió datos!');
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    for (const id of created.vitals) await admin.from('vitals').delete().eq('id', id);
    for (const id of created.appointments) await admin.from('appointments').delete().eq('id', id);
    for (const id of created.consultations) await admin.from('consultations').delete().eq('id', id);
    for (const id of created.availability) await admin.from('availability_rules').delete().eq('id', id);
    // Romper auto-referencias merged_into antes de borrar (FK NO ACTION).
    for (const id of created.patients) await admin.from('patients').update({ merged_into_patient_id: null }).eq('id', id);
    for (const id of created.patients) await admin.from('patients').delete().eq('id', id);
    await adminCli.auth.signOut().catch(() => {});
    await qaCli.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_47 OK' : '❌ SMOKE s7_47 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
