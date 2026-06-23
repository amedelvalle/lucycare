/**
 * Read model del "Resumen rápido del paciente" para el médico (PR-1).
 *
 * Agrega — SOLO LECTURA — la historia clínica DOCUMENTADA del paciente CON ESTE
 * MÉDICO, para mostrarse luego (PR-2) como tarjeta dentro de la consulta:
 * cuántas veces lo atendió, última atención y motivo, diagnósticos previos,
 * medicamentos permanentes, notas relevantes, últimos signos vitales y un
 * brief de las últimas consultas.
 *
 * Seguridad / scoping (defensa en profundidad):
 *  - SOLO consultas `status='signed'` ("atención clínica documentada").
 *  - Filtro EXPLÍCITO por `patient_id` + `doctor_id` (no se confía solo en RLS).
 *  - La RLS clínica (s7_26/s7_28/s7_29) ya gatea por `doctor_id =
 *    get_user_doctor_id()`, que es NULL para asistente → un asistente no obtiene
 *    contenido clínico aunque se pase un doctorId. Sin cross-médico/cross-clínica.
 *  - Sin `doctorId` (o usuario no médico) → payload vacío controlado.
 *
 * NO escribe nada. NO usa RPC. Reutiliza `getPermanentPrescriptionsForPatient`.
 */

import { supabase } from '@/lib/supabase';
import { getPermanentPrescriptionsForPatient } from './prescriptions.service';
import { kgToLb } from './vitals.service';

const MAX_DIAGNOSES = 6;
const MAX_MEDICATIONS = 5;
const MAX_BRIEF = 3;

export interface QuickSummaryVitals {
  recordedAt: string;
  weightLb: number | null; // weight_kg (DB) convertido a libras para el médico
  heightCm: number | null;
  bmi: number | null;
  bloodPressure: string | null; // "120/80" si hay ambos, si no null
}

export interface QuickSummaryConsultationBrief {
  consultationId: string;
  signedAt: string;
  reason: string | null; // chief_complaint
  diagnoses: string[];
}

export interface PatientQuickSummary {
  patientId: string;
  /** True si hay ≥1 consulta firmada previa con este médico. */
  hasHistory: boolean;
  totalSignedVisits: number;
  lastSeenAt: string | null; // ISO (signed_at de la más reciente)
  lastVisitReason: string | null;
  previousDiagnoses: string[]; // distinct, por recencia, top N
  permanentMedications: string[]; // commercial_name distinct, top N (helper de permanentes)
  relevantNotes: {
    allergies: string | null;
    bloodType: string | null;
    patientNotes: string | null;
    familyHistory: string | null; // family_history_notes más reciente no vacío
  };
  lastVitals: QuickSummaryVitals | null;
  lastConsultationsBrief: QuickSummaryConsultationBrief[];
}

function emptySummary(patientId: string): PatientQuickSummary {
  return {
    patientId,
    hasHistory: false,
    totalSignedVisits: 0,
    lastSeenAt: null,
    lastVisitReason: null,
    previousDiagnoses: [],
    permanentMedications: [],
    relevantNotes: { allergies: null, bloodType: null, patientNotes: null, familyHistory: null },
    lastVitals: null,
    lastConsultationsBrief: [],
  };
}

interface SignedConsultationRow {
  id: string;
  chief_complaint: string | null;
  family_history_notes: string | null;
  signed_at: string;
}

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Devuelve el resumen rápido del paciente para el médico.
 * @param patientId  ficha del paciente (patients.id).
 * @param doctorId   médico actual (de useClinicContext). Sin él → payload vacío.
 * @param currentConsultationId  si se pasa, se excluye del historial (es la
 *                               consulta en curso, no "previa").
 */
