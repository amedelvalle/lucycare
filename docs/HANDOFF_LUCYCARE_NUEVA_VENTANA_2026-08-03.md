# HANDOFF LucyCare — nueva ventana (2026-08-03, post PR #311)

> **PUNTO DE ENTRADA VIGENTE.** Este documento es autocontenido y reemplaza a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-30.md` como referencia principal de
> continuidad. Los handoffs anteriores NO se borran: siguen siendo útiles para el
> detalle de ejes ya cerrados (Auth, clínico F1–F7, SEO/Perf, credenciales,
> paciente global).
>
> **Sin frente funcional abierto.** El siguiente en la fila es **AUDIT-SEC-P0**,
> todavía **NO iniciado** (ver §G).
>
> ⚠️ Donde un handoff histórico diga *"CAPTCHA desactivado"*, está **obsoleto**.
> **Turnstile está ACTIVO en producción** desde 2026-07-31 (ver §F).

---

## A. Estado técnico actual

| Ítem | Valor |
|---|---|
| Repo | `C:\Users\admic\lucycare` |
| Remoto | `github.com/amedelvalle/lucycare` |
| Dominio productivo | `https://lucycare.app` |
| HEAD documental previo a este PR | `cd965ea031dcefe0b7a0e114e7ce06ade0a64c04` |
| Merge commit de PR #311 | `df0d3b50e11fd9c2a1d0e84c2e4f4a7e858fc8b3` |
| PRs mergeados | hasta **#311** |
| Migraciones aplicadas | hasta **`s7_70`** |
| `main == origin/main` | sí |
| Árbol | limpio |
| PRs abiertos al inicio de esta ventana | **0** |
| Producción | desplegada y verde |

> **Nota sobre `cd965ea`:** es un commit **directo a `main`, sin PR** (recorte de
> `CLAUDE.md` 212k→41.6k + creación de `docs/HISTORIAL_FRENTES.md`). Quedó con el
> autor malformado por un `~/.gitconfig` con `user.email` inválido. **No se
> reescribió** — el historial se deja como está. La identidad de git ya se corrigió
> para commits futuros (ver §J).

> Nota operativa heredada: existen ~26 ramas locales `claude/*` **antiguas** (frentes
> ya squash-mergeados). Su limpieza requiere **autorización expresa del owner**.
> Tampoco se toca el stash viejo `stash@{0}: WIP on claude/admin-fase-a`.

---

## B. PR #310 / `s7_70` — cancelación por el paciente, backend (LIVE)

Migración `migrations/s7_70_patient_cancel_appointment.sql`, **aplicada en producción**.
La migración del repo es **byte-idéntica** a la ejecutada por el owner.

**Alcance:**

- **Hardening de `UPDATE` sobre `appointments`** — restricciones de columnas
  diferenciadas por rol (paciente, médico, asistente): cada rol solo puede tocar
  el subconjunto que le corresponde.
- **`cancel_my_appointment`** — RPC que permite al paciente cancelar su propia
  cita, con validación de propiedad y de estado.
- **`appointment_patient_cancellations`** — tabla **append-only** con la evidencia
  de cada cancelación hecha por el paciente (incluye el motivo).
- **`list_recent_patient_cancellations`** — RPC de lectura para el panel del médico.
- **Liberación del horario** tras la cancelación: el slot vuelve a quedar disponible.
- **El historial conserva la cita** — no se borra; queda como *Cancelada*.
- **Aislamiento entre clínicas** verificado.

**Validación:** smoke E2E de backend **65/65, exit 0**. Cleanup con **cero residuos**.
Turnstile permaneció activo durante todo el frente. `service_role` dejó de usarse al
terminar.

---

## C. PR #311 — cancelación por el paciente, frontend (LIVE)

Merge commit `df0d3b50e11fd9c2a1d0e84c2e4f4a7e858fc8b3`, squash desde
`claude/s7-70-frontend` (`b6834ab5dd39fa6a1052ae75ae1793ff95d38973`).
**Frontend puro: 11 archivos, todos bajo `src/`. Sin migración, sin SQL, sin DB.**

**Alcance funcional:**

- Modal de cancelación desde **"Mis atenciones"** del paciente
  (`CancelAppointmentPatientModal.tsx`), con selección de motivo.
- El **historial conserva la cita cancelada**, visible con estado *Cancelada*.
- El botón **"Cancelar cita" desaparece** una vez cancelada.
- **Tarjeta "Cancelaciones recientes"** en el home del panel médico
  (`RecentCancellationsCard.tsx`), alimentada por `list_recent_patient_cancellations`.
- **Navegación "Ver cita"** desde la tarjeta hacia la agenda, posicionada en la
  **fecha correcta** de la cita.
- Conteos del panel médico actualizados.

