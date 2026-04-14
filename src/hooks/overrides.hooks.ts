// src/hooks/useOverrides.ts
// S2-03: React Query hooks para gestión de bloqueos de agenda

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getBlockTypes,
  getOverrides,
  createOverride,
  updateOverride,
  deleteOverride,
  getAppointmentsInRange,
  type CreateOverrideInput,
  type UpdateOverrideInput,
} from '@/services/overrides.service';

// ─── Query Keys ──────────────────────────────────────────────────────
export const overrideKeys = {
  all: ['overrides'] as const,
  list: (doctorId: string) => [...overrideKeys.all, 'list', doctorId] as const,
  detail: (id: string) => [...overrideKeys.all, 'detail', id] as const,
  blockTypes: ['block-types'] as const,
  appointmentsInRange: (doctorId: string, start: string, end: string) =>
    [...overrideKeys.all, 'appointments-in-range', doctorId, start, end] as const,
};

// ─── Hooks ───────────────────────────────────────────────────────────

/**
 * Obtener tipos de bloqueo (catálogo)
 */
export function useBlockTypes() {
  return useQuery({
    queryKey: overrideKeys.blockTypes,
    queryFn: getBlockTypes,
    staleTime: 1000 * 60 * 30, // 30 min — es catálogo, cambia poco
  });
}

/**
 * Obtener bloqueos de un doctor (vigentes y futuros por defecto)
 */
export function useOverrides(doctorId: string | undefined) {
  return useQuery({
    queryKey: overrideKeys.list(doctorId ?? ''),
    queryFn: () => getOverrides(doctorId!),
    enabled: !!doctorId,
  });
}

/**
 * Crear un nuevo bloqueo
 */
export function useCreateOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateOverrideInput) => createOverride(input),
    onSuccess: (_data, variables) => {
      // Invalidar la lista de bloqueos del doctor
      queryClient.invalidateQueries({
        queryKey: overrideKeys.list(variables.doctor_id),
      });
      // También invalidar slots porque un nuevo bloqueo afecta disponibilidad
      queryClient.invalidateQueries({
        queryKey: ['slots'],
      });
    },
  });
}

/**
 * Actualizar un bloqueo existente
 */
export function useUpdateOverride(doctorId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateOverrideInput }) =>
      updateOverride(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: overrideKeys.list(doctorId),
      });
      queryClient.invalidateQueries({
        queryKey: ['slots'],
      });
    },
  });
}

/**
 * Eliminar un bloqueo
 */
export function useDeleteOverride(doctorId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (overrideId: string) => deleteOverride(overrideId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: overrideKeys.list(doctorId),
      });
      queryClient.invalidateQueries({
        queryKey: ['slots'],
      });
    },
  });
}

/**
 * Verificar citas existentes en un rango de fechas
 * (para advertir al doctor antes de bloquear)
 */
export function useAppointmentsInRange(
  doctorId: string | undefined,
  dateStart: string,
  dateEnd: string
) {
  return useQuery({
    queryKey: overrideKeys.appointmentsInRange(doctorId ?? '', dateStart, dateEnd),
    queryFn: () => getAppointmentsInRange(doctorId!, dateStart, dateEnd),
    enabled: !!doctorId && !!dateStart && !!dateEnd,
  });
}
