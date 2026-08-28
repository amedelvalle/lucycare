-- ============================================================
-- s7_81_notification_event_semantics.sql
-- DOCTOR-OWNER-NOTIFICATIONS-P0 · corrección semántica
--
-- Un aviso de `doctor_profile_claimed` describe un HECHO PASADO. Debe
-- representar el claim que ocurrió, no el estado del médico en el momento en
-- que el correo sale. s7_80 leía dos datos "del presente" y eso podía producir
-- un correo que contradice al evento que anuncia.
--
-- ── EL DEFECTO, EN CONCRETO ──
--
--   1. NOMBRE. El CTE `claimed` no devolvía `subject_profile_id`, así que el
--      nombre se resolvía por `profiles p ON p.id = d.profile_id`: el perfil
--      ACTUAL del médico. La outbox guarda a propósito el perfil que produjo
--      el evento y ese dato se estaba ignorando.
--
--      `claim_doctor_profile` re-apunta `doctors.profile_id` al reclamante
--      (rama seed/legacy), y un admin puede volver a moverlo. Si el perfil
--      cambia entre el encolado y el envío, el correo anunciaría el claim con
--      el nombre de OTRA persona.
--
--   2. ESTADO. Devolvía `d.lucy_status` leído en el momento del envío. Un
--      admin puede cambiarlo con `admin_set_lucy_status` justo después del
--      claim. El caso feo es real: si lo revierte a `listed_only`, el correo
--      diría «Estado LucyCare: listed_only» en un aviso cuyo asunto es
--      «Perfil médico reclamado». El aviso se contradiría a sí mismo.
--
-- La ventana no es teórica: la entrega puede demorarse (un despertar perdido
-- se recupera con el evento siguiente) y un reintento vive hasta 23 h.
--
-- ── LA CORRECCIÓN: TRES CAMBIOS, NI UNO MÁS ──
--   1. `claimed` devuelve `n.subject_profile_id`.
--   2. el nombre sale de `profiles p ON p.id = c.subject_profile_id`.
--   3. `lucy_status` del claim es el literal `'claimed'`, el valor semántico
--      del evento.
--
-- Verificado por A/B en `scripts/check-s7_81.mjs`: aplicando esas tres
-- ediciones al cuerpo de s7_80 se obtiene ESTE cuerpo, byte a byte.
--
-- ── LO QUE NO CAMBIA ──
-- Firma, `SECURITY DEFINER`, `search_path`, grants, `FOR UPDATE SKIP LOCKED`,
-- la ventana de idempotencia de 23 h, `first_attempt_at`, el orden, los topes,
-- la allowlist de campos, el evento de afiliación, la outbox, los triggers,
-- `_enqueue_doctor_owner_notification`, `notify_owner_mark_result` y
-- `claim_doctor_profile`. Ninguna tabla se altera.
--
-- La ESPECIALIDAD se sigue leyendo del médico actual, y es deliberado: es un
-- atributo del profesional, no del claim, y no existe registro histórico suyo.
--
-- ⚠️ s7_80 NO se edita ni se reaplica. Es el registro de lo que se ejecutó.
--
-- Aplicar en el SQL Editor de Supabase. Verificar con:
--   node scripts/check-s7_81.mjs
-- ============================================================

-- ─── 0. PRE — bloqueantes ───────────────────────────────────
DO $pre$
DECLARE
  v_src text;
BEGIN
  IF to_regclass('public.doctor_owner_notifications') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: no existe la outbox — s7_80 no está aplicada';
  END IF;

  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE oid = 'public.notify_owner_claim_batch(int, interval, interval)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'PRE falló: notify_owner_claim_batch(int,interval,interval) no existe';
  END IF;

  -- Debe ser la versión de s7_80, con el defecto presente. Si no lo tiene,
  -- alguien ya la cambió y no es esto lo que creemos estar corrigiendo.
  IF position('p.id  = d.profile_id' in v_src) = 0 THEN
    RAISE EXCEPTION 'PRE falló: la función no trae el join defectuoso de s7_80';
  END IF;
  IF position('p.id  = c.subject_profile_id' in v_src) > 0 THEN
    RAISE EXCEPTION 'PRE falló: la corrección ya está aplicada — s7_81 parece aplicada';
  END IF;

  -- La ventana de idempotencia tiene que seguir ahí: s7_81 no la toca, pero
  -- si no estuviera, estaríamos partiendo de una base distinta a la esperada.
  IF position('interval ''23 hours''' in v_src) = 0 THEN
    RAISE EXCEPTION 'PRE falló: falta la ventana de 23 h — la base no es la de s7_80';
  END IF;

  RAISE NOTICE 's7_81 PRE: OK';