**Ajustes de densidad móvil (P1/P2), sobre `RecentCancellationsCard.tsx`:**

- **P1 — scroll interno en móvil.** La lista interna usa
  `max-h-[320px] overflow-y-auto`, y desde `sm:` se libera con
  `sm:max-h-none sm:overflow-visible`. El límite afecta **solo a la lista**:
  encabezado y descripción permanecen siempre visibles. En escritorio no hay
  límite. **Sin scroll horizontal** en ningún breakpoint.
- **P2 — objetivo táctil mínimo.** El enlace "Ver cita" usa
  `inline-flex min-h-[44px] items-center px-2 -mx-2`, alcanzando el mínimo de
  **44 px**. Sin cambios de copy, navegación ni lógica.

**P3 quedó FUERA por decisión del owner:** **`NotificationBell` NO fue modificado.**
Su cierre con Escape y la devolución de foco viven en el backlog (§H).

**Validación técnica reportada en la rama:** `check-s7_70` **219/219** ·
`npx tsc --noEmit` limpio · `npm run build` verde · `git diff --check` limpio ·
Vercel Deployment **pass** · árbol limpio · harness eliminado.

> **Sobre las mediciones de densidad:** se hicieron con un **harness local con
> mocks** (cinco cancelaciones simuladas) que **fue eliminado y nunca se commiteó**.
> En los datos reales existe **una sola cancelación**, la que probó el owner.
> **No se deben crear cancelaciones adicionales** para reproducir esa medición.

---

## D. QA manual realmente ejecutada (por el owner, en Preview)

Recorrido real completado sobre Preview con un **paciente sintético** y el médico
demo **Dr. Camilo Carrillo**. Se comprobó:

- reserva de la cita;
- cancelación desde "Mis atenciones";
- la cita se conserva en el historial;
- estado *Cancelada* correcto;
- desaparición del botón "Cancelar cita";
- notificación de reserva;
- notificación de cancelación;
- tarjeta "Cancelaciones recientes" en el panel médico;
- motivo de la cancelación visible;
- enlace "Ver cita";
- navegación a la fecha correcta;
- conteos correctos en el panel médico.

**Límite explícito de esta evidencia:** la **matriz manual completa NO se ejecutó en
todos los escenarios**. Lo que cubre el resto son los controles de seguridad,
estados, aislamiento entre clínicas y errores validados por el **smoke backend
65/65** de §B. No se afirma nada más allá de esto.

**Validación autenticada post-merge:** no ejecutada desde el entorno del dev; la QA
funcional la realizó el owner en Preview según lo anterior. **No repetir esta QA
creando más datos sin instrucción explícita.**

---

## E. Verificación post-merge de #311

Ejecutada read-only, sin crear datos:

