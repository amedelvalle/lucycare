/**
 * Hooks del directorio — TanStack React Query para cache y estados de carga.
 * 
 * Estos hooks reemplazan el uso directo de mocks en los componentes.
 * Proveen: data, isLoading, error con cache automático.
 * 
 * Implementa: S1-02, S1-03, S1-06 del backlog
 */

import { useQuery } from '@tanstack/react-query'
import {
  fetchDoctors,
  fetchDoctorDetail,
  fetchDoctorBookingReady,
  fetchSpecialties,
  fetchDepartments,
  fetchMunicipalities,
  fetchDirectoryCountries,
} from '../services/directory.service'
import type { DirectoryFilters } from '../types/directory.types'

// ─────────────────────────────────────────────
// LISTADO DE MÉDICOS
// ─────────────────────────────────────────────

/**
 * Hook para obtener la lista de médicos del directorio con filtros.
 * 
 * Uso en page.tsx del Home:
 *   const { data: doctors, isLoading, error } = useDoctors(filters)
 */
export function useDoctors(filters: DirectoryFilters) {
  return useQuery({
    queryKey: ['doctors', filters],
    queryFn: () => fetchDoctors(filters),
    // Solo con país de contexto válido (F3E-2). Deshabilitada queda en
    // `isPending`: el llamador no debe leer `isLoading` para decidir el
    // skeleton, o mostraría «0 resultados» mientras llega el país.
    enabled: filters.countryId != null,
    staleTime: 1000 * 60 * 2, // 2 min cache — los médicos no cambian cada segundo
    placeholderData: (previousData) => previousData, // Mantener datos previos mientras carga nuevos filtros
  })
}

// ─────────────────────────────────────────────
// DETALLE DE UN DOCTOR
// ─────────────────────────────────────────────

/**
 * Hook para obtener el detalle completo de un doctor.
 * 
 * Uso en DoctorDetail page:
 *   const { data: doctor, isLoading, error } = useDoctorDetail(doctorId)
 */
export function useDoctorDetail(doctorId: string | undefined) {
  return useQuery({
    queryKey: ['doctor', doctorId],
    queryFn: () => fetchDoctorDetail(doctorId!),
    enabled: !!doctorId, // No ejecutar si no hay ID
    staleTime: 1000 * 60 * 5, // 5 min cache — el perfil no cambia frecuentemente
  })
}

// ─────────────────────────────────────────────
// CATÁLOGOS PARA FILTROS
// ─────────────────────────────────────────────

/**
 * Países habilitados para el directorio (F3E-2). Un request pequeño por sesión:
 * solo cambia cuando el owner habilita un país.
 */
export function useDirectoryCountries() {
  return useQuery({
    queryKey: ['directory-countries'],
    queryFn: fetchDirectoryCountries,
    staleTime: 1000 * 60 * 60, // 1 hora
  })
}

/** Hook para las especialidades (dropdown del filtro) */
export function useSpecialties() {
  return useQuery({
    queryKey: ['specialties'],
    queryFn: fetchSpecialties,
    staleTime: 1000 * 60 * 30, // 30 min — las especialidades casi no cambian
  })
}

/** Hook para departamentos (dropdown del filtro) */
export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: fetchDepartments,
    staleTime: 1000 * 60 * 60, // 1 hora — los departamentos de SV no cambian
  })
}

/** Hook para municipios, filtrados por departamento si se selecciona uno */
export function useMunicipalities(departmentId: string | null) {
  return useQuery({
    queryKey: ['municipalities', departmentId],
    queryFn: () => fetchMunicipalities(departmentId),
    staleTime: 1000 * 60 * 60, // 1 hora
  })
}

/**
 * Reservabilidad canónica del médico. Se resuelve por `doctor_id`, así que
 * depende del detalle ya cargado (la ruta puede venir por slug).
 *
 * `retry: false` a propósito: ante un fallo queremos decidir YA en fail closed,
 * no reintentar mientras el CTA queda en un limbo visible.
 */
export function useDoctorBookingReady(doctorId: string | undefined) {
  return useQuery({
    queryKey: ['doctor-booking-ready', doctorId],
    queryFn: () => fetchDoctorBookingReady(doctorId!),
    enabled: !!doctorId,
    retry: false,
    staleTime: 1000 * 60,
  })
}
