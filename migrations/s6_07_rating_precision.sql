-- ═══════════════════════════════════════════════════════════
-- Migración S6-07: Precisión de reviews.rating (Fase D, paso 1)
-- ═══════════════════════════════════════════════════════════
-- reviews.rating era entero → el promedio ponderado 4.30 se guardaba
-- como 4. Prerequisito antes de mostrar estrellas/score reales.
--
-- La vista doctor_rating_stats depende de reviews.rating, así que
-- no se puede ALTER directo: DROP vista → ALTER → recalcular →
-- recrear la vista (mismo DDL que s6_01).
--
--   rating → numeric(3,2)  (admite 0.00–9.99; rango 1–5 cabe)
--   Recalculo con pesos oficiales: Trato/Claridad/Confianza 20%,
--   Escucha/Satisfacción 15%, Puntualidad 10%.
-- ═══════════════════════════════════════════════════════════

-- 1. Quitar la vista que depende de la columna
DROP VIEW IF EXISTS doctor_rating_stats;

-- 2. Cambiar el tipo de la columna
ALTER TABLE reviews
  ALTER COLUMN rating TYPE numeric(3,2) USING rating::numeric;

-- 3. Recalcular filas existentes que tengan los 6 criterios
UPDATE reviews
SET rating = round(
    (rating_treatment    * 0.20)
  + (rating_clarity      * 0.20)
  + (rating_confidence   * 0.20)
  + (rating_listening    * 0.15)
  + (rating_satisfaction * 0.15)
  + (rating_punctuality  * 0.10)
, 2)
WHERE rating_treatment   IS NOT NULL
  AND rating_clarity     IS NOT NULL
  AND rating_confidence  IS NOT NULL
  AND rating_listening   IS NOT NULL
  AND rating_satisfaction IS NOT NULL
  AND rating_punctuality IS NOT NULL;

-- 4. Recrear la vista (idéntica a s6_01; con rating numeric el score
--    sale con decimales sin más cambios)
CREATE VIEW doctor_rating_stats AS
WITH win AS (
  SELECT *
  FROM reviews
  WHERE is_visible = true
    AND submitted_at >= now() - interval '12 months'
)
SELECT
  d.id AS doctor_id,
  d.specialty_id,
  COALESCE(cnt.n, 0)                                           AS n_reviews,
  CASE WHEN COALESCE(cnt.n,0) = 0 THEN NULL
       ELSE round((10 * 4.0 + COALESCE(cnt.sum_rating,0)) / (10 + cnt.n), 2)
  END                                                          AS score_adjusted,
  round(avg_punctuality, 2)   AS avg_punctuality,
  round(avg_treatment, 2)     AS avg_treatment,
  round(avg_clarity, 2)       AS avg_clarity,
  round(avg_listening, 2)     AS avg_listening,
  round(avg_confidence, 2)    AS avg_confidence,
  round(avg_satisfaction, 2)  AS avg_satisfaction,
  (COALESCE(cnt.n,0) >= 20
   AND round((10 * 4.0 + COALESCE(cnt.sum_rating,0)) / (10 + NULLIF(cnt.n,0)), 2) >= 4.7
  )                                                            AS is_top_rated
FROM doctors d
LEFT JOIN LATERAL (
  SELECT
    count(*)                    AS n,
    sum(rating)                 AS sum_rating,
    avg(rating_punctuality)     AS avg_punctuality,
    avg(rating_treatment)       AS avg_treatment,
    avg(rating_clarity)         AS avg_clarity,
    avg(rating_listening)       AS avg_listening,
    avg(rating_confidence)      AS avg_confidence,
    avg(rating_satisfaction)    AS avg_satisfaction
  FROM win
  WHERE win.doctor_id = d.id
) cnt ON true;

GRANT SELECT ON doctor_rating_stats TO anon, authenticated;