END $pre$;

-- ─── 1. La función, con las tres correcciones ───────────────
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
              n.subject_request_id, n.subject_doctor_id, n.subject_profile_id
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
                    THEN 'claimed' END
           ) ORDER BY c.occurred_at, c.id), '[]'::jsonb)
    INTO v_rows
    FROM claimed c
    LEFT JOIN public.doctor_affiliation_requests r ON r.id = c.subject_request_id
    LEFT JOIN public.specialties rs ON rs.id = r.specialty_id
    LEFT JOIN public.doctors     d  ON d.id  = c.subject_doctor_id
    LEFT JOIN public.specialties ds ON ds.id = d.specialty_id
    LEFT JOIN public.profiles    p  ON p.id  = c.subject_profile_id;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$batch$;

-- ─── 2. Privilegios — se reafirman explícitamente ───────────
-- `CREATE OR REPLACE FUNCTION` conserva los privilegios existentes, pero se
-- reafirman igual: así el estado final de esta migración es legible sin tener
-- que ir a leer s7_80.
REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM anon;
REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) TO service_role;

-- ─── 3. POST — verificación ─────────────────────────────────
DO $post$
DECLARE
  v_src text;
  v_n   int;
BEGIN
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE oid = 'public.notify_owner_claim_batch(int, interval, interval)'::regprocedure;

  -- 3.1 Las tres correcciones están
  IF position('n.subject_profile_id' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: el CTE no devuelve subject_profile_id';
  END IF;
  IF position('p.id  = c.subject_profile_id' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: el nombre no sale del profile del evento';
  END IF;
  IF position('p.id  = d.profile_id' in v_src) > 0 THEN
    RAISE EXCEPTION 'POST falló: sobrevive el join al profile actual';
  END IF;
  IF position('THEN d.lucy_status::text END' in v_src) > 0 THEN
    RAISE EXCEPTION 'POST falló: sigue devolviendo el lucy_status actual';
  END IF;
  IF position('THEN ''claimed'' END' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: lucy_status del claim no es el literal del evento';
  END IF;

  -- 3.2 Nada más se movió
  IF position('FOR UPDATE SKIP LOCKED' in v_src) = 0
     OR position('interval ''23 hours''' in v_src) = 0
     OR position('idem_window_expired' in v_src) = 0
     OR position('first_attempt_at = COALESCE(n.first_attempt_at, now())' in v_src) = 0
     OR position('ORDER BY n.occurred_at, n.id' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: s7_81 alteró algo que debía quedar intacto';
  END IF;

  -- La allowlist no ganó campos: nada de licencia, documento ni forense.
  IF position('license' in v_src) > 0
     OR position('document' in v_src) > 0
     OR position('ip_address' in v_src) > 0
     OR position('user_agent' in v_src) > 0 THEN
    RAISE EXCEPTION 'POST falló: la allowlist ganó un campo no aprobado';
  END IF;

  -- 3.3 Privilegios
  SELECT count(*) INTO v_n
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public' AND routine_name = 'notify_owner_claim_batch'
    AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_n <> 0 THEN RAISE EXCEPTION 'POST falló: la RPC quedó otorgada de más'; END IF;

  -- 3.4 Lo que s7_81 NO debía tocar sigue en pie
  IF to_regprocedure('public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.notify_owner_mark_result(uuid, text, text, text)') IS NULL
     OR to_regclass('public.doctor_owner_notifications') IS NULL THEN
    RAISE EXCEPTION 'POST falló: desapareció algo de s7_80';
  END IF;

  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.claim_doctor_profile(uuid, text, text)'::regprocedure;
  IF position('_enqueue_doctor_owner_notification' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: claim_doctor_profile perdió el enqueue';
  END IF;

  RAISE NOTICE 's7_81 POST: OK';
END $post$;
