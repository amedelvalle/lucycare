-- ============================================================
-- ROLLBACK de s7_81 · DOCTOR-OWNER-NOTIFICATIONS-P0
-- ============================================================
--
-- Restaura `notify_owner_claim_batch` a su definicion de s7_80, es decir: CON
-- el defecto semantico. El nombre del claim vuelve a salir del perfil ACTUAL
-- del medico y `lucy_status` vuelve a leerse en el momento del envio.
--
-- El cuerpo de abajo NO se transcribio a mano: se extrajo por programa del
-- propio migrations/s7_80_doctor_owner_notifications.sql, para que no pueda
-- divergir por un error de copia.
--
-- s7_80 NO se reaplica: este archivo reproduce su funcion, no ejecuta su
-- migracion. Y no toca la outbox, los triggers, el helper de encolado,
-- notify_owner_mark_result ni claim_doctor_profile — s7_81 tampoco los toco.
--
-- NO se ejecuta salvo FAIL explicito.
--
-- Consecuencia de revertir: un aviso de claim encolado y aun no enviado puede
-- volver a mostrar el nombre del perfil actual y un lucy_status posterior al
-- evento. Es exactamente el defecto que s7_81 corrige.
-- ============================================================

-- ─── 1. Restaurar la funcion de s7_80 ───
CREATE OR REPLACE FUNCTION public.notify_owner_claim_batch(
  p_limit              int      DEFAULT 25,
  p_stale_after        interval DEFAULT interval '10 minutes',
  p_idempotency_window interval DEFAULT interval '23 hours'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $batch$
DECLARE
  -- Piso y TECHO: un lote gigante alargaría la transacción y el tiempo de la
  -- Edge Function sin ganar nada.
  v_limit int      := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_stale interval := GREATEST(COALESCE(p_stale_after, interval '10 minutes'), interval '1 minute');
  -- TECHO DURO de 23 h. Ver arriba.
  v_window interval := LEAST(
                         GREATEST(COALESCE(p_idempotency_window, interval '23 hours'), interval '1 minute'),
                         interval '23 hours');
  v_rows  jsonb;
BEGIN
  -- ── Paso 1: retirar de circulación lo que ya no es idempotente ──
  -- Va ANTES de elegir el lote, de modo que una fila caducada no pueda
  -- colarse en él por ninguna vía.
  UPDATE public.doctor_owner_notifications
     SET status          = 'needs_reconciliation',
         last_error_code = 'idem_window_expired',
         updated_at      = now()
   WHERE status = 'sending'
     AND first_attempt_at IS NOT NULL
     AND first_attempt_at <= now() - v_window;

  -- ── Paso 2: reclamar el lote ──
  WITH picked AS (
    SELECT n.id
      FROM public.doctor_owner_notifications n
     WHERE n.status = 'pending'
        OR (n.status = 'sending'
            AND n.last_attempt_at < now() - v_stale
            -- Cinturón además del tirante del paso 1: aunque alguien llamara
            -- con una ventana distinta, aquí no entra nada caducado.
            AND n.first_attempt_at > now() - v_window)
     ORDER BY n.occurred_at, n.id
     LIMIT v_limit
       FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.doctor_owner_notifications n
       SET status           = 'sending',
           attempts         = n.attempts + 1,
           -- Se fija UNA vez y no se reescribe: es el origen de la ventana.
           first_attempt_at = COALESCE(n.first_attempt_at, now()),
           last_attempt_at  = now(),
           updated_at       = now()
      FROM picked
     WHERE n.id = picked.id
    RETURNING n.id, n.event_type, n.occurred_at, n.attempts,
              n.subject_request_id, n.subject_doctor_id
  )
  SELECT COALESCE(jsonb_agg(
           -- ALLOWLIST EXPLÍCITA. Lo que no esté nombrado aquí no sale de la
           -- base. Fuera quedan a propósito: licencia/JVPM, DUI, direcciones,
           -- el texto libre `message` del lead, tokens y cualquier dato
           -- clínico. El remitente no puede añadir lo que no recibe.
           jsonb_build_object(
             'id',          c.id,
             'event_type',  c.event_type,
             'occurred_at', c.occurred_at,
             'attempt',     c.attempts,
             'full_name',
               CASE WHEN c.event_type = 'affiliation_submitted'
                    THEN r.full_name ELSE p.full_name END,
             'specialty',
               CASE WHEN c.event_type = 'affiliation_submitted'
                    THEN COALESCE(rs.name, NULLIF(btrim(r.specialty_other), ''))
                    ELSE ds.name END,
             -- Teléfono y correo SOLO en el aviso de afiliación: son el dato
             -- de contacto que hace accionable el lead. En el de claim no
             -- aportan nada y por eso no viajan.
             'phone',
               CASE WHEN c.event_type = 'affiliation_submitted' THEN r.phone END,
             'email',
               CASE WHEN c.event_type = 'affiliation_submitted' THEN r.email END,
             'doctor_id',   c.subject_doctor_id,
             'lucy_status',
               CASE WHEN c.event_type = 'doctor_profile_claimed'
                    THEN d.lucy_status::text END
           ) ORDER BY c.occurred_at, c.id), '[]'::jsonb)
    INTO v_rows
    FROM claimed c
    LEFT JOIN public.doctor_affiliation_requests r ON r.id = c.subject_request_id
    LEFT JOIN public.specialties rs ON rs.id = r.specialty_id
    LEFT JOIN public.doctors     d  ON d.id  = c.subject_doctor_id
    LEFT JOIN public.specialties ds ON ds.id = d.specialty_id
    LEFT JOIN public.profiles    p  ON p.id  = d.profile_id;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$batch$;

-- ─── 2. Privilegios ───
REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM anon;
REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) TO service_role;

-- ─── 3. POST del rollback ───
DO $rbpost$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE oid = 'public.notify_owner_claim_batch(int, interval, interval)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK fallo: la funcion desaparecio';
  END IF;
  IF position('p.id  = d.profile_id' in v_src) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: no volvio el join de s7_80';
  END IF;
  IF position('p.id  = c.subject_profile_id' in v_src) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: sobrevive la correccion de s7_81';
  END IF;

  -- Lo que s7_81 nunca toco debe seguir intacto.
  IF position('FOR UPDATE SKIP LOCKED' in v_src) = 0
     OR position('interval ''23 hours''' in v_src) = 0
     OR position('idem_window_expired' in v_src) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: se perdio la ventana de idempotencia';
  END IF;

  IF to_regclass('public.doctor_owner_notifications') IS NULL
     OR to_regprocedure('public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.notify_owner_mark_result(uuid, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK fallo: se perdio algo de s7_80';
  END IF;

  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.claim_doctor_profile(uuid, text, text)'::regprocedure;
  IF position('_enqueue_doctor_owner_notification' in v_src) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: claim_doctor_profile perdio el enqueue';
  END IF;

  RAISE NOTICE 's7_81 ROLLBACK: OK';
END $rbpost$;
