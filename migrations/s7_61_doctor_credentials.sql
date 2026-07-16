-- ═══════════════════════════════════════════════════════════
-- Migración S7-61: doctor_credentials — F1-a (modelo, aditivo)
-- ═══════════════════════════════════════════════════════════
-- Diseño: docs/ANALISIS_CREDENCIALES_MEDICAS.md (§6 modelo, §0 nota de
-- vigencia / prioridad de seguridad, §0.2 lo que F1 debe resolver).
--
-- ── POR QUÉ ──
-- `doctors.license_number` (= JVPM) es un SECRETO viviendo en una tabla
-- LEGIBLE POR FILA: la RLS `doctors_select_public` deja ver a cualquier
-- médico publicado, así que un grant de columna se filtra a todo el rol.
-- `s7_60` (#289) cerró lo urgente (anon ya no la lee; el médico ya no la
-- escribe), pero dejó un RIESGO RESIDUAL: `authenticated` conserva
-- SELECT (license_number) → cualquier usuario con cuenta puede leer la
-- licencia de un médico publicado. Y no es un dato inocuo: es UNO DE LOS DOS
-- FACTORES DEL CLAIM (s7_13 exige teléfono OTP-verificado `P0005` Y licencia
-- tipeada `P0007`), y 36 de los 37 publicados están `listed_only`.
--
-- El arreglo NO es parchear permisos de columna (se evaluó y se descartó:
-- §0.1 del análisis). Es MOVER EL SECRETO a una tabla cuyas FILAS solo ve su
-- dueño y el owner admin. Ahí el valor es inalcanzable POR FILA, no por
-- columna: no hacen falta RPCs de lectura, ni grants por columna, ni queda el
-- "impuesto" de tener que otorgar cada columna nueva.
--
-- ── QUÉ HACE ESTA MIGRACIÓN (F1-a) ──
-- Es ADITIVA y de CERO CAMBIO DE COMPORTAMIENTO OBSERVABLE (salvo la nota de
-- §3b):
--   • enums + tabla + RLS + grants + audit (con el valor REDACTADO);
--   • backfill de 114 credenciales JVPM desde doctors.license_number;
--   • trigger de sync que mantiene ambas fuentes alineadas.
-- NADIE LEE la tabla todavía: el claim, el panel y la receta siguen leyendo
-- `doctors.license_number`, que sigue siendo la fuente viva. El cutover de
-- lectores es F1-b; el DROP de la columna —que es lo que CIERRA el riesgo
-- residual— es F1-c.
--
-- ── PRE-FLIGHT (corrido por el owner, read-only, 2026-07-16) ──
--   • 114 doctores, LOS 114 con licencia no vacía → backfill = 114 filas;
--   • 0 grupos de licencias duplicadas (normalizadas) → el índice único
--     antifraude entra limpio, sin pre-limpieza.
--
-- ── NO TOCA ──
-- `is_verified` · `lucy_status` · el enum · la RLS/policies/grants de
-- `doctors` (s7_60 intacta) · `doctors.license_number` (sigue siendo la
-- fuente viva) · `claim_doctor_profile` (s7_13) ·
-- `admin_approve_and_create_doctor` (s7_42) · la UI · `auth.users` · pagos ·
-- clínica.
--
-- ── REVERSIBLE ──
-- `DROP TRIGGER trg_sync_license_to_credential ON doctors;`
-- `DROP TABLE doctor_credentials;` (+ los dos enums y las dos funciones).
-- No hay pérdida de datos: la columna original nunca se toca.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Enums ───────────────────────────────────────────────
-- Patrón idempotente de s7_21.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credential_type') THEN
    CREATE TYPE credential_type AS ENUM (
      'JVPM',   -- licencia profesional base (la única que existe hoy)
      'NUE',    -- Número Único de Especialista. NO existe dato aún: solo
                -- especialistas/subespecialistas. Sin UI en F1.
      'OTHER'   -- cajón para credenciales futuras. Texto libre.
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credential_status') THEN
    CREATE TYPE credential_status AS ENUM (
      'pending',   -- registrada, sin verificar. Estado del backfill.
      'verified',  -- LucyAdmin la validó (flujo = F2)
      'rejected'   -- LucyAdmin la descartó, con motivo
    );
  END IF;
END $$;

-- ─── 2. Tabla ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id        uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  type             credential_type NOT NULL,

  -- El número. NUNCA debe llegar a un rol amplio ni al payload público.
  -- Lo protege la RLS de §4 (por FILA), no un grant por columna.
  value            text NOT NULL,

  -- Espejo EXACTO de la normalización de s7_13 (upper + quitar espacios).
  -- Es lo que comparará el claim (F1-b) y sobre lo que aplica el índice
  -- antifraude. GENERATED: no puede desincronizarse de `value`.
  value_normalized text GENERATED ALWAYS AS
                     (upper(regexp_replace(coalesce(value, ''), '\s', '', 'g'))) STORED,

  status           credential_status NOT NULL DEFAULT 'pending',

  -- Mostrar señal pública de esta credencial. INERTE en F1: nada lo lee.
  -- La UI pública es F4 y la regla será `status='verified' AND is_public`.
  -- El NÚMERO nunca se muestra: a lo sumo la etiqueta de confianza.
  is_public        boolean NOT NULL DEFAULT false,

  rejection_reason text,
  verified_by      uuid REFERENCES profiles(id),
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Una credencial en blanco no es una credencial: s7_13 trata '' igual que
  -- ausente (P0006).
  CONSTRAINT doctor_credentials_value_not_blank
    CHECK (btrim(value) <> ''),

  -- Un rechazo sin motivo no es auditable.
  CONSTRAINT doctor_credentials_rejected_needs_reason
    CHECK (status <> 'rejected' OR btrim(coalesce(rejection_reason, '')) <> ''),

  -- Una verificación sin actor ni fecha no es trazable. Y al revés: no se
  -- sella verified_by/at sin estar verificada.
  CONSTRAINT doctor_credentials_verified_needs_actor
    CHECK (
      (status =  'verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
      OR
      (status <> 'verified' AND verified_by IS NULL     AND verified_at IS NULL)
    )
);

-- ─── 3. Índices ─────────────────────────────────────────────

-- Un JVPM y un NUE por médico (OTHER puede repetirse).
CREATE UNIQUE INDEX IF NOT EXISTS doctor_credentials_one_per_type
  ON doctor_credentials (doctor_id, type)
  WHERE type IN ('JVPM', 'NUE');

-- ANTIFRAUDE: dos médicos no pueden declarar el mismo número de registro.
-- Hoy `doctors` NO tiene ninguna restricción así: nada impide que dos médicos
-- declaren el mismo JVPM. Esta migración AGREGA una garantía que no existía.
-- Pre-flight: 0 duplicados → entra sin limpieza.
--
-- Parcial por DOS razones, ambas deliberadas:
--   • `type IN ('JVPM','NUE')` → son números de registro, únicos por
--     definición. `OTHER` es texto libre: la unicidad no está garantizada y un
--     índice total lo bloquearía sin motivo.
--   • `status <> 'rejected'` → CRÍTICO. Sin esto, si alguien registra un JVPM
--     ajeno y LucyAdmin lo RECHAZA, esa fila rechazada bloquearía PARA SIEMPRE
--     que el dueño legítimo registre su propio número: el constraint
--     antifraude terminaría protegiendo al fraude. Excluyendo los rechazos,
--     `pending` y `verified` ocupan el número (dos pendientes con el mismo
--     JVPM chocan, que es lo que queremos) y un rechazo lo libera.
CREATE UNIQUE INDEX IF NOT EXISTS doctor_credentials_registry_uniq
  ON doctor_credentials (type, value_normalized)
  WHERE type IN ('JVPM', 'NUE') AND status <> 'rejected';

-- Lookup del claim / panel / receta (F1-b).
CREATE INDEX IF NOT EXISTS idx_doctor_credentials_doctor
  ON doctor_credentials (doctor_id, type);

-- ─── 3b. ⚠️ El ÚNICO cambio de comportamiento de esta migración ──
-- Combinado con el trigger de §8, el índice antifraude hace que crear o
-- actualizar un médico con un JVPM que YA pertenece a otro médico FALLE con
-- un `23505` crudo, donde hoy se creaba el duplicado en silencio.
--   • Alcance: `admin_approve_and_create_doctor` (un admin aprobando un lead
--     con licencia duplicada) e `import-doctors.mjs` (que ya deduplica por
--     license_number, así que no debería alcanzarlo).
--   • Hoy es inalcanzable: 0 duplicados en las 114 filas.
--   • Es el comportamiento DESEADO —bloquear un JVPM duplicado es el punto—,
--     pero se manifiesta como un error crudo en vez de un código amable.
--   • F1-b debe mapearlo a un `P00xx` con copy claro en la bandeja de
--     afiliación. Se documenta acá para que no aparezca como sorpresa.

-- ─── 4. RLS — el corazón del fix ────────────────────────────
-- El valor se protege por FILA, no por columna. Un paciente autenticado no ve
-- NINGUNA fila (get_user_doctor_id() es NULL para quien no es médico — mismo
-- helper y misma semántica que el gate clínico de s7_26), así que el grant
-- amplio de SELECT de §5 no le sirve de nada.
ALTER TABLE doctor_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS doctor_credentials_select ON doctor_credentials;
CREATE POLICY doctor_credentials_select ON doctor_credentials
  FOR SELECT USING (
    -- owner admin: lo necesita para verificar (F2).
    -- is_admin() = SOLO owner. Deliberadamente NO can_manage_directory():
    -- `directory_editor` no ve credenciales (coherente con s7_57).
    is_admin()
    -- el médico dueño, solo lo suyo. NULL para asistente/paciente/anon.
    OR doctor_id = get_user_doctor_id()
  );

-- SIN policies de INSERT / UPDATE / DELETE: nadie escribe directo, ni el
-- propio médico. Las escrituras entran por el trigger de §8 (SECURITY
-- DEFINER) y, en F2, por las RPCs de verificar/rechazar. Mismo criterio que
-- los catálogos globales.

-- ─── 5. Grants ──────────────────────────────────────────────
-- anon: NADA. Ni la tabla. No hay caso público para una credencial.
REVOKE ALL ON doctor_credentials FROM PUBLIC;
REVOKE ALL ON doctor_credentials FROM anon;

-- authenticated: SELECT de tabla, pero la RLS de §4 filtra las FILAS.
-- NO se otorga INSERT/UPDATE/DELETE (ver §4).
REVOKE ALL ON doctor_credentials FROM authenticated;
GRANT SELECT ON doctor_credentials TO authenticated;

-- service_role no se toca (full access por convención).

-- ─── 6. updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_doctor_credentials()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_doctor_credentials ON doctor_credentials;
CREATE TRIGGER trg_touch_doctor_credentials
  BEFORE UPDATE ON doctor_credentials
  FOR EACH ROW EXECUTE FUNCTION touch_doctor_credentials();

-- ─── 7. Audit — CON REDACCIÓN DEL VALOR ─────────────────────
-- ⚠️ El patrón habitual (audit_catalog, s7_38) hace to_jsonb(OLD)/to_jsonb(NEW)
-- de la fila entera. Acá eso METERÍA EL JVPM EN TEXTO PLANO dentro de
-- `audit_log` — duplicando el secreto en una tabla con OTRO control de acceso,
-- y encima en la de mayor crecimiento del sistema. Sería mover el secreto de
-- un lugar filtrable a otro: exactamente lo que esta migración viene a evitar.
--
-- Por eso se redactan `value` y `value_normalized`, y en su lugar se registra
-- `value_changed` (booleano): queda la TRAZA de que el número cambió, sin el
-- número.
CREATE OR REPLACE FUNCTION audit_doctor_credentials()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := (to_jsonb(OLD) - 'value' - 'value_normalized');
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new := (to_jsonb(NEW) - 'value' - 'value_normalized')
             || jsonb_build_object('edited_via', 'doctor_credentials');
  END IF;

  -- Traza del cambio de valor SIN el valor.
  IF TG_OP = 'UPDATE' THEN
    v_new := v_new || jsonb_build_object(
      'value_changed', (OLD.value_normalized IS DISTINCT FROM NEW.value_normalized)
    );
  END IF;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(),
    lower(TG_OP)::audit_action,
    'doctor_credentials',
    COALESCE(NEW.id, OLD.id),
    v_old,
    v_new
  );

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_audit_doctor_credentials ON doctor_credentials;
CREATE TRIGGER trg_audit_doctor_credentials
  AFTER INSERT OR UPDATE OR DELETE ON doctor_credentials
  FOR EACH ROW EXECUTE FUNCTION audit_doctor_credentials();

