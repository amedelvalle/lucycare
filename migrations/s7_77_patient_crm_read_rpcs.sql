-- ═══════════════════════════════════════════════════════════
-- Migración S7-77: PATIENT-CRM-P0 — RPCs de LECTURA
-- ═══════════════════════════════════════════════════════════
-- Listado paginado del CRM, bandeja de "Pendientes de identificar" y métricas.
-- Solo LECTURA: ninguna de estas funciones escribe una sola fila.
--
-- ── D4 · LA FRONTERA CLÍNICA VIVE ACÁ, NO EN LA UI ──
-- Estas RPCs enumeran a mano CADA columna que devuelven. No hay `SELECT *`, ni
-- `to_jsonb(fila)`, ni `row_to_json`. Lo que no está en la allowlist NO VIAJA
-- al navegador, aunque la interfaz lo ignore.
--
-- PROHIBIDO devolver, de forma explícita: allergies · blood_type ·
-- patients.notes · appointments.internal_notes · appointments.notes ·
-- reason_id · cancel_reason_id · price · payment_status · emergency_contact_* ·
-- diagnósticos · recetas · consultas · resultados · cualquier dato asistencial.
-- `scripts/check-s7_76.mjs` verifica esta prohibición sobre el TEXTO de la
-- migración: si alguien agrega una de esas columnas, el check falla.
--
-- ── D2 · ESTADOS DERIVADOS, NO PERSISTIDOS ──
-- Prioridad de la etiqueta principal, fijada por el owner:
--   bloqueado > en_seguimiento > recurrente > nuevo > activo > inactivo
--
--   bloqueado      patient_crm.blocked_at IS NOT NULL AND unblocked_at IS NULL
--   en_seguimiento ≥1 follow-up con status='abierto'
--   recurrente     ≥2 citas 'atendida'
--   nuevo          profiles.created_at ≥ now()-30d  y NO recurrente
--   activo         cita futura, o alguna cita en los últimos 90 días
--   inactivo       sin cita futura y última actividad > 180 días
--
-- Los umbrales son parámetros de negocio; viven en una sola función
-- (`_crm_estado`) para que cambiarlos no exija tocar tres consultas.
--
-- ── P3 · SEMÁNTICA DEL "ORIGEN" ──
-- `appointments.source` NO es origen de adquisición. Solo dice por qué camino
-- entró una reserva: `lucy_directorio` (el paciente reservó desde el
-- directorio) o `manual` (el médico la cargó desde su panel). Por eso el campo
-- se llama `canal_primera_cita` y jamás `acquisition_source`.
--
-- De ahí NO se puede deducir que el paciente venga de Google, de un referido,
-- de una campaña ni de ningún otro canal comercial: esa evidencia hoy no
-- existe en el sistema. `acquisition_source` queda RESERVADO para cuando la
-- haya —UTM, referral, campaña o captura administrativa explícita—, y se
-- agregará como columna propia, no reinterpretando este campo.
--
-- ── ORDEN DE OPERACIONES DEL LISTADO ──
--   universo + búsqueda → agregados y estado derivado → FILTRO por estado
--   → TOTAL del conjunto filtrado → PAGINACIÓN
--
-- El estado es DERIVADO: no se puede filtrar por él antes de calcularlo, y no
-- se puede calcular sin los agregados. Filtrar después de paginar —como hacía
-- la primera versión— rompe el `total`, esconde coincidencias que caían fuera
-- de la primera página y mutila la exportación.
--
-- ── PERFORMANCE ──
-- Sin filtro por estado, los agregados se calculan con LATERAL sobre la PÁGINA
-- (25, tope 50). Con filtro, sobre todo el universo elegible: es el costo de
-- que el filtro sea correcto. Cero N+1 en ambos casos: la UI hace UNA llamada
-- por pantalla, no una por fila.
--
-- ── ERRORES TIPADOS QUE AGREGA ESTA MIGRACIÓN ──
--   P0146 la exportación supera el tope de 5000 registros
--   P0147 filtro de estado fuera de la allowlist cerrada
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. Guardas PRE ─────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.patient_crm') IS NULL
     OR to_regclass('public.patient_crm_followups') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: falta la fundación de s7_76';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: is_admin() no existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.appointment_statuses WHERE name = 'atendida') THEN
    RAISE EXCEPTION 'PRE fallo: no existe el estado de cita "atendida"';
  END IF;
END $$;

