-- ═══════════════════════════════════════════════════════════
-- Migración S6-07: Precisión de reviews.rating (Fase D, paso 1)
-- ═══════════════════════════════════════════════════════════
-- reviews.rating era entero → el promedio ponderado 4.30 se guardaba
-- como 4. Prerequisito antes de mostrar estrellas/score reales.
--
--   1. rating → numeric(3,2)  (admite 0.00–9.99; rango 1–5 cabe)
--   2. Recalcular filas existentes que tengan los 6 criterios, con
--      los pesos oficiales: Trato/Claridad/Confianza 20%,
--      Escucha/Satisfacción 15%, Puntualidad 10%.
--
-- doctor_rating_stats ya hace round(...,2) → con rating numeric el
-- score sale con decimales sin cambios en la vista.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE reviews
  ALTER COLUMN rating TYPE numeric(3,2) USING rating::numeric;

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
