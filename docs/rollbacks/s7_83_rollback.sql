-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK de s7_83 · DOCTOR-WELCOME-EMAIL-P0
--
-- ⛔ NO EJECUTAR salvo FAIL explícito y autorización del owner.
--
-- ⚠️ Si YA se envió algún correo de bienvenida, borrar las columnas PIERDE el
--    registro de a quién se le escribió y cuándo. En ese caso ejecutar SOLO la
--    parte 1 (funciones) y CONSERVAR las columnas.
--
-- Comprobación previa — si devuelve algo distinto de 0, no borrar columnas:
--   SELECT count(*) FROM doctor_affiliation_requests WHERE welcome_status <> 'not_sent';
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Funciones ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_welcome_email_mark(uuid, text, text);
DROP FUNCTION IF EXISTS public.admin_welcome_email_claim(uuid);
DROP FUNCTION IF EXISTS public.admin_welcome_email_state(uuid);
DROP FUNCTION IF EXISTS public._welcome_email_claimable(text, timestamptz, timestamptz);

-- ─── 2. Constraints y columnas ─────────────────────────────────────────
-- Solo si NO hubo envíos (ver la advertencia de arriba).
ALTER TABLE public.doctor_affiliation_requests
  DROP CONSTRAINT IF EXISTS dar_welcome_status_chk,
  DROP CONSTRAINT IF EXISTS dar_welcome_sent_shape,
  DROP CONSTRAINT IF EXISTS dar_welcome_sending_shape,
  DROP CONSTRAINT IF EXISTS dar_welcome_failed_shape,
  DROP CONSTRAINT IF EXISTS dar_welcome_attempt_order,
  DROP CONSTRAINT IF EXISTS dar_welcome_not_sent_shape;

ALTER TABLE public.doctor_affiliation_requests
  DROP COLUMN IF EXISTS welcome_status,
  DROP COLUMN IF EXISTS welcome_first_attempt_at,
  DROP COLUMN IF EXISTS welcome_last_attempt_at,
  DROP COLUMN IF EXISTS welcome_sent_at,
  DROP COLUMN IF EXISTS welcome_last_error_code;

-- La Edge Function `send-doctor-welcome-email` se retira aparte, desde la CLI.
-- No se toca ningún secreto: este frente no creó ninguno.
