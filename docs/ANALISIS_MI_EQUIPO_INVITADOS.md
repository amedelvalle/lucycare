# Análisis — Mi equipo / invitados del médico

> Documento de análisis + propuesta. **Snapshot 2026-06-01.**
> **Estado: BORRADOR para discusión. NO implementar código ni tocar la
> DB hasta cerrar las preguntas de la §12.**
>
> Acompaña a:
> - `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` — los asientos del equipo son un
>   límite de la suscripción (incluidos + add-on).
> - `docs/HANDOFF_LUCYCARE_SPRINT7.md` — ejes del médico, roles, deudas.
> - Deuda técnica #1 ("Asistente puede firmar consulta") — este doc la
>   trata como bloqueante clínico-legal (§3).
>
> ⚠️ **Las decisiones comerciales finales** (exactamente 2 asistentes
> incluidos, precio del usuario adicional, etc.) **las valida el owner.**
> El dev analiza impacto técnico y propone implementación.

---

## 1. Objetivo

Diseñar cómo funciona el **equipo del médico**: quién puede entrar a la
clínica, con qué permisos, cómo se invita/gestiona, con qué límites
(comerciales y técnicos) y cómo se audita — separando con claridad lo
**operativo** (agenda, citas, admin) de lo **clínico** (consulta, firma,
diagnósticos), que es la frontera crítica.

---

## 2. Estado actual (qué YA existe)

Buena parte del esqueleto existe (Sprint 3 + s5_07). Hay que **extenderlo**,
no construir de cero.

| Pieza | Dónde | Estado |
|---|---|---|
| Tabla `clinic_members` | (base) — roles `owner` / `doctor` / `assistant` | ✅ |
| Tabla `clinic_invitations` | `s5_07` — phone, display_name, role, invited_by, accepted_at, cancelled_at | ✅ |
| UNIQUE 1 invitación pendiente por (clinic, phone) | `s5_07` índice parcial | ✅ |
| RPC `accept_clinic_invitations(phone)` | `s5_07` SECURITY DEFINER (post-OTP) | ✅ |
| Audit trigger de invitaciones | `s5_07` `trg_audit_clinic_invitations` | ✅ |
| Página **`/panel/equipo`** | `EquipoPage.tsx` — invitar, cancelar, activar/inactivar, lista activos/inactivos | ✅ |
| Hooks `useTeam` + `team.service` | invitar / pendientes / miembros / cancelar / set-active | ✅ |
| `useClinicContext` | resuelve `role`, `clinicId`, `availableDoctors` (asistente multi-doctor) | ✅ |

### Lo que NO existe todavía (gaps a diseñar aquí)

1. **Límite de cupos** (cuántos asistentes puede tener) — **no hay ningún
   tope**; hoy el médico puede invitar asistentes sin límite.
2. **Expiración** de invitaciones pendientes (viven para siempre).
3. **Reenvío** de invitación (solo existe cancelar).
4. **Gate clínico server-side** que impida a un asistente escribir/firmar
   consultas → **deuda técnica #1, abierta** (ver §3).
5. **Vínculo con suscripción/pagos** (asientos contratados) — no existe.
6. Manejo explícito del caso **"el teléfono ya pertenece a otro usuario"**
   (doctor/admin) — hoy el RPC solo promueve `patient → assistant`.

---

## 3. Regla clínica crítica (la frontera operativo ↔ clínico)

**El asistente apoya lo operativo, NUNCA lo clínico.** El asistente
**NO** puede:
- realizar atención médica;
- crear / finalizar una consulta clínica;
- **firmar** consulta;
- modificar registros clínicos firmados (inmutables);
- cambiar diagnósticos / tratamientos / recetas;
- actuar como médico de cualquier forma.

### 3.1 Estado actual = RIESGO ABIERTO (deuda técnica #1)

Hoy la firma de una consulta es un **`UPDATE consultations.status='signed'`**
(no hay RPC dedicada con gate de rol; ver `s6_02`, trigger
`sync_appointment_on_sign`). **No se encontró en las migraciones un RLS
que distinga `assistant` de `doctor` para escribir `consultations` /
`prescriptions`.** El CLAUDE.md lo registra como deuda #1:
> "Asistente puede firmar consulta — clínico-legal, urgente. Verificar RLS de consultas."