-- ─── 1. QUIÉN ES UN PACIENTE LUCYCARE — el FROM raíz ────────
-- La raíz del CRM es la IDENTIDAD GLOBAL, no la ficha. Si la raíz fuera
-- `patients`, una cuenta LucyCare que todavía no agendó nunca —ni tiene ficha
-- local— sería INVISIBLE para el CRM. Medido en el esquema actual: 22 de 25
-- identidades de paciente tienen CERO fichas.
--
-- ⚠️ `role = 'patient'` NO alcanza como predicado. Medido:
--   · Un profile con `role='patient'` puede tener fila en `doctors`: el
--     approve con `reuse_patient` (s7_42) crea el médico sobre el profile del
--     paciente y NO toca `role`. Hoy hay 1 caso.
--   · Un profile con `role='patient'` puede ser `clinic_members` (asistente).
--     Hoy hay 1 caso.
--   · Las identidades TÉCNICAS del seed (s7_73) nacen con `role='patient'`
--     porque `handle_new_user` las crea así.
--
-- Por eso la elegibilidad se define UNA sola vez, acá, y las tres RPCs la
-- consumen. Sin esta vista, el predicado se duplicaría en tres consultas y
-- divergiría al primer cambio.
-- ⚠️ P1.1 · UNA IDENTIDAD PUEDE SER MÁS DE UNA COSA.
-- «Tiene fila en doctors» NO implica «no es paciente». Un médico puede ser
-- además paciente de otro médico, y un asistente también. La evidencia FUERTE
-- de relación de paciente es tener una ficha `patients` vinculada.
--
-- Por eso hay dos clases de exclusión, y NO son simétricas:
--
--   DURAS (siempre fuera, tengan ficha o no):
--     · cuenta desactivada
--     · acceso administrativo LucyAdmin vigente
--     · identidad técnica del seed
--
--   BLANDAS (fuera solo si NO hay relación de paciente):
--     · ser médico
--     · ser staff de clínica
--     · ser dueño de clínica
-- ⚠️ F2 · LA VISTA DEVUELVE UNA SOLA COLUMNA: `profile_id`.
-- Su trabajo es decir QUIÉN pertenece al universo del CRM, no describirlo. Si
-- expusiera nombre, teléfono o correo sería un segundo lugar por donde sale
-- PII, y encima invisible: quien mirara la RPC no vería la fuente. Las
-- columnas de presentación se piden a `profiles` con un JOIN explícito, en la
-- allowlist de `_crm_patients_json`, que es el único lugar donde se decide qué
-- viaja al navegador.
--
-- Se usa DROP + CREATE, no CREATE OR REPLACE: reemplazar una vista no permite
-- cambiarle las columnas, así que una versión anterior con más columnas haría
-- fallar la migración en vez de corregirla.
DROP VIEW IF EXISTS public.crm_patient_identity;

CREATE VIEW public.crm_patient_identity AS
SELECT p.id AS profile_id
FROM public.profiles p
WHERE
  -- ── DURA 1 · cuentas desactivadas: no son base comercial ──
  p.is_active = true

  -- ── DURA 2 · acceso administrativo, por su fuente AUTORITATIVA ──
  -- `owner_admin` NO vive en `lucyadmin_access`: es `profiles.role='admin'`
  -- (así lo documenta s7_57). Los otros dos niveles sí viven en la tabla, y
  -- solo cuentan si el acceso está VIGENTE (`is_active`).
  -- No se depende de que un `operations_admin` sea casualmente `clinic_member`.
  AND p.role <> 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.lucyadmin_access la
    WHERE la.profile_id = p.id AND la.is_active = true
  )

  -- ── DURA 3 · identidad TÉCNICA del seed (s7_73) ──
  -- Dos evidencias, con COBERTURAS DISTINTAS. Conviene ser exacto, porque una
  -- de ellas se creyó más fuerte de lo que es (F1):
  --
  --   · `admin_seed_operations.seed_user_id` — DEFENSA ESTRUCTURAL. Cubre el
  --     100% de los seeds mientras la fila exista, sin depender del email.
  --
  --   · el email determinístico `@doctor-seed.invalid` (RFC 2606) — DEFENSA
  --     PARCIAL. La Edge Function crea el `auth.user` con ese correo y
  --     `handle_new_user` lo copia a `profiles.email`; PERO el paso 8.7 de
  --     `admin_create_seed_doctor` hace `email = coalesce(v_email, email)`, así
  --     que si el admin cargó un correo comercial en el formulario, el profile
  --     técnico deja de tener el `.invalid` y este predicado NO lo reconoce.
  --
  -- Consecuencia medida: durante la VENTANA DE CLEANUP B→C —la fila de
  -- `admin_seed_operations` ya se borró y el `auth.user` todavía existe— la
  -- cobertura es COMPLETA solo si el seed se creó SIN correo comercial. Con
  -- correo, esa ventana queda descubierta. No se documenta como garantía.
  -- Ver `docs/ANALISIS_PATIENT_CRM.md` §F1 para la evidencia y la alternativa.
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_seed_operations so WHERE so.seed_user_id = p.id
  )
  AND coalesce(p.email, '') NOT LIKE '%@doctor-seed.invalid'

  -- ── BLANDAS · solo excluyen si NO hay relación real de paciente ──
  AND (
    EXISTS (SELECT 1 FROM public.patients pa WHERE pa.profile_id = p.id)
    OR (
      p.role = 'patient'
      AND NOT EXISTS (SELECT 1 FROM public.doctors d        WHERE d.profile_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.clinic_members cm WHERE cm.profile_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.clinics c         WHERE c.owner_id  = p.id)
    )
  );

COMMENT ON VIEW public.crm_patient_identity IS
  'PATIENT-CRM-P0. Predicado CANÓNICO de identidad global de paciente LucyCare. Devuelve UNA sola columna, profile_id: dice quién pertenece al universo del CRM, no lo describe — el nombre, el teléfono y el correo se piden a profiles con un JOIN explícito dentro de _crm_patients_json. Exclusiones DURAS: cuenta desactivada, acceso administrativo LucyAdmin vigente (profiles.role=admin o lucyadmin_access activo) e identidad técnica del seed. Exclusiones BLANDAS (solo sin ficha patients): médico, staff y dueño de clínica — un médico que además es paciente SÍ entra. Es el FROM raíz de todas las lecturas del CRM.';

-- Sin grants: solo la leen las RPCs SECURITY DEFINER, que corren como owner.
REVOKE ALL ON public.crm_patient_identity FROM PUBLIC;
REVOKE ALL ON public.crm_patient_identity FROM anon;
REVOKE ALL ON public.crm_patient_identity FROM authenticated;
REVOKE ALL ON public.crm_patient_identity FROM service_role;

