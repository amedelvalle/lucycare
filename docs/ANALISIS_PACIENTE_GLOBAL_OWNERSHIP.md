# Análisis — Ownership del paciente: "el paciente es de LucyCare, no del médico"

> Mini-doc de análisis (docs-only, sin código). Revisa el modelo de Paciente
> Global desde la **regla central de producto** que fija el owner:
>
> **El paciente/usuario es de LucyCare. El médico tiene una relación
> clínica/local con ese paciente, pero no "posee" su identidad global.**
>
> La identidad global pertenece a Lucy: cuenta, acceso, teléfono/email
> (credenciales), perfil personal, deduplicación, recuperación, historial
> cross-médicos y "Mis atenciones".
>
> Snapshot de referencia: HEAD `1945588`, migraciones hasta `s7_42`,
> PRs #1–#126. Complementa (no reemplaza) `docs/ANALISIS_PACIENTE_GLOBAL.md`
> y `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md`.

---

## 1. Resumen ejecutivo

**La arquitectura ya implementa la regla central en un ~85%.** Las Fases 1–3
y 5 de Paciente Global construyeron exactamente este modelo: identidad global
en `profiles` (canónica, editada por el paciente), ficha local `patients` por
clínica (espejo sincronizado + datos operativos del médico), guard server-side
que **impide al médico editar la identidad de un paciente vinculado** (P0030),
credenciales gestionadas por Lucy (cambio de teléfono por OTP), y "Mis
atenciones" cross-clínica con filtro explícito por persona (Fase 1 de
identidad múltiple).

**El ~15% restante es la ventana pre-reclamo:** mientras el paciente no
reclama su cuenta (walk-in, `profile_id IS NULL`), la ficha es 100% del médico
por decisión explícita (DA3) — el médico escribe nombre, teléfono, documento y
email libremente. Esa ventana es donde viven los riesgos reales de ownership:
un teléfono mal tipeado vincula la ficha a la persona equivocada cuando esa
persona haga OTP; los duplicados nacen ahí; y el dato "email" convive en dos
capas con semánticas distintas. Ninguno de estos riesgos requiere rediseño —
requieren **reglas de producto explícitas** (sección 6) y 2–3 ítems de backlog
acotados (sección 8).

**Recomendación de siguiente PR real:** ninguno de los hallazgos exige código
urgente pre-piloto. El frente que más refuerza la regla central es **Paciente
Global Fase 4 (merge admin de duplicados)** — es la herramienta que le permite
a Lucy ejercer la propiedad de la identidad (fusionar duplicados es un acto de
"dueño de la identidad") — y este doc le deja el marco listo. La alternativa
acotada es cerrar los riesgos R1/R2 de la ventana pre-reclamo.

---

## 2. Regla central (canónica, para futuros flujos)

> **Lucy es dueña de la identidad. El médico es dueño de su relación clínica.**

Derivaciones operativas:

1. La **cuenta** (`auth.users`: teléfono, email, password) es de Lucy y del
   paciente. El médico nunca la crea*, nunca la edita, nunca la recupera.
   (*Excepción controlada: afiliación crea auth.users dormant para MÉDICOS,
   no para pacientes; LucyAdmin mediante.)
2. La **identidad global** (`profiles`: nombre, DUI, DOB, género, ubicación)
   es del paciente, custodiada por Lucy. El médico la **lee**; no la escribe.
3. La **ficha local** (`patients`: tipo de sangre, alergias, contacto de
   emergencia, notas, tipo de paciente, foto, is_active) es la relación del
   médico/clínica con esa persona. El médico la administra.
4. El **expediente clínico** (consultas, recetas, vitales, diagnósticos,
   antecedentes) es del médico tratante dentro de su clínica, con
   inmutabilidad post-firma. El paciente NO lo ve en MVP (solo metadatos
   operativos en "Mis atenciones" — DA4).
5. La **vinculación** identidad↔ficha solo ocurre con prueba de posesión
   (phone OTP — DA2). La **fusión** de identidades duplicadas es potestad de
   LucyAdmin (Fase 4, pendiente).
