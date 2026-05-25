-- ═══════════════════════════════════════════════════════════
-- Migración S7-16b: Drop de policies legacy en `profiles`
-- ═══════════════════════════════════════════════════════════
-- Complemento de s7_16. Tras aplicar las nuevas policies de
-- s7_16, quedaron coexistiendo varias policies legacy heredadas
-- de migraciones tempranas. Como RLS combina PERMISSIVE policies
-- con OR, basta UNA policy con `USING true` para que cualquier
-- rol vea TODO. El check de s7_16 detectó que anon ve 123 rows
-- en lugar de 5 (solo médicos publicados).
--
-- Policies legacy detectadas vía pg_policy (todas PERMISSIVE,
-- roles=null → aplican a anon Y authenticated):
--
--   • profiles_public_read_basic   SELECT USING(true)   ← CULPABLE
--   • profiles_select              SELECT USING(true)   ← CULPABLE (duplicado)
--   • profiles_read_own            SELECT USING(auth.uid()=id)  — redundante con profiles_self_select
--   • profiles_update              UPDATE USING(id=auth.uid()) — redundante con profiles_self_update
--   • profiles_insert              INSERT (sin WITH CHECK)      — peligroso, redundante con profiles_self_insert
--
-- Las dropeamos todas. El estado deseado final (definido en s7_16):
--
--   • profiles_anon_published_doctor   anon       SELECT
--   • profiles_self_select             authenticated SELECT
--   • profiles_admin_select            authenticated SELECT
--   • profiles_published_doctor_select authenticated SELECT
--   • profiles_clinic_mate_select      authenticated SELECT
--   • profiles_clinic_patient_select   authenticated SELECT
--   • profiles_self_update             authenticated UPDATE
--   • profiles_self_insert             authenticated INSERT
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles_public_read_basic" ON profiles;
DROP POLICY IF EXISTS "profiles_select"            ON profiles;
DROP POLICY IF EXISTS "profiles_read_own"          ON profiles;
DROP POLICY IF EXISTS "profiles_update"            ON profiles;
DROP POLICY IF EXISTS "profiles_insert"            ON profiles;
