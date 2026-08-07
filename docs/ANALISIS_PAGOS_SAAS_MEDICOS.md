# Pagos SaaS / BILLING — fuente canónica

> 🟢 **ÚNICA FUENTE CANÓNICA DE BILLING.** Cualquier otro documento del repo que
> hable de suscripción, pagos, planes o facturación es **histórico** y cede ante
> este archivo.
>
> **Estado del frente — BILLING-P0: PAUSADO — arquitectura definida y capturada
> en PR #324, pendiente de merge.**
>
> **Reconciliado el 2026-08-07** con las decisiones de arquitectura BILLING-P0
> tomadas por el owner. Esa reconciliación **reemplazó** las partes obsoletas de
> las versiones anteriores (snapshot 2026-06-01 · refresh 2026-06-29 ·
> aprobaciones 2026-06-29). El registro exacto de qué se retiró y por qué está
> en **§20**.
>
> **Este documento NO autoriza código.** No hay implementación, no hay
> migraciones, no hay proveedor elegido.
>
> Acompaña a:
> - `docs/ANALISIS_AFILIACION_MEDICO.md` — cómo entra un médico (lead → `listed_only`).
> - `docs/ANALISIS_RECLAMAR_PERFIL.md` — cómo reclama (`listed_only` → `claimed`).
> - `docs/ANALISIS_ADMINISTRADORES_LUCY.md` — capacidades granulares de LucyAdmin.

---

## 0. Cómo leer este documento

| Bloque | Qué contiene | Estado |
|---|---|---|
| §1–§9 | **Arquitectura BILLING-P0**: titularidad, estados, entitlements, políticas, override, webhooks, asientos | **Aprobado 2026-08-07** |
| §10–§13 | **Modelo comercial**: precios, autoservicio, LucyAdmin Billing, separación | **Vigente** (aprobado 2026-06-29) |
| §14 | Responsabilidades por actor | Aprobado 2026-08-07 |
| §15 | Proveedor: contexto + **grilla final de evaluación** | Grilla aprobada; **proveedor NO elegido** |
| §16–§17 | Riesgos y fases | Aprobado 2026-08-07 |
| §18–§19 | Antecedente PR #323 y qué falta para retomar | Registro |
| §20 | **Qué quedó obsoleto y fue retirado** | Registro de la reconciliación |

**Dos principios gobiernan todo lo demás:**

1. **El estado comercial es independiente del estado administrativo.**
   `doctors.is_operational` **no** es —ni será— indicador de pago.
2. **El enforcement se activa último.** Primero el modelo en sombra, después la
   integración medida, y solo entonces los gates.

---

## 1. Problema y objetivo

Hoy el médico puede llegar a `claimed` pero **no hay forma de cobrarle**. La
activación operativa (`is_operational`, `booking_enabled`) se hace manualmente
por LucyAdmin.

**Objetivo:** monetizar LucyCare como SaaS de suscripción autoservicio, con
renovación recurrente, manejo de fallos de cobro y cancelación, sin intervención
manual en el camino feliz.

**No-objetivos de este documento:** diseño visual de las pantallas de pago ·
elección de pasarela (§15) · facturación tributaria DTE (diferida; decisión de
stack: API externa, no se desarrolla internamente).

> **Billing NO bloquea el piloto.** Durante el piloto, la gestión comercial de
> los pocos médicos participantes se maneja **manualmente**. Este frente es
> prerequisito del **lanzamiento comercial**, no del piloto.

---

## 2. Estado verificado del modelo actual (repo, 2026-08-07)

> Todo lo de esta sección sale del repositorio: migraciones, tipos generados y
> código. **No se consultó la base con `service_role`** — no fue autorizado y no
> se pidió. El catálogo real podría diferir.

### 2.1 Entidades y cardinalidades reales

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

**Tres hallazgos que condicionan el diseño:**

| # | Hallazgo | Consecuencia |
|---|---|---|
| **H1** | `doctors.profile_id` es **UNIQUE** | Un profile es a lo sumo un médico → el titular contractual es identificable sin ambigüedad |
| **H2** | `doctors.clinic_id` **NO** es unique | El esquema **ya admite N médicos por clínica**. Billing no puede asumir 1:1 |
| **H3** | El titular está representado **dos veces**: `clinics.owner_id` y `clinic_members.role='owner'` | Dos fuentes que pueden divergir. Billing se ancla a **una** y trata la otra como derivada |

### 2.2 Los cuatro ejes del médico y dónde se aplican de verdad

| Eje | Semántica | Enforcement real |
|---|---|---|
| `is_published` | aparece en el directorio | RPCs `directory_*` |
| `booking_enabled` | muestra reserva en línea | `validate_booking_slot` |
| **`is_operational`** | gate del panel | **frontend** `src/pages/panel/PanelLayout.tsx` · **server-side** `validate_booking_slot` (`s7_66:105`: exige `is_published AND booking_enabled AND is_operational`) |
| `is_verified` | sello de confianza | GENERATED de `lucy_status='verified'`, no editable |

**Verificado: ninguna policy RLS depende de `is_operational`.** Barrido de las 92
migraciones: cero coincidencias en cláusulas `USING` / `WITH CHECK` / `POLICY`.
Sus únicos dos gates son el frontend y `validate_booking_slot`.

