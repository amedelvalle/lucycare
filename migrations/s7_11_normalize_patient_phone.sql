-- ═══════════════════════════════════════════════════════════
-- Migración S7-11: normalización del teléfono de pacientes
-- ═══════════════════════════════════════════════════════════
-- La dedup por teléfono (PR #28) comparaba strings literalmente. Eso
-- hacía que '77003001', '+50377003001' y '+503 7700-3001' se vieran
-- como pacientes distintos aunque son el mismo número operativo.
--
-- FIX: backfill que pasa todos los patients.phone existentes al formato
-- canónico '503XXXXXXXX' (11 dígitos, sin '+', sin separadores) —
-- mismo formato que ya usa profiles.phone (Twilio OTP).
--
-- Reglas:
--   - Si los dígitos del input matchean '^503\d{8}$' → guardar tal cual.
--   - Si matchean '^\d{8}$' (local SV sin código país) → prefijar '503'.
--   - Cualquier otro formato (extranjero / inválido) → dejar como estaba.
--
-- IMPORTANTE: esta migración NO fusiona pacientes que queden con el
-- mismo teléfono normalizado en la misma clínica. Coexisten como filas
-- separadas. `scripts/check-s7_11.mjs` los reporta para que el
-- operador decida caso por caso (soft-delete, merge manual, etc.).
--
-- Aditivo y no destructivo (UPDATE de filas existentes; el WHERE
-- evita escribir las que ya están normalizadas).
-- ═══════════════════════════════════════════════════════════

WITH normalized AS (
  SELECT
    id,
    phone,
    CASE
      WHEN regexp_replace(phone, '[^0-9]', '', 'g') ~ '^503[0-9]{8}$'
        THEN regexp_replace(phone, '[^0-9]', '', 'g')
      WHEN regexp_replace(phone, '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
        THEN '503' || regexp_replace(phone, '[^0-9]', '', 'g')
      ELSE phone
    END AS phone_norm
  FROM patients
  WHERE phone IS NOT NULL
)
UPDATE patients p
SET phone = n.phone_norm
FROM normalized n
WHERE p.id = n.id
  AND p.phone <> n.phone_norm;
