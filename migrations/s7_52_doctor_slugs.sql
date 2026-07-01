-- ============================================================
-- s7_52_doctor_slugs.sql — Slugs Fase 1 (backend).
-- Frente "Slugs + SEO". Ref: docs/ANALISIS_SLUGS_SEO.md.
--
-- Alcance:
--   1. slugify_name(text)        — helper puro IMMUTABLE (patrón normalize_phone_sv)
--   2. doctors.slug (nullable)   — + UNIQUE parcial + CHECK de formato idempotente
--   3. _doctor_next_slug(text)   — siguiente slug libre, serializado por base (advisory lock)
--   4. set_doctor_slug()         — trigger BEFORE INSERT/UPDATE: solo publicados, congela
--   5. Backfill determinista de médicos publicados
--
-- NO toca: rutas, payload, auth.users, identidad global, license/JVPM/NUE,
--          DUI, teléfono, redirects. profiles: SOLO lectura de full_name.
--
-- Verificación:  node scripts/check-s7_52.mjs   (sanity, sin sesión)
--                node scripts/_smoke-s7_52.mjs   (funcional, fixtures aisladas)
-- ============================================================

BEGIN;

-- ── 1. Helper de normalización (puro, IMMUTABLE) ──
-- lower() primero → translate solo necesita el set acentuado en minúscula.
-- Set SV: á é í ó ú ü ñ (ü→u, ñ→n). Extensible si aparecieran otros diacríticos.
CREATE OR REPLACE FUNCTION slugify_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(
    trim(BOTH '-' FROM
      regexp_replace(
        regexp_replace(
          translate(lower(coalesce(p_name, '')), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9]+', '-', 'g'      -- no-alfanumérico → guion
        ),
        '-{2,}', '-', 'g'             -- colapsar guiones repetidos
      )
    ),
  '');                                -- '' → NULL
$$;

REVOKE ALL ON FUNCTION slugify_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION slugify_name(text) FROM anon;
REVOKE ALL ON FUNCTION slugify_name(text) FROM authenticated;

-- ── 2. Columna + CHECK de formato (idempotente) + UNIQUE parcial ──
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS slug text;

-- Postgres no soporta ADD CONSTRAINT IF NOT EXISTS: bloque defensivo sobre pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'doctors_slug_format_chk'
       AND conrelid = 'public.doctors'::regclass
  ) THEN
    ALTER TABLE public.doctors
      ADD CONSTRAINT doctors_slug_format_chk
      CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS doctors_slug_unique
  ON doctors (slug) WHERE slug IS NOT NULL;

-- ── 3. Generador del siguiente slug libre (serializado por base) ──
-- SECURITY DEFINER: la generación necesita leer doctors.slug siempre, sin
-- depender de la RLS del caller. search_path fijado + referencias public.*.
-- No expuesta a anon/authenticated.
CREATE OR REPLACE FUNCTION _doctor_next_slug(p_base text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_base      text := coalesce(nullif(p_base, ''), 'medico');
  v_candidate text := v_base;
  v_n         int  := 1;
BEGIN
  -- Serializa la MISMA base entre transacciones concurrentes. Advisory lock
  -- a nivel de transacción (se libera en commit/rollback). Bases distintas
  -- (nombres distintos) NO se bloquean entre sí. El UNIQUE parcial sigue
  -- siendo la garantía dura; el lock evita la carrera de "elegir el mismo -N".
  PERFORM pg_advisory_xact_lock(hashtext('lucy_doctor_slug'), hashtext(v_base));

  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.doctors WHERE slug = v_candidate) THEN
      RETURN v_candidate;
    END IF;
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION _doctor_next_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _doctor_next_slug(text) FROM anon;
REVOKE ALL ON FUNCTION _doctor_next_slug(text) FROM authenticated;

-- ── 4. Trigger: llena slug solo al publicar; congela ──
-- SECURITY DEFINER para leer public.profiles.full_name sin fricción de RLS
-- (los caminos que publican ya son definer, pero esto lo hace robusto).
CREATE OR REPLACE FUNCTION set_doctor_slug()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text;
  v_base text;
BEGIN
  -- El WHEN del trigger ya garantiza NEW.is_published=true AND NEW.slug IS NULL.
  SELECT full_name INTO v_name FROM public.profiles WHERE id = NEW.profile_id;
  v_base := coalesce(nullif(slugify_name(v_name), ''), 'medico');
  NEW.slug := _doctor_next_slug(v_base);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION set_doctor_slug() FROM PUBLIC;
REVOKE ALL ON FUNCTION set_doctor_slug() FROM anon;
REVOKE ALL ON FUNCTION set_doctor_slug() FROM authenticated;

DROP TRIGGER IF EXISTS trg_set_doctor_slug ON doctors;
CREATE TRIGGER trg_set_doctor_slug
  BEFORE INSERT OR UPDATE ON doctors
  FOR EACH ROW
  WHEN (NEW.is_published = true AND NEW.slug IS NULL)   -- congela: no re-actúa si ya hay slug
  EXECUTE FUNCTION set_doctor_slug();

-- ── 5. Backfill determinista de publicados sin slug ──
-- Loop ordenado (created_at, id) → sufijos reproducibles. El SET slug directo
-- NO re-dispara el trigger (NEW.slug ya deja de ser NULL por el propio SET).
DO $$
DECLARE
  r      record;
  v_base text;
BEGIN
  FOR r IN
    SELECT d.id, p.full_name
      FROM public.doctors d
      JOIN public.profiles p ON p.id = d.profile_id
     WHERE d.is_published = true
       AND d.slug IS NULL
     ORDER BY d.created_at, d.id
  LOOP
    v_base := coalesce(nullif(slugify_name(r.full_name), ''), 'medico');
    UPDATE public.doctors SET slug = _doctor_next_slug(v_base) WHERE id = r.id;
  END LOOP;
END $$;

COMMIT;
