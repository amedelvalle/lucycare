# Análisis — BILLING-P0 · Arquitectura de suscripción y facturación

> **Documento de arquitectura y decisión. Fase A cerrada el 2026-08-07.**
> **Estado del frente: PAUSADO.** No hay implementación, no hay migraciones, no
> hay proveedor elegido. Este documento **no autoriza código**.
>
> **Manda sobre `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` en todo lo arquitectónico**
> (§12). Ese documento sigue vigente en lo comercial (precios §14, autoservicio
> §15, LucyAdmin Billing §16, separación §17) y **no se modificó**.
>
> Decisiones tomadas por el owner el 2026-08-07. El developer no las reabre.

---

## 0. Resumen ejecutivo

LucyCare necesita cobrar una suscripción SaaS al médico. Hoy **no existe nada**:
ni tablas, ni proveedor, ni webhooks. La activación operativa es 100% manual por
LucyAdmin.

Este documento fija **cómo debe modelarse** ese cobro, con dos principios que
gobiernan todo lo demás:

1. **El estado comercial es independiente del estado administrativo.**
   `doctors.is_operational` **no** es —ni será— indicador de pago.
2. **El enforcement se activa último.** Primero el modelo en sombra, después la
   integración medida, y solo entonces los gates.

**Alcance de la Fase A:** todo el análisis sale del repositorio (migraciones,
tipos generados, código). **No se consultó la base de datos con `service_role`**
—no fue autorizado y no se pidió—. Donde el catálogo real pudiera diferir del
repo, está marcado.

---

## 1. Estado del modelo actual (verificado en el repo, 2026-08-07)

### 1.1 Entidades y cardinalidades reales

```
profiles (id = auth.users.id; role: patient | doctor | assistant | admin)
   │
   ├─1:1──→ doctors.profile_id          FK UNIQUE  (isOneToOne: true)
   ├───────→ clinics.owner_id            FK no unique
   └───────→ clinic_members.profile_id   FK no unique

clinics (id, owner_id, is_active, name, timezone, department_id, municipality_id)
   │
   ├─1:N──→ doctors.clinic_id            FK NO unique
   └─1:N──→ clinic_members (clinic_id, profile_id, role, is_active)

clinic_member_role = owner | doctor | assistant
lucy_status        = listed_only | claimed | booking_enabled | verified
```

**Tres hallazgos que condicionan el diseño de billing:**

| # | Hallazgo | Consecuencia |
|---|---|---|
| H1 | **`doctors.profile_id` es UNIQUE** | Un profile es a lo sumo un médico → el titular contractual es identificable sin ambigüedad |
| H2 | **`doctors.clinic_id` NO es unique** | El esquema **ya admite N médicos por clínica**. Billing no puede asumir 1:1 |
| H3 | **El titular está representado dos veces**: `clinics.owner_id` y `clinic_members.role='owner'` | Dos fuentes que pueden divergir. Billing debe anclarse a **una** y tratar la otra como derivada |

### 1.2 Asientos de equipo — el punto de enganche ya construido

`migrations/s7_27_team_seat_limit.sql`:

```sql
CREATE OR REPLACE FUNCTION team_seat_limit(p_clinic_id uuid) ...
  -- TODO(pagos): reemplazar el 2 fijo por
  --   included_assistants + additional_assistants de subscriptions(p_clinic_id).
  SELECT 2;
```

- `team_seats_used(p_clinic_id)` = asistentes activos + invitaciones pendientes.
- Enforcement server-side **ya activo**: trigger `trg_enforce_team_seat_limit`
  sobre `clinic_invitations` + revalidación en `accept_clinic_invitations`
  (`s7_36`).
- **La firma toma `clinic_id`.** Si el entitlement de asientos se resuelve por
  `clinic_id`, se cablea sin cambiar firma, ni triggers, ni RPCs.

⚠️ Ese cableado pertenece a **BILLING-P3**, no a P1 (§8).

### 1.3 Los cuatro ejes del médico y dónde se aplican de verdad

| Eje | Semántica | Enforcement real |
|---|---|---|
| `is_published` | aparece en el directorio | RPCs `directory_*` |
| `booking_enabled` | muestra reserva en línea | `validate_booking_slot` |
| **`is_operational`** | gate del panel | **frontend** `src/pages/panel/PanelLayout.tsx` · **server-side** `validate_booking_slot` (`s7_66:105`, exige `is_published AND booking_enabled AND is_operational`) |
| `is_verified` | sello de confianza | GENERATED de `lucy_status='verified'`, no editable |