> Consecuencia estructural favorable: **desacoplar billing de `is_operational` no
> obliga a reescribir RLS.**

### 2.3 Qué NO existe hoy

- Cero infraestructura de billing: no hay `subscriptions`, `subscription_events`,
  `plans` ni `invoices`.
- Cero Edge Functions y cero webhooks en el proyecto.
- Cero referencias a proveedor de pago en `src/`.

### 2.4 Dos trampas registradas

**T1 — No reutilizar el pago de consulta.** Existen
`appointments.stripe_payment_id` y el enum `payment_status (pending|paid|refunded)`.
Pertenecen al **pago del paciente al médico por la consulta**, son legacy y están
sin uso. Mezclarlos con la suscripción SaaS es un error caro y difícil de
deshacer: son dos dominios de dinero distintos.

**T2 — Deriva de tipos.** `src/types/database.types.ts` está desactualizado: le
faltan `doctors.is_operational` (existe desde `s7_02`) y la tabla
`waitlist_entries` (`s7_18`). Por eso el código los lee con `as any`
(`useClinicContext.ts`, `appointments.service.ts`). Billing añadirá tablas: **hay
que regenerar los tipos en el mismo PR de la migración**, según la convención
vigente.

---

## 3. Modelo de titularidad — APROBADO (2026-08-07)

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

### 3.1 Invariantes vinculantes

| # | Invariante |
|---|---|
| **I1** | `billing_account.owner_profile_id` → `profiles.id` = titular contractual |
| **I2** | El scope vive en `billing_account_scope`, **no** como columna `clinic_id` en la cuenta |
| **I3** | Una sola suscripción vigente por cuenta: índice único parcial sobre `status IN ('pending_checkout','active','grace_period','suspended')`. Las `ended` se acumulan como historia |
| **I4** | **Ninguna columna de billing entra a `doctors` ni a `clinics`** |
| **I5** | **`doctors.is_operational` no se lee ni se escribe nunca desde billing** |

### 3.2 Por qué se descartaron las alternativas

| Candidato | Por qué NO |
|---|---|
| **`doctor_id`** | `doctors` ya carga cuatro flags de estado. Peor: `doctors.clinic_id` es mutable — si un médico cambia de clínica, la suscripción se "mudaría" con él y arrastraría los asientos del equipo equivocado |
| **`clinic_id` solo** | La clínica no tiene identidad contractual: su `owner_id` puede cambiar y no hay forma de expresar quién firmó. Y por **H2** el esquema ya permite N médicos por clínica → ambigüedad sobre quién paga |
| **`profile_id` solo** | Suficiente como titular, insuficiente como scope: asientos, agenda y pacientes ya son clinic-scoped (`team_seat_limit(p_clinic_id)`) |

**Por qué el scope es tabla y no columna:** con columna, pasar a "un titular con
dos clínicas" exige migrar datos y reescribir toda consulta de entitlements. Con
tabla, es insertar una fila. El costo hoy es una tabla de dos columnas.

---

## 4. Máquina de estados — APROBADA (2026-08-07)

### 4.1 Estado local de suscripción — cinco estados

| Estado | Significado | Entitlements | Sale hacia |
|---|---|---|---|
| `pending_checkout` | contrató, sin confirmación del proveedor | **ninguno** | `active` · `ended` |
| `active` | período vigente y pagado | plenos | `grace_period` · `ended` |
| `grace_period` | cobro falló, dentro de los 7 días | **plenos** | `active` · `suspended` |
| `suspended` | gracia agotada sin pago | degradados | `active` · `ended` |
| `ended` | terminal | ninguno | — |

**`trialing` queda FUERA del MVP.**

### 4.2 `canceled` NO es un estado — VINCULANTE

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

### 4.3 Estado financiero — separado, nunca colapsado

Vive en `subscription_events`. Se conserva además `provider_status` como espejo
del último estado reportado, **explícitamente informativo**: no gobierna
entitlements.

| Evento del proveedor | Efecto local |
|---|---|
| pago exitoso | `grace_period`/`pending_checkout` → `active`; se recalcula `current_period_*` |
| cobro fallido | `active` → `grace_period`; `grace_until = now() + 7d` |
| cancelación en el portal | `cancel_at_period_end = true`, `canceled_at` — **el estado NO cambia** |
| reembolso / contracargo | **no cambia estado automáticamente** → cola de revisión de LucyAdmin |

### 4.4 Las dos transiciones que ningún webhook dispara

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

### 4.5 Principios del flujo

- **La fuente de verdad del pago es el webhook verificado**, no el redirect del
  navegador. El redirect solo muestra "estamos confirmando…".
- **Idempotencia**: cada evento se procesa una sola vez (§8).
- **Reconciliación diaria** como red de seguridad ante webhooks perdidos.
- **Nunca activar acceso desde el cliente.**

---

## 5. Entitlements — APROBADO (2026-08-07)

| Key | Tipo | `active` / `grace_period` | `suspended` / `ended` |
|---|---|---|---|
| `panel.access` | bool | ✅ | ❌ |
| `booking.online` | bool | ✅ según plan | ❌ |
| `team.assistant_seats` | int | 2 + adicionales pagados | 0 nuevos (los existentes no se borran) |
| `clinical.records.read` | bool | ✅ | **según política legal de retención (§6.1)** |
| `clinical.records.write` | bool | ✅ | ❌ |
| `clinical.records.export` | bool | ✅ | **según política legal de retención (§6.1)** |

