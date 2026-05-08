import { supabase } from '@/lib/supabase';

// ─── Tipos ────────────────────────────────────────────────────────────

export type ConsultationStatus = 'draft' | 'signed';

export interface Consultation {
  id: string;
  appointment_id: string | null;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  status: ConsultationStatus;
  started_at: string | null;
  signed_at: string | null;
  chief_complaint: string | null;
  history_present_illness: string | null;
  family_history_notes: string | null;
  physical_exam: string | null;
  internal_analysis: string | null;
  plan: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsultationContext extends Consultation {
  patient: {
    id: string;
    full_name: string;
    phone: string | null;
    photo_url: string | null;
    date_of_birth: string;
    gender: string;
  };
  appointment: {
    id: string;
    start_time: string;
    end_time: string;
    status_name: string | null;
  } | null;
  doctor: {
    id: string;
    full_name: string;
    license_number: string | null;
    specialty_name: string | null;
  };
}

export interface ConsultationUpdate {
  chief_complaint?: string | null;
  history_present_illness?: string | null;
  family_history_notes?: string | null;
  physical_exam?: string | null;
  internal_analysis?: string | null;
  plan?: string | null;
}

// ─── Funciones ────────────────────────────────────────────────────────

/**
 * Obtiene la consulta asociada a una cita; si no existe la crea (draft).
 * Esto se llama al abrir /panel/consulta/:appointmentId.
 *
 * NOTA: si la consulta ya está firmada (signed), igual la devuelve — la UI
 * decide si permite editar o sólo ver.
 */
export async function getOrCreateConsultationForAppointment(
  appointmentId: string
): Promise<ConsultationContext> {
  // 1. Intentar leer consulta existente
  const { data: existing, error: readErr } = await supabase
    .from('consultations')
    .select('*')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (readErr) throw readErr;

  let consultation: Consultation;

  if (existing) {
    consultation = existing as Consultation;
  } else {
    // 2. Necesitamos clinic_id, doctor_id, patient_id desde la cita
    const { data: apt, error: aptErr } = await supabase
      .from('appointments')
      .select('clinic_id, doctor_id, patient_id')
      .eq('id', appointmentId)
      .single();
    if (aptErr) throw aptErr;
    if (!apt) throw new Error('Cita no encontrada');

    const { data: created, error: createErr } = await supabase
      .from('consultations')
      .insert({
        appointment_id: appointmentId,
        clinic_id: apt.clinic_id,
        doctor_id: apt.doctor_id,
        patient_id: apt.patient_id,
        status: 'draft' as const,
        started_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (createErr) throw createErr;
    consultation = created as Consultation;
  }

  // 3. Cargar contexto: paciente + cita + médico (para receta)
  const [{ data: patient, error: pErr }, { data: apt, error: aErr }, { data: doctor, error: dErr }] =
    await Promise.all([
      supabase
        .from('patients')
        .select('id, full_name, phone, photo_url, date_of_birth, gender')
        .eq('id', consultation.patient_id)
        .single(),
      supabase
        .from('appointments')
        .select('id, start_time, end_time, status:appointment_statuses(name)')
        .eq('id', appointmentId)
        .single(),
      supabase
        .from('doctors')
        .select('id, license_number, profiles!inner(full_name), specialties(name)')
        .eq('id', consultation.doctor_id)
        .single(),
    ]);

  if (pErr) throw pErr;
  if (aErr) throw aErr;
  if (dErr) throw dErr;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aptAny = apt as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doctorAny = doctor as any;
  return {
    ...consultation,
    patient: {
      id: patient!.id,
      full_name: patient!.full_name,
      phone: patient!.phone,
      photo_url: patient!.photo_url,
      date_of_birth: patient!.date_of_birth,
      gender: patient!.gender,
    },
    appointment: aptAny
      ? {
          id: aptAny.id,
          start_time: aptAny.start_time,
          end_time: aptAny.end_time,
          status_name: aptAny.status?.name ?? null,
        }
      : null,
    doctor: {
      id: doctorAny.id,
      full_name: doctorAny.profiles?.full_name ?? '—',
      license_number: doctorAny.license_number ?? null,
      specialty_name: doctorAny.specialties?.name ?? null,
    },
  };
}

/**
 * Guarda cambios de borrador. Bloquea si la consulta ya está firmada.
 */
export async function saveConsultationDraft(
  consultationId: string,
  updates: ConsultationUpdate
): Promise<void> {
  // Defensa adicional cliente — RLS también debería bloquear updates a signed
  const { data: current, error: readErr } = await supabase
    .from('consultations')
    .select('status')
    .eq('id', consultationId)
    .single();
  if (readErr) throw readErr;
  if (current?.status === 'signed') {
    throw new Error('Consulta firmada — no se puede editar.');
  }

  const { error } = await supabase
    .from('consultations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', consultationId);

  if (error) throw error;
}

/**
 * Indica si una consulta está realmente "vacía" — sin contenido escrito ni
 * diagnósticos/recetas asignados. Solo entonces se permite hard-delete.
 *
 * Nota: NO chequea vitals porque pertenecen a appointment_id (independientes
 * de la consulta), así que descartar una consulta no debería afectar vitales.
 */
export async function isDraftConsultationEmpty(consultationId: string): Promise<boolean> {
  const { data: c, error } = await supabase
    .from('consultations')
    .select('chief_complaint, history_present_illness, family_history_notes, physical_exam, internal_analysis, plan, status')
    .eq('id', consultationId)
    .single();
  if (error) throw error;
  if (!c) return false;
  if (c.status !== 'draft') return false;

  const hasText = !!(
    c.chief_complaint?.trim() ||
    c.history_present_illness?.trim() ||
    c.family_history_notes?.trim() ||
    c.physical_exam?.trim() ||
    c.internal_analysis?.trim() ||
    c.plan?.trim()
  );
  if (hasText) return false;

  const [{ count: diagCount }, { count: rxCount }] = await Promise.all([
    supabase.from('consultation_diagnoses').select('id', { count: 'exact', head: true }).eq('consultation_id', consultationId),
    supabase.from('prescriptions').select('id', { count: 'exact', head: true }).eq('consultation_id', consultationId),
  ]);

  return (diagCount ?? 0) === 0 && (rxCount ?? 0) === 0;
}

/**
 * Descarta un borrador SOLO si está completamente vacío. Hard-delete.
 * Si tiene cualquier contenido, lanza error — el médico debe firmar o dejar
 * en draft. Esto preserva integridad clínica/legal.
 *
 * El audit_log captura el snapshot vía trigger antes del DELETE.
 */
export async function discardEmptyConsultation(consultationId: string): Promise<void> {
  const isEmpty = await isDraftConsultationEmpty(consultationId);
  if (!isEmpty) {
    throw new Error(
      'No se puede descartar: la consulta tiene contenido o ya está firmada. Si abriste por error y querés salir, simplemente regresá — el borrador queda guardado.'
    );
  }

  const { error } = await supabase
    .from('consultations')
    .delete()
    .eq('id', consultationId)
    .eq('status', 'draft'); // Defensa adicional contra race
  if (error) throw error;
}

/**
 * Firma la consulta — la vuelve inmutable + transiciona automáticamente
 * la cita a 'atendida' (si no está ya en estado final).
 *
 * Esto cierra el flujo: el médico firma → cita queda atendida sin tener
 * que ir a citas y cambiar el estado manualmente.
 */
export async function signConsultation(consultationId: string): Promise<void> {
  const now = new Date().toISOString();

  // 1. Firmar la consulta
  const { error: signErr } = await supabase
    .from('consultations')
    .update({
      status: 'signed' as const,
      signed_at: now,
      updated_at: now,
    })
    .eq('id', consultationId)
    .eq('status', 'draft'); // Defensa: solo si todavía es draft
  if (signErr) throw signErr;

  // 2. Auto-transición de la cita asociada (best-effort, no rompe la firma si falla)
  try {
    const { data: c } = await supabase
      .from('consultations')
      .select('appointment_id')
      .eq('id', consultationId)
      .single();

    if (!c?.appointment_id) return;

    // Estado actual de la cita
    const { data: apt } = await supabase
      .from('appointments')
      .select('status:appointment_statuses(name)')
      .eq('id', c.appointment_id)
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentName = (apt as any)?.status?.name;
    const finalStates = ['atendida', 'cancelada', 'no_asistio'];
    if (finalStates.includes(currentName)) return; // Ya en estado final

    // Buscar el id del estado 'atendida'
    const { data: atendidaStatus } = await supabase
      .from('appointment_statuses')
      .select('id')
      .eq('name', 'atendida')
      .single();

    if (atendidaStatus) {
      await supabase
        .from('appointments')
        .update({ status_id: atendidaStatus.id, updated_at: now })
        .eq('id', c.appointment_id);
    }
  } catch (err) {
    console.warn('[signConsultation] auto-transición de cita falló:', err);
    // No lanzamos: la firma es lo crítico, el cambio de estado es bonus
  }
}
