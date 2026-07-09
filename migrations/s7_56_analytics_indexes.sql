-- ═══════════════════════════════════════════════════════════
-- Migración S7-56: índices de soporte para Analytics / Farma (LucyAdmin)
-- ═══════════════════════════════════════════════════════════
-- ADDITIVE-ONLY. Solo agrega índices para las columnas calientes que consumen
-- las RPCs de solo-lectura de los dashboards admin (s7_53 conversión + s7_54
-- farma). NO cambia datos, columnas, tipos, RLS, RPCs, lógica ni resultados.
-- Un índice solo altera el PLAN de ejecución, nunca los agregados devueltos.
--
-- MOTIVACIÓN (P0 read-only, verificado contra pg_indexes de la DB real):
--   Las tablas transaccionales calientes NO tenían índice sobre las columnas
--   por las que filtran/agrupan/joinean estos dashboards:
--     • prescriptions            → SOLO PK (falta consultation_id / medication_id / is_current)
--     • audit_log                → SOLO PK (la query de "claims" del summary de
--                                   conversión escanea toda la tabla —la de mayor
--                                   crecimiento— con extracción JSONB edited_via)
--     • consultations            → sin índice sobre signed_at / status='signed'
--     • appointments             → sin índice sobre created_at (filtro de rango)
--     • reviews                  → sin índice sobre created_at (analytics filtra acá,
--                                   el índice existente es sobre submitted_at)
--   waitlist_entries y doctor_affiliation_requests YA están bien indexadas → no se tocan.
--
-- CRITERIO RECTOR: la analítica debe OBSERVAR la operación, no COMPETIR con ella.
--   Sin estos índices, a escala (1.000+ médicos) los seq scans de los dashboards
--   compiten por IO/conexiones con login/reserva/panel. Preventivo: el volumen
--   actual es bajo, pero los índices son baratos, idempotentes y forward-safe.
--
-- DECISIONES EXPLÍCITAS:
--   • CREATE INDEX normal (NO CONCURRENTLY): el volumen actual es minúsculo, el
--     lock es de milisegundos y así la migración se aplica como un solo bloque.
--   • audit_log → índice PARCIAL de expresión (opción A, cambio mínimo). El
--     refactor de sacar "claims" fuera de audit_log (opción B) queda como
--     follow-up separado, FUERA de este PR.
--   • NO se incluye appointments(source) (baja cardinalidad, poco retorno).
--
-- SEGURIDAD / ALCANCE: additive-only, idempotente (IF NOT EXISTS), reversible
--   (ver ROLLBACK al pie). No toca RLS, auth, RPCs, UI, database.types.ts,
--   Analytics V2, materialized views, Search Console, SEO/Slugs ni Brand/Favicon.
--
-- VERIFICACIÓN (no hay check-s7_56.mjs: pg_indexes no es accesible vía supabase-js
--   en este entorno, así que un check que finja verificar sería inútil):
--   1. Aplicar este archivo en Supabase SQL Editor.
--   2. Confirmar los 7 índices con la consulta pg_indexes del pie.
--   3. Re-correr los smokes existentes _smoke-s7_53.mjs + _smoke-s7_54.mjs y
--      confirmar 0 errores y agregados IDÉNTICOS (los índices no cambian resultados).
-- ═══════════════════════════════════════════════════════════

-- ── P1 · Farma: desbloquean el JOIN prescriptions→consultations y el filtro de fecha ──
CREATE INDEX IF NOT EXISTS idx_prescriptions_consultation
  ON prescriptions(consultation_id);

CREATE INDEX IF NOT EXISTS idx_consultations_signed
  ON consultations(signed_at)
  WHERE status = 'signed';

-- ── P1 · Conversión: la peor query (claims) sobre la tabla de mayor crecimiento ──
CREATE INDEX IF NOT EXISTS idx_audit_claim_self_service
  ON audit_log(created_at)
  WHERE (new_data->>'edited_via') = 'claim_self_service';

-- ── P2 · baratos, mismo PR ──
CREATE INDEX IF NOT EXISTS idx_prescriptions_medication
  ON prescriptions(medication_id);

CREATE INDEX IF NOT EXISTS idx_prescriptions_current
  ON prescriptions(consultation_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_appointments_created
  ON appointments(created_at);

CREATE INDEX IF NOT EXISTS idx_reviews_created
  ON reviews(created_at);

-- ───────────────────────────────────────────────────────────
-- VERIFICACIÓN (read-only, correr tras aplicar — debe devolver los 7 índices):
--
--   select tablename, indexname, indexdef
--   from pg_indexes
--   where schemaname = 'public'
--     and tablename in ('appointments','consultations','prescriptions','audit_log','reviews')
--     and indexname in (
--       'idx_prescriptions_consultation',
--       'idx_consultations_signed',
--       'idx_audit_claim_self_service',
--       'idx_prescriptions_medication',
--       'idx_prescriptions_current',
--       'idx_appointments_created',
--       'idx_reviews_created'
--     )
--   order by tablename, indexname;
--
-- Después: node scripts/_smoke-s7_53.mjs && node scripts/_smoke-s7_54.mjs
-- (sesión admin, fixtures aisladas; agregados idénticos = 0 regresión).
-- ───────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────
-- ROLLBACK (additive-only, reversible sin pérdida de datos):
--   DROP INDEX IF EXISTS idx_prescriptions_consultation;
--   DROP INDEX IF EXISTS idx_consultations_signed;
--   DROP INDEX IF EXISTS idx_audit_claim_self_service;
--   DROP INDEX IF EXISTS idx_prescriptions_medication;
--   DROP INDEX IF EXISTS idx_prescriptions_current;
--   DROP INDEX IF EXISTS idx_appointments_created;
--   DROP INDEX IF EXISTS idx_reviews_created;
-- ───────────────────────────────────────────────────────────