**Reglas:**

- **Derivados**, por función pura `estado + plan + overrides vigentes → capacidades`.
  Nunca se escriben a mano.
- **Fail-closed**: sin cuenta, sin suscripción o estado no resoluble → sin
  entitlements. Con la salvedad crítica de que **P1 y P2 no aplican
  entitlements**, así que ese fail-closed no puede afectar a nadie hasta P3.
- La separación `read` / `write` / `export` es lo que permite **degradar sin
  destruir**: se corta escribir, no leer.
- **Suspender no borra nada**: ni datos clínicos, ni asistentes, ni configuración.

### 5.1 Convivencia con `is_operational`

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

Punto de aplicación server-side (**solo en P3**): `validate_booking_slot` suma la
condición de entitlement, y `team_seat_limit` lee `team.assistant_seats`.

> **`is_verified` no cambia.** Es sello de confianza de LucyAdmin. Un médico que
> paga **no** se auto-verifica. Y **`claimed` tampoco depende del pago**: la
> identidad es previa e independiente.

---

## 6. Políticas comerciales — APROBADAS (2026-08-07)

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

### 6.1 Datos clínicos — texto vinculante

> Tras suspensión o cancelación, los datos clínicos **no se eliminan por impago**,
> y su acceso read-only / exportación **se regirá por la política legal de
> retención vigente**.

⚠️ **Esa política todavía NO está definida.** Ningún diseño de P1–P3 puede asumir
un alcance concreto de lectura o exportación hasta que exista.

### 6.2 Upgrades / downgrades / prorrateo

- **No se construye motor propio de prorrateo, ni de invoices.**
- Modalidades del MVP: **mensual · anual · asistentes adicionales**.
- Si el proveedor elegido soporta **prorrateo nativo** → se usa el suyo.
- Si no lo soporta → los cambios que lo requerirían se aplican **al siguiente
  ciclo**, salvo política específica posterior.
- Consecuencia: "soporta prorrateo nativo" es un **criterio comercial** de la
  grilla (§15.C), **no** un requisito eliminatorio.

---

## 7. Override administrativo — APROBADO (2026-08-07)

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

## 8. Webhook events — APROBADO (2026-08-07)

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
| Verificación de **firma** del webhook; secreto en ENV, nunca en el repo |
| Si más adelante se justifica conservar payload adicional, definir **antes**: campos · sensibilidad · retención · sanitización. No se persiste "por las dudas" |

---

## 9. Límite de equipo y asientos

### 9.1 Lo que YA existe y es punto de enganche (no rehacer)

`migrations/s7_27_team_seat_limit.sql`:

```sql
CREATE OR REPLACE FUNCTION team_seat_limit(p_clinic_id uuid) ...
  -- TODO(pagos): reemplazar el 2 fijo por
  --   included_assistants + additional_assistants de subscriptions(p_clinic_id).
  SELECT 2;
```

- `team_seats_used(p_clinic_id)` = asistentes activos + invitaciones pendientes
  vigentes (las vencidas no ocupan cupo, desde `s7_36`).
- **Enforcement server-side ya activo**: trigger `trg_enforce_team_seat_limit`
  sobre `clinic_invitations` + revalidación en `accept_clinic_invitations`.
- **La firma toma `clinic_id`** → el entitlement se cablea sin cambiar firma, ni
  triggers, ni RPCs.

⚠️ **Ese cableado pertenece a BILLING-P3, no a P1** (§17).

### 9.2 Regla de asientos

- Plan base = **1 titular + 2 asistentes incluidos**.
- `extra_seats = max(asistentes_activos − 2, 0)`.
- Sin prorrateo en MVP: agregar o quitar impacta el cobro **desde el próximo
  ciclo** (§6.2).
- Al reducir asientos, los usuarios por encima del límite se **bloquean, no se
  borran**. **Nunca se elimina historial clínico ni auditoría** por quitar un
  asistente.

### 9.3 Semántica a alinear al implementar

El modelo comercial habla de **3 usuarios totales** (titular + 2 asistentes),
mientras `team_seat_limit` representa **asistentes (= 2)**, sin contar al
titular. No es contradicción, pero debe quedar explícito para no contar mal el
cupo: `team_seat_limit = asistentes incluidos + adicionales pagados`.

---

## 10. Modelo comercial y precios — VIGENTE (aprobado 2026-06-29)

### 10.1 Precios aprobados (USD, IVA 13% incluido)

Unidad comercial = **médico titular**; cada plan base incluye **1 titular + 2
asistentes** (3 accesos). Todos los montos son **IVA incluido**. Moneda **USD**
(curso legal en SV).

| Concepto | Bruto (IVA incl.) | Base s/IVA | IVA 13% | Centavos (bruto / base / IVA) |
|---|---|---|---|---|
| **Plan mensual** | **$59.00 / mes** | $52.21 | $6.79 | **5900 / 5221 / 679** |
| **Plan anual** (−15% vs 12 mensuales) | **$601.80 / año** | $532.57 | $69.23 | **60180 / 53257 / 6923** |
| Plan anual — equivalente visible | $50.15 / mes | — | — | — |
| **Usuario adicional / mes** | **$6.00 / usuario / mes** | $5.31 | $0.69 | **600 / 531 / 69** |
| **Usuario adicional / año** (−15%) | **$61.20 / usuario / año** | $54.16 | $7.04 | **6120 / 5416 / 704** |

