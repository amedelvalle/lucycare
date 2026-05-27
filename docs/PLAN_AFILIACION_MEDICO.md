# Plan operativo — Solicitar afiliación médica

> Plan de implementación del flujo de afiliación, basado en
> `docs/ANALISIS_AFILIACION_MEDICO.md` y las respuestas cerradas Q1-Q10
> + la aclaración Lectura A (mínimo absoluto = nombre + phone + LOPD).
>
> **Snapshot 2026-05-26.**
>
> Estructura: 2 fases. Cada fase = 1 PR independiente.

---

## 0. Resumen ejecutivo de decisiones (cerradas por owner)

| Q | Decisión | Impacto en código |
|---|---|---|
| **Q1** | `DoctorRegistrationModal` legacy: mantener `@deprecated`, no reactivar | Ya hecho en PR #53 |
| **Q2** | License/JVPM **obligatoria en intención**, **no bloqueante en submit** (Lectura A) | Form valida `name + phone + LOPD`. License es campo prominente; si vacía, lead entra con flag `incomplete=true` |
| **Q3** | Comunicación al médico: **manual** por WhatsApp/email del admin | Sin emails automáticos al lead |
| **Q4** | No perder lead: mínimo absoluto = nombre + phone | Submit acepta con solo esos 3 (name+phone+LOPD) |
| **Q5** | Al aprobar: **auto-crear** `clinics` row básica | RPC de Fase 2 hace `INSERT clinics ... name = COALESCE(lead.clinic_name, 'Consultorio Dr. X')` |
| **Q6** | Sin portal de tracking para el médico | Pantalla post-submit muestra solo "Recibimos tu solicitud, te contactaremos" |
| **Q7** | Rate limit: UNIQUE + 1 IP/24h | UNIQUE parcial por phone normalizado. RPC chequea IP via `request.headers` |
| **Q8** | Consentimiento LOPD: obligatorio | Checkbox + link a `/privacidad`. Persistido en `consent_accepted_at` + `consent_version` |
| **Q9** | Permisos `/admin/afiliaciones`: solo `is_admin()` | RPCs admin con gate `is_admin()` y RLS estricto |
| **Q10** | Dos fases: **Fase 1 pre-piloto** (form + tabla + bandeja admin sin crear doctor) + **Fase 2 posterior** (admin aprueba → crea doctor en listed_only) | Ver §2 y §3 |

## 1. Principios de diseño