**Verificado: ninguna policy RLS depende de `is_operational`.** Barrido de las 92
migraciones: cero coincidencias en cláusulas `USING` / `WITH CHECK` / `POLICY`.
Sus únicos dos gates son el frontend y `validate_booking_slot`.

> Esto es una buena noticia estructural: **desacoplar billing de `is_operational`
> no obliga a reescribir RLS.**

### 1.4 Qué NO existe hoy

- Cero infraestructura de billing: no hay `subscriptions`, `subscription_events`,
  `plans` ni `invoices`.
- Cero Edge Functions y cero webhooks en el proyecto.
- Cero referencias a proveedor de pago en `src/`.

### 1.5 Dos trampas registradas

**T1 — No reutilizar el pago de consulta.** Existen
`appointments.stripe_payment_id` y el enum `payment_status (pending|paid|refunded)`.
Pertenecen al **pago del paciente al médico por la consulta**, son legacy y están
sin uso. **Mezclarlos con la suscripción SaaS es un error caro y difícil de
deshacer.** Son dos dominios de dinero distintos.

**T2 — Deriva de tipos.** `src/types/database.types.ts` está desactualizado: le
faltan `doctors.is_operational` (existe desde `s7_02`) y la tabla
`waitlist_entries` (`s7_18`). Por eso el código los lee con `as any`
(`useClinicContext.ts`, `appointments.service.ts`). Billing añadirá tablas: **hay
que regenerar los tipos en el mismo PR de la migración**, según la convención
vigente del proyecto.

---

## 2. Modelo de titularidad — APROBADO

```
profiles (titular)
   │ owner_profile_id
   ▼
billing_account ──1:N──→ billing_account_scope (clinic_id)
   │                      [MVP: exactamente 1 fila]
   │ 1:N (histórico)
   ▼
subscription ──→ plan_price (versionado, inmutable)
   │              [MVP: mensual · anual · asistente adicional]
   │
   ├──→ subscription_events   (webhooks, append-only, idempotente)
   └──→ access_override       (excepciones acotadas, NO financiero)
                                        │
                                        ▼
                              entitlements (DERIVADOS)
```

**MVP:** 1 titular → 1 `billing_account` → 1 clínica → 1 suscripción vigente.
El diseño debe permitir después múltiples clínicas/médicos **sin rehacer la
arquitectura**.

### 2.1 Invariantes vinculantes

| # | Invariante |
|---|---|
| **I1** | `billing_account.owner_profile_id` → `profiles.id` = titular contractual |
| **I2** | El scope vive en `billing_account_scope`, **no** como columna `clinic_id` en la cuenta |
| **I3** | Una sola suscripción vigente por cuenta: índice único parcial sobre `status IN ('pending_checkout','active','grace_period','suspended')`. Las `ended` se acumulan como historia |
| **I4** | **Ninguna columna de billing entra a `doctors` ni a `clinics`** |
| **I5** | **`doctors.is_operational` no se lee ni se escribe nunca desde billing** |

### 2.2 Por qué se descartaron las alternativas

| Candidato | Por qué NO |
|---|---|
| **`doctor_id`** | `doctors` ya carga cuatro flags de estado. Peor: `doctors.clinic_id` es mutable — si un médico cambia de clínica, la suscripción se "mudaría" con él y arrastraría los asientos del equipo equivocado |
| **`clinic_id` solo** | La clínica no tiene identidad contractual: su `owner_id` puede cambiar y no hay forma de expresar quién firmó. Y por H2 el esquema ya permite N médicos por clínica → ambigüedad sobre quién paga |
| **`profile_id` solo** | Suficiente como titular, insuficiente como scope: asientos, agenda y pacientes ya son clinic-scoped (`team_seat_limit(p_clinic_id)`) |

**Por qué el scope es tabla y no columna:** con columna, pasar a "un titular con
dos clínicas" exige migrar datos y reescribir toda consulta de entitlements. Con
tabla, es insertar una fila. El costo hoy es una tabla de dos columnas.

---

## 3. Máquina de estados — APROBADA

### 3.1 Estado local de suscripción — cinco estados

