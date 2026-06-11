/**
 * Servicio de historial del paciente — Paciente Global Fase 1.
 *
 * Devuelve las atenciones (appointments) del paciente logueado
 * cross-clinic, vía las filas de `patients` que tienen
 * `profile_id = auth.uid()`.
 *
 * IMPORTANTE (Identidad múltiple Fase 1): el filtro "solo las mías como
 * persona" es EXPLÍCITO (`patient.profile_id = uid`), no solo RLS. Para un
 * paciente puro RLS bastaba; pero un médico/asistente también ve por RLS las
 * citas de su clínica (su UI de trabajo), y sin el filtro explícito su
 * "Mis atenciones" personal listaría las citas de la clínica como propias.
 * RLS sigue siendo la defensa de autorización; este filtro define la
 * SEMÁNTICA de la página (mi historial como paciente).
 *
 * Sin datos clínicos profundos: solo metadatos operativos
 * (fecha, médico, clínica, especialidad, servicio, estado).
 * NO se exponen `notes`, `internal_notes`, `cancel_reason`,
 * `payment_status` ni nada del expediente.
 */

import { supabase } from '../lib/supabase';

export interface PatientAppointmentEntry {
  id: string;
  startTime: string;          // ISO
  endTime: string | null;
  status: string;             // display_name traducido
  statusKey: string;          // 'programada' | 'confirmada' | ...
  isFinal: boolean;
  doctorName: string;         // full_name
  specialty: string | null;
  clinicName: string;
  serviceName: string;        // fallback "Consulta médica"
}

export interface ListAppointmentsResult {
  rows: PatientAppointmentEntry[];
  total: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Lista las atenciones del paciente logueado, paginada.
 * - Filtro explícito por persona (`patient.profile_id = uid`); RLS autoriza.
 * - B2 (s7_43): SOLO fichas confirmadas (`link_confirmed_at IS NOT NULL`).
 *   Las vinculadas sin confirmar viven en "Atenciones por confirmar"
 *   (listUnconfirmedLinks) hasta que el paciente decida.
 * - Orden: más reciente primero.
 */
export async function listMyAppointments(options: { page?: number; pageSize?: number } = {}): Promise<ListAppointmentsResult> {
  const page = Math.max(0, options.page ?? 0);
  const pageSize = Math.max(1, Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, 100));
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return { rows: [], total: 0 };

  const { data, error, count } = await supabase
    .from('appointments')
    .select(
      `
      id,
      start_time,
      end_time,
      patient:patient_id!inner ( profile_id, link_confirmed_at ),
      doctor:doctor_id (
        id,
        profiles:profile_id (
          full_name
        ),
        specialties (
          name
        )
      ),
      clinic:clinic_id (
        name
      ),
      service:service_id (
        name
      ),
      status:status_id (
        name,
        display_name,
        is_final
      )
      `,
      { count: 'exact' },
    )
    .eq('patient.profile_id', uid)
    .not('patient.link_confirmed_at', 'is', null)
    .order('start_time', { ascending: false })
    .range(from, to);

  if (error) {
    console.warn('[listMyAppointments] error:', error.message);
    return { rows: [], total: 0 };
  }

  const rows: PatientAppointmentEntry[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const doctor = (row.doctor ?? {}) as { profiles?: { full_name?: string }; specialties?: { name?: string } };
    const clinic = (row.clinic ?? {}) as { name?: string };
    const service = (row.service ?? {}) as { name?: string };
    const status = (row.status ?? {}) as { name?: string; display_name?: string; is_final?: boolean };

    return {
      id: row.id as string,
      startTime: row.start_time as string,
      endTime: (row.end_time as string | null) ?? null,
      doctorName: doctor.profiles?.full_name ?? 'Médico',
      specialty: doctor.specialties?.name ?? null,
      clinicName: clinic.name && clinic.name.trim() !== '' ? clinic.name : 'No especificada',
      serviceName: service.name && service.name.trim() !== '' ? service.name : 'Consulta médica',
      status: status.display_name ?? status.name ?? 'Pendiente',
      statusKey: status.name ?? 'pendiente',
      isFinal: !!status.is_final,
    };
  });

  return {
    rows,
    total: count ?? 0,
  };
}

