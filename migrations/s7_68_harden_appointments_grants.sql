-- ═══════════════════════════════════════════════════════════
-- Migración S7-68: SECURITY — endurecimiento de grants legacy
--                  sobre public.appointments
-- ═══════════════════════════════════════════════════════════
-- Retira los privilegios de tabla LEGACY (GRANT ALL del schema inicial,
-- misma clase que doctors pre-s7_60) que anon/authenticated NO usan en
-- ningún flujo productivo y que la RLS no siempre mitiga.
--
-- ── PREMISA VERIFICADA EN PREFLIGHT (owner, post-s7_67) ──
--   relacl de public.appointments:
--     postgres      = arwdDxtm   (owner, los 8)
--     anon          = rwdDxtm    (SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,
--                                 TRIGGER,MAINTAIN — INSERT ya revocado por s7_67)
--     authenticated = arwdDxtm   (los 8)
--     service_role  = arwdDxtm   (los 8)
--   (aclitem: r=SELECT a=INSERT w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES
--    t=TRIGGER m=MAINTAIN)
--
-- ── QUÉ HACE ──
--   REVOKE de anon:          UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   REVOKE de authenticated: DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--
-- ── QUÉ CONSERVA ──
--   anon          → SELECT
--   authenticated → SELECT, INSERT, UPDATE
--   service_role  → los 8 (SIN CAMBIOS)
--
--   anon SELECT se CONSERVA a propósito: slots.service corre como anon en la
--   página pública y su SELECT (aunque la RLS devuelva 0 filas) es
--   load-bearing; revocarlo se entrelaza con el defecto de slots públicos,
--   que es un frente aparte. NO se toca acá.
--
-- ── RIESGO QUE CIERRA ──
--   TRUNCATE NO pasa por RLS: era el único sobre-privilegio no mitigado.
--   DELETE lo frenaba la RLS (no existe policy DELETE), pero se retira por
--   defensa en profundidad. REFERENCES/TRIGGER/MAINTAIN son higiene.
--
-- ── QUÉ NO TOCA ──
--   LOCK · policies RLS · RPCs (SECURITY DEFINER, ajenas a estos grants) ·
--   GRANT nuevos · service_role · anon SELECT · authenticated
--   SELECT/INSERT/UPDATE · datos · esquema · frontend · otras tablas ·
--   slots públicos.
--
-- ── SEGURIDAD DEL APPLY ──
--   Transacción única con PRECONDICIONES (privilegios efectivos de partida +
--   ACL declarado SEMÁNTICO == estado del preflight, vía aclexplode; aborta
--   ante drift) y POSTCONDICIONES (efectivas + ACL semántico final). Cualquier
--   discrepancia → RAISE EXCEPTION revierte todo.
--
--   El ACL se compara por REPRESENTACIÓN SEMÁNTICA (aclexplode ordenado por
--   grantee/grantor/privilege/grantable), NO por el texto de relacl, cuyo
--   orden no es estable y podría fingir un drift inexistente. grantee=0 se
--   representa como PUBLIC. Ambos lados (actual y esperado) se generan con el
--   MISMO formato y orden para una igualdad determinista.
--
-- ── ROLLBACK / QA ──
--   El rollback literal, el check estático y el bloque A/B de privilegios
--   viven en el HANDOFF EXTERNO del frente, fuera de este repositorio.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. PRECONDICIONES ────────────────────────────────────────────────
DO $pre$
DECLARE
  v_acl_actual   text;
  v_acl_expected text;
