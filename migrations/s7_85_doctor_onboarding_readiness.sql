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

-- ─── 2. Onboarding para LucyAdmin, EN LOTE ─────────────────────────────
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

  SELECT coalesce(jsonb_agg(x.row ORDER BY x.ord), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT
      ids.ord,
      jsonb_build_object(
        'doctor_id',     d.id,
        'stage',         CASE
                           WHEN NOT c.published        THEN 'not_published'
                           WHEN NOT c.claimed          THEN 'pending_claim'
                           WHEN NOT c.activated        THEN 'pending_activation'
                           WHEN NOT c.profile_min      THEN 'profile_incomplete'
                           WHEN NOT c.has_services     THEN 'services_missing'
                           WHEN NOT c.has_availability THEN 'availability_missing'
                           WHEN NOT c.booking_on       THEN 'booking_disabled'
                           ELSE 'complete'
                         END,
        'next_action',   CASE
                           WHEN NOT c.published        THEN 'owner_publish'
                           WHEN NOT c.claimed          THEN 'doctor_claim'
                           WHEN NOT c.activated        THEN 'owner_activate'
                           WHEN NOT c.profile_min      THEN 'doctor_complete_profile'
                           WHEN NOT c.has_services     THEN 'doctor_add_services'
                           WHEN NOT c.has_availability THEN 'doctor_add_availability'
                           WHEN NOT c.booking_on       THEN 'enable_booking'
                           ELSE 'none'
                         END,
        -- De quién es el siguiente paso. Es lo que permite filtrar en
        -- LucyAdmin por «lo que me toca a mí».
        'actor',         CASE
                           WHEN NOT c.published   THEN 'owner'
                           WHEN NOT c.claimed     THEN 'doctor'
                           WHEN NOT c.activated   THEN 'owner'
                           WHEN NOT c.profile_min THEN 'doctor'
                           WHEN NOT c.has_services     THEN 'doctor'
                           WHEN NOT c.has_availability THEN 'doctor'
                           WHEN NOT c.booking_on  THEN 'doctor'
                           ELSE NULL
                         END,
        -- Reservabilidad: concepto SEPARADO de la etapa. Un médico puede
        -- estar en `profile_incomplete` y ser reservable igualmente.
        'booking_ready', doctor_booking_ready(d.id),
        'checks', jsonb_build_object(
          'published',        c.published,
          'claimed',          c.claimed,
          'activated',        c.activated,
          'profile_min',      c.profile_min,
          'has_services',     c.has_services,
          'has_availability', c.has_availability,
          'booking_enabled',  c.booking_on
        ),
        -- Detalle de lo que falta del perfil mínimo, para que la ficha
        -- pueda decir QUÉ falta y no solo que falta algo.
        'profile_missing', c.profile_missing
      ) AS row
    FROM unnest(p_doctor_ids) WITH ORDINALITY AS ids(id, ord)
    JOIN doctors d ON d.id = ids.id
    CROSS JOIN LATERAL (
      SELECT
        d.is_published AS published,
        -- Señal canónica + inferencia legacy (ver nota de arriba).
        (d.tos_accepted_at IS NOT NULL
         OR d.lucy_status IN ('claimed', 'booking_enabled', 'verified')) AS claimed,
        d.is_operational AS activated,
        d.booking_enabled AS booking_on,
        EXISTS (SELECT 1 FROM services s
                 WHERE s.doctor_id = d.id AND s.is_active = true) AS has_services,
        EXISTS (SELECT 1 FROM availability_rules r
                 WHERE r.doctor_id = d.id AND r.is_active = true) AS has_availability,
        pm.missing = '[]'::jsonb AS profile_min,
        pm.missing AS profile_missing
      FROM (
        SELECT coalesce(jsonb_agg(m.k), '[]'::jsonb) AS missing
        FROM (
          -- Perfil mínimo del ONBOARDING (no del gate de reservas): los
          -- cinco campos que el correo de bienvenida le pide al médico.
          SELECT 'foto'::text AS k
           WHERE coalesce(btrim((SELECT p.avatar_url FROM profiles p
                                  WHERE p.id = d.profile_id)), '') = ''
          UNION ALL
          SELECT 'especialidad' WHERE d.specialty_id IS NULL
          UNION ALL
          SELECT 'descripcion'  WHERE coalesce(btrim(d.bio), '') = ''
          UNION ALL
          SELECT 'clinica'
           WHERE coalesce(btrim((SELECT cl.name FROM clinics cl
                                  WHERE cl.id = d.clinic_id)), '') = ''
          UNION ALL
          SELECT 'ubicacion'
           WHERE coalesce(btrim((SELECT cl.address_line FROM clinics cl
                                  WHERE cl.id = d.clinic_id)), '') = ''
        ) m
      ) pm
    ) c
  ) x;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.admin_doctors_onboarding(uuid[]) IS
  'Etapa de onboarding, checks independientes, próxima acción y '
  'booking_ready, EN LOTE (sin N+1). Todo derivado: no persiste estado ni '
  'crea columnas. Devuelve jsonb para poder ampliarse sin DROP FUNCTION.';

REVOKE ALL ON FUNCTION public.admin_doctors_onboarding(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_doctors_onboarding(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.admin_doctors_onboarding(uuid[]) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_doctors_onboarding(uuid[]) TO authenticated;
