# Análisis — Credenciales médicas (JVPM / NUE) como señal de confianza

> Documento de análisis + decisión de diseño. **Snapshot 2026-06-29 (post-#197, HEAD `7f55f6a`).**
> **Estado: DISEÑO APROBADO conceptualmente. NO implementar código ni tocar la DB
> hasta abrir las fases (§8) con su alcance.** Read-only / design.
>
> Acompaña a:
> - `docs/ANALISIS_AFILIACION_MEDICO.md` — cómo entra un médico (lead → `listed_only`).
> - `docs/ANALISIS_RECLAMAR_PERFIL.md` — cómo reclama (`listed_only` → `claimed`, valida licencia).
> - `docs/HANDOFF_LUCYCARE_SPRINT7.md` — ejes del médico (`is_published`, `is_operational`, `booking_enabled`, `is_verified`, `lucy_status`).
> - `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` — separación **pago ≠ verified ≠ claimed** (vinculante).
>
> **Regla central (vinculante):** la **verificación de confianza** la gobierna
> LucyAdmin; **no** depende del pago ni del reclamo; y **mostrar una credencial
> al paciente debe ser veraz** (respaldada por verificación, no por un número crudo).

---

## 1. Estado actual del modelo (HEAD `7f55f6a`)

Campos relevantes en `doctors`:

| Campo | Tipo | Rol hoy |
|---|---|---|
| `license_number` | `text \| null` | **Única credencial.** Funciona como **JVPM / licencia profesional base** (ver §2). Campo genérico de texto, sin validación de formato. |
| `specialty_id` | `uuid \| null` (FK) | Especialidad del médico. **No** acredita nada por sí solo. |
| `is_verified` | `boolean` (**GENERATED** de `lucy_status='verified'`) | **Verificación GLOBAL** del médico por LucyAdmin. **No** dice qué credencial se chequeó, ni quién/cuándo. |
| `lucy_status` | enum `listed_only \| claimed \| booking_enabled \| verified` | Estado del médico. `verified` es decisión de LucyAdmin. |

Además: `doctor_affiliation_requests.license_number` (la licencia que deja el lead en la afiliación).

**Ausencias confirmadas (read-only):**
- **No existe campo NUE** (Número Único de Especialista) — cero referencias en código/migraciones.
- **No existe modelo de credenciales por tipo** ni metadata de verificación por credencial
  (quién verificó, cuándo, qué, si es público, si fue rechazado y por qué).
- No hay subespecialidad ni nada específico de especialista más allá de `specialty_id`.

## 2. Significado actual de `license_number`

**= JVPM / licencia profesional base.** Rotulado así en toda la UI:
- Panel del médico (`PerfilPage`): "**Licencia (JVPM)**", **read-only** (`disabled`, "Para cambiarla, contacta soporte").
- Modal de afiliación (`AffiliationRequestModal`): "**Licencia profesional / JVPM**".
- Migración `s7_21` (afiliación): "License/JVPM recomendada pero no bloqueante".

**Captura / ciclo de vida:**
- Se deja en la **afiliación** (lead, opcional) → al **aprobar** (`admin_approve_and_create_doctor`) se **copia** a `doctors.license_number`.
- Se **valida en el reclamo** (`claim_doctor_profile`, `s7_13`): el médico tipea su licencia y el RPC la compara **server-side** contra `doctors.license_number` (nunca expone el número al cliente).
- Después es ~inmutable desde UI (el médico no la edita; admin-edit no la expone; cambios por soporte).

**Visibilidad hoy:**
- **Público:** **NO viaja** (removido en #197; `fetchDoctors` tampoco lo trae).
- **Admin:** visible en la bandeja de afiliación (lead) para validar — admin-only.
- **Panel del médico:** ve **su propia** licencia (read-only, dato propio autenticado — no es leak).

## 3. Limitaciones del modelo actual

1. **No distingue JVPM vs NUE** — un solo campo genérico; un NUE no tendría dónde ir sin mezclarse.
2. **No permite varias credenciales** por médico (un especialista tiene JVPM **y** NUE).
3. **No tiene estado por credencial** (`pending`/`verified`/`rejected`).
4. **No tiene visibilidad pública por credencial** (mostrar/ocultar, parcial/total).
5. **No tiene auditoría específica** de verificación (quién/cuándo/qué/motivo de rechazo).
6. **`is_verified` es global**, no por credencial → no se puede afirmar "JVPM verificada" o
   "NUE verificado" de forma **veraz** con el modelo actual.

## 4. Riesgos

| # | Riesgo | Nota |
|---|---|---|
| R1 | **Exponer números** (JVPM/NUE) al público | ID profesional crudo, sin valor para el paciente. |
| R2 | **Scraping** | Un número público es cosechable masivamente. |
| R3 | **Suplantación** | Un número expuesto facilita hacerse pasar por el médico. |
| R4 | **Confundir JVPM con NUE** | Modelo de un solo campo genérico. |
| R5 | **Afirmar NUE sin tener NUE** | Hoy no existe NUE; cualquier claim sería falso. |
| R6 | **"Especialista acreditado" basado solo en `specialty_id`** | `specialty_id` no acredita; sería sobrepromesa. |
| R7 | **Confundir `claimed` con `verified`** | Reclamar (tipear licencia) ≠ verificación. |
| R8 | **Confundir pago con verificación** | Pagar la suscripción ≠ `verified` (ver doc de pagos). |
| R9 | **Mostrar credencial no verificada** | Sin estado por credencial, un claim no estaría respaldado. |

## 5. Reglas de visibilidad recomendadas

- **No mostrar números por defecto** (ni completos ni parciales) — solo con decisión explícita posterior.
- Mostrar **señales textuales de confianza solo si están respaldadas** por verificación real.
- **Visibilidad controlada por LucyAdmin** (no automática; nunca derivada del pago ni del claim).
- Una credencial es **pública solo si `status='verified'` E `is_public=true`**.
- Al payload público viaja, a lo sumo, el **estado/etiqueta de confianza**, **nunca el número**.

## 6. Modelo recomendado — tabla futura `doctor_credentials`

> Propuesta de diseño. **NO se implementa en este documento.** Reemplaza la idea de
> columnas sueltas (`jvpm_number`/`nue_number`), que es más rígida (1 JVPM + 1 NUE)
> y no soporta auditoría/estado por credencial.

```
doctor_credentials
  id
  doctor_id            -- FK a doctors (0..N credenciales por médico)
  type                 -- enum: 'JVPM' | 'NUE' | 'OTHER'
  value               -- valor interno de la credencial (NUNCA al payload público)
  status               -- enum: 'pending' | 'verified' | 'rejected'
  is_public            -- bool (default false): mostrar señal pública si verified
  rejection_reason     -- text null (motivo si 'rejected')
  verified_by          -- FK admin que verificó (null si pending)
  verified_at          -- timestamptz null
  created_at / updated_at
  -- audit en audit_log con edited_via distintivo
```

Reglas del modelo:
- **JVPM ≠ NUE.** `type` distingue. **NUE solo para especialistas/subespecialistas**;
  no todos los médicos tienen NUE. Un especialista puede tener **JVPM y NUE**.
- **Estado por credencial** (`pending`/`verified`/`rejected`) — independiente de `is_verified`
  global del médico.
- **`value` (el número) NUNCA viaja al cliente público.** Solo viaja, si acaso, el
  estado/etiqueta ("verificada por LucyCare") cuando `status='verified'` y `is_public=true`.
- **Auditoría:** `verified_by`/`verified_at`/`rejection_reason` + `audit_log`.
- **Relación con `doctors`:** la tabla cuelga de `doctor_id`; `doctors.license_number` actual
  podría **migrarse** a una fila `type='JVPM'` (decisión de la fase de migración, no ahora).
- **Relación con `is_verified`:** se mantienen separados — `is_verified` = trust global del
  médico (LucyAdmin); `doctor_credentials` = credenciales específicas verificadas. Una no
  implica la otra automáticamente (a definir la regla de composición en la fase de diseño).

## 7. Experiencia futura (cuando exista el modelo)

- **LucyAdmin** captura/verifica credenciales (marcar `verified`/`rejected` con motivo + audit).
- El **médico** puede **proponer** una credencial (queda `pending`); LucyAdmin valida.
- El **perfil público** muestra una **señal de confianza, no necesariamente el número**:
  el paciente ve **"Credenciales verificadas por LucyCare"** (o "JVPM verificada" /
  "NUE de especialista verificado") **solo** cuando esa credencial está `verified` + `is_public`.
- Mantiene la separación: **pago ≠ verified ≠ claimed**, y **verificación global ≠ credencial específica**.

## 8. Fases sugeridas (ninguna arranca sin abrir su frente)

| Fase | Qué | Tipo |
|---|---|---|
| F0 | **Diseño** (este documento) | docs-only ✅ |
| F1 | **Modelo / migración** `doctor_credentials` (+ enum tipos/estados, RLS, audit) | migración `s7_NN`/`s8_NN` |
| F2 | **UI LucyAdmin** — capturar / verificar / rechazar / marcar público | frontend + RPCs |
| F3 | **Captura / propuesta por el médico** (estado `pending`) | frontend + RPC |
| F4 | **UI pública** — señal de confianza **sin número** (gated `verified` + `is_public`) | frontend |
| F5 | **Auditoría / reportes** de credenciales | admin/reportería |

> Cada fase = 1 PR chico, con `check-*.mjs`/smoke donde aplique, `tsc`+`build` verdes,
> preview validado, y **el número de la credencial nunca al payload público**.

## 9. Qué puede mostrarse AHORA (con el modelo actual)

- ✅ Badge **"Verificado"** (existente, = `is_verified` / LucyAdmin).
- ✅ (PR posterior, frontend-only) copy **"Verificado por LucyCare"** junto al badge — **sin números**.
- ❌ **NO** mostrar todavía: "JVPM verificada", "NUE verificado", número JVPM, número NUE,
  ni "especialista acreditado" basado solo en `specialty_id`.

## 10. Recomendación

1. **No exponer credenciales** (número ni claim por-tipo) **hasta tener el modelo** (`doctor_credentials`, §6).
2. Mientras tanto, la única señal de confianza **veraz** es el **badge `is_verified`**
   (con copy "Verificado por LucyCare" opcional, frontend-only, sin números).
3. Cuando se decida avanzar, arrancar por **F1 (modelo/migración)**; la UI pública (F4) es lo último.
4. Mantener vinculante: **pago ≠ verified ≠ claimed**, **verificación global ≠ credencial específica**,
   y **el número nunca viaja al cliente público**.