| Estado | Significado | Entitlements | Sale hacia |
|---|---|---|---|
| `pending_checkout` | contrató, sin confirmación del proveedor | **ninguno** | `active` · `ended` |
| `active` | período vigente y pagado | plenos | `grace_period` · `ended` |
| `grace_period` | cobro falló, dentro de los 7 días | **plenos** | `active` · `suspended` |
| `suspended` | gracia agotada sin pago | degradados | `active` · `ended` |
| `ended` | terminal | ninguno | — |

**`trialing` queda FUERA del MVP.**

### 3.2 `canceled` NO es un estado — DECISIÓN VINCULANTE

Mientras quede período pagado, la suscripción sigue `active`. La cancelación es
un **atributo del período**:

```
cancel_at_period_end   boolean      -- el médico pidió no renovar
canceled_at            timestamptz  -- cuándo lo pidió (traza, no efecto)
current_period_start   timestamptz
current_period_end     timestamptz  -- la fecha que gobierna el corte
```

**Recorrido de una cancelación:**

```
día 3 del ciclo  → el médico cancela
                   status = active            (SIN CAMBIO)
                   cancel_at_period_end = true
                   canceled_at = now()
día 3 → día 30   → entitlements PLENOS, opera con normalidad
día 30 (period_end sin renovación) → status = ended
```

**Reactivación antes del vencimiento:** basta `cancel_at_period_end = false`. Sin
cambio de estado, sin recontratación, sin hueco de servicio. Ese es exactamente
el bug que evita eliminar `canceled` del enum.

### 3.3 Estado financiero — separado, nunca colapsado

Vive en `subscription_events`. Se conserva además `provider_status` como espejo
del último estado reportado, **explícitamente informativo**: no gobierna
entitlements.

| Evento del proveedor | Efecto local |
|---|---|
| pago exitoso | `grace_period`/`pending_checkout` → `active`; se recalcula `current_period_*` |
| cobro fallido | `active` → `grace_period`; `grace_until = now() + 7d` |
| cancelación en el portal | `cancel_at_period_end = true`, `canceled_at` — **el estado NO cambia** |
| reembolso / contracargo | **no cambia estado automáticamente** → cola de revisión de LucyAdmin |

### 3.4 Las dos transiciones que ningún webhook dispara

| Transición | Quién |
|---|---|
| `grace_period` → `suspended` | **job de vencimiento**, y solo tras reconsultar el proveedor |
| período vencido + `cancel_at_period_end` → `ended` | **job de vencimiento** |

Sin ese job, una cuenta impaga se queda en `grace_period` indefinidamente. Es el
modo de fallo más frecuente de este diseño: el job es parte del alcance de P2, no
un extra.

**Regla dura antes de suspender:** consultar el estado real en el proveedor. Si
responde `active`, **no suspender** y abrir alerta de discrepancia. Un webhook
perdido nunca debe producir un corte.

---

## 4. Políticas comerciales — APROBADAS

| Política | Valor |
|---|---|
| Trial | **no** en MVP |
| Renovación | aniversario de contratación |
| Cobro fallido | → `grace_period` |
| Gracia | **7 días** |
| Reintentos / dunning | del proveedor |
| Suspensión | al agotarse la gracia, **previa reconciliación contra el proveedor** |
| Cancelación | efectiva al fin del período ya pagado |
| Reactivación | self-service si el proveedor lo soporta |
| Asistentes incluidos | **2** |
| Reconciliación proveedor ↔ LucyCare | **diaria** |

### 4.1 Datos clínicos — texto vinculante

> Tras suspensión o cancelación, los datos clínicos **no se eliminan por impago**,
> y su acceso read-only / exportación **se regirá por la política legal de
> retención vigente**.

⚠️ **Esa política todavía NO está definida.** Es un pendiente legal, no técnico.
Ningún diseño de P1–P3 puede asumir un alcance concreto de lectura o exportación
hasta que exista.

### 4.2 Upgrades / downgrades / prorrateo

- **No se construye motor propio de prorrateo, ni de invoices.**
- Modalidades del MVP: **mensual · anual · asistentes adicionales**.
- Si el proveedor elegido soporta **prorrateo nativo** → se usa el suyo.
- Si no lo soporta → los cambios que lo requerirían se aplican **al siguiente
  ciclo**, salvo política específica posterior.
- Consecuencia: "soporta prorrateo nativo" es un **criterio comercial** de la
  grilla (§9.C), **no** un requisito eliminatorio.

