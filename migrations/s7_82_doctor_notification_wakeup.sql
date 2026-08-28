-- ============================================================
-- s7_82_doctor_notification_wakeup.sql
-- DOCTOR-OWNER-NOTIFICATIONS-P0 · despertador de la outbox
--
-- Cierra la única pieza que faltaba de la cadena:
--
--   evento → outbox (s7_80) → [ESTO] → Edge Function → Resend
--
-- ── POR QUÉ NO SE USA LA DATABASE WEBHOOK DE SUPABASE ──
-- El proyecto tiene `pg_net 0.20.0` instalado y `net.http_post` ejecutable,
-- pero NO tiene el esqueleto de Database Webhooks: no existen el schema
-- `supabase_functions`, ni `http_request()`, ni `hooks`, ni `migrations`, y la
-- UI ya no ofrece el botón que los aprovisiona (error 3F000 al crear la hook).
--
-- Reconstruir ese esqueleto a mano exigiría crear un rol con CREATEROLE,
-- reasignar ownership y alterar funciones propiedad de `supabase_admin` — cosas
-- que el `postgres` de un proyecto alojado probablemente no puede hacer, y que
-- dejarían objetos de plataforma creados a mano en un namespace que una
-- migración futura de Supabase puede pisar.
--
-- Y no hace falta: TODO lo que `supabase_functions.http_request()` aporta es
-- construir un payload con `old_record`/`record`/`type`/`table`/`schema`… que
-- nuestra Edge Function DESCARTA. Ella ignora el cuerpo y drena la outbox
-- autoritativa por RPC. Lo único que necesitamos es una llamada a
-- `net.http_post`.
--
-- Consecuencia buena: la configuración del despertador queda en el repositorio,
-- versionada y revisable, en vez de vivir solo en el Dashboard.
--
-- ── EL SECRETO NO ESTÁ AQUÍ ──
-- Ni en esta migración, ni en los argumentos del trigger, ni en el repositorio,
-- ni en los logs. Se lee en RUNTIME desde Supabase Vault por su nombre
-- (`DOCTOR_NOTIFICATION_WEBHOOK_SECRET`). Rotarlo no toca este archivo.
--
-- ── INVARIANTE QUE MANDA SOBRE TODO ──
-- El despertador es BEST-EFFORT. Si falta el secreto en Vault, si Vault no se
-- puede leer, si `net.http_post` falla o si cualquier otra cosa se rompe: se
-- emite un WARNING no sensible y se devuelve NEW. **Jamás se revierte el INSERT
-- de la outbox.**
--
-- La prioridad es `evento → outbox durable`. Un wakeup perdido lo recupera el
-- siguiente evento —la Edge Function drena la cola ENTERA, no una fila— o una
-- invocación manual. Un evento perdido no lo recupera nadie.
--
-- ⚠️ EL BLOQUE EXCEPTION DE ESTA FUNCIÓN NO ES REDUNDANTE. Es EL que sostiene
-- la garantía, y conviene no confundirlo con el de s7_80:
--
--   · Este trigger es AFTER INSERT sobre la outbox, así que se encadena al
--     INSERT que hace `_enqueue_doctor_owner_notification`.
--   · Si propagara una excepción, la capturaría el EXCEPTION de aquella
--     función — pero capturarla REVIERTE SU SUBTRANSACCIÓN, y con ella **el
--     propio INSERT de la outbox**.
--   · Resultado sin este bloque: la afiliación o el claim sobreviven (eso lo
--     salva el de s7_80), pero **el aviso se pierde PARA SIEMPRE**, no se
--     retrasa. No habría fila que drenar después.
--
-- Es decir: el de s7_80 protege el EVENTO DE NEGOCIO; este protege la
-- DURABILIDAD DEL AVISO. Son garantías distintas y ninguna sustituye a la
-- otra. Quitar este bloque degrada "aviso retrasado" a "aviso perdido".
--
-- `scripts/check-s7_82.mjs` verifica que el bloque existe Y que envuelve
-- tanto la lectura de Vault como la llamada a `net.http_post`, y el mutation
-- test demuestra que retirarlo hace fallar el check.
--
-- ── NO TOCA ──
-- s7_80, s7_81, la outbox, `_enqueue_doctor_owner_notification`,
-- `notify_owner_claim_batch`, `notify_owner_mark_result`,
-- `claim_doctor_profile`, el trigger de afiliación, `admin_list_doctors`,
-- Auth, Twilio, SMTP, Turnstile, la RLS del producto, otras Edge Functions,
-- ni una sola línea de `src/`. No crea schemas ni roles.
--
-- Aplicar en el SQL Editor de Supabase. Verificar con:
--   node scripts/check-s7_82.mjs
-- ============================================================

-- ─── 0. PRE — bloqueantes ───────────────────────────────────
DO $pre$
DECLARE
  v_src text;
  v_n   int;
  v_txt text;
