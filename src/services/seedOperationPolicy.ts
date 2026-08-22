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
 * **Allowlist**: los únicos códigos que autorizan estrenar `operation_id`.
 *
 * El default es CONSERVAR la clave. Se rota solo con evidencia inequívoca de
 * que la operación anterior quedó terminalmente en `failed`:
 *
 *   - `previously_failed` — el claim leyó `status='failed'` ya persistido.
 *   - los cuatro de dominio — la Edge Function los devuelve **únicamente**
 *     cuando `mark_failed` confirmó la persistencia; si no lo confirma,
 *     degrada a `internal`, que no está en esta lista.
 *
 * Todo lo demás conserva la clave, incluido **`internal`**: es genérico y no
 * demuestra que el backend persistiera `failed`. Rotar ante un estado incierto
 * es exactamente lo que crearía un segundo médico.
 */
export const CODIGOS_TERMINALES = [
  'previously_failed',
  'duplicate_jvpm',
  'duplicate_phone',
  'd1_incomplete',
  'seed_identity_conflict',
] as const;

/** `null` = no hubo respuesta interpretable (timeout, red, error ambiguo). */
export type SeedErrorCode = string | null;

/**
 * ¿El próximo envío debe llevar una `operation_id` nueva?
 *
 * Solo ante evidencia inequívoca de terminalidad. Sin respuesta interpretable
 * —o con una respuesta genérica— es siempre **no**: no sabemos si el servidor
 * procesó la solicitud, y esa incertidumbre es justamente lo que la
 * idempotencia resuelve.
 */
export function debeRotarOperationId(code: SeedErrorCode): boolean {
  if (!code) return false;
  return (CODIGOS_TERMINALES as readonly string[]).includes(code);
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