1. **Cero auto-creación de doctores** en Fase 1. Solo capturamos leads.
2. **Cero auto-comunicación** al médico (sin emails ni SMS al lead).
3. **Reutilizar el flujo de Reclamar perfil** (PR #32 + PR #50) para el path final del médico aprobado. Cero código nuevo de claim.
4. **Auditar todo** en `audit_log` (cambios de status, aprobaciones, rechazos).
5. **RLS estricto**: solo `service_role` + `is_admin()` leen `doctor_affiliation_requests`. Anon solo INSERT vía RPC.
6. **Defensivo contra spam**: rate limit + UNIQUE + (futuro) hCaptcha.
7. **Conservar el lead** mientras esté activo. Expiración por TTL queda como follow-up post-MVP.

## 2. Arquitectura por fases

### Fase 1 — Captura + triage (pre-piloto, este PR)

**Entrega:**
- Tabla `doctor_affiliation_requests` con todos los campos finales.
- RPC pública `submit_affiliation_request` (rate-limited).
- RPCs admin `admin_list_affiliation_requests`, `admin_mark_in_review`, `admin_reject_affiliation_request`, `admin_mark_approved_pending_creation` (status sin crear doctor).
- RLS.
- Frontend: reemplazo de `DoctorInterestModal` por `AffiliationRequestModal` con form completo. Pantalla éxito genérica.
- Admin UI `/admin/afiliaciones`: lista + filtros + detalle modal + acciones (rechazar / marcar revisión / marcar aprobado).
- Página `/privacidad` con política básica (texto plano editable después).
- Sin creación automática de `doctors`/`clinics`/`clinic_members` desde la aprobación.

**Resultado en Fase 1:**
- Lead `approved` en DB sirve como **señal interna** al admin: "este lead está validado, ahora hay que crear el médico manualmente vía `scripts/import-doctors.mjs` o equivalente, y avisar al médico por WhatsApp para que reclame".
- **No hay flujo automático lead→doctor todavía**. Eso es Fase 2.

### Fase 2 — Conversión lead→doctor (posterior, otro PR)

**Entrega:**
- RPC `admin_approve_and_create_doctor(p_request_id, p_admin_overrides jsonb)` que en una sola transacción:
  - Inserta `doctors` con `lucy_status='listed_only'`, `is_published=false`, `is_operational=false`, `booking_enabled=false`.
  - Inserta `clinics` con nombre del lead (o el override del admin).
  - Inserta `clinic_members` (owner) **solo** con el `profile_id` del lead — **NO crea `auth.users`** (el médico lo crea cuando hace OTP en el reclamo).

  Espera, complicación: para que después funcione `claim_doctor_profile` (que valida `auth.users.phone == doctors.profile_id → profiles.phone`), el `doctors.profile_id` necesita apuntar a un `profiles` con phone del médico. Pero el médico aún no se logueó.

  **Solución**: `admin_approve_and_create_doctor` crea **un `profiles` row "vacío"** (sin `auth.users` correspondiente) con `phone` del lead. Cuando el médico hace OTP con ese phone, Supabase crea su `auth.users`. El claim RPC ya tiene lógica para vincular un doctor cuyo `profile_id` apunta a un profile huérfano (legacy/seed) y "re-apuntarlo" al `auth.uid()` actual (ver `s7_13` líneas 138-156). **Esto reutiliza la lógica existente.**

  Mismo patrón que `import-doctors.mjs` usa para los 113 doctores importados.

- UI admin: agrega botón "Aprobar y crear médico" en el detalle del lead. Al click, abre form de confirmación con los datos del doctor a crear (admin puede ajustar) → ejecuta la RPC.
- Lead aprobado queda con `doctor_id` seteado (FK a la fila recién creada).

**Sin código nuevo del lado del médico.** Una vez que admin crea el doctor + le pasa el link `lucycare.app/doctor/{id}`, el médico hace el flujo PR #32 + PR #50 ya existente.

### Por qué dos fases

- Fase 1 sola ya **cubre el riesgo de perder leads** (objetivo principal).
- Fase 2 ahorra trabajo manual al admin, pero **no es crítica para arrancar**.
- Fase 1 es 100% reversible / sin riesgos sobre doctors existentes (no toca esa tabla).
- Fase 2 requiere más cuidado porque crea filas reales en `doctors` — vale más review antes de mergearla.

## 3. Esquema SQL — Fase 1

### 3.1 Tabla `doctor_affiliation_requests`

```sql
CREATE TYPE affiliation_status AS ENUM (
  'pending',
  'in_review',
  'approved',
  'rejected',
  'expired'
);

CREATE TABLE doctor_affiliation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Datos del médico (obligatorios mínimos)
  full_name text NOT NULL,
  phone text NOT NULL,  -- formato libre; normalizado al insertar
  phone_normalized text NOT NULL,  -- regexp_replace(phone, '\D', '', 'g')

  -- Datos del médico (opcionales)
  email text,
  specialty_id uuid REFERENCES specialties(id) ON DELETE SET NULL,
  specialty_other text,  -- si eligió "Otra"
  license_number text,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  municipality_id uuid REFERENCES municipalities(id) ON DELETE SET NULL,
  address_line text,
  clinic_name text,
  message text,

  -- Consentimiento (Q8)
  consent_accepted_at timestamptz NOT NULL,
  consent_version text NOT NULL,

  -- Forense / rate limit (Q7)
  ip_address inet,
  user_agent text,

  -- Workflow admin
  status affiliation_status NOT NULL DEFAULT 'pending',
  admin_notes text,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,

  -- Vinculación Fase 2 (NULL en Fase 1)
  doctor_id uuid REFERENCES doctors(id) ON DELETE SET NULL,
  clinic_id uuid REFERENCES clinics(id) ON DELETE SET NULL,

  -- Derived: indica si falta info importante
  -- (license_number, email, o specialty)
  incomplete boolean GENERATED ALWAYS AS (
    license_number IS NULL
    OR email IS NULL
    OR (specialty_id IS NULL AND coalesce(btrim(specialty_other), '') = '')
  ) STORED
);

-- UNIQUE phone normalizado por leads activos (no rechazados/expirados)
CREATE UNIQUE INDEX uq_active_affiliation_phone
  ON doctor_affiliation_requests (phone_normalized)
  WHERE status NOT IN ('rejected', 'expired');

-- UNIQUE compuesto email+license normalizado por leads activos
CREATE UNIQUE INDEX uq_active_affiliation_email_license
  ON doctor_affiliation_requests (
    lower(email),
    upper(regexp_replace(license_number, '\s', '', 'g'))
  )
  WHERE status NOT IN ('rejected', 'expired')
    AND email IS NOT NULL
    AND license_number IS NOT NULL;

-- Indices para queries de admin
CREATE INDEX idx_affiliation_status ON doctor_affiliation_requests (status, created_at DESC);
CREATE INDEX idx_affiliation_created ON doctor_affiliation_requests (created_at DESC);
CREATE INDEX idx_affiliation_ip_24h
  ON doctor_affiliation_requests (ip_address, created_at);

-- Trigger updated_at
CREATE TRIGGER trg_affiliation_updated_at
  BEFORE UPDATE ON doctor_affiliation_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger audit_log
CREATE TRIGGER trg_affiliation_audit
  AFTER INSERT OR UPDATE OR DELETE ON doctor_affiliation_requests
  FOR EACH ROW EXECUTE FUNCTION audit_row_changes();
```

### 3.2 RLS

```sql
ALTER TABLE doctor_affiliation_requests ENABLE ROW LEVEL SECURITY;

-- Anon y authenticated NO pueden hacer NADA directo sobre la tabla.
-- Toda interacción es vía RPCs SECURITY DEFINER.
-- service_role ya tiene full access por convención.

-- (No CREATE POLICY = nadie puede SELECT/INSERT/UPDATE/DELETE directo,
-- excepto service_role.)
```

### 3.3 RPC pública `submit_affiliation_request`

```sql
CREATE OR REPLACE FUNCTION submit_affiliation_request(
  p_full_name text,
  p_phone text,
  p_consent_version text,
  p_email text DEFAULT NULL,
  p_specialty_id uuid DEFAULT NULL,
  p_specialty_other text DEFAULT NULL,
  p_license_number text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_municipality_id uuid DEFAULT NULL,
  p_address_line text DEFAULT NULL,
  p_clinic_name text DEFAULT NULL,
  p_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text;
  v_ip inet;
  v_ua text;
  v_recent_count int;
BEGIN
  -- Validaciones mínimas (Lectura A: name + phone + consent)
  IF coalesce(btrim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'Nombre requerido' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(btrim(p_phone), '') = '' THEN
    RAISE EXCEPTION 'Teléfono requerido' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(btrim(p_consent_version), '') = '' THEN
    RAISE EXCEPTION 'Consentimiento requerido' USING ERRCODE = 'P0003';
  END IF;

  v_phone_norm := regexp_replace(p_phone, '\D', '', 'g');
  IF length(v_phone_norm) < 7 THEN
    RAISE EXCEPTION 'Teléfono inválido' USING ERRCODE = 'P0002';
  END IF;

  -- Headers para forense + rate limit
  v_ip := nullif(current_setting('request.headers', true)::json->>'x-forwarded-for', '')::inet;
  v_ua := current_setting('request.headers', true)::json->>'user-agent';

  -- Rate limit: 1 por IP en últimas 24h
  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_recent_count
    FROM doctor_affiliation_requests
    WHERE ip_address = v_ip
      AND created_at > now() - interval '24 hours';
    IF v_recent_count >= 1 THEN
      -- Mensaje genérico para no filtrar
      RAISE EXCEPTION 'Ya recibimos una solicitud reciente desde esta conexión. Si necesitás contactarnos, escribinos por WhatsApp.'
        USING ERRCODE = 'P0010';
    END IF;
  END IF;

  -- INSERT (si viola UNIQUE de phone activo, mostrar mismo mensaje genérico)
  BEGIN
    INSERT INTO doctor_affiliation_requests (
      full_name, phone, phone_normalized, email,
      specialty_id, specialty_other, license_number,
      department_id, municipality_id, address_line, clinic_name, message,
      consent_accepted_at, consent_version,
      ip_address, user_agent, status
    ) VALUES (
      btrim(p_full_name), btrim(p_phone), v_phone_norm,
      nullif(btrim(lower(p_email)), ''),
      p_specialty_id, nullif(btrim(p_specialty_other), ''),
      nullif(btrim(upper(p_license_number)), ''),
      p_department_id, p_municipality_id,
      nullif(btrim(p_address_line), ''),
      nullif(btrim(p_clinic_name), ''),
      nullif(btrim(p_message), ''),
      now(), p_consent_version,
      v_ip, v_ua, 'pending'
    );
  EXCEPTION WHEN unique_violation THEN
    -- Idempotencia: ya hay un lead activo con ese phone/email/license.
    -- Respondemos success: true para no filtrar enumeración.
    RETURN jsonb_build_object('success', true);
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_affiliation_request(
  text, text, text, text, uuid, text, text, uuid, uuid, text, text, text
) TO anon, authenticated;
```

### 3.4 RPCs admin (Fase 1)

```sql
-- Listar leads con filtros + paginación
CREATE OR REPLACE FUNCTION admin_list_affiliation_requests(
  p_status affiliation_status DEFAULT NULL,
  p_incomplete boolean DEFAULT NULL,
  p_search text DEFAULT NULL,  -- busca en full_name, email, phone
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
) RETURNS TABLE (...)
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  -- query con filtros
END;
$$;

-- Detalle de un lead
CREATE OR REPLACE FUNCTION admin_get_affiliation_request(p_id uuid)
RETURNS jsonb SECURITY DEFINER ...

-- Cambiar a in_review
CREATE OR REPLACE FUNCTION admin_mark_in_review(
  p_id uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb SECURITY DEFINER ...

-- Rechazar (obliga admin_notes)
CREATE OR REPLACE FUNCTION admin_reject_affiliation_request(
  p_id uuid,
  p_notes text
) RETURNS jsonb SECURITY DEFINER ...

-- Marcar aprobado SIN crear doctor (Fase 1)
-- En Fase 2 se reemplaza por admin_approve_and_create_doctor.
CREATE OR REPLACE FUNCTION admin_mark_approved_pending_creation(
  p_id uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb SECURITY DEFINER ...

-- Conteo de pendientes (para badge en sidebar)
CREATE OR REPLACE FUNCTION admin_count_affiliation_pending()
RETURNS int SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN RETURN 0; END IF;
  RETURN (SELECT count(*) FROM doctor_affiliation_requests WHERE status = 'pending');
END;
$$;
```

### 3.5 Migración number

Próximo número disponible: **`s7_21`** (la última fue `s7_20` per HANDOFF).

Archivo: `migrations/s7_21_doctor_affiliation_requests.sql`.

Script de verificación: `scripts/check-s7_21.mjs` siguiendo el patrón de otros check-s7_*.

## 4. Frontend — Fase 1

### 4.1 Reemplazar `DoctorInterestModal`

Crear `src/pages/home/components/AffiliationRequestModal.tsx`:

Estructura:
- Modal con un solo step (form scrollable en mobile).
- Header: "Soy médico, quiero aparecer en Lucy"
- Campos:
  - Nombre completo *
  - Teléfono (con código país, default +503) *
  - Email
  - Especialidad (Select del catálogo + opción "Otra" → input)
  - Licencia / JVPM (con hint: "Recomendado; si no lo tenés a mano, podés enviarlo después")
  - Departamento, Municipio (cascading selects, opcional)
  - Dirección de consultorio (opcional)
  - Nombre de tu clínica (opcional)
  - Mensaje libre (textarea opcional, 280 chars max)
  - **Checkbox LOPD obligatorio** + link a `/privacidad`
- CTAs:
  - Primary: "Enviar solicitud" (disabled hasta cumplir mínimos: name + phone + LOPD)
  - Secondary: "Prefiero contactar por WhatsApp" → abre `wa.me/50378056365`
- Pantalla post-submit (Q6 — no tracking portal):
  > "Recibimos tu solicitud. El equipo de Lucy te contactará en los próximos días por el medio que dejaste."
  Sin mostrar ID de solicitud, sin opción de "ver estado", solo CTA "Volver al inicio".

### 4.2 Página `/privacidad` (Q8)

Crear `src/pages/privacidad/page.tsx` con texto plano básico de política de privacidad:
- Qué datos recolectamos.
- Para qué los usamos.
- Con quién compartimos (nadie).
- Derechos del usuario (acceso/rectificación/borrado vía email a contacto).
- Contacto de privacidad.

Texto editable después por el owner/legal. Para MVP, contenido genérico SV.

Registrar ruta en `src/router/index.tsx`.

### 4.3 Service nuevo

`src/services/affiliation.service.ts`:
- `submitAffiliationRequest(payload)` — wrapper para la RPC pública (fetch directo, mismo patrón defensivo que `claimProfile.service.ts`).
- `adminListAffiliationRequests(filters)`, `adminGetAffiliationRequest(id)`, `adminMarkInReview(id, notes)`, `adminRejectRequest(id, notes)`, `adminMarkApproved(id, notes)` — wrappers admin.
- `adminCountAffiliationPending()` — wrapper para el badge.

### 4.4 Botón en home

Cambiar el onClick actual (`setShowInterestModal(true)`) por `setShowAffiliationModal(true)`. Renombrar state. Cambiar import.

Botón mantiene mismo texto y estilo ("Soy médico, quiero aparecer").

`DoctorInterestModal.tsx` queda como `@deprecated` también (igual que `DoctorRegistrationModal`) — conservado para historial git, no se importa.

## 5. Admin UI — Fase 1

### 5.1 Página `/admin/afiliaciones`

`src/pages/admin/AdminAffiliationsPage.tsx`:
- Tabla paginada con columnas: fecha, nombre, phone, email, especialidad, estado (badge color), incomplete (icono warning), botones de acción.
- Filtros: status (select), incomplete (checkbox), búsqueda libre (debounced 400ms).
- Click en fila → abre modal de detalle.

### 5.2 Modal de detalle del lead

`src/pages/admin/components/AdminAffiliationDetailModal.tsx`:
- Muestra todos los campos del lead (read-only).
- Sección de acciones:
  - Botón "Marcar en revisión" (si status='pending').
  - Botón "Marcar aprobado" (con confirmación: "Esto NO crea el médico todavía — solo marca el lead como validado. Tenés que contactarlo manualmente.").
  - Botón "Rechazar" (abre dialog para escribir nota interna obligatoria).
- Sección de notas admin (textarea editable, queda en `admin_notes`).
- Historial de cambios de status (lectura de `audit_log` filtrado por record_id).

### 5.3 Badge en sidebar

`src/pages/admin/AdminLayout.tsx`:
- Item nuevo de nav "Afiliaciones" con icono `ri-mail-line` o similar.
- Badge rojo con conteo de `pending` (refetch cada 60s).

## 6. Estados del lead (Fase 1)

```
pending
   ↓ admin click "Marcar en revisión"
in_review
   ↓ admin click "Marcar aprobado"            ↓ admin click "Rechazar"
approved                                       rejected
   ↓ (Fase 2: admin click "Crear médico")
approved + doctor_id seteado
```

Transición `expired` queda como follow-up (no es MVP).

## 7. Smoke plan — Fase 1

```
# 1. Migración aplicada
node scripts/check-s7_21.mjs

# 2. RPC pública (anon) desde browser preview
#    - Abrir home en incógnito
#    - Click "Soy médico, quiero aparecer"
#    - Form vacío → submit disabled
#    - Solo nombre → submit disabled
#    - Nombre + phone → submit disabled (falta LOPD)
#    - Nombre + phone + LOPD → submit habilitado
#    - Click "Enviar" → pantalla éxito "Recibimos tu solicitud"
#    - Verificar en DB: nueva fila en doctor_affiliation_requests con incomplete=true

# 3. Rate limit
#    - Mismo browser, intentar enviar otra solicitud → debería responder
#      success genérico pero sin crear duplicado (verificar en DB que no
#      hay 2da fila)

# 4. Form completo
#    - Reset (otro browser / IP)
#    - Llenar todos los campos (incluyendo license, email, especialidad)
#    - Submit → fila con incomplete=false

# 5. Admin
#    - Login admin (50378056365 / 123456)
#    - Ir a /admin/afiliaciones
#    - Ver lista con 2 leads
#    - Click "Detalle" en uno
#    - Marcar en revisión → status cambia, audit_log registra
#    - Marcar aprobado → status cambia, badge baja
#    - Rechazar el otro → forzar nota interna, status cambia

# 6. RLS
#    - Como anon, intentar `supabase.from('doctor_affiliation_requests').select()`
#      → debe devolver 0 filas
#    - Como doctor/asistente (sesión), mismo intento → 0 filas
```

## 8. Riesgos y mitigaciones — Fase 1

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Form lento / mucho scroll en mobile | UX media | Validación inline + secciones colapsables si crece |
| Rate limit muy estricto bloquea médico bona fide | UX media | Copy del error apunta a WhatsApp como fallback |
| Lead con datos falsos satura bandeja admin | Operativo bajo | UNIQUE por phone normalizado + admin rechaza con nota |
| Política de privacidad inadecuada / incompleta | Legal | Texto MVP genérico SV con disclaimer "versión preliminar"; iterar con legal después |
| Sin tracking → médico vuelve a enviar la misma solicitud | UX baja | UNIQUE por phone protege; copy de error es claro |
| `request.headers` no accesible en algunas configs Supabase | Bug | Fallback: si `v_ip IS NULL`, no aplicar rate limit (mejor permitir que romper). Loguear para diagnosticar |

## 9. Fase 2 (no en este PR — pre-acuerdo)

### 9.1 RPC

```sql
CREATE OR REPLACE FUNCTION admin_approve_and_create_doctor(
  p_request_id uuid,
  p_overrides jsonb DEFAULT '{}'::jsonb  -- admin puede ajustar full_name/specialty/etc.
) RETURNS jsonb SECURITY DEFINER
AS $$
DECLARE
  v_lead doctor_affiliation_requests%ROWTYPE;
  v_profile_id uuid;
  v_clinic_id uuid;
  v_doctor_id uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT * INTO v_lead FROM doctor_affiliation_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead no encontrado'; END IF;
  IF v_lead.status NOT IN ('approved', 'in_review') THEN
    RAISE EXCEPTION 'Lead no está en estado aprobable';
  END IF;
  IF v_lead.doctor_id IS NOT NULL THEN
    RAISE EXCEPTION 'Lead ya tiene doctor vinculado';
  END IF;

  -- Crear profile huérfano (sin auth.users; mismo patrón que import-doctors)
  INSERT INTO profiles (id, full_name, email, phone, role)
  VALUES (gen_random_uuid(),
          COALESCE(p_overrides->>'full_name', v_lead.full_name),
          v_lead.email,
          v_lead.phone_normalized,
          'doctor')
  RETURNING id INTO v_profile_id;

  -- Crear clinic auto
  INSERT INTO clinics (name, address_line, phone, owner_id, is_active)
  VALUES (COALESCE(p_overrides->>'clinic_name', v_lead.clinic_name,
                   'Consultorio ' || COALESCE(p_overrides->>'full_name', v_lead.full_name)),
          v_lead.address_line,
          v_lead.phone_normalized,
          v_profile_id,
          true)
  RETURNING id INTO v_clinic_id;

  -- Crear doctor en listed_only
  INSERT INTO doctors (
    profile_id, clinic_id, specialty_id, license_number,
    lucy_status, is_published, is_operational, booking_enabled
  ) VALUES (
    v_profile_id, v_clinic_id,
    COALESCE((p_overrides->>'specialty_id')::uuid, v_lead.specialty_id),
    COALESCE(p_overrides->>'license_number', v_lead.license_number),
    'listed_only', false, false, false
  ) RETURNING id INTO v_doctor_id;

  -- Vincular lead
  UPDATE doctor_affiliation_requests
     SET status = 'approved',
         doctor_id = v_doctor_id,
         clinic_id = v_clinic_id,
         reviewed_by = auth.uid(),
         reviewed_at = COALESCE(reviewed_at, now()),
         updated_at = now()
   WHERE id = p_request_id;

  -- Audit
  INSERT INTO audit_log (user_id, action, table_name, record_id, new_data)
  VALUES (auth.uid(), 'update', 'doctor_affiliation_requests', p_request_id,
          jsonb_build_object('status', 'approved', 'doctor_id', v_doctor_id,
                             'clinic_id', v_clinic_id, 'edited_via', 'admin'));

  RETURN jsonb_build_object(
    'success', true,
    'doctor_id', v_doctor_id,
    'clinic_id', v_clinic_id,
    'profile_id', v_profile_id
  );
END;
$$;
```

### 9.2 UI admin (Fase 2)

- Botón "Aprobar y crear médico" en el detalle (sólo si status='in_review' o 'approved' sin doctor_id).
- Modal de confirmación con form pre-rellenado de los datos del lead, permite ajustar.
- Submit → ejecuta RPC, muestra success con link al `/admin/medicos/{doctor_id}` recién creado.

### 9.3 Comunicación (sigue manual per Q3)

- Tras crear el doctor, mostrar al admin un panel con:
  - Link público `https://lucycare.app/doctor/{id}` para copiar.
  - Texto sugerido para WhatsApp con instrucciones de reclamo.
  - "Marcar como notificado" → solo informativo, no afecta status.

## 10. Cronograma

| Fase | Tamaño estimado | Cuándo |
|---|---|---|
| **Plan operativo** (este doc) | 1 día | Ahora |
| **Fase 1 PR** | 4-6 días | Pre-piloto, próximo en cola |
| Smoke + ajustes Fase 1 | 1-2 días | Con piloto activo o antes |
| **Fase 2 PR** | 2-3 días | Después de validar Fase 1 con datos reales |

## 11. Pendientes / preguntas residuales

Estas pueden cerrarse durante la implementación o quedar como follow-up:

- **Política de privacidad**: ¿texto provisto por owner, o redacto un MVP genérico? **Default**: redacto MVP genérico SV, owner revisa.
- **Bucket de comprobante credencial**: ¿incluir upload opcional en Fase 1 o diferir a Fase 2? **Default**: diferir (no estaba en Q1-Q10, agregaría complejidad).
- **Email automático al lead** (gracias por enviar): **default** no — coherente con Q3. Pantalla post-submit es la única confirmación.
- **TTL para `expired`**: cron / Edge Function para auto-expirar leads >30 días sin movimiento. **Default**: no en MVP; admin puede archivar manualmente.
- **hCaptcha / Turnstile**: **default** no en MVP. Si rate limit + UNIQUE no alcanza, agregar después.

## 11.bis Pendientes legales / diseño (post-Fase 2)

Definidos durante el smoke de PR #58 (post-merge Fase 2). Quedan
fuera de scope técnico de los PRs de afiliación; requieren input
legal/diseño antes de implementar.

### A. DUI / documento de identidad del médico

- Hoy capturamos solo phone + license. Para verificación oficial robusta
  y cumplimiento de directorio médico curado, agregar:
  - Campo `dui` o `document_number` en `doctor_affiliation_requests`.
  - Validación de formato (DUI SV: `00000000-0`).
  - Upload de foto del DUI (Storage bucket `affiliation_documents` privado).
- Decisión pendiente: ¿es obligatorio en form público o solo cuando
  admin pide al médico durante la validación manual?

### B. Aceptación formal de términos del médico

- Hoy el médico acepta TOS implícitamente cuando reclama su perfil
  (`tos_accepted_at` + `tos_version` en `doctors`, via PR #32).
- Antes de la **verificación oficial** (`lucy_status='verified'`),
  el médico debería aceptar un TOS médico específico (responsabilidad
  clínica, código de conducta, política de cancelaciones, etc.).
- Diseñar el flow: ¿modal post-reclamo? ¿paso del onboarding admin?
- Persistir versión del TOS médico distinto del TOS de paciente y del
  TOS del reclamo.

### C. Verificación cruzada con fuente oficial

- Idealmente integración con JVPM (Junta de Vigilancia de la Profesión
  Médica de El Salvador) o equivalente para validar license_number
  programáticamente. Hoy es 100% manual por LucyAdmin.
- Sin API pública conocida; explorar scraping ético o convenio.

## 12. Coordinación con otros docs

- `docs/ANALISIS_AFILIACION_MEDICO.md` — análisis original. Este plan implementa Opción A §5.
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — el flujo Fase 2 (admin crea doctor) genera médicos en `listed_only` que entran al reclamo existente sin cambios.
- `docs/ANALISIS_AUTH_MEDICO.md` — el médico aprobado en Fase 2 usa Reclamar + Fase 4 PR-B para crear su password.
- `docs/SECURITY_GATE_PILOTO.md` — Hallazgo #7 cerrado. Este plan **no abre hallazgos nuevos** porque mantiene la regla "no auto-crear doctores desde flujo público".
- `docs/PLAN_PILOTO_5_MEDICOS.md` — los 5 médicos del piloto inicial siguen usándose vía `import-doctors.mjs`. Este flujo de afiliación captura **nuevos** leads en paralelo.

---

**Siguiente paso:** owner aprueba este plan (o pide ajustes). Con plan aprobado, abrimos branch para Fase 1 (migración `s7_21` + RPCs + RLS + frontend + admin UI + página privacidad).