BEGIN
  -- 1.1 Privilegios EFECTIVOS de partida (has_table_privilege).
  -- anon: SELECT sí; INSERT no (s7_67); los otros 6 sí.
  IF NOT has_table_privilege('anon','public.appointments','SELECT') THEN
    RAISE EXCEPTION 's7_68 PRE: anon no tiene SELECT (inesperado; SELECT se conserva)';
  END IF;
  IF has_table_privilege('anon','public.appointments','INSERT') THEN
    RAISE EXCEPTION 's7_68 PRE: anon tiene INSERT (s7_67 debía haberlo revocado) — estado inesperado';
  END IF;
  IF NOT (has_table_privilege('anon','public.appointments','UPDATE')
      AND has_table_privilege('anon','public.appointments','DELETE')
      AND has_table_privilege('anon','public.appointments','TRUNCATE')
      AND has_table_privilege('anon','public.appointments','REFERENCES')
      AND has_table_privilege('anon','public.appointments','TRIGGER')
      AND has_table_privilege('anon','public.appointments','MAINTAIN')) THEN
    RAISE EXCEPTION 's7_68 PRE: anon no tiene los 6 privilegios a revocar (UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) — el REVOKE no tendría el efecto esperado';
  END IF;

  -- authenticated: SELECT/INSERT/UPDATE sí; los 5 a revocar sí.
  IF NOT (has_table_privilege('authenticated','public.appointments','SELECT')
      AND has_table_privilege('authenticated','public.appointments','INSERT')
      AND has_table_privilege('authenticated','public.appointments','UPDATE')) THEN
    RAISE EXCEPTION 's7_68 PRE: authenticated no tiene SELECT/INSERT/UPDATE (deben conservarse)';
  END IF;
  IF NOT (has_table_privilege('authenticated','public.appointments','DELETE')
      AND has_table_privilege('authenticated','public.appointments','TRUNCATE')
      AND has_table_privilege('authenticated','public.appointments','REFERENCES')
      AND has_table_privilege('authenticated','public.appointments','TRIGGER')
      AND has_table_privilege('authenticated','public.appointments','MAINTAIN')) THEN
    RAISE EXCEPTION 's7_68 PRE: authenticated no tiene los 5 privilegios a revocar — el REVOKE no tendría el efecto esperado';
  END IF;

  -- service_role: los 8 presentes (no se tocan; se confirman como red).
  IF NOT (has_table_privilege('service_role','public.appointments','SELECT')
      AND has_table_privilege('service_role','public.appointments','INSERT')
      AND has_table_privilege('service_role','public.appointments','UPDATE')
      AND has_table_privilege('service_role','public.appointments','DELETE')
      AND has_table_privilege('service_role','public.appointments','TRUNCATE')
      AND has_table_privilege('service_role','public.appointments','REFERENCES')
      AND has_table_privilege('service_role','public.appointments','TRIGGER')
      AND has_table_privilege('service_role','public.appointments','MAINTAIN')) THEN
    RAISE EXCEPTION 's7_68 PRE: service_role no tiene los 8 privilegios (estado inesperado)';
  END IF;

  -- 1.2 ACL DECLARADO SEMÁNTICO == estado exacto capturado post-s7_67.
  --     Se genera con aclexplode (grantee/grantor/privilege/grantable),
  --     ordenado de forma determinista; grantee=0 → PUBLIC. NO depende del
  --     orden textual de relacl. Cualquier grantee extra, entrada PUBLIC,
  --     grantor distinto o is_grantable=true rompe la igualdad y aborta.
  SELECT string_agg(fmt, '|' ORDER BY g_ord, gr_ord, priv, grantable)
    INTO v_acl_actual
  FROM (
    SELECT
      (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END) AS g_ord,
      a.grantor::regrole::text AS gr_ord,
      a.privilege_type AS priv,
      a.is_grantable   AS grantable,
      (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END)
        || ':' || a.grantor::regrole::text
        || ':' || a.privilege_type
        || ':' || a.is_grantable::text AS fmt
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'public.appointments'::regclass
  ) x;

  -- Estado ESPERADO (post-s7_67): mismo formato/orden, generado desde la
  -- lista enumerada (evita transcribir un literal gigante a mano).
  --   postgres:8 · anon:7(sin INSERT) · authenticated:8 · service_role:8
  --   grantor=postgres, is_grantable=false en todas; sin PUBLIC.
  SELECT string_agg(grantee || ':postgres:' || priv || ':false',
                    '|' ORDER BY grantee, 'postgres', priv, false)
    INTO v_acl_expected
  FROM (VALUES
    ('anon','SELECT'),('anon','UPDATE'),('anon','DELETE'),('anon','TRUNCATE'),
    ('anon','REFERENCES'),('anon','TRIGGER'),('anon','MAINTAIN'),
    ('authenticated','SELECT'),('authenticated','INSERT'),('authenticated','UPDATE'),
    ('authenticated','DELETE'),('authenticated','TRUNCATE'),('authenticated','REFERENCES'),
    ('authenticated','TRIGGER'),('authenticated','MAINTAIN'),
    ('postgres','SELECT'),('postgres','INSERT'),('postgres','UPDATE'),('postgres','DELETE'),
    ('postgres','TRUNCATE'),('postgres','REFERENCES'),('postgres','TRIGGER'),('postgres','MAINTAIN'),
    ('service_role','SELECT'),('service_role','INSERT'),('service_role','UPDATE'),
    ('service_role','DELETE'),('service_role','TRUNCATE'),('service_role','REFERENCES'),
    ('service_role','TRIGGER'),('service_role','MAINTAIN')
  ) e(grantee, priv);

  IF v_acl_actual IS DISTINCT FROM v_acl_expected THEN
    RAISE EXCEPTION 's7_68 PRE: el ACL declarado (semántico) no coincide con el estado del preflight. ACTUAL: % | ESPERADO: %',
      v_acl_actual, v_acl_expected;
  END IF;

  RAISE NOTICE 's7_68 PRE: todas las precondiciones OK.';
END
$pre$;

-- ─── 2. REVOKES ───────────────────────────────────────────────────────
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.appointments
  FROM anon;

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.appointments
  FROM authenticated;

-- ─── 3. POSTCONDICIONES (antes del COMMIT) ────────────────────────────
DO $post$
DECLARE
  v_acl_actual   text;
  v_acl_expected text;
