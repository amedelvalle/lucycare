-- ============================================================
-- ROLLBACK de s7_82 · DOCTOR-OWNER-NOTIFICATIONS-P0
-- ============================================================
--
-- Retira el despertador de la outbox. Deja la base como estaba tras s7_81.
--
-- CONSECUENCIA DE REVERTIR: la cadena se corta en el ultimo tramo.
--
--     evento -> outbox durable  ... y ahi se queda
--
-- Los eventos SIGUEN encolandose sin perdida: el trigger de afiliacion y el
-- enqueue del claim son de s7_80 y este rollback no los toca. Lo que deja de
-- ocurrir es el despertar automatico, asi que nadie drena la cola.
--
-- Para vaciarla mientras tanto, invocar la Edge Function a mano:
--   POST .../functions/v1/notify-owner-doctor-events
--   con la cabecera X-Lucycare-Notify-Secret
--
-- NO toca: la outbox, _enqueue_doctor_owner_notification,
-- notify_owner_claim_batch, notify_owner_mark_result, claim_doctor_profile,
-- el trigger de afiliacion, pg_net, Vault, Auth, Twilio, SMTP ni Turnstile.
--
-- NO borra el secreto de Vault: no lo creo esta migracion y otras piezas
-- pueden usarlo. Retirarlo es una decision aparte del owner.
--
-- NO se ejecuta salvo FAIL explicito.
-- ============================================================

-- ─── 1. Retirar el trigger y su funcion ───
DROP TRIGGER IF EXISTS trg_notify_owner_wakeup ON public.doctor_owner_notifications;
DROP FUNCTION IF EXISTS public._notify_owner_wakeup_fn();

-- ─── 2. POST del rollback ───
DO $rbpost$
DECLARE
  v_src text;
  v_n   int;
BEGIN
  -- 2.1 El despertador ya no existe
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.doctor_owner_notifications'::regclass
      AND tgname = 'trg_notify_owner_wakeup'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK fallo: el trigger de wakeup sigue existiendo';
  END IF;
  IF to_regprocedure('public._notify_owner_wakeup_fn()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK fallo: la funcion de wakeup sigue existiendo';
  END IF;

  -- 2.2 La outbox vuelve a quedar sin triggers propios
  SELECT count(*) INTO v_n
  FROM pg_trigger
  WHERE tgrelid = 'public.doctor_owner_notifications'::regclass AND NOT tgisinternal;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: la outbox conserva % trigger(s)', v_n;
  END IF;

  -- 2.3 Todo lo de s7_80 y s7_81 sigue en pie
  IF to_regclass('public.doctor_owner_notifications') IS NULL
     OR to_regprocedure('public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.notify_owner_mark_result(uuid, text, text, text)') IS NULL
     OR to_regprocedure('public.notify_owner_claim_batch(int, interval, interval)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK fallo: desaparecio algo de s7_80/s7_81';
  END IF;

  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.notify_owner_claim_batch(int, interval, interval)'::regprocedure;
  IF position('p.id  = c.subject_profile_id' in v_src) = 0
     OR position('FOR UPDATE SKIP LOCKED' in v_src) = 0
     OR position('interval ''23 hours''' in v_src) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: notify_owner_claim_batch quedo alterada';
  END IF;

  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.claim_doctor_profile(uuid, text, text)'::regprocedure;
  IF position('_enqueue_doctor_owner_notification' in v_src) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: claim_doctor_profile perdio el enqueue';
  END IF;

  -- El encolado de afiliacion NO es de s7_82 y debe sobrevivir.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.doctor_affiliation_requests'::regclass
      AND tgname = 'trg_notify_owner_affiliation'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK fallo: se perdio el trigger de afiliacion de s7_80';
  END IF;

  -- Tampoco el de auditoria de s7_21.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.doctor_affiliation_requests'::regclass
      AND tgname = 'trg_audit_doctor_affiliation_requests'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK fallo: se perdio el trigger de auditoria de s7_21';
  END IF;

  RAISE NOTICE 's7_82 ROLLBACK: OK — los eventos siguen encolandose, pero nadie los drena';
END $rbpost$;
