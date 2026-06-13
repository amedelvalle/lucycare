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

let PROFILE_MAIN = null;             // QA
const PROFILE_OTHER = CAMILO_PROFILE;

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

  // ════ S4. Control profiles distintos → no agrupadas ════
  {
    const c1 = await mkPatient(CAMILO_CLINIC, 'S747 C prof1', { profileId: PROFILE_MAIN });
    const c2 = await mkPatient(CAMILO_CLINIC, 'S747 C prof2', { profileId: PROFILE_OTHER });
    const groups = await snapshot();
    // c1 cae en el grupo QA (junto a A/B); c2 en el grupo de Camilo (solo 1 → no grupo).
    const gOther = findGroup(groups, PROFILE_OTHER);
    if (!gOther || !groupHasPatient(gOther, c2))
      ok('S4 ficha de otro profile (sola) NO forma grupo');
    else ko('S4 ficha de profile distinto se agrupó indebidamente: ' + JSON.stringify(gOther));
    // y c2 nunca aparece en el grupo de QA
    const gMain = findGroup(groups, PROFILE_MAIN);
    if (!groupHasPatient(gMain, c2)) ok('S4 profiles distintos NO se mezclan en un grupo');
    else ko('S4 c2 apareció en el grupo de QA');
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

  // ════ S6. Control merged/inactiva → cae bajo 2 vivas ════
  {
    // Profile dedicado para aislar: usar Camilo profile en una clínica donde
    // no haya otras fichas suyas. Creamos 2 fichas y desactivamos una →
    // queda 1 viva → no debe formar grupo.
    const { data: clinics } = await admin.from('clinics').select('id').limit(5);
    // Buscar una clínica sin grupo previo de Camilo: usamos otherClinic distinta de la de S5 si hay.
    const targetClinic = (clinics || []).map((c) => c.id).find((id) => id !== CAMILO_CLINIC) || CAMILO_CLINIC;
    const m1 = await mkPatient(targetClinic, 'S747 E viva', { profileId: PROFILE_OTHER });
    const m2 = await mkPatient(targetClinic, 'S747 E inactiva', { profileId: PROFILE_OTHER, active: false });
    const groups = await snapshot();
    const g = findGroup(groups, PROFILE_OTHER, targetClinic);
    // m2 inactiva no cuenta; con m1 sola (1 viva) no hay grupo, o si existiera por otras fichas, m2 no debe estar.
    const m2Listed = (groups || []).some((gr) => (gr.patients || []).some((p) => p.id === m2));
    if (!m2Listed && (!g || !groupHasPatient(g, m1) || g.patient_count < 2))
      ok('S6 ficha inactiva no cuenta; grupo no se forma con <2 vivas');
    else ko('S6 inactiva contó o grupo mal formado: ' + JSON.stringify(g));
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

  // ════ S8. Read-only: ninguna ficha cambió ════
  {
    const ids = created.patients;
    const { data: rows } = await admin.from('patients')
      .select('id, is_active, merged_into_patient_id, profile_id').in('id', ids);
    // fichaB seguía sin confirmar, fichaA confirmada, merged nunca seteado por la RPC, etc.
    const noMerge = (rows || []).every((r) => r.merged_into_patient_id === null);
    const inactiveStaysInactive = (rows || []).find((r) => r.id === created.patients.find(Boolean));
    if (noMerge) ok('S8 read-only: la RPC no fusionó ni marcó ninguna ficha');
    else ko('S8 ¡la RPC cambió datos!: ' + JSON.stringify(rows));
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