BEGIN
  -- 0.1 La outbox de s7_80 tiene que estar
  IF to_regclass('public.doctor_owner_notifications') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: no existe la outbox — s7_80 no está aplicada';
  END IF;

  -- 0.2 pg_net, con la firma EXACTA que se va a invocar
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'PRE falló: pg_net no está instalada';
  END IF;
  IF to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: net.http_post(text,jsonb,jsonb,jsonb,integer) no existe';
  END IF;

  -- 0.3 Vault, que es de donde saldrá el secreto en runtime
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: no existe Vault (vault.secrets / vault.decrypted_secrets)';
  END IF;

  -- 0.3b El secreto DEBE estar cargado, y exactamente UNA vez.
  --
  -- Se consulta `vault.secrets`, NO `vault.decrypted_secrets`: comprobar
  -- existencia no requiere descifrar, y este PRE no descifra nada.
  --
  -- Por qué EXACTAMENTE una:
  --   · 0 secretos → el trigger quedaría activo pero mudo. Cada evento
  --     encolaría, emitiría un WARNING y nadie despertaría. Degradación
  --     silenciosa: el sistema parecería instalado y no lo estaría.
  --   · 2 o más   → el trigger hace `LIMIT 1` sin ORDER BY, así que tomaría
  --     uno ARBITRARIO. Si es el que no coincide con el Edge Function secret,
  --     cada wakeup recibe 401 y ningún correo sale — y el síntoma sería
  --     intermitente entre reinicios.
  SELECT count(*) INTO v_n
  FROM vault.secrets WHERE name = 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET';
  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'PRE falló: se esperaba EXACTAMENTE 1 secreto en Vault llamado '
      'DOCTOR_NOTIFICATION_WEBHOOK_SECRET, hay %. Cargalo antes de aplicar s7_82.', v_n;
  END IF;

  -- 0.3c s7_82 no debe estar ya aplicada
  IF to_regprocedure('public._notify_owner_wakeup_fn()') IS NOT NULL THEN
    RAISE EXCEPTION 'PRE falló: _notify_owner_wakeup_fn ya existe — s7_82 parece aplicada';
  END IF;

  -- 0.4 s7_81 sigue en pie (el aviso de claim representa el evento)
  SELECT prosrc INTO v_src
  FROM pg_proc
  WHERE oid = 'public.notify_owner_claim_batch(int, interval, interval)'::regprocedure;
  IF v_src IS NULL OR position('p.id  = c.subject_profile_id' in v_src) = 0 THEN
    RAISE EXCEPTION 'PRE falló: notify_owner_claim_batch no es la versión de s7_81';
  END IF;

  -- 0.5 CERO triggers previos en la outbox — la guarda contra DOBLE WAKEUP.
  --
  -- Es la comprobación autoritativa, y funciona porque TODA webhook es un
  -- trigger: las de Supabase (`supabase_functions.http_request()`), las
  -- nuestras, y cualquier otra. Si hay uno, añadir el nuestro produciría dos
  -- despertares por evento — dos invocaciones concurrentes de la Edge
  -- Function. El `SKIP LOCKED` de s7_80 evitaría el correo duplicado, pero
  -- gastaría una invocación y ensuciaría el diagnóstico.
  --
  -- El mensaje NOMBRA los triggers encontrados: si esto salta, hay que saber
  -- cuál es sin tener que ir a buscarlo.
  SELECT count(*), coalesce(string_agg(tgname, ', '), '')
    INTO v_n, v_txt
  FROM pg_trigger
  WHERE tgrelid = 'public.doctor_owner_notifications'::regclass AND NOT tgisinternal;
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'PRE falló: la outbox ya tiene % trigger(s) [%]. Toda webhook es un '
      'trigger: añadir otro produciría DOBLE wakeup. Revisar antes de aplicar.',
      v_n, v_txt;
  END IF;

  RAISE NOTICE 's7_82 PRE: OK';
END $pre$;

-- ─── 1. El despertador ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._notify_owner_wakeup_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $wake$
DECLARE
  -- Dominio y ruta como CONSTANTE LITERAL, no derivados del entorno: misma
  -- regla que fijó #352. Un origen tomado del runtime daría una URL que falla
  -- fuera de donde se generó, y el fallo sería invisible.
  v_url    constant text := 'https://kvrsfmzlrmmmavillpuj.supabase.co/functions/v1/notify-owner-doctor-events';
  -- SOLO el NOMBRE del secreto. El valor vive en Vault y nunca aquí.
  v_secret_name constant text := 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET';
  v_secret text;
