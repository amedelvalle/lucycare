-- ═══════════════════════════════════════════════════════════
-- Migración S7-60: hardening de grants sobre public.doctors
-- ═══════════════════════════════════════════════════════════
-- Hallazgo (2026-07-16, verificado en la DB de producción por el owner):
-- `doctors` conservaba el GRANT ALL del schema inicial (Sprint 1-2, anterior
-- a migrations/, que arranca en s4_01). `profiles` recibió esta misma cirugía
-- en s7_16 durante el pre-piloto; `doctors` nunca la recibió.
--
-- Confirmado con has_column_privilege() / information_schema.column_privileges:
--
--   1. anon tiene SELECT sobre TODAS las columnas, incluida `license_number`.
--      La RLS (doctors_select_public: `is_published = true OR ...`) filtra
--      FILAS, no COLUMNAS → con la anon key (pública por diseño, embebida en
--      el bundle) esto devuelve el JVPM de todos los médicos publicados:
--        GET /rest/v1/doctors?select=license_number&is_published=eq.true
--
--   2. authenticated tiene UPDATE sobre TODAS las columnas. La policy
--      doctors_update es `USING (profile_id = auth.uid())` con WITH CHECK
--      nulo (que hereda el USING) → un médico puede escribir su propia fila.
--      Como `is_verified` es GENERATED de `lucy_status` (s7_03), esto permite
--      AUTO-VERIFICARSE:
--        PATCH /rest/v1/doctors?id=eq.<propio>  {"lucy_status":"verified"}
--      → badge "Verificado por LucyCare" sin que LucyAdmin intervenga.
--      También permite reescribir el propio `license_number` (el dato contra
--      el que claim_doctor_profile valida) y auto-habilitar `is_operational`
--      (el gate del panel).
--
--   3. doctors_insert es `WITH CHECK (profile_id = auth.uid())` y un INSERT
--      solo exige clinic_id + profile_id (el clinic_id sale del directorio
--      público) → con grants de INSERT, cualquier usuario autenticado podría
--      insertarse como médico verificado y publicado.
--
-- Estrategia: cirugía de GRANTS, no de producto. Mismo patrón que s7_16.
--
-- NO toca: RLS/policies (filtran filas y están correctas) · is_verified ·
-- lucy_status · el enum · claim_doctor_profile · las RPCs admin (SECURITY
-- DEFINER: corren como owner, ajenas a estos grants) · datos · el esquema.
-- Sin columnas nuevas, sin backfill.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Revocar el grant heredado ───────────────────────────
-- REVOKE FROM PUBLIC es necesario: si el rol PUBLIC tuviera privilegios,
-- anon/authenticated los heredarían y revocarles a ellos no serviría de nada.
-- Es no-op si PUBLIC nunca fue grantee. No afecta al owner ni a service_role
-- (que tienen sus propios grants).
REVOKE ALL ON public.doctors FROM PUBLIC;
REVOKE ALL ON public.doctors FROM anon;
REVOKE ALL ON public.doctors FROM authenticated;

-- ─── 2. anon: SELECT solo de las columnas públicas ──────────
-- Derivadas de las ÚNICAS cuatro consultas anon a `doctors` que existen:
--   • directory.service.ts  fetchDoctors      (directorio)
--   • directory.service.ts  fetchDoctorDetail (perfil público / booking)
--   • middleware.ts         perfil            (metadata SEO + JSON-LD)
--   • middleware.ts         sitemap           (/sitemap.xml)
--
-- Incluye columnas que no van en el `select` pero que igual requieren
-- privilegio de columna por aparecer en WHERE / ORDER BY / JOIN:
--   • is_published → filtro `.eq('is_published', true)` en las cuatro
--   • created_at   → `.order('created_at')` en fetchDoctors
--   • updated_at   → `select` del sitemap (<lastmod>)
--   • clinic_id    → FK del embed `clinics!inner(...)`
--
-- Quedan FUERA (anon deja de verlas):
--   • license_number  → el hallazgo #1; el número nunca al público
--   • is_operational  → gate interno del panel, no es dato público
--   • tos_accepted_at / tos_version → control interno
GRANT SELECT (
  id,
  slug,
  profile_id,
  clinic_id,
  specialty_id,
  bio,
  consultation_fee,
  experience_years,
  languages,
  education,
  is_verified,
  lucy_status,
  booking_enabled,
  is_published,
  created_at,
  updated_at
) ON public.doctors TO anon;

