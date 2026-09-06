-- ═══════════════════════════════════════════════════════════════════════
-- s7_85 · DOCTOR-ONBOARDING-READINESS-P0
--
-- Dos conceptos DERIVADOS y SEPARADOS, sin ninguna columna nueva y sin
-- estado persistido:
--
--   · `doctor_booking_ready(uuid)` → la MISMA verdad que el backend de
--     reservas, a nivel de MÉDICO.
--   · `admin_doctors_onboarding(uuid[])` → etapa de onboarding, checks
--     independientes y próxima acción, en LOTE.
--
-- NO se mezclan: el onboarding incluye `profile_incomplete`, que NO es un
-- gate técnico de reservas. Un médico puede ser `booking_ready` y tener el
-- perfil incompleto — eso es correcto y deliberado.
--
-- NO toca: `admin_list_doctors` (su firma queda intacta a propósito),
-- `lucy_status`, `is_operational`, el claim, la publicación, `s7_80`–`s7_84`.
-- No crea tablas, ni triggers, ni columnas. Nada persistido.
--
-- Código de error: P0170.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Reservabilidad canónica ────────────────────────────────────────
-- ESPEJO EXACTO del gate de `validate_booking_slot` (s7_66):
--     (d.is_published AND d.booking_enabled AND d.is_operational)
-- más las dos existencias que esa misma función exige después:
--     servicio activo del médico (P009D) · regla de disponibilidad (P0097)
--
-- ⚠️ GRANULARIDAD DISTINTA, A PROPÓSITO. `validate_booking_slot` valida UN
-- HORARIO concreto: la regla que contiene el instante, los bloqueos y el
-- solapamiento. Esta función responde a nivel de MÉDICO: «¿puede recibir
-- reservas en general?». NO la sustituye ni se invoca desde ella: si un día
-- se pretendiera unificarlas, habría que reconciliar esa diferencia primero.
--
-- Devuelve BOOLEAN y nada más. Es lo único que el perfil público necesita
-- para decidir si ofrece reserva, y evita exponer `is_operational` a `anon`
-- (que `s7_60` dejó fuera de la allowlist de columnas a propósito).

CREATE OR REPLACE FUNCTION public.doctor_booking_ready(p_doctor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT d.is_published
        AND d.is_operational
        AND d.booking_enabled
        AND EXISTS (SELECT 1 FROM services s
                     WHERE s.doctor_id = d.id AND s.is_active = true)
        AND EXISTS (SELECT 1 FROM availability_rules r
                     WHERE r.doctor_id = d.id AND r.is_active = true)
       FROM doctors d
      WHERE d.id = p_doctor_id),
    false);
$$;

COMMENT ON FUNCTION public.doctor_booking_ready(uuid) IS
  'Reservabilidad a nivel de MÉDICO: espejo del gate de validate_booking_slot '
  '(s7_66) más servicio activo y disponibilidad activa. NO valida un horario '
  'concreto. Devuelve solo un booleano para no exponer is_operational a anon.';

