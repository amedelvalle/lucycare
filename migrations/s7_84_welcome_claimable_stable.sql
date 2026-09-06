-- ═══════════════════════════════════════════════════════════════════════
-- s7_84 · DOCTOR-WELCOME-EMAIL-P0 · corrección de volatilidad
--
-- `_welcome_email_claimable` se declaró IMMUTABLE en s7_83 y usa `now()`.
-- Eso es incorrecto: IMMUTABLE promete que la salida depende ÚNICAMENTE de
-- los argumentos, y Postgres puede plegar la llamada a una constante en tiempo
-- de planificación. Una ventana temporal congelada es exactamente lo que NO
-- se quiere en la política de reintentos: un `sending` estancado podría
-- quedar reclamable —o dejar de serlo— según cuándo se planificó la consulta.
--
-- Hoy no se manifiesta, porque tanto `admin_welcome_email_claim` como
-- `admin_welcome_email_state` la llaman con valores de COLUMNA, no con
-- constantes, y sin argumentos constantes no hay plegado. Se corrige antes del
-- primer envío real, no después.
--
-- STABLE y no VOLATILE: dentro de una misma sentencia `now()` es fijo (es el
-- timestamp de la transacción), así que la función SÍ es estable en el
-- snapshot. VOLATILE sería más restrictivo de lo necesario y le quitaría al
-- planificador optimizaciones legítimas.
--
-- CAMBIA EXCLUSIVAMENTE LA VOLATILIDAD. Firma, cuerpo, ventanas (23 h / 10
-- min), RPCs, Edge Function y UI quedan intactos. `s7_83` NO se modifica: es
-- el registro de lo que se ejecutó.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._welcome_email_claimable(
  p_status           text,
  p_first_attempt_at timestamptz,
  p_last_attempt_at  timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_status = 'not_sent' THEN true
    WHEN p_status = 'sent'     THEN false
    WHEN p_status NOT IN ('sending', 'failed') THEN false
    WHEN p_first_attempt_at IS NULL THEN false
    WHEN p_first_attempt_at <= now() - interval '23 hours' THEN false
    WHEN p_status = 'failed'  THEN true
    -- sending: solo si el último intento ya no puede estar en vuelo.
    ELSE p_last_attempt_at IS NOT NULL
         AND p_last_attempt_at <= now() - interval '10 minutes'
  END;
$$;

-- `CREATE OR REPLACE` conserva el OID y con él la ACL, así que estos privilegios
-- ya estarían puestos. Se re-afirman a propósito: son el borde de seguridad y
-- no dependen de recordar una conducta implícita de Postgres.
REVOKE ALL ON FUNCTION public._welcome_email_claimable(text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._welcome_email_claimable(text, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._welcome_email_claimable(text, timestamptz, timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION public._welcome_email_claimable(text, timestamptz, timestamptz) TO authenticated;