Verificaciones: mensual×12 = $708 → −15% = **$601.80**; $601.80/12 = **$50.15/mes**;
adicional mensual×12 = $72 → −15% = **$61.20**; en las 4 filas `base + IVA = bruto`.

- **Usuario adicional anual:** aplica el **mismo 15%** que el plan anual.
- **IVA:** los precios son **IVA-incluido**. La **emisión de comprobante/DTE
  sigue pendiente** (§15.E).

> **Histórico (2026-06-01, superseded):** la propuesta original era $55/mes,
> $594/año (10% off) y $5/usuario adicional. Se conserva solo como registro; los
> precios vigentes son los de arriba.

### 10.2 Principio obligatorio — precios configurables, NO hardcoded

- **Fuente de verdad = servidor/DB.** El frontend **solo muestra** precios
  entregados por el backend; **nunca** calcula dinero crítico ni asume el IVA.
- **Dinero en centavos enteros** (`*_cents`), **nunca floats**.
- **IVA y descuentos en basis points** (IVA `1300`, descuento anual `1500`).
- **Filas de precio versionadas e inmutables:** cambiar un precio público =
  **insertar una fila nueva** (`effective_from` nuevo) + **desactivar** la
  anterior. **Nunca editar el monto de una fila viva.**
- **Grandfathering:** cada suscripción guarda el `plan_price_id` con el que se
  contrató; cambiar el precio público **no** modifica suscripciones existentes.
- **IDs de la pasarela** (`provider_product_id` / `provider_price_id`) viven
  asociados a la fila de precio, **no quemados en componentes**.

### 10.3 Diseño de `plan_price` (propuesta, NO implementar)

```
plan_price
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
  provider                   -- nullable hasta elegir pasarela
  provider_product_id        -- nullable hasta integrar
  provider_price_id          -- nullable hasta integrar
  active
  effective_from / effective_to
  created_at / updated_at
```

Canónico = `gross_amount_cents` + `tax_rate_bps` + `tax_included`; `net`/`tax` se
derivan. Relación futura: `subscription.plan_price_id` → FK a esta tabla
(grandfathering).

---

## 11. Autoservicio del médico — VIGENTE (aprobado 2026-06-29)

El médico debe poder gestionar su suscripción **sin intervención manual** de
LucyCare, desde el entorno comercial (`medicos.lucycare.app`) o el portal seguro
del proveedor:

1. contratar y elegir plan;
2. ver estado de su suscripción;
3. cambiar método de pago / tarjeta;
4. cancelar;
5. reactivar;
6. ajustar usuarios adicionales.

**Cambio de método de pago:** LucyCare **no captura ni almacena datos de
tarjeta** (PCI fuera de alcance). El médico se redirige al portal seguro.
LucyCare solo guarda **identificadores del proveedor** y **estado derivado**,
nunca el PAN. La confirmación real llega por **webhook firmado**; **la URL de
retorno no es fuente de verdad**.

**Cancelación:** efectiva al final del período pagado (§4.2). Sin reembolso
automático por período parcial en MVP.

---

## 12. LucyAdmin Billing — VIGENTE (aprobado 2026-06-29)

**La pasarela cobra; LucyAdmin gobierna el negocio.** Módulo administrativo para
controlar ingresos, suscripciones, usuarios y suspensiones.

### 12.1 Qué debe poder saberse

Qué médicos tienen suscripción vigente · quién pagó · cuánto · qué plan ·
asistentes incluidos y adicionales · cuánto corresponde el próximo ciclo · cuándo
vence el período · estado · quién está en gracia · quién fue reactivado · ingreso
cobrado del mes · MRR · ARR · pendiente/fallido/vencido.

### 12.2 Dashboard mínimo (KPIs)

Ingresos cobrados del mes · MRR · ARR · médicos por estado (`active`,
`grace_period`, `suspended`, `ended`) · usuarios adicionales activos e ingresos
por ellos · próximos vencimientos · pagos fallidos recientes · reactivaciones.

### 12.3 Lista y detalle

**Filtros:** estado · plan · médico · clínica · próximo cobro · último pago ·
proveedor · en gracia · suspendibles.
**Detalle por cuenta:** plan actual · `plan_price_id` contratado · historial de
pagos y de eventos · asientos · fechas de período · intentos fallidos · motivo de
suspensión · reactivaciones · **overrides vigentes y vencidos** · notas internas.

### 12.4 Control operativo

Ver quién está por suspenderse · **otorgar `access_override` acotado y auditado
(§7)** · registrar nota/motivo · exportar reporte · revisar la conciliación
proveedor ↔ LucyCare. Toda acción → `audit_log`.

> **Prohibido:** marcar manualmente una suscripción como "pagada". No existe ese
> camino (§7).

### 12.5 Conciliación