export async function getPatientQuickSummary(
  patientId: string,
  doctorId: string | null | undefined,
  currentConsultationId?: string,
): Promise<PatientQuickSummary> {
  // Gate de contenido clínico: sin médico no se devuelve nada clínico.
  if (!patientId || !doctorId) return emptySummary(patientId);

  // 1. Consultas FIRMADAS del paciente con este médico (excl. la actual),
  //    más reciente primero. Defensa en profundidad: patient_id + doctor_id.
  let consultQ = supabase
    .from('consultations')
    .select('id, chief_complaint, family_history_notes, signed_at')
    .eq('patient_id', patientId)
    .eq('doctor_id', doctorId)
    .eq('status', 'signed')
    .not('signed_at', 'is', null)
    .order('signed_at', { ascending: false });
  if (currentConsultationId) consultQ = consultQ.neq('id', currentConsultationId);

  const { data: consultsRaw, error: cErr } = await consultQ;
  if (cErr) throw new Error(cErr.message);
  const consults = (consultsRaw ?? []) as SignedConsultationRow[];

  // Notas/alertas del paciente + meds permanentes + vitales NO dependen de
  // que haya consultas previas → se piden en paralelo igual.
  const [patientRes, permsRes, vitalsRes] = await Promise.all([
    supabase.from('patients').select('allergies, blood_type, notes').eq('id', patientId).maybeSingle(),
    getPermanentPrescriptionsForPatient(patientId, doctorId, currentConsultationId).catch(() => []),
    supabase
      .from('vitals')
      .select('recorded_at, weight_kg, height_cm, bmi, systolic_bp, diastolic_bp')
      .eq('patient_id', patientId)
      .not('recorded_at', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(1),
  ]);

  const pat = (patientRes.data ?? null) as { allergies: string | null; blood_type: string | null; notes: string | null } | null;

  // Medicamentos permanentes/vigentes (distinct por nombre comercial).
  const permanentMedications = Array.from(
    new Set((permsRes ?? []).map((p) => p.medication.commercial_name).filter(Boolean)),
  ).slice(0, MAX_MEDICATIONS);

  // Últimos signos vitales (RLS los acota a citas de este médico).
  const vRow = (vitalsRes.data?.[0] ?? null) as
    | { recorded_at: string; weight_kg: number | null; height_cm: number | null; bmi: number | null; systolic_bp: number | null; diastolic_bp: number | null }
    | null;
  const lastVitals: QuickSummaryVitals | null = vRow
    ? {
        recordedAt: vRow.recorded_at,
        weightLb: vRow.weight_kg != null ? kgToLb(vRow.weight_kg) : null,
        heightCm: vRow.height_cm,
        bmi: vRow.bmi,
        bloodPressure: vRow.systolic_bp != null && vRow.diastolic_bp != null ? `${vRow.systolic_bp}/${vRow.diastolic_bp}` : null,
      }
    : null;

  const relevantNotes = {
    allergies: clean(pat?.allergies),
    bloodType: pat?.blood_type && pat.blood_type !== 'desconocido' ? pat.blood_type : null,
    patientNotes: clean(pat?.notes),
    familyHistory: clean(consults.find((c) => clean(c.family_history_notes))?.family_history_notes),
  };

  // Sin historia previa: payload vacío controlado (pero con notas/alertas y
  // vitales si existen — son atributos del paciente, no "historia").
  if (consults.length === 0) {
    return { ...emptySummary(patientId), relevantNotes, permanentMedications, lastVitals };
  }

  // 2. Diagnósticos de esas consultas → distinct por recencia.
  const consultIds = consults.map((c) => c.id);
  const signedAtById = new Map(consults.map((c) => [c.id, c.signed_at]));

  const { data: dxRaw, error: dxErr } = await supabase
    .from('consultation_diagnoses')
    .select('consultation_id, diagnosis_name_snapshot, diagnosis:diagnoses(name)')
    .in('consultation_id', consultIds);
  if (dxErr) throw new Error(dxErr.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dxRows = ((dxRaw ?? []) as any[]).map((r) => ({
    consultationId: r.consultation_id as string,
    name: (r.diagnosis_name_snapshot ?? r.diagnosis?.name ?? '').trim(),
  })).filter((r) => r.name);

  // Ordenar por recencia de la consulta (desc) y deduplicar por nombre.
  dxRows.sort((a, b) => {
    const ta = new Date(signedAtById.get(a.consultationId) ?? 0).getTime();
    const tb = new Date(signedAtById.get(b.consultationId) ?? 0).getTime();
    return tb - ta;
  });
  const seenDx = new Set<string>();
  const previousDiagnoses: string[] = [];
  for (const d of dxRows) {
    const key = d.name.toLowerCase();
    if (seenDx.has(key)) continue;
    seenDx.add(key);
    previousDiagnoses.push(d.name);
    if (previousDiagnoses.length >= MAX_DIAGNOSES) break;
  }

  // Diagnósticos por consulta (para el brief de las últimas N).
  const dxByConsult = new Map<string, string[]>();
  for (const d of dxRows) {
    const arr = dxByConsult.get(d.consultationId) ?? [];
    if (!arr.includes(d.name)) arr.push(d.name);
    dxByConsult.set(d.consultationId, arr);
  }

  const lastConsultationsBrief: QuickSummaryConsultationBrief[] = consults.slice(0, MAX_BRIEF).map((c) => ({
    consultationId: c.id,
    signedAt: c.signed_at,
    reason: clean(c.chief_complaint),
    diagnoses: dxByConsult.get(c.id) ?? [],
  }));

  return {
    patientId,
    hasHistory: true,
    totalSignedVisits: consults.length,
    lastSeenAt: consults[0].signed_at,
    lastVisitReason: clean(consults[0].chief_complaint),
    previousDiagnoses,
    permanentMedications,
    relevantNotes,
    lastVitals,
    lastConsultationsBrief,
  };
}
