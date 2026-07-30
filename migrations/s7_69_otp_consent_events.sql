-- ═══════════════════════════════════════════════════════════
-- Migración S7-69: AUTH-P1D2 — evidencia de consentimiento de OTP
-- ═══════════════════════════════════════════════════════════
-- ADDITIVE-ONLY: crea la tabla append-only `otp_consent_events` y la RPC
-- `record_otp_consent` (SECURITY DEFINER, ejecutable por anon). NO toca otras
-- tablas, RLS existente, el Auth Hook, grants de terceros ni datos.
--
-- ── MODELO ──
-- El consentimiento de OTP se da PRE-AUTH (usuario anónimo, aún sin cuenta): el
-- frontend registra la evidencia ANTES de llamar signInWithOtp. Como anon no
-- puede escribir audit_log (user_id NOT NULL), se usa una tabla propia escrita
-- SOLO por la RPC definer. anon NO tiene SELECT/INSERT/UPDATE/DELETE directo.
--
-- ── QUÉ SE GUARDA / QUÉ NO ──
-- Guarda: teléfono E.164 (+503 + 8 díg), contexto, versión y hash del texto,
-- request_id (idempotencia) y created_at. NUNCA: OTP, captcha token, IP
-- completa, user-agent ni secretos. Append-only, sin purga automática.
--
-- ── TEXTO CANÓNICO DE `otp-consent-v1` (lo que el usuario VE, una sola cadena) ──
--   Te enviaremos un código por SMS para verificar tu número. Al continuar,
--   aceptas nuestra Política de Privacidad.
-- SHA-256 UTF-8 = 86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692
-- El hash corresponde EXACTAMENTE a ese aviso visible: no incluye texto legal
-- oculto ni el contenido ampliado de la Política de Privacidad.
--
-- ── REGISTRO OBLIGATORIO ── El frontend NO envía el OTP si esta RPC falla
-- (ver sendOtp en src/services/auth.service.ts): sin evidencia, no hay SMS.
--
-- ── IDEMPOTENCIA SEGURA (request_id) ──
--   · request_id nuevo            → aplica límite por teléfono/ventana e inserta.
--   · request_id existente + los 4 campos IDÉNTICOS (teléfono, contexto,
--     versión, hash) → éxito idempotente: NO inserta otra fila y NO vuelve a
--     consumir el límite.
--   · request_id existente con CUALQUIER campo distinto → `invalid_request`
--     (P0300), sin insertar y sin revelar qué campo difiere.
--   · Carrera: ON CONFLICT protege; ante conflicto se RELEE la fila y solo se
--     devuelve éxito si coincide exactamente.
--   · LÍMITE ATÓMICO: para un request_id nuevo se toma
--     `pg_advisory_xact_lock` derivado del TELÉFONO antes de contar e
--     insertar → las solicitudes concurrentes del mismo número se serializan;
--     teléfonos distintos no se bloquean entre sí. Lock transaccional (se
--     libera al COMMIT/ROLLBACK), sin tabla de locks ni estado persistente.
--     Los errores no distinguen idempotencia / límite / validación hacia el
--     usuario: el frontend muestra un único mensaje genérico.
--
-- ── REVERSIBLE ── DROP FUNCTION + DROP TABLE (la evidencia se conserva salvo
-- decisión explícita; este frente NO purga).
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Tabla append-only ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.otp_consent_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164        text NOT NULL,
  context           text NOT NULL,
  consent_version   text NOT NULL,
  consent_text_hash text NOT NULL,
  request_id        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Teléfono EXACTO de El Salvador: +503 y ocho dígitos.
  CONSTRAINT otp_consent_phone_sv    CHECK (phone_e164 ~ '^\+503[0-9]{8}$'),
  -- Contextos permitidos.
  CONSTRAINT otp_consent_context_ok  CHECK (context IN ('login','booking','claim')),
  -- Versión y hash EXACTOS (otp-consent-v1).
  CONSTRAINT otp_consent_version_ok  CHECK (consent_version = 'otp-consent-v1'),
  CONSTRAINT otp_consent_hash_ok
    CHECK (consent_text_hash = '86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692')
);

-- request_id idempotente y ÚNICO.
CREATE UNIQUE INDEX IF NOT EXISTS otp_consent_request_id_uniq
  ON public.otp_consent_events (request_id);
-- Búsqueda por teléfono+ventana (dedup/límite de la RPC).
CREATE INDEX IF NOT EXISTS idx_otp_consent_phone_time
  ON public.otp_consent_events (phone_e164, created_at DESC);

-- ─── 2. RLS: sin acceso directo para anon/authenticated ───────────────
ALTER TABLE public.otp_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.otp_consent_events FROM PUBLIC;
REVOKE ALL ON public.otp_consent_events FROM anon;
REVOKE ALL ON public.otp_consent_events FROM authenticated;
-- service_role EXPLÍCITO (no depender de defaults). anon/authenticated: sin
-- SELECT/INSERT/UPDATE/DELETE y sin policies → NO pueden leer ni escribir
-- directo; solo la RPC definer (owner) escribe.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.otp_consent_events TO service_role;

