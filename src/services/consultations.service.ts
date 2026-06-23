import { supabase } from '@/lib/supabase';
import type { DurationUnit } from './prescriptions.service';
import type { DiagnosisType, DiagnosisStatus } from './consultationDiagnoses.service';

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
  // Correcciones post-firma (consultation_amendments).
  //  - amendment_count: total de adendas (texto y/o receta) → historial /
  //    "consulta corregida". 0 en borradores y consultas sin corregir.
  //  - last_corrected_at: fecha de la corrección más reciente (cualquier tipo).
  //  - receta_corrected_at: fecha de la corrección de RECETA más reciente, o
  //    null si ninguna adenda tocó medicamentos (s7_30). Gobierna la marca
  //    "RECETA CORREGIDA" de impresión — una corrección solo de texto NO la
  //    dispara.
  amendment_count: number;
  last_corrected_at: string | null;
  receta_corrected_at: string | null;
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

  // 3. Cargar contexto: paciente + cita + médico (para receta) + adendas
  const [
    { data: patient, error: pErr },
    { data: apt, error: aErr },
    { data: doctor, error: dErr },
    { data: amendments, error: amErr },
  ] = await Promise.all([
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
      // Adendas de corrección: las más recientes primero. Vacío en borradores
      // y consultas no corregidas (la RLS solo deja leerlas al médico dueño).
      // affects_prescriptions distingue corrección de receta vs solo texto.
      supabase
        .from('consultation_amendments')
        .select('corrected_at, affects_prescriptions')
        .eq('consultation_id', consultation.id)
        .order('corrected_at', { ascending: false }),
    ]);

  if (pErr) throw pErr;
  if (aErr) throw aErr;
  if (dErr) throw dErr;
  if (amErr) throw amErr;

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
    amendment_count: amendments?.length ?? 0,
    last_corrected_at: amendments?.[0]?.corrected_at ?? null,
    // amendments viene ordenado desc por corrected_at → la primera con
    // affects_prescriptions es la corrección de receta más reciente.
    receta_corrected_at:
      amendments?.find((a) => a.affects_prescriptions)?.corrected_at ?? null,
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

  const [{ count: diagCount }, { count: rxCount }, { count: fhCount }] = await Promise.all([
    supabase.from('consultation_diagnoses').select('id', { count: 'exact', head: true }).eq('consultation_id', consultationId),
    supabase.from('prescriptions').select('id', { count: 'exact', head: true }).eq('consultation_id', consultationId).eq('is_current', true),
    supabase.from('consultation_family_history').select('id', { count: 'exact', head: true }).eq('consultation_id', consultationId),
  ]);

  return (diagCount ?? 0) === 0 && (rxCount ?? 0) === 0 && (fhCount ?? 0) === 0;
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

  // Defensa clínico-legal: solo doctores pueden firmar (la firma identifica
  // responsabilidad médica). Las asistentes nunca pueden firmar aunque tengan
  // acceso de UI a la consulta.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profileErr) throw profileErr;
  if (profile?.role !== 'doctor') {
    throw new Error('Solo el médico tratante puede firmar una consulta.');
  }

  // 1. Firmar la consulta — vía RPC SECURITY DEFINER (s7_28). El gate es
  // server-side (solo el médico dueño puede firmar; rechaza si ya está
  // firmada). El UPDATE directo de consultas firmadas quedó bloqueado por
  // RLS para impedir edición silenciosa; la firma la hace la RPC, que al
  // ser definer bypasea esa RLS. El sync cita→atendida lo dispara el
  // trigger sync_appointment_on_sign (s6_02) con el UPDATE de la RPC.
  const { error: signErr } = await supabase.rpc('sign_consultation', {
    p_consultation_id: consultationId,
  });
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

// ─── Corrección controlada de consulta firmada (B2) ───────────────────

/** Campos de texto corregibles por la UI de corrección. Todos están en el
 * whitelist server-side de amend_consultation (s7_31). `family_history_notes`
 * = antecedentes familiares como texto libre (PR-E2; la corrección estructurada
 * de antecedentes queda como histórico read-only). */
export type ConsultationTextField =
  | 'chief_complaint'
  | 'history_present_illness'
  | 'physical_exam'
  | 'internal_analysis'
  | 'family_history_notes'
  | 'plan';

export type ConsultationTextChanges = Partial<Record<ConsultationTextField, string | null>>;

export interface ConsultationAmendment {
  id: string;
  version: number;
  reason: string;
  corrected_at: string;
  affects_prescriptions: boolean;
}