BEGIN
  BEGIN
    -- Lectura del secreto en runtime. Schema-qualified.
    SELECT vs.decrypted_secret
      INTO v_secret
    FROM vault.decrypted_secrets vs
    WHERE vs.name = v_secret_name
    LIMIT 1;

    IF v_secret IS NULL OR btrim(v_secret) = '' THEN
      -- Sin secreto no se llama: mandar la petición sin cabecera solo
      -- produciría un 401 y ruido. La fila queda en `pending` y la recoge el
      -- próximo drenado. El WARNING nombra el SECRETO, jamás su valor.
      RAISE WARNING 's7_82 wakeup omitido: falta % en Vault (fila %)', v_secret_name, NEW.id;
      RETURN NEW;
    END IF;

    -- `net.http_post` ENCOLA: no abre socket ni espera red aquí. El worker de
    -- pg_net solo ve filas COMMITEADAS, así que ninguna petición puede
    -- adelantarse al commit — y si la transacción hace ROLLBACK, el wakeup
    -- desaparece con ella. Esa propiedad es la que hace que el smoke
    -- transaccional no produzca HTTP real.
    PERFORM net.http_post(
      url                  := v_url,
      body                 := '{}'::jsonb,
      params               := '{}'::jsonb,
      headers              := jsonb_build_object(
                                'Content-Type', 'application/json',
                                'X-Lucycare-Notify-Secret', v_secret
                              ),
      timeout_milliseconds := 5000
    );

  EXCEPTION WHEN OTHERS THEN
    -- ESTE BLOQUE ES LA GARANTÍA, no una red de seguridad decorativa.
    --
    -- Sin él, la excepción subiría hasta el EXCEPTION de
    -- `_enqueue_doctor_owner_notification`, cuya captura revierte la
    -- subtransacción — y con ella el INSERT de la outbox. El aviso pasaría de
    -- "retrasado" a "perdido". Ver la cabecera del archivo.
    --
    -- Se emite SQLSTATE y el id de la fila, nunca SQLERRM: el mensaje del
    -- error podría arrastrar fragmentos de los argumentos, y entre esos
    -- argumentos viaja el secreto. Cinco caracteres de SQLSTATE no pueden
    -- filtrar nada y bastan para diagnosticar.
    RAISE WARNING 's7_82 wakeup falló (SQLSTATE %, fila %) — la outbox quedó intacta',
                  SQLSTATE, NEW.id;
  END;

  RETURN NEW;
END;
$wake$;

COMMENT ON FUNCTION public._notify_owner_wakeup_fn() IS
  'Despierta a la Edge Function tras encolar un aviso. BEST-EFFORT: cualquier '
  'fallo se traga con WARNING y devuelve NEW; jamás revierte el INSERT de la '
  'outbox. El secreto se lee de Vault en runtime y no aparece en esta '
  'definición.';

-- Solo el trigger la invoca. Nadie más necesita ejecutarla.
REVOKE ALL ON FUNCTION public._notify_owner_wakeup_fn() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._notify_owner_wakeup_fn() FROM anon;
REVOKE ALL ON FUNCTION public._notify_owner_wakeup_fn() FROM authenticated;
REVOKE ALL ON FUNCTION public._notify_owner_wakeup_fn() FROM service_role;

-- ─── 2. El trigger ──────────────────────────────────────────
-- AFTER INSERT y FOR EACH ROW. Nada de UPDATE: marcar una fila como `sending`
-- o `sent` NO es un evento nuevo, y dispararía un bucle de despertares.
DROP TRIGGER IF EXISTS trg_notify_owner_wakeup ON public.doctor_owner_notifications;
CREATE TRIGGER trg_notify_owner_wakeup
  AFTER INSERT ON public.doctor_owner_notifications
  FOR EACH ROW EXECUTE FUNCTION public._notify_owner_wakeup_fn();

-- ─── 3. POST — verificación ─────────────────────────────────
DO $post$
DECLARE
  v_src  text;
  v_exec text;
  v_n    int;
