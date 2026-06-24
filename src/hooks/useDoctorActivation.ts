import { useQuery } from '@tanstack/react-query';
import {
  getDoctorActivation,
  type DoctorActivation,
} from '@/services/doctorActivation.service';

/**
 * Checklist de activación del médico (Gate 2, read-only, PR-1).
 *
 * Gate de ROL en la capa de datos: la query SOLO se dispara cuando
 * `role === 'doctor'` (además de `doctorId`). Un asistente trae `doctorId` desde
 * useClinicContext, así que `doctorId` no basta — sin contexto médico no se
 * ejecuta ninguna lectura y el servicio devuelve estado vacío seguro. La UI
 * (PR-2) además debe gatear por `role === 'doctor'` y ocultar la tarjeta cuando
 * `allDone` sea true.
 */
export function useDoctorActivation(
  doctorId?: string | null,
  clinicId?: string | null,
  role?: string | null,
) {
  const isDoctorContext = role === 'doctor';
  return useQuery<DoctorActivation>({
    queryKey: ['doctor-activation', doctorId, clinicId, role],
    queryFn: () => getDoctorActivation(doctorId, clinicId, isDoctorContext),
    enabled: !!doctorId && isDoctorContext,
    staleTime: 1000 * 60 * 2, // 2 min — la configuración cambia poco
  });
}
