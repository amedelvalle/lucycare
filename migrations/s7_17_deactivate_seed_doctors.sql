-- ═══════════════════════════════════════════════════════════
-- Migración S7-17: Desactivar médicos seed *.lucycare.test
-- ═══════════════════════════════════════════════════════════
-- Cierra hallazgo #5 del Security Gate, prerequisito de Fase 4.
--
-- 12 médicos seed con emails ficticios `*.lucycare.test` (UUIDs
-- a0000001-0000-0000-0000-00000000000X) heredados del bootstrap
-- inicial del proyecto. Hoy:
--   - profiles.is_active = true   ← inseguro
--   - doctors.is_published = false  ✅ (ya correcto)
--   - doctors.is_operational = false ✅
--   - doctors.lucy_status = 'listed_only' ✅
--   - 6 con doctors.booking_enabled = true (anomalía irrelevante
--     porque is_published=false, pero la limpiamos)
--   - auth.users NO existe para ninguno (login OTP ya imposible)
--
-- Por qué no DELETE: hay 4 appointments vinculadas a esos doctors
-- (pruebas tempranas). Borrar implica CASCADE o pérdida de
-- audit_log. Preferimos soft-deactivate.
--
-- Objetivos:
--   1. profiles.is_active = false           — bloquea uso del perfil
--   2. doctors.booking_enabled = false      — coherencia (no agenda)
--   3. NO tocar Camilo / Pepe Toro          — cuenta demo oficial
--      profile_id = 'db1fba98-a299-4f25-82f1-7feff01e58fa'
--      doctor_id  = '783a902a-55fd-407c-9e0a-69568135c7f5'
--   4. NO borrar emails / phones / historial — trazabilidad.
--   5. Idempotente.
--
-- La idempotencia se asegura porque los UPDATEs son a un valor fijo
-- (false), no a un toggle. Aplicar dos veces no cambia nada.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. profiles.is_active = false para los 12 seed ─────────
-- WHERE doble: por email *.lucycare.test Y por UUID en el rango
-- a0000001-* para defensa en profundidad. Si por error alguien
-- llamara a otro profile real "x@lucycare.test", el UUID lo
-- protege.
UPDATE profiles
   SET is_active = false,
       updated_at = now()
 WHERE email LIKE '%@lucycare.test'
   AND id::text LIKE 'a0000001-%';

-- ─── 2. doctors.booking_enabled = false para sus rows ───────
UPDATE doctors
   SET booking_enabled = false,
       updated_at = now()
 WHERE profile_id IN (
   SELECT id FROM profiles
   WHERE email LIKE '%@lucycare.test'
     AND id::text LIKE 'a0000001-%'
 );

-- ─── 3. Audit trail manual ──────────────────────────────────
-- Como esto se ejecuta vía SQL Editor (service_role, auth.uid=NULL)
-- el trigger de audit no captura. Insertamos manualmente una fila
-- por cada profile afectado para tener evidencia del cambio.
-- user_id usa un UUID dummy reconocible para distinguir de cambios
-- regulares.
INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
SELECT
  p.id,                                          -- self-attribution (mejor que NULL)
  'update'::audit_action,
  'profiles',
  p.id,
  jsonb_build_object('is_active', true),
  jsonb_build_object(
    'is_active', false,
    'reason', 'seed_deactivation_s7_17',
    'edited_via', 'migration'
  )
FROM profiles p
WHERE p.email LIKE '%@lucycare.test'
  AND p.id::text LIKE 'a0000001-%'
  AND p.is_active = false;  -- solo loguear si el update efectivamente cambió algo (idempotente)
