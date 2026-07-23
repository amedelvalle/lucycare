/**
 * SMOKE s7_66 — AUTH-P1B1B(A): intención de reserva + creación transaccional.
 *
 * ⚠ NO EJECUTAR sin autorización expresa del owner (usa service_role para
 *   fixtures/cleanup + UN Test Phone para la sesión del paciente que reserva).
 *
 * ── PRERREQUISITO OPERATIVO (owner) — DOS Test Phones OBLIGATORIOS ──
 *   • `50370006601` (paciente 1) y `50370006602` (paciente 2), OTP fijo
 *     `123456`, en Supabase Auth → Phone → Test Phone Numbers; retirar AMBOS al
 *     cerrar. El script ABORTA antes de crear fixtures si cualquiera de los dos
 *     no inicia sesión (la prueba de teléfono distinto T8 no puede omitirse).
 *
 * ── 100% SINTÉTICO (namespace AP66_FIXTURE, teléfonos 503700066xx) ──
 * Crea su cadena propia: auth.user(médico, por correo único) → profile →
 * clínica → doctor PUBLICADO+BOOKABLE+OPERATIVO → servicio → availability_rule
 * futura. Los pacientes que reservan son los dos Test Phones. **Jamás
 * Camilo/Katherine.**
 *
 * ── COBERTURA ──
 *   Preflight  inventario AP66 → aborta si hay residuos.
 *   Gate       AMBOS Test Phones inician sesión (obligatorio) o aborta.
 *   T1  register_booking_intent (anon) → intent con start_at/end_at derivados
 *       (end = start + slot_duration_min) + grant booking vigente.
 *   T2  IDEMPOTENCIA: misma 5-tupla → MISMO intent (reused=true), sin duplicar.
 *   T3  registro con teléfono inválido → P0095.
 *   T4  register genériza al público (P009F) los rechazos de validación: médico
 *       no bookable, servicio ajeno, fecha pasada, no alineado, override que
 *       bloquea, y (T4f) grilla ambigua por FASE distinta (dos reglas, mismo
 *       slot, start_time desalineados).
 *   T5  create_booking_with_intent (sesión Test Phone): éxito → cita creada +
 *       intent consumido; ASSERTIONS de TODOS los campos de patients y
 *       appointments (mapeo fiel a createBooking/getOrCreatePatient).
 *   T6  reuso del intent consumido → P0093.
 *   T7  intent vencido → P0094 (fixture con expires_at en el pasado).
 *   T8  teléfono de otra sesión ≠ intent → P0096 (usa el 2º Test Phone).
 *   T9  patient get-or-create: 2º intent del mismo paciente/clínica → reusa la
 *       misma ficha (no duplica patients).
 *   T10 slot ocupado en el REGISTRO → P009F (pre-check genericizado).
 *   T11 CONCURRENCIA REAL: dos intents distintos del MISMO slot, consumidos en
 *       PARALELO por dos sesiones → exactamente una cita; ganador consumido,
 *       perdedor sin consumo; sin estado parcial.
 *   Cleanup por ID (grants antes que intents, 2 pasadas, tolerante a fallos) +
 *   deleteUser (Admin Auth API) → profile por cascada (borrado manual solo si
 *   persiste y SIN relaciones externas) + verificación getUserById → not found.
 *   Anclaje AP66 RELACIONAL (auth.user propio + correo @ap66fixture.invalid +
 *   clínica/servicio con marker de NOMBRE + teléfonos + FKs), NO por marker en
 *   profiles.full_name/email. Sweep final en 0 (profiles por ID exacto);
 *   audit_log intacto; recordatorio de retirar AMBOS Test Phones.
 *
 * Uso (SOLO con autorización): node scripts/_smoke-s7_66.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const MARKER = 'AP66_FIXTURE';
const PATIENT_PHONE = '50370006601';         // Test Phone 1 (paciente que reserva)
const OTHER_PHONE = '50370006602';           // Test Phone 2 — OBLIGATORIO (T8/T11)
const OTP = '123456';
const EMAIL_DOMAIN = '@ap66fixture.invalid';
const FIXTURE_PHONES = [PATIENT_PHONE, OTHER_PHONE, '+' + PATIENT_PHONE, '+' + OTHER_PHONE];

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const patientCli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const otherCli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Tracking cleanup
const authUserIds = [], clinicIds = [], doctorIds = [], serviceIds = [], ruleIds = [];
const overrideIds = [], intentIds = [], apptIds = [], patientIds = [];
const syntheticEmails = []; // correos @ap66fixture.invalid de los auth.user creados (anclaje relacional)

const expectCode = (label, error, code) => {
  if (error?.code === code) ok(`${label} → ${code}`);
  else ko(`${label} → esperado ${code}; recibido ${error?.code ?? 'sin error'} ${error?.message ?? ''}`);
};

async function login(cli, phone) {
  await cli.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await cli.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone}: ${error?.message ?? 'sin sesión'}`);
  return data.user.id;
}

// Fecha local `YYYY-MM-DD` a `daysAhead` días (hora local del proceso).
function localDatePlus(daysAhead) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

console.log('═══ SMOKE s7_66 (intención de reserva + creación transaccional) ═══\n');

async function preflight() {
  const items = [];
  const scan = async (label, q) => { const { data, error } = await q; if (error) throw new Error(`preflight ${label}: ${error.message}`); for (const r of data ?? []) items.push(`${label}:${r.id}`); };
  // NO se scanean profiles por full_name/email (el synthetic doctor ya no lleva
  // marker en el profile — ver SETUP). El anclaje de residuos es RELACIONAL:
  // clínica/servicio con marker de NOMBRE + teléfonos de intents/patients +
  // profiles por TELÉFONO de Test Phone (no es marker de nombre/correo).
  await scan('profiles(phone)', admin.from('profiles').select('id').in('phone', FIXTURE_PHONES));
  await scan('clinics(marker)', admin.from('clinics').select('id').like('name', `${MARKER}%`));
  await scan('services(marker)', admin.from('services').select('id').like('name', `${MARKER}%`));
  await scan('intents(phone)', admin.from('booking_intents').select('id').in('phone_e164', FIXTURE_PHONES));
  await scan('patients(phone)', admin.from('patients').select('id').in('phone', FIXTURE_PHONES));
  if (items.length) {
    console.log('  ⛔ PREFLIGHT: residuos AP66 antes de crear fixtures:'); for (const i of items) console.log('     ' + i);
    console.log('  ⛔ ABORTADO sin crear fixtures.'); process.exit(1);
  }
  ok('preflight: 0 residuos AP66 (DB limpia)');
}

let patientUserId, otherUserId;
try {
  await preflight();

  // ═══ GATE: DOS Test Phones OBLIGATORIOS (antes de crear fixtures) ═══
  // Si cualquiera de los dos no está configurado o no inicia sesión, abortar
  // SIN crear fixtures. La prueba de teléfono distinto (T8) NO es opcional.
  try { patientUserId = await login(patientCli, PATIENT_PHONE); authUserIds.push(patientUserId); }
  catch (e) { throw new Error(`GATE: Test Phone OBLIGATORIO ${PATIENT_PHONE} no disponible (${e.message}). Configurarlo en Supabase Auth → Phone → Test Phone Numbers.`); }
  try { otherUserId = await login(otherCli, OTHER_PHONE); authUserIds.push(otherUserId); }
  catch (e) { throw new Error(`GATE: 2º Test Phone OBLIGATORIO ${OTHER_PHONE} no disponible (${e.message}). Ambos Test Phones son requeridos; T8/T11 no pueden omitirse.`); }
  ok('GATE: ambos Test Phones (…01 / …02) iniciaron sesión — se puede continuar');

  // ═══ SETUP: cadena sintética + regla de disponibilidad futura ═══
  // Fecha ~5 días adelante; la regla se crea para SU día de semana → el slot
  // de las 09:00 cae dentro de la regla y es futuro (s6_03).
  const bookDate = localDatePlus(5);
  const dow = new Date(bookDate + 'T00:00:00').getDay();
  const startLocal = `${bookDate}T09:00:00`;
  const SLOT_MIN = 30;
  let doctorId, clinicId, serviceId;
  {
    const doctorEmail = `ap66-doctor-${Date.now()}${EMAIL_DOMAIN}`;
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({
      email: doctorEmail, email_confirm: true,
      user_metadata: { full_name: `${MARKER} Dr` },
    });
    if (cuErr || !cu?.user) throw new Error('createUser doctor: ' + (cuErr?.message || 'sin user'));
    const uid = cu.user.id; authUserIds.push(uid); syntheticEmails.push(doctorEmail);
    // El profile lo crea un trigger. NO se toca NINGUNA columna auditada por
    // audit_profiles_identity (s7_32: full_name/document_*/dob/gender/depto/muni):
    // ese trigger inserta en audit_log con user_id=auth.uid()=NULL bajo
    // service_role → viola NOT NULL (deuda técnica documentada en el OWNER doc).
    // La pertenencia AP66 se ancla por RELACIONES (auth.user propio + correo
    // @ap66fixture.invalid vía Admin Auth API + clínica AP66_FIXTURE + FKs), NO
    // por marker en el profile. Solo se confirma que el profile EXISTE (polling).
    let profileOk = false;
    for (let i = 0; i < 20; i++) {
      const { data } = await admin.from('profiles').select('id').eq('id', uid).maybeSingle();
      if (data) { profileOk = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!profileOk) throw new Error(`SETUP: el trigger no creó public.profiles para el auth.user ${uid} — abortando antes de continuar`);

    const { data: clinic, error: cErr } = await admin.from('clinics')
      .insert({ name: `${MARKER} Clinica`, owner_id: uid, is_active: true }).select('id').single();
    if (cErr) throw new Error('clinic: ' + cErr.message); clinicId = clinic.id; clinicIds.push(clinic.id);

    const { data: doc, error: dErr } = await admin.from('doctors').insert({
      profile_id: uid, clinic_id: clinicId, lucy_status: 'verified',
      is_published: true, is_operational: true, booking_enabled: true,
    }).select('id').single();
    if (dErr) throw new Error('doctor: ' + dErr.message); doctorId = doc.id; doctorIds.push(doc.id);

    const { data: svc, error: sErr } = await admin.from('services').insert({
      doctor_id: doctorId, name: `${MARKER} Consulta`, duration_minutes: 30, is_active: true,
    }).select('id').single();
    if (sErr) throw new Error('service: ' + sErr.message); serviceId = svc.id; serviceIds.push(svc.id);

    const { data: rule, error: rErr } = await admin.from('availability_rules').insert({
      doctor_id: doctorId, clinic_id: clinicId, day_of_week: dow,
      start_time: '09:00:00', end_time: '12:00:00', slot_duration_min: SLOT_MIN, is_active: true,
    }).select('id').single();
    if (rErr) throw new Error('rule: ' + rErr.message); ruleIds.push(rule.id);

    ok(`SETUP cadena AP66 (doctor bookable + servicio + regla dow=${dow} 09:00–12:00 slot ${SLOT_MIN}m)`);
  }

  const reg = (over = {}) => anon.rpc('register_booking_intent', {
    p_doctor_id: doctorId, p_service_id: serviceId, p_start_local: startLocal, p_phone: PATIENT_PHONE, ...over,
  });

  // ═══ T1. register_booking_intent → intent con derivados ═══
  let intentId = null;
  {
    const { data, error } = await reg();
    if (error) ko('T1 register error: ' + error.code + ' ' + error.message);
    else {
      intentId = data.intent_id; intentIds.push(intentId);
      const { data: bi } = await admin.from('booking_intents').select('*').eq('id', intentId).single();
      const durMin = (new Date(bi.end_at) - new Date(bi.start_at)) / 60000;
      if (bi && durMin === SLOT_MIN && bi.clinic_id === clinicId && bi.phone_e164 === '+' + PATIENT_PHONE)
        ok(`T1 intent creado (end = start + ${SLOT_MIN}m, clínica derivada, teléfono canónico)`);
      else ko('T1 intent inesperado: ' + JSON.stringify({ durMin, clinic: bi?.clinic_id, phone: bi?.phone_e164 }));
      const { data: g } = await admin.from('auth_creation_grants').select('id').eq('booking_intent_id', intentId).eq('flow', 'booking');
      if (g?.length === 1) ok('T1 grant booking vigente creado para el intent'); else ko('T1 grant no creado: ' + JSON.stringify(g));
    }
  }

  // ═══ T2. Idempotencia ═══
  {
    const { data, error } = await reg();
    if (!error && data.intent_id === intentId && data.reused === true) ok('T2 misma 5-tupla → MISMO intent (reused)');
    else ko('T2 idempotencia rota: ' + JSON.stringify({ code: error?.code, id: data?.intent_id, reused: data?.reused }));
  }

  // ═══ T3. Teléfono inválido ═══
  { const { error } = await reg({ p_phone: 'basura' }); expectCode('T3 teléfono inválido', error, 'P0095'); }

  // ═══ T4. Rechazos de validación → TODOS genéricos al público (P009F) ═══
  // register_booking_intent NO debe enumerar al médico a un caller anónimo:
  // cualquier rechazo de validate (médico/servicio/fecha/grilla/override/slot)
  // se colapsa en P009F. (El código interno específico de validate se prueba
  // por análisis estático en check-s7_66.mjs.)
  {
    // médico no bookable: fixture aparte (no tocar el doctor principal).
    const { data: cu2 } = await admin.auth.admin.createUser({ email: `ap66-nb-${Date.now()}${EMAIL_DOMAIN}`, email_confirm: true, user_metadata: { full_name: `${MARKER} NB` } });
    authUserIds.push(cu2.user.id);
    await admin.from('profiles').update({ full_name: `${MARKER} NB` }).eq('id', cu2.user.id);
    const { data: cl2 } = await admin.from('clinics').insert({ name: `${MARKER} ClinicaNB`, owner_id: cu2.user.id, is_active: true }).select('id').single();
    clinicIds.push(cl2.id);
    const { data: d2 } = await admin.from('doctors').insert({ profile_id: cu2.user.id, clinic_id: cl2.id, lucy_status: 'listed_only', is_published: false, is_operational: true, booking_enabled: false }).select('id').single();
    doctorIds.push(d2.id);
    const { data: s2 } = await admin.from('services').insert({ doctor_id: d2.id, name: `${MARKER} SvcNB`, duration_minutes: 30, is_active: true }).select('id').single();
    serviceIds.push(s2.id);
    const { error: e4a } = await anon.rpc('register_booking_intent', { p_doctor_id: d2.id, p_service_id: s2.id, p_start_local: startLocal, p_phone: PATIENT_PHONE });
    expectCode('T4a médico no bookable → genérico', e4a, 'P009F');

    const { error: e4b } = await reg({ p_service_id: s2.id }); // servicio de otro médico
    expectCode('T4b servicio ajeno → genérico', e4b, 'P009F');

    const pastLocal = '2000-01-01T09:00:00';
    const { error: e4c } = await reg({ p_start_local: pastLocal });
    expectCode('T4c fecha pasada → genérico', e4c, 'P009F');

    const misaligned = startLocal.slice(0, 11) + '09:07:00';
    const { error: e4d } = await reg({ p_start_local: misaligned });
    expectCode('T4d no alineado a la grilla → genérico', e4d, 'P009F');

    // override que bloquea todo el día del slot
    const blockDate = startLocal.slice(0, 10);
    const { data: ov } = await admin.from('availability_overrides').insert({
      doctor_id: doctorId, clinic_id: clinicId, date_start: blockDate, date_end: blockDate,
      time_start: null, time_end: null, is_blocked: true, description: `${MARKER} block`, created_by: patientUserId,
    }).select('id').single();
    overrideIds.push(ov.id);
    const otherSlot = startLocal.slice(0, 11) + '10:00:00';
    const { error: e4e } = await reg({ p_start_local: otherSlot });
    expectCode('T4e override bloquea el día → genérico', e4e, 'P009F');
    await admin.from('availability_overrides').delete().eq('id', ov.id);
    overrideIds.pop();

    // ── T4f. AMBIGÜEDAD DE GRILLA por FASE distinta (mismo slot, start_time
    //    desalineados). Se agrega una 2ª regla 09:15–12:00 (fase 15 vs 0 con
    //    slot 30) al doctor principal, se prueba un slot que ambas contienen, y
    //    se ELIMINA de inmediato para no contaminar los demás tests. ──
    const { data: rule2, error: r2Err } = await admin.from('availability_rules').insert({
      doctor_id: doctorId, clinic_id: clinicId, day_of_week: dow,
      start_time: '09:15:00', end_time: '12:00:00', slot_duration_min: SLOT_MIN, is_active: true,
    }).select('id').single();
    if (r2Err) ko('T4f no se pudo crear la 2ª regla: ' + r2Err.message);
    else {
      const ambSlot = startLocal.slice(0, 11) + '10:00:00'; // dentro de ambas reglas
      const { error: e4f } = await reg({ p_start_local: ambSlot });
      expectCode('T4f grilla ambigua por fase distinta → genérico', e4f, 'P009F');
      await admin.from('availability_rules').delete().eq('id', rule2.id);
    }
  }

  // ═══ T5. create_booking_with_intent → cita + consumo + MAPEO fiel ═══
  {
    const { data, error } = await patientCli.rpc('create_booking_with_intent', {
      p_intent_id: intentId, p_patient_name: `  ${MARKER} Paciente  `, p_notes: '  ',
    });
    if (error) ko('T5 create error: ' + error.code + ' ' + error.message);
    else if (data?.success && data.appointment_id) {
      apptIds.push(data.appointment_id);
      const { data: bi } = await admin.from('booking_intents')
        .select('start_at, end_at, consumed_at, consumed_appointment_id').eq('id', intentId).single();
      // ── Cita: TODOS los campos del INSERT vigente ──
      const { data: a } = await admin.from('appointments')
        .select('clinic_id, doctor_id, patient_id, service_id, status_id, start_time, end_time, source, notes, payment_status')
        .eq('id', data.appointment_id).single();
      const { data: st } = await admin.from('appointment_statuses').select('name').eq('id', a.status_id).single();
      if (a.patient_id) patientIds.push(a.patient_id);
      const eqTs = (x, y) => new Date(x).getTime() === new Date(y).getTime();
      const aptOk = a.clinic_id === clinicId && a.doctor_id === doctorId && a.service_id === serviceId
        && st.name === 'programada' && a.source === 'lucy_directorio' && a.payment_status === 'pending'
        && a.notes === null /* '  ' → NULL */ && eqTs(a.start_time, bi.start_at) && eqTs(a.end_time, bi.end_at);
      if (aptOk) ok('T5 cita: clinic/doctor/service/status=programada/source=lucy_directorio/payment=pending/notes=NULL/start=end del intent');
      else ko('T5 cita mapeo inesperado: ' + JSON.stringify({ clinic: a.clinic_id, doctor: a.doctor_id, service: a.service_id, status: st?.name, source: a.source, payment: a.payment_status, notes: a.notes }));
      // ── Paciente NUEVO: TODOS los campos del get-or-create ──
      const { data: p } = await admin.from('patients')
        .select('profile_id, clinic_id, full_name, phone, document_type, document_number, date_of_birth, gender, patient_type, link_confirmed_at')
        .eq('id', a.patient_id).single();
      const patOk = p.profile_id === patientUserId && p.clinic_id === clinicId
        && p.full_name === `${MARKER} Paciente` /* btrim */ && p.phone === '+' + PATIENT_PHONE
        && p.document_type === 'dui' && p.document_number === null
        && p.date_of_birth === '2000-01-01' && p.gender === 'otro' && p.patient_type === 'privado'
        && p.link_confirmed_at !== null;
      if (patOk) ok('T5 paciente: profile_id=uid/clinic/nombre btrim/telefono canónico/dui/doc NULL/2000-01-01/otro/privado/link_confirmed');
      else ko('T5 paciente mapeo inesperado: ' + JSON.stringify(p));
      // ── Consumo del intent ──
      if (bi.consumed_at && bi.consumed_appointment_id === data.appointment_id) ok('T5 intent consumido (consumed_at + appointment_id)');
      else ko('T5 intent no consumido: ' + JSON.stringify(bi));
    } else ko('T5 resultado inesperado: ' + JSON.stringify(data));
  }

  // ═══ T6. Reuso de intent consumido ═══
  { const { error } = await patientCli.rpc('create_booking_with_intent', { p_intent_id: intentId, p_patient_name: 'x' }); expectCode('T6 intent ya consumido', error, 'P0093'); }

  // ═══ T7. Intent vencido → P0094 ═══
  // La fixture respeta TODAS las restricciones de booking_intents (s7_65):
  //   expires_at < now()  ·  expires_at > created_at  ·
  //   expires_at <= created_at + interval '15 minutes' (booking_intents_ttl_max).
  // Ventana de 9 min: created = now−10 min, expires = now−1 min.
  {
    const createdAt = new Date(Date.now() - 10 * 60000).toISOString(); // now − 10 min
    const expiresAt = new Date(Date.now() - 1 * 60000).toISOString();  // now − 1 min
    const { data: bi, error: insErr } = await admin.from('booking_intents').insert({
      doctor_id: doctorId, clinic_id: clinicId, service_id: serviceId,
      start_at: new Date(startLocal + '-06:00').toISOString(),
      end_at: new Date(new Date(startLocal + '-06:00').getTime() + SLOT_MIN * 60000).toISOString(),
      phone_e164: '+' + PATIENT_PHONE,
      created_at: createdAt,
      expires_at: expiresAt,
    }).select('id').single();
    // Error explícito + id no nulo antes de usarlo (nunca leer id de null).
    if (insErr || !bi?.id)
      throw new Error(`SETUP T7: no se pudo crear el intent vencido (${insErr?.message ?? 'data.id nulo'}) — abortando`);
    intentIds.push(bi.id);
    const { error } = await patientCli.rpc('create_booking_with_intent', { p_intent_id: bi.id, p_patient_name: 'x' });
    expectCode('T7 intent vencido', error, 'P0094');
  }

  // ═══ T8. Teléfono de otra sesión ≠ intent (OBLIGATORIO, no omitible) ═══
  // Intent registrado para el Test Phone 1; se intenta consumir con la sesión
  // del Test Phone 2 (ya autenticada en el gate) → P0096.
  {
    const { data: intent2 } = await reg({ p_start_local: startLocal.slice(0, 11) + '11:00:00' });
    intentIds.push(intent2.intent_id);
    const { error } = await otherCli.rpc('create_booking_with_intent', { p_intent_id: intent2.intent_id, p_patient_name: 'x' });
    expectCode('T8 teléfono JWT ≠ intent', error, 'P0096');
  }

  // ═══ T9. patient get-or-create: reusa la ficha y NO sobrescribe datos ═══
  // Se pasa un nombre DISTINTO a propósito: el paciente ya existe (T5) → debe
  // reutilizarse SIN pisar su full_name (regla del owner: no sobrescribir).
  {
    const { data: intent3 } = await reg({ p_start_local: startLocal.slice(0, 11) + '11:30:00' });
    intentIds.push(intent3.intent_id);
    const { data, error } = await patientCli.rpc('create_booking_with_intent', { p_intent_id: intent3.intent_id, p_patient_name: `${MARKER} NombreNuevo` });
    if (!error && data?.success) {
      apptIds.push(data.appointment_id);
      const { data: pts } = await admin.from('patients').select('id, full_name').eq('profile_id', patientUserId).eq('clinic_id', clinicId);
      if (pts?.length === 1) ok('T9 2ª reserva → misma ficha de paciente (get-or-create, sin duplicar)');
      else ko('T9 fichas duplicadas: ' + JSON.stringify(pts));
      if (pts?.length === 1 && pts[0].full_name === `${MARKER} Paciente`) ok('T9 la ficha existente NO se sobrescribió (conserva el nombre original)');
      else ko('T9 se sobrescribió el nombre del paciente existente: ' + JSON.stringify(pts?.[0]));
    } else ko('T9 2ª reserva falló: ' + JSON.stringify({ code: error?.code }));
  }

  // ═══ T10. Slot ocupado en el REGISTRO → P009F (pre-check genericizado) ═══
  {
    // el slot de las 09:00 ya está ocupado por T5 → registrar otro intent en él
    const { data, error } = await reg();
    if (error?.code === 'P009F') ok('T10 slot ocupado → P009F en el registro (pre-check genericizado)');
    else if (!error && data?.intent_id) {
      // Defensa: si el registro no bloqueó, el create debe fallar por solape.
      intentIds.push(data.intent_id);
      const { error: cErr } = await patientCli.rpc('create_booking_with_intent', { p_intent_id: data.intent_id, p_patient_name: 'x' });
      if (['P0090', 'P009B'].includes(cErr?.code)) ok('T10 slot ocupado → bloqueado al crear (' + cErr.code + ')');
      else ko('T10 no se bloqueó el slot ocupado: ' + JSON.stringify({ code: cErr?.code }));
    } else ko('T10 registro inesperado: ' + JSON.stringify({ code: error?.code }));
  }

  // ═══ T11. CONCURRENCIA REAL: dos intents del MISMO slot, consumo PARALELO ═══
  // Dos intents distintos (Test Phone 1 y 2) para el mismo médico/servicio/slot,
  // consumidos EN PARALELO por sus dos sesiones. El advisory lock por médico de
  // s7_55 + el pre-check serializan: exactamente UNA cita; ganador consumido,
  // perdedor SIN consumo (rollback total, sin estado parcial).
  {
    const concLocal = startLocal.slice(0, 11) + '10:30:00';
    const { data: iA, error: eA } = await anon.rpc('register_booking_intent', { p_doctor_id: doctorId, p_service_id: serviceId, p_start_local: concLocal, p_phone: PATIENT_PHONE });
    const { data: iB, error: eB } = await anon.rpc('register_booking_intent', { p_doctor_id: doctorId, p_service_id: serviceId, p_start_local: concLocal, p_phone: OTHER_PHONE });
    if (eA || eB || !iA?.intent_id || !iB?.intent_id) {
      ko('T11 no se registraron los dos intents: ' + JSON.stringify({ eA: eA?.code, eB: eB?.code }));
    } else {
      intentIds.push(iA.intent_id, iB.intent_id);
      // Consumo EN PARALELO (no secuencial).
      const settled = await Promise.allSettled([
        patientCli.rpc('create_booking_with_intent', { p_intent_id: iA.intent_id, p_patient_name: `${MARKER} Paciente` }),
        otherCli.rpc('create_booking_with_intent', { p_intent_id: iB.intent_id, p_patient_name: `${MARKER} Paciente2` }),
      ]);
      const res = settled.map((r) => (r.status === 'fulfilled' ? r.value : { data: null, error: { code: 'THROW', message: String(r.reason) } }));
      const wins = res.filter((r) => !r.error && r.data?.success);
      const loses = res.filter((r) => r.error || !r.data?.success);
      const loserCode = loses[0]?.error?.code;
      if (wins.length === 1 && loses.length === 1 && ['P0090', 'P009B'].includes(loserCode))
        ok(`T11 exactamente una cita creada; la otra falló por solape (${loserCode})`);
      else ko('T11 resultado concurrente inesperado: ' + JSON.stringify(res.map((r) => ({ ok: r.data?.success, code: r.error?.code }))));

      const winAppt = wins[0]?.data?.appointment_id;
      if (winAppt) {
        apptIds.push(winAppt);
        const { data: wa } = await admin.from('appointments').select('patient_id').eq('id', winAppt).single();
        if (wa?.patient_id) patientIds.push(wa.patient_id);
      }
      // exactamente UNA cita en ese slot
      const { data: iAfull } = await admin.from('booking_intents').select('start_at').eq('id', iA.intent_id).single();
      const { data: appts } = await admin.from('appointments').select('id').eq('doctor_id', doctorId).eq('start_time', iAfull.start_at);
      if (appts?.length === 1) ok('T11 exactamente 1 cita en el slot concurrente');
      else ko('T11 nº de citas en el slot ≠ 1: ' + JSON.stringify(appts));
      // ganador consumido; perdedor SIN consumo
      const { data: biA } = await admin.from('booking_intents').select('consumed_at, consumed_appointment_id').eq('id', iA.intent_id).single();
      const { data: biB } = await admin.from('booking_intents').select('consumed_at, consumed_appointment_id').eq('id', iB.intent_id).single();
      const consumedCount = [biA, biB].filter((b) => b.consumed_at).length;
      const winnerConsumed = [biA, biB].some((b) => b.consumed_appointment_id === winAppt);
      if (consumedCount === 1 && winnerConsumed) ok('T11 solo el intent ganador quedó consumido; el perdedor sin consumo (sin estado parcial)');
      else ko('T11 consumo inesperado: ' + JSON.stringify({ biA, biB }));
    }
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup (orden de FKs; tolerante a fallos, con 2ª pasada) —');
  const errs = [];
  const del = async (label, q) => { const { error } = await q; if (error) errs.push(`${label}: ${error.message}`); };

  // Pasada de borrado de TABLAS en orden de FKs (grants ANTES que intents).
  // NO toca profiles/auth.users: el profile cae por cascada al hacer deleteUser
  // una vez borrada la clínica que lo referencia.
  // Orden REAL por FKs: grant.booking_intent_id → intent → intent.consumed_appointment_id
  // → appointment → appointment.patient_id/service_id/doctor_id. Con este orden
  // la 1ª pasada no genera errores FK esperables.
  async function tablesPass() {
    // 1. auth_creation_grants (FK grant → intent)
    await del('grants(AP66 phones)', admin.from('auth_creation_grants').delete().in('subject_normalized', FIXTURE_PHONES));
    if (intentIds.length) await del('grants(by intent)', admin.from('auth_creation_grants').delete().in('booking_intent_id', intentIds));
    // 2. booking_intents (FK intent.consumed_appointment_id → appointment)
    for (const id of intentIds) await del(`intents ${id}`, admin.from('booking_intents').delete().eq('id', id));
    await del('intents(AP66 phones)', admin.from('booking_intents').delete().in('phone_e164', FIXTURE_PHONES));
    // 3. appointments
    for (const id of apptIds) await del(`appointments ${id}`, admin.from('appointments').delete().eq('id', id));
    if (doctorIds.length) await del('appointments(AP66 doctors)', admin.from('appointments').delete().in('doctor_id', doctorIds));
    // 4. patients
    for (const id of patientIds) await del(`patients ${id}`, admin.from('patients').delete().eq('id', id));
    await del('patients(AP66 phones)', admin.from('patients').delete().in('phone', FIXTURE_PHONES));
    // 5. availability_overrides
    for (const id of overrideIds) await del(`overrides ${id}`, admin.from('availability_overrides').delete().eq('id', id));
    if (doctorIds.length) await del('overrides(AP66 doctors)', admin.from('availability_overrides').delete().in('doctor_id', doctorIds));
    // 6. availability_rules
    for (const id of ruleIds) await del(`rules ${id}`, admin.from('availability_rules').delete().eq('id', id));
    if (doctorIds.length) await del('rules(AP66 doctors)', admin.from('availability_rules').delete().in('doctor_id', doctorIds));
    // 7. services
    for (const id of serviceIds) await del(`services ${id}`, admin.from('services').delete().eq('id', id));
    await del('services(marker)', admin.from('services').delete().like('name', `${MARKER}%`));
    // 8. doctors
    for (const id of doctorIds) await del(`doctors ${id}`, admin.from('doctors').delete().eq('id', id));
    // 9. clinic_members
    for (const id of clinicIds) await del(`clinic_members ${id}`, admin.from('clinic_members').delete().eq('clinic_id', id));
    // 10. clinics
    for (const id of clinicIds) await del(`clinics ${id}`, admin.from('clinics').delete().eq('id', id));
    await del('clinics(marker)', admin.from('clinics').delete().like('name', `${MARKER}%`));
  }

  await tablesPass();

  // 11. deleteUser (Admin Auth API) — DESPUÉS de borrar clinics/doctors, para
  //     que el profile caiga por cascada. NUNCA se borra el profile a mano antes.
  for (const id of authUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not.*found/i.test(error.message)) errs.push(`deleteUser ${id}: ${error.message}`);
  }
  // Antes de tocar un profile: verificar que NO tenga relaciones fuera de la
  // cadena AP66 (otras clínicas, otros doctors, patients, clinic_members,
  // lucyadmin_access). Tras borrar la cadena por IDs, un profile AP66 debe
  // quedar con 0 relaciones → seguro de borrar.
  const profileExternalLinks = async (id) => {
    const n = async (t, c) => ((await admin.from(t).select(c).eq(c, id)).data ?? []).length;
    let admins = 0;
    try { admins = ((await admin.from('lucyadmin_access').select('profile_id').eq('profile_id', id)).data ?? []).length; } catch { /* tabla ausente */ }
    return (await n('clinics', 'owner_id')) + (await n('doctors', 'profile_id'))
         + (await n('patients', 'profile_id')) + (await n('clinic_members', 'profile_id')) + admins;
  };
  // 12. Borrado manual del profile SOLO si: el user ya no existe, el profile
  //     persiste (no cayó por cascada) y NO tiene relaciones externas.
  for (const id of authUserIds) {
    const { data: u } = await admin.auth.admin.getUserById(id);
    if (!u?.user) {
      const { data: p } = await admin.from('profiles').select('id').eq('id', id).maybeSingle();
      if (p) {
        const links = await profileExternalLinks(id);
        if (links === 0) await del(`profile(manual) ${id}`, admin.from('profiles').delete().eq('id', id));
        else errs.push(`profile ${id}: ${links} relaciones fuera de la cadena AP66 → NO se borra`);
      }
    }
  }

  // Repetir barridos seguros si aún quedan residuos (2ª pasada).
  const countLeft = async () => {
    let n = 0;
    for (const q of [
      admin.from('booking_intents').select('id').in('phone_e164', FIXTURE_PHONES),
      admin.from('auth_creation_grants').select('id').in('subject_normalized', FIXTURE_PHONES),
      admin.from('patients').select('id').in('phone', FIXTURE_PHONES),
      admin.from('services').select('id').like('name', `${MARKER}%`),
      admin.from('clinics').select('id').like('name', `${MARKER}%`),
      admin.from('profiles').select('id').like('full_name', `${MARKER}%`),
      admin.from('profiles').select('id').like('email', `%${EMAIL_DOMAIN}`),
    ]) { const { data } = await q; n += (data?.length ?? 0); }
    return n;
  };
  if (await countLeft() > 0) { console.log('  ↻ residuos tras pasada 1 → 2ª pasada'); await tablesPass(); }

  if (errs.length) { for (const m of errs) ko('cleanup: ' + m); } else ok('cleanup ejecutado sin errores');

  // Verificación auth: los auth.user borrados ya NO existen (Admin Auth API;
  // NO se consulta la tabla auth.users por SQL).
  {
    let present = 0;
    for (const id of authUserIds) { const { data } = await admin.auth.admin.getUserById(id); if (data?.user) present++; }
    if (present === 0) ok(`verificación auth: los ${authUserIds.length} auth.user sintéticos ya no existen (getUserById → not found)`);
    else ko(`verificación auth: ${present} auth.user AÚN existen tras deleteUser`);
  }

  // Sweep final OBLIGATORIO: TODO debe ser 0; cualquier residuo → fallo.
  const residual = async (label, q) => { const { data, error } = await q; if (error) ko(`residual ${label}: ${error.message}`); else if ((data?.length ?? 0) === 0) ok(`0 residuales en ${label}`); else ko(`RESIDUALES en ${label}: ` + JSON.stringify(data)); };
  await residual('intents por teléfono', admin.from('booking_intents').select('id').in('phone_e164', FIXTURE_PHONES));
  await residual('grants por teléfono', admin.from('auth_creation_grants').select('id').in('subject_normalized', FIXTURE_PHONES));
  await residual('patients por teléfono', admin.from('patients').select('id').in('phone', FIXTURE_PHONES));
  await residual('clinics por marker', admin.from('clinics').select('id').like('name', `${MARKER}%`));
  await residual('services por marker', admin.from('services').select('id').like('name', `${MARKER}%`));
  // profiles: verificados por ID EXACTO de cada auth.user (NO por marker de
  // nombre/correo — el profile sintético no lleva marker propio).
  {
    const left = [];
    for (const id of authUserIds) { const { data } = await admin.from('profiles').select('id').eq('id', id).maybeSingle(); if (data) left.push(id); }
    if (left.length === 0) ok('0 residuales en profiles (por ID exacto de los auth.user sintéticos)');
    else ko('RESIDUALES en profiles (por ID): ' + JSON.stringify(left));
  }
  // audit_log: append-only, FUERA del objetivo de 0 residuos. T5 crea un patient
  // REAL → audit_patients (s4_02, COALESCE del user_id) deja filas append-only
  // (insert; y delete al borrarlo en el cleanup). NO se borran. Se reporta el
  // conteo de filas de auditoría asociadas a los IDs sintéticos creados.
  {
    const syntheticRecordIds = [...new Set([...patientIds, ...apptIds])];
    if (syntheticRecordIds.length === 0) {
      ok('audit_log: 0 filas sintéticas generadas por esta corrida (no se creó patient/appointment)');
    } else {
      const { data, error } = await admin.from('audit_log')
        .select('id, table_name, action, record_id').in('record_id', syntheticRecordIds);
      if (error) ok(`audit_log: no consultable por record_id (${error.message}) — NO se borra (append-only)`);
      else ok(`audit_log: ${data?.length ?? 0} fila(s) append-only por IDs sintéticos (${syntheticRecordIds.length} record_id) — NO se borran, por diseño; FUERA del objetivo de 0 residuos operativos`);
    }
  }

  await anon.auth.signOut().catch(() => {});
  await patientCli.auth.signOut().catch(() => {});
  await otherCli.auth.signOut().catch(() => {});
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_66 OK' : '❌ SMOKE s7_66 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  console.log(`ℹ Recordatorio: retirar AMBOS Test Phones (${PATIENT_PHONE} / ${OTHER_PHONE}) al cerrar el frente.`);
  process.exit(fail === 0 ? 0 : 1);
}