Fuente principal = webhook firmado. Además LucyAdmin debe permitir comparar
pagos del proveedor vs estado local · detectar webhook perdido y pago duplicado ·
detectar "vigente en proveedor pero suspendida en LucyCare" y su inverso ·
revisión manual segura con auditoría.

### 12.6 Reportería

Ingresos por mes · por plan mensual · por plan anual · por usuarios adicionales ·
pagos fallidos · cancelaciones · reactivaciones · suspendidos por impago ·
churn · MRR · ARR · export CSV/XLS (futuro).

### 12.7 Principio vinculante

**No depender solo del panel de la pasarela para administrar el negocio.**

---

## 13. Separación arquitectónica — VIGENTE (aprobado 2026-06-29)

**LucyAdmin Billing es un módulo administrativo separado del SaaS operativo del
médico.** Cuatro responsabilidades distintas: Lucy SaaS (operación clínica) ·
LucyAdmin Billing (control financiero) · pasarela (cobro) · backend/webhooks
(sincronización confiable).

En MVP puede vivir dentro del mismo proyecto como **rutas protegidas de
LucyAdmin** (`/admin/billing/...`); conceptualmente es un backoffice separado. Lo
que importa es separar **permisos, rutas, auditoría y responsabilidad**.

**Qué ve el médico:** solo su suscripción — plan, estado, próxima fecha,
asistentes, enlaces para pagar/cambiar medio de pago/cancelar, y avisos de pago
fallido o gracia.
**Qué NO ve:** ingresos globales · pagos de otros médicos · conciliación ·
reportería financiera · overrides · eventos internos.

**Roles de billing (diseño futuro):** `super_admin` · `billing_admin` ·
`billing_readonly` · `support_admin`. Se alinean con la Fase 2 de
`docs/ANALISIS_ADMINISTRADORES_LUCY.md`. Hoy `profiles.role='admin'` +
`lucyadmin_access` (`s7_57`) es lo único existente.

---

## 14. Responsabilidades por actor

| Actor | Sí | **No** |
|---|---|---|
| **`medicos.lucycare.app`** (entorno comercial) | contratar · elegir/cambiar plan · ver estado · administrar medio de pago · cancelar · consultar facturación | ser fuente de verdad del estado · escribir entitlements |
| **Proveedor** | tokenizar · cobrar · renovar · dunning · emitir eventos · portal seguro | conocer el modelo de LucyCare |
| **Backend LucyCare** | billing account · suscripción local · plan · **entitlements** · consumo de webhooks · idempotencia · reconciliación · control de acceso | almacenar datos de tarjeta · cobrar |
| **LucyAdmin** | observabilidad · ver estado · detectar fallos · `access_override` **acotado y auditado** | **marcar "pagado"** |
| **LucyCare operativo** (`lucycare.app`) | mostrar el estado necesario y enlazar al entorno comercial | administrar pagos |

---

## 15. Proveedor — contexto y grilla final de evaluación

> **Proveedor NO elegido.** Esta sección define **cómo** se elige, no cuál.

### 15.0 El problema central: operar desde El Salvador

La pregunta bloqueante no es técnica (todas las pasarelas hacen checkout +
webhooks), sino **si el proveedor admite a LucyCare como comercio operando desde
El Salvador** y **cómo liquida el dinero**.

**Tres caminos arquetípicos:**

- **A — MoR global** (Paddle, Lemon Squeezy, 2Checkout): recurring llave en mano
  y menos fricción tributaria cross-border, a costa de comisión más alta y menos
  control del branding. **Requiere comprobar** que aceptan seller en SV y payout
  a SV.
- **B — Pasarela local SV** (PayWay, N1CO, Wompi, Pagadito): settlement USD
  local, comisión más baja, alineado a que Lucy y los médicos están en SV. Riesgo:
  si el recurrente no es nativo, hay que **construir el motor de recobro**.
- **C — Estructura extranjera** (p. ej. Stripe vía entidad US): el mejor tooling
  de billing, a cambio de constituir y mantener una entidad, repatriar fondos y
  tributar en dos jurisdicciones. Solo se justifica si se busca escalar fuera de
  SV.

### 15.1 Cómo se usa la grilla

Cada criterio tiene una pregunta verificable. Un criterio solo se marca ✅ con
**evidencia**: documentación oficial, respuesta escrita del proveedor o prueba en
sandbox. **"Probablemente sí" cuenta como ❌.**

⚠️ **Las celdas de capacidad nacen vacías a propósito.** No se rellenan desde el
repositorio ni de memoria: las capacidades de estos proveedores cambian, y
afirmarlas sin verificar produce exactamente la decisión mal fundada que este
frente busca evitar.

### 15.A ELIMINATORIOS — un ❌ descarta al proveedor

| # | Criterio | Pregunta de verificación |
|---|---|---|
| **E1** | Opera legalmente desde El Salvador | ¿Admite alta de comercio con domicilio fiscal en SV? ¿Qué documentación exige? |
| **E2** | Liquidación en USD utilizable | ¿A qué tipo de cuenta liquida? ¿Plazo? ¿Requiere cuenta fuera de SV? |
| **E3** | Cobro recurrente | ¿Nativo, o tokenización sobre la que haya que construirlo? |
| **E4** | Webhooks firmados y verificables | ¿Qué esquema de firma? ¿Documentado? |
| **E5** | `customer_id` y `subscription_id` estables y consultables | ¿Sobreviven a cambio de tarjeta y a reactivación? |
| **E6** | Sandbox funcional | ¿Permite simular cobro fallido, dunning y cancelación? |
| **E7** | PCI fuera de nuestro alcance | ¿Checkout hosted o tokenización? ¿El PAN toca alguna vez nuestro dominio? |

