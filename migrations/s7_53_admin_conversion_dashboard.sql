-- ═══════════════════════════════════════════════════════════
-- Migración S7-53: Dashboard interno de conversiones (LucyAdmin) — backend
-- ═══════════════════════════════════════════════════════════
-- Backend de Analytics Fase 3 (PR-A). Dos RPCs de SOLO LECTURA que devuelven
-- AGREGADOS/CONTEOS/PROMEDIOS para el dashboard admin de conversión del
-- directorio. NO devuelven ninguna fila individual de paciente ni PII.
--
-- Diseño confirmado en el Paso 0 read-only (ver docs/ANALISIS_ANALYTICS_LUCYCARE.md):
--   • Clasificación de estados de cita por FLAGS de appointment_statuses:
--       - completadas       = affects_revenue = true            (atendida)
--       - canceladas        = is_final AND NOT affects_revenue AND name='cancelada'
--       - no-show           = is_final AND NOT affects_revenue AND name='no_asistio'
--       - pendientes/curso  = NOT is_final                       (programada/confirmada/en_sala)
--   • Reservas de directorio = appointments.source = 'lucy_directorio'
--     (fuentes sin filas → 0, no rompe).
--   • RECLAMOS se miden desde audit_log (new_data->>'edited_via'='claim_self_service'),
--     NO desde doctors.tos_accepted_at (que hoy está en 0 en todos los médicos).
--
-- SEGURIDAD:
--   • SECURITY DEFINER + gate is_admin() obligatorio → P0001 para anon/médico/
--     asistente/paciente. Solo LucyAdmin.
--   • SOLO agregados: la salida NO contiene patient_id, nombre/teléfono/email/
--     documento de paciente, mensajes de waitlist/afiliación, comentarios de
--     reseñas, notas ni datos clínicos, ni license_number/JVPM. El nombre del
--     médico (profiles.full_name) y el slug ya son públicos.
--   • NO escribe nada, NO crea tablas, NO modifica RLS existente, NO modifica
--     datos. STABLE.
--
-- FECHAS:
--   • p_date_from inclusivo (>=). p_date_to inclusivo a nivel UX → en SQL se
--     aplica < p_date_to + 1 día. NULL en cualquiera = sin ese límite.
--   • El snapshot de OFERTA (doctors) es ESTADO ACTUAL, no se filtra por fecha.
--
-- FILTROS OPCIONALES (preparados para V2; la UI V1 solo usará el rango):
--   • p_specialty_id / p_department_id / p_municipality_id — aplican a las
--     métricas derivadas del médico (bookings/waitlist/reviews/claims/supply/
--     ranking) vía doctors/clinics, y a afiliaciones vía sus propias columnas.
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────
-- 1. admin_conversion_summary — KPIs agregados (jsonb)
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_conversion_summary(
  p_date_from       date DEFAULT NULL,
  p_date_to         date DEFAULT NULL,
  p_specialty_id    uuid DEFAULT NULL,
  p_department_id   text DEFAULT NULL,   -- clinics/departments.id son TEXT (IDs cortos, ej. 'SS')
  p_municipality_id text DEFAULT NULL    -- clinics/municipalities.id son TEXT (ej. 'SS-12')
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to_excl timestamptz := CASE WHEN p_date_to IS NULL THEN NULL ELSE (p_date_to + interval '1 day') END;
  v_b   record;   -- bookings
  v_w   record;   -- waitlist
  v_a   record;   -- affiliations
  v_sup record;   -- supply (oferta, snapshot actual)
  v_rev record;   -- reviews
  v_claims bigint;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0001';
  END IF;

  -- Reservas (por source + clasificación de estado por flags)
  SELECT
    count(*)                                                                              AS total,
    count(*) FILTER (WHERE a.source = 'manual')                                           AS src_manual,
    count(*) FILTER (WHERE a.source = 'lucy_directorio')                                  AS src_directorio,
    count(*) FILTER (WHERE a.source = 'lucy_seguimiento')                                 AS src_seguimiento,
    count(*) FILTER (WHERE st.affects_revenue)                                            AS st_completadas,
    count(*) FILTER (WHERE st.is_final AND NOT st.affects_revenue AND st.name = 'cancelada')  AS st_canceladas,
    count(*) FILTER (WHERE st.is_final AND NOT st.affects_revenue AND st.name = 'no_asistio') AS st_no_show,
    count(*) FILTER (WHERE NOT st.is_final)                                               AS st_pendientes
  INTO v_b
  FROM appointments a
  JOIN appointment_statuses st ON st.id = a.status_id
  JOIN doctors d               ON d.id = a.doctor_id
  LEFT JOIN clinics c          ON c.id = a.clinic_id
  WHERE (p_date_from IS NULL OR a.created_at >= p_date_from)
    AND (v_to_excl   IS NULL OR a.created_at <  v_to_excl)
    AND (p_specialty_id    IS NULL OR d.specialty_id    = p_specialty_id)
    AND (p_department_id   IS NULL OR c.department_id    = p_department_id)
    AND (p_municipality_id IS NULL OR c.municipality_id  = p_municipality_id);

  -- Lista de espera (por estado)
  SELECT
    count(*)                                       AS total,
    count(*) FILTER (WHERE w.status = 'pending')   AS pending,
    count(*) FILTER (WHERE w.status = 'contacted') AS contacted,
    count(*) FILTER (WHERE w.status = 'cancelled') AS cancelled
  INTO v_w
  FROM waitlist_entries w
  JOIN doctors d      ON d.id = w.doctor_id
  LEFT JOIN clinics c ON c.id = d.clinic_id
  WHERE (p_date_from IS NULL OR w.created_at >= p_date_from)
    AND (v_to_excl   IS NULL OR w.created_at <  v_to_excl)
    AND (p_specialty_id    IS NULL OR d.specialty_id    = p_specialty_id)
    AND (p_department_id   IS NULL OR c.department_id    = p_department_id)
    AND (p_municipality_id IS NULL OR c.municipality_id  = p_municipality_id);

  -- Afiliaciones (por estado; dimensiones propias de la solicitud)
  SELECT
    count(*)                                         AS total,
    count(*) FILTER (WHERE r.status = 'pending')     AS pending,
    count(*) FILTER (WHERE r.status = 'in_review')   AS in_review,
    count(*) FILTER (WHERE r.status = 'approved')    AS approved,
    count(*) FILTER (WHERE r.status = 'rejected')    AS rejected,
    count(*) FILTER (WHERE r.status = 'expired')     AS expired
  INTO v_a
  FROM doctor_affiliation_requests r
  WHERE (p_date_from IS NULL OR r.created_at >= p_date_from)
    AND (v_to_excl   IS NULL OR r.created_at <  v_to_excl)
    AND (p_specialty_id    IS NULL OR r.specialty_id    = p_specialty_id)
    AND (p_department_id   IS NULL OR r.department_id    = p_department_id)
    AND (p_municipality_id IS NULL OR r.municipality_id  = p_municipality_id);

  -- Reclamos (fuente = audit_log, NO tos_accepted_at)
  SELECT count(*)
  INTO v_claims
  FROM audit_log al
  WHERE al.new_data->>'edited_via' = 'claim_self_service'
    AND (p_date_from IS NULL OR al.created_at >= p_date_from)
    AND (v_to_excl   IS NULL OR al.created_at <  v_to_excl)
    AND (
      (p_specialty_id IS NULL AND p_department_id IS NULL AND p_municipality_id IS NULL)
      OR EXISTS (
        SELECT 1
        FROM doctors d
        LEFT JOIN clinics c ON c.id = d.clinic_id
        WHERE d.id = (al.record_id)::uuid
          AND (p_specialty_id    IS NULL OR d.specialty_id    = p_specialty_id)
          AND (p_department_id   IS NULL OR c.department_id    = p_department_id)
          AND (p_municipality_id IS NULL OR c.municipality_id  = p_municipality_id)
      )
    );

  -- Oferta / supply (snapshot ACTUAL, sin filtro de fecha)
  SELECT
    count(*)                                                  AS total,
    count(*) FILTER (WHERE d.lucy_status = 'listed_only')     AS listed_only,
    count(*) FILTER (WHERE d.lucy_status = 'claimed')         AS claimed,
    count(*) FILTER (WHERE d.lucy_status = 'booking_enabled') AS booking_enabled_status,
    count(*) FILTER (WHERE d.lucy_status = 'verified')        AS verified_status,
    count(*) FILTER (WHERE d.is_published)                    AS published,
    count(*) FILTER (WHERE d.booking_enabled)                 AS with_agenda,
    count(*) FILTER (WHERE d.is_verified)                     AS verified
  INTO v_sup
  FROM doctors d
  LEFT JOIN clinics c ON c.id = d.clinic_id
  WHERE (p_specialty_id    IS NULL OR d.specialty_id    = p_specialty_id)
    AND (p_department_id   IS NULL OR c.department_id    = p_department_id)
    AND (p_municipality_id IS NULL OR c.municipality_id  = p_municipality_id);

  -- Reseñas (total, visibles, promedio — sin comentario ni patient_profile_id)
  SELECT
    count(*)                              AS total,
    count(*) FILTER (WHERE rv.is_visible) AS visibles,
    round(avg(rv.rating)::numeric, 2)     AS avg_rating
  INTO v_rev
  FROM reviews rv
  JOIN doctors d      ON d.id = rv.doctor_id
  LEFT JOIN clinics c ON c.id = d.clinic_id
  WHERE (p_date_from IS NULL OR rv.created_at >= p_date_from)
    AND (v_to_excl   IS NULL OR rv.created_at <  v_to_excl)
    AND (p_specialty_id    IS NULL OR d.specialty_id    = p_specialty_id)
    AND (p_department_id   IS NULL OR c.department_id    = p_department_id)
    AND (p_municipality_id IS NULL OR c.municipality_id  = p_municipality_id);

  RETURN jsonb_build_object(
    'range', jsonb_build_object('from', p_date_from, 'to', p_date_to),
    'bookings', jsonb_build_object(
      'total', v_b.total,
      'by_source', jsonb_build_object(
        'manual', v_b.src_manual,
        'lucy_directorio', v_b.src_directorio,
        'lucy_seguimiento', v_b.src_seguimiento
      ),
      'by_status', jsonb_build_object(
        'completadas', v_b.st_completadas,
        'canceladas', v_b.st_canceladas,
        'no_show', v_b.st_no_show,
        'pendientes', v_b.st_pendientes
      )
    ),
    'waitlist', jsonb_build_object(
      'total', v_w.total,
      'by_status', jsonb_build_object(
        'pending', v_w.pending,
        'contacted', v_w.contacted,
        'cancelled', v_w.cancelled
      )
    ),
    'affiliations', jsonb_build_object(
      'total', v_a.total,
      'by_status', jsonb_build_object(
        'pending', v_a.pending,
        'in_review', v_a.in_review,
        'approved', v_a.approved,
        'rejected', v_a.rejected,
        'expired', v_a.expired
      )
    ),
    'claims', jsonb_build_object('total', v_claims),
    'supply', jsonb_build_object(
      'total_doctors', v_sup.total,
      'by_lucy_status', jsonb_build_object(
        'listed_only', v_sup.listed_only,
        'claimed', v_sup.claimed,
        'booking_enabled', v_sup.booking_enabled_status,
        'verified', v_sup.verified_status
      ),
      'published', v_sup.published,
      'with_agenda', v_sup.with_agenda,
      'verified', v_sup.verified
    ),
    'reviews', jsonb_build_object(
      'total', v_rev.total,
      'visibles', v_rev.visibles,
      'avg_rating', v_rev.avg_rating
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_conversion_summary(date, date, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_conversion_summary(date, date, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_conversion_summary(date, date, uuid, text, text) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- 2. admin_doctor_conversion_ranking — ranking por médico
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_doctor_conversion_ranking(
  p_date_from    date DEFAULT NULL,
  p_date_to      date DEFAULT NULL,
  p_limit        int  DEFAULT 20,
  p_specialty_id uuid DEFAULT NULL
)
RETURNS TABLE (
  doctor_id           uuid,
  doctor_slug         text,
  doctor_name         text,
  specialty_name      text,
  bookings_total      bigint,
  bookings_directorio bigint,
  waitlist_total      bigint,
  reviews_total       bigint,
  avg_rating          numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to_excl timestamptz := CASE WHEN p_date_to IS NULL THEN NULL ELSE (p_date_to + interval '1 day') END;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH b AS (
    SELECT a.doctor_id AS did,
           count(*)                                            AS total,
           count(*) FILTER (WHERE a.source = 'lucy_directorio') AS directorio
    FROM appointments a
    WHERE (p_date_from IS NULL OR a.created_at >= p_date_from)
      AND (v_to_excl   IS NULL OR a.created_at <  v_to_excl)
    GROUP BY a.doctor_id
  ),
  wl AS (
    SELECT we.doctor_id AS did, count(*) AS total
    FROM waitlist_entries we
    WHERE (p_date_from IS NULL OR we.created_at >= p_date_from)
      AND (v_to_excl   IS NULL OR we.created_at <  v_to_excl)
    GROUP BY we.doctor_id
  ),
  rv AS (
    SELECT r.doctor_id AS did,
           count(*)                          AS total,
           round(avg(r.rating)::numeric, 2)  AS avgr
    FROM reviews r
    WHERE (p_date_from IS NULL OR r.created_at >= p_date_from)
      AND (v_to_excl   IS NULL OR r.created_at <  v_to_excl)
    GROUP BY r.doctor_id
  )
  SELECT
    d.id,
    d.slug,
    pr.full_name,
    s.name,
    COALESCE(b.total, 0),
    COALESCE(b.directorio, 0),
    COALESCE(wl.total, 0),
    COALESCE(rv.total, 0),
    rv.avgr
  FROM doctors d
  LEFT JOIN profiles pr  ON pr.id = d.profile_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN b  ON b.did  = d.id
  LEFT JOIN wl ON wl.did = d.id
  LEFT JOIN rv ON rv.did = d.id
  WHERE (p_specialty_id IS NULL OR d.specialty_id = p_specialty_id)
    AND (COALESCE(b.total, 0) + COALESCE(wl.total, 0) + COALESCE(rv.total, 0)) > 0
  ORDER BY COALESCE(b.total, 0) DESC, COALESCE(b.directorio, 0) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200));
END;
$$;

REVOKE ALL ON FUNCTION admin_doctor_conversion_ranking(date, date, int, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_doctor_conversion_ranking(date, date, int, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_doctor_conversion_ranking(date, date, int, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_53.mjs + node scripts/_smoke-s7_53.mjs
-- ───────────────────────────────────────────────────────────