/** Operaciones de receta para amend_consultation (s7_29). Cualquier op no
 * vacía marca affects_prescriptions=true → impresión "RECETA CORREGIDA". */
export interface PrescriptionReplaceOp {
  op: 'replace';
  prescription_id: string;
  medication_id?: string;   // solo si se sustituye el medicamento
  dosage?: string | null;
  frequency?: string | null;
  duration_value?: number | null;
  duration_unit?: DurationUnit | null;
  instructions?: string | null;
}
export interface PrescriptionAddOp {
  op: 'add';
  medication_id: string;
  dosage?: string | null;
  frequency?: string | null;
  duration_value?: number | null;
  duration_unit?: DurationUnit | null;
  instructions?: string | null;
}
export interface PrescriptionRemoveOp {
  op: 'remove';
  prescription_id: string;
}
export type PrescriptionOp = PrescriptionReplaceOp | PrescriptionAddOp | PrescriptionRemoveOp;

/** Operaciones de diagnósticos (s7_31). */
export interface DiagnosisReplaceOp {
  op: 'replace';
  id: string;                 // consultation_diagnoses.id
  diagnosis_id?: string;      // solo si se cambia el diagnóstico
  diagnosis_type?: DiagnosisType;
  diagnosis_status?: DiagnosisStatus;
  notes?: string | null;
}
export interface DiagnosisAddOp {
  op: 'add';
  diagnosis_id: string;
  diagnosis_type?: DiagnosisType;
  diagnosis_status?: DiagnosisStatus;
  notes?: string | null;
}
export interface DiagnosisRemoveOp { op: 'remove'; id: string; }
export type DiagnosisOp = DiagnosisReplaceOp | DiagnosisAddOp | DiagnosisRemoveOp;

/** Operaciones de antecedentes familiares estructurados (s7_31). */
export interface FamilyHistoryReplaceOp {
  op: 'replace';
  id: string;                 // consultation_family_history.id
  family_history_id?: string;
  notes?: string | null;
}
export interface FamilyHistoryAddOp { op: 'add'; family_history_id: string; notes?: string | null; }
export interface FamilyHistoryRemoveOp { op: 'remove'; id: string; }
export type FamilyHistoryOp = FamilyHistoryReplaceOp | FamilyHistoryAddOp | FamilyHistoryRemoveOp;

/** Cambios de signos vitales (s7_31). Una fila por cita; bmi lo computa el
 * cliente. Solo se mandan los campos modificados (null = limpiar el signo). */
export type VitalsField =
  | 'systolic_bp' | 'diastolic_bp' | 'heart_rate' | 'respiratory_rate'
  | 'temperature' | 'spo2' | 'weight_kg' | 'height_cm';
export type VitalsChanges = Partial<Record<VitalsField | 'bmi', number | null>>;

/**
 * Corrige una consulta FIRMADA vía la RPC amend_consultation (s7_29/s7_30) en
 * una sola transacción: campos de texto (p_consultation_changes) + operaciones
 * de receta (p_prescription_ops). El gate (médico dueño, firmada, motivo
 * obligatorio, campos prohibidos, versionado de recetas, affects_prescriptions)
 * es server-side. Enviar SOLO lo modificado.
 */
export async function amendConsultation(
  consultationId: string,
  reason: string,
  changes: ConsultationTextChanges,
  prescriptionOps: PrescriptionOp[] = [],
  diagnosisOps: DiagnosisOp[] = [],
  familyHistoryOps: FamilyHistoryOp[] = [],
  vitalsChanges: VitalsChanges = {}
): Promise<void> {
  const { error } = await supabase.rpc('amend_consultation', {
    p_consultation_id: consultationId,
    p_reason: reason,
    p_consultation_changes: changes,
    p_prescription_ops: prescriptionOps,
    p_diagnosis_ops: diagnosisOps,
    p_family_history_ops: familyHistoryOps,
    p_vitals_changes: vitalsChanges,
  });
  if (error) throw error;
}

/** Historial de adendas de una consulta (más reciente primero). RLS: solo el
 * médico dueño. */
export async function getConsultationAmendments(
  consultationId: string
): Promise<ConsultationAmendment[]> {
  const { data, error } = await supabase
    .from('consultation_amendments')
    .select('id, version, reason, corrected_at, affects_prescriptions')
    .eq('consultation_id', consultationId)
    .order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConsultationAmendment[];
}