---

## 5. Override administrativo — APROBADO

**LucyAdmin nunca marca una suscripción como "paid". No existe ese camino.**

Las cortesías y excepciones se modelan aparte:

```
access_override
  id
  billing_account_id
  entitlement_key         -- qué derecho concede
  reason                  -- OBLIGATORIO
  actor_profile_id        -- quién lo otorgó
  created_at
  expires_at              -- OBLIGATORIO, sin nulo posible
  revoked_at
```

| Regla | Motivo |
|---|---|
| Modifica **entitlements**, jamás el estado financiero ni el de suscripción | La contabilidad sigue siendo cierta |
| `expires_at` **NOT NULL**, sin excepción | Un override sin vencimiento se vuelve cortesía permanente que nadie recuerda |
| Alta, modificación y revocación → `audit_log` | Trazabilidad |
| Nunca sustituye un pago: la cuenta sigue apareciendo como impaga en la reportería | Evita corromper el dato financiero |

---

## 6. Webhook events — APROBADO

**Por defecto NO se persiste el payload íntegro del proveedor.**

```
subscription_events
  id
  provider
  provider_event_id         ┐ UNIQUE(provider, provider_event_id)
  event_type                ┘
  occurred_at               -- del proveedor: ordena los eventos
  received_at               -- nuestro: mide latencia y reentregas
  provider_customer_id
  provider_subscription_id
  billing_account_id        -- resuelto; nullable si no se pudo mapear
  processing_result         -- applied | ignored_duplicate | unmapped | error
  processing_error          -- acotado, sin volcado del proveedor
```

| Regla |
|---|
| `UNIQUE(provider, provider_event_id)` → **idempotencia por construcción** |
| El orden lo da `occurred_at`, no `received_at`: los proveedores reentregan y reordenan |
| **Ningún dato de tarjeta, ningún PAN, ningún token de pago** |
| Si más adelante se justifica conservar payload adicional, definir **antes**: campos · sensibilidad · retención · sanitización. No se persiste "por las dudas" |

---

## 7. Entitlements — APROBADO

| Key | Tipo | `active` / `grace_period` | `suspended` / `ended` |
|---|---|---|---|
| `panel.access` | bool | ✅ | ❌ |
| `booking.online` | bool | ✅ según plan | ❌ |
| `team.assistant_seats` | int | 2 + adicionales pagados | 0 nuevos (los existentes no se borran) |
| `clinical.records.read` | bool | ✅ | **según política legal de retención (§4.1)** |
| `clinical.records.write` | bool | ✅ | ❌ |
| `clinical.records.export` | bool | ✅ | **según política legal de retención (§4.1)** |

**Reglas:**

- **Derivados**, por función pura `estado + plan + overrides vigentes → capacidades`.
  Nunca se escriben a mano.
- **Fail-closed**: sin cuenta, sin suscripción o estado no resoluble → sin
  entitlements. Con la salvedad crítica de que **P1 y P2 no aplican
  entitlements**, así que ese fail-closed no puede afectar a nadie hasta P3.
- La separación `read` / `write` / `export` es lo que permite **degradar sin
  destruir**: se corta escribir, no leer.
- **Suspender no borra nada**: ni datos clínicos, ni asistentes, ni configuración.

### 7.1 Convivencia con `is_operational`

`is_operational` **no se toca y no se reutiliza**. Sigue siendo el flag
administrativo de LucyAdmin (suspensión por conducta, verificación, soporte). El
gate pasa a ser la **conjunción de dos ejes independientes**:

```
puede operar el panel  :=  doctors.is_operational                      (eje administrativo)
                       AND has_entitlement(clinic, 'panel.access')     (eje comercial)
```

Ventaja concreta: un médico suspendido por LucyAdmin **sigue figurando como al
día** en billing, y un médico impago **no queda marcado como sancionado**. Los
dos motivos de bloqueo quedan distinguibles en la UI, cosa que hoy sería
imposible.

Punto de aplicación server-side sugerido (**solo en P3**): `validate_booking_slot`
suma la condición de entitlement, y `team_seat_limit` lee `team.assistant_seats`.

---

## 8. Fases — APROBADAS

### BILLING-P0 · arquitectura, políticas y proveedor — **sin código**

