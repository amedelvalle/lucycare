# HANDOFF CANÓNICO — LucyCare · nueva ventana · 2026-09-07

> **Leer PRIMERO.** Reemplaza a
> `docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-08-28_POST_PR353.txt`, que
> pasa a **histórico** junto con todos los anteriores.
>
> ⚠️ **La campaña de captación de médicos NO es el último frente trabajado.**
> Se trabajó antes en esta misma continuidad; **después** se cerraron cuatro
> frentes funcionales de LucyCare. El estado técnico vigente es el de la
> **Parte A**; la campaña está en la **Parte B** y no lo sustituye.

## Cómo leer este documento

Cada afirmación está clasificada. **No mezclar los niveles.**

| Marca | Significado |
|---|---|
| ✅ **VERIFICADO** | Comprobado contra el repositorio, la API de GitHub o producción durante esta ventana |
| 📋 **DECLARADO** | Lo aportó el owner. **No es verificable desde el repositorio.** Se registra como dicho, no como comprobado |
| 🔶 **DECIDIDO, NO IMPLEMENTADO** | Acordado, sin existir todavía |
| ⛔ **NO DISPONIBLE** | Falta y hay que capturarlo |

---

# PARTE A · Estado canónico del proyecto

Todo lo de esta parte es ✅ **VERIFICADO**.

## A.1 · Estado del repositorio

| | |
|---|---|
| **HEAD** | `4094dc3372ddcc7c683ecfafc33568bbd7cbc755` |
| **HEAD funcional** | **`e8e8c03d588b85cca32c81013befa312d14bef07`** |
| `main == origin/main` | sí |
| Working tree | limpio |
| PRs funcionales abiertos | **0** |
| PRs abiertos durante el cierre | **#364**, docs-only, pendiente de merge |
| Migraciones | **107** · última `s7_86_admin_doctor_export_onboarding.sql` |
| Último deployment | `6311556516` · ref `4094dc3` · 2026-09-07T15:17Z |

⚠️ **`e8e8c03` es el HEAD FUNCIONAL; `4094dc3` es el tip del repositorio.** Entre
ambos solo hay commits documentales — verificado: **0 archivos** cambiados en
`src/`, `migrations/`, `scripts/` o `supabase/`. Para el tip vigente:
`git rev-parse HEAD`.

⚠️ Queda **una rama remota huérfana**, `claude/s7_49-rej` (`72e3d99`), muy
anterior a esta ventana. No se tocó. No mergearla: su contenido ya está en `main`
por squash.

## A.2 · Lo que se hizo en esta ventana

