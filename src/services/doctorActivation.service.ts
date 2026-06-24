/**
 * Read model "Activación del médico" (Onboarding operativo — PR-1).
 *
 * Calcula — SOLO LECTURA — el checklist de Gate 2 (configuración en panel) para
 * un médico que YA es operativo: los pasos **self-service** que le faltan para
 * quedar **visible y reservable**. NO cubre Gate 1 (reclamo/habilitación por
 * LucyAdmin).
 *
 * Regla de producto: el checklist principal (`steps`) responde "¿qué puede hacer
 * el médico AHORA para quedar visible y reservable?". Solo pasos que el médico
 * resuelve por sí mismo cuentan para el progreso (`completedCount`/`total`/
 * `allDone`). Lo que depende de LucyAdmin/soporte (datos de clínica) va aparte,
 * como info **no bloqueante** (`clinicStatus`).
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

/** Pasos self-service del checklist principal (cuentan para el progreso). */
export type DoctorActivationStepKey =
  | 'profile'
  | 'availability'
  | 'services'
  | 'booking'
  | 'published';

export interface DoctorActivationStep {
  key: DoctorActivationStepKey;
  /** Copy no técnico, listo para la UI (PR-2). */
  label: string;
  done: boolean;
  /** Pantalla del panel que el médico abre para resolver el paso (self-service). */
  href: string;
}

/**
 * Estado de los datos de clínica — info NO bloqueante. La ubicación
 * (nombre/dirección/depto/muni) hoy solo la edita LucyAdmin
 * (`admin_update_doctor_clinic`), así que NO es un paso accionable del médico
 * y NO cuenta para el progreso principal.
 */
export interface ClinicStatus {
  label: string;
  complete: boolean;
  actionable: false;
  href: null;
  /** Mensaje cuando faltan datos; `null` si está completa. */
  message: string | null;
}

export interface DoctorActivation {
  doctorId: string | null;
  /** Checklist principal: solo pasos self-service. */
  steps: DoctorActivationStep[];
  /** Pasos self-service completados (no incluye clínica). */
  completedCount: number;
  /** Total de pasos self-service. */
  total: number;
  /** True solo si TODOS los pasos self-service están listos (clínica no influye). */
  allDone: boolean;
  /** Datos de clínica: info no bloqueante, fuera del progreso principal. */
  clinicStatus: ClinicStatus;
}

const CLINIC_INCOMPLETE_MESSAGE =
  'Contactá a soporte para actualizar los datos de tu clínica.';

function emptyClinicStatus(): ClinicStatus {
  return { label: 'Datos de clínica', complete: false, actionable: false, href: null, message: null };
}

function emptyActivation(doctorId: string | null | undefined): DoctorActivation {
  return {
    doctorId: doctorId ?? null,
    steps: [],
    completedCount: 0,
    total: 0,
    allDone: false,
    clinicStatus: emptyClinicStatus(),
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

  // ── Pasos SELF-SERVICE (cuentan para el progreso) ───────────────────────
  // Perfil: foto + especialidad (lo mínimo que ve el paciente).
  const profileDone = filled(profile.avatar_url) && filled(profile.specialty_id);
  // Agenda: al menos una regla de disponibilidad activa.
  const availabilityDone = rules.some((r) => r.isActive);
  // Servicios: al menos un servicio activo (reservable).
  const servicesDone = services.some((s) => s.is_active);
  // Reserva en línea activa.
  const bookingDone = profile.booking_enabled === true;
  // Visible en el directorio.
  const publishedDone = profile.is_published === true;

  const steps: DoctorActivationStep[] = [
    { key: 'profile', label: 'Completá tu perfil', done: profileDone, href: '/panel/perfil' },
    { key: 'availability', label: 'Configurá tu agenda', done: availabilityDone, href: '/panel/disponibilidad' },
    { key: 'services', label: 'Agregá tus servicios', done: servicesDone, href: '/panel/servicios' },
    { key: 'booking', label: 'Activá la reserva en línea', done: bookingDone, href: '/panel/perfil' },
    { key: 'published', label: 'Revisá cómo te ven los pacientes', done: publishedDone, href: '/panel/perfil' },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  // ── Clínica: info NO bloqueante (admin/soporte), fuera del progreso ──────
  const clinicComplete =
    !!clinic && filled(clinic.name) && filled(clinic.address_line) && !!clinic.department_id && !!clinic.municipality_id;
  const clinicStatus: ClinicStatus = {
    label: 'Datos de clínica',
    complete: clinicComplete,
    actionable: false,
    href: null,
    message: clinicComplete ? null : CLINIC_INCOMPLETE_MESSAGE,
  };

  return {
    doctorId: effDoctorId,
    steps,
    completedCount,
    total: steps.length,
    // El progreso principal NO depende de la clínica (paso no accionable).
    allDone: completedCount === steps.length,
    clinicStatus,
  };
}
