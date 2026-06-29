# Análisis — Pagos SaaS autoservicio (suscripción del médico)

> Documento de análisis + decisión. **Snapshot original 2026-06-01 · refresh 2026-06-29 (post-#193, HEAD `e048ee4`).**
> **Estado: diseño vigente / BORRADOR para discusión. NO implementar código ni tocar la
> DB hasta cerrar las preguntas de la §10 y elegir pasarela (§4).**
> El cuerpo (§1–§13) sigue válido tal cual. Ver **§0bis (Refresh)** para el
> estado actual del repo y los deltas desde el snapshot original.
>
> Acompaña a:
> - `docs/ANALISIS_AFILIACION_MEDICO.md` — cómo entra un médico (lead → listed_only).
> - `docs/ANALISIS_RECLAMAR_PERFIL.md` — cómo reclama (`listed_only` → `claimed`).
> - `docs/HANDOFF_LUCYCARE_SPRINT7.md` — ejes del médico (`is_operational`, `booking_enabled`, `is_verified`).
>
> ⚠️ **Stripe NO es decisión cerrada.** Es el candidato técnico principal,
> pero su disponibilidad legal/operativa para una empresa que opera
> **desde El Salvador** debe validarse antes de comprometerlo (§4).

---

## 0bis. Refresh — estado actual del repo (2026-06-29, HEAD `e048ee4`)

> Esta sección se agregó en un refresh docs-only. **No cambia el diseño**
> (§1–§13 siguen vigentes); solo reconcilia el documento con el estado real
> del código a hoy y marca lo que ya existe vs. lo que sigue pendiente.

### 0bis.1 Estado de implementación
- **HEAD `e048ee4`, PRs #1–#193 mergeados, migraciones hasta `s7_51`.**
- **Pagos: SIN implementación.** No existe ninguna pantalla de pago, checkout,
  ni gate de suscripción. La activación operativa (`is_operational` /
  `booking_enabled`) **sigue siendo 100% manual** por LucyAdmin.
- **NO existen las tablas `subscriptions` ni `subscription_events`** (verificado:
  0 referencias en `migrations/`; solo aparecen como **propuesta** en este doc).
  El modelo del §8 sigue siendo diseño, no esquema.
- **Edge Functions / webhooks: siguen SIN usarse** en el proyecto. El
  `payments-webhook` del §8.2 sería la **primera** Edge Function (R10 vigente).

### 0bis.2 Lo que YA existe y es punto de enganche (no rehacer)
- **Infra de asientos parcialmente construida y LIVE (`s7_27`, PR #70):**
  - `team_seat_limit(p_clinic_id)` → hoy retorna **`2` fijo**, con un
    **`TODO(pagos)` explícito** en la migración para reemplazarlo por los
    asientos contratados en la suscripción. **Toma `p_clinic_id` justamente
    para que la fase de pagos lo lea de `subscriptions`.**
  - `team_seats_used(...)` cuenta asistentes activos + invitaciones pendientes
    (excluye vencidas desde `s7_36`).
  - **Enforcement server-side ya activo:** trigger `enforce_team_seat_limit`
    en `clinic_invitations` + revalidación en `accept_clinic_invitations`.
  - ⇒ **La Fase 5 (§11) se acorta:** básicamente cambiar el `2` fijo por
    `3 + seats_additional` leído de la suscripción; el enforcement ya está.

### 0bis.3 Reconciliación de semántica de asientos (a tener en cuenta)
- El **modelo comercial (§2.2)** habla de **3 usuarios totales = titular + 2
  asistentes**.
- `team_seat_limit` hoy representa **asistentes (= 2), NO el total de usuarios**
  (el titular no se cuenta en ese número).
- Al wirear pagos hay que **alinear semánticas**: `subscriptions.seats_included`
  (pensado como "3 totales") ⟷ lo que devuelve `team_seat_limit` (asistentes).
  No es contradicción, pero **debe quedar explícito** para no contar mal el
  cupo. Sugerencia: documentar `seats_included` como "asistentes incluidos = 2"
  o derivar `team_seat_limit = seats_included_total - 1 (titular)`.

### 0bis.4 Principios reconfirmados por el owner (2026-06-29)
- **Separación de ejes (vinculante):** `verified`/confianza/licencia **NO**
  depende del pago; `claimed`/identidad **NO** depende del pago. El pago impacta
  **solo operatividad SaaS** (`is_operational`, `booking_enabled`, asientos/
  asistentes, capacidades operativas) — nunca el sello `is_verified` ni el claim.
- Enfoque confirmado: **hosted checkout / pasarela externa + webhook firmado +
  idempotencia + alta/baja automática + reactivación + audit + override manual
  de LucyAdmin**.
- El botón/enlace de pago es **solo la entrada**; lo crítico es el ciclo
  recurrente y el estado de pago gobernado por el webhook (no por el redirect).

### 0bis.5 Bloqueantes vigentes antes de cualquier código
1. **Validación de pasarela (§4.5)** — owner/legal. Sin proveedor elegido no se
   integra nada.
2. **Q1–Q11 (§10)** sin cerrar (gating exacto, trial, prorrateo, multi-doctor,
   self-service vs portal, etc.).
3. **IVA / DTE / facturación (Q6)** — legal/contable; no asumir "IVA incluido".
4. **Reglas exactas de suspensión / reactivación / período de gracia / cancelación
   / conciliación manual** — cerrar antes de la máquina de estados real.

> **Siguiente paso (sin cambios respecto al original):** el owner ejecuta §4.5 y
> responde §10. Recién con pasarela elegida + Q's cerradas arranca la Fase 1
> (modelo de datos `subscriptions`/`subscription_events`).

---

## 1. Problema y objetivo

Hoy el médico puede llegar a `claimed` (reclamó su perfil) pero **no hay
forma de cobrarle** ni de gatear el acceso al panel según un pago. La
activación operativa (`is_operational`, `booking_enabled`) se hace hoy
manualmente por LucyAdmin.

**Objetivo:** monetizar LucyCare como SaaS de suscripción **autoservicio**:
el médico reclama → elige plan → paga con tarjeta → un webhook confirma →
Lucy activa el acceso automáticamente, con renovación recurrente y manejo
de fallos/cancelaciones. Sin intervención manual de LucyAdmin en el camino
feliz.

**No-objetivos de este documento:**
- No define el diseño visual final de las pantallas de pago.
- No cierra la pasarela (eso requiere validación con proveedores, §4).
- No incluye facturación tributaria DTE (diferida — decisión de stack:
  "Facturación DTE: API externa, no se desarrolla internamente").

---

## 2. Modelo comercial

> ⚠️ **PRECIOS SUPERSEDED — ver §14 (modelo comercial APROBADO 2026-06-29).**
> Los montos de §2.1/§2.2 ($55/mes, $594/año, 10% off, $5/usuario) son la
> **propuesta original (2026-06-01)** y quedan como histórico. **Los precios
> vigentes y aprobados están en §14** ($59/mes, $601.80/año, 15% off,
> $6/usuario), con desglose IVA-incluido y montos en centavos. Ante cualquier
> contradicción, **mandan §14**.

### 2.1 Planes

| Plan | Precio | Equivalente mensual | Incluye |
|---|---|---|---|
| **Mensual** | **$55 / mes** | $55 | 1 médico titular + 2 usuarios/asistentes = **3 usuarios** |
| **Anual** | **$594 / año** (10% off) | $49.50 | Igual: 3 usuarios |

Cálculo anual: `$55 × 12 = $660`; `−10% = −$66`; **`$594/año`**. ✔

### 2.2 Usuarios incluidos vs adicionales

- **Incluidos en el plan base: 3 usuarios totales.**
  - 1 médico **titular** (owner de la clínica).
  - 2 usuarios/asistentes adicionales.
- **Usuario adicional (4º en adelante): $5 / mes** por usuario, o su
  equivalente anual.
  - **Decisión pendiente (Q3):** ¿el adicional anual lleva el mismo 10%
    (→ $54/año/usuario) o es $5×12=$60 plano? Default sugerido: mismo
    descuento por consistencia ($54/año).
  - **Decisión pendiente (Q4):** ¿prorrateo al agregar/quitar un asiento a
    mitad de ciclo? Default MVP: cobro del adicional **desde el próximo
    ciclo** (sin prorrateo intra-período); el asiento se habilita al
    confirmarse el cargo.

### 2.3 Notas de modelo

- **Unidad comercial (MVP) = el médico titular.** El plan se vende por
  **1 médico titular + 2 usuarios/asistentes = 3 accesos**. El pricing es
  **por médico titular**, no por clínica.
- **Anclaje técnico:** la suscripción se ancla a `clinic_id` porque hoy la
  clínica funciona como **tenant operativo** y en el MVP hay **1 titular
  por clínica** (el `owner` de `clinic_members`). Es un detalle de
  implementación, no el modelo comercial.
- **Multi-médico dentro de una misma clínica** (varios titulares bajo un
  mismo tenant) **no es MVP** → queda como **Q11 / fase posterior**
  (requerirá repensar si la unidad de cobro pasa a ser el médico aunque
  compartan `clinic_id`).
- "Usuario/asistente" = fila en `clinic_members` con rol distinto de
  cancelado/inactivo. El titular cuenta dentro de los 3.
- Moneda: **USD** (El Salvador usa USD como moneda de curso legal → sin
  conversión cambiaria si la pasarela liquida en USD).
- **Decisión pendiente (Q5):** ¿hay trial gratis (ej. 14 días) o el pago
  es requisito inmediato post-reclamo? Default sugerido: **sin trial** en
  el MVP (pago para activar), evaluable después.
- **Decisión pendiente (Q6) — NO cerrar todavía:** los precios comerciales
  base son **$55 mensual** y **$594 anual**. **Pendiente de validación
  legal/contable/fiscal:** si esos montos **incluyen o no IVA (13% SV)**,
  **cómo se factura** y **cómo se emiten los comprobantes** (coordinar con
  el flujo DTE diferido). **Debe resolverse antes de la implementación**;
  no se asume "IVA incluido".

---

## 3. Flujo autoservicio (camino feliz + bordes)

### 3.1 Camino feliz

```
1. Médico reclama perfil (claim_doctor_profile → lucy_status='claimed').
2. Entra al panel → ve pantalla "Activar LucyCare" (gate de suscripción).
3. Elige plan: Mensual ($55) o Anual ($594).
4. Va al checkout de la pasarela (hosted) y paga con tarjeta.
5. La pasarela emite un webhook "pago confirmado / suscripción activa".
6. Lucy (Edge Function que recibe el webhook) marca subscription='active'
   y activa el acceso según reglas (§5).
7. Renovación automática al final del ciclo (la pasarela recobra).
8. Cada renovación exitosa → webhook → se extiende el período.
```

### 3.2 Bordes (no felices)

| Evento | Origen | Acción de Lucy |
|---|---|---|
| **Pago inicial falla** | webhook `payment_failed` | Suscripción `payment_failed`/`none`; no se activa el acceso; pantalla "reintentar pago". |
| **Renovación falla** | webhook `past_due` / `invoice.payment_failed` | `active` → `past_due`; **período de gracia** (Q7, default 7 días) con acceso aún operativo + banner de aviso. La pasarela reintenta (dunning). |
| **Gracia vencida sin pago** | dunning agotado | `past_due` → `canceled`/`payment_failed`; se **revoca** acceso operativo (panel muestra "Cuenta suspendida", copy ya existente). |
| **Médico cancela** | acción del médico / portal pasarela | `active` → `canceled` al final del período pagado (no se corta inmediato; mantiene acceso hasta fin de ciclo). |
| **Período termina tras cancelar** | fin de ciclo | `canceled` → `expired`; revoca acceso. |
| **Reactivación** | médico re-paga | `canceled`/`expired`/`past_due` → `pending_checkout` → `active`; re-activa acceso y asientos. |

### 3.3 Principios del flujo

- **Idempotencia de webhooks**: cada evento de la pasarela se procesa una
  sola vez (dedupe por `event_id`). Log inmutable de eventos.
- **La fuente de verdad del pago es el webhook**, no el redirect del
  browser (el usuario puede cerrar la pestaña). El redirect solo muestra
  "estamos confirmando…"; el estado real lo fija el webhook.
- **Reconciliación**: job/endpoint que consulta el estado en la pasarela
  si un webhook se pierde (fallback).
- **Nunca activar acceso desde el cliente.** Solo el webhook server-side
  (con verificación de firma) cambia `subscription`.

---

## 4. Pasarela de pago — evaluación (NO cerrada)

### 4.1 El problema central: operar desde El Salvador

La pregunta bloqueante **no** es técnica (todas las pasarelas hacen
checkout + webhooks), sino **si el proveedor admite a LucyCare como
comercio operando desde El Salvador** y **cómo liquida el dinero** a una
cuenta utilizable por la empresa.

> ⚠️ **A la fecha de redacción, El Salvador NO figura en la lista de
> países soportados por Stripe para crear cuentas de comercio**
> (`stripe.com/global`). **Validar antes de comprometer Stripe.** Si se
> confirma, Stripe directo queda descartado y se necesita un rodeo
> (entidad US vía Stripe Atlas) o una alternativa.

### 4.2 Requisitos para LucyCare

1. **Admite comercio/seller en El Salvador** (o rodeo viable y legal).
2. **Liquida en USD** a una cuenta usable por la empresa (idealmente banco
   SV en USD; o Payoneer/Wise/transferencia).
3. **Suscripciones recurrentes nativas** (o tokenización de tarjeta para
   construir el recobro nosotros).
4. **Webhooks firmados** + API decente.
5. **Acepta tarjetas locales SV** (Visa/Mastercard emitidas en SV) y,
   deseable, internacionales.
6. **Comisiones razonables** y previsibilidad.
7. **Cumplimiento**: PCI manejado por la pasarela (checkout hosted /
   tokenización, no tocamos PAN).
8. Deseable: **Merchant of Record (MoR)** que asuma impuestos/retenciones
   internacionales (simplifica DTE/tributario).

### 4.3 Candidatos (a validar — no confirmados)

| Proveedor | Opera desde SV | Liquidación USD | Recurring nativo | MoR (impuestos) | DX/API | Notas / a validar |
|---|---|---|---|---|---|---|
| **Stripe (directo)** | ❌ probable (SV no soportado) | — | ✅ Billing | ❌ | ✅✅ excelente | Validar país; si no, vía entidad US. |
| **Stripe vía entidad US (Atlas)** | ⚠️ requiere LLC/C-corp US | USD a banco US → repatriar | ✅ Billing | ❌ | ✅✅ | Costo legal/contable US + repatriación + tributación dual. |
| **Paddle** | ⚠️ validar seller SV | payout Wise/wire | ✅ | ✅ MoR | ✅ | MoR asume IVA/tax global; comisión ~5%+; confirmar acepta SV. |
| **Lemon Squeezy** | ⚠️ validar seller SV | Wise/PayPal | ✅ | ✅ MoR | ✅ | Ahora de Stripe; payout a SV por verificar. |
| **2Checkout / Verifone** | ⚠️ validar | varios | ✅ | ✅ MoR | ⚠️ | MoR global con cobertura LatAm amplia. |
| **dLocal** | ✅ cubre SV | local/intl | ⚠️ (orientado enterprise) | parcial | ⚠️ | Enterprise; mínimos de volumen probables. |
| **Wompi (SV — Banco Agrícola)** | ✅ local | ✅ USD banco SV | ⚠️ recurring por tokenización (validar) | ❌ | ⚠️ media | Local, comisión baja, settlement directo SV. Recurring a confirmar. |
| **N1CO (SV)** | ✅ local | ✅ USD SV | ⚠️ validar | ❌ | ⚠️ | Fintech SV; payment links + API. |
| **Pagadito (SV/Centroamérica)** | ✅ regional | ✅ USD | ⚠️ recurrente parcial | ❌ | ⚠️ | Veterano regional; capacidades recurrentes a validar. |

> Las celdas ⚠️/❌ son **hipótesis de redacción**, no hechos cerrados.
> Cada una es una **tarea de validación** (§4.5).

### 4.4 Tres caminos arquetípicos

- **Camino A — MoR global (Paddle / Lemon Squeezy / 2Checkout):**
  El proveedor es el "vendedor de registro": cobra al médico, asume
  impuestos internacionales, y nos liquida neto a Wise/Payoneer/banco.
  - ✅ Recurring SaaS llave en mano, sidestepa acquiring local y gran
    parte del problema tributario cross-border.
  - ✅ No necesitamos entidad US ni contrato con banco adquirente SV.
  - ❌ Comisión más alta (~5%+ típico). ❌ Menos control del branding del
    cobro. ⚠️ Confirmar que aceptan seller en SV y payout a SV.

- **Camino B — Pasarela local SV (Wompi / N1CO / Pagadito):**
  Cobro directo a tarjetas SV, **liquidación en USD a banco local** (sin
  FX, sin repatriación).
  - ✅ Comisión local más baja, settlement simple, alineado a que **tanto
    Lucy como los médicos están en SV**.
  - ❌ Suscripción recurrente puede no ser nativa → habría que **construir
    el recobro** (tokenizar tarjeta + cron de cargo + reintentos), más
    trabajo y más responsabilidad.
  - ⚠️ DX/webhooks/documentación más limitada; cobertura de tarjetas
    internacionales menor (irrelevante si el cliente es 100% SV).

- **Camino C — Stripe vía entidad US (Stripe Atlas o LLC existente):**
  - ✅ Mejor tooling de billing del mercado (Stripe Billing, Customer
    Portal, dunning, prorrateo, todo resuelto).
  - ❌ Requiere constituir/mantener entidad US (costo y contabilidad),
    repatriar fondos a SV, y manejar tributación en dos jurisdicciones.
  - Solo se justifica si se busca escalar regional/global y ya hay (o se
    quiere) presencia US.

### 4.5 Tareas de validación (owner/legal — antes de elegir)

1. Confirmar en `stripe.com/global` si **El Salvador** es país soportado
   hoy (cambia con el tiempo).
2. Contactar **Wompi (Banco Agrícola)** y **N1CO**: ¿soportan **cobros
   recurrentes / tokenización de tarjeta** vía API? ¿webhooks? ¿comisión?
   ¿requisitos de alta del comercio? ¿settlement USD?
3. Contactar **Paddle / Lemon Squeezy**: ¿aceptan **seller con domicilio
   fiscal en El Salvador**? ¿método y costo de **payout** a SV?
4. Revisar con contador/legal: implicaciones de IVA 13% SV, DTE, y (si
   aplica camino C) tributación de entidad US.
5. Estimar volumen del piloto (5 médicos → ~$275/mes) para descartar
   proveedores con mínimos enterprise (dLocal).

### 4.6 Recomendación tentativa (sujeta a §4.5)

Dado que **piloto y clientes son 100% El Salvador** y la economía es en
**USD**:

- **Preferencia 1 (si valida recurring):** **pasarela local SV** (Wompi o
  N1CO) — settlement USD local, comisión baja, alineamiento operativo.
  Riesgo: construir el motor de recobro si no hay recurring nativo.
- **Preferencia 2 (si se quiere recurring llave en mano ya):** **MoR
  global** (Paddle/Lemon Squeezy) — más rápido de implementar, sidestepa
  tributos cross-border, a costa de comisión.
- **Preferencia 3 (solo si hay/se quiere entidad US y mira a escalar):**
  **Stripe vía US**.

**No se codifica integración hasta cerrar este punto.** El diseño de DB y
estados (§5–§8) se hace **agnóstico de pasarela** para no atarse.

---

## 5. Estados de suscripción

### 5.1 Enum propuesto

```
none             — nunca inició checkout (default tras claim).
pending_checkout — inició checkout, esperando confirmación del webhook.
active           — pago confirmado, suscripción vigente.
past_due         — renovación falló; en período de gracia (dunning).
payment_failed   — pago (inicial o tras gracia) falló definitivamente.
canceled         — el médico canceló; vigente hasta fin del período pagado.
expired          — período terminó (tras canceled o sin pago); acceso revocado.
```

### 5.2 Transiciones

```
none ─(elige plan)→ pending_checkout ─(webhook pago OK)→ active
pending_checkout ─(webhook pago falla)→ payment_failed ─(reintenta)→ pending_checkout
active ─(renovación falla)→ past_due ─(paga)→ active
past_due ─(gracia vence)→ expired (o payment_failed)
active ─(cancela)→ canceled ─(fin de período)→ expired
canceled/expired/past_due ─(re-paga)→ pending_checkout → active
```

### 5.3 Notas

- El estado vive en una tabla nueva `subscriptions` (§8), **no** en
  `doctors`. `doctors` solo se ve afectado en sus flags derivados (§6).
- `pending_checkout` debe tener **timeout** (ej. expira a `none` si no se
  confirma en N horas) para no dejar al médico bloqueado.
- Mapear los nombres de evento de la pasarela elegida a este enum interno
  (capa anticorrupción).

---

## 6. Relación con los estados del médico (gating)

**Reglas clave (a confirmar en Q1/Q2):**

| Eje del médico | Lo controla | Regla propuesta |
|---|---|---|
| `lucy_status='claimed'` | el reclamo | **`claimed` ≠ pagado.** El claim no implica suscripción. |
| `subscription='active'` | el pago (webhook) | **active ≠ verified.** Pagar no da el sello de confianza. |
| `is_operational` | **la suscripción** | `active`/`past_due(gracia)` → `true`; `expired`/`canceled(fin)`/`payment_failed` → `false`. **El pago habilita operar el panel.** |
| `booking_enabled` | suscripción (+ Q2) | Default propuesto: se habilita con `active` (un médico que paga puede recibir reservas). **Decisión Q2:** ¿requiere además `is_operational` o algún check de completitud (servicios + disponibilidad cargados)? |
| `is_verified` | **LucyAdmin (manual)** | **No cambia.** Es sello de confianza, independiente del pago. Un médico pago NO se auto-verifica. |

### 6.1 Consecuencias

- La pantalla **"Cuenta suspendida"** (ya existente en `PanelLayout`) pasa
  a cubrir también el caso **suscripción vencida/impaga** (`is_operational=false`
  por falta de pago), además del caso admin-suspende. Definir copy
  diferenciado: "Renová tu suscripción" vs "Cuenta pausada por el admin".
- La pantalla **"Activar LucyCare"** (gate de pago) se muestra cuando
  `claimed` + `subscription IN (none, payment_failed, expired, canceled)`.
- **`verified` sigue siendo decisión de LucyAdmin** (no automatizar nunca
  con el pago).

### 6.2 Quién dispara el cambio de flags

- **Solo el handler de webhook** (server-side) cambia `is_operational` /
  `booking_enabled` por motivo de pago, escribiendo en `audit_log` con un
  `edited_via='subscription_webhook'`.
- LucyAdmin conserva override manual (puede suspender aunque esté pago, o
  cortesía sin pago) — pero eso es excepción auditada.

---

## 7. Límite de equipo (enforcement)

### 7.1 Regla

- Plan base = **3 asientos** ocupables (titular + 2).
- Asiento adicional = $5/mes, **debe estar contratado** (reflejado en la
  suscripción) **antes** de poder invitar al 4º usuario.

### 7.2 Enforcement fuerte (backend/DB, NO solo UI)

- La invitación de asistente (`clinic_invitations` / `accept_clinic_invitations`)
  debe validar **server-side** que `usuarios_activos < asientos_contratados`.
- `asientos_contratados = 3 + seats_adicionales_pagados` (de la suscripción).
- Validación en la **RPC** que crea la invitación y/o en la que la acepta
  (no confiar en el front). Idealmente un **trigger/constraint** que
  impida exceder el límite aunque alguien llame la RPC directo.
- Contar como "usuario" toda fila activa en `clinic_members` (incluido el
  titular) que no esté cancelada.

### 7.3 Asientos adicionales vinculados a la suscripción

- Cada asiento adicional es un **add-on de la suscripción** (cantidad), no
  un cobro suelto. Al bajar de plan o cancelar, los asientos extra se
  liberan (y los usuarios por encima del límite quedan **bloqueados**, no
  borrados — se conservan, pero no pueden operar hasta re-contratar).
- **Decisión pendiente (Q8):** si el médico baja asientos teniendo más
  usuarios activos, ¿a quién se bloquea? Default: el médico elige; si no
  elige, se bloquean los de invitación más reciente (LIFO), conservando al
  titular siempre.

---

## 8. Arquitectura técnica (agnóstica de pasarela — borrador)

> Se define el **modelo de datos y la capa de webhooks de forma agnóstica**
> para no atarse al proveedor. La integración concreta se especifica
> recién al cerrar §4.

### 8.1 Tablas nuevas (propuesta)

```
subscriptions
  id, clinic_id (UNIQUE — anclaje técnico; MVP: 1 titular por clínica,
                 unidad comercial = médico titular, no la clínica),
  plan ('monthly'|'annual'),
  status (enum §5.1),
  seats_included int default 3,
  seats_additional int default 0,
  current_period_start, current_period_end,
  grace_until timestamptz null,
  provider text,                 -- 'wompi'|'paddle'|'stripe'|...
  provider_customer_id text,     -- id del cliente en la pasarela
  provider_subscription_id text, -- id de la suscripción en la pasarela
  cancel_at_period_end boolean default false,
  created_at, updated_at

subscription_events            -- log inmutable de webhooks (idempotencia)
  id, subscription_id null, provider, provider_event_id (UNIQUE),
  event_type, payload jsonb, processed_at, created_at

subscription_seats (opcional)  -- si se quiere trazar asiento↔clinic_member
  id, subscription_id, clinic_member_id, active, created_at
```

- `doctors`/`clinics` **no** cambian de esquema; el gating se aplica sobre
  `is_operational`/`booking_enabled` ya existentes.
- RLS: el médico titular ve **su** suscripción (por `clinic_id`);
  LucyAdmin ve todas; el handler de webhook usa `service_role`.

### 8.2 Componentes

- **Edge Function `payments-webhook`** (Supabase): recibe webhooks,
  **verifica firma**, dedupe por `provider_event_id`, mapea evento →
  estado interno, actualiza `subscriptions` + flags del doctor, audita.
  (Primera Edge Function del proyecto — hoy no se usan; ver decisión de
  stack. Implica habilitar Edge Functions.)
- **RPC `start_checkout(plan, seats)`**: crea/recupera customer en la
  pasarela, devuelve URL de checkout hosted, deja `pending_checkout`.
- **RPC `get_my_subscription()`**: estado para la UI del panel.
- **Capa anticorrupción**: módulo que traduce eventos del proveedor
  elegido a nuestro enum (aísla el resto del código de la pasarela).
- **Reconciliación**: endpoint/cron que reconsulta estado si falta un
  webhook.

### 8.3 Seguridad

- Verificar **firma del webhook** (secreto del proveedor en ENV, nunca en
  repo — mismo principio que `service_role`/Resend).
- Webhook **idempotente** (UNIQUE en `provider_event_id`).
- Nunca tocar datos de tarjeta (checkout hosted / tokenización del lado de
  la pasarela; PCI fuera de nuestro alcance).
- Toda mutación de acceso por pago → `audit_log` (`edited_via='subscription_webhook'`).

---

## 9. Riesgos

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | **Stripe no opera en SV** | 🚨 Alta | Validar primero (§4.5). Plan B local/MoR ya contemplado. |
| R2 | Pasarela local sin recurring nativo | ⚠ Media | Construir recobro propio (tokenización + cron + dunning) o ir a MoR. |
| R3 | Webhook perdido → estado desincronizado | ⚠ Media | Idempotencia + reconciliación periódica + estado por timeout. |
| R4 | Doble activación / replay de webhook | ⚠ Media | UNIQUE `provider_event_id`, dedupe. |
| R5 | Pago activa pero `verified` se confunde | ⚠ Media | Regla explícita: pago ≠ verified (§6). |
| R6 | Bypass del límite de equipo por RPC directa | ⚠ Media | Enforcement server-side + trigger/constraint (§7.2). |
| R7 | Cobro recurrente sin DTE/factura legal | ⚠ Media-Alta | Coordinar con DTE diferido; MoR lo resuelve; o emitir DTE vía API externa. |
| R8 | Repatriación/tributación (camino US) | ⚠ Alta (si C) | Solo si se elige camino C; requiere contador. |
| R9 | Médico paga y no puede operar (gating mal) | ⚠ Media | Tests de la máquina de estados; gate claro `active → is_operational`. |
| R10 | Edge Functions: primera vez en el proyecto | ⚠ Baja | Validar deploy/infra de Supabase Functions antes del PR funcional. |

---

## 10. Decisiones pendientes (cerrar antes de implementar)

| Q | Pregunta | Default sugerido |
|---|---|---|
| **Q1** | ¿`is_operational` se activa **solo** con `subscription='active'`? | Sí: active → operativo; vencido → suspendido. |
| **Q2** | ¿`booking_enabled` requiere además completitud (servicios+disponibilidad) o basta `active`? | Basta `active`; revisar completitud como aviso, no bloqueo. |
| **Q3** | ¿Adicional anual con 10% ($54) o plano ($60)? | Con 10% ($54/año). |
| **Q4** | ¿Prorrateo intra-ciclo al cambiar asientos? | No en MVP; cambios desde próximo ciclo. |
| **Q5** | ¿Trial gratis? | No en MVP. |
| **Q6** | ¿Precios IVA incluido o + IVA? ¿Cómo se factura/emiten comprobantes? | **Pendiente legal/contable/fiscal — no cerrar.** Base comercial $55/$594; validar IVA + facturación + DTE antes de implementar. |
| **Q7** | ¿Días de gracia en `past_due`? | 7 días. |
| **Q8** | Al bajar asientos con exceso de usuarios, ¿a quién se bloquea? | El médico elige; fallback LIFO, nunca al titular. |
| **Q9** | ¿Pasarela? (§4) | Pendiente de validación; lean a local SV o MoR. |
| **Q10** | ¿Self-service de cambio de plan/cancelación dentro de Lucy o portal de la pasarela? | Portal de la pasarela en MVP si existe; UI propia después. |
| **Q11** | ¿Quién paga si una clínica tiene varios médicos? (multi-doctor) | MVP: 1 suscripción por clínica, titular paga. Revisar para multi-doctor. |

---

## 11. Fases de implementación (después de cerrar §4 y §10)

> Ninguna fase arranca hasta elegir pasarela y cerrar las Q de §10.

- **Fase 0 — Validación de pasarela (no código):** ejecutar §4.5, elegir
  proveedor, confirmar recurring + settlement + alta del comercio.
- **Fase 1 — Modelo de datos + estados (migración):** tablas
  `subscriptions` + `subscription_events` + RLS + enum, **sin** integración
  de pasarela. Estado `none` por default para los `claimed`.
- **Fase 2 — Gate de UI "Activar LucyCare":** pantalla de planes en el
  panel del médico, leyendo `get_my_subscription()`. Sin cobro real aún
  (mock/sandbox).
- **Fase 3 — Integración pasarela (checkout + webhook):** Edge Function
  `payments-webhook`, `start_checkout`, capa anticorrupción, idempotencia.
  Sandbox del proveedor primero.
- **Fase 4 — Gating de acceso:** webhook activa/revoca `is_operational` /
  `booking_enabled` según §6; pantalla "Cuenta suspendida" extendida.
- **Fase 5 — Límite de equipo + asientos adicionales:** enforcement
  server-side + add-on de asientos en la suscripción (§7).
- **Fase 6 — Bordes:** dunning/`past_due`/gracia, cancelación,
  reactivación, reconciliación, timeouts de `pending_checkout`.
- **Fase 7 — Facturación/DTE:** vía API externa (diferido), o delegado al
  MoR si se eligió ese camino.

Cada fase: 1 PR chico, migración `s7_NN`/`s8_NN` con `check-*.mjs`,
`vite build` OK, preview validado, smoke, luego merge. Secrets de la
pasarela en ENV/dashboard, **nunca en repo**.

---

## 12. Recomendación

1. **Tratar Stripe como candidato, no como elegido.** Ejecutar la
   validación de §4.5 **antes** de cualquier código.
2. Diseñar DB/estados **agnósticos de pasarela** (§5, §8) para no atarse.
3. Lean inicial: **pasarela local SV (Wompi/N1CO)** si soporta recurring
   con settlement USD local; si no, **MoR (Paddle/Lemon Squeezy)** para
   recurring llave en mano. **Stripe vía US** solo si se busca escalar
   global y se acepta el costo de entidad US.
4. Mantener separados los tres ejes: **pago (active) ≠ confianza
   (verified) ≠ identidad (claimed)**.
5. Enforcement de asientos **server-side**, no en UI.

---

## 13. Coordinación con otros docs

- `docs/ANALISIS_AFILIACION_MEDICO.md` / `docs/ANALISIS_RECLAMAR_PERFIL.md`
  — el pago entra **después** del reclamo; `claimed` precede a la
  suscripción.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — ejes del médico; este doc define
  cuándo el pago mueve `is_operational`/`booking_enabled` (no `verified`).
- `docs/SECURITY_GATE_PILOTO.md` — agregar, al implementar: verificación
  de firma de webhook, idempotencia, secretos en ENV, RLS de
  `subscriptions`.
- Decisión de stack "Pagos: Stripe Checkout hosted" → **reabierta como
  candidato a validar** por este análisis (operación desde El Salvador).

---

**Siguiente paso:** el owner ejecuta la validación de pasarela (§4.5) y
responde §10. Con pasarela elegida + Q cerradas, se arma el plan operativo
del primer PR (Fase 1: modelo de datos).

---

## 14. Pricing configurable / modelo comercial APROBADO (2026-06-29)

> Esta sección **reemplaza** los precios de §2 (que quedan como histórico de la
> propuesta original). Aprobada por el owner el 2026-06-29. Sigue siendo
> **diseño/decisión comercial** — **NO implica implementación** (no hay tablas,
> no hay pasarela elegida, no hay código).

### 14.1 Precios aprobados (USD, IVA 13% incluido)

Unidad comercial = **médico titular**; cada plan base incluye **1 titular + 2
asistentes** (3 accesos). Todos los montos son **IVA incluido** (el monto bruto
es lo que se cobra). Moneda **USD** (curso legal en SV).

| Concepto | Bruto (IVA incl.) | Base s/IVA | IVA 13% | Centavos (bruto / base / IVA) |
|---|---|---|---|---|
| **Plan mensual** | **$59.00 / mes** | $52.21 | $6.79 | **5900 / 5221 / 679** |
| **Plan anual** (−15% vs 12 mensuales) | **$601.80 / año** | $532.57 | $69.23 | **60180 / 53257 / 6923** |
| Plan anual — equivalente visible | $50.15 / mes | — | — | — |
| **Usuario adicional / mes** | **$6.00 / usuario / mes** | $5.31 | $0.69 | **600 / 531 / 69** |
| **Usuario adicional / año** (−15%) | **$61.20 / usuario / año** | $54.16 | $7.04 | **6120 / 5416 / 704** |

Verificaciones: mensual×12 = $708 → −15% = **$601.80**; $601.80/12 = **$50.15/mes**;
adicional mensual×12 = $72 → −15% = **$61.20**; en las 4 filas `base + IVA = bruto`.

- **Usuario adicional anual — CONFIRMADO:** aplica el **mismo 15%** que el plan
  anual → **$61.20/usuario/año IVA incluido** (consistencia comercial).
- **IVA:** los precios son **IVA-incluido** (resuelve la parte de presentación de
  Q6). La **emisión de comprobante/DTE sigue pendiente** (legal/contable, §14.5).

### 14.2 Prorrateo (MVP) — CONFIRMADO
- **No** automatizar prorrateo intra-ciclo en la primera versión.
- Los usuarios adicionales **self-service** se **cobran y habilitan desde el
  siguiente ciclo** (no a mitad de período).
- Si se necesita **habilitación inmediata**, queda como **caso manual de
  LucyAdmin/soporte** con **nota + auditoría**.
- **No** construir motor de proration en MVP.

### 14.3 Principio obligatorio — precios configurables, NO hardcoded
- **Fuente de verdad futura = servidor/DB.** El **frontend solo muestra** precios
  entregados por el backend; **nunca** calcula dinero crítico ni asume el IVA.
- **Dinero en centavos enteros** (`*_cents`), **nunca floats**.
- **IVA y descuentos en basis points** (IVA `1300`, descuento anual `1500`).
- **Filas de precio versionadas e inmutables:** cambiar un precio público =
  **insertar una fila nueva** (`effective_from` nuevo) + **desactivar** la
  anterior (`active=false`, `effective_to`). **Nunca editar el monto de una fila
  viva (sin edición silenciosa).**
- **Grandfathering:** cada suscripción guarda el **`plan_price_id`** con el que se
  contrató; cambiar el precio público **no** modifica suscripciones existentes.
  **No re-preciar médicos antiguos sin decisión explícita** (nunca retroactivo
  silencioso).
- **IDs de la pasarela** (`provider_product_id` / `provider_price_id`) viven
  **asociados a la fila de precio/configuración**, **no quemados en componentes**.

**Riesgos de hardcodear** (por qué la regla anterior): cambio de precio/IVA
exigiría deploy; inconsistencia entre componentes; imposible grandfathering ni
promos; drift con los IDs de la pasarela; errores de redondeo si el front calcula
dinero con floats.

### 14.4 Diseño futuro `subscription_plan_prices` (PROPUESTA — NO implementar)
Tabla única para el MVP (2 planes + 1 add-on = pocas filas); más simple que el
split en 3 tablas (`subscription_plans`/`subscription_prices`/`subscription_addons`),
que queda para si el catálogo crece. **Filas append-only / inmutables.**

```
subscription_plan_prices
  id
  code                       -- 'base_monthly' | 'base_annual' | 'extra_seat_monthly' | 'extra_seat_annual'
  name                       -- label visible ("Plan Mensual")
  kind                       -- 'base' | 'addon_seat'
  billing_interval           -- 'monthly' | 'annual'
  currency                   -- 'USD'
  gross_amount_cents         -- CANÓNICO (5900 / 60180 / 600 / 6120)
  tax_included               -- true
  tax_rate_bps               -- 1300
  net_amount_cents           -- derivado (CHECK: net + tax = gross)
  tax_amount_cents           -- derivado
  included_assistant_seats   -- 2 en base; 0/null en addon
  annual_discount_bps        -- 1500 (auditoría del cálculo)
  provider                   -- 'wompi'|'pagadito'|'n1co'|'stripe'|null (pre-integración)
  provider_product_id        -- nullable hasta integrar pasarela
  provider_price_id          -- nullable hasta integrar pasarela
  active                     -- bool
  effective_from / effective_to
  created_at / updated_at
```
- Canónico = `gross_amount_cents` + `tax_rate_bps` + `tax_included`; `net`/`tax`
  se derivan (`net = round(gross/(1+rate))`, `tax = gross − net`) — si se
  almacenan, **CHECK `net_amount_cents + tax_amount_cents = gross_amount_cents`**.
- Relación futura: `subscriptions.plan_price_id` → FK a esta tabla
  (grandfathering). `subscriptions` y `subscription_events` (§8) **NO existen aún**.
- **NO se implementa en este PR** (docs-only).

### 14.5 Pendientes vigentes (no cerrados por esta aprobación)
- **Pasarela: NO decidida.** Matriz de validación (Wompi SV / Pagadito / N1CO /
  Stripe-referencia) pendiente de ejecutar (§4.5 + reporte de validación). Criterio
  bloqueante: **recurring nativo + webhooks firmados + settlement USD a cuenta SV**.
- **DTE / IVA / facturación:** emisión de comprobante sigue **pendiente legal/
  contable** (los precios ya son IVA-incluido, pero falta cómo se factura/emite).
- Resto de Q1–Q11 (§10): gracia, suspensión exacta, reactivación, cancelación,
  trial, multi-doctor, self-service vs portal.

### 14.6 Separación de ejes (VINCULANTE, reconfirmado)
- **Pago (`subscription='active'`) ≠ `verified`** — pagar no da el sello de
  confianza (lo decide LucyAdmin).
- **Pago ≠ `claimed`** — la identidad/reclamo no depende del pago.
- **El pago impacta solo operatividad SaaS** (`is_operational`, `booking_enabled`,
  asientos/asistentes), **nunca** identidad ni confianza.

---

## 15. Autoservicio de suscripción / customer portal (APROBADO 2026-06-29)

> Diseño/decisión de producto. Extiende §14. **NO implica implementación**
> (sin tablas, sin pasarela elegida, sin código). Alineado al principio:
> el camino feliz es autoservicio; LucyAdmin solo para excepciones auditadas.

### 15.1 Decisión de producto
El médico debe poder gestionar su suscripción **sin intervención manual** de
LucyCare, idealmente desde **la pasarela o un portal externo seguro**:
1. cancelar la suscripción;
2. cambiar método de pago / tarjeta;
3. reactivar si corresponde;
4. ajustar usuarios adicionales cuando tenga más de 2 asistentes.

### 15.2 Cambio de método de pago
- **LucyCare NO captura ni almacena datos de tarjeta** (PCI fuera de alcance).
- El médico se **redirige a la pasarela / portal seguro** para actualizar tarjeta.
- LucyCare solo guarda **identificadores seguros del proveedor** y **estado
  derivado** (nunca el PAN).
- La confirmación real viene por **webhook firmado** o verificación server-side;
  **la URL de retorno NO es fuente de verdad**.

### 15.3 Cancelación (regla MVP)
- Efectiva **al final del período ya pagado** (`cancel_at_period_end`).
- **No** suspender inmediatamente si el período actual está pagado: mantener
  servicio activo hasta **`current_period_end`**.
- Al vencimiento, si no hay renovación/reactivación → **suspender operatividad
  SaaS** según reglas (§6).
- **Default MVP: sin reembolso automático** por período parcial.

### 15.4 Usuarios adicionales / asientos
- Plan base = **1 titular + 2 asistentes incluidos**.
- Regla conceptual: **`extra_seats = max(asistentes_activos − 2, 0)`**.
  - 2 asistentes → 0 adicionales · 3 → 1 adicional · 4 → 2 adicionales.
- Precios (§14): adicional **$6.00/mes** o **$61.20/año** (−15%), IVA incluido.

### 15.5 Quitar asistentes
Separar **dos cosas distintas**:
1. **quitar/desactivar a una persona** del equipo (operación de equipo);
2. **reducir el cobro** de usuarios adicionales (operación de facturación).

Regla MVP:
- Si al quitar un asistente baja la cantidad de adicionales necesarios, el
  **cambio de cobro aplica en el siguiente ciclo** (sin prorrateo intra-ciclo).
- Ajuste inmediato = **caso manual LucyAdmin/soporte** con **nota + auditoría**.
- **Nunca borrar historial clínico ni auditoría** por quitar un asistente
  (el usuario se desactiva/bloquea, no se hard-delete).
- Ejemplo: 4 asistentes (paga 2 adicionales) → elimina 1 → 3 asistentes →
  **desde el próximo ciclo paga 1 adicional**.

### 15.6 Agregar asistentes
- **Self-service automático:** el nuevo adicional se **cobra/habilita desde el
  siguiente ciclo** (consistente con §14.2, sin prorrateo).
- **Habilitación inmediata:** caso manual LucyAdmin/soporte, **o** fase futura si
  la pasarela soporta *quantity update* con cobro inmediato.
- **No** construir motor de prorrateo propio en MVP.

### 15.7 Modelo conceptual futuro (campos a considerar — NO implementar)
A considerar en `subscriptions` (o estructura equivalente) cuando se diseñe la
Fase 1; **no se crea nada en este PR**:
```
included_assistant_seats        -- 2
paid_extra_seats_quantity       -- adicionales pagados vigentes
active_assistant_count          -- asistentes activos (derivado / cache)
pending_extra_seats_quantity    -- cambio de cantidad que aplica el próximo ciclo
pending_change_effective_at     -- cuándo aplica el cambio pendiente
billing_interval                -- 'monthly' | 'annual'
current_period_start
current_period_end
cancel_at_period_end            -- bool
canceled_at
payment_method_update_required  -- bool (tarjeta vencida/rechazada)
provider_customer_portal_url    -- o mecanismo equivalente
```
- Los eventos relacionados (cambio de tarjeta, cancelación, update de cantidad,
  `past_due`, etc.) quedan en **`subscription_events`** (log inmutable, idempotente).

### 15.8 Enforcement futuro (server-side, NO solo frontend)
- El límite de asistentes **no debe depender solo del frontend**.
- Regla futura: **`team_seat_limit` = 2 incluidos + `paid_extra_seats_quantity`**.
  - Hoy `team_seat_limit(p_clinic_id)` retorna `2` fijo (`s7_27`) con `TODO(pagos)`
    — ese es el punto exacto a cablear (§0bis.2).
- **No permitir** más asistentes activos / invitaciones aceptables que asientos
  permitidos; **conservar enforcement server-side** (trigger + revalidación en
  `accept_clinic_invitations`, ya existentes).

### 15.9 Matriz de pasarela — criterios adicionales (extiende §4.2/§4.5)
Sumar a la validación de pasarela (Wompi/Pagadito/N1CO/Stripe-referencia) estos
criterios, **pendientes de validar** con cada proveedor:
- customer portal / portal de cliente;
- actualización de método de pago;
- cancelación self-service;
- cancelación **al final del período**;
- reactivación self-service;
- modificación de **cantidad de add-ons/asientos**;
- webhooks de cambio de tarjeta;
- webhooks de cancelación;
- webhooks de actualización de suscripción;
- manejo de **`past_due`**;
- reintentos de cobro;
- **dunning**;
- estado de suscripción claro/consultable.

> **Riesgo:** si la pasarela **no** soporta **portal de cliente** ni
> **modificación de cantidad/asientos**, LucyCare tendría que construir más
> lógica propia o manejar esos cambios **manualmente desde LucyAdmin**. Eso
> **baja la conveniencia** de esa pasarela para el MVP y debe pesar en la
> decisión de §4.

---

## 16. LucyAdmin Billing — administración y reportería de pagos (APROBADO 2026-06-29)

> Diseño/decisión de producto. **NO implica implementación** (sin módulo admin,
> sin tablas, sin pasarela elegida, sin código). Define qué debe poder hacer y
> ver LucyAdmin para operar el negocio SaaS — independiente del panel de la pasarela.

### 16.1 Decisión de producto
LucyCare necesita un **módulo administrativo de billing** para controlar ingresos,
pagos, suscripciones, usuarios incluidos/adicionales y suspensión/reactivación por
impago. **La pasarela cobra; LucyAdmin gobierna el negocio.** Indispensable para
operar como SaaS.

### 16.2 Objetivos (qué debe poder saberse)
1. qué médicos tienen suscripción activa; 2. quién pagó; 3. cuánto pagó cada uno;
4. qué plan tiene (mensual/anual); 5. asistentes incluidos; 6. usuarios adicionales
que paga; 7. cuánto debe pagar el próximo ciclo; 8. cuándo vence el período actual;
9. estado (`active`/`past_due`/`suspended`/`canceled`/…); 10. quién debe darse de
baja por impago; 11. quién fue reactivado; 12. ingreso cobrado del mes; 13. MRR
proyectado; 14. ARR; 15. pendiente / fallido / vencido.

### 16.3 Dashboard mínimo (MVP futuro) — KPIs
- ingresos cobrados del mes; **MRR** estimado; **ARR** estimado;
- médicos activos por pago; en período de gracia; vencidos/`past_due`; suspendidos;
  cancelados;
- usuarios adicionales activos; ingresos por usuarios adicionales;
- próximos vencimientos; pagos fallidos recientes; reactivaciones recientes.

### 16.4 Lista administrativa de suscripciones
Vista tabla con **filtros**: estado de suscripción · plan mensual/anual · médico ·
clínica · próximo cobro · último pago · estado de pago · pasarela · pago fallido ·
en gracia · suspendibles.

**Columnas sugeridas:** médico · clínica · plan · estado de suscripción · monto
bruto · base s/IVA · IVA · usuarios incluidos · usuarios adicionales cobrados ·
total estimado próximo ciclo · último pago · próximo vencimiento/cobro · proveedor ·
`provider_customer_id` · `provider_subscription_id` · fecha de cancelación (si
aplica) · `cancel_at_period_end` · estado operativo resultante · notas/override
manual.

### 16.5 Detalle por médico / suscripción
- plan actual; precio contratado (`plan_price_id`); historial de pagos; historial
  de eventos de la pasarela; usuarios incluidos; usuarios adicionales; estado
  actual; fechas de período; intentos fallidos; motivo de suspensión;
  reactivaciones; overrides manuales; notas internas.

### 16.6 Control operativo (acciones LucyAdmin)
1. ver quién debe suspenderse; 2. suspender manualmente si corresponde;
3. reactivar manualmente; 4. aplicar **override temporal**; 5. registrar
nota/motivo; 6. **exportar reporte**; 7. revisar **conciliación** pasarela↔LucyCare.
Toda acción → **`audit_log`** (override/suspensión/reactivación auditados).

### 16.7 Reglas de suspensión (pendiente de cerrar, pero necesaria)
- pago fallido → `past_due`; **período de gracia configurable**; gracia vencida →
  **suspensión operativa**.
- la suspensión afecta **operatividad SaaS** (`is_operational`/`booking_enabled`),
  **no** identidad ni confianza; **se conservan perfil/historial/datos**.
- reactivación al pagar **o** por override LucyAdmin; **todo cambio auditado**.
- (Reafirma §6 y la separación pago ≠ verified ≠ claimed.)

### 16.8 Reportería financiera (reportes mínimos)
ingresos cobrados por mes · por plan mensual · por plan anual · por usuarios
adicionales · pagos fallidos · pagos pendientes · cancelaciones · reactivaciones ·
médicos suspendidos por impago · **churn** · **MRR** · **ARR** · **export CSV/XLS**
(futuro).

### 16.9 Conciliación
Fuente principal de eventos = **webhook firmado** de la pasarela; además LucyAdmin
debe permitir **conciliar**:
- comparar pagos recibidos en pasarela vs estado en LucyCare;
- detectar **webhook fallido/perdido**; **pago duplicado**;
- **activa en pasarela pero suspendida en LucyCare** (y viceversa: **activa en
  LucyCare sin pago vigente**);
- permitir **revisión manual segura** (con audit).

### 16.10 Modelo de datos futuro (para reportería, NO implementar)
El diseño debe soportar **reportería y trazabilidad**, no solo activación. Además de
`subscriptions` y `subscription_events`, considerar conceptos como:
```
pagos recibidos / intentos de cobro / invoices internos
  período facturado, gross_amount_cents, net_amount_cents, tax_amount_cents,
  currency, plan_price_id, extra_seats_quantity,
  provider_payment_id, provider_invoice_id (si aplica), provider_event_id,
  reconciliation_status, timestamps auditables
```
- **No** crear todas las tablas en MVP, **pero sí diseñar para no perder
  trazabilidad** (montos en centavos, `plan_price_id` para grandfathering, IDs del
  proveedor, estado de conciliación).

### 16.11 Principio importante (VINCULANTE)
**No depender solo del panel de la pasarela para administrar el negocio.** La
pasarela procesa el pago; **LucyAdmin** debe tener visibilidad operativa y
financiera suficiente para **activar / suspender / reactivar / conciliar / reportar
/ auditar**.

---

## 17. Separación arquitectónica: Lucy SaaS vs LucyAdmin Billing (APROBADO 2026-06-29)

> Decisión de producto/arquitectura. **NO implica implementación** (sin módulo,
> sin rutas, sin tablas, sin pasarela, sin código). Las partes ya detalladas en
> §14/§15/§16 **no se repiten** acá: se referencian y se reconfirman bajo esta
> separación (ver §17.5).

### 17.1 Decisión de arquitectura
**LucyAdmin Billing es un módulo administrativo separado del SaaS operativo del
médico.** No se mezcla con el panel médico ni con las vistas clínicas. Cuatro
responsabilidades distintas:
- **Lucy SaaS** — operación del médico (panel, agenda, ficha clínica, reserva).
- **LucyAdmin Billing** — control financiero: suscripciones, pagos, reportería,
  conciliación, auditoría, suspensión/reactivación.
- **Pasarela externa** — cobro, tarjeta, cancelación y/o portal de cliente.
- **Webhooks / backend** — sincronización **confiable** del estado de pago
  (fuente de verdad firmada, idempotente).

En **MVP** puede vivir **dentro del mismo proyecto/app** como **rutas protegidas
de LucyAdmin**, pero **conceptualmente es un backoffice separado**. Lo importante
no es separar repos/DB, sino **separar permisos, rutas, auditoría y
responsabilidad**.

### 17.2 Ubicación sugerida (MVP futuro)
Rutas dentro de LucyAdmin, p. ej.:
`/admin/billing` · `/admin/billing/dashboard` · `/admin/billing/suscripciones` ·
`/admin/billing/pagos` · `/admin/billing/conciliacion` · `/admin/billing/reportes` ·
`/admin/billing/precios` · `/admin/billing/eventos`.

A futuro podría migrar a **subdominio / app administrativa separada** (p. ej.
`admin.lucycare.app`). **En MVP NO hace falta** otro repo ni otra base de datos
solo por separación visual.

### 17.3 Qué ve el médico (Lucy SaaS) vs qué NO ve
**El médico ve solo una vista limitada de SU suscripción:**
- plan actual; estado de suscripción; próxima fecha de cobro/vencimiento;
  asistentes incluidos; usuarios adicionales; botón/enlace para **pagar**, para
  **cambiar método de pago**, y para **gestionar/cancelar** en la pasarela;
  mensajes de pago fallido / período de gracia / suspensión.

**El médico NO ve (pertenece solo a LucyAdmin Billing):**
- ingresos globales; pagos de otros médicos; conciliación; reportería financiera;
  overrides; eventos internos de webhook; decisiones administrativas globales.

### 17.4 Separación de permisos (roles futuros posibles)
- `super_admin` · `billing_admin` · `billing_readonly` · `support_admin`.
- Reglas:
  - **No todo admin clínico debe poder modificar pagos.**
  - **Todo override de pago / suspensión / reactivación → auditado** (`audit_log`).
  - **Reportes financieros con acceso restringido.**
- (Hoy `profiles.role='admin'` es el único bit de autorización admin; estos roles
  de billing son **diseño futuro**, no se implementan acá. Se alinean con la Fase 2
  de `docs/ANALISIS_ADMINISTRADORES_LUCY.md` — capacidades granulares.)

### 17.5 Lo ya documentado (reconfirmado bajo esta arquitectura — no se repite)
- **Autoservicio del médico** (cancelar / cambiar tarjeta / reactivar / ajustar
  asientos), **cambio de método de pago**, **cancelación a fin de período**,
  **usuarios adicionales/asientos** (`extra_seats = max(asistentes−2,0)`,
  agregar/quitar sin prorrateo MVP) → **§15** (precios en **§14**).
- **LucyAdmin Billing** (objetivos, **dashboard/KPIs**, **lista filtrable** +
  columnas, **detalle por médico**, **control operativo**, **reportería**,
  **conciliación**, **modelo de datos futuro**) → **§16**.
- **Pricing configurable / no-hardcoded** y separación **pago ≠ verified ≠
  claimed** → **§14**.

### 17.6 Principio (VINCULANTE)
**No depender solo del panel de la pasarela para administrar el negocio.** La
pasarela procesa pagos; **LucyAdmin Billing** debe dar visibilidad operativa y
financiera suficiente para **activar / suspender / reactivar / conciliar /
reportar / auditar** — y debe estar **separado** del SaaS operativo del médico
(permisos, rutas, auditoría, responsabilidad).
