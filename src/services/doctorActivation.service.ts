/**
 * Read model "Activación del médico" (Onboarding operativo — PR-1).
 *
 * Calcula — SOLO LECTURA — el checklist de Gate 2 (configuración en panel) para
 * un médico que YA es operativo: los pasos que le faltan para quedar **visible y
 * reservable**. NO cubre Gate 1 (reclamo/habilitación por LucyAdmin).
 *
 * Seguridad / scoping (mismo criterio que el "Resumen rápido del paciente"):
 *  - GATE DE ROL: solo médico (`isDoctorContext === true`). Un asistente trae
 *    `doctorId`, así que `doctorId` NO basta. Sin contexto médico → estado vacío
 *    seguro ANTES de cualquier query.
 *  - Las señales se derivan del médico de la SESIÓN (`getMyDoctorProfile`, RLS
 *    doctor-scoped). Los ids del caller se aceptan solo como verificación de
 *    consistencia (si no coinciden con la sesión → vacío). Nunca cross-médico
 *    ni cross-clínica.
 *
 * NO escribe nada. NO usa RPC. Reutiliza helpers existentes.
 */

import { supabase } from '@/lib/supabase';
import { getMyDoctorProfile } from './doctorProfile.service';
import { getMyAvailabilityRules } from './availability.service';
import { listDoctorServices } from './services.service';

export type DoctorActivationStepKey =
  | 'profile'
  | 'clinic'
  | 'availability'
  | 'services'
  | 'booking'
  | 'published';

export interface DoctorActivationStep {
  key: DoctorActivationStepKey;
  /** Copy no técnico, listo para la UI (PR-2). */
  label: string;
  done: boolean;
  /** Pantalla del panel que resuelve el paso. `null` si no es self-service. */
  href: string | null;
  /** `false` = el médico no puede resolverlo solo (ej. clínica = admin/soporte). */
  actionable: boolean;
}

export interface DoctorActivation {
  doctorId: string | null;
  steps: DoctorActivationStep[];
  completedCount: number;
  total: number;
  allDone: boolean;
}

function emptyActivation(doctorId: string | null | undefined): DoctorActivation {
  return {
    doctorId: doctorId ?? null,
    steps: [],
    completedCount: 0,
    total: 0,
    allDone: false,
  };
}

const filled = (s: string | null | undefined): boolean => (s ?? '').trim() !== '';

/**
 * Devuelve el checklist de activación (Gate 2) del médico de la sesión.
 * @param doctorId  médico actual (de useClinicContext). Debe coincidir con la sesión.
 * @param clinicId  clínica actual. Verificación de consistencia.
 * @param isDoctorContext  `true` SOLO si el usuario es médico (`role==='doctor'`).
 *                         Cualquier otro valor → vacío ANTES de tocar la DB.
 */
export async function getDoctorActivation(
  doctorId: string | null | undefined,
  clinicId: string | null | undefined,
  isDoctorContext: boolean,
): Promise<DoctorActivation> {
  // Gate de ROL (primero, antes de cualquier query). El asistente trae doctorId,
  // así que doctorId por sí solo NO basta.
  if (isDoctorContext !== true) return emptyActivation(doctorId);

  // Verdad de la sesión (RLS doctor-scoped). No confiamos en los ids del caller
  // para leer datos: derivamos del perfil propio y solo verificamos consistencia.
  const profile = await getMyDoctorProfile();
  if (!profile) return emptyActivation(doctorId);
  if (doctorId && profile.doctor_id !== doctorId) return emptyActivation(doctorId);
  if (clinicId && profile.clinic_id !== clinicId) return emptyActivation(doctorId);

  const effDoctorId = profile.doctor_id;
  const effClinicId = profile.clinic_id;

  // Señales auxiliares en paralelo (todas del propio médico/clínica por RLS).
  const [clinicRes, rules, services] = await Promise.all([
    supabase
      .from('clinics')
      .select('name, address_line, department_id, municipality_id')
      .eq('id', effClinicId)
      .maybeSingle(),
    getMyAvailabilityRules().catch(() => []),
    listDoctorServices(effDoctorId).catch(() => []),
  ]);

  const clinic = (clinicRes.data ?? null) as
    | { name: string | null; address_line: string | null; department_id: string | null; municipality_id: string | null }
    | null;

  // Paso 1 — perfil: foto + especialidad (lo mínimo que ve el paciente).
  const profileDone = filled(profile.avatar_url) && filled(profile.specialty_id);
  // Paso 2 — clínica completa para el directorio (D1): nombre + dirección + depto + muni.
  const clinicDone =
    !!clinic && filled(clinic.name) && filled(clinic.address_line) && !!clinic.department_id && !!clinic.municipality_id;
  // Paso 3 — agenda: al menos una regla de disponibilidad activa.
  const availabilityDone = rules.some((r) => r.isActive);
  // Paso 4 — servicios: al menos un servicio activo (reservable).
  const servicesDone = services.some((s) => s.is_active);
  // Paso 5 — reserva en línea activa.
  const bookingDone = profile.booking_enabled === true;
  // Paso 6 — visible en el directorio.
  const publishedDone = profile.is_published === true;

  const steps: DoctorActivationStep[] = [
    { key: 'profile', label: 'Completá tu perfil', done: profileDone, href: '/panel/perfil', actionable: true },
    // La ubicación de la clínica hoy solo la edita LucyAdmin (admin_update_doctor_clinic),
    // no el médico desde el panel → no self-service (decisión de copy/CTA queda para PR-2).
    { key: 'clinic', label: 'Confirmá los datos de tu clínica', done: clinicDone, href: null, actionable: false },
    { key: 'availability', label: 'Configurá tu agenda', done: availabilityDone, href: '/panel/disponibilidad', actionable: true },
    { key: 'services', label: 'Agregá tus servicios', done: servicesDone, href: '/panel/servicios', actionable: true },
    { key: 'booking', label: 'Activá la reserva en línea', done: bookingDone, href: '/panel/perfil', actionable: true },
    { key: 'published', label: 'Revisá cómo te ven los pacientes', done: publishedDone, href: '/panel/perfil', actionable: true },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return {
    doctorId: effDoctorId,
    steps,
    completedCount,
    total: steps.length,
    allDone: completedCount === steps.length,
  };
}
