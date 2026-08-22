/**
 * ADMIN-DOCTOR-SEED-P0 — ciclo de vida de la `operation_id`.
 *
 * Módulo PURO y sin efectos (no importa el cliente de Supabase) para poder
 * probarlo tal cual con el check estático, sin duplicar la lógica.
 *
 * La `operation_id` es la Idempotency-Key. Reutilizarla es lo que impide crear
 * dos médicos; rotarla antes de tiempo rompe esa garantía. Pero `failed` es un
 * estado TERMINAL en la base: si el servidor ya dejó la operación fallida, un
 * intento corregido con la misma clave chocaría para siempre contra
 * `previously_failed`. De ahí esta política.
 */

/**
 * Códigos que llegan CON respuesta del servidor pero **no** dejan la operación
 * en un estado terminal. Ante ellos se CONSERVA la clave:
 *
 *   - `in_progress`     — otra request de la misma operación sigue viva.
 *   - `lease_lost`      — otro worker la retomó y es el responsable.
 *   - `payload_mismatch`— inconsistencia de operación: cambiar la clave la
 *     "resolvería" en silencio y crearía un segundo médico. Se le muestra al
 *     usuario, no se esconde.
 */
export const NO_TERMINALES = ['in_progress', 'lease_lost', 'payload_mismatch'] as const;

/** `null` = no hubo respuesta interpretable (timeout, red, error ambiguo). */
export type SeedErrorCode = string | null;

/**
 * ¿El próximo envío debe llevar una `operation_id` nueva?
 *
 * Solo cuando el servidor respondió **inequívocamente** con un código que deja
 * la operación terminada en `failed`. Sin respuesta interpretable la respuesta
 * es siempre **no**: no sabemos si el servidor procesó la solicitud, y esa
 * incertidumbre es justamente lo que la idempotencia resuelve.
 */
export function debeRotarOperationId(code: SeedErrorCode): boolean {
  if (code === null || code === undefined || code === '') return false;
  return !(NO_TERMINALES as readonly string[]).includes(code);
}

/**
 * Devuelve la clave a usar en el próximo envío. `generar` se inyecta para
 * poder probarlo de forma determinista.
 */
export function siguienteOperationId(
  actual: string,
  rotar: boolean,
  generar: () => string,
): string {
  return rotar ? generar() : actual;
}