REVOKE ALL ON FUNCTION public.doctor_booking_ready(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.doctor_booking_ready(uuid) FROM service_role;
-- `anon` la necesita: es lo que decide si el perfil público ofrece reserva.
GRANT EXECUTE ON FUNCTION public.doctor_booking_ready(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.doctor_booking_ready(uuid) TO authenticated;

-- ─── 2. Etapa de onboarding: DEFINICIÓN ÚNICA ──────────────────────────
-- Toda la lógica de etapa, checks, perfil mínimo y próxima acción vive ACÁ y
-- en ningún otro sitio. Las dos RPCs públicas de abajo la invocan; ninguna
-- reimplementa el CASE. Si se copiara, las dos copias se separarían al primer
-- cambio y el síntoma sería silencioso — es la misma razón por la que
-- `admin_export_doctors` reutiliza `admin_list_doctors` en vez de repetir su
-- WHERE.
--
-- PRECEDENCIA — la primera condición aplicable gana, así que cada médico tiene
-- UNA sola etapa determinista:
--   not_published → pending_claim → pending_activation → profile_incomplete
--   → services_missing → availability_missing → booking_disabled → complete
--
-- Los checks se devuelven ADEMÁS de la etapa, para que nada quede escondido
-- detrás de ella.
--
-- ⚠️ EVIDENCIA DE CLAIM. La señal canónica es `tos_accepted_at IS NOT NULL`:
-- la escribe EXCLUSIVAMENTE `claim_doctor_profile` (s7_13/s7_64), y
-- `admin_approve_and_create_doctor` no la toca. La cláusula sobre
-- `lucy_status` que la acompaña es una INFERENCIA LEGACY, no una segunda
-- fuente canónica: existe solo porque `tos_accepted_at` cubre 1 de 115
-- médicos históricos. NO se normaliza el histórico en este frente, y cuando
-- se normalice esa cláusula puede caer sin tocar nada más.
--
-- PERFIL MÍNIMO = exactamente cinco campos: foto, especialidad, descripción,
-- clínica y ubicación. Son los que el correo de bienvenida le pide al médico.
-- Precio, experiencia, idiomas y educación quedan FUERA a propósito: no los
-- exige el producto para operar, e inflarlos convertiría el onboarding en una
-- checklist arbitraria. Y en ningún caso entran en `doctor_booking_ready`.
--
-- El texto para el owner NO vive acá: se devuelven códigos estables
-- (`stage`, `next_action`, `actor`) y el frontend los traduce.

CREATE OR REPLACE FUNCTION public._doctor_onboarding(p_doctor_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT
      d.id,
      d.is_published AS published,
      (d.tos_accepted_at IS NOT NULL
       OR d.lucy_status IN ('claimed', 'booking_enabled', 'verified')) AS claimed,
      d.is_operational  AS activated,
      d.booking_enabled AS booking_on,
      EXISTS (SELECT 1 FROM services s
               WHERE s.doctor_id = d.id AND s.is_active = true) AS has_services,
      EXISTS (SELECT 1 FROM availability_rules r
               WHERE r.doctor_id = d.id AND r.is_active = true) AS has_availability,
      (SELECT coalesce(jsonb_agg(m.k ORDER BY m.ord), '[]'::jsonb)
         FROM (
           SELECT 1 AS ord, 'foto'::text AS k
            WHERE coalesce(btrim((SELECT p.avatar_url FROM profiles p
                                   WHERE p.id = d.profile_id)), '') = ''
           UNION ALL
           SELECT 2, 'especialidad' WHERE d.specialty_id IS NULL
           UNION ALL
           SELECT 3, 'descripcion'  WHERE coalesce(btrim(d.bio), '') = ''
           UNION ALL
           SELECT 4, 'clinica'
            WHERE coalesce(btrim((SELECT cl.name FROM clinics cl
                                   WHERE cl.id = d.clinic_id)), '') = ''
           UNION ALL
           SELECT 5, 'ubicacion'
            WHERE coalesce(btrim((SELECT cl.address_line FROM clinics cl
                                   WHERE cl.id = d.clinic_id)), '') = ''
         ) m) AS profile_missing
    FROM doctors d
    WHERE d.id = p_doctor_id
  )
  SELECT jsonb_build_object(
    'doctor_id',     c.id,
    'stage',         CASE
                       WHEN NOT c.published        THEN 'not_published'
                       WHEN NOT c.claimed          THEN 'pending_claim'
                       WHEN NOT c.activated        THEN 'pending_activation'
                       WHEN c.profile_missing <> '[]'::jsonb THEN 'profile_incomplete'
                       WHEN NOT c.has_services     THEN 'services_missing'
                       WHEN NOT c.has_availability THEN 'availability_missing'
                       WHEN NOT c.booking_on       THEN 'booking_disabled'
                       ELSE 'complete'
                     END,
    'next_action',   CASE
                       WHEN NOT c.published        THEN 'owner_publish'
                       WHEN NOT c.claimed          THEN 'doctor_claim'
                       WHEN NOT c.activated        THEN 'owner_activate'
                       WHEN c.profile_missing <> '[]'::jsonb THEN 'doctor_complete_profile'
                       WHEN NOT c.has_services     THEN 'doctor_add_services'
                       WHEN NOT c.has_availability THEN 'doctor_add_availability'
                       WHEN NOT c.booking_on       THEN 'enable_booking'
                       ELSE 'none'
                     END,
    -- De quién es el siguiente paso. Es lo que permite filtrar en LucyAdmin
    -- por «lo que me toca a mí».
    'actor',         CASE
                       WHEN NOT c.published        THEN 'owner'
                       WHEN NOT c.claimed          THEN 'doctor'
                       WHEN NOT c.activated        THEN 'owner'
                       WHEN c.profile_missing <> '[]'::jsonb THEN 'doctor'
                       WHEN NOT c.has_services     THEN 'doctor'
                       WHEN NOT c.has_availability THEN 'doctor'
                       WHEN NOT c.booking_on       THEN 'doctor'
                       ELSE NULL
                     END,
    -- Reservabilidad: concepto SEPARADO de la etapa. Un médico puede estar en
    -- `profile_incomplete` y ser reservable igualmente.
    'booking_ready', doctor_booking_ready(c.id),
    'checks', jsonb_build_object(
      'published',        c.published,
      'claimed',          c.claimed,
      'activated',        c.activated,
      'profile_min',      c.profile_missing = '[]'::jsonb,
      'has_services',     c.has_services,
      'has_availability', c.has_availability,
      'booking_enabled',  c.booking_on
    ),
    'profile_missing', c.profile_missing
  )
  FROM c;
$$;

REVOKE ALL ON FUNCTION public._doctor_onboarding(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._doctor_onboarding(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._doctor_onboarding(uuid) FROM service_role;
-- SIN GRANT a propósito: es interna. Las dos RPCs públicas son SECURITY
-- DEFINER y la invocan como su propietario, así que no hace falta abrirla a
-- nadie. Menos superficie.
REVOKE ALL ON FUNCTION public._doctor_onboarding(uuid) FROM authenticated;

-- ─── 3. Onboarding para LucyAdmin, EN LOTE ─────────────────────────────
-- Recibe un ARRAY de ids y devuelve un array jsonb. Una sola llamada para
-- toda la página del listado: sin N+1. El detalle pasa un array de uno.
--
-- Devuelve `jsonb` y NO `RETURNS TABLE` a propósito: añadir un campo más
-- adelante no exigirá `DROP FUNCTION` ni re-otorgar grants. Es la lección de
-- `admin_list_affiliation_requests`, cuya firma de 24 columnas no se puede
-- ampliar con CREATE OR REPLACE.
--
-- PRECEDENCIA — la primera condición aplicable gana, así que cada médico
-- tiene UNA sola etapa determinista:
--   not_published → pending_claim → pending_activation → profile_incomplete
--   → services_missing → availability_missing → booking_disabled → complete
--
-- Los checks se devuelven ADEMÁS de la etapa, para que nada quede escondido
-- detrás de ella.
--
-- ⚠️ EVIDENCIA DE CLAIM. La señal canónica es `tos_accepted_at IS NOT NULL`:
-- la escribe EXCLUSIVAMENTE `claim_doctor_profile` (s7_13/s7_64), y
-- `admin_approve_and_create_doctor` no la toca. La cláusula sobre
-- `lucy_status` que la acompaña es una INFERENCIA LEGACY, no una segunda
-- fuente canónica: existe solo porque `tos_accepted_at` cubre 1 de 115
-- médicos históricos. NO se normaliza el histórico en este frente, y cuando
-- se normalice esa cláusula puede caer sin tocar nada más.
--
-- El texto para el owner NO vive acá: se devuelven códigos estables
-- (`next_action`, `actor`) y el frontend los traduce.


CREATE OR REPLACE FUNCTION public.admin_doctors_onboarding(p_doctor_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0170';
  END IF;

  IF p_doctor_ids IS NULL OR array_length(p_doctor_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(jsonb_agg(o.j ORDER BY ids.ord), '[]'::jsonb)
    INTO v_out
  FROM unnest(p_doctor_ids) WITH ORDINALITY AS ids(id, ord)
  CROSS JOIN LATERAL (SELECT _doctor_onboarding(ids.id) AS j) o
  WHERE o.j IS NOT NULL;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.admin_doctors_onboarding(uuid[]) IS
  'Onboarding de VARIOS médicos en una llamada (sin N+1 de red). Delega toda '
  'la lógica en _doctor_onboarding: no reimplementa el CASE. Devuelve jsonb '
  'para poder ampliarse sin DROP FUNCTION.';

REVOKE ALL ON FUNCTION public.admin_doctors_onboarding(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_doctors_onboarding(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.admin_doctors_onboarding(uuid[]) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_doctors_onboarding(uuid[]) TO authenticated;

-- ─── 4. Listado FILTRADO POR ETAPA, sobre el universo completo ─────────
-- El filtro de etapa no puede ser client-side sobre la página visible: el
-- owner necesita pedir «Pendientes de reclamar» y ver la POBLACIÓN ENTERA.
--
-- ── POR QUÉ LLAMA A `admin_list_doctors` EN VEZ DE REPETIR SU WHERE ──
-- Mismo motivo, y mismo patrón, que `admin_export_doctors` (s7_78): el
-- predicado del listado —búsqueda ILIKE sobre nombre/especialidad/teléfono más
-- los tres filtros booleanos/enum— vive en UN SOLO lugar, `s7_04`. Copiarlo
-- aquí crearía dos definiciones que se separarían al primer cambio, con un
-- síntoma silencioso: una pantalla que no coincide con la otra.
-- `admin_list_doctors` es `RETURNS TABLE`, así que se invoca en el `FROM`.
-- SU FIRMA NO SE TOCA: no hay DROP ni re-otorgar grants.
--
-- La etapa se calcula con `_doctor_onboarding`, la misma definición única que
-- usa la RPC en lote. No hay una segunda ruta de cálculo.
--
-- Se resuelve el universo, se filtra por etapa, se cuenta y se pagina, todo
-- dentro de UNA sola consulta: el cliente hace UNA llamada por página.
--
-- Techo de barrido: como el export, se piden MAX_SCAN + 1 para poder
-- distinguir «cabe» de «no cabe» y se ABORTA en vez de truncar en silencio.
-- Un listado recortado sin avisar es peor que un error.

CREATE OR REPLACE FUNCTION public.admin_list_doctors_by_onboarding(
  p_stage        text,
  p_search       text        DEFAULT NULL,
  p_published    boolean     DEFAULT NULL,
  p_operational  boolean     DEFAULT NULL,
  p_lucy_status  lucy_status DEFAULT NULL,
  p_limit        integer     DEFAULT 25,
  p_offset       integer     DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MAX_SCAN constant int := 10000;
  v_scanned int;
  v_total   int;
  v_rows    jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0170';
  END IF;

  -- UN SOLO barrido: se resuelve el universo, se calcula la etapa una vez por
  -- médico, y de ahí salen a la vez el total filtrado y la página.
  WITH universo AS (
    SELECT l.*, _doctor_onboarding(l.id) AS onb
      FROM public.admin_list_doctors(
             p_search, p_published, p_operational, p_lucy_status,
             MAX_SCAN + 1, 0
           ) l
  ),
  filtrado AS (
    SELECT * FROM universo
     WHERE p_stage IS NULL OR onb->>'stage' = p_stage
  ),
  pagina AS (
    SELECT * FROM filtrado
     ORDER BY created_at DESC, id
     LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0)
  )
  SELECT
    (SELECT count(*) FROM universo),
    (SELECT count(*) FROM filtrado),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
                'id',              p.id,
                'full_name',       p.full_name,
                'phone',           p.phone,
                'specialty',       p.specialty,
                'clinic_name',     p.clinic_name,
                'is_verified',     p.is_verified,
                'is_published',    p.is_published,
                'booking_enabled', p.booking_enabled,
                'is_operational',  p.is_operational,
                'lucy_status',     p.lucy_status,
                'created_at',      p.created_at,
                'onboarding',      p.onb
              ) ORDER BY p.created_at DESC, p.id)
       FROM pagina p), '[]'::jsonb)
    INTO v_scanned, v_total, v_rows;

  -- Se pidió MAX_SCAN + 1 justamente para distinguir «cabe» de «no cabe». Se
  -- aborta en vez de truncar: un listado recortado en silencio es peor que un
  -- error, porque el owner no tiene forma de notar lo que falta.
  IF v_scanned > MAX_SCAN THEN
    RAISE EXCEPTION 'Demasiados médicos para filtrar por etapa.'
      USING ERRCODE = 'P0171';
  END IF;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

COMMENT ON FUNCTION public.admin_list_doctors_by_onboarding(text, text, boolean, boolean, lucy_status, integer, integer) IS
  'Listado admin filtrado por etapa de onboarding sobre el UNIVERSO completo, '
  'no la página visible. Reutiliza admin_list_doctors para el predicado y '
  '_doctor_onboarding para la etapa: ninguna lógica se duplica.';

REVOKE ALL ON FUNCTION public.admin_list_doctors_by_onboarding(text, text, boolean, boolean, lucy_status, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_doctors_by_onboarding(text, text, boolean, boolean, lucy_status, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.admin_list_doctors_by_onboarding(text, text, boolean, boolean, lucy_status, integer, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_doctors_by_onboarding(text, text, boolean, boolean, lucy_status, integer, integer) TO authenticated;