### 15.B OPERATIVOS — obligatorios; un ❌ exige plan de mitigación escrito

| # | Criterio | Por qué |
|---|---|---|
| **O1** | Cambio de medio de pago (portal o API) | Sin esto, cada tarjeta vencida es un ticket de soporte |
| **O2** | Cancelación self-service | Sin esto, cancelar exige intervención humana |
| **O3** | Reintentos / dunning configurables u observables | El dunning se delega: hay que poder verlo |
| **O4** | **Historial de transacciones por API** | **Sin esto la reconciliación diaria es imposible** |
| **O5** | Idempotencia: `event_id` único + reentrega documentada | Base de `subscription_events` |
| **O6** | **Consulta de estado bajo demanda** | **Requisito de la política: reconsultar antes de suspender (§4.4)** |
| **O7** | Reactivación self-service | Política aprobada §6 |
| **O8** | Latencia y fiabilidad de webhooks | ¿SLA? ¿Cuántas reentregas? ¿Hasta cuándo? |

> **O4 y O6 son los más subestimados.** Sin ellos, la regla "reconciliar antes de
> suspender" no es implementable y el diseño pierde su red de seguridad.
> Tratarlos como **cuasi-eliminatorios**.

### 15.C COMERCIALES

| # | Criterio |
|---|---|
| C1 | Soporta plan **mensual** y **anual** en el mismo producto |
| C2 | Soporta **add-on por cantidad** (asistentes adicionales) |
| C3 | **Prorrateo nativo** — si no lo hay, aplica la regla de "siguiente ciclo" (§6.2) |
| C4 | Cancelación a fin de período nativa (`cancel_at_period_end`) |
| C5 | Precios en USD sin conversión |
| C6 | Cupones / descuentos (para el 15% anual, si no se modela como precio propio) |
| C7 | Portal de cliente completo, o APIs suficientes para construirlo |
| C8 | Acepta tarjetas emitidas en El Salvador — **verificar con tarjetas reales de bancos SV** |

### 15.D COSTO

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
| D7 | Costo de mantener la **estructura** (entidad, contabilidad, cumplimiento) — decisivo en el camino C |
| D8 | **Costo total sobre escenario tipo** — modelar dos: **piloto (5 médicos)** y **objetivo (50 médicos)** |

> Un proveedor con 3% y payout gratuito puede resultar **más caro** que uno de 5%
> que exige una entidad extranjera con contabilidad anual. D7 y D8 revelan eso.

### 15.E FISCALES

| # | Criterio |
|---|---|
| F1 | ¿Quién es el **vendedor de registro** frente al médico salvadoreño? |
| F2 | ¿Quién emite el **comprobante** al médico y con qué validez en SV? |
| F3 | **Tratamiento del IVA 13%** — los precios ya son IVA incluido (§10.1); falta cómo se declara |
| F4 | **DTE**: ¿quién lo emite, cómo y con qué integración? |
| F5 | Retenciones o percepciones aplicables al recibir del exterior |
| F6 | Obligaciones de reporte para LucyCare según la estructura elegida |
| F7 | **Validación con contador/legal salvadoreño — escrita, no verbal** |

> ⚠️ **REGLA VINCULANTE:** **no asumir que un Merchant of Record resuelve
> automáticamente las obligaciones fiscales salvadoreñas.** El MoR asume impuestos
> **en su jurisdicción y según su contrato**; qué queda del lado de LucyCare en SV
> depende del proveedor y de la estructura contractual concreta, y **debe
> comprobarse caso por caso**. Un ✅ en F1–F6 sin F7 **no vale**.

### 15.F UX DEL MÉDICO

| # | Criterio |
|---|---|
| U1 | Checkout en **español** |
| U2 | Checkout usable en **móvil** — el médico salvadoreño opera desde el teléfono |
| U3 | Portal de cliente en español |
| U4 | Métodos de pago familiares en SV (¿solo tarjeta? ¿transferencia? ¿billeteras locales?) |
| U5 | Correos del proveedor (recibo, fallo de cobro) en español y con marca aceptable |
| U6 | Fricción del alta: cuántos pasos y cuántos datos hasta el primer cobro |
| U7 | Coherencia de marca entre `medicos.lucycare.app` y el checkout |

### 15.G COMPLEJIDAD DE IMPLEMENTACIÓN

| # | Criterio |
|---|---|
| X1 | Calidad de documentación y SDK |
| X2 | ¿Hay que **construir el motor de recobro**? (si E3 es solo tokenización → mayor esfuerzo de todo el frente) |
| X3 | Cantidad de eventos a mapear a los 5 estados locales |
| X4 | Esfuerzo de la **reconciliación diaria** dado O4/O6 |
| X5 | Madurez del sandbox (X4 y X5 determinan cuánto dura P2) |
| X6 | Soporte técnico: canal, idioma, tiempo de respuesta |
| X7 | Riesgo de dependencia: ¿qué pasa si el proveedor cierra o cambia condiciones? ¿Se puede migrar la cartera de suscripciones? |