Cerrar el modelo (este documento) · **llenar la grilla de §9 con datos reales de
proveedores** · validar fiscalidad/DTE · **elegir proveedor**.
**Salida:** arquitectura + proveedor elegido. Cero migraciones.

**Estado: PAUSADO** esperando la grilla llena.

### BILLING-P1 · modelo local en SHADOW MODE

Tablas, estados, precios, eventos y funciones de **lectura**. Vista read-only en
LucyAdmin.

**Prohibido en P1 — es el contrato de la fase:**

- ❌ bloquear a ningún médico
- ❌ modificar `is_operational`
- ❌ modificar booking ni `validate_booking_slot`
- ❌ modificar `team_seat_limit` (el `TODO(pagos)` de `s7_27` **no se toca en P1**)
- ❌ cambiar cualquier comportamiento productivo

**Criterio de aceptación:** todo usuario existente opera **exactamente igual**
antes y después. Demostrable, no afirmable.

### BILLING-P2 · integración real, todavía sin gates

Checkout · webhooks verificados · idempotencia · job de vencimiento ·
reconciliación diaria · portal comercial · sandbox completo.

**Los entitlements se calculan y se registran, pero NO se aplican.** La fase
termina cuando hay **evidencia medida** de que proveedor, webhooks y
reconciliación son confiables — no cuando el código funciona.

### BILLING-P3 · enforcement

`has_entitlement` en los gates · `team_seat_limit` cableado · booking · acceso al
panel · degradación · LucyAdmin · **recrear el CTA "Planes y facturación"**
(ver §11).

> **Regla que gobierna las cuatro fases:** el enforcement se activa **solo
> después** de demostrar la confiabilidad medida en P2. Aplicar gates sobre un
> estado no verificado deja afuera a clientes que pagaron.

---

## 9. Grilla FINAL de evaluación de proveedor

**Cómo se usa:** cada criterio tiene una pregunta verificable. Un criterio solo se
marca ✅ con **evidencia**: documentación oficial, respuesta escrita del proveedor
o prueba en sandbox. **"Probablemente sí" cuenta como ❌.**

⚠️ **Las celdas de capacidad nacen vacías a propósito.** No se rellenan desde el
repositorio: las capacidades de estos proveedores cambian, y afirmarlas de memoria
produciría exactamente la decisión mal fundada que este frente busca evitar.

### A. ELIMINATORIOS — un ❌ descarta al proveedor

| # | Criterio | Pregunta de verificación |
|---|---|---|
| **E1** | Opera legalmente desde El Salvador | ¿Admite alta de comercio con domicilio fiscal en SV? ¿Qué documentación exige? |
| **E2** | Liquidación en USD utilizable | ¿A qué tipo de cuenta liquida? ¿Plazo? ¿Requiere cuenta fuera de SV? |
| **E3** | Cobro recurrente | ¿Nativo, o tokenización sobre la que haya que construirlo? |
| **E4** | Webhooks firmados y verificables | ¿Qué esquema de firma? ¿Documentado? |
| **E5** | `customer_id` y `subscription_id` estables y consultables | ¿Sobreviven a cambio de tarjeta y a reactivación? |
| **E6** | Sandbox funcional | ¿Permite simular cobro fallido, dunning y cancelación? |
| **E7** | PCI fuera de nuestro alcance | ¿Checkout hosted o tokenización? ¿El PAN toca alguna vez nuestro dominio? |

### B. OPERATIVOS — obligatorios; un ❌ exige plan de mitigación escrito

| # | Criterio | Por qué |
|---|---|---|
| **O1** | Cambio de medio de pago (portal o API) | Sin esto, cada tarjeta vencida es un ticket de soporte |
| **O2** | Cancelación self-service | Sin esto, cancelar exige intervención humana |
| **O3** | Reintentos / dunning configurables u observables | El dunning se delega: hay que poder verlo |
| **O4** | **Historial de transacciones por API** | **Sin esto la reconciliación diaria es imposible** |
| **O5** | Idempotencia: `event_id` único + reentrega documentada | Base de `subscription_events` |
| **O6** | **Consulta de estado bajo demanda** | **Requisito de la política: reconsultar antes de suspender** |
| **O7** | Reactivación self-service | Política aprobada §4 |
| **O8** | Latencia y fiabilidad de webhooks | ¿SLA? ¿Cuántas reentregas? ¿Hasta cuándo? |

