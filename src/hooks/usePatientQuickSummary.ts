import { useQuery } from '@tanstack/react-query';
import {
  getPatientQuickSummary,
  type PatientQuickSummary,
} from '@/services/patientQuickSummary.service';

/**
 * Resumen rápido del paciente para el médico (read-only, PR-1).
 *
 * `enabled` solo cuando hay `patientId` y `doctorId` → para un asistente (o sin
 * médico) no se dispara la query y, aunque se disparara, la RLS clínica devuelve
 * vacío. La UI (PR-2) decide mostrar la tarjeta según `data.hasHistory`.
 *
 * `currentConsultationId` excluye la consulta en curso del historial.
 */
export function usePatientQuickSummary(
  patientId?: string,
  doctorId?: string | null,
  currentConsultationId?: string,
) {
  return useQuery<PatientQuickSummary>({
    queryKey: ['patient-quick-summary', patientId, doctorId, currentConsultationId],
    queryFn: () => getPatientQuickSummary(patientId!, doctorId, currentConsultationId),
    enabled: !!patientId && !!doctorId,
    staleTime: 1000 * 60 * 5, // 5 min — cambia poco dentro de una consulta
  });
}