6. **Pre-reclamo** la ficha es editable por el médico (DA3) — es una ficha
   "candidata a persona", no una identidad. Al reclamar, la identidad global
   gana y la ficha pasa a espejo (s7_33).

---

## 3. Mapa de entidades (vista de ownership)

| Entidad | Dueño | Qué representa | Estado |
|---|---|---|---|
| `auth.users` | **Lucy** (credenciales del usuario) | Login: phone (OTP), email+password | ✅ alineado: cambio de phone por OTP (`s7_34`); médico sin acceso |
| `profiles` | **Paciente** (custodiada por Lucy) | Identidad global: nombre, DUI, DOB, género, dpto/muni, rol | ✅ alineado: UPDATE column-restricted self-only (`s7_32`); admin vía RPCs auditadas |
| `patients` | **Médico/clínica** (relación local) | Ficha por clínica: identidad-espejo + datos locales | ✅ alineado post-reclamo (guard P0030 `s7_33`); ⚠ pre-reclamo es 100% del médico (DA3, deliberado) |
| `appointments` | Clínica (operativo) | Cita | ✅ paciente ve las suyas (`appointments_self_select` `s7_20` + filtro explícito #125) |
| `consultations` / `prescriptions` / `vitals` / diagnósticos / antecedentes | **Médico tratante** | Expediente clínico | ✅ alineado: doctor-scoped (`s7_26`), inmutable post-firma (`s7_28..s7_31`), asistente sin acceso clínico, paciente sin acceso en MVP (DA4) |
| `clinic_members` | Clínica (titular) | Membresía operativa | ✅ no toca identidad |
| `doctors` | **Lucy** (perfil profesional publicable) | Faceta médica de una persona | ✅ LucyAdmin controla `lucy_status`/flags |
| `waitlist_entries` / `doctor_affiliation_requests` | **Lucy** (leads) | Interés capturado por la plataforma | ✅ admin-only |

**Cadena de identidad:** `auth.users (1) ↔ profiles (1) ← patients (0..N por
clínica) ← expediente`. La identidad es una; las relaciones clínicas son N.

---

## 4. Datos: globales (Lucy) vs locales (clínica) — quién edita qué

| Dato | Capa | Edita paciente | Edita médico/asistente | Edita LucyAdmin | Audit |
|---|---|---|---|---|---|
| Teléfono (credencial) | `auth.users` + sync | ✅ solo por OTP (`s7_34`) | ❌ vinculado (P0030); ⚠ libre pre-reclamo | ⚠ solo vía RPC de médicos (`admin_update_doctor_profile`); pacientes: no hay herramienta (soporte manual) | ✅ `phone_change` |
| Email (credencial/contacto global) | `auth.users`/`profiles` | ⚠ sin self-service aún (post-piloto, Fase Auth) | ❌ vinculado; ⚠ libre pre-reclamo (campo local `patients.email`) | ⚠ ídem teléfono | ✅ |
| Password | `auth.users` | ✅ (reset email / claim) | ❌ | ❌ (no la ve) | n/a |
| Nombre, DUI, DOB, género, dpto/muni | `profiles` | ✅ (`/paciente/perfil`, `s7_32`) | ❌ vinculado (P0030, read-only en UI #91); ⚠ libre pre-reclamo (espejo local) | ✅ casos puntuales (p. ej. médicos vía ficha admin) | ✅ `profile_identity` |
| `role` / `is_active` del profile | `profiles` | ❌ (column-restricted) | ❌ | ✅ (flujos controlados: claim, afiliación) | ✅ |
| Sangre, alergias, emergencia, notas, tipo, foto, is_active de ficha | `patients` (local) | ❌ (no ve la ficha) | ✅ siempre (incluso vinculado) | — | ✅ trigger patients |
| Expediente clínico | clínica | ❌ (DA4) | ✅ médico dueño; firmado = inmutable + amend auditado | ❌ (sin contenido clínico para admin) | ✅ |
| Vinculación ficha↔identidad (`patients.profile_id`) | sistema | ✅ implícita por OTP (claim) | ❌ | ⏳ Fase 4 (merge) | ✅ `claim/retroactive_link` |

**Lectura de la tabla:** las dos únicas celdas "⚠" estructurales son
(a) la **ventana pre-reclamo** (columna médico) y (b) el **email** (sin
self-service del paciente y con doble capa global/local). Todo lo demás ya
respeta la regla central.

---

## 5. Qué ya está alineado (confirmado en código/migraciones)

1. **Identidad global en `profiles`** con UPDATE column-restricted: el
   paciente edita su identidad; no puede tocar `role`/`is_active`/`phone`
   (`s7_32`). Verificado.
2. **Guard server-side P0030** (`s7_33`): médico/asistente NO puede editar
   `full_name`/`phone`/`email`/`document_*`/`date_of_birth`/`gender` de una
   ficha **vinculada** (`profile_id IS NOT NULL`). UI del médico muestra esos
   campos read-only ("Datos gestionados por el paciente"). Verificado (campos
   exactos en el trigger).
3. **Sync espejo `profiles → patients`** (`s7_33`): la verdad fluye de la
   identidad global hacia las fichas, nunca al revés (claim copia global→local
   una vez; local no promueve a global). Dirección correcta de ownership.
4. **Credencial teléfono**: cambio solo por OTP del propio paciente
   (`s7_34`); el trigger sincroniza profiles+patients con bypass del guard.
5. **"Mis atenciones" cross-médicos** (`s7_20` + #125): el paciente ve sus
   atenciones de TODAS las clínicas (metadatos operativos, sin contenido
   clínico), con **filtro explícito por persona** (lección de #125: RLS
   autoriza, no define semántica).
6. **Dedup preventivo** (F5, `s7_35`/`s7_40`): al crear ficha se avisa si la
   persona ya existe (intra con detalle, cross sin PII) — Lucy protege la
   unicidad de la identidad sin revelar datos entre clínicas.
7. **Identidad múltiple Fase 1** (#124/#125): persona = identidad única con
   capacidades; médico/asistente acceden a su lado paciente. El "ser paciente"
   no es propiedad de un rol.
8. **Afiliación reuse_patient** (`s7_42`): cuando un paciente se vuelve
   médico, Lucy **reusa** su cuenta (no crea otra) y NO toca sus credenciales.
   Coherente con "la cuenta es de la persona/Lucy".
9. **Asistente**: operativo, sin acceso clínico (`s7_26`), sujeta al mismo
   guard P0030. Gestiona agenda/fichas locales, no identidades.

---

## 6. Ambigüedades y riesgos actuales

> Severidad: 🔴 alta · 🟡 media · 🟢 baja. Ninguno bloquea el piloto chico;
> R1/R2 son los que más conviene cerrar antes de escalar volumen.

- **R1 🟡 — Vinculación por teléfono tipeado por el médico (ventana
  pre-reclamo).** `claim_patient_records` vincula TODA ficha sin `profile_id`
  cuyo teléfono coincida con el OTP del que se loguea (verificado: match por
  dígitos, `s7_20`). Si el médico tipeó mal el teléfono de un walk-in, la
  ficha (y sus citas en "Mis atenciones") se vincula a la persona equivocada
  cuando el dueño real de ese número entre a Lucy. Expone metadatos
  (médico/clínica/fecha) de un tercero. Mitigado parcialmente por el dedup F5
  (advisory). **No hay confirmación del paciente ni reversa self-service.**
- **R2 🟡 — Teléfonos compartidos (familiares, responsables de menores).**
  Decisión vieja de F5: "el teléfono NUNCA es señal fuerte". Pero el claim de
  F1 SÍ vincula automáticamente por teléfono. Una madre que registra a sus
  hijos con su número se llevará las fichas de los hijos a SU identidad al
  loguearse. Puede ser deseable (responsable legal) o no (hermano adulto con
  número heredado). **Regla de producto sin definir.**
- **R3 🟡 — Email con doble capa y semántica ambigua.** `patients.email`
  (local, editable por médico pre-reclamo) vs `profiles.email`/`auth.users.email`
  (credencial). El sync de s7_33 propaga `profiles.email → patients.email`,
  pero pre-reclamo el médico escribe el local libremente y NO existe
  self-service del paciente para su email global (Fase Auth post-piloto).
  Decisión ya tomada en `s7_42` (no copiar email del lead) apunta en la
  dirección correcta; falta la misma claridad para fichas de pacientes.
- **R4 🟢 — Recuperación de cuenta = soporte manual.** Si el paciente pierde
  el teléfono sin email/password, hoy depende de LucyAdmin manual sin
  herramienta formal ni protocolo de verificación de identidad. Lucy es dueña
  de la cuenta → Lucy necesita la herramienta (frente ya en cola, detrás del
  modelo de identidad).
- **R5 🟢 — Duplicados históricos sin herramienta de fusión.** F5 previene
  nuevos; los existentes (y los que el UNIQUE de documento destape) esperan
  Fase 4 (`admin_merge_patients`). Mientras tanto, una persona puede tener 2
  identidades Lucy (p. ej. cambió de número antes de reclamar).
- **R6 🟢 — `patients.phone` editable pre-reclamo sin normalización
  obligatoria en todos los caminos.** `createBasicPatient` normaliza
  (`normalizePhoneSV`) y `updatePatient` también; el riesgo residual es bajo
  (legacy ya cubierto por `normalize_phone_sv` en F5/s7_40), pero la edición
  manual del teléfono de una ficha NO vinculada sigue siendo el insumo del
  claim (alimenta R1).
- **R7 🟢 — Copy/percepción.** En el panel el médico ve "Pacientes" como
  "sus" pacientes. Es correcto operativamente (su relación clínica), pero el
  onboarding del médico no explica que la identidad es de Lucy (aparece recién
  al ver campos bloqueados). Oportunidad de copy, no de código.

**Dónde el médico todavía "parece dueño" (resumen):** solo en la ventana
pre-reclamo (DA3) y en la percepción de UI (R7). Post-reclamo, el modelo ya
le quita la identidad de las manos (P0030 + read-only + sync unidireccional).

---

## 7. Decisiones de producto recomendadas (a validar por el owner)

- **D1 — Ratificar la regla central** tal como está en §2, como criterio
  vinculante para futuros flujos (recuperación, merge, onboarding, pagos).
  *(Recomendado: sí — el código ya la implementa en su mayoría.)*
- **D2 — Ventana pre-reclamo se mantiene (DA3), con límites explícitos:** la
  ficha pre-reclamo es "borrador de relación clínica", no identidad; el
  teléfono que el médico tipea es **dato de contacto candidato**, y la
  vinculación sigue requiriendo OTP del dueño del número. *(Sin cambio de
  código; es formalizar la semántica.)*
- **D3 — Mitigar R1 con confirmación del lado del paciente (backlog, no
  ahora):** al primer login, si el claim vinculó fichas, mostrar "Encontramos
  N atenciones asociadas a tu número — ¿son tuyas?" con opción de reportar
  ("no soy yo") que desvincula y notifica a LucyAdmin. Server-side simple
  (des-vincular = `profile_id = NULL` + audit). *(Recomendado: post-piloto,
  antes de escalar volumen.)*
- **D4 — Teléfonos compartidos (R2):** regla propuesta — el claim vincula
  por teléfono SOLO fichas cuyo nombre "matchee razonablemente" O mantener el
  comportamiento actual + D3 como red. *(Recomendado: actual + D3; el match
  por nombre genera falsos negativos y complejidad. Pero es decisión de
  producto, no técnica.)*
- **D5 — Email:** ratificar que `profiles.email`/`auth.users.email` es
  credencial gestionada por el paciente (self-service en Fase Auth
  post-piloto) y `patients.email` es contacto local de la clínica. El sync
  global→local se mantiene; nunca local→global. *(Coherente con s7_42.)*
- **D6 — Merge de identidades = potestad exclusiva de LucyAdmin** con
  herramienta auditada y reversible (Fase 4). El médico nunca fusiona.
- **D7 — Recuperación de cuenta = herramienta de LucyAdmin** con protocolo de
  verificación de identidad definido por el owner (qué evidencia pedir).
  El médico no recupera cuentas de pacientes.

---

## 8. Backlog priorizado (sin abrir ninguno ahora)

| # | Ítem | Severidad | Tamaño | Cuándo |
|---|---|---|---|---|
| B1 | **Paciente Global Fase 4 — `admin_merge_patients`** (dry-run + audit + reversibilidad; resuelve R5; marco ya listo: identidad única) | 🟡 | Grande | Próximo frente grande recomendado |
| B2 | **Confirmación post-claim "¿son tuyas?" + des-vinculación reportada** (D3; cierra R1/R2) | 🟡 | Medio | Post-piloto, antes de escalar |
| B3 | **Recuperación de cuenta sin sesión (herramienta LucyAdmin + protocolo)** (R4, D7) | 🟢 | Medio | En cola (ya estaba; detrás del modelo de identidad) |
| B4 | **Self-service de email del paciente** (R3, D5 — análogo al cambio de teléfono) | 🟢 | Medio | Fase Auth post-piloto (ya previsto) |
| B5 | **Copy de onboarding del médico**: "la cuenta del paciente es de él; tu ficha clínica es tuya" (R7) | 🟢 | Chico | Oportunista |
| B6 | `accept_clinic_invitations` teléfono literal (hallazgo QA #125, ya registrado) | 🟢 | Chico | Oportunista |
| B7 | ⚠ Operativo: re-guardar nombre de Katherine desde ficha admin (ya registrado) | 🟢 | Manual | Owner |

---

## 9. Conexión con frentes pendientes

- **Fase 4 merge admin:** este doc ES su marco. Reglas que hereda: merge =
  fusionar identidades Lucy (no fichas); decide LucyAdmin; auditado y
  reversible; la nota del UNIQUE de F3 sigue vigente. **No se abre todavía.**
- **Recuperación sin sesión:** hereda D7 (herramienta Lucy + protocolo de
  verificación). Detrás de este modelo, como ya estaba decidido.
- **Onboarding paciente:** hereda D2/D3 (claim como "encontrar mis
  atenciones" + confirmación futura). Sin cambios inmediatos.
- **Onboarding médico:** hereda R7/B5 (copy de expectativas: la identidad no
  es suya) y lo ya cerrado en afiliación (`s7_42`).
- **Identidad múltiple Fase 2:** complementario, no dependiente — el selector
  de contexto opera sobre la misma identidad única. Pueden avanzar en
  cualquier orden.
- **Paginación Home / Pagos:** no aplican a este análisis (confirmado).

---

## 10. Dudas / supuestos no verificados

1. **Policies INSERT/UPDATE de `patients` para clinic members** viven en el
   schema base (pre-migraciones `s7_*`); el comportamiento está validado por
   los smokes de F3/F5 pero no re-leí esas policies en esta pasada.
2. **Volumen real de R1/R2** (fichas con teléfono de tercero): no medido en
   DB. Si se quiere dimensionar antes de priorizar B2, es una query de
   diagnóstico (fichas sin `profile_id` agrupadas por teléfono repetido
   cross-clínica).
3. **Menores de edad**: el modelo actual no tiene concepto de
   tutor/responsable; R2 los cubre de facto (teléfono del responsable). Si el
   piloto trae pediatría, conviene decisión explícita (¿ficha de menor
   vinculada a identidad del tutor?). No inventé regla — queda como pregunta.
4. Asumo que `waitlist_entries`/leads no necesitan tratamiento de identidad
   (son pre-identidad); si Lucy quisiera convertir leads de waitlist en
   cuentas, aplicarían las mismas reglas (OTP primero).

---

## 11. Relación con otros docs

- `docs/ANALISIS_PACIENTE_GLOBAL.md` — diseño técnico de Fases 1–5 (este doc
  agrega la capa de ownership/reglas de producto).
- `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md` — identidad única +
  capacidades (persona con varios contextos).
- `docs/ANALISIS_AUTH_MEDICO.md` — credenciales y fases de auth.
- `CLAUDE.md` §Decisiones cerradas — DA1–DA4 (siguen vigentes; este doc las
  enmarca en la regla central).