> **O4 y O6 son los más subestimados.** Sin ellos, la regla "reconciliar antes de
> suspender" no es implementable y el diseño pierde su red de seguridad. Tratarlos
> como **cuasi-eliminatorios**.

### C. COMERCIALES

| # | Criterio |
|---|---|
| C1 | Soporta plan **mensual** y **anual** en el mismo producto |
| C2 | Soporta **add-on por cantidad** (asistentes adicionales) |
| C3 | **Prorrateo nativo** — si no lo hay, aplica la regla de "siguiente ciclo" (§4.2) |
| C4 | Cancelación a fin de período nativa (`cancel_at_period_end`) |
| C5 | Precios en USD sin conversión |
| C6 | Cupones / descuentos (para el 15% anual, si no se modela como precio propio) |
| C7 | Portal de cliente completo, o APIs suficientes para construirlo |
| C8 | Acepta tarjetas emitidas en El Salvador — **verificar con tarjetas reales de bancos SV** |

### D. COSTO

**No comparar "comisión %".** Calcular el **costo total real para LucyCare en El
Salvador**, sobre escenarios concretos.

| # | Componente |
|---|---|
| D1 | Comisión por transacción (% + fijo) |
| D2 | Costo de **transacción fallida** y de reintento |
| D3 | Costo de contracargo |
| D4 | Costo de **liquidación / payout / transferencia** a la cuenta destino |
| D5 | Costo de conversión de divisa, si liquida fuera de SV |
| D6 | Mensualidad, mínimos o setup |
| D7 | Costo de mantener la **estructura** (entidad, contabilidad, cumplimiento) — decisivo en el camino "Stripe vía entidad extranjera" |
| D8 | **Costo total sobre escenario tipo** — modelar dos: piloto (5 médicos) y objetivo (50 médicos) |

> Un proveedor con 3% y payout gratuito puede resultar **más caro** que uno de 5%
> que exige una entidad extranjera con contabilidad anual. D7 y D8 revelan eso.

### E. FISCALES

| # | Criterio |
|---|---|
| F1 | ¿Quién es el **vendedor de registro** frente al médico salvadoreño? |
| F2 | ¿Quién emite el **comprobante** al médico y con qué validez en SV? |
| F3 | **Tratamiento del IVA 13%** — los precios ya son IVA incluido; falta cómo se declara |
| F4 | **DTE**: ¿quién lo emite, cómo y con qué integración? |
| F5 | Retenciones o percepciones aplicables al recibir del exterior |
| F6 | Obligaciones de reporte para LucyCare según la estructura elegida |
| F7 | **Validación con contador/legal salvadoreño — escrita, no verbal** |

> ⚠️ **REGLA VINCULANTE:** **no asumir que un Merchant of Record resuelve
> automáticamente las obligaciones fiscales salvadoreñas.** El MoR asume impuestos
> **en su jurisdicción y según su contrato**; qué queda del lado de LucyCare en SV
> depende del proveedor y de la estructura contractual concreta, y **debe
> comprobarse caso por caso**. Un ✅ en F1–F6 sin F7 **no vale**.

### F. UX DEL MÉDICO

| # | Criterio |
|---|---|
| U1 | Checkout en **español** |
| U2 | Checkout usable en **móvil** — el médico salvadoreño opera desde el teléfono |
| U3 | Portal de cliente en español |
| U4 | Métodos de pago familiares en SV (¿solo tarjeta? ¿transferencia? ¿billeteras locales?) |
| U5 | Correos del proveedor (recibo, fallo de cobro) en español y con marca aceptable |
| U6 | Fricción del alta: cuántos pasos y cuántos datos hasta el primer cobro |
| U7 | Coherencia de marca entre `medicos.lucycare.app` y el checkout |

### G. COMPLEJIDAD DE IMPLEMENTACIÓN

| # | Criterio |
|---|---|
| X1 | Calidad de documentación y SDK |
| X2 | ¿Hay que **construir el motor de recobro**? (si E3 es solo tokenización → mayor esfuerzo de todo el frente) |
| X3 | Cantidad de eventos a mapear a los 5 estados locales |
| X4 | Esfuerzo de la **reconciliación diaria** dado O4/O6 |
| X5 | Madurez del sandbox (X4 y X5 determinan cuánto dura P2) |
| X6 | Soporte técnico: canal, idioma, tiempo de respuesta |
| X7 | Riesgo de dependencia: ¿qué pasa si el proveedor cierra o cambia condiciones? ¿Se puede migrar la cartera de suscripciones? |