- `main == origin/main` en `cd965ea`;
- rama `claude/s7-70-frontend` **eliminada** en local y remoto;
- **0 PRs abiertos**;
- migraciones **sin cambios**, siguen hasta `s7_70`
  (`s7_70_patient_cancel_appointment.sql` último tocado por #310);
- `#311` **no tocó `migrations/`**;
- sin harness, sin fixtures ni scripts temporales, sin servidores locales activos;
- `scripts/check-s7_70.mjs` y `scripts/_smoke-s7_70.mjs` están **versionados** (vienen
  de #310, por la convención de PR con DB) — no son residuos;
- checks del PR: Vercel **pass**; combined status del merge commit **success**;
- deployment de producción **success**;
- `https://lucycare.app/` → **200**;
- perfil público de Camilo → **200**.

---

## F. Turnstile — estado vigente

**Turnstile está ACTIVO en producción** y **también configurado para Preview**.

- `VITE_CAPTCHA_ENABLED` configurada para **Production + Preview** en Vercel.
- `VITE_TURNSTILE_SITE_KEY` configurada para **Production + Preview**.
- **Hostname del Preview autorizado en Cloudflare.**
- Widget **validado en Preview**.
- Modo **Managed**. Secret Key configurada en Supabase.

> **Ningún handoff debe volver a decir que el CAPTCHA está desactivado.** Esa
> afirmación quedó obsoleta el 2026-07-31 (PR #308).

**Manejo de claves — vinculante:**

- La **Site Key es pública** (viaja en el bundle) y la **Secret Key es SENSIBLE**.
- **Ninguna de las dos se documenta, se imprime, se registra ni se guarda en el repo.**
- No se comparten tokens, contraseñas, OTP, captcha tokens ni enlaces de
  autenticación.

**⚠️ Orden VINCULANTE al tocar el CAPTCHA:** el frontend debe estar enviando tokens
**antes** de que Supabase los exija. Frontend ON + Supabase OFF = inofensivo (GoTrue
ignora el token). **Supabase ON + frontend OFF = caída total de Auth.** Para
desactivar, el orden es el inverso: **apagar el enforcement en Supabase primero**, y
recién después quitar `VITE_CAPTCHA_ENABLED` y redeployar.

**Consecuencia vigente:** el **cambio de teléfono sigue SUSPENDIDO** mientras el flag
esté activo (`PHONE_CHANGE_SUSPENDED = CAPTCHA_ENABLED`, porque `updateUser({phone})`
no admite `captchaToken`). No hay camino self-service de cambio de teléfono durante
el piloto.

---

## G. Siguiente frente — AUDIT-SEC-P0 (NO iniciado)

**Estado: NO abierto.** No tocar código hasta que el owner lo autorice.

**Riesgo conocido:**

- `audit_log` permite **INSERT arbitrario** por `public` / `anon` / `authenticated`;
- existe una policy con **`WITH CHECK true`**;
- existen **grants amplios**;
- en consecuencia, **`audit_log` no puede considerarse evidencia autoritativa**
  hasta corregirse;
- varias funciones legacy de auditoría tienen problemas relacionados con
  `auth.uid()`, `user_id NOT NULL` y `search_path` (triggers `audit_patients`
  de `s4_02` y `audit_profiles_identity` de `s7_32`, que chocan con
  `service_role` / `search_path` vacío en tablas auditadas).

**Objetivo:** corregir el riesgo de INSERT arbitrario en `audit_log`.

**Cómo debe iniciar:** primero un **análisis read-only**, con **alcance aprobado por
el owner** antes de escribir nada.

### Después de AUDIT-SEC-P0 — TWILIO-P0 (PAUSADO)

**No configurar Twilio todavía.** Permanece pausado hasta cerrar AUDIT-SEC-P0.
Alcance previsto cuando se abra: cuenta Twilio **Paid**, **Verify Service**,
El Salvador, **Fraud Guard**, SMS real, rate limits, logs y rollback.

Estado actual: **Twilio en Trial** con Programmable Messaging (Verify disponible pero
**no seleccionado**, **Verify Service no creado**).

---

## H. Backlog vigente (registrado, NO activo)

No implementar sin instrucción del owner.

1. **Traducir al español los errores de contraseña.** No mostrar mensajes crudos de
   Supabase en inglés. Caso observado:
   `New password should be different from the old password.`
   Copy aprobado: **"La nueva contraseña debe ser diferente de la contraseña
   anterior."** Revisar las tres superficies: **creación**, **cambio** y
   **recuperación** de contraseña. Usar **tuteo** ("Elige", "iniciarás sesión",
   "Confirma").
2. **`NotificationBell`** — cerrar el popover con **Escape** y **devolver el foco**
   al botón de la campana. Quedó explícitamente fuera de #311.
3. **Correo verificado como canal secundario de recuperación.** El **teléfono sigue
   siendo la identidad principal**.
4. **Botón "Gestionar plan y facturación"** en LucyCare operativo, que dirija al
   sistema de facturación en **`medicos.lucycare.app`**: cambiar plan, modalidad,
   tarjeta o método de pago. **Evaluar qué cambios requiere el sitio de médicos** —
   su flujo actual es **demostrativo** y **no debe tratarse todavía como sistema
   autoritativo de cobro**.
5. **Entregabilidad de correo** (SPF/DKIM/DMARC + plantilla de Supabase/Resend).
6. **Razón genérica "Otro motivo"** en `cancel_reasons` (tabla no versionada en
   `migrations/`).
7. **Revisión de `cancel_reasons` como tabla legacy** — entrar por migración
   versionada.
8. **UX del widget de Turnstile en móvil** — mejora cosmética, no bloqueante.
9. **F1-c (`doctor_credentials` DROP)** — no abrir sin: sincronía fresca, respaldo,
   preflight `service_role` y autorización del owner.

### Objetivo comercial

**LucyCare debe quedar listo para lanzamiento comercial en El Salvador a más tardar
el 2 de octubre de 2026.** No hay expansión regional en este ciclo.

**Secuencia prioritaria acordada:**

`PR #311` ✅ → **AUDIT-SEC-P0** → **TWILIO-P0** → QA integral →
soporte/recuperación → pagos/facturación → legal/monitoreo → piloto comercial →
go / no-go.

---

## I. Reglas operativas (VINCULANTES)

- **Un solo frente funcional a la vez.**
- **El owner decide; el developer ejecuta instrucciones cerradas.**
- **No abrir rama, PR ni frente nuevo sin autorización explícita del owner.**
- **No mergear** salvo autorización explícita y vigente.
- **No ejecutar SQL. No aplicar migraciones.** El owner aplica el SQL en el SQL
  Editor de Supabase; el dev corre los `check`/`smoke`.
- **`service_role` requiere autorización puntual, limitada y explícita, INCLUSO
  read-only.**
- **No tocar `auth.users` por SQL** bajo ninguna circunstancia.
- **No modificar** Supabase, Auth Hooks, Vercel, Cloudflare, Turnstile, Twilio,
  Resend ni producción sin autorización expresa.
- **No compartir, imprimir, registrar ni guardar** secretos, tokens, contraseñas,
  OTP, captcha tokens, service keys ni enlaces de autenticación.
- **No usar datos reales para QA.**
- **Jamás Katherine (`50372608827`)**, ni siquiera en read-only.
- **Camilo (`50378627694`) solo como demo controlado**: no modificar su identidad ni
  su configuración permanente.
- **Fixtures propias, creadas desde cero, marcadas y limpiadas** al final, con
  verificación de **0 residuales**. Si la prueba crea algo irreversible, no usar el
  paciente demo.
- **Todo copy nuevo en tuteo**, no voseo.
- **No afirmar que una prueba fue ejecutada si solo se revisó código.**
- **No inventar** HEAD, estado de PR, deployment, resultados, datos ni configuración.
- **PR que toca DB → migración + `check-s7_NN.mjs` + `_smoke-s7_NN.mjs`.**
- **Para cambios de UI:** pedir preview / OK visual del owner antes de mergear.
- **No mezclar** SEO / Analytics / Auth / Clínico / DB en un mismo PR.
- **Validar el instrumento, no solo el fix:** correr la misma medición contra el
  código anterior (A/B) para comprobar que el bug se reproduce.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones, `main==origin/main`,
  `git status` vacío, rama borrada local+remoto, 0 PRs abiertos, sin residuos.

---

## J. Identidad de git (corregida el 2026-08-03)

El `~/.gitconfig` tenía `user.email = Americo del Valle` — un valor **malformado**,
no una dirección. Produjo 23 commits locales con autor inválido, entre ellos
`cd965ea`. Corregido por instrucción del owner:

| Ámbito | `user.name` | `user.email` |
|---|---|---|
| Global (`~/.gitconfig`) | `amedelvalle` | `240200944+amedelvalle@users.noreply.github.com` |
| Local (`C:\Users\admic\lucycare`) | `amedelvalle` | `lucycare.digital@gmail.com` |

**Intención:** que los commits de LucyCare queden identificados con el correo oficial
del proyecto; que otros repositorios no hereden de nuevo el valor malformado; y no
usar globalmente el correo específico de LucyCare.

**No se reescribió ningún commit anterior.** `cd965ea` queda intacto.

---

## K. Nota de smokes SQL

No usar tablas temporales en el SQL Editor de Supabase (`42P01` por `search_path`,
`3F000` porque `pg_temp` no resuelve hasta que la sesión materializa su esquema
temporal). Patrón vigente: variable `jsonb` + `set_config`/`current_setting` dentro
de `BEGIN … ROLLBACK` (ver `docs/OWNER_S7_69_SMOKE.md`).

---

## L. Deuda técnica documentada (sin cambios)

- **Triggers de auditoría legacy** (`audit_patients` s4_02, `audit_profiles_identity`
  s7_32) usan `auth.uid()`/`search_path` del caller y chocan con `service_role`/`''`
  en tablas auditadas. Entra en el alcance de **AUDIT-SEC-P0** (§G).
- **Deuda editorial:** voseo heredado en algunas superficies (sobre todo el claim);
  el copy nuevo mantiene **tuteo**.
- Inconsistencia visual en pantallas legacy que no usan el `<Button>` reusable.
- Sin sistema global de toasts.
- Print de receta minimalista (sin logo de clínica, sin QR).
- No hay vista `/panel/consultas` global.
- `WaitlistModal` cierra al click-outside (legacy); hardening pendiente.
- **Auditoría del importador rota:** `import-doctors.mjs` audita con `user_id null`
  contra un `NOT NULL` y falla en silencio. Corregir **antes** del próximo bulk
  import real.

---

## M. Cómo arrancar en una ventana nueva

```bash
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git log --oneline -10
```

Luego leer, en este orden:

1. `CLAUDE.md` (guía rápida; si contradice a `docs/`, mandan los `docs/`).
2. **Este handoff** (`docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-03.md`) — fuente
   canónica del estado.
3. `docs/HISTORIAL_FRENTES.md` para el detalle por PR de frentes ya cerrados.
4. El `docs/ANALISIS_*.md` correspondiente al objetivo del día — **no re-analizar**
   lo que ya está firmado.

**INSTRUCCIÓN 0:** no iniciar ningún frente sin instrucción del owner. El siguiente
en la fila es **AUDIT-SEC-P0**, y debe comenzar por un análisis **read-only** con
alcance aprobado.