### 15.1 Hoja de evaluación

| | PayWay SV | N1CO | Paddle | Stripe (estructura viable) | Wompi SV | Recurrente | Pagadito |
|---|---|---|---|---|---|---|---|
| **A** eliminatorios E1–E7 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **B** operativos O1–O8 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **C** comerciales C1–C8 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **D** costo total (5 / 50 médicos) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **E** fiscales + F7 validado | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **F** UX médico U1–U7 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **G** complejidad (bajo/medio/alto) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

**Candidatos base:** PayWay El Salvador · N1CO · Paddle · Stripe con estructura
viable desde El Salvador (evaluar la estructura dentro de D7, no solo la pasarela).

**Candidatos agregados por ser materialmente comparables:**

| Candidato | Por qué entra | Qué verificar primero |
|---|---|---|
| **Wompi (Banco Agrícola, SV)** | Adquirencia local con settlement USD directo a banco SV — elimina D4/D5 y buena parte de la sección E | **E3**: si el recurrente no es nativo, X2 dispara el esfuerzo del frente entero |
| **Recurrente (Guatemala)** | Enfocado en SaaS recurrente para Centroamérica; perfil funcional más cercano al necesario que un adquirente genérico | **E1**: cobertura real de comercios salvadoreños, no solo de tarjetas SV |
| **Pagadito (SV/CA)** | Presencia regional de larga data | **E3** y **O4** |

**Sobre Lemon Squeezy y 2Checkout/Verifone:** mismo arquetipo MoR que Paddle.
Solo tiene sentido sumarlos si Paddle falla E1 o E2; si no, se compara el
arquetipo una vez y se elige dentro de él al final.

### 15.2 Reglas de decisión

1. Un ❌ en cualquier **E** → descartado, sin discusión de precio.
2. Un ❌ en **O4** u **O6** → solo continúa con plan de mitigación **escrito**.
3. **F7 sin validación escrita de contador/legal salvadoreño → el proveedor no se
   puede elegir**, por mucho que gane en todo lo demás.
4. **C3 (prorrateo) no descarta a nadie**: sin él aplica la regla de "siguiente
   ciclo".
5. **D se evalúa por escenario, no por porcentaje.**
6. Empate en A–C → decide **G**, porque determina cuánto dura P2, y P2 es la fase
   que retrasa el enforcement.

---

## 16. Riesgos

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| R1 | **Suspensión indebida de un médico al día** (webhook perdido, reloj mal) | 🚨 | Gracia + reconciliación diaria + suspensión solo por job con doble verificación contra el proveedor (§4.4) |
| R2 | **Acceso a historia clínica cortado por impago** | 🚨 | §5 y §6.1: no se elimina nada; read/export según política legal de retención |
| R3 | Webhook duplicado o reordenado → doble activación o estado viejo pisando uno nuevo | ⚠️ | `UNIQUE(provider, provider_event_id)` + orden por `occurred_at` |
| R4 | **Webhook perdido → cuenta congelada en `grace_period` para siempre** | ⚠️ | Job de vencimiento independiente + reconciliación diaria |
| R5 | Proveedor sin recurring nativo → construir el motor de recobro | ⚠️ | Eliminatorio E3; si no, MoR |
| R6 | Estado comercial contaminando `is_operational` | ⚠️ | Invariante **I5** desde el primer día; una vez mezclados no se separan sin migración de datos |
| R7 | Cobro sin comprobante legal válido en SV | ⚠️ | §15.E; **F7 bloqueante** |
| R8 | Sin SSO entre `lucycare.app` y `medicos.lucycare.app` → el médico se re-autentica | ⚠️ | Decisión aparte. **No resolver con tokens ni identificadores en la URL** |
| R9 | **Primera Edge Function del proyecto** — infra nunca ejercitada | ⚠️ | Validar deploy antes del PR funcional de P2 |
| R10 | Deriva de `database.types.ts` (§2.4 T2) | ⚠️ | Regenerar tipos en el mismo PR de la migración |
| R11 | Reutilizar `appointments.stripe_payment_id` / `payment_status` para SaaS | ⚠️ | Prohibido: son pago paciente→médico (§2.4 T1) |
| R12 | Bypass del límite de asientos por RPC directa | ⚠️ | Enforcement server-side ya activo (§9.1) |

---

## 17. Fases — APROBADAS (2026-08-07)

### BILLING-P0 · arquitectura, políticas y proveedor — **sin código**

Cerrar el modelo (este documento) · **llenar la grilla de §15** · validar
fiscalidad/DTE · **elegir proveedor**.
**Salida:** arquitectura + proveedor elegido. Cero migraciones.

**Estado: PAUSADO — arquitectura definida.** Falta lo listado en §19.

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
panel · degradación · LucyAdmin Billing · **recrear el CTA "Planes y
facturación"** (§18).

> **Regla que gobierna las cuatro fases:** el enforcement se activa **solo
> después** de demostrar la confiabilidad medida en P2. Aplicar gates sobre un
> estado no verificado deja afuera a clientes que pagaron.