### 9.1 Hoja de evaluación

| | PayWay SV | N1CO | Paddle | Stripe (estructura viable) | Wompi SV | Recurrente | Pagadito |
|---|---|---|---|---|---|---|---|
| **A** eliminatorios E1–E7 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **B** operativos (0–8) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **C** comerciales (0–8) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **D** costo total (5 / 50 médicos) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **E** fiscales + F7 validado | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **F** UX médico (0–7) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **G** complejidad (bajo/medio/alto) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

**Candidatos base:** PayWay El Salvador · N1CO · Paddle · Stripe con estructura
viable desde El Salvador (evaluar la estructura dentro de D7, no solo la pasarela).

**Candidatos agregados por ser materialmente comparables:**

| Candidato | Por qué entra | Qué verificar primero |
|---|---|---|
| **Wompi (Banco Agrícola, SV)** | Adquirencia local con settlement USD directo a banco SV — elimina D4/D5 y buena parte de la sección E | **E3**: si el recurrente no es nativo, X2 dispara el esfuerzo del frente entero |
| **Recurrente (Guatemala)** | Enfocado en SaaS recurrente para Centroamérica; perfil funcional más cercano al necesario que un adquirente genérico | **E1**: cobertura real de comercios salvadoreños, no solo de tarjetas SV |
| **Pagadito (SV/CA)** | Presencia regional de larga data | **E3** y **O4** |

**Sobre Lemon Squeezy y 2Checkout/Verifone:** mismo arquetipo MoR que Paddle. Solo
tiene sentido sumarlos si Paddle falla E1 o E2; si no, se compara el arquetipo una
vez y se elige dentro de él al final.

### 9.2 Reglas de decisión

1. Un ❌ en cualquier **E** → descartado, sin discusión de precio.
2. Un ❌ en **O4** u **O6** → solo continúa con plan de mitigación **escrito** para
   la reconciliación.
3. **F7 sin validación escrita de contador/legal salvadoreño → el proveedor no se
   puede elegir**, por mucho que gane en todo lo demás.
4. **C3 (prorrateo) no descarta a nadie**: sin él aplica la regla de "siguiente
   ciclo".
5. **D se evalúa por escenario, no por porcentaje.**
6. Empate en A–C → decide **G**, porque determina cuánto dura P2, y P2 es la fase
   que retrasa el enforcement.

---

## 10. Riesgos

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| R1 | **Suspensión indebida de un médico al día** (webhook perdido, reloj mal) | 🚨 | Gracia + reconciliación diaria + suspensión solo por job con doble verificación contra el proveedor (§3.4) |
| R2 | **Acceso a historia clínica cortado por impago** | 🚨 | §4.1 y §7: no se elimina nada; read/export según política legal de retención |
| R3 | Webhook duplicado o reordenado → doble activación o estado viejo pisando uno nuevo | ⚠️ | `UNIQUE(provider, provider_event_id)` + orden por `occurred_at` |
| R4 | **Webhook perdido → cuenta congelada en `grace_period` para siempre** | ⚠️ | Job de vencimiento independiente + reconciliación diaria |
| R5 | Proveedor sin recurring nativo → construir el motor de recobro | ⚠️ | Eliminatorio E3; si no, MoR |
| R6 | Estado comercial contaminando `is_operational` | ⚠️ | Invariante I5 **desde el primer día**; una vez mezclados no se separan sin migración de datos |
| R7 | Cobro sin comprobante legal válido en SV | ⚠️ | Sección E de la grilla; F7 bloqueante |
| R8 | Sin SSO entre `lucycare.app` y `medicos.lucycare.app` → el médico se re-autentica | ⚠️ | Decisión aparte. **No resolver con tokens ni identificadores en la URL** |
| R9 | **Primera Edge Function del proyecto** — infra nunca ejercitada | ⚠️ | Validar deploy antes del PR funcional de P2 |
| R10 | Deriva de `database.types.ts` (§1.5 T2) | ⚠️ | Regenerar tipos en el mismo PR de la migración |
| R11 | Reutilizar `appointments.stripe_payment_id` / `payment_status` para SaaS | ⚠️ | Prohibido: son pago paciente→médico (§1.5 T1) |

