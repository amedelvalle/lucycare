/**
 * FIXTURES de validación — F4-3 UI PR B (merge real en /admin/pacientes).
 *
 * Herramienta de validación, NO productiva. Crea un grupo candidato a merge
 * **E3 (same_profile)** totalmente AISLADO para poder ejercer la fusión real
 * desde la UI sin tocar datos reales, y lo limpia después.
 *
 * Aislamiento (regla del owner):
 *  - profile throwaway (auth user falso dedicado, teléfono sintético),
 *  - clínica throwaway, doctor throwaway,
 *  - 2 fichas `patients` vinculadas al mismo profile throwaway (E3),
 *  - 1 consulta FIRMADA en cada ficha (para que los conteos movidos sean > 0).
 *  Todo marcado con `F43B_FIXTURE`. NO toca Camilo, NI Katherine / 50372608827,
 *  NI ningún dato real. El `--clean` borra SOLO lo marcado.
 *
 * Uso:
 *   node scripts/_fixtures-merge-ui.mjs --apply   → crea las fixtures
 *   node scripts/_fixtures-merge-ui.mjs --clean   → borra y reporta 0 residuales
 *
 * NO se ejecuta en build/tsc. Requiere service_role en .env.local.
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

// ─── Marcadores e identidades sintéticas ─────────────────────
const MARK = 'F43B_FIXTURE';
const PERSONA_NAME = `${MARK} Persona`;
const CLINIC_NAME = `${MARK} Clínica de prueba`;
const FAKE_PHONE = '50390000743'; // prefijo 390 = no es móvil SV real; sintético.

// Denylist defensiva: jamás tocar estas identidades reales.
const PROTECTED_PROFILES = new Set(['db1fba98-a299-4f25-82f1-7feff01e58fa']); // Camilo
const PROTECTED_PHONES = new Set(['50372608827', '50378627694', '50378056365', '50375000001', '50375000099']);

const log = (...a) => console.log(...a);

// ─── APPLY ───────────────────────────────────────────────────
async function apply() {
  log(`═══ FIXTURES merge UI (${MARK}) — APPLY ═══\n`);

  // 1) Profile throwaway = auth user falso dedicado.
  if (PROTECTED_PHONES.has(FAKE_PHONE)) throw new Error('FAKE_PHONE colisiona con un teléfono protegido');
  const { data: created, error: cuErr } = await admin.auth.admin.createUser({
    phone: FAKE_PHONE,
    phone_confirm: true,
    user_metadata: { full_name: PERSONA_NAME },
  });
  if (cuErr) throw new Error('createUser: ' + cuErr.message);
  const profileId = created.user.id;
  // El trigger handle_new_user ya crea la fila profiles (full_name vacío, role
  // patient). NO la actualizamos: el audit AFTER UPDATE de identidad exige
  // auth.uid() (null bajo service_role). El grupo se identifica por la clínica y
  // las fichas marcadas (el header del grupo mostrará "perfil sin nombre").
  log('  • profile throwaway:', profileId, `(phone ${FAKE_PHONE})`);

  // 2) Clínica throwaway.
  const { data: clinic, error: clErr } = await admin.from('clinics')
    .insert({ name: CLINIC_NAME, owner_id: profileId }).select('id').single();
  if (clErr) throw new Error('clinic: ' + clErr.message);
  log('  • clínica throwaway:', clinic.id);

  // 3) Doctor throwaway (sobre el mismo profile throwaway).
  const { data: doctor, error: dErr } = await admin.from('doctors')
    .insert({ clinic_id: clinic.id, profile_id: profileId }).select('id').single();
  if (dErr) throw new Error('doctor: ' + dErr.message);
  log('  • doctor throwaway:', doctor.id);

  // 4) Dos fichas E3 (mismo profile, misma clínica), confirmadas.
  const now = new Date().toISOString();
  const mkPatient = async (name, doc) => {
    const { data, error } = await admin.from('patients').insert({
      clinic_id: clinic.id, profile_id: profileId, full_name: name,
      document_type: 'dui', document_number: doc, date_of_birth: '1990-05-05',
      gender: 'otro', patient_type: 'privado', phone: FAKE_PHONE,
      is_active: true, link_confirmed_at: now, notes: MARK,
    }).select('id').single();
    if (error) throw new Error('patient ' + name + ': ' + error.message);
    return data.id;
  };
  const srcId = await mkPatient(`${MARK} Fuente`, 'F43B-SRC-001');
  const tgtId = await mkPatient(`${MARK} Destino`, null);
  log('  • ficha fuente:', srcId);
  log('  • ficha destino:', tgtId);

  // 5) Una consulta FIRMADA en cada ficha → conteos movidos > 0 en cualquier dirección.
  const mkSignedConsultation = async (patientId) => {
    const { error } = await admin.from('consultations').insert({
      clinic_id: clinic.id, doctor_id: doctor.id, patient_id: patientId,
      status: 'signed', signed_at: now, chief_complaint: MARK,
    });
    if (error) throw new Error('consultation: ' + error.message);
  };
  await mkSignedConsultation(srcId);
  await mkSignedConsultation(tgtId);
  log('  • consulta firmada en cada ficha');

  log('\n✅ Fixtures creadas. En /admin/pacientes verás el grupo:');
  log(`   clínica "${CLINIC_NAME}" · 2 fichas (${MARK} Fuente / Destino)`);
  log('   Analizá el par (debe dar ELEGIBLE, evidencia same_profile) y fusioná con la frase.');
  log('   Al terminar: node scripts/_fixtures-merge-ui.mjs --clean\n');
}

// ─── CLEAN (por marcador, standalone, reporta 0 residuales) ──
async function clean() {
  log(`═══ FIXTURES merge UI (${MARK}) — CLEAN ═══\n`);

  // Fichas marcadas (incluye inactivas/fusionadas).
  const { data: pats, error: pErr } = await admin.from('patients').select('id').eq('notes', MARK);
  if (pErr) throw new Error('select patients: ' + pErr.message);
  const patientIds = (pats ?? []).map((r) => r.id);
  log('  • fichas marcadas:', patientIds.length);

  if (patientIds.length) {
    // Dependientes en orden inverso de FK.
    await admin.from('vitals').delete().in('patient_id', patientIds);
    await admin.from('appointments').delete().in('patient_id', patientIds);
    await admin.from('consultations').delete().in('patient_id', patientIds);
    // merge_log que referencie las fichas (source o target).
    await admin.from('patient_merge_log').delete().in('source_patient_id', patientIds);
    await admin.from('patient_merge_log').delete().in('target_patient_id', patientIds);
    // Romper auto-referencia merged_into antes de borrar (FK NO ACTION).
    await admin.from('patients').update({ merged_into_patient_id: null }).in('id', patientIds);
    await admin.from('patients').delete().in('id', patientIds);
  }

  // Clínicas marcadas → borrar sus doctores, luego la clínica.
  const { data: clinics } = await admin.from('clinics').select('id').eq('name', CLINIC_NAME);
  const clinicIds = (clinics ?? []).map((r) => r.id);
  if (clinicIds.length) {
    await admin.from('doctors').delete().in('clinic_id', clinicIds);
    await admin.from('clinics').delete().in('id', clinicIds);
  }
  log('  • clínicas throwaway borradas:', clinicIds.length);

  // Profiles throwaway (por teléfono sintético) → borrar el auth user (cascada a profiles).
  const { data: profs } = await admin.from('profiles').select('id, phone').eq('phone', FAKE_PHONE);
  let deletedUsers = 0;
  for (const p of profs ?? []) {
    if (PROTECTED_PROFILES.has(p.id) || (p.phone && PROTECTED_PHONES.has(p.phone))) {
      log('  ⚠ profile protegido omitido:', p.id);
      continue;
    }
    const { error: delErr } = await admin.auth.admin.deleteUser(p.id);
    if (delErr) {
      // Si no hay auth user, borrar la fila profiles directamente.
      await admin.from('profiles').delete().eq('id', p.id);
    }
    deletedUsers++;
  }
  log('  • profiles/auth users throwaway borrados:', deletedUsers);

  // ── Verificación de 0 residuales ──
  const residual = {};
  residual.patients = (await admin.from('patients').select('id').eq('notes', MARK)).data?.length ?? 0;
  residual.clinics = (await admin.from('clinics').select('id').eq('name', CLINIC_NAME)).data?.length ?? 0;
  residual.profiles = (await admin.from('profiles').select('id').eq('phone', FAKE_PHONE)).data?.length ?? 0;
  const totalResidual = residual.patients + residual.clinics + residual.profiles;

  log('\n— residuales —');
  log('  patients:', residual.patients, '| clinics:', residual.clinics, '| profiles:', residual.profiles);
  if (totalResidual === 0) {
    log('\n✅ CLEAN OK — 0 residuales.\n');
    process.exit(0);
  } else {
    log('\n❌ CLEAN incompleto — quedan', totalResidual, 'residuales.\n');
    process.exit(1);
  }
}

// ─── Entry ───────────────────────────────────────────────────
const mode = process.argv.find((a) => a === '--apply' || a === '--clean');
if (!mode) {
  log('Uso: node scripts/_fixtures-merge-ui.mjs --apply | --clean');
  process.exit(1);
}
try {
  if (mode === '--apply') await apply();
  else await clean();
} catch (e) {
  log('\n❌ ERROR:', e.message, '\n');
  process.exit(1);
}