BEGIN
  -- 3.1 Efectivas.
  -- anon: SELECT sí; los otros 7 (incluye INSERT ya ausente) no.
  IF NOT has_table_privilege('anon','public.appointments','SELECT') THEN
    RAISE EXCEPTION 's7_68 POST: anon perdió SELECT (debía conservarse)';
  END IF;
  IF has_table_privilege('anon','public.appointments','INSERT')
     OR has_table_privilege('anon','public.appointments','UPDATE')
     OR has_table_privilege('anon','public.appointments','DELETE')
     OR has_table_privilege('anon','public.appointments','TRUNCATE')
     OR has_table_privilege('anon','public.appointments','REFERENCES')
     OR has_table_privilege('anon','public.appointments','TRIGGER')
     OR has_table_privilege('anon','public.appointments','MAINTAIN') THEN
    RAISE EXCEPTION 's7_68 POST: anon conserva algún privilegio distinto de SELECT';
  END IF;

  -- authenticated: SELECT/INSERT/UPDATE sí; los 5 revocados no.
  IF NOT (has_table_privilege('authenticated','public.appointments','SELECT')
      AND has_table_privilege('authenticated','public.appointments','INSERT')
      AND has_table_privilege('authenticated','public.appointments','UPDATE')) THEN
    RAISE EXCEPTION 's7_68 POST: authenticated perdió SELECT/INSERT/UPDATE (deben conservarse)';
  END IF;
  IF has_table_privilege('authenticated','public.appointments','DELETE')
     OR has_table_privilege('authenticated','public.appointments','TRUNCATE')
     OR has_table_privilege('authenticated','public.appointments','REFERENCES')
     OR has_table_privilege('authenticated','public.appointments','TRIGGER')
     OR has_table_privilege('authenticated','public.appointments','MAINTAIN') THEN
    RAISE EXCEPTION 's7_68 POST: authenticated conserva algún privilegio que debió revocarse';
  END IF;

  -- service_role: los 8 intactos.
  IF NOT (has_table_privilege('service_role','public.appointments','SELECT')
      AND has_table_privilege('service_role','public.appointments','INSERT')
      AND has_table_privilege('service_role','public.appointments','UPDATE')
      AND has_table_privilege('service_role','public.appointments','DELETE')
      AND has_table_privilege('service_role','public.appointments','TRUNCATE')
      AND has_table_privilege('service_role','public.appointments','REFERENCES')
      AND has_table_privilege('service_role','public.appointments','TRIGGER')
      AND has_table_privilege('service_role','public.appointments','MAINTAIN')) THEN
    RAISE EXCEPTION 's7_68 POST: service_role perdió algún privilegio (no debía tocarse)';
  END IF;

  -- 3.2 ACL DECLARADO SEMÁNTICO final (mismo mecanismo aclexplode que PRE).
  --   postgres:8 · anon:1(SELECT) · authenticated:3(SELECT/INSERT/UPDATE) ·
  --   service_role:8 · sin PUBLIC · sin grantee extra.
  SELECT string_agg(fmt, '|' ORDER BY g_ord, gr_ord, priv, grantable)
    INTO v_acl_actual
  FROM (
    SELECT
      (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END) AS g_ord,
      a.grantor::regrole::text AS gr_ord,
      a.privilege_type AS priv,
      a.is_grantable   AS grantable,
      (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END)
        || ':' || a.grantor::regrole::text
        || ':' || a.privilege_type
        || ':' || a.is_grantable::text AS fmt
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid = 'public.appointments'::regclass
  ) x;

  SELECT string_agg(grantee || ':postgres:' || priv || ':false',
                    '|' ORDER BY grantee, 'postgres', priv, false)
    INTO v_acl_expected
  FROM (VALUES
    ('anon','SELECT'),
    ('authenticated','SELECT'),('authenticated','INSERT'),('authenticated','UPDATE'),
    ('postgres','SELECT'),('postgres','INSERT'),('postgres','UPDATE'),('postgres','DELETE'),
    ('postgres','TRUNCATE'),('postgres','REFERENCES'),('postgres','TRIGGER'),('postgres','MAINTAIN'),
    ('service_role','SELECT'),('service_role','INSERT'),('service_role','UPDATE'),
    ('service_role','DELETE'),('service_role','TRUNCATE'),('service_role','REFERENCES'),
    ('service_role','TRIGGER'),('service_role','MAINTAIN')
  ) e(grantee, priv);

  IF v_acl_actual IS DISTINCT FROM v_acl_expected THEN
    RAISE EXCEPTION 's7_68 POST: el ACL declarado final (semántico) no es el esperado. ACTUAL: % | ESPERADO: %',
      v_acl_actual, v_acl_expected;
  END IF;

  RAISE NOTICE 's7_68 POST: todas las postcondiciones OK. Grants legacy retirados.';
END
$post$;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Estado resultante:
--   anon          = SELECT
--   authenticated = SELECT, INSERT, UPDATE
--   service_role  = los 8 (sin cambios)
-- El rollback literal y la verificación A/B de privilegios viven en el
-- HANDOFF EXTERNO del frente, fuera de este repositorio.
-- ═══════════════════════════════════════════════════════════
