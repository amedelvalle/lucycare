import { supabase } from '@/lib/supabase';

// ─── Tipos ────────────────────────────────────────────────────────────

export interface Vitals {
  id: string;
  appointment_id: string;
  patient_id: string;
  recorded_at: string;
  recorded_by: string | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  respiratory_rate: number | null;
  temperature: number | null;
  spo2: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  bmi: number | null;
}

export interface VitalsInput {
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  heart_rate?: number | null;
  respiratory_rate?: number | null;
  temperature?: number | null;
  spo2?: number | null;
  weight_kg?: number | null;
  height_cm?: number | null;
}

export type BmiCategory =
  | 'bajo_peso'
  | 'normal'
  | 'sobrepeso'
  | 'obesidad_1'
  | 'obesidad_2'
  | 'obesidad_3';

export interface BmiResult {
  bmi: number;
  category: BmiCategory;
  label: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Calcula IMC y devuelve categoría OMS.
 * Devuelve null si faltan datos o son inválidos.
 */
export function computeBmi(weightKg: number | null, heightCm: number | null): BmiResult | null {
  if (!weightKg || !heightCm) return null;
  if (weightKg <= 0 || heightCm <= 0) return null;

  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  const rounded = Math.round(bmi * 10) / 10;

  let category: BmiCategory;
  let label: string;
  if (rounded < 18.5) {
    category = 'bajo_peso';
    label = 'Bajo peso';
  } else if (rounded < 25) {
    category = 'normal';
    label = 'Normal';
  } else if (rounded < 30) {
    category = 'sobrepeso';
    label = 'Sobrepeso';
  } else if (rounded < 35) {
    category = 'obesidad_1';
    label = 'Obesidad grado I';
  } else if (rounded < 40) {
    category = 'obesidad_2';
    label = 'Obesidad grado II';
  } else {
    category = 'obesidad_3';
    label = 'Obesidad grado III';
  }
  return { bmi: rounded, category, label };
}

// ─── Funciones ────────────────────────────────────────────────────────

/**
 * Devuelve los signos vitales de una cita o null si aún no hay registro.
 */
export async function getVitalsByAppointment(
  appointmentId: string
): Promise<Vitals | null> {
  const { data, error } = await supabase
    .from('vitals')
    .select('*')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (error) throw error;
  return (data as Vitals) ?? null;
}

/**
 * Crea o actualiza signos vitales para una cita. Calcula IMC client-side.
 * Si la asistente capturó antes, esto sobrescribe (última captura gana).
 */
export async function upsertVitals(
  appointmentId: string,
  patientId: string,
  input: VitalsInput
): Promise<Vitals> {
  const { data: { user } } = await supabase.auth.getUser();
  const bmiResult = computeBmi(input.weight_kg ?? null, input.height_cm ?? null);

  // ¿Existe ya un registro para esta cita?
  const { data: existing, error: readErr } = await supabase
    .from('vitals')
    .select('id')
    .eq('appointment_id', appointmentId)
    .maybeSingle();
  if (readErr) throw readErr;

  const payload = {
    ...input,
    bmi: bmiResult?.bmi ?? null,
    recorded_at: new Date().toISOString(),
    recorded_by: user?.id ?? null,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('vitals')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as Vitals;
  } else {
    const { data, error } = await supabase
      .from('vitals')
      .insert({
        ...payload,
        appointment_id: appointmentId,
        patient_id: patientId,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as Vitals;
  }
}
