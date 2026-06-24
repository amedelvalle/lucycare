import { useQuery } from '@tanstack/react-query';
import {
  getPatientQuickSummary,
  type PatientQuickSummary,
} from '@/services/patientQuickSummary.service';

/**
 * Resumen rápido del paciente para el médico (read-only, PR-1).
 *
 * Gate de ROL en la capa de datos: la query SOLO se dispara cuando `role ===
 * 'doctor'` (además de `patientId` + `doctorId`). Un asistente puede traer
 * `doctorId` desde useClinicContext, así que `doctorId` no basta — sin contexto
 * médico no se ejecuta ninguna lectura (ni de `patients`/alergias/tipo de
 * sangre/notas) y el servicio devuelve vacío seguro. La UI (PR-2) además debe
 * gatear visualmente por `role === 'doctor'` y mostrar la tarjeta según
 * `data.hasHistory`.
 *
 * `currentConsultationId` excluye la consulta en curso del historial.
 */
export function usePatientQuickSummary(
  patientId?: string,
  doctorId?: string | null,
  role?: string | null,
  currentConsultationId?: string,
) {
  const isDoctorContext = role === 'doctor';
  return useQuery<PatientQuickSummary>({
    queryKey: ['patient-quick-summary', patientId, doctorId, role, currentConsultationId],
    queryFn: () =>
      getPatientQuickSummary(patientId!, doctorId, isDoctorContext, currentConsultationId),
    enabled: !!patientId && !!doctorId && isDoctorContext,
    staleTime: 1000 * 60 * 5, // 5 min — cambia poco dentro de una consulta
  });
}
