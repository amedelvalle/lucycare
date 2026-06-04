/**
 * SMOKE s7_32 (Paciente Global F2.1) — sesión de PACIENTE real (OTP).
 *
 * Usa el test phone de paciente (50375000001 / OTP 123456). Valida sobre el
 * profile del paciente y limpia (NULL) las columnas nuevas en el finally.
 *
 *  1. Paciente actualiza document/DOB/género/depto-muni (coherente) → OK + audita.
 *  2. Paciente intenta cambiar role / is_active / phone → BLOQUEADO (grant column).
 *  3. Documento duplicado en otro profile → rechazo UNIQUE (vía service_role).
 *  4. Municipio fuera del departamento → P0004.
 *
 * Uso: node scripts/_smoke-s7_32.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { supabaseAnon as patient } from './_lib/supabase-anon.mjs';

const PHONE = '50375000001';
const OTP = '123456';
const OTHER_PROFILE = 'db1fba98-a299-4f25-82f1-7feff01e58fa'; // Camilo (para test de UNIQUE)
const DUI = '02526538-4';

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };
let profileId = null;
let origRole = null, origActive = null, origPhone = null;

try {
  // Par coherente depto/muni + un muni de OTRO departamento (para el test P0004)
  const { data: muniA } = await admin.from('municipalities').select('id, department_id').limit(1).single();
  const { data: muniB } = await admin.from('municipalities').select('id, department_id').neq('department_id', muniA.department_id).limit(1).single();
  if (!muniA || !muniB) throw new Error('no se pudieron leer municipios de prueba');

  // Sesión paciente
  await patient.auth.signInWithOtp({ phone: PHONE }).catch(() => {});
  const { data: sess, error: otpErr } = await patient.auth.verifyOtp({ phone: PHONE, token: OTP, type: 'sms' });
  if (otpErr || !sess?.session) throw new Error('OTP login paciente falló: ' + (otpErr?.message || 'sin sesión'));
  profileId = sess.user.id;
  ok('Sesión de paciente iniciada vía OTP (profile ' + profileId.slice(0, 8) + '…)');

  const { data: before } = await admin.from('profiles').select('role, is_active, phone').eq('id', profileId).single();
  origRole = before.role; origActive = before.is_active; origPhone = before.phone;

  // 1. Update permitido
  {
    const { error } = await patient.from('profiles').update({
      document_type: 'dui', document_number: DUI, date_of_birth: '1990-05-15',
      gender: 'masculino', department_id: muniA.department_id, municipality_id: muniA.id,
      updated_at: new Date().toISOString(),
    }).eq('id', profileId);
    if (error) ko('Update permitido falló: ' + error.message);
    else {
      const { data: p } = await admin.from('profiles').select('document_number, date_of_birth, gender, department_id, municipality_id').eq('id', profileId).single();
      if (p.document_number === DUI && p.gender === 'masculino' && p.municipality_id === muniA.id) ok('Paciente actualizó document/DOB/género/depto-muni');
      else ko('Datos no persistieron: ' + JSON.stringify(p));
    }
  }

  // 1b. Audit
  {
    const { data: a } = await admin.from('audit_log').select('new_data').eq('table_name', 'profiles').eq('record_id', profileId).order('created_at', { ascending: false }).limit(1);
    if (a?.[0]?.new_data?.edited_via === 'profile_identity') ok('Cambio de identidad auditado (edited_via=profile_identity)');
    else ko('Sin entrada de audit de identidad: ' + JSON.stringify(a?.[0]?.new_data));
  }

  // 2. Bloqueos role / is_active / phone
  for (const [field, value] of [['role', 'doctor'], ['is_active', false], ['phone', '50300000000']]) {
    const { error } = await patient.from('profiles').update({ [field]: value }).eq('id', profileId);
    const { data: p } = await admin.from('profiles').select(field).eq('id', profileId).single();
    const unchanged = String(p[field]) === String(field === 'role' ? origRole : field === 'is_active' ? origActive : origPhone);
    if (error && unchanged) ok(`Paciente NO puede cambiar ${field} (bloqueado por grant column) → ${error.message.slice(0, 60)}`);
    else if (!error && !unchanged) ko(`⚠ Paciente CAMBIÓ ${field} (escalada NO bloqueada)`);
    else ok(`Paciente NO cambió ${field} (sin efecto)`);
  }

  // 3. Documento duplicado → UNIQUE (otro profile, vía service_role; el constraint aplica)
  {
    const { error } = await admin.from('profiles').update({ document_type: 'dui', document_number: DUI }).eq('id', OTHER_PROFILE);
    if (error && /duplicate key|unique|23505/i.test(error.message)) ok('Documento duplicado en otro profile → rechazo UNIQUE');
    else if (!error) { ko('⚠ UNIQUE no rechazó el documento duplicado'); await admin.from('profiles').update({ document_type: null, document_number: null }).eq('id', OTHER_PROFILE); }
    else ko('Error inesperado en test UNIQUE: ' + error.message);
  }

  // 4. Municipio fuera del departamento → P0004
  {
    const { error } = await patient.from('profiles').update({ municipality_id: muniB.id }).eq('id', profileId); // muniB pertenece a otro depto
    if (error && (error.code === 'P0004' || /no pertenece|departamento/i.test(error.message))) ok('Municipio fuera del departamento → rechazado (P0004)');
    else if (!error) ko('⚠ Coherencia muni-depto NO enforced');
    else ko('Error inesperado en coherencia: ' + error.message);
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  if (profileId) {
    await admin.from('profiles').update({
      document_type: null, document_number: null, date_of_birth: null,
      gender: null, department_id: null, municipality_id: null,
    }).eq('id', profileId);
  }
  await admin.from('profiles').update({ document_type: null, document_number: null }).eq('id', OTHER_PROFILE);
  await patient.auth.signOut().catch(() => {});
  console.log('  ✅ cleanup OK (columnas de identidad reseteadas a NULL)');
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_32 OK' : '❌ SMOKE s7_32 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
