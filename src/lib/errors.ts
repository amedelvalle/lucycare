/**
 * Traduce errores (de Supabase / Postgres o de nuestros servicios) a un
 * mensaje en español apto para mostrar al usuario final.
 *
 * - Los errores que lanzan nuestros servicios y triggers ya tienen un
 *   mensaje claro ("No se puede asignar un servicio inactivo...") → se
 *   muestran tal cual.
 * - Los errores crudos de Postgres (jerga en inglés: "duplicate key
 *   value violates unique constraint...") NUNCA se muestran al usuario.
 */

/** SQLSTATE de violación de constraint UNIQUE. */
const UNIQUE_VIOLATION = '23505';

const RAW_PG_NOISE =
  /violates|duplicate key|constraint|null value in column|permission denied|syntax error|does not exist/i;

export function friendlyErrorMessage(
  err: unknown,
  fallback = 'Ocurrió un error inesperado. Intentá de nuevo.'
): string {
  if (!err) return fallback;
  const e = err as { code?: string; message?: string };

  if (e.code === UNIQUE_VIOLATION) {
    return /document/i.test(e.message ?? '')
      ? 'Ya existe un paciente con ese documento en la clínica.'
      : 'Ya existe un registro con esos datos.';
  }

  const msg = (e.message ?? '').trim();
  if (!msg) return fallback;

  // Si el mensaje parece jerga cruda de Postgres, no exponerlo.
  if (RAW_PG_NOISE.test(msg)) return fallback;

  return msg;
}