-- ─── 3. RPC append-only, validada, idempotente ────────────────────────
CREATE OR REPLACE FUNCTION public.record_otp_consent(
  p_phone            text,
  p_context          text,
  p_consent_version  text,
  p_consent_text_hash text,
  p_request_id       uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_recent   int;
  v_existing public.otp_consent_events%ROWTYPE;  -- %ROWTYPE, no `record`
  v_rows     int;
BEGIN
  -- Validaciones ESTRICTAS. Errores GENÉRICOS (no filtran detalle).
  IF p_phone IS NULL OR p_phone !~ '^\+503[0-9]{8}$' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0300';
  END IF;
  IF p_context IS NULL OR p_context NOT IN ('login','booking','claim') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0300';
  END IF;
  IF p_consent_version IS DISTINCT FROM 'otp-consent-v1'
     OR p_consent_text_hash IS DISTINCT FROM
        '86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692' THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0300';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0300';
  END IF;

  -- ── IDEMPOTENCIA SEGURA ──────────────────────────────────────────────
  -- Un request_id ya existente SOLO es un reintento válido si coincide EXACTO
  -- en los 4 campos (teléfono, contexto, versión, hash). Si difiere cualquiera,
  -- es una reutilización indebida del id → invalid_request (sin decir cuál
  -- campo difiere) y SIN insertar.
  SELECT * INTO v_existing
  FROM public.otp_consent_events e
  WHERE e.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.phone_e164        = p_phone
       AND v_existing.context           = p_context
       AND v_existing.consent_version   = p_consent_version
       AND v_existing.consent_text_hash = p_consent_text_hash THEN
      -- Reintento idempotente EXACTO: éxito sin insertar otra fila y SIN
      -- volver a consumir el límite por teléfono.
      RETURN;
    END IF;
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0300';
  END IF;

  -- ── SERIALIZACIÓN POR TELÉFONO (límite atómico) ──────────────────────
  -- request_id NUEVO → se toma un advisory lock TRANSACCIONAL derivado del
  -- teléfono: las solicitudes concurrentes del MISMO número se serializan (el
  -- conteo y la inserción quedan bajo el lock, sin ventana TOCTOU), mientras
  -- que teléfonos DISTINTOS no se bloquean entre sí (clave distinta). Es un
  -- lock de PostgreSQL: se libera solo al COMMIT/ROLLBACK, sin tabla de locks
  -- ni estado persistente.
  PERFORM pg_advisory_xact_lock(hashtextextended('otp_consent:' || p_phone, 0));

  -- Doble comprobación BAJO EL LOCK: el request_id pudo aparecer mientras
  -- esperábamos (otra transacción del mismo teléfono).
  SELECT * INTO v_existing
  FROM public.otp_consent_events e
  WHERE e.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.phone_e164        = p_phone
       AND v_existing.context           = p_context
       AND v_existing.consent_version   = p_consent_version
       AND v_existing.consent_text_hash = p_consent_text_hash THEN
      RETURN;  -- reintento idempotente exacto: sin insertar, sin consumir límite
    END IF;
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0300';
  END IF;

  -- Límite por teléfono y ventana (anti-spam): máx 10 / 10 min. Se cuenta e
  -- inserta BAJO EL LOCK → el límite es atómico.
  SELECT count(*) INTO v_recent
  FROM public.otp_consent_events e
  WHERE e.phone_e164 = p_phone
    AND e.created_at > now() - interval '10 minutes';
  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'too_many_requests' USING ERRCODE = 'P0301';
  END IF;

  -- Inserción APPEND-ONLY. ON CONFLICT protege la CARRERA (dos llamadas
  -- concurrentes con el mismo request_id).
  INSERT INTO public.otp_consent_events
    (phone_e164, context, consent_version, consent_text_hash, request_id)
  VALUES
    (p_phone, p_context, p_consent_version, p_consent_text_hash, p_request_id)
  ON CONFLICT (request_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Conflicto CONCURRENTE: la fila la insertó otra transacción entre el
    -- lookup y el INSERT. Se RELEE y se exige coincidencia EXACTA; solo
    -- entonces se devuelve éxito.
    SELECT * INTO v_existing
    FROM public.otp_consent_events e
    WHERE e.request_id = p_request_id;

    IF NOT FOUND
       OR v_existing.phone_e164        <> p_phone
       OR v_existing.context           <> p_context
       OR v_existing.consent_version   <> p_consent_version
       OR v_existing.consent_text_hash <> p_consent_text_hash THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = 'P0300';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_otp_consent(text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_otp_consent(text,text,text,text,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.record_otp_consent(text,text,text,text,uuid) TO authenticated;
-- service_role EXPLÍCITO (backend/smoke); no depender de defaults.
GRANT EXECUTE ON FUNCTION public.record_otp_consent(text,text,text,text,uuid) TO service_role;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Verificación: node scripts/check-s7_69.mjs (estructura, estático).
-- NO aplicar sin autorización del owner. Sin service_role desde el dev.
-- ═══════════════════════════════════════════════════════════