-- ─── 3. authenticated: SELECT completo, UPDATE acotado ──────
-- SELECT se mantiene TAL CUAL para no romper el panel del médico
-- (getMyDoctorProfile lee license_number), la receta impresa
-- (consultations.service lee license_number para el "JVPM:" del encabezado,
-- que identifica al prescriptor y debe seguir imprimiéndose) y LucyAdmin.
--
-- RIESGO RESIDUAL CONOCIDO (→ PR-B, ver docs): los grants de columna son por
-- ROL, no por FILA. Con SELECT sobre license_number, cualquier usuario
-- autenticado puede leer la licencia de un médico publicado (la RLS le deja
-- ver esas filas). Esto reduce el público de "cualquiera en internet" a
-- "cualquiera con cuenta", pero no lo cierra. Cerrarlo requiere servir el
-- dato propio por RPC SECURITY DEFINER y revocar SELECT (license_number)
-- también a authenticated — cambio de superficie mayor, fuera de PR-A.
GRANT SELECT ON public.doctors TO authenticated;

-- UPDATE: exactamente lo que el panel escribe hoy, y nada más.
--   • bio, specialty_id, experience_years, consultation_fee, languages
--       → doctorProfile.service.ts::updateDoctorPublic (PerfilPage "Guardar")
--   • is_published    → doctorProfile.service.ts::setDoctorPublished
--   • booking_enabled → doctorProfile.service.ts::setBookingEnabled
--   • updated_at      → lo setean las tres funciones anteriores
--
-- Quedan FUERA (el médico deja de poder escribirlas):
--   • lucy_status    → el hallazgo #2. Solo LucyAdmin, vía admin_set_lucy_status.
--   • license_number → solo soporte/LucyAdmin. El input del panel ya estaba
--                      `disabled`: la UI nunca quiso que se editara.
--   • is_operational → gate del panel; lo decide LucyAdmin.
--   • profile_id, clinic_id, id, slug, created_at, tos_* → identidad y
--     control interno. `slug` además se congela al publicar (trigger s7_52).
--   • education → NADIE lo escribe en todo el repo (verificado).
--   • is_verified → es GENERATED; Postgres rechaza el UPDATE de todas formas.
GRANT UPDATE (
  bio,
  specialty_id,
  experience_years,
  consultation_fee,
  languages,
  is_published,
  booking_enabled,
  updated_at
) ON public.doctors TO authenticated;

-- ─── 4. INSERT / DELETE: nadie ──────────────────────────────
-- Deliberadamente NO se re-otorga INSERT (cierra el hallazgo #3) ni DELETE.
-- Verificado: el cliente nunca inserta en `doctors`. Los médicos se crean
-- solo por admin_approve_and_create_doctor (SECURITY DEFINER, s7_22/s7_42),
-- que corre como owner y no depende de estos grants.

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Verificación: node scripts/check-s7_60.mjs
--               node scripts/_smoke-s7_60.mjs
--
-- Ambos prueban COMPORTAMIENTO con la anon key y una sesión de médico real
-- (sin service_role). Todas las pruebas usan un id inexistente, así que
-- ningún dato real se lee ni se modifica: el privilegio de columna se
-- evalúa al planificar la query, ANTES de filtrar filas — una consulta que
-- matchea cero filas devuelve 42501 si falta el grant, y vacío si sobra.
-- ═══════════════════════════════════════════════════════════