**Este análisis lo eleva a bloqueante de la feature de equipo:** no se
puede ampliar/recomendar el rol asistente sin **cerrar este gate primero**.

### 3.2 Propuesta de enforcement (clínico)

- Auditar las policies actuales de `consultations`, `prescriptions`,
  `vitals`, `consultation_family_history`.
- Regla server-side: **INSERT/UPDATE clínico permitido solo si el actor es
  `doctor`/`owner` de la clínica** (no `assistant`). Idealmente:
  - RLS por rol del `clinic_members` del actor en esa clínica, **o**
  - una RPC `sign_consultation()` / `save_consultation()` con
    `IF rol_actor = 'assistant' THEN RAISE`.
- La firma debería pasar por una **RPC dedicada** (no UPDATE directo) para
  poder gatear rol + inmutabilidad en un solo lugar.
- Esto se diseña/cierra en su propio PR (deuda #1), y **es prerequisito**
  de habilitar formalmente más permisos al asistente.

---

## 4. Roles y permisos (operativo vs clínico)

| Rol | Quién | Permisos operativos | Permisos clínicos |
|---|---|---|---|
| **Médico titular** (`owner`/`doctor`) | dueño de la clínica | Todos | **Todos** (consulta, firma, dx/tx) |
| **Asistente / invitado** (`assistant`) | invitado por el titular | Agenda, citas, lista de espera, datos básicos del paciente, notas administrativas | **Ninguno** (ver §3) |
| **LucyAdmin** (`is_admin()`) | plataforma | Administración SaaS (publicar, verificar, suspender, editar ficha) | **Ninguno** — admin NO ve contenido clínico (regla del Security Gate) |

Notas:
- `owner` vs `doctor` en `clinic_members`: hoy coexisten; el titular es
  `owner`. Tratarlos igual a efectos clínicos (ambos pueden todo).
- `is_verified` / publicación / suscripción **no** las toca el asistente
  (§7).

---

## 5. Límite comercial inicial (preliminar — valida owner)

Alineado con `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`:

- Plan base = **1 médico titular + hasta 2 asistentes = 3 accesos totales**.
- **`included_assistants = 2`** (el titular no cuenta como asistente).
- **`max_team_members = 3`** en el plan base (titular + 2).
- **Usuario adicional: $5/mes** por asistente extra (o equivalente anual)
  → **add-on de la suscripción** (no cobro suelto).
- Debe **conectarse con el modelo de suscripción/pagos** (§10) — pero
  **pagos NO se implementa todavía**.

> Estas cifras son **preliminares**; el owner confirma el número exacto de
> incluidos y el precio del adicional.

---

## 6. Límite técnico (enforcement server-side / DB — NO solo UI)

**Principio:** el tope se valida en backend/DB; la UI solo refleja. Un
asistente de más **no** debe poder colarse llamando la RPC directo.

### 6.1 Cómo contar el cupo

```
usados   = (clinic_members activos con role='assistant' de la clínica)
         + (clinic_invitations PENDIENTES de la clínica)
contratados = included_assistants (2 en base) + additional_assistants (add-on pagado)
```

- **Contar invitaciones pendientes dentro del cupo** evita el bypass de
  "invito 10, todas pendientes, todas aceptan después".
- El **titular no consume cupo de asistente** (es un eje aparte).

### 6.2 Dónde enforzar

- En la **RPC/insert que crea la invitación**: `IF usados >= contratados
  THEN RAISE EXCEPTION 'Límite de equipo alcanzado'`.
- En **`accept_clinic_invitations`**: revalidar el cupo al aceptar (defensa
  ante condición de carrera: dos aceptan a la vez). Si excede, no activar.
- Idealmente además un **trigger/constraint** sobre `clinic_members` que
  impida exceder `max_team_members` aunque alguien escriba directo.

### 6.3 Liberar cupo

- **Inactivar/eliminar un asistente** (`is_active=false` o borrar
  `clinic_members`) **libera** cupo → se puede invitar a otro.
- **Cancelar una invitación pendiente** libera cupo.
- Definir si "inactivo" sigue consumiendo cupo: **propuesta** = inactivo
  **no** consume (liberado); reactivarlo revalida contra el cupo.

---

## 7. Permisos del asistente (detalle)

### 7.1 Puede (operativo)

- **Ver la agenda** del/los médico(s) a los que asiste.
- **Crear / reprogramar / cancelar citas** según las reglas ya existentes
  (no en el pasado, dentro de disponibilidad, no sobre consulta firmada).
- **Gestionar la lista de espera** (waitlist).
- **Ver datos básicos del paciente** (nombre, teléfono, documento) para
  agendar / identificar — sin contenido clínico.
- **Registrar notas administrativas** (no clínicas) — *a confirmar Q5*.
- Walk-in / alta básica de paciente para agendar (dedup por teléfono ya
  existe).

### 7.2 NO puede

- Ver/editar **contenido clínico sensible** (consultas, dx, recetas,
  antecedentes) — **salvo decisión expresa** (Q4; default: **no**).
- **Firmar** consulta (§3).
- Cambiar **diagnósticos / tratamientos**.
- Cambiar **configuración crítica** del médico (perfil público,
  especialidad, servicios, disponibilidad-base, foto) — *a confirmar Q6*.
- Gestionar **suscripción / pago / equipo** (no invita a otros, no cambia
  plan, no quita miembros).
- Tocar `is_published` / `is_operational` / `booking_enabled` /
  `is_verified` (eso es del titular o de LucyAdmin).

### 7.3 Zona gris a decidir (§12)

- ¿El asistente ve **solo datos de agenda** del paciente o también su
  ficha administrativa completa (alergias, etc. = clínico)? → **default:
  solo lo necesario para agendar**, sin clínico.
- ¿Puede editar disponibilidad/horarios del médico? → **default: no**
  (config crítica).

---

## 8. Invitación — ciclo de vida

Estado actual: `pending → accepted` (OTP) o `pending → cancelled`. Falta
expiración y reenvío.

| Etapa | Hoy | Propuesta |
|---|---|---|
| **Crear** | INSERT `clinic_invitations` (phone + display_name) | + validar cupo (§6) |
| **Notificar** | manual (el médico le avisa) — SMS auto NO implementado (S5-08) | seguir manual en MVP; SMS auto como follow-up |
| **Aceptar** | asistente entra con OTP → `accept_clinic_invitations` | + revalidar cupo + resolver colisión de phone (§8.1) |
| **Expirar** | ❌ no existe (viven para siempre) | TTL (ej. 14 días) → estado `expired`; cron o chequeo perezoso. *Q3* |
| **Cancelar** | ✅ `cancelled_at` desde la UI | igual |
| **Reenviar** | ❌ no existe | "Reenviar" = renueva `invited_at` / extiende TTL (no crea duplicado, respeta UNIQUE) |

### 8.1 "El teléfono ya pertenece a otro usuario" (edge crítico)

`accept_clinic_invitations` hoy: crea `clinic_members` y sube
`profiles.role` a `assistant` **solo si era `patient`** (no degrada
`doctor`). Casos:

| Phone pertenece a… | Hoy | Riesgo / decisión |
|---|---|---|
| **Paciente** (role=patient) | promueve a `assistant`, crea membership | OK. *(¿pierde su rol paciente? — single `profiles.role`, ver Q7)* |
| **Doctor titular** (role=doctor) | NO degrada; crea membership `assistant` igual | **Conflicto:** un mismo profile sería doctor + miembro asistente de otra clínica. ¿Permitido? **Default: rechazar** invitar a un teléfono que ya es doctor. *Q8* |
| **Admin** (is_admin) | crea membership | **Rechazar** (no mezclar admin con asistente). *Q8* |
| **Ya asistente activo en ESA clínica** | UNIQUE pendiente + `ON CONFLICT DO NOTHING` | idempotente, OK |
| **Asistente de OTRA clínica** | crea membership adicional | Multi-clínica permitido (el `useClinicContext` ya soporta `availableDoctors`). OK |

→ **Decisión de fondo (Q7):** ¿`profiles.role` único alcanza, o
necesitamos que la identidad (paciente) y la membresía de clínica
(asistente) sean independientes? Hoy el rol es global en `profiles`. Un
modelo más limpio: el **rol efectivo viene de `clinic_members`** por
clínica, y `profiles.role` deja de ser la fuente de verdad operativa.
Esto conecta con el modelo de **Paciente Global** (la identidad vive en
`profiles`, las relaciones en tablas por contexto).

---

## 9. Permisos — resumen de enforcement

- **Operativo (citas, waitlist, pacientes-agenda):** RLS por
  `is_clinic_member(clinic_id)` (ya existe el helper) — asistente activo
  de la clínica puede.
- **Clínico (consultations/prescriptions/vitals):** RLS/RPC que exige
  rol `doctor`/`owner` (no `assistant`) — **§3, deuda #1 a cerrar**.
- **Config del médico / suscripción / equipo:** solo titular (`owner`/
  `doctor`) — RLS por `doctors.profile_id = auth.uid()`.
- **Nunca confiar en la UI** para ninguno de estos límites.

---

## 10. Auditoría

Todo lo que haga un asistente debe quedar auditado. Hoy `audit_log` ya
captura quién (`user_id = auth.uid()`), tabla, acción, old/new. Para el
equipo:

- Las acciones del asistente sobre `appointments` / `waitlist_entries` /
  `patients` ya pasan por triggers de audit existentes → registran
  `user_id` (el asistente) + record.
- **Mejora recomendada:** registrar también **"en nombre de qué
  médico/clínica"** se actuó (el `clinic_id` / `doctor_id` activo), porque
  un asistente puede asistir a varios médicos. Agregar ese contexto al
  `new_data` (`acting_clinic_id`, `acting_doctor_id`) en las acciones del
  asistente, o derivarlo del record.
- Invitaciones (crear/cancelar/aceptar/expirar) ya auditadas por
  `trg_audit_clinic_invitations`.
- Conservar: **quién, en nombre de qué clínica/médico, cuándo, qué acción.**

---

## 11. UX — sección "Mi equipo"

Base ya implementada en `EquipoPage.tsx`. Faltan: contador de cupos,
expiración/reenvío, y el copy de límites. Propuesta:

- **Encabezado** con **contador de cupos**: `Asistentes 1/2` (o `2/2`
  lleno). Si está lleno: botón "Invitar" deshabilitado + CTA "Agregar
  asistente ($5/mes)" → futuro flujo de add-on (§5).
- **Lista de miembros** (activos): nombre, rol (chip), teléfono, estado.
- **Invitaciones pendientes**: nombre/teléfono, "esperando OTP", tiempo,
  **Reenviar** + **Cancelar**, y aviso de expiración ("expira en N días").
- **Botón Invitar** → modal phone + nombre (ya existe), ahora bloqueado si
  no hay cupo, con mensaje claro.
- **Eliminar acceso**: inactivar (ya existe) y/o quitar membership →
  libera cupo (§6.3).
- **Estados visibles**: activo / inactivo / pendiente / expirado.
- Copy debe dejar claro: "Las asistentes gestionan agenda y pacientes,
  **no firman consultas**" (ya está en la UI).

---

## 12. Relación con pagos (preparar, NO implementar)

Sin construir pagos todavía, dejar el modelo de equipo **listo para
enganchar**:

- `included_assistants = 2` (constante de plan, hoy hardcodeable).
- `additional_assistants` = futuro **add-on** de la suscripción (cantidad).
- `max_team_members = 1 (titular) + included_assistants + additional_assistants`.
- El límite técnico (§6) debe leer `max_team_members` de una **fuente
  única**: hoy una constante; mañana, la fila de `subscriptions`
  (`docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` §7/§8).
- **Hasta que pagos exista:** el límite efectivo = `included_assistants`
  (2). El enganche con el add-on se hace cuando se implemente la
  suscripción.
- Al **bajar plan / cancelar suscripción**: los asistentes por encima del
  límite quedan **bloqueados** (no borrados) — coherente con el doc de
  pagos (§7.3 de ese doc).

---

## 13. Decisiones pendientes (cerrar antes de implementar)

| Q | Pregunta | Default sugerido |
|---|---|---|
| **Q1** | ¿`included_assistants` = 2 exacto? (comercial) | 2 (valida owner) |
| **Q2** | ¿Precio/forma del asistente adicional? (comercial) | $5/mes add-on (valida owner) |
| **Q3** | ¿TTL de invitación pendiente? | 14 días → `expired` |
| **Q4** | ¿El asistente ve algún contenido clínico? | No (solo operativo) |
| **Q5** | ¿Notas administrativas del asistente? ¿tabla aparte? | Sí, no-clínicas, tabla/campo administrativo |
| **Q6** | ¿Asistente edita disponibilidad/servicios del médico? | No (config crítica = titular) |
| **Q7** | ¿Rol único en `profiles` o rol efectivo por `clinic_members`? | Migrar a **rol efectivo por clínica** (alinea con Paciente Global) — post-MVP |
| **Q8** | ¿Invitar un teléfono que ya es doctor/admin? | Rechazar |
| **Q9** | ¿Inactivo consume cupo? | No (liberado); reactivar revalida |
| **Q10** | ¿Cerrar deuda #1 (gate clínico) antes o junto con esta feature? | **Antes** (prerequisito) |

---

## 14. Fases de implementación (después de cerrar §13)

> Ninguna fase arranca hasta cerrar §13. Pagos NO se implementa aquí.

- **Fase 0 — Cerrar deuda clínica #1 (prerequisito):** auditar RLS de
  `consultations`/`prescriptions`/`vitals`; gate server-side para que
  `assistant` no escriba/firme; firma vía RPC dedicada. *(Su propio PR.)*
- **Fase 1 — Límite de equipo (server-side):** constante
  `included_assistants=2` + conteo (miembros activos + invitaciones
  pendientes) + enforcement en crear-invitación y en `accept_*` +
  trigger/constraint defensivo. UI: contador de cupos `n/2`.
- **Fase 2 — Ciclo de vida de invitación:** expiración (TTL) + estado
  `expired` + **reenviar** + copy. Colisión de phone (Q8) resuelta en
  `accept_*`.
- **Fase 3 — Permisos finos del asistente:** confirmar/ajustar RLS
  operativa (citas, waitlist, pacientes-agenda) + notas administrativas
  (Q5) + bloquear config crítica (Q6).
- **Fase 4 — Auditoría enriquecida:** `acting_clinic_id` / `acting_doctor_id`
  en las acciones del asistente.
- **Fase 5 — Enganche con pagos (cuando exista suscripción):**
  `max_team_members` desde `subscriptions`; add-on de asientos; bloqueo de
  excedentes al bajar plan. *(Depende de `ANALISIS_PAGOS_SAAS_MEDICOS`.)*

Cada fase: 1 PR chico, migración `s7_NN`/`s8_NN` + `check-*.mjs` si aplica,
`vite build` OK, smoke, merge. Enforcement siempre server-side.

---

## 15. Coordinación con otros docs

- `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` — asientos = límite de suscripción;
  `included_assistants=2`, add-on $5/mes, `max_team_members`. La Fase 5 de
  aquí = la Fase 5 de límite de equipo de aquel doc.
- **Deuda técnica #1** (CLAUDE.md) — "asistente puede firmar consulta": se
  eleva a prerequisito (Fase 0).
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — Q7 (rol efectivo por clínica vs rol
  único en `profiles`) conecta con el modelo de identidad global.
- `docs/SECURITY_GATE_PILOTO.md` — al implementar: RLS clínica por rol,
  enforcement de cupo server-side, auditoría del actor.

---

**Siguiente paso:** el owner valida las decisiones comerciales (Q1, Q2) y
responde §13. Con eso, **arrancar por la Fase 0 (cerrar el gate clínico,
deuda #1)** antes de ampliar el rol asistente.