-- Defensa adicional: con `security_invoker`, la vista evalúa los permisos de
-- las tablas subyacentes contra el usuario ACTUAL en vez de contra su dueño.
-- Dentro de las RPCs `SECURITY DEFINER` el usuario actual ES el owner, así que
-- el comportamiento no cambia; lo que cambia es que la vista deja de ser un
-- posible atajo de privilegios si alguien le concediera SELECT por error.
-- Requiere PostgreSQL 15+: en versiones anteriores la opción no existe y el
-- `ALTER` fallaría, así que se aplica solo si el servidor la soporta.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW public.crm_patient_identity SET (security_invoker = true)';
    RAISE NOTICE 's7_77: crm_patient_identity con security_invoker = true';
  ELSE
    RAISE NOTICE 's7_77: PostgreSQL % no soporta security_invoker; la vista queda con los permisos de su dueño (sigue sin grants para clientes)',
      current_setting('server_version');
  END IF;
END $$;

-- ─── 2. Umbrales, en un solo lugar ──────────────────────────
-- ⚠️ `p_ahora` se pasa como ARGUMENTO, no se lee con `now()` adentro.
-- Una función IMMUTABLE que consulta el reloj es una mentira al planificador:
-- PostgreSQL puede cachear su resultado, plegarla en tiempo de planificación o
-- usarla en un índice, y devolvería estados congelados. Con la fecha de
-- referencia explícita, la función es genuinamente inmutable y además
-- comprobable: la misma entrada da siempre la misma salida.
CREATE OR REPLACE FUNCTION public._crm_estado(
  p_bloqueado        boolean,
  p_followups_open   int,
  p_atendidas        int,
  p_creado           timestamptz,
  p_proxima_cita     timestamptz,
  p_ultima_actividad timestamptz,
  p_ahora            timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_bloqueado                                       THEN 'bloqueado'
    WHEN coalesce(p_followups_open, 0) > 0                 THEN 'en_seguimiento'
    WHEN coalesce(p_atendidas, 0) >= 2                     THEN 'recurrente'
    WHEN p_creado >= p_ahora - interval '30 days'           THEN 'nuevo'
    WHEN p_proxima_cita IS NOT NULL                        THEN 'activo'
    WHEN p_ultima_actividad >= p_ahora - interval '90 days' THEN 'activo'
    WHEN p_ultima_actividad IS NULL
      OR p_ultima_actividad < p_ahora - interval '180 days' THEN 'inactivo'
    ELSE 'activo'
  END;
$$;

REVOKE ALL ON FUNCTION public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz) FROM authenticated;
REVOKE ALL ON FUNCTION public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz) FROM service_role;

