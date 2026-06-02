# Plan operativo — Mi equipo Fase 1 (límite de asistentes)

> Plan de implementación corto, derivado de
> `docs/ANALISIS_MI_EQUIPO_INVITADOS.md` (§5, §6, §14).
> **Snapshot 2026-06-01.**
>
> **Estado: BORRADOR operativo. NO implementar código ni tocar la DB
> hasta aprobación.** Este plan define **solo Fase 1 (límite de equipo)**.
> El **add-on pagado** de asistentes adicionales NO se implementa acá —
> depende de cerrar la pasarela de pagos (`docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`).

---

## 0. Contexto / prerequisitos ya cerrados

- ✅ **Gate clínico del rol asistente** (PR #67, `s7_26`): el `assistant`
  es **estrictamente operativo, no clínico** — no lee ni escribe
  `consultations`/`prescriptions`/`consultation_diagnoses`/`consultation_family_history`/`vitals`.
  Validado con smoke empírico. **Fase 1 NO reabre esto.**
- ✅ Existe el esqueleto: tabla `clinic_invitations` + RPC
  `accept_clinic_invitations` (s5_07) + página `/panel/equipo`.
- ❌ **No existe ningún límite de cupo hoy** — el médico puede invitar
  asistentes sin tope. Eso es lo que cierra Fase 1.

---

## 1. Alcance de Fase 1

**SÍ (en esta fase):**
- Imponer el **límite base** de asistentes, **server-side**.
- Contar correctamente el cupo (incluyendo invitaciones pendientes).
- Reflejar el cupo en la UI (contador, botón deshabilitado cuando está lleno).

**NO (fuera de Fase 1 — diferido):**
- **Add-on pagado** de asistentes adicionales → depende de pagos
  (`ANALISIS_PAGOS_SAAS_MEDICOS.md`). Hasta entonces, el límite es fijo.
- Expiración / reenvío de invitaciones (Fase 2 del análisis).
- Cualquier permiso clínico para el asistente (cerrado en s7_26).
- Tocar el modelo de pagos / suscripción.

---

## 2. Decisiones cerradas (por el owner, 2026-06-01)

| # | Decisión |
|---|---|
| D1 | **Límite base = 1 médico titular + 2 asistentes = 3 accesos.** `included_assistants = 2`. El titular no cuenta como asistente. |
| D2 | **Las invitaciones pendientes SÍ cuentan dentro del límite** (evita el bypass "invito 10 y aceptan después"). |
| D3 | **Más asistentes = add-on pagado**, pero **se implementa cuando se cierre pagos**. En Fase 1 el límite es **fijo en 2**. |
| D4 | **Enforcement server-side** (DB), no solo UI. |
| D5 | **`assistant` = rol operativo, no clínico** (ya garantizado por `s7_26`; Fase 1 no lo modifica). |

---

## 3. Regla de conteo (exacta)

```
usados(clinic_id) =
    COUNT(clinic_members  WHERE clinic_id = X AND role = 'assistant' AND is_active = true)
  + COUNT(clinic_invitations WHERE clinic_id = X AND accepted_at IS NULL AND cancelled_at IS NULL)

limite(clinic_id) = included_assistants  (= 2 en Fase 1, fijo)

Se puede invitar / aceptar  ⇔  usados < limite
```

Notas:
- El **titular (`owner`/`doctor`) NO cuenta** (se filtra `role = 'assistant'`).
- **Inactivos NO cuentan** (liberan cupo; reactivar revalida — ver §5).
- Invitaciones `cancelled`/`expired` no cuentan.

---

## 4. Enforcement server-side (dónde y cómo)

> Hoy `inviteMember` hace **INSERT directo** a `clinic_invitations`
> (gobernado por RLS, política `clinic_invitations_insert_doctor` de
> s5_07). Por eso un check de cliente NO alcanza: hay que enforzar en la
> **DB**.

**Vía recomendada — trigger BEFORE INSERT en `clinic_invitations`:**
- `trg_enforce_team_limit` (BEFORE INSERT): calcula `usados(NEW.clinic_id)`
  y si `>= limite` → `RAISE EXCEPTION 'Límite de equipo alcanzado (N asistentes)'`
  con un SQLSTATE tipado (ej. `P0001`) para que el front muestre copy claro.
- Cubre el INSERT directo actual **y** cualquier camino futuro (no depende
  del cliente).

**Revalidación en `accept_clinic_invitations` (s5_07):**
- Antes de crear el `clinic_members` al aceptar, **revalidar el cupo**
  (defensa ante carrera: dos invitaciones pendientes que aceptan a la vez
  podrían exceder el límite). Si excede, no activar esa membresía y dejar
  la invitación sin aceptar (o marcarla para revisión).

**Defensa adicional (opcional, recomendado):**
- Considerar un trigger BEFORE INSERT/UPDATE en `clinic_members` que impida
  superar el límite de asistentes activos por clínica, aunque alguien
  escriba directo. (El trigger de invitaciones + la revalidación en accept
  ya cubren el camino normal; esto es cinturón-y-tirantes.)

**Fuente única del límite:**
- En Fase 1, `included_assistants` es una **constante** (2) en una función
  SQL `team_seat_limit(clinic_id)` que hoy devuelve `2`.
- En la fase de pagos, esa función pasará a leer
  `subscriptions` (`included_assistants + additional_assistants`) sin tocar
  los triggers → **enganche limpio** con el modelo de pagos.

---

## 5. Liberar cupo

- **Inactivar** un asistente (`clinic_members.is_active = false`) o
  **eliminar** la membresía → libera cupo.
- **Cancelar** una invitación pendiente → libera cupo.
- **Reactivar** un asistente inactivo → **revalida** contra el límite
  (puede fallar si el cupo ya está lleno con otros).

---

## 6. UI (mínimo en Fase 1)

En `/panel/equipo` (ya existe):
- **Contador de cupos** en el encabezado: `Asistentes 1/2`, `2/2` (lleno).
- Botón **"Invitar asistente" deshabilitado** cuando `usados >= limite`,
  con copy: *"Alcanzaste el máximo de asistentes de tu plan."* (y, cuando
  exista pagos, CTA "Agregar asistente ($5/mes)").
- Si el INSERT igual llega al backend lleno (carrera), mostrar el error
  tipado del trigger de forma amigable.
- **Sin** UI de add-on todavía (diferido).

---

## 7. Plan técnico tentativo (al aprobar)

- **Migración `s7_27`:**
  - Función `team_seat_limit(clinic_id) → int` (devuelve `2` fijo en Fase 1;
    documentar el TODO de leer de `subscriptions` en la fase de pagos).
  - Función `team_seats_used(clinic_id) → int` (conteo §3).
  - Trigger `trg_enforce_team_limit` BEFORE INSERT en `clinic_invitations`.
  - Revalidación de cupo dentro de `accept_clinic_invitations` (CREATE OR
    REPLACE).
  - (Opcional) trigger defensivo en `clinic_members`.
  - Audit: el trigger no necesita audit extra (las invitaciones ya se
    auditan en s5_07); el rechazo es una excepción.
- **`scripts/check-s7_27.mjs`** + smoke empírico (invitar hasta el límite,
  intentar el 3º → bloqueado; cancelar uno → libera; aceptar revalida).
- **Frontend:** contador de cupos + botón deshabilitado + mapeo del error.
- **Sin tocar** pagos ni el gate clínico.

Cada paso: 1 PR chico, `vite build` OK, smoke, merge. Enforcement
server-side primero; la UI solo refleja.

---

## 8. Decisiones pendientes (menores, cerrar al implementar)

| Q | Pregunta | Default |
|---|---|---|
| Q1 | Copy exacto del límite alcanzado | "Alcanzaste el máximo de asistentes de tu plan." |
| Q2 | Al aceptar una invitación que excede el cupo (carrera), ¿qué se hace? | No activar; dejar invitación pendiente + avisar al titular |
| Q3 | ¿El límite aplica también a los 5 médicos actuales? | Sí, uniforme (ninguno tiene asistentes hoy → sin impacto) |

---

## 9. Coordinación con otros docs

- `docs/ANALISIS_MI_EQUIPO_INVITADOS.md` — este plan implementa su Fase 1
  (§6 límite técnico). Fase 2 (expiración/reenvío) y permisos finos quedan
  después.
- `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` — el add-on de asistentes
  adicionales (`additional_assistants`) y `max_team_members` desde
  `subscriptions` se enganchan cuando se implemente la suscripción. La
  función `team_seat_limit()` es el punto de enganche.
- `s7_26` (gate clínico) — ya cerrado; Fase 1 no lo toca.

---

**Siguiente paso:** owner aprueba este plan. Con aprobación, se abre el PR
de Fase 1 (migración `s7_27` + enforcement + UI de cupos). El add-on
pagado espera a que se cierre la pasarela de pagos.
