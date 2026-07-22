-- ═══════════════════════════════════════════════════════════
-- Migración S7-65: AUTH-P1B1A — elegibilidad de creación de cuentas
--                  + Before User Created Hook (TODO INERTE)
-- ═══════════════════════════════════════════════════════════
-- Frente AUTH-P1B (protección server-side previa a las pantallas de P1C).
-- Entrega A de B1: normalizador multipaís SQL + tablas de evidencia +
-- hook de elegibilidad + permisos mínimos + índices. NADA se configura en
-- el Dashboard: el hook queda creado pero NO habilitado (cero impacto
-- hasta la activación explícita del owner, posterior a B1B).
--
-- ── POLÍTICA APROBADA ──
-- Una cuenta nueva SOLO puede crearse cuando existe evidencia server-side:
--   phone → grant vigente · paciente registrado · médico (profiles.phone) ·
--           invitación de asistente vigente · invitación de admin pending;
--   email → grant de correo vigente (jamás cruza con teléfono).
-- Provider ausente/desconocido/inconsistente → rechazo. user_metadata y
-- OtpContext JAMÁS son evidencia (los controla el navegador).
--
-- ── MODELO DE SEGURIDAD ──
-- El hook es SECURITY INVOKER: corre como `supabase_auth_admin`, cuyo
-- alcance se limita acá a USAGE del schema + SELECT de columnas mínimas +
-- policies FOR SELECT específicas. Cero INSERT/UPDATE/DELETE: aunque el
-- hook tuviera un bug, su rol no puede escribir nada. Todas las funciones
-- nuevas: SET search_path = '' + referencias calificadas + sin SQL dinámico.
--
-- ── FUERA DE ESTA MIGRACIÓN (B1B/B1C/B3) ──
-- validate_booking_slot · register_booking_intent · create_booking_with_intent
-- · plumbing frontend · otp_send_log/config/exemptions · gate OTP · Edge
-- Function · Twilio · configuración del hook en Dashboard.
--
-- ── REVERSIBLE ──
-- DROP de las funciones/tablas/policies/índices nuevos + REVOKE de los
-- grants de supabase_auth_admin. No toca datos existentes.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Normalizador multipaís: public.auth_phone_e164 ────────────────
-- PARIDAD EXACTA con src/lib/authPhone.ts (la tabla de equivalencia y el
-- check de 40 casos ×2 viven en scripts/check-s7_65.mjs):
--   · limpia espacios/guiones/paréntesis/puntos, detecta '+', exige dígitos;
--   · países habilitados (código+longitud+patrón nacional básico):
--       503 SV  8  ^[267]\d{7}$     502 GT 8  ^[2-7]\d{7}$
--       504 HN  8  ^[2-9]\d{7}$      52 MX 10 ^[2-9]\d{9}$
--         1 US 10  ^[2-9]\d{9}$
--   · local SIN código: solo un SV plausible (8 díg. [267]…) → +503;
--   · TODO lo demás (ambiguo/inválido/'+' no habilitado/longitud errada) → NULL.
-- Los patrones son disjuntos por (primeros dígitos + longitud total): la
-- selección "prefijo más largo" del frontend es equivalente a este CASE.
-- LÍMITE TEMPRANO DE LONGITUD: una entrada absurdamente larga devuelve NULL
-- ANTES de tocar btrim/regexp (evita trabajo de regex sobre payloads
-- grandes). 32 caracteres cubren con holgura el peor formato admitido
-- ('+503 7862-7694' = 15, '(503) 7862 7694' = 15).
CREATE OR REPLACE FUNCTION public.auth_phone_e164(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH guarded AS (
    SELECT CASE
      WHEN p_input IS NULL THEN NULL
      WHEN length(p_input) > 32 THEN NULL   -- corte ANTES de cualquier regexp
      ELSE p_input
    END AS raw
  ), cleaned AS (
    SELECT regexp_replace(btrim(coalesce(raw, '')), '[\s\-().]', '', 'g') AS c
    FROM guarded
  ), parts AS (
    SELECT c,
           (c LIKE '+%')                                   AS has_plus,
           CASE WHEN c LIKE '+%' THEN substr(c, 2) ELSE c END AS d
    FROM cleaned
  )
  SELECT CASE
    WHEN d = '' OR d !~ '^[0-9]+$'                THEN NULL
    WHEN d ~ '^503[267][0-9]{7}$'                 THEN '+' || d  -- SV 3+8
    WHEN d ~ '^502[2-7][0-9]{7}$'                 THEN '+' || d  -- GT 3+8
    WHEN d ~ '^504[2-9][0-9]{7}$'                 THEN '+' || d  -- HN 3+8
    WHEN d ~ '^52[2-9][0-9]{9}$'                  THEN '+' || d  -- MX 2+10
    WHEN d ~ '^1[2-9][0-9]{9}$'                   THEN '+' || d  -- US 1+10
    WHEN NOT has_plus AND d ~ '^[267][0-9]{7}$'   THEN '+503' || d
    ELSE NULL
  END
  FROM parts
$$;

-- EXECUTE para anon/authenticated es NECESARIO, no cosmético: la función
-- participa en índices funcionales de tablas OPERATIVAS (patients,
-- profiles, clinic_invitations) y en CHECKs de las tablas nuevas — un rol
-- sin EXECUTE podría fallar al insertar/actualizar esas filas. Es una
-- función PURA (sin acceso a tablas, sin SQL dinámico, IMMUTABLE), así que
-- exponerla no revela ni modifica nada.
-- El HOOK, en cambio, sigue siendo EXECUTE exclusivo de supabase_auth_admin.
REVOKE ALL ON FUNCTION public.auth_phone_e164(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_phone_e164(text) TO anon;
GRANT EXECUTE ON FUNCTION public.auth_phone_e164(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_phone_e164(text) TO supabase_auth_admin;
-- service_role EXPLÍCITO (no depender de defaults/herencia): el backend y el
-- smoke la invocan y la usan en los CHECK de las tablas nuevas.
GRANT EXECUTE ON FUNCTION public.auth_phone_e164(text) TO service_role;

-- ─── 2. Tabla booking_intents (INERTE en B1A) ─────────────────────────
-- Se crea SOLO para sostener la FK tipada de los grants. Las RPCs que la
-- pueblan/validan/consumen son de B1B. Sin escritores, sin lectores.
CREATE TABLE IF NOT EXISTS public.booking_intents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id               uuid NOT NULL REFERENCES public.doctors(id),
  clinic_id               uuid NOT NULL REFERENCES public.clinics(id),
  service_id              uuid NOT NULL REFERENCES public.services(id),
  start_at                timestamptz NOT NULL,
  end_at                  timestamptz NOT NULL,
  phone_e164              text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  consumed_at             timestamptz,
  consumed_appointment_id uuid REFERENCES public.appointments(id),

  CONSTRAINT booking_intents_window_valid   CHECK (end_at > start_at),
  CONSTRAINT booking_intents_expiry_valid   CHECK (expires_at > created_at),
  -- TTL máximo validado SOLO con columnas de la fila.
  CONSTRAINT booking_intents_ttl_max
    CHECK (expires_at <= created_at + interval '15 minutes'),
  -- El teléfono se almacena SIEMPRE canónico (E.164): la DB no acepta un
  -- formato que el hook no reconocería después.
  -- ⚠️ NULL-SAFE: Postgres considera SATISFECHO un CHECK que evalúa a NULL.
  -- `auth_phone_e164(x) = x` devuelve NULL cuando el valor no es
  -- canonicalizable → dejaría pasar basura. Por eso se exige explícitamente
  -- IS NOT NULL antes de la igualdad.
  CONSTRAINT booking_intents_phone_canonical CHECK (
    public.auth_phone_e164(phone_e164) IS NOT NULL
    AND public.auth_phone_e164(phone_e164) = phone_e164
  )
);

CREATE INDEX IF NOT EXISTS idx_booking_intents_phone
  ON public.booking_intents (phone_e164, expires_at DESC);

ALTER TABLE public.booking_intents ENABLE ROW LEVEL SECURITY;
-- Los default privileges de Supabase otorgan a anon/authenticated en tablas
-- nuevas → se revocan expresamente. Nadie más lee ni escribe directo.
REVOKE ALL ON public.booking_intents FROM PUBLIC;
REVOKE ALL ON public.booking_intents FROM anon;
REVOKE ALL ON public.booking_intents FROM authenticated;
-- service_role EXPLÍCITO (backend + smoke); no depender de defaults.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_intents TO service_role;

-- ─── 3. Tabla auth_creation_grants (APPEND-ONLY) ──────────────────────
-- Evidencia TEMPORAL de creación (teléfono O correo, jamás cruzados).
-- Sin unicidad por sujeto: un grant vencido no revocado JAMÁS bloquea
-- emitir uno nuevo (modelo append-only). `context` es solo diagnóstico —
-- las garantías reales son las FK y los CHECK.
CREATE TABLE IF NOT EXISTS public.auth_creation_grants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type       text NOT NULL CHECK (subject_type IN ('phone', 'email')),
  subject_normalized text NOT NULL,   -- phone: E.164 '+503…' · email: lower(btrim(…))
  flow               text NOT NULL CHECK (flow IN ('booking', 'authorized')),
  booking_intent_id  uuid REFERENCES public.booking_intents(id),
  context            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  issued_by          text NOT NULL,   -- técnico: RPC emisora / 'service_role'

  CONSTRAINT grants_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT grants_ttl_max CHECK (
    (flow = 'booking'    AND expires_at <= created_at + interval '15 minutes') OR
    (flow = 'authorized' AND expires_at <= created_at + interval '24 hours')
  ),

  -- ── INTEGRIDAD DEL SUJETO (el hook compara por igualdad exacta: la DB
  --    garantiza que lo almacenado ya está en forma canónica) ──
  -- phone: debe ser E.164 canónico según el MISMO normalizador del hook.
  -- ⚠️ NULL-SAFE (ver nota en booking_intents): un CHECK que evalúa a NULL
  -- se considera SATISFECHO, así que la igualdad sola dejaría pasar valores
  -- no canonicalizables (auth_phone_e164 devuelve NULL para ellos).
  CONSTRAINT grants_phone_canonical CHECK (
    subject_type <> 'phone'
    OR (public.auth_phone_e164(subject_normalized) IS NOT NULL
        AND public.auth_phone_e164(subject_normalized) = subject_normalized)
  ),
  -- email: minúsculas, sin espacios alrededor, no vacío.
  CONSTRAINT grants_email_canonical CHECK (
    subject_type <> 'email'
    OR (subject_normalized = lower(btrim(subject_normalized))
        AND btrim(subject_normalized) <> '')
  ),
  -- Una reserva es SIEMPRE telefónica.
  CONSTRAINT grants_booking_is_phone
    CHECK (flow <> 'booking' OR subject_type = 'phone'),
  -- booking_intent_id NOT NULL si y SOLO SI flow='booking' (bicondicional).
  CONSTRAINT grants_intent_iff_booking CHECK (
    (flow = 'booking' AND booking_intent_id IS NOT NULL)
    OR (flow <> 'booking' AND booking_intent_id IS NULL)
  ),
  -- Trazabilidad real del emisor.
  CONSTRAINT grants_issued_by_not_blank CHECK (btrim(issued_by) <> '')
);

-- Un intent respalda a lo sumo UN grant.
CREATE UNIQUE INDEX IF NOT EXISTS grants_one_per_intent
  ON public.auth_creation_grants (booking_intent_id)
  WHERE booking_intent_id IS NOT NULL;

-- Búsqueda del hook: sujeto + vigencia (los vencidos quedan fuera por el
-- ORDER natural del predicado del hook; el índice cubre las 4 columnas
-- pedidas — subject_type, subject_normalized, expires_at, revoked_at).
CREATE INDEX IF NOT EXISTS idx_grants_subject_lookup
  ON public.auth_creation_grants (subject_type, subject_normalized, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE public.auth_creation_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_creation_grants FROM PUBLIC;
REVOKE ALL ON public.auth_creation_grants FROM anon;
REVOKE ALL ON public.auth_creation_grants FROM authenticated;
-- service_role EXPLÍCITO (backend + smoke); no depender de defaults.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_creation_grants TO service_role;

-- ─── 4. Índices funcionales para las ramas del hook ───────────────────
-- Posibles porque auth_phone_e164 es IMMUTABLE. El hook usa EXACTAMENTE
-- estas expresiones (índice y consulta coherentes por construcción).
CREATE INDEX IF NOT EXISTS idx_patients_auth_phone
  ON public.patients (public.auth_phone_e164(phone));

CREATE INDEX IF NOT EXISTS idx_profiles_auth_phone
  ON public.profiles (public.auth_phone_e164(phone));

-- Parcial: solo invitaciones pendientes (mismo predicado que la rama).
CREATE INDEX IF NOT EXISTS idx_clinic_invitations_auth_phone_pending
  ON public.clinic_invitations (public.auth_phone_e164(phone))
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

-- platform_admin_invitations: ALTERNATIVA B (coherente) — la columna ya
-- guarda el canónico en dígitos ('503…', s7_44 normaliza al invitar), así
-- que el hook compara DIRECTO contra el E.164 sin '+'
-- (`phone_normalized = ltrim(v_phone,'+') AND status = 'pending'`).
-- GUARD: en vez de asumir que el índice de s7_44 sostiene ese predicado,
-- se VERIFICA su definición real y, solo si ninguno la sostiene, se crea
-- el índice parcial acá (no se difiere a B1B). Sin duplicados: si el
-- índice adecuado ya existe, este bloque no crea nada.
DO $$
DECLARE
  v_has_index boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c   ON c.oid = i.indexrelid
    JOIN pg_class t   ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'platform_admin_invitations'
      -- primera columna del índice = phone_normalized
      AND (i.indkey::int2[])[0] = (
        SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = t.oid AND a.attname = 'phone_normalized'
      )
      -- predicado parcial que restringe a status='pending'
      AND i.indpred IS NOT NULL
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%pending%'
  ) INTO v_has_index;

  IF NOT v_has_index THEN
    CREATE INDEX idx_pai_phone_normalized_pending
      ON public.platform_admin_invitations (phone_normalized)
      WHERE status = 'pending';
    RAISE NOTICE 's7_65: creado idx_pai_phone_normalized_pending (no existía índice que sostuviera el predicado del hook)';
  ELSE
    RAISE NOTICE 's7_65: índice existente sostiene phone_normalized = ? AND status = ''pending'' — no se crea uno nuevo';
  END IF;
END $$;

-- ─── 5. Permisos mínimos para supabase_auth_admin ─────────────────────
-- (El bloque del owner incluye la consulta de privilegios EFECTIVOS
--  actuales para confirmar el punto de partida ANTES de aplicar.)
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- ESTRICTAMENTE las columnas que el hook consulta (sin `id` ni `flow`
-- donde no se usan): cualquier columna extra sería privilegio innecesario.
GRANT SELECT (subject_type, subject_normalized, expires_at, revoked_at)
  ON public.auth_creation_grants TO supabase_auth_admin;
GRANT SELECT (phone) ON public.patients TO supabase_auth_admin;
GRANT SELECT (id, phone) ON public.profiles TO supabase_auth_admin;  -- id: JOIN con doctors
GRANT SELECT (profile_id) ON public.doctors TO supabase_auth_admin;
GRANT SELECT (phone, accepted_at, cancelled_at, expires_at)
  ON public.clinic_invitations TO supabase_auth_admin;
GRANT SELECT (phone_normalized, status, expires_at)
  ON public.platform_admin_invitations TO supabase_auth_admin;
-- Cero INSERT/UPDATE/DELETE para supabase_auth_admin. Nada cambia para
-- anon, authenticated, directory_editor ni operations_admin.

-- Policies FOR SELECT específicas (la RLS de estas tablas filtra por otras
-- identidades; sin esto el hook INVOKER vería 0 filas):
DROP POLICY IF EXISTS grants_select_auth_hook ON public.auth_creation_grants;
CREATE POLICY grants_select_auth_hook ON public.auth_creation_grants
  FOR SELECT TO supabase_auth_admin USING (true);

DROP POLICY IF EXISTS patients_select_auth_hook ON public.patients;
CREATE POLICY patients_select_auth_hook ON public.patients
  FOR SELECT TO supabase_auth_admin USING (true);

DROP POLICY IF EXISTS profiles_select_auth_hook ON public.profiles;
CREATE POLICY profiles_select_auth_hook ON public.profiles
  FOR SELECT TO supabase_auth_admin USING (true);

DROP POLICY IF EXISTS doctors_select_auth_hook ON public.doctors;
CREATE POLICY doctors_select_auth_hook ON public.doctors
  FOR SELECT TO supabase_auth_admin USING (true);

DROP POLICY IF EXISTS clinic_invitations_select_auth_hook ON public.clinic_invitations;
CREATE POLICY clinic_invitations_select_auth_hook ON public.clinic_invitations
  FOR SELECT TO supabase_auth_admin USING (true);

DROP POLICY IF EXISTS pai_select_auth_hook ON public.platform_admin_invitations;
CREATE POLICY pai_select_auth_hook ON public.platform_admin_invitations
  FOR SELECT TO supabase_auth_admin USING (true);

-- ─── 6. Diagnóstico de las tablas nuevas ──────────────────────────────
-- NO se otorga acceso a `authenticated` ni se crean policies is_admin()
-- sobre auth_creation_grants / booking_intents: en B1A esas tablas quedan
-- con RLS activo y SIN acceso directo para anon/authenticated. El
-- diagnóstico lo hace el owner desde el SQL Editor. Cualquier acceso
-- futuro para owner_admin se diseñará cuando exista una superficie
-- administrativa concreta (no antes).

-- ─── 7. Before User Created Hook (creado, NO configurado) ─────────────
-- CONTRATO: '{}'::jsonb permite ·
--   {"error":{"http_code":400,"message":"…"}} rechaza (mensaje genérico
--   ÚNICO, en tuteo, sin enumeración).
-- SECURITY INVOKER (corre como supabase_auth_admin con los permisos de §5)
-- · search_path = '' · referencias 100% calificadas · sin SQL dinámico ·
-- READ-ONLY absoluto (cero escrituras, no consume grants) · no consulta
-- auth.users (todo llega en `event`) · user_metadata/OtpContext JAMÁS son
-- evidencia. La decisión se ramifica por el provider server-side del
-- evento; cualquier forma inesperada del payload cae en RECHAZO
-- (fail-closed).
CREATE OR REPLACE FUNCTION public.hook_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_provider text := event #>> '{user,app_metadata,provider}';
  v_phone    text;
  v_email    text;
  v_allowed  boolean := false;
BEGIN
  IF v_provider = 'phone' THEN
    -- Rama TELEFÓNICA: evalúa exclusivamente evidencia de teléfono.
    v_phone := public.auth_phone_e164(event #>> '{user,phone}');
    IF v_phone IS NOT NULL THEN
      v_allowed :=
        -- grant vigente (append-only: vale el más nuevo no revocado)
        EXISTS (
          SELECT 1 FROM public.auth_creation_grants g
          WHERE g.subject_type = 'phone'
            AND g.subject_normalized = v_phone
            AND g.revoked_at IS NULL
            AND g.expires_at > now()
        )
        -- paciente previamente registrado por una clínica
        OR EXISTS (
          SELECT 1 FROM public.patients pt
          WHERE public.auth_phone_e164(pt.phone) = v_phone
        )
        -- médico existente (incluye el claim de seed/legacy)
        OR EXISTS (
          SELECT 1
          FROM public.doctors d
          JOIN public.profiles pr ON pr.id = d.profile_id
          WHERE public.auth_phone_e164(pr.phone) = v_phone
        )
        -- invitación de asistente pendiente y vigente
        OR EXISTS (
          SELECT 1 FROM public.clinic_invitations ci
          WHERE ci.accepted_at IS NULL
            AND ci.cancelled_at IS NULL
            AND ci.expires_at > now()
            AND public.auth_phone_e164(ci.phone) = v_phone
        )
        -- invitación de administrador pending y vigente (comparación
        -- directa contra el E.164 sin '+': usa el índice pending_uniq)
        OR EXISTS (
          SELECT 1 FROM public.platform_admin_invitations pai
          WHERE pai.status = 'pending'
            AND pai.expires_at > now()
            AND pai.phone_normalized = ltrim(v_phone, '+')
        );
    END IF;

  ELSIF v_provider = 'email' THEN
    -- Rama de CORREO: exclusivamente grant de email. Un grant de teléfono
    -- jamás autoriza correo (y viceversa): subject_type disjunto.
    v_email := lower(btrim(event #>> '{user,email}'));
    IF v_email IS NOT NULL AND v_email <> '' THEN
      v_allowed := EXISTS (
        SELECT 1 FROM public.auth_creation_grants g
        WHERE g.subject_type = 'email'
          AND g.subject_normalized = v_email
          AND g.revoked_at IS NULL
          AND g.expires_at > now()
      );
    END IF;

  ELSE
    -- Provider ausente, desconocido o inconsistente → rechazo.
    v_allowed := false;
  END IF;

  IF v_allowed THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 400,
      'message', 'No pudimos procesar la solicitud. Verifica tus datos o contáctanos.'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM authenticated;
-- service_role recibe EXECUTE por los default privileges de Supabase en
-- funciones nuevas de `public`; se REVOCA explícitamente para cumplir el
-- invariante: el hook es ejecutable ÚNICAMENTE por supabase_auth_admin.
-- (No se tocan los default privileges globales del proyecto — fuera de alcance.)
REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.hook_before_user_created(jsonb) TO supabase_auth_admin;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Verificación:
--   node scripts/check-s7_65.mjs      -- estructura + denegaciones (anon)
--                                        + generación/verificación del
--                                        bloque de paridad (§G del doc)
--   node scripts/_smoke-s7_65.mjs     -- constraints del modelo (requiere
--                                        autorización de service_role)
--   docs/OWNER_S7_65_VERIFY.md        -- bloques del OWNER (A–G): privilegios
--     antes/después · matriz del hook bajo SET LOCAL ROLE supabase_auth_admin
--     (fixtures sintéticas, rollback deliberado) · EXPLAIN e indexabilidad
--     (incl. pg_get_indexdef) · timing · paridad frontend ↔ SQL.
--
-- ACTIVACIÓN (NO en este PR): el hook se configura en el Dashboard SOLO
-- tras B1B (plumbing del booking intent), con A/B de elegibilidad y prueba
-- empírica de admin.createUser; rollback = deshabilitarlo (1 click).
-- ═══════════════════════════════════════════════════════════