/**
 * Wrapper para invocar la RPC de vinculación retroactiva.
 * Fail-safe: nunca lanza errores que puedan romper el login.
 * Devuelve linkedCount para que la UI pueda mostrar un toast/badge
 * post-OTP si querés en el futuro.
 */
export interface ClaimResult {
  success: boolean;
  linkedCount: number;
  reason?: string;
}

export async function claimMyPatientRecords(): Promise<ClaimResult> {
  try {
    const { data, error } = await supabase.rpc('claim_patient_records');
    if (error) {
      console.warn('[claimMyPatientRecords] RPC error (silenciado):', error.message);
      return { success: false, linkedCount: 0 };
    }
    const body = (data ?? {}) as { success?: boolean; linked_count?: number; reason?: string };
    return {
      success: !!body.success,
      linkedCount: Number(body.linked_count ?? 0),
      reason: body.reason,
    };
  } catch (err) {
    console.warn('[claimMyPatientRecords] exception (silenciado):', err);
    return { success: false, linkedCount: 0 };
  }
}

// ═════════════ B2 — Confirmación post-claim (s7_43) ═════════════

/** Ficha vinculada pero NO confirmada por el paciente ("¿son tuyas?"). */
export interface UnconfirmedLink {
  patientId: string;
  clinicName: string;
  /** Médico de la atención más reciente de la ficha (si hay atenciones). */
  doctorName: string | null;
  appointmentCount: number;
  /** ISO de la atención más reciente (si hay). */
  lastAppointmentAt: string | null;
}

/**
 * Fichas vinculadas a mi identidad con `link_confirmed_at IS NULL`.
 * Solo metadatos mínimos para decidir (clínica, médico, cantidad, última
 * fecha) — sin contenido clínico. La acción opera por ficha (`patient_id`).
 */
export async function listUnconfirmedLinks(): Promise<UnconfirmedLink[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return [];

  const { data: fichas, error } = await supabase
    .from('patients')
    .select('id, clinic:clinic_id ( name )')
    .eq('profile_id', uid)
    .is('link_confirmed_at', null);

  if (error) {
    console.warn('[listUnconfirmedLinks] error:', error.message);
    return [];
  }

  const out: UnconfirmedLink[] = [];
  for (const f of (fichas ?? []) as unknown as Array<{ id: string; clinic?: { name?: string } }>) {
    // Volumen mínimo (1-3 fichas típicamente): un head-count + última cita.
    const { count } = await supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', f.id);
    const { data: last } = await supabase
      .from('appointments')
      .select('start_time, doctor:doctor_id ( profiles:profile_id ( full_name ) )')
      .eq('patient_id', f.id)
      .order('start_time', { ascending: false })
      .limit(1);
    const lastRow = (last?.[0] ?? null) as unknown as
      | { start_time: string; doctor?: { profiles?: { full_name?: string } } }
      | null;

    out.push({
      patientId: f.id,
      clinicName: f.clinic?.name?.trim() || 'Clínica no especificada',
      doctorName: lastRow?.doctor?.profiles?.full_name ?? null,
      appointmentCount: count ?? 0,
      lastAppointmentAt: lastRow?.start_time ?? null,
    });
  }
  return out;
}

/** "Sí, son mías" — sella la confirmación de la ficha (self-gated en la RPC). */
export async function confirmPatientLink(patientId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_patient_link', { p_patient_id: patientId });
  if (error) throw new Error(error.message);
}

/**
 * "No son mías" — desvincula la ficha, registra el rechazo (pending_review
 * para LucyAdmin) y evita el re-link automático del mismo par en futuros
 * logins (self-gated en la RPC).
 */
export async function rejectPatientLink(patientId: string): Promise<void> {
  const { error } = await supabase.rpc('reject_patient_link', { p_patient_id: patientId });
  if (error) throw new Error(error.message);
}
