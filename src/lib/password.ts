/**
 * Política de contraseña — FUENTE ÚNICA de la longitud mínima para CREAR o
 * RESTABLECER una contraseña en LucyCare (AUTH-P1C1).
 *
 * Antes la regla estaba duplicada: `MIN_PASSWORD_LEN = 8` en ClaimProfileModal
 * y el mensaje "al menos 8 caracteres" en `setPasswordWithFetch`
 * (auth.service). Se centraliza aquí SIN cambiar el valor (sigue 8) para que
 * exista una sola fuente de verdad de la política de CREACIÓN.
 *
 * NOTA (alcance): el gate de longitud del LOGIN por EMAIL en LoginModal
 * (`>= 6`) es una validación de formulario de INGRESO (no de creación) y se
 * mantiene aparte a propósito — no representa la política de contraseña, solo
 * habilita el botón "Ingresar". No se toca para no endurecer ni debilitar el
 * login de cuentas existentes.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Texto de ayuda reutilizable para el mínimo de creación. */
export const PASSWORD_MIN_HINT = `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