-- ─── 3. ALLOWLIST CERRADA DEL FILTRO POR ESTADO ─────────────
-- `p_status` llega del navegador. Los estados son un conjunto CERRADO (D2), así
-- que se validan server-side ANTES de consultar y ANTES de auditar: un valor
-- arbitrario —o PII pegada por error en el buscador de estado— no debe llegar
-- ni a la consulta ni a `audit_log`.
--
-- ⚠️ El mensaje de error NO interpola el valor recibido. Si lo hiciera, un
-- `p_status` con datos personales terminaría en el texto de la excepción y de
-- ahí en los logs. Se rechaza sin repetir lo que llegó.
CREATE OR REPLACE FUNCTION public._crm_status_norm(p_status text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v text;
BEGIN
  v := nullif(btrim(lower(coalesce(p_status, ''))), '');
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  IF v NOT IN ('nuevo', 'activo', 'en_seguimiento', 'recurrente',
               'inactivo', 'bloqueado') THEN
    RAISE EXCEPTION 'Filtro de estado no válido' USING ERRCODE = 'P0147';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_status_norm(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._crm_status_norm(text) FROM anon;
REVOKE ALL ON FUNCTION public._crm_status_norm(text) FROM authenticated;
REVOKE ALL ON FUNCTION public._crm_status_norm(text) FROM service_role;

-- ─── 4. NÚCLEO COMPARTIDO — una sola allowlist ──────────────
-- P5: la exportación NO construye una consulta paralela. Listado y export
-- llaman a ESTA función, así que la allowlist de columnas y el predicado de
-- identidad viven en un único lugar y no pueden divergir. Si mañana alguien
-- agregara una columna clínica acá, la agregaría a los dos caminos a la vez —
-- y el check estático lo bloquearía antes.
--
-- ═══ ORDEN DE OPERACIONES — LA PARTE QUE IMPORTA ═══
--
--   universo + búsqueda  →  agregados y estado derivado  →  FILTRO por estado
--   →  TOTAL del conjunto filtrado  →  PAGINACIÓN
--
-- La versión anterior filtraba DESPUÉS de paginar, y eso estaba mal de tres
-- maneras a la vez:
--   · `total` contaba el universo sin filtrar, así que el paginador mentía;
--   · un `recurrente` que caía en la posición 26 del orden general no aparecía
--     NUNCA en el filtro `recurrente`, porque el recorte ya lo había dejado
--     fuera antes de saber su estado;
--   · la exportación heredaba el mismo defecto: recorría las primeras N filas
--     sin filtrar y recién ahí filtraba, en vez de exportar el conjunto
--     filtrado completo.
--
-- El estado es DERIVADO (D2): no se puede filtrar por él sin haberlo calculado,
-- y no se puede calcular sin los agregados. Por eso, cuando hay filtro, los
-- agregados se calculan sobre todo el universo elegible y no sobre una página.
--
-- ⚠️ RUTA RÁPIDA, con la MISMA semántica. Cuando `p_status IS NULL` el filtro
-- es un no-op: recortar antes de agregar da EXACTAMENTE el mismo resultado que
-- recortar después, así que ahí sí se pagina primero y los `LATERAL` vuelven a
-- tocar solo 25-50 filas. Las dos rutas viven en la MISMA consulta —un `CASE`
-- en el `LIMIT`—, no en dos consultas que podrían divergir.
--
-- Costo asumido: con filtro por estado se enriquece todo el universo elegible.
-- Al volumen actual es despreciable. Si algún día pesa, se resuelve con una
-- vista materializada de estados, no volviendo a filtrar después de paginar.
--
-- Privada: sin gate propio (lo ponen los wrappers públicos) y sin grants.
CREATE OR REPLACE FUNCTION public._crm_patients_json(
  p_search text,
  p_status text,
  p_limit  int,
  p_offset int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_limit  int;
  v_offset int;
  v_q      text;
  v_status text;
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  v_limit  := greatest(coalesce(p_limit, 25), 1);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_q      := nullif(btrim(coalesce(p_search, '')), '');
  -- Defensa en profundidad: los wrappers públicos ya validaron, pero el núcleo
  -- no confía en su llamador. Normaliza o lanza P0147.
  v_status := public._crm_status_norm(p_status);

  -- FROM raíz: la IDENTIDAD GLOBAL elegible (ver la vista de arriba), NUNCA
  -- `patients`. Un paciente con 0 fichas y 0 citas SÍ aparece: es una cuenta
  -- LucyCare real que todavía no agendó, y el CRM existe justamente para eso.
  -- Las fichas sin `profile_id` NO entran acá; van a la bandeja de
  -- "Pendientes de identificar" (D1/D5), y sus conteos NO se suman.
  --
  -- F2 · la vista dice QUIÉNES son; `profiles` dice CÓMO se llaman. El JOIN es
  -- explícito y las columnas se nombran una a una: acá se ve, en una sola
  -- pantalla, todo lo que puede salir del sistema.
  WITH base AS (
    SELECT p.id, p.full_name, p.phone, p.email, p.created_at
    FROM public.crm_patient_identity ci
    JOIN public.profiles p ON p.id = ci.profile_id
    WHERE (v_q IS NULL
           OR p.full_name ILIKE '%' || v_q || '%'
           OR p.phone     ILIKE '%' || v_q || '%'
           OR p.email     ILIKE '%' || v_q || '%'
           OR p.id::text = v_q)
  ),
  -- PASO 1 · qué filas hay que enriquecer.
  --   sin filtro  → solo la página (LATERAL sobre 25-50 filas)
  --   con filtro  → todo el universo elegible, porque el estado es derivado y
  --                 hace falta calcularlo para poder filtrar por él
  -- `LIMIT NULL` en PostgreSQL significa "sin límite".
  candidatos AS (
    SELECT b.*
    FROM base b
    ORDER BY b.created_at DESC, b.id
    LIMIT  CASE WHEN v_status IS NULL THEN v_limit  ELSE NULL END
    OFFSET CASE WHEN v_status IS NULL THEN v_offset ELSE 0    END
  ),
  -- PASO 2 · agregados por paciente, con LATERAL.
  enriquecida AS (
    SELECT
      q.id, q.full_name, q.phone, q.email, q.created_at,
      crm.blocked_at, crm.unblocked_at, crm.blocked_reason,
      ag.fichas, ag.clinicas, ag.medicos, ag.citas_total,
      ag.atendidas, ag.ultima_actividad, ag.proxima_cita, ag.canal_primera_cita,
      fu.abiertos,
      tg.tags
    FROM candidatos q
    LEFT JOIN public.patient_crm crm ON crm.profile_id = q.id
    LEFT JOIN LATERAL (
      SELECT
        count(DISTINCT pa.id)                                        AS fichas,
        count(DISTINCT pa.clinic_id)                                 AS clinicas,
        count(DISTINCT ap.doctor_id)                                 AS medicos,
        count(ap.id)                                                 AS citas_total,
        count(ap.id) FILTER (WHERE st.name = 'atendida')             AS atendidas,
        max(ap.start_time) FILTER (WHERE ap.start_time <= now())     AS ultima_actividad,
        min(ap.start_time) FILTER (WHERE ap.start_time >  now()
                                     AND st.is_final = false)        AS proxima_cita,
        -- Canal de la PRIMERA CITA. NO es origen de adquisición: solo dice por
        -- dónde entró esa reserva. Ver la nota de semántica en la cabecera.
        (array_agg(ap.source ORDER BY ap.start_time))[1]::text       AS canal_primera_cita
      FROM public.patients pa
      LEFT JOIN public.appointments ap ON ap.patient_id = pa.id
      LEFT JOIN public.appointment_statuses st ON st.id = ap.status_id
      WHERE pa.profile_id = q.id
    ) ag ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS abiertos
      FROM public.patient_crm_followups f
      WHERE f.profile_id = q.id AND f.status = 'abierto'
    ) fu ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(t.tag ORDER BY t.tag) AS tags
      FROM public.patient_crm_tags t
      WHERE t.profile_id = q.id
    ) tg ON true
  ),
  -- PASO 3 · el estado derivado, calculado UNA sola vez por fila.
  calificada AS (
    SELECT e.*,
           public._crm_estado(
             (e.blocked_at IS NOT NULL AND e.unblocked_at IS NULL),
             e.abiertos, e.atendidas::int,
             e.created_at, e.proxima_cita, e.ultima_actividad,
             now()) AS crm_status
    FROM enriquecida e
  ),
  -- PASO 4 · FILTRO. Antes de contar y antes de paginar.
  filtrada AS (
    SELECT c.* FROM calificada c
    WHERE v_status IS NULL OR c.crm_status = v_status
  ),
  -- PASO 5 · PAGINACIÓN, sobre el conjunto ya filtrado.
  -- Sin filtro la página ya se recortó en `candidatos`, así que acá no se
  -- vuelve a recortar: el resultado es idéntico por ambas rutas.
  pagina AS (
    SELECT f.* FROM filtrada f
    ORDER BY f.created_at DESC, f.id
    LIMIT  CASE WHEN v_status IS NULL THEN NULL ELSE v_limit  END
    OFFSET CASE WHEN v_status IS NULL THEN 0    ELSE v_offset END
  )
  -- ⚠️ ALLOWLIST EXPLÍCITA. Cada clave se nombra a mano: ninguna columna
  -- clínica puede colarse por un `SELECT *`.
  SELECT
    -- TOTAL DEL CONJUNTO FILTRADO. Sin filtro, `filtrada` contiene solo la
    -- página, así que el total sale de `base`; con filtro, de `filtrada`.
    -- Las dos ramas devuelven el mismo número: el tamaño del conjunto que el
    -- usuario está paginando.
    CASE WHEN v_status IS NULL
         THEN (SELECT count(*) FROM base)
         ELSE (SELECT count(*) FROM filtrada) END,
    coalesce(jsonb_agg(jsonb_build_object(
      'profile_id',       pg.id,
      'full_name',        pg.full_name,
      'phone',            pg.phone,
      'email',            pg.email,
      'created_at',       pg.created_at,
      'crm_status',       pg.crm_status,
      'blocked',          (pg.blocked_at IS NOT NULL AND pg.unblocked_at IS NULL),
      -- ⚠️ CANAL DE LA PRIMERA CITA, no origen de adquisición. Dice por dónde
      -- entró esa reserva; no dice cómo la persona conoció LucyCare.
      'canal_primera_cita', CASE pg.canal_primera_cita
                            WHEN 'lucy_directorio' THEN 'Directorio LucyCare'
                            WHEN 'manual'          THEN 'Alta del médico'
                            ELSE NULL END,
      'fichas',           coalesce(pg.fichas, 0),
      'clinicas',         coalesce(pg.clinicas, 0),
      'medicos',          coalesce(pg.medicos, 0),
      'citas_total',      coalesce(pg.citas_total, 0),
      'atendidas',        coalesce(pg.atendidas, 0),
      'ultima_actividad', pg.ultima_actividad,
      'proxima_cita',     pg.proxima_cita,
      'followups_abiertos', coalesce(pg.abiertos, 0),
      'tags',             coalesce(to_jsonb(pg.tags), '[]'::jsonb)
    ) ORDER BY pg.created_at DESC, pg.id), '[]'::jsonb)
  INTO v_total, v_rows
  FROM pagina pg;

  RETURN jsonb_build_object(
    'total',  v_total,
    'limit',  v_limit,
    'offset', v_offset,
    'rows',   v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public._crm_patients_json(text,text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._crm_patients_json(text,text,int,int) FROM anon;
REVOKE ALL ON FUNCTION public._crm_patients_json(text,text,int,int) FROM authenticated;
REVOKE ALL ON FUNCTION public._crm_patients_json(text,text,int,int) FROM service_role;

-- ─── 5. Listado paginado — wrapper delgado ──────────────────
CREATE OR REPLACE FUNCTION public.admin_list_patients_crm(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit  int  DEFAULT 25,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;
  -- Allowlist cerrada, ANTES de consultar. Un valor arbitrario se rechaza acá
  -- con P0147 y nunca llega al núcleo.
  v_status := public._crm_status_norm(p_status);
  -- Tope duro de la PANTALLA: 25 o 50, jamás "todos". Exportar tiene su
  -- propio tope, mucho mayor, y su propia auditoría.
  RETURN public._crm_patients_json(
    p_search, v_status,
    least(greatest(coalesce(p_limit, 25), 1), 50),
    p_offset);
END;
$$;

-- ─── 6. Exportación (P5) ────────────────────────────────────
-- Exporta el CONJUNTO FILTRADO COMPLETO, no la página visible. Reusa el mismo
-- núcleo, así que hereda el universo canónico, la búsqueda, el filtro, el
-- orden y la allowlist.
--
-- ⚠️ NO es STABLE: escribe la fila de auditoría. Exportar PII es una ACCIÓN
-- administrativa, no una lectura más, y queda registrada como tal.
--
-- ⚠️ El audit NO copia PII: guarda el actor, el momento, el formato, cuántos
-- registros salieron, si había búsqueda (booleano, NO el texto — un admin puede
-- buscar por teléfono o por nombre) y qué filtro de estado se aplicó.
CREATE OR REPLACE FUNCTION public.admin_export_patients_crm(
  p_search  text DEFAULT NULL,
  p_status  text DEFAULT NULL,
  p_formato text DEFAULT 'csv'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Tope técnico. Por encima de esto, exportar en una sola respuesta JSON deja
  -- de ser razonable: se propone acotar el filtro. Subirlo exige rediseñar el
  -- mecanismo (streaming o generación asíncrona), no cambiar esta constante.
  MAX_EXPORT constant int := 5000;
  v_payload jsonb;
  v_total   bigint;
  v_n       int;
  v_status  text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;
  -- ⚠️ ORDEN: validar ANTES de consultar y ANTES de auditar. Lo que se registra
  -- en `audit_log` es SIEMPRE el valor normalizado o NULL, nunca lo que llegó.
  -- Un `p_status` arbitrario —o con datos personales pegados por error— muere
  -- acá con P0147, sin tocar la base y sin dejar rastro en la auditoría.
  v_status := public._crm_status_norm(p_status);
  -- P0 exporta CSV y NADA MÁS (decisión del owner). Aceptar 'xlsx' acá sería
  -- peor que inútil: el frontend genera CSV igual, así que la auditoría
  -- guardaría un formato que nunca se produjo. Cuando exista el .xlsx real, se
  -- amplía esta lista en la misma migración que lo implemente.
  IF coalesce(p_formato, '') <> 'csv' THEN
    RAISE EXCEPTION 'Formato de exportación no soportado' USING ERRCODE = 'P0142';
  END IF;

  -- Se pide UNA fila más que el tope para distinguir "justo el tope" de
  -- "se pasó", sin contar dos veces.
  v_payload := public._crm_patients_json(p_search, v_status, MAX_EXPORT + 1, 0);
  v_total   := (v_payload->>'total')::bigint;
  v_n       := jsonb_array_length(v_payload->'rows');

  IF v_n > MAX_EXPORT THEN
    RAISE EXCEPTION
      'La exportación supera el límite de % registros (hay %). Afina la búsqueda o el filtro.',
      MAX_EXPORT, v_total
      USING ERRCODE = 'P0146';
  END IF;

  -- Evidencia de la acción. `audit_log` es inmutable desde s7_71b.
  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'select'::public.audit_action, 'patient_crm_export', NULL, NULL,
    jsonb_build_object(
      'edited_via',    'crm',
      'accion',        'export_base_pacientes',
      'formato',       p_formato,
      'registros',     v_n,
      -- Contexto SIN PII: si hubo búsqueda, no QUÉ se buscó.
      'con_busqueda',  (nullif(btrim(coalesce(p_search, '')), '') IS NOT NULL),
      -- Estado ya NORMALIZADO y validado contra la allowlist cerrada: o uno de
      -- los seis, o NULL. Nunca texto libre del cliente.
      'filtro_estado', v_status,
      'exportado_at',  now()
    )
  );

  RETURN v_payload || jsonb_build_object('exportado', true, 'formato', p_formato);
END;
$$;

-- ─── 7. Pendientes de identificar (D5) ──────────────────────
-- Fichas locales SIN identidad global. Se muestran APARTE y su conteo NUNCA
-- se suma al de pacientes: no son pacientes comerciales todavía.
CREATE OR REPLACE FUNCTION public.admin_list_unlinked_patients(
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 25,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_limit int; v_offset int; v_q text; v_total bigint; v_rows jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;

  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_q      := nullif(btrim(coalesce(p_search, '')), '');

  WITH base AS (
    SELECT pa.id, pa.full_name, pa.phone, pa.email, pa.clinic_id, pa.created_at
    FROM public.patients pa
    WHERE pa.profile_id IS NULL
      AND pa.is_active = true
      AND pa.merged_into_patient_id IS NULL
      AND (v_q IS NULL
           OR pa.full_name ILIKE '%' || v_q || '%'
           OR pa.phone     ILIKE '%' || v_q || '%'
           OR pa.email     ILIKE '%' || v_q || '%'
           OR pa.id::text = v_q)
  ),
  pagina AS (
    SELECT b.* FROM base b ORDER BY b.created_at DESC, b.id
    LIMIT v_limit OFFSET v_offset
  )
  -- ⚠️ ALLOWLIST: ni allergies, ni blood_type, ni notes, ni contacto de
  -- emergencia. Solo lo necesario para identificar y vincular.
  SELECT
    (SELECT count(*) FROM base),
    coalesce(jsonb_agg(jsonb_build_object(
      'patient_id', pg.id,
      'full_name',  pg.full_name,
      'phone',      pg.phone,
      'email',      pg.email,
      'clinic_id',  pg.clinic_id,
      'clinic_name', c.name,
      'created_at', pg.created_at,
      'citas_total', coalesce(ag.citas, 0),
      'ultima_actividad', ag.ultima
    ) ORDER BY pg.created_at DESC, pg.id), '[]'::jsonb)
  INTO v_total, v_rows
  FROM pagina pg
  LEFT JOIN public.clinics c ON c.id = pg.clinic_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS citas, max(start_time) AS ultima
    FROM public.appointments a WHERE a.patient_id = pg.id
  ) ag ON true;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;

-- ─── 8. Métricas superiores ─────────────────────────────────
-- Consulta aparte: son conteos que no cambian por segundo, así que la UI los
-- cachea con staleTime alto en vez de recalcularlos con cada tecla del
-- buscador.
CREATE OR REPLACE FUNCTION public.admin_patients_crm_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;

  -- Mismo predicado canónico que el listado: los totales y la lista no pueden
  -- discrepar. Por eso ambos leen la MISMA vista.
  WITH ident AS (
    SELECT ci.profile_id AS id, p.created_at,
           (crm.blocked_at IS NOT NULL AND crm.unblocked_at IS NULL) AS bloqueado
    FROM public.crm_patient_identity ci
    JOIN public.profiles p ON p.id = ci.profile_id
    LEFT JOIN public.patient_crm crm ON crm.profile_id = ci.profile_id
  ),
  act AS (
    SELECT pa.profile_id,
           max(ap.start_time) FILTER (WHERE ap.start_time <= now()) AS ultima,
           min(ap.start_time) FILTER (WHERE ap.start_time >  now()
                                       AND st.is_final = false)     AS proxima
    FROM public.patients pa
    JOIN public.appointments ap ON ap.patient_id = pa.id
    LEFT JOIN public.appointment_statuses st ON st.id = ap.status_id
    WHERE pa.profile_id IS NOT NULL
    GROUP BY pa.profile_id
  )
  SELECT jsonb_build_object(
    'pacientes_totales',   (SELECT count(*) FROM ident),
    'nuevos_30d',          (SELECT count(*) FROM ident WHERE created_at >= now() - interval '30 days'),
    'activos',             (SELECT count(*) FROM ident i JOIN act a ON a.profile_id = i.id
                             WHERE a.proxima IS NOT NULL OR a.ultima >= now() - interval '90 days'),
    -- ⚠️ Se cuenta DENTRO del universo canónico, igual que las demás. `act`
    -- sola incluiría fichas de identidades excluidas —un admin con ficha, por
    -- ejemplo— y esta métrica podría superar a `pacientes_totales`.
    'con_proxima_cita',    (SELECT count(*) FROM ident i JOIN act a ON a.profile_id = i.id
                             WHERE a.proxima IS NOT NULL),
    'sin_actividad_180d',  (SELECT count(*) FROM ident i LEFT JOIN act a ON a.profile_id = i.id
                             WHERE a.proxima IS NULL
                               AND (a.ultima IS NULL OR a.ultima < now() - interval '180 days')),
    'bloqueados',          (SELECT count(*) FROM ident WHERE bloqueado),
    -- Se reporta APARTE y NO se suma a `pacientes_totales` (D1).
    'pendientes_identificar', (SELECT count(*) FROM public.patients
                                WHERE profile_id IS NULL AND is_active = true
                                  AND merged_into_patient_id IS NULL)
  ) INTO v;

  RETURN v;
END;
$$;

-- ─── 9. Grants ──────────────────────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.admin_list_patients_crm(text,text,int,int)',
    'public.admin_list_unlinked_patients(text,int,int)',
    'public.admin_patients_crm_stats()',
    'public.admin_export_patients_crm(text,text,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ─── 10. Guardas POST ───────────────────────────────────────
DO $$
DECLARE
  fn text;
  v_oid oid;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.admin_list_patients_crm(text,text,int,int)',
    'public.admin_list_unlinked_patients(text,int,int)',
    'public.admin_patients_crm_stats()'
  ] LOOP
    v_oid := to_regprocedure(fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'POST fallo: no se creó %', fn;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'POST fallo: % no es SECURITY DEFINER', fn;
    END IF;
    IF (SELECT array_to_string(proconfig, ', ') FROM pg_proc WHERE oid = v_oid)
       IS DISTINCT FROM 'search_path=public, pg_catalog' THEN
      RAISE EXCEPTION 'POST fallo: search_path inesperado en %', fn;
    END IF;
    -- STABLE: son de solo lectura. Si alguna quedara VOLATILE, alguien le
    -- agregó escritura.
    IF (SELECT provolatile FROM pg_proc WHERE oid = v_oid) <> 's' THEN
      RAISE EXCEPTION 'POST fallo: % debería ser STABLE (solo lectura)', fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POST fallo: authenticated no puede ejecutar %', fn;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POST fallo: anon puede ejecutar %', fn;
    END IF;
  END LOOP;

  -- El helper de estados queda PRIVADO, y con la firma de SIETE argumentos:
  -- la de seis leía el reloj adentro siendo IMMUTABLE.
  v_oid := to_regprocedure('public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST fallo: _crm_estado no tiene la firma con p_ahora';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE')
  OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST fallo: _crm_estado quedó accesible';
  END IF;
  -- IMMUTABLE de verdad: sin esto, el planificador podría cachear o plegar un
  -- resultado que depende del tiempo.
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_oid) <> 'i' THEN
    RAISE EXCEPTION 'POST fallo: _crm_estado debería ser IMMUTABLE';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) ~* '\m(now\(\)|current_date|current_timestamp|clock_timestamp|localtimestamp|transaction_timestamp|statement_timestamp)' THEN
    RAISE EXCEPTION 'POST fallo: _crm_estado es IMMUTABLE pero lee el reloj';
  END IF;

  -- El núcleo compartido es PRIVADO: si un cliente pudiera llamarlo, se
  -- saltaría el gate `is_admin()` de los wrappers.
  v_oid := to_regprocedure('public._crm_patients_json(text,text,int,int)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta el núcleo _crm_patients_json';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE')
  OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST fallo: _crm_patients_json quedó accesible sin gate';
  END IF;

  -- El validador del filtro existe, es privado y NO repite el valor recibido.
  v_oid := to_regprocedure('public._crm_status_norm(text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta _crm_status_norm';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) NOT LIKE '%P0147%' THEN
    RAISE EXCEPTION 'POST fallo: _crm_status_norm no rechaza con P0147';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) LIKE '%RAISE EXCEPTION%%%p_status%' THEN
    RAISE EXCEPTION 'POST fallo: el error de estado repite el valor recibido';
  END IF;

  -- ═══ MÍNIMO PRIVILEGIO EN LOS OBJETOS PRIVADOS ═══
  -- La vista y los tres helpers no los llama NADIE salvo las RPCs
  -- SECURITY DEFINER, que corren como owner. Ningún rol de Supabase —tampoco
  -- `service_role`— debe poder alcanzarlos: hacerlo saltaría el gate
  -- `is_admin()`. Los grants por defecto del esquema `public` sí incluyen a
  -- `service_role`, así que la migración los revoca explícitamente.
  FOREACH fn IN ARRAY ARRAY[
    'public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz)',
    'public._crm_patients_json(text,text,int,int)',
    'public._crm_status_norm(text)'
  ] LOOP
    v_oid := to_regprocedure(fn);
    IF has_function_privilege('service_role', v_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
    OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POST fallo: % sigue alcanzable por un rol de cliente', fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = v_oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'POST fallo: % conserva EXECUTE para PUBLIC', fn;
    END IF;
  END LOOP;

  IF has_table_privilege('service_role', 'public.crm_patient_identity', 'SELECT') THEN
    RAISE EXCEPTION 'POST fallo: service_role puede leer la vista canónica';
  END IF;

  -- La exportación: gateada, auditada y VOLATILE a propósito.
  v_oid := to_regprocedure('public.admin_export_patients_crm(text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta admin_export_patients_crm';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'POST fallo: la exportación no es SECURITY DEFINER';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_oid) <> 'v' THEN
    RAISE EXCEPTION 'POST fallo: la exportación debe ser VOLATILE (escribe auditoría)';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
  OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST fallo: EXECUTE incorrecto en la exportación';
  END IF;
  -- Listado y exportación comparten el MISMO núcleo: si alguno construyera su
  -- propia consulta, podría ampliar las columnas sin que nadie lo note.
  IF (SELECT count(*) FROM pg_proc
       WHERE oid IN (to_regprocedure('public.admin_list_patients_crm(text,text,int,int)'),
                     to_regprocedure('public.admin_export_patients_crm(text,text,text)'))
         AND prosrc LIKE '%_crm_patients_json%') <> 2 THEN
    RAISE EXCEPTION 'POST fallo: listado y exportación no comparten el núcleo';
  END IF;

  -- La vista canónica existe y NO es accesible por ningún rol de cliente.
  IF to_regclass('public.crm_patient_identity') IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta la vista crm_patient_identity';
  END IF;
  IF has_table_privilege('authenticated', 'public.crm_patient_identity', 'SELECT')
  OR has_table_privilege('anon', 'public.crm_patient_identity', 'SELECT') THEN
    RAISE EXCEPTION 'POST fallo: crm_patient_identity quedó legible por un cliente';
  END IF;

  -- F2 · MÍNIMA POR CONSTRUCCIÓN. La vista define pertenencia; no describe a
  -- nadie. Una columna, y que sea `profile_id`: si alguien le agrega nombre,
  -- teléfono o correo, la migración no se aplica.
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.crm_patient_identity'::regclass
         AND attnum > 0 AND NOT attisdropped) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.crm_patient_identity'::regclass
         AND attnum > 0 AND NOT attisdropped AND attname = 'profile_id') THEN
    RAISE EXCEPTION 'POST fallo: crm_patient_identity debe exponer SOLO profile_id';
  END IF;

  -- Todo lo que lista pacientes lee la MISMA definición de identidad: el
  -- núcleo compartido (del que cuelgan listado y exportación) y las métricas.
  -- Si alguno se saltara la vista, la lista y los totales podrían discrepar.
  IF (SELECT count(*) FROM pg_proc
       WHERE oid IN (to_regprocedure('public._crm_patients_json(text,text,int,int)'),
                     to_regprocedure('public.admin_patients_crm_stats()'))
         AND prosrc LIKE '%crm_patient_identity%') <> 2 THEN
    RAISE EXCEPTION 'POST fallo: alguna consulta no usa el predicado canónico';
  END IF;

  -- ═══ ORDEN DE OPERACIONES: filtro → conteo → paginación ═══
  -- Es la corrección central de esta versión. Se verifica sobre el TEXTO de la
  -- función porque el defecto anterior era estructural: el filtro estaba
  -- después del recorte.
  DECLARE
    v_src text := (SELECT prosrc FROM pg_proc
                    WHERE oid = to_regprocedure('public._crm_patients_json(text,text,int,int)'));
  BEGIN
    IF position('filtrada' in v_src) = 0 OR position('calificada' in v_src) = 0 THEN
      RAISE EXCEPTION 'POST fallo: falta la etapa de filtrado previa a la paginación';
    END IF;
    -- El filtro por estado tiene que aparecer ANTES de la página final.
    IF position('WHERE v_status IS NULL OR' in v_src) = 0
       OR position('WHERE v_status IS NULL OR' in v_src) > position('pagina AS (' in v_src) THEN
      RAISE EXCEPTION 'POST fallo: el filtro por estado no precede a la paginación';
    END IF;
    -- El total sale del conjunto FILTRADO cuando hay filtro.
    IF position('ELSE (SELECT count(*) FROM filtrada) END' in v_src) = 0 THEN
      RAISE EXCEPTION 'POST fallo: el total no se calcula sobre el conjunto filtrado';
    END IF;
    -- Y el defecto viejo —filtrar el JSON ya paginado— no puede volver.
    IF v_src LIKE '%jsonb_array_elements(v_rows)%' THEN
      RAISE EXCEPTION 'POST fallo: se volvió a filtrar DESPUÉS de paginar';
    END IF;
  END;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Rollback: docs/rollbacks/s7_77_rollback.sql
-- ═══════════════════════════════════════════════════════════
