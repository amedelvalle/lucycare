import { supabase } from '@/lib/supabase';

/**
 * Servicios / tipos de consulta de un médico (tabla `services`).
 * Cada médico mantiene su propia oferta: nombre, duración y precio.
 * Aparecen en el perfil público y en la reserva online.
 *
 * RLS: SELECT público; INSERT/UPDATE/DELETE solo el médico dueño
 * (`doctor_id = get_user_doctor_id()`). La policy de DELETE la agrega
 * la migración s7_08.
 */

export interface ServiceItem {
  id: string;
  doctor_id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
  is_first_visit: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ServiceInput {
  name: string;
  duration_minutes: number;
  price: number | null;
  is_first_visit: boolean;
}

/** SQLSTATE de violación de foreign key (servicio referenciado por citas). */
export const FK_VIOLATION = '23503';

const COLS = 'id, doctor_id, name, duration_minutes, price, is_first_visit, is_active, sort_order';

/**
 * Lista los servicios del médico (activos + inactivos), ordenados por
 * sort_order y luego nombre. Los servicios son pocos (típicamente 2-5),
 * por eso no hay paginación ni búsqueda.
 */
export async function listDoctorServices(doctorId: string): Promise<ServiceItem[]> {
  const { data, error } = await supabase
    .from('services')
    .select(COLS)
    .eq('doctor_id', doctorId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Crea un servicio nuevo para el médico. `sort_order` queda al final.
 */
export async function createService(
  doctorId: string,
  input: ServiceInput
): Promise<ServiceItem> {
  const name = input.name.trim();
  if (!name) throw new Error('El nombre del servicio es obligatorio');

  // sort_order = (máximo actual) + 1, para que el nuevo quede al final
  const { data: last } = await supabase
    .from('services')
    .select('sort_order')
    .eq('doctor_id', doctorId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('services')
    .insert({
      doctor_id: doctorId,
      name,
      duration_minutes: input.duration_minutes,
      price: input.price,
      is_first_visit: input.is_first_visit,
      is_active: true,
      sort_order: nextSortOrder,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Actualiza campos de un servicio. Solo escribe los campos provistos.
 */
export async function updateService(
  id: string,
  updates: Partial<{
    name: string;
    duration_minutes: number;
    price: number | null;
    is_first_visit: boolean;
    is_active: boolean;
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.duration_minutes !== undefined) payload.duration_minutes = updates.duration_minutes;
  if (updates.price !== undefined) payload.price = updates.price;
  if (updates.is_first_visit !== undefined) payload.is_first_visit = updates.is_first_visit;
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from('services').update(payload).eq('id', id);
  if (error) throw error;
}

/**
 * Borra físicamente un servicio. Si está referenciado por citas
 * (appointments.service_id), el FK lo bloquea y se lanza un error con
 * `code === FK_VIOLATION`; en ese caso la UI ofrece desactivarlo.
 */
export async function deleteService(id: string): Promise<void> {
  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) throw error;
}