BEGIN
  -- 3.1 Exactamente UN trigger propio en la outbox, y con la forma correcta
  SELECT count(*) INTO v_n
  FROM pg_trigger
  WHERE tgrelid = 'public.doctor_owner_notifications'::regclass AND NOT tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'POST falló: la outbox tiene % triggers, esperaba 1', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_trigger
  WHERE tgrelid = 'public.doctor_owner_notifications'::regclass
    AND tgname = 'trg_notify_owner_wakeup'
    AND (tgtype &  1) =  1   -- FOR EACH ROW
    AND (tgtype &  2) =  0   -- NO es BEFORE
    AND (tgtype &  4) =  4   -- INSERT
    AND (tgtype &  8) =  0   -- sin DELETE
    AND (tgtype & 16) =  0;  -- sin UPDATE
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'POST falló: el trigger no es AFTER INSERT FOR EACH ROW exclusivamente';
  END IF;

  -- 3.2 El cuerpo lee de Vault y NO lleva ningún secreto embebido
  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public._notify_owner_wakeup_fn()'::regprocedure;

  -- ⚠️ `prosrc` INCLUYE LOS COMENTARIOS. Todas las comprobaciones de este POST
  -- se hacen sobre `v_exec`, el cuerpo SIN comentarios.
  --
  -- No es cosmético: la primera versión medía sobre `v_src` crudo y abortaba
  -- con «el WARNING usa SQLERRM» por culpa de su PROPIO comentario
  -- («…nunca SQLERRM: el mensaje del error podría arrastrar…»). La guarda se
  -- disparaba con su propia advertencia y la migración no podía aplicarse.
  --
  -- El fallo simétrico también existe: una comprobación de PRESENCIA sobre el
  -- texto crudo pasaría si el código perdiera la llamada pero un comentario la
  -- nombrara. Por eso se normaliza una vez y se usa para todo.
  --
  -- Es exactamente la misma normalización que aplica `check-s7_82.mjs`. Que
  -- los dos instrumentos midan el MISMO texto es el punto: cuando divergieron,
  -- el check daba PASS y el POST abortaba en producción.
  v_exec := regexp_replace(v_src, '--[^\n]*', '', 'g');

  IF position('vault.decrypted_secrets' in v_exec) = 0 THEN
    RAISE EXCEPTION 'POST falló: el wakeup no lee el secreto desde Vault';
  END IF;
  IF position('DOCTOR_NOTIFICATION_WEBHOOK_SECRET' in v_exec) = 0 THEN
    RAISE EXCEPTION 'POST falló: no referencia el nombre del secreto';
  END IF;
  -- Un literal entrecomillado de 40+ caracteres base64url tendría la forma de
  -- nuestro secreto (43). El NOMBRE del secreto son 34, así que no dispara.
  IF v_exec ~ '''[A-Za-z0-9_-]{40,}''' THEN
    RAISE EXCEPTION 'POST falló: hay un literal con forma de secreto en el cuerpo';
  END IF;
  -- SQLERRM podría arrastrar argumentos, y entre ellos viaja el secreto.
  -- Se mide sobre `v_exec`: mencionarlo en un comentario es legítimo y no
  -- debe abortar nada. Usarlo en código, no.
  IF position('SQLERRM' in v_exec) > 0 THEN
    RAISE EXCEPTION 'POST falló: el WARNING usa SQLERRM';
  END IF;

  -- 3.3 Forma de la llamada
  IF position('net.http_post' in v_exec) = 0 THEN
    RAISE EXCEPTION 'POST falló: no invoca net.http_post';
  END IF;
  IF position('timeout_milliseconds := 5000' in v_exec) = 0 THEN
    RAISE EXCEPTION 'POST falló: el timeout no es 5000 ms';
  END IF;
  IF position('X-Lucycare-Notify-Secret' in v_exec) = 0
     OR position('Content-Type' in v_exec) = 0 THEN
    RAISE EXCEPTION 'POST falló: faltan las cabeceras esperadas';
  END IF;
  IF position('net.http_get' in v_exec) > 0 THEN
    RAISE EXCEPTION 'POST falló: hay una llamada GET';
  END IF;

  -- 3.4 No bloqueante
  IF position('EXCEPTION WHEN OTHERS THEN' in v_exec) = 0
     OR position('RAISE WARNING' in v_exec) = 0
     OR position('RETURN NEW' in v_exec) = 0 THEN
    RAISE EXCEPTION 'POST falló: el wakeup no es best-effort';
  END IF;

  -- 3.5 Privilegios: nadie puede ejecutarla salvo el trigger
  SELECT count(*) INTO v_n
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public' AND routine_name = '_notify_owner_wakeup_fn'
    AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'POST falló: el wakeup quedó otorgado a algún rol';
  END IF;

  -- 3.6 Guarda: s7_80 y s7_81 intactas
  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.notify_owner_claim_batch(int, interval, interval)'::regprocedure;
  IF position('p.id  = c.subject_profile_id' in v_src) = 0
     OR position('FOR UPDATE SKIP LOCKED' in v_src) = 0
     OR position('interval ''23 hours''' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: notify_owner_claim_batch se alteró';
  END IF;

  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.claim_doctor_profile(uuid, text, text)'::regprocedure;
  IF position('_enqueue_doctor_owner_notification' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: claim_doctor_profile perdió el enqueue';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.doctor_affiliation_requests'::regclass
      AND tgname = 'trg_notify_owner_affiliation'
  ) THEN
    RAISE EXCEPTION 'POST falló: se perdió el trigger de afiliación de s7_80';
  END IF;

  -- 3.7 NO se crearon objetos de plataforma
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'supabase_functions') THEN
    RAISE WARNING 's7_82: existe el schema supabase_functions y esta migración NO lo creó — revisar';
  END IF;

  RAISE NOTICE 's7_82 POST: OK';
END $post$;
