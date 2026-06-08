# Análisis — Onboarding médico/paciente + Identidad múltiple

> Mini-doc de análisis (sin código). Disparado por el caso **Katherine**
> (PR #122 / `s7_42`): una persona ya registrada como paciente que después
> se da de alta como médico. El incidente confirmó que LucyCare **no debe
> pensarse como "usuario paciente" vs "usuario médico" separados**, sino como
> **una identidad única (persona) que puede tener varios contextos**: paciente,
> médico, asistente y/o admin.
>
> Objetivo: fijar el **modelo conceptual y las reglas de producto** para que
> los flujos futuros (afiliación, reclamo, cambio de teléfono, recuperación sin
> sesión, paciente global, merge de duplicados, activación médica) dejen de
> resolverse caso por caso. **No** propone implementación todavía; entrega
> decisiones recomendadas, riesgos y fases.
>
> Snapshot de referencia: HEAD `b6c36a1`, migraciones hasta `s7_42`.

---

## 0. TL;DR (decisiones recomendadas)

1. **Identidad = una persona = un `auth.users` = un `profiles`** (id compartido).
   Esto YA es así en el modelo de datos. No se toca.
2. **El problema NO es el dato, es el gating.** Hoy `profiles.role` es un
   **valor único** y se usa para decidir TODO (qué panel ve, a qué rutas entra).
   Una persona con dos contextos (paciente + médico) no cabe en un `role` único.
3. **Recomendación central:** separar **identidad** (única) de **capacidades**
   (múltiples, derivadas de la existencia de filas: `doctors`, `clinic_members`,
   `patients` vinculados). El gating de navegación y la UI pasan a usar
   **capacidades derivadas**; la **RLS de datos ya usa existencia de filas**
   (`get_user_doctor_id()`, `is_clinic_member()`) y se mantiene.
4. **`profiles.role` se redefine** como "**rol primario / contexto por defecto**"
   (a dónde te manda el login si no elegís), no como "la única cosa que sos".
5. **Para el piloto**, el fix mínimo de alto valor es: **permitir que un médico/
   asistente acceda a "Mis atenciones" / perfil de paciente** (hoy bloqueado por
   `PatientOnlyRoute`), porque un médico también se atiende. Es **solo
   frontend/gating** (relajar el guard de ruta), **sin tocar RLS ni DB**. El
   resto (selector de contexto, roles múltiples formales) es post-piloto.
6. **Mantener las decisiones de credenciales sensibles** (cerradas en `s7_42` y
   cambio de teléfono): email/phone **no** se copian/asumen automáticamente; se
   completan/validan en reclamo o flujo de cuenta.

---

## 1. Modelo conceptual

### 1.1 Las capas de identidad (cómo es HOY en la DB)

| Capa | Tabla | Cardinalidad por persona | Qué representa |
|---|---|---|---|
| **Credenciales / auth** | `auth.users` | **1** | phone + email (login). UNIQUE phone (`users_phone_key`), UNIQUE email. |
| **Identidad global / perfil** | `profiles` (`id == auth.users.id`) | **1** | Nombre, DUI/DOB/género/dpto/muni (Paciente Global F2), `role` (único), avatar. |
| **Perfil profesional médico** | `doctors` (`profile_id → profiles`) | **0..1** (hoy) | `lucy_status`, especialidad, licencia, flags (`is_published`/`is_operational`/`booking_enabled`/`is_verified`). |
| **Membresía de clínica** | `clinic_members` (`profile_id`, `clinic_id`, `role`) | **0..N** | Relación operativa con una clínica. `clinic_member_role` = `owner`/`doctor`/`assistant` (¡enum distinto de `user_role`!). |
| **Ficha local de paciente** | `patients` (`clinic_id`-scoped, `profile_id` nullable) | **0..N** | La persona como paciente **dentro de una clínica**. `profile_id` la vincula a la identidad global (Paciente Global F1/F3). |
| **Expediente clínico** | `consultations`/`prescriptions`/`vitals`/… | colgado de `patients` | Datos clínicos **por ficha local**, no por identidad global. |

**Lectura:** la identidad **ya es única** (1 `auth.user` ↔ 1 `profiles`). Las
"facetas" de la persona son **filas relacionadas**: ser médico = tener `doctors`;
ser asistente/titular = tener `clinic_members`; ser paciente = tener `patients`
vinculados. **La persona puede tener varias a la vez.**

### 1.2 La tensión (raíz de los parches)

Hay **dos conceptos de "rol" superpuestos** y mal separados:

- **`profiles.role`** (`user_role`: `patient|doctor|assistant|admin`) — **único**,
  global. Se usa para **gating de navegación** (qué panel ves) y como gate de
  algunas RLS.
- **Capacidades reales** — derivadas de las filas (`doctors`, `clinic_members`,
  `patients`). **Múltiples.**

El sistema **colapsa la persona a un `profiles.role` único** y con eso decide
todo. Evidencia concreta en el código:

- `PatientOnlyRoute` exige `role === 'patient'` → **un médico (`role='doctor'`)
  NO puede entrar a `/paciente/mis-atenciones` ni `/paciente/perfil`**, aunque
  como persona también se atienda.
- `claim_doctor_profile` (`s7_13`) **promueve** `role` `patient → doctor`
  (sobrescribe, no acumula) → al volverse médico, "deja de ser paciente" a
  ojos del gating.
- Afiliación `reuse_patient` (`s7_42`) deja el profile en `role='patient'` hasta
  el reclamo, justamente para no romper el panel pre-claim — otro parche
  alrededor del `role` único.

**Conclusión:** el `role` único es un buen "default", pero es insuficiente como
**única fuente de verdad de qué puede hacer la persona**. La identidad no
necesita arreglo; el **gating sí**.

### 1.3 Distinción que hay que mantener explícita

- **Identidad global** (`profiles`) — quién es la persona. Única.
- **Perfil profesional médico** (`doctors`) — su faceta médica publicable.
- **Ficha local de paciente** (`patients`) — su faceta paciente **en una clínica**.
- **Expediente clínico** — historia clínica **por ficha**, sensible, separada de
  la identidad pública.

Un médico que se atiende en otra clínica es: misma `profiles`, su `doctors`
propio, **y** una `patients` (ficha local) en esa otra clínica con su expediente.
Todo cuelga de la misma identidad global. **El modelo de datos ya lo soporta;
el gating no.**

---

## 2. Flujos actuales (mapa identidad)

| Flujo | Qué hace hoy con la identidad | Tensión / estado |
|---|---|---|
| **Paciente reclama atenciones** (F1, `s7_20`) | OTP → vincula `patients` legacy por phone a su `profiles` | ✅ OK. Usa identidad única por phone. |
| **Médico solicita afiliación** (Fase 1/2, `s7_21`–`s7_24`) | Lead → admin crea `auth.user` dormant + `profiles` (`role='patient'` pre-claim) + `doctors listed_only` | ✅ OK (con parche `role='patient'` pre-claim). |
| **Paciente existente → médico** (`s7_42`) | Reusa el `profiles` del paciente, crea `doctors` sin nuevo `auth.user`; `role` sigue `patient`; `full_name` si vacío; **no toca phone/email** | ✅ Resuelto. Es el caso que motivó este análisis. |
| **Médico que también se atiende como paciente** | — | ❌ **No soportado**: `PatientOnlyRoute` bloquea a `role='doctor'`. Es médico **o** paciente, no ambos. |
| **Claim médico** (`s7_13`) | OTP + licencia + TOS → `role` `patient→doctor`, `lucy_status='claimed'`, re-apunta `doctors.profile_id` al `auth.user` real | ✅ OK, pero **sobrescribe** el rol (pierde faceta paciente en el gating). |
| **Cambio de teléfono OTP** (`s7_34`) | `auth.users.phone` → sync a `profiles`/`patients` vinculados; phone es credencial | ✅ OK. Refuerza "identidad única, credencial sensible". |
| **Email/phone como credenciales** | `s7_42` no copia email del lead; cambio de phone por OTP; admin no edita email a la ligera | ✅ Decisión cerrada: credenciales **se validan**, no se asumen. |

**Patrón:** todos los flujos ya tratan la **identidad como única por phone**.
Lo que falta es un modelo explícito de **múltiples capacidades** sobre esa
identidad para el gating/UX.

---

## 3. Reglas de producto (consolidadas + huecos)

### 3.1 Ya decididas (mantener)

- **Reutilizar cuenta**: cuando el teléfono es de un **paciente limpio** (con
  `profiles`, `role='patient'`, sin `doctors`, sin `clinic_members` activo) →
  `reuse_patient` (`s7_42`).
- **Bloquear**: ya es médico (`P0010`, con link), rol sensible/membresía
  (`P0011`), identidad ambigua por email (`P0012`).
- **Revisión manual**: `auth.user` sin `profiles` (anomalía → `P0011`), email de
  otra cuenta.
- **Auto-completar**: `full_name` **solo si está vacío**. **Nunca** phone/email.
- **Validar (no asumir)**: phone por OTP; email en reclamo/flujo de cuenta.
- **LucyAdmin controla**: creación de médico desde afiliación, `lucy_status`
  (verificación), `is_published`/`is_operational`/`booking_enabled`.

### 3.2 Huecos a definir (este análisis los abre)

- **¿Cuándo una persona "es" paciente Y médico a la vez?** Hoy el `role` único
  lo impide. Propuesta: **siempre que existan las filas** (`patients` vinculados
  ∧ `doctors`), independientemente de `profiles.role`.
- **¿Qué hace `claim` con el rol?** Hoy sobrescribe `patient→doctor`. Propuesta:
  `claim` **agrega** la capacidad médica sin destruir la paciente (la persona
  sigue pudiendo ver sus atenciones).
- **¿Un asistente puede además ser paciente?** Mismo criterio: capacidades
  derivadas, no excluyentes.
- **¿Qué pasa con `admin`?** Admin de plataforma es un rol sensible y, por
  política, **no** se mezcla con paciente/médico operativos en la misma cuenta
  (ya se bloquea en `s7_42` como `block_sensitive`). Mantener separado.

---

## 4. UX / UI

### 4.1 El problema visible
Una persona con dos contextos (p. ej. la médica Katherine que también es
paciente) hoy **solo ve uno** según su `profiles.role`. Si es `doctor`, pierde
"Mis atenciones"/perfil de paciente.

### 4.2 Propuesta de experiencia (incremental)

- **Fase corta (piloto):** **permitir** el acceso a `/paciente/mis-atenciones` y
  `/paciente/perfil` a toda persona autenticada con `role ∈ {patient, doctor,
  assistant}` (excluye `admin` y anon), aunque su `role` sea `doctor`/
  `assistant`. Es relajar `PatientOnlyRoute` de `role==='patient'` a ese
  conjunto. **Sin selector de modo todavía** (eso es Fase media). Los datos
  siguen protegidos por RLS — cada quien ve solo lo suyo.
- **Fase media:** **selector de contexto** post-login cuando la persona tiene
  más de una capacidad ("Entrar como médico" / "Mi cuenta de paciente"), con un
  toggle visible para cambiar de modo sin cerrar sesión. El **panel se elige por
  capacidad**, no por `role` único.
- **Onboarding/activación claros:** copy que diferencie "tu cuenta personal
  (paciente)" de "tu perfil profesional (médico, pendiente de activación)".
  Cuando un paciente se vuelve médico (reuse), el éxito debe decir: *"Tu cuenta
  sigue siendo la misma; agregamos tu perfil profesional, pendiente de reclamo/
  verificación"*.

### 4.3 Mensajería de credenciales
- Dejar explícito en la ficha admin que **email/phone son credenciales** y de
  dónde vienen (cuenta vs lead). (Hoy la ficha muestra el email de la cuenta;
  si está vacío, no asumir el del lead — ya decidido.)

---

## 5. Impacto técnico

> No es plan de implementación; es el mapa de dónde pega cada decisión.

- **`profiles.role`**: pasa de "gate único" a "**rol primario / default de
  navegación**". **No se elimina** (rompería RLS y mucho gating). Se
  **complementa** con capacidades derivadas.
- **Capacidades derivadas** (sugerido, lectura): un helper único
  (`get_user_capabilities()` o equivalente en frontend `useIdentity()`) que
  devuelva `{ isPatient, isDoctor, isAssistant, isAdmin, activeContext }`
  calculado de la existencia de `doctors`/`clinic_members`/`patients` + `role`.
  La **UI y los guards de ruta** lo consumen.
- **RLS de datos**: **se mantiene** — ya usa existencia de filas
  (`get_user_doctor_id()`, `is_clinic_member()`, `is_admin()`). **Importante:**
  no debilitar la RLS por la UX. El gating de navegación (UX) y la autorización
  de datos (RLS) son capas distintas; esta propuesta toca la primera.
- **Guards de ruta**: `PatientOnlyRoute` / `DoctorOnlyRoute` → basados en
  capacidades, no en `role` único. (`DoctorOnlyRoute` ya usa `useClinicContext`,
  que es existencia de `doctors`; `PatientOnlyRoute` es el que hay que relajar.)
- **`claim_doctor_profile`**: revisar si debe **dejar de sobrescribir** el rol y
  en su lugar marcar la capacidad médica como activa (decisión a tomar; impacta
  el panel pre/post claim).
- **`patients`**: la ficha local sigue por clínica; el vínculo `profile_id` es lo
  que une las facetas. Sin cambios estructurales.
- **Recuperación de acceso sin sesión (#3)**: se apoya **directamente** en
  identidad única — encontrar a la persona por phone/email/DUI y restaurar
  acceso. Sin un modelo claro de identidad, esta herramienta es riesgosa. → este
  análisis es **prerequisito** de #3.
- **Paciente Global Fase 4 — merge admin (#4)**: merge = fusionar dos
  identidades (`auth.users`/`profiles`) que son **la misma persona** (duplicados),
  re-vinculando `patients`/`doctors`/`clinic_members`/expedientes. El modelo de
  identidad única es **el marco** del merge. → este análisis es **prerequisito**
  de #4.

---

## 6. Backlog priorizado y fases

### Fase 0 — Documental (este doc) ✅
Fijar el modelo "identidad única + capacidades múltiples" como decisión de
producto. Sin código.

### Fase 1 — Fix mínimo de piloto (chico, bajo riesgo)

**Alcance: SOLO frontend / gating de ruta. Sin cambios de RLS, sin migración,
sin tocar `profiles.role` ni el modelo de datos.**

- **`PatientOnlyRoute` deja de ser "solo `patient`".** Regla nueva: permite el
  acceso a **personas autenticadas con rol `patient`, `doctor` o `assistant`**;
  **excluye `admin`** (cuenta privilegiada de plataforma, separada en MVP) y
  **excluye anon** (sin sesión → fuera). Es decir: gate = "hay sesión Y
  `role ∈ {patient, doctor, assistant}`".
- Aplica a `/paciente/mis-atenciones` y `/paciente/perfil`.
- **Los datos siguen protegidos por RLS.** Abrir la ruta **no** abre datos de
  otros: las páginas de paciente filtran por `auth.uid()` / `profile_id` vía
  RLS. Una persona solo ve sus propias atenciones/perfil, venga del rol que
  venga. La seguridad sigue viniendo de las policies y de la relación real de
  datos, no del guard de navegación.
- **NO hay selector de "modo paciente / modo médico" en esta fase** — eso es
  Fase 2. Acá solo se desbloquea el acceso.
- Copy de onboarding/activación que diferencie cuenta personal vs perfil
  profesional (especialmente en el éxito de `reuse_patient`).
- Reversible (es un cambio de guard).

**Validación esperada de Fase 1 (a ejecutar cuando se implemente):**
- ✅ paciente entra a `/paciente/mis-atenciones`;
- ✅ médico entra a `/paciente/mis-atenciones`;
- ✅ asistente entra a `/paciente/mis-atenciones`;
- ⛔ admin queda fuera (redirige);
- ⛔ anon (sin sesión) queda fuera (redirige);
- 🔒 ningún usuario ve datos que no le corresponden (RLS intacta: cada quien ve
  solo lo suyo).

### Fase 2 — Capacidades derivadas + selector de contexto (medio)
- Helper único de capacidades (frontend `useIdentity()` + opcional RPC
  `get_user_capabilities()`).
- Selector "modo paciente / modo médico" post-login y toggle en el header.
- Guards de ruta migrados a capacidades.
- `claim_doctor_profile`: decidir si deja de sobrescribir el rol.

### Fase 3 — Habilitadores dependientes (cada uno su propio análisis/PR)
- **Recuperación de acceso sin sesión (#3)** — se apoya en Fase 1/2.
- **Paciente Global Fase 4 — merge admin (#4)** — se apoya en el modelo de
  identidad única; diseño dedicado (audit + reversibilidad + dry-run).

### Qué bloquea qué
- #3 y #4 **no deberían arrancarse** antes de cerrar el modelo (Fase 0) — hoy se
  decidirían a ciegas. Con este doc, ambos tienen marco.
- Fase 1 es **independiente y desplegable para piloto** sin esperar a Fase 2.

---

## 7. Riesgos

- **Tocar `profiles.role` / RLS es sensible** → la propuesta **NO** cambia la
  autorización de datos (RLS sigue por existencia de filas); solo cambia el
  gating de navegación/UX. Mantener esa separación es la mitigación principal.
- **No debilitar gates de seguridad por UX**: relajar `PatientOnlyRoute` debe
  seguir excluyendo `admin` y no exponer datos de otros (las páginas de paciente
  ya filtran por `auth.uid()`/`profile_id` vía RLS).
- **Confusión de contexto**: un toggle mal diseñado puede hacer que alguien crea
  que firma como médico estando "en modo paciente". El selector debe ser
  explícito y el panel clínico siempre exige capacidad médica real (RLS).
- **Migración de `claim`**: cambiar el comportamiento del rol en el reclamo puede
  afectar el flujo pre/post-claim del panel; hacerlo con smoke dedicado.

---

## 8. Decisiones del owner — ✅ APROBADAS (2026-06-08)

1. ✅ **Modelo "identidad única + capacidades múltiples" confirmado.** Una
   persona = una identidad base (`auth.users`/`profiles`) con capacidades/
   contextos múltiples (paciente/médico/asistente/admin). `profiles.role` =
   **rol primario/default (o legacy) de navegación**, no la única identidad.
2. ✅ **Fase 1 para piloto: SÍ.** Médico y asistente deben poder acceder a su
   lado paciente (`/paciente/mis-atenciones`, `/paciente/perfil`). **Sin tocar
   RLS.** La seguridad sigue viniendo de las policies y la relación real de
   datos. **Admin no se mezcla** en esta fase.
3. ✅ **Admin se mantiene como cuenta separada** (cuenta privilegiada de
   plataforma; no mezclar con paciente/médico en MVP).
4. ✅ **No tocar el claim médico todavía.** Por ahora `claim` puede seguir
   seteando `profiles.role='doctor'`; el cambio inmediato es que ese rol **ya
   no bloquee** el acceso al lado paciente. En Fase 2 se revisa si `role` queda
   como rol primario/default, contexto activo, o se migra a capacidades
   explícitas.
5. ✅ **#3 (recuperación sin sesión) y #4 (merge admin) quedan detrás de este
   modelo.** No se diseñan sin la regla de identidad/capacidades clara.

---

## 9. Relación con otros docs
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — modelo de paciente global (F1–F5); este
  doc lo extiende al lado profesional/médico y al gating.
- `docs/PLAN_AFILIACION_MEDICO.md` + `s7_42` — afiliación y `reuse_patient`.
- `docs/ANALISIS_AUTH_MEDICO.md` — credenciales (email/password, cambio de
  teléfono); credenciales sensibles.
- `CLAUDE.md` → "Decisiones cerradas / dominio" — roles y ejes del médico.
