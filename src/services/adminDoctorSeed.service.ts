/**
 * ADMIN-DOCTOR-SEED-P0 — creación administrativa de un perfil médico
 * SEMBRADO (no reclamado), para prospección comercial.
 *
 * Todo el trabajo privilegiado ocurre en la Edge Function
 * `admin-create-seed-doctor`: es la única que puede crear la identidad
 * técnica que exige la FK `profiles.id → auth.users(id)`, porque eso
 * requiere `service_role` — que JAMÁS puede vivir en el frontend.
 *
 * Este módulo solo:
 *   - genera el `operation_id` (Idempotency-Key) una vez por intento,
 *   - envía el payload con el JWT de la sesión del admin,
 *   - traduce los códigos de error a copy en español (tuteo).
 *
 * El teléfono de verificación del reclamo (privado) y el teléfono público de
 * la clínica son campos SEPARADOS y nunca se copian entre sí.
 */
import { supabase } from '@/lib/supabase';

export interface SeedDoctorPayload {
  full_name: string;
  specialty_id: string | null;
  clinic_name: string;
  clinic_address: string | null;
  clinic_phone: string | null;
  department_id: string | null;
  municipality_id: string | null;
  /** PRIVADO — teléfono de verificación del reclamo (`profiles.phone`). */
  claim_phone: string | null;
  email: string | null;
  bio: string | null;
  consultation_fee: string | null;
  experience_years: string | null;
  jvpm: string | null;
  publish: boolean;
}

export interface SeedDoctorResult {
  doctor_id: string;
  clinic_id: string;
  /** Solo existe si se publicó: el slug lo genera el trigger al publicar. */
  slug: string | null;
  is_published: boolean;
  claim_ready: boolean;
}

/** Copy de los códigos tipados que devuelve la Edge Function. */
const ERROR_COPY: Record<string, string> = {
  not_authenticated: 'Tu sesión expiró. Refresca la página y vuelve a entrar.',
  not_admin: 'No tienes permiso para crear perfiles médicos.',
  bad_request: 'Faltan datos obligatorios o el formato no es válido.',
  payload_mismatch:
    'Esta operación ya se había iniciado con datos distintos. Vuelve a abrir el formulario.',
  in_progress: 'La creación ya está en curso. Espera unos segundos antes de reintentar.',
  previously_failed: 'Este intento ya había fallado. Vuelve a abrir el formulario para empezar de nuevo.',
  duplicate_jvpm: 'Ese número de JVPM ya está registrado para otro médico.',
  duplicate_phone: 'Ese teléfono de verificación ya pertenece a otro perfil médico.',
  d1_incomplete:
    'Para publicar hacen falta nombre, especialidad, clínica y dirección. Puedes guardarlo sin publicar.',
  seed_identity_conflict:
    'No pudimos preparar la identidad técnica de este perfil. Vuelve a abrir el formulario.',
  lease_lost:
    'Otro proceso retomó esta creación. Espera unos segundos y revisa el listado antes de reintentar.',
  compensation_failed:
    'No pudimos crear el perfil y quedó un registro técnico sin limpiar. Avisa al equipo antes de reintentar.',
  internal: 'No pudimos crear el perfil. Prueba de nuevo en un momento.',
};

export function seedErrorMessage(code: string | undefined): string {
  return ERROR_COPY[code ?? ''] ?? ERROR_COPY.internal;
}

/**
 * Error de creación que CONSERVA el código del servidor. El código es lo que
 * permite decidir si la `operation_id` debe rotarse en el próximo envío
 * (ver `seedOperationPolicy`). `code === null` significa que no hubo respuesta
 * interpretable —timeout o error de red—, es decir: **no sabemos** si el
 * servidor procesó la solicitud.
 */
export class SeedDoctorError extends Error {
  readonly code: string | null;
  constructor(code: string | null) {
    super(seedErrorMessage(code ?? undefined));
    this.name = 'SeedDoctorError';
    this.code = code;
  }
}

/**
 * Crea el perfil sembrado. `operationId` DEBE generarse una sola vez por
 * intento y reutilizarse en cada reintento: es la clave de idempotencia que
 * impide crear dos médicos por un doble clic o un retry del navegador.
 */
export async function createSeedDoctor(
  operationId: string,
  payload: SeedDoctorPayload,
): Promise<SeedDoctorResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new SeedDoctorError('not_authenticated');

  const { data, error } = await supabase.functions.invoke('admin-create-seed-doctor', {
    body: payload,
    headers: { 'Idempotency-Key': operationId },
  });

  if (error) {
    // El cuerpo del error trae el código tipado; el mensaje crudo no se muestra.
    // Si NO se puede leer un código, el fallo es ambiguo (timeout o red): se
    // propaga `null` para que el cliente CONSERVE la operation_id.
    let code: string | null = null;
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      code = typeof body?.error === 'string' ? body.error : null;
    } catch {
      /* sin cuerpo legible → ambiguo */
    }
    throw new SeedDoctorError(code);
  }

  if (!data?.ok) throw new SeedDoctorError(typeof data?.error === 'string' ? data.error : null);

  return {
    doctor_id: data.doctor_id,
    clinic_id: data.clinic_id,
    slug: data.slug ?? null,
    is_published: !!data.is_published,
    claim_ready: !!data.claim_ready,
  };
}

/** URL pública del perfil. Solo existe si se publicó: el slug nace al publicar. */
export function publicDoctorUrl(slug: string): string {
  return `${window.location.origin}/doctor/${slug}`;
}