-- ─── 8. Sync: doctors.license_number → doctor_credentials ───
-- Mantiene las dos fuentes alineadas mientras la columna siga siendo la viva
-- (o sea, hasta F1-c). Se corta en F1-c, junto con el DROP de la columna.
--
-- POR QUÉ UN TRIGGER Y NO UN "DUAL-WRITE" DENTRO DE LA RPC DE AFILIACIÓN:
--   • `admin_approve_and_create_doctor` NO es el único escritor. También
--     escriben `scripts/import-doctors.mjs` y `scripts/setup-test-doctor-prb.mjs`
--     con service_role. Un dual-write dentro de la RPC dejaría esos dos
--     caminos fuera de sincronía; el trigger los cubre a todos, incluido
--     cualquier UPDATE manual del owner por SQL.
--   • Re-emitir esa RPC (s7_42, 430 líneas con las ramas new/reuse_patient/
--     block) para agregar un INSERT arriesga una regresión de transcripción en
--     un flujo crítico, a cambio de menos cobertura.
--   • Precedente directo en el proyecto: `sync_phone_to_identity` (s7_34)
--     sincroniza auth.users.phone → profiles/patients con exactamente este
--     patrón.
-- Resultado: s7_42 y s7_13 quedan SIN TOCAR en F1-a.
CREATE OR REPLACE FUNCTION sync_license_to_credential()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sin licencia no hay nada que sincronizar. NO se borra la credencial
  -- existente: vaciar la columna no es una acción que hoy pueda hacer nadie
  -- (s7_60 se la revocó al médico), y decidir qué significa "borrar una
  -- credencial" es de F2, no de un trigger de sync.
  IF NEW.license_number IS NULL OR btrim(NEW.license_number) = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO doctor_credentials (doctor_id, type, value, status)
  VALUES (NEW.id, 'JVPM', btrim(NEW.license_number), 'pending')
  ON CONFLICT (doctor_id, type) WHERE type IN ('JVPM', 'NUE')
  DO UPDATE
     SET value            = EXCLUDED.value,
         -- El número cambió ⇒ lo que se hubiera verificado ya no es este
         -- número. Volver a 'pending' evita afirmar que un valor nuevo está
         -- verificado. Los tres campos se limpian juntos para respetar el
         -- CHECK `verified_needs_actor`.
         status           = 'pending',
         verified_by      = NULL,
         verified_at      = NULL,
         rejection_reason = NULL
   -- Solo si el valor REALMENTE cambió. Sin este WHERE, cualquier UPDATE de
   -- `doctors` que re-escriba la misma licencia tocaría updated_at y generaría
   -- una fila de audit por nada — el mismo error que ya se corrigió en los
   -- vitales (F5 / #276).
   WHERE doctor_credentials.value_normalized
         IS DISTINCT FROM upper(regexp_replace(EXCLUDED.value, '\s', '', 'g'));

  RETURN NEW;
END $$;

-- `OF license_number` → el trigger NO corre cuando el panel guarda bio,
-- tarifa, idiomas, is_published o booking_enabled. Solo cuando la licencia
-- entra o cambia.
DROP TRIGGER IF EXISTS trg_sync_license_to_credential ON doctors;
CREATE TRIGGER trg_sync_license_to_credential
  AFTER INSERT OR UPDATE OF license_number ON doctors
  FOR EACH ROW EXECUTE FUNCTION sync_license_to_credential();

-- ─── 9. Backfill ────────────────────────────────────────────
-- Una credencial JVPM por cada médico con licencia no vacía.
-- Pre-flight: 114 doctores, los 114 con licencia → 114 filas esperadas.
--
-- `status='pending'` A PROPÓSITO, incluso para el médico `verified`:
-- NUNCA existió verificación a nivel de CREDENCIAL. `is_verified` global (hoy
-- solo Camilo) es otra cosa y no se toca — el análisis manda mantener
-- separadas "confianza global del médico" y "credencial verificada".
-- Marcarlas `verified` sería afirmar algo que nadie chequeó.
--
-- El claim compara el VALOR, no el estado, así que seguirá funcionando con
-- `pending` cuando F1-b lo apunte acá.
--
-- El filtro de blancos es defensivo: hoy no hay ninguno, pero s7_21 permite
-- leads sin licencia ("recomendada pero no bloqueante"), así que el caso es
-- alcanzable a futuro.
--
-- Idempotente: re-ejecutarlo no duplica (lo impide doctor_credentials_one_per_type).
INSERT INTO doctor_credentials (doctor_id, type, value, status)
SELECT d.id, 'JVPM'::credential_type, btrim(d.license_number), 'pending'::credential_status
FROM doctors d
WHERE d.license_number IS NOT NULL
  AND btrim(d.license_number) <> ''
ON CONFLICT DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Verificación:
--   node scripts/check-s7_61.mjs     -- estructura + backfill + grants
--   node scripts/_smoke-s7_61.mjs    -- matriz de acceso + audit redactado
--
-- Ambos SIN service_role: prueban comportamiento con la anon key y una sesión
-- de médico real.
--
-- SIGUE (no en este PR):
--   F1-b → cutover de lectores (claim s7_13 · panel · receta) + mapear el
--          23505 de §3b a un código amable. La columna sigue existiendo.
--   F1-c → cortar el sync, DROPEAR doctors.license_number, actualizar
--          scripts. ← acá CIERRA el riesgo residual, y sin dejar impuesto de
--          grants por columna: no queda secreto que proteger en `doctors`.
-- ═══════════════════════════════════════════════════════════