Baseline de partida: `55af306` (#353). Diez commits, **cuatro frentes**.

| PR | Frente | Tipo | Migración |
|---|---|---|---|
| #354 | handoff post-#353 | docs | — |
| **#355** | `MOBILE-BOOT-RECOVERY-P0` | frontend | — |
| #356 | cierre | docs | — |
| **#357** | `DOCTOR-WELCOME-EMAIL-P0` | full-stack | `s7_83`, `s7_84` |
| #358 | cierre | docs | — |
| **#359** | `DOCTOR-ONBOARDING-READINESS-P0` | full-stack | `s7_85` |
| **#360** | hotfix P0 del binding | frontend | — |
| **#361** | UI + copy + CSV | full-stack | `s7_86` |
| #362 | cierre | docs | — |
| #363 | `ONBOARDING-FOLLOWUP-P1` ON HOLD | docs | — |

**Todos MERGED. Ninguno pendiente.**

### #355 · `MOBILE-BOOT-RECOVERY-P0` — CLOSED

En Android/Chrome, al restaurar una pestaña, la app podía quedarse
**indefinidamente en el splash** si el módulo de entrada no ejecutaba: no hay
`onerror` en la etiqueta, ni `window.onerror`, ni **un solo ErrorBoundary en el
repositorio**.

Watchdog **pre-React** en `index.html`, script clásico inline (el único código
que corre aunque el bundle no llegue). A los 12 s, o ante un error de carga de
`SCRIPT`, hace **como máximo UN reload por navegación** (marca en
`sessionStorage`) y si no basta muestra **«Reintentar»**. Sin `sessionStorage`
disponible **no recarga nunca**: bucles imposibles por construcción.

**Frontend-only, un solo archivo.** QA real Android/Chrome PASS.

⚠️ **Lección de QA:** una sonda que bloquea un recurso **debe servirlo
`no-store`**. La primera versión servía los assets `immutable`, el navegador usó
su caché, el bloqueo nunca se ejerció y dio un **FALSO PASS**.

### #357 · `DOCTOR-WELCOME-EMAIL-P0` — CLOSED

Botón **«Enviar correo de bienvenida»** en `/admin/afiliaciones`.
`s7_83` (**104**) y `s7_84` (**105**) APPLIED / VERIFIED / **NO REAPLICAR**.
Edge Function `send-doctor-welcome-email` **ACTIVE v1**. **Sin secreto nuevo.**

⚠️ **Publicar NO envía nada.** El disparo es una acción explícita del owner: sin
trigger, outbox, `pg_net`, cron ni Vault. Fue decisión del owner **por encima**
del diseño automático que se propuso primero.

**Destinatario: `doctor_affiliation_requests.email`**, nunca `profiles.email`.
Autorización en tres capas: `verify_jwt` + JWT del admin + gate `is_admin()`
(`P0160`). **Sin `service_role`.** Los seis gates viven en el `WHERE` de **un
solo `UPDATE` condicional**: eso cierra el doble envío por bloqueo de fila.
`Idempotency-Key` = id de la solicitud; ventana de 23 h.

⚠️ **El tratamiento NUNCA se infiere.** `profiles.full_name` es mixto en
producción: anteponer «Dr. » habría producido «Dr. Dra. Pamela Bolaños».

**E2E real PASS**, cleanup con 0 residuales funcionales.

### #359 · #360 · #361 · `DOCTOR-ONBOARDING-READINESS-P0` — CLOSED

**Referencia completa: `docs/ANALISIS_ONBOARDING_READINESS.md`.**

LucyAdmin muestra en qué punto va cada médico. **Todo derivado: cero columnas de
estado.** `s7_85` (**106**) y `s7_86` (**107**) APPLIED / VERIFIED.

**Cuatro ejes que NO se mezclan:** onboarding · `booking_ready` ·
`is_operational` (manual) · `is_published`. **8 etapas por precedencia.**
`booking_ready` = **cinco** condiciones, consumidas **fail closed**.

**Copy del eje operativo:** `Operativo` / **`No habilitado`** / **`No
operativo`**. ⚠️ **`Suspendido` y `Reactivar` quedaron RETIRADOS y no se
reintroducen:** la columna no guarda historia y `audit_log` no es legible desde
LucyAdmin, así que una activación previa **no es demostrable**.

**CSV de médicos: 17 → 20 columnas.** `s7_86` las añade con
`LEFT JOIN LATERAL _doctor_onboarding(d.id)` — **una evaluación por médico**.
Medido en producción: 117 médicos, `loops=117`, **60,357 ms** contra 191,198 ms
del control de tres llamadas (**3,17×**).

### ⚠️ #360 — la regresión P0, y su lección vinculante

`s7_85` dejó **la reserva en línea caída en TODOS los perfiles públicos**.
`fetchDoctorBookingReady` extraía `supabase.rpc` a una variable y lo llamaba
suelto: **es un método**, desligado `this` queda `undefined` y lanza
`Cannot read properties of undefined (reading 'rest')` **antes de emitir la
petición**. Corrección: `supabase.rpc.bind(supabase)`.

> **REGLA VIGENTE: nunca desligar un método del cliente Supabase.** Si hay que
> tipar la llamada, ligarlo con `.bind(supabase)`.

⚠️ **Y la lección de método:** se reportó validada la ruta «uuid inválido →
`22P02` → throw». Se observó *un* throw y se lo atribuyó a la RPC; era el
`TypeError`. **Si el control también "pasa", el defecto está en la sonda.**
Cobertura ahora en `scripts/check-directory-booking-ready.mjs`.

> ⚠️ **`npx tsc --noEmit` NO ES UNA VALIDACIÓN VÁLIDA en este repositorio.** El
> `tsconfig.json` es *solution-style* con `"files": []`: comprueba **cero
> archivos** y siempre sale 0. **El typecheck real es `tsc -b`.**

## A.3 · QA ejecutada en producción

| Verificación | Resultado |
|---|---|
| Harold → etapa / reservabilidad | `Pendiente de reclamar` · sin CTA público |
| Camilo → etapa / reservabilidad | `Completo` · `Listo para reservas`, CTA restaurado |
| CSV real desde LucyAdmin | **117 médicos · 20 columnas** |
| Peticiones del export | **una sola** |
| Degradación del módulo | ninguna |

## A.4 · Pendientes vivos — NINGUNO ABIERTO

- **`ONBOARDING-FOLLOWUP-P1` = ON HOLD** — diseñado y medido. Cohorte:
  **44 `pending_claim` → 1 afiliación → 1 correo autoritativo → 0 bienvenidas
  enviadas → 0 elegibles.** Reapertura: cohorte suficiente **o** decisión sobre
  contactabilidad del padrón importado.
- **`ADMIN-DOCTOR-DETAIL-TABS-P1`** — tabs en la ficha, solo si crece la
  densidad.
- **Redundancia en `_doctor_onboarding`** — `doctor_booking_ready` relee 3 de ~9
  lecturas. Optimizar solo si una medición lo justifica.
- **Historial insuficiente del eje operativo** — sostiene el copy neutral.
- **`WELCOME-EMAIL-SIN-CORREO-P1`** — lead sin correo aprobado sin override
  queda sin vía de corrección en LucyAdmin.
- **`BOOT-GETUSER-GATE-P1`** · **`TYPES-RECONCILIATION-P0`** ·
  **`F1-c2` (DROP físico)** — anteriores a esta ventana.

**Limitación de evidencia del cierre, no pendiente:** `not_published`,
`services_missing`, `availability_missing` y `booking_disabled` **no se
ejercitaron con datos reales**.

## A.5 · Configuración — sin cambios en esta ventana

**No se tocó:** Turnstile · Twilio · Supabase Auth · secrets · Vercel ·
Cloudflare · DNS · `vercel.json` · `.env`. **Ninguna Edge Function nueva** salvo
`send-doctor-welcome-email` (#357). **Sin secretos nuevos** — se reutilizó la
`RESEND_API_KEY` transaccional.

---

# PARTE B · Campaña de captación y onboarding de médicos — estado operativo y continuidad

> ⚠️ **TODA esta parte es 📋 DECLARADO por el owner.**
> **Cero artefactos de campaña existen en el repositorio** — verificado: no hay
> Apps Script, ni `PlantillaEmail.html`, ni definición de la hoja. Viven en
> Google Workspace / Google Sheets, fuera de control de versiones.

## B.1 · Objetivo comercial

Captar médicos para probar LucyCare y **convertir interés en uso real**.

**Embudo:** contacto → correo → visita su perfil → reclama perfil → entra a
LucyCare → completa información → configura servicios → configura agenda →
recibe reservas → usa LucyCare → **feedback**.

**Oferta vigente: 1 mes sin costo.** ⚠️ **No 3 meses.** El objetivo del piloto
es **uso real y comentarios**, no volumen.

**Distinciones que deben quedar claras en todo el material:**

- perfil público **≠** suscripción — el perfil público es **gratuito**
- reclamar perfil **≠** verificación
- reclamar perfil **≠** agenda activa
- pagar **≠** verificación automática

## B.2 · Infraestructura de correo

**Remitente operativo:** `LucyCare para Médicos <medicos@lucycare.app>`
Google Workspace configurado para `lucycare.app`.

Configurados y validados: **MX de Google · SPF · DKIM · DMARC**.
Resultados de autenticación: **SPF PASS · DKIM PASS · DMARC PASS**.

**Entregabilidad observada:**

- **Gmail:** bandeja de entrada.
- **Outlook / Hotmail:** en algunas pruebas clasificó como **Spam/Junk aun con
  autenticación correcta**.
- Decisión: **volúmenes pequeños y calentamiento progresivo**.
- ⚠️ **No asumir garantía de inbox.**

⚠️ **Convive con otro emisor sobre la misma dirección.** El correo de
bienvenida de #357 sale por **Resend** desde el mismo `medicos@lucycare.app`.
Cumplen **propósitos distintos** —transaccional/operativo el de #357,
campaña/outreach este—, pero **ambos consumen la reputación del dominio** y
pueden coincidir en un mismo destinatario. La **segmentación queda pendiente**
de definir antes de aumentar volumen.

## B.3 · Google Sheets de campaña

**Pestaña: `Campaña`.** El nombre del archivo puede cambiar; ⚠️ **el de la
pestaña NO**, mientras el código use `SHEET_NAME: 'Campaña'`.

**Columnas:** `Enviar` · `Nombre` · `Especialidad` · `Correo` · `Teléfono` ·
`URL_Perfil` · `Asunto` · `Estado_Email` · `Fecha_Envio` · `Respuesta` ·
`Interesado_Piloto` · `Perfil_Reclamado` · `Fecha_Seguimiento` ·
`Estado_Contacto` · `Observaciones` · `Motivo_No_Enviar`

**Dropdowns:**

| Columna | Valores |
|---|---|
| `Enviar` | Sí · No · Revisar |
| `Estado_Email` | Pendiente · Enviado · Error |
| `Respuesta` | Pendiente · Sí · No |
| `Interesado_Piloto` | Pendiente · Sí · No |
| `Estado_Contacto` | Nuevo · Contactado · Respondió · Interesado · No interesado · Perfil reclamado · En piloto |

La hoja funciona hoy como **CRM básico de campaña**.

## B.4 · Apps Script

⛔ **EL CÓDIGO NO ESTÁ EN ESTE HANDOFF.** No está en el repositorio y no estaba
disponible en esta ventana. **Capturarlo es lo primero de la próxima ventana**
(ver B.9).

**Configuración declarada:**

| Constante | Valor |
|---|---|
| `SHEET_NAME` | `Campaña` |
| `TEMPLATE_FILE` | `PlantillaEmail` |
| `MAX_PER_RUN` | **3** |
| sender | `LucyCare para Médicos` |
| reply-to | `medicos@lucycare.app` |
| URL de perfil válida | `https://lucycare.app/doctor/` |

**Menú «LucyCare Email»:** *Enviar prueba* · *Enviar pendientes*.

**Elegibilidad — las cinco condiciones, todas obligatorias:**

```
Enviar = Sí
Estado_Email = Pendiente
Perfil_Reclamado != Sí
Correo no vacío
URL_Perfil no vacía
```

⚠️ **Un perfil con `Perfil_Reclamado = Sí` NUNCA debe recibir el correo de
reclamo.**

**Tras envío:** `Estado_Email = Enviado`, `Fecha_Envio` = fecha/hora.
**En error:** `Estado_Email = Error`, detalle en `Observaciones`.

**Confirmación:** *Enviar pendientes* muestra un diálogo. **Solo un Sí explícito
continúa**; cerrar, hacer clic fuera o responder No **no envía nada**. Máximo
**3 correos por ejecución**.

## B.5 · Plantilla y texto plano

**`PlantillaEmail.html`** — ⛔ **el contenido no está en este handoff**, por el
mismo motivo que el Apps Script.

Características declaradas: responsive · móvil · modo claro · **modo oscuro** ·
soporte específico **Outlook dark mode** · branding **morado + menta** · sin
emojis problemáticos.

**CTA principal:** *Ver y reclamar mi perfil*
**Variables:** `{{NOMBRE}}` · `{{URL_PERFIL}}`
**Footer:** LucyCare para Médicos · `https://medicos.lucycare.app/medicos` ·
opción de responder «No recibir».

La versión dark-mode **fue probada en móvil y aceptada visualmente**.

⚠️ **Oferta: «1 mes sin costo» en HTML y en texto plano.** **No conservar
ningún texto que diga 3 meses.** Ambas versiones deben decir lo mismo.

> ✅ **Verificado en el repositorio:** el correo de bienvenida de #357
> (`send-doctor-welcome-email/render.ts`) **no menciona ninguna duración de
> piloto**, así que **no hay inconsistencia 1-vs-3 meses en el código**. La
> duración vive solo en el material de campaña, fuera del repositorio, y ahí
> **no pude verificarla**.

## B.6 · Estrategia de envíos

- Lotes pequeños, **normalmente 2–3 médicos**.
- **Evitar envíos masivos.**
- Observar respuestas y entregabilidad.
- **Máximo un seguimiento razonable** a quien no responda.
- **Priorizar interacción real sobre volumen.**

⚠️ **No existe automatización de follow-up por fecha.** La hoja tiene
`Fecha_Seguimiento`, `Respuesta` y `Estado_Contacto`, pero el seguimiento es
**operativo y manual**.

## B.7 · Onboarding del médico

**Sitio comercial:** `https://medicos.lucycare.app/medicos`
**Ruta central:** `https://medicos.lucycare.app/medicos/empezar`

> **`https://medicos.lucycare.app/medicos/empezar` SÍ EXISTE.** Es la ruta
> central de onboarding del médico y está operativa.
>
> ⚠️ ✅ **Verificado: pertenece al sitio independiente `medicos.lucycare.app`,
> NO a este repositorio.** En `src/router/config.tsx` no hay rutas `/medicos`
> ni `/medicos/empezar` — solo `/admin/medicos` y `/admin/medicos/:id`. El
> rediseño de esa página como centro de onboarding completo está **decidido**,
> pero **corresponde ejecutarlo en esa otra propiedad**, no aquí.
>
> ⚠️ **Este repo mantiene una DEPENDENCIA DURA de la URL actual**, en dos
> sitios: `send-doctor-welcome-email/render.ts` la emite como `GUIDE_URL`, y
> **`scripts/check-s7_83.mjs` la ASERTA** («guía para empezar»).
>
> Consecuencia práctica, en los dos sentidos:
>
> - **Mientras se conserve la ruta, el contenido de la página puede cambiar
>   libremente sin tocar este repositorio.** El rediseño de onboarding no
>   requiere ningún cambio aquí.
> - **Si en el futuro cambia la URL**, el correo de bienvenida apuntaría a un
>   enlace muerto y el check fallaría: **ambos proyectos deben actualizarse de
>   forma coordinada.**

**Decisión de producto:** **no** crear una segunda ruta de «primeros pasos».
`/medicos/empezar` evoluciona como **centro de onboarding**.

**Flujo correcto:**

1. médico solicita afiliación
2. LucyAdmin revisa
3. se prepara/publica el perfil inicial
4. el médico recibe su URL
5. abre el perfil
6. selecciona «¿Eres este profesional?»
7. **reclama el perfil**
8. entra a su panel
9. completa información profesional
10. configura servicios
11. configura agenda/disponibilidad
12. revisa cómo lo verá el paciente
13. recibe y gestiona reservas

⚠️ **«Completa tu información profesional» va DESPUÉS de reclamar**, porque
antes el médico no tiene administración del perfil.

### 🔶 Estructura acordada de `/medicos/empezar` — DECIDIDA, NO IMPLEMENTADA

1. Encuentra tu perfil
2. Reclama tu perfil
3. Completa tu información profesional
4. Configura tus servicios
5. Configura tu agenda
6. Revisa cómo reservará un paciente
7. Comienza a usar LucyCare durante tu mes piloto

Después: administrar citas · compartir perfil · recibir reservas · **dar
feedback**.

⚠️ **No se implementó en esta ventana**, y no podría haberse implementado desde
este repositorio: el sitio es otra propiedad. **Decidido ≠ implementado.**

## B.8 · Caso real: Dr. Harold Trillos

Primer caso operativo de afiliación trabajado en esta continuidad.
Perfil: `https://lucycare.app/doctor/dr-harold-trillos`

Correo de bienvenida preparado indicando: que su perfil ya está disponible ·
abrir el perfil · buscar «¿Eres este profesional?» · reclamarlo · entrar a
LucyCare · completar perfil · configurar servicios · configurar agenda · usar
`/medicos/empezar` como guía · responder al correo si necesita ayuda.

> ✅ **Estado verificado en producción (2026-09-07):** Harold sigue en
> **`Pendiente de reclamar`**, **no reservable**, y su perfil público **no ofrece
> reserva**. En la medición de cohorte quedó entre los **43 sin afiliación
> vinculada**, de modo que **no es elegible** para el correo de bienvenida
> automatizado de #357.
>
> ℹ️ **Por qué vía le llegó:** el correo que recibió salió por la **campaña**
> (Gmail/Apps Script), **no** por el flujo transaccional de #357 — para el que,
> además, no es elegible. Son **propósitos distintos**, no dos versiones de lo
> mismo. ⚠️ Antes de subir volumen hay que **definir la segmentación** para que
> un mismo médico no reciba comunicaciones duplicadas o demasiado próximas.

## B.9 · ⛔ Lo que falta capturar — primera tarea de la próxima ventana

| Artefacto | Dónde vive | Cómo capturarlo |
|---|---|---|
| **Código del Apps Script** | Editor de Apps Script del Sheet | Copiar el `.gs` completo y guardarlo en `docs/campana/` |
| **`PlantillaEmail.html`** | Google Drive, junto al Sheet | Ídem |
| Texto plano del correo | Dentro del Apps Script | Sale con el `.gs` |
| Id del Sheet / nombre del archivo | Google Drive | Anotar la URL |

⚠️ **El Google Sheet, el Apps Script y `PlantillaEmail.html` son hoy artefactos
operativos EXTERNOS y NO versionados en este repositorio.** Viven en Google
Workspace / Drive. Es la razón por la que este handoff los marca ⛔ en vez de
describirlos de memoria.

**Antes de implementar la importación incremental (B.10) deberán capturarse
desde su fuente real**, para trabajar sobre la versión vigente y no sobre una
reconstrucción. **No bloquea este cierre documental.**

## B.10 · SIGUIENTE FRENTE — Importación incremental desde LucyAdmin

> 🔶 **NO INICIADO.** No abrir sin instrucción del owner.

**Problema.** El owner descarga médicos desde LucyAdmin y quiere incorporarlos
periódicamente a la campaña. Añadir filas a mano es difícil porque hay columnas
derivadas/operativas: `Asunto`, `Estado_Email`, `Respuesta`, `Perfil_Reclamado`,
`Estado_Contacto`, fechas y observaciones. Además **`Asunto` quedó dependiente
de la estructura/fórmula existente**.

**Objetivo.** Que el owner: descargue de LucyAdmin → pegue/importe → ejecute una
acción → el sistema **integre solo los nuevos**, genere los campos de campaña,
**evite duplicados** y **nunca envíe automáticamente**.

**Propuesta discutida, no implementada:** pestaña **`Importar médicos`** +
acción de menú **`Integrar nuevos médicos`**.

**Identidad y reconciliación:** ⚠️ **no deduplicar únicamente por nombre.** Ver
el recuadro de abajo: hoy la mejor llave estable disponible en el export es el
**`Slug`**, con la **`URL pública`** y el **`Correo`** como defensas adicionales.

> ⚠️ **REGLA CRÍTICA: importar NUNCA debe significar enviar.** Los médicos
> nuevos entran con **`Enviar = No`** hasta selección explícita del owner.

**Primer paso del frente:** analizar el **formato exacto de exportación de
LucyAdmin**.

> ✅ **Dato verificado que el frente necesitará.** El CSV de LucyAdmin tiene hoy
> **20 columnas**, en este orden: Nombre · Especialidad · Teléfono · Correo ·
> Clínica · Dirección de clínica · Departamento de clínica · Municipio de
> clínica · Estado LucyCare · Perfil reclamado · Verificado en LucyCare ·
> Publicado · Agenda habilitada · Operativo · Fecha de alta en LucyCare · Slug ·
> URL pública · **Onboarding** · **Próxima acción** · **Listo para reservas**.
>
> ⚠️ **El export NO incluye `doctor_id`.** Es una decisión explícita de la
> allowlist de `s7_78` («sin UUID internos»). Exponerlo exigiría modificar
> `admin_export_doctors` — decisión del owner, no del frente.
>
> **`Slug` es la mejor llave estable DISPONIBLE hoy** para reconciliar desde
> este export, y el importador deberá usarla como llave principal, con la
> **`URL pública`** (que lo contiene) y el **`Correo`** como defensas
> adicionales cuando corresponda.
>
> ⚠️ **No afirmar que el slug es un identificador canónico inmutable.** Lo que
> consta es que `trg_set_doctor_slug` lo asigna al publicar y no lo reescribe,
> y que un médico despublicado conserva el suyo. Eso lo hace **estable en la
> práctica observada**, no inmutable por contrato. Cualquier diseño que dependa
> de su inmutabilidad necesita **evidencia técnica específica** primero.
>
> Columnas directamente aprovechables: **`Perfil reclamado`** → `Perfil_Reclamado`
> · **`URL pública`** → `URL_Perfil` · **`Onboarding`** → estado de campaña.

---

# PARTE C · Clasificación y discrepancias

## C.1 · Qué está en cada nivel

| Nivel | Qué |
|---|---|
| ✅ **Implementado y probado** | #355, #357, #359, #360, #361 · `s7_83`–`s7_86` · CSV de 20 columnas · correo de bienvenida con E2E real · QA de producción |
| 📋 **Declarado, no verificable aquí** | Todo el B: Workspace, DNS, SPF/DKIM/DMARC, Sheets, Apps Script, plantilla, entregabilidad, oferta de 1 mes |
| 🔶 **Decidido, no implementado** | Estructura de `/medicos/empezar` · pestaña `Importar médicos` · `ONBOARDING-FOLLOWUP-P1` |
| ⛔ **No disponible** | Código del Apps Script · `PlantillaEmail.html` |

## C.2 · Discrepancias detectadas — reportadas, NO corregidas

1. **`medicos.lucycare.app` no es este repositorio.** No hay rutas `/medicos`
   ni `/medicos/empezar` en el router. El rediseño de `/medicos/empezar` **no
   puede ejecutarse desde este repo**.
2. **Se pidió incluir el Apps Script y la plantilla; no existen aquí ni estaban
   disponibles.** No se reconstruyeron de memoria: se marcaron ⛔ con
   instrucciones de captura.
3. **Dos comunicaciones con PROPÓSITOS DISTINTOS sobre el mismo remitente.**
   **#357** es comunicación **transaccional/operativa**: la bienvenida que sigue
   al flujo de afiliación, disparada por el owner desde LucyAdmin, con
   idempotencia y trazabilidad. **Google Sheets + Apps Script** es
   **campaña/outreach de captación**. No compiten: hacen cosas diferentes.
   Pero **pueden coincidir en un mismo destinatario**, y ninguno de los dos
   sabe del otro. ⚠️ **Antes de aumentar volumen debe definirse la segmentación**
   para evitar comunicaciones duplicadas o demasiado próximas en el tiempo.
   **No se resuelve en este cierre.**
4. **La cohorte del correo automatizado es prácticamente vacía.** 44
   `pending_claim`, **1** con afiliación vinculada, **0** con bienvenida
   enviada. El flujo de #357 solo alcanza a quienes entren por afiliación; los
   **43 importados** no son elegibles bajo la regla vigente.

## C.3 · Reglas vinculantes de esta ventana

1. **Nunca desligar un método del cliente Supabase.** `.bind(supabase)`.
2. **`npx tsc --noEmit` no es una validación válida.** Usar `tsc -b`.
3. **Si el control también "pasa", el defecto está en la sonda.**
4. **Una sonda que bloquea un recurso debe servirlo `no-store`.**
5. **`Suspendido` y `Reactivar` no se reintroducen** en el eje operativo.
6. **`profiles.email` importado no es correo autoritativo.**
7. **Importar nunca debe significar enviar.**

## C.4 · Prohibiciones vigentes

No desactivar ni reconfigurar Turnstile · no revertir Twilio Verify · no tocar
claves en Vercel/Supabase/Cloudflare · no ejecutar SQL ni usar `service_role`
sin autorización puntual · **no tocar `auth.users` por SQL** · **jamás Katherine
(`50372608827`)** · no modificar la identidad de Camilo (`50378056365`) ni de
LucyAdmin (`50378627694`) · **el owner aplica el SQL, el dev corre los checks** ·
no iniciar ningún pendiente del backlog sin instrucción.

## C.5 · Arranque de la próxima ventana

```
git fetch origin && git checkout main && git pull --ff-only origin main
git log --oneline -10
```

Leer: **este handoff** → `CLAUDE.md` → `docs/ANALISIS_ONBOARDING_READINESS.md`
si se toca onboarding.

**Estado:** HEAD `4094dc3` · funcional `e8e8c03` · 107 migraciones · 0 PRs
abiertos · árbol limpio · **ningún frente funcional abierto**.

**Primera tarea si se retoma la campaña:** capturar el Apps Script y la
plantilla (B.9). **Sin eso, el frente de importación no se puede diseñar con
precisión.**