Cada fase: 1 PR chico, migración `s8_NN` con `check-*.mjs` y `_smoke-*.mjs`,
`vite build` OK, preview validado, y merge solo con OK explícito del owner.
Secretos de la pasarela en ENV/dashboard, **nunca en el repo**.

---

## 18. Antecedente — PR #323 (cerrado sin merge)

El 2026-08-07 se implementó y luego se **cerró sin merge** el PR #323, que
agregaba en el panel del médico el acceso **"Planes y facturación"** hacia
`https://medicos.lucycare.app/medicos/planes`.

**Motivo del cierre: de producto, no técnico.** El destino sigue siendo un flujo
comercial demostrativo y todavía no constituye un portal autoritativo de
suscripción/facturación. Publicar el CTA prometería administración de plan,
tarjeta, pagos y cancelación sin backend que la sostenga.

**El CTA NO está publicado.** Se recrea en **BILLING-P3**, no antes. Su alcance
conocido y validado era:

- `src/pages/panel/PanelLayout.tsx` — enlace en el footer del sidebar y del
  drawer móvil, antes de "Buscar médico", solo para el médico titular
  (`!isAssistant`), `target="_blank"` + `rel="noopener noreferrer"`.
- **URL sin query params**, sin transmitir `doctor_id`, `clinic_id`, `phone`,
  `email`, sesión ni token.
- `src/pages/panel/equipo/EquipoPage.tsx` — retirar la frase "cuando habilitemos
  los planes", que contradice el acceso.

⚠️ **Pendiente vivo:** mientras el CTA no exista, `EquipoPage` sigue diciéndole al
médico que los planes **todavía no están habilitados**. Es hoy el único copy del
producto que menciona "plan". Debe reconciliarse cuando se recree el acceso.

---

## 19. Qué falta para retomar BILLING-P0

- **Investigación verificable de proveedores.**
- **Completar la grilla E1–E7 / O1–O8** (§15).
- **Costos sobre los escenarios 5 / 50 médicos** (D8).
- **Validación fiscal / contable / DTE** (§15.E, F7).
- **Elección de proveedor.**
- **Política legal de retención clínica** (§6.1).

> La investigación técnica/comercial de proveedores podrá hacerse posteriormente.
> **La validación fiscal/legal final requerirá evidencia externa competente.**

---

## 20. Registro de la reconciliación (2026-08-07)

Qué decía este documento en sus versiones anteriores y **por qué se retiró**:

| Contenido retirado | Dónde estaba | Por qué |
|---|---|---|
| **`is_operational` "lo controla la suscripción"**; `active`/gracia → `true`, vencido → `false` | §6, tabla de gating | Contradice el invariante **I5**. El estado comercial es independiente del administrativo (§5.1) |
| La pantalla "Cuenta suspendida" pasa a cubrir también el impago | §6.1 | Con ejes separados son dos estados distinguibles y deben tener copy distinto |
| **El webhook cambia `is_operational` / `booking_enabled`** | §6.2 | El webhook actualiza la suscripción; los entitlements se derivan. **El webhook nunca escribe flags de `doctors`** |
| `subscriptions.clinic_id UNIQUE` como **única** ancla | §8.1 | Falta el titular contractual y el scope separable (§3). Por **H2** el esquema ya admite N médicos por clínica |
| Enum de estados con **`canceled`**, sin `grace_period` ni `suspended` | §5.1 | Reemplazado por los cinco estados de §4.1 y por la cancelación como atributo del período (§4.2) |
| `trialing` como estado modelado | §5.1 | Trial fuera del MVP (§6) |
| Q1–Q11 abiertas (gracia, suspensión, trial, prorrateo, self-service…) | §10 | **Cerradas** por las decisiones de §6 y §6.2 |
| Fases 0–7 con gating en Fase 4 | §11 | Reemplazadas por P0/P1/P2/P3, con enforcement al final (§17) |
| Guardar el **payload íntegro** del webhook | §8.2 | Reemplazado por el conjunto acotado de §8 |
| "Stripe Checkout hosted" como decisión de stack | §13 | La elección de proveedor es parte de BILLING-P0 y **no está tomada** (§15) |

**Lo que se conservó por seguir vigente:** precios aprobados y principio de
precios configurables (§10) · autoservicio del médico (§11) · LucyAdmin Billing
(§12) · separación arquitectónica (§13) · el punto de enganche `team_seat_limit`
(§9.1) · el análisis del problema de operar desde SV y los tres caminos
arquetípicos (§15.0) · la separación **pago ≠ verified ≠ claimed** (§5.1).

---

## 21. Coordinación con otros documentos

- `docs/ANALISIS_AFILIACION_MEDICO.md` / `docs/ANALISIS_RECLAMAR_PERFIL.md` — el
  pago entra **después** del reclamo; `claimed` precede a la suscripción y no
  depende de ella.
- `docs/ANALISIS_ADMINISTRADORES_LUCY.md` — los roles de billing (§13) se alinean
  con su Fase 2 de capacidades granulares.
- `docs/SECURITY_GATE_PILOTO.md` — al implementar, agregar: verificación de firma
  de webhook, idempotencia, secretos en ENV, RLS de las tablas de billing.
- `CLAUDE.md` — guía rápida. Ante contradicción sobre billing, **manda este
  documento**.

**Este documento no contiene** secretos, tokens, `service_role`, claves ni datos
de tarjeta.