---

## 11. Antecedente — PR #323 (cerrado sin merge)

El 2026-08-07 se implementó y luego se **cerró sin merge** el PR #323, que
agregaba en el panel del médico el acceso **"Planes y facturación"** hacia
`https://medicos.lucycare.app/medicos/planes`.

**Motivo del cierre: de producto, no técnico.** El destino sigue siendo un flujo
comercial demostrativo y todavía no constituye un portal autoritativo de
suscripción/facturación. Publicar el CTA prometería administración de plan,
tarjeta, pagos y cancelación sin backend que la sostenga.

**El CTA se recrea en BILLING-P3**, no antes. Su alcance conocido y validado era:

- `src/pages/panel/PanelLayout.tsx` — enlace en el footer del sidebar y del drawer
  móvil, antes de "Buscar médico", solo para el médico titular (`!isAssistant`),
  `target="_blank"` + `rel="noopener noreferrer"`.
- **URL sin query params**, sin transmitir `doctor_id`, `clinic_id`, `phone`,
  `email`, sesión ni token.
- `src/pages/panel/equipo/EquipoPage.tsx` — retirar la frase "cuando habilitemos
  los planes", que contradice el acceso.

⚠️ **Pendiente vivo:** mientras el CTA no exista, `EquipoPage` sigue diciéndole al
médico que los planes **todavía no están habilitados**. Es hoy el único copy del
producto que menciona "plan". Debe reconciliarse cuando se recree el acceso.

---

## 12. Relación con `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`

Ese documento **no se modificó** y sigue vigente en lo comercial. Queda
**obsoleto en lo arquitectónico**; ante cualquier contradicción, **manda este
documento**.

| Sección | Qué dice | Estado |
|---|---|---|
| **§6, tabla de gating** | `is_operational` "lo controla la suscripción" | 🔴 **OBSOLETO.** Contradice el invariante I5 |
| **§6.1** | La pantalla "Cuenta suspendida" cubre también el impago | 🔴 **OBSOLETO.** Con ejes separados son dos estados distinguibles, con copy distinto |
| **§6.2** | El webhook cambia `is_operational` / `booking_enabled` | 🔴 **OBSOLETO.** El webhook actualiza la suscripción; los entitlements se derivan. El webhook **nunca** escribe flags de `doctors` |
| **§8.1** | `subscriptions.clinic_id UNIQUE` como única ancla | 🔴 **OBSOLETO.** Falta `billing_account` y el titular contractual (§2) |
| **§5.1** | Enum de estados con `canceled`, sin `grace_period` ni `suspended` | 🔴 **OBSOLETO.** Ver §3.1 y §3.2 |
| **§0bis.2 / §15.8** | `team_seat_limit` es el punto de enganche | 🟢 **Vigente** |
| **§14** | Precios aprobados, versionados, en centavos, no hardcoded | 🟢 **Vigente** |
| **§15, §16, §17** | Autoservicio, LucyAdmin Billing, separación de responsabilidades | 🟢 **Vigente** |
| **§9 R1** | Riesgo de que Stripe no opere en SV | 🟢 Vigente, sujeto a la grilla §9 |

**Desalineamiento menor registrado:** `CLAUDE.md` mantiene "Pagos: Stripe Checkout
hosted" entre las decisiones cerradas. La elección de proveedor es ahora parte de
BILLING-P0 y esa línea debe reconciliarse al cerrar el frente.

---

## 13. Estado y siguiente paso

**BILLING-P0 = PAUSADO.** Fase A cerrada; Fase B (llenar la grilla y elegir
proveedor) **no iniciada**.

**Lo que desbloquea el frente — trabajo del owner, no del developer:**

1. Respuesta **escrita** de cada proveedor candidato sobre **E1–E7** y **O4/O6**.
2. **Validación fiscal F7** con contador/legal salvadoreño, por escrito.
3. Costo total sobre los dos escenarios de **D8**.
4. Definición de la **política legal de retención** de datos clínicos (§4.1).

Con la grilla llena y el proveedor elegido, BILLING-P0 cierra y recién entonces
tiene sentido diseñar P1.

**Siguiente frente candidato del proyecto: TWILIO-P0**, todavía **PAUSADO** — no
configurar Twilio sin instrucción del owner.

**Este documento no contiene** secretos, tokens, `service_role`, claves ni datos
de tarjeta.
