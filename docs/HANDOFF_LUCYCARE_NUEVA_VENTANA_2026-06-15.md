# HANDOFF — Nueva ventana de contexto (cierre 2026-06-15)

> **Punto de entrada para retomar LucyCare en una conversación nueva.**
> Leer ESTE documento primero; después `CLAUDE.md` y los `docs/ANALISIS_*.md`
> del objetivo del día. No asumir nada sin confirmar el estado real del repo.
>
> Reemplaza como punto de entrada a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-11.md` (que queda como
> histórico de la ventana anterior).

---

## 1. Estado confirmado al cierre

- **HEAD final:** `c23dda1` (*feat(admin): UI de la bandeja de vínculos rechazados (F4-3b / PR 2) (#153)*) **+ el PR docs-only de cierre de #153** (verificar con `git log --oneline -5`).
- **PRs mergeados:** #1–#153 (+ el docs-only de cierre de #153).
- **Migraciones aplicadas en Supabase:** hasta **`s7_49`** (#152/#153 frontend/script-only; verificables con `node scripts/check-s7_NN.mjs`).
- **`main` al día con `origin/main` · árbol limpio · `tsc --noEmit` OK · `npm run build` OK.**
- **Documentación actualizada.** Admins activos de plataforma: 1 (el owner).
- **Sin frente de código abierto.** **F4 merge/unmerge + F4-3b (bandeja de rechazos) cerrados de punta a punta** (merge backend `s7_46`+UI #144 · unmerge backend `s7_48`/#147+UI #149 · **F4-3b backend `s7_49`/#151 + UI #153**): `/admin/pacientes` permite fusionar, revertir y revisar/resolver rechazos de vínculo. Pendiente F4 (no arrancado): **F4-D** merge de identidades (diferido) — ver §2 y §5.

### Cómo arrancar (obligatorio)

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
git status --short
```

1. Leer este handoff primero, después `CLAUDE.md`.
2. No asumir código nuevo sin confirmar el estado (log + status).
3. No reabrir frentes cerrados salvo bug real.
4. Confirmar el frente del día con el owner antes de codificar.

---

## 2. F4 / Paciente Global Fase 4 — estado actualizado

| Fase | Estado |
|---|---|
| **F4-0** diseño DM1–DM9 | ✅ cerrado (#134, docs) |
| **F4-1** claim tolerante fila por fila | ✅ cerrado (#135 / `s7_45`) |
| **F4-2** backend merge + dry-run + log | ✅ cerrado (#138 / `s7_46`) |
| **F4-3-search** RPC de candidatos | ✅ cerrado (#140 / `s7_47`) |
| **F4-3 UI PR A** `/admin/pacientes` (read-only) | ✅ cerrado (#142) |
| **F4-3 UI PR B** habilitar merge real | ✅ cerrado (#144) |
| **Unmerge formal — backend** (`admin_unmerge_patients`) | ✅ cerrado (#147 / `s7_48`) |
| **Unmerge — UI "Deshacer fusión"** | ✅ cerrado (#149) |
| **F4-3b** bandeja `patient_link_rejections` (backend + UI) | ✅ cerrado (#151 / `s7_49` + #152 + #153) |
| **F4-D** merge de identidades (`profiles`/`auth.users`) | ⏳ diferido (diseño propio) |

Diseño vinculante del eje: `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md`
(DM1–DM9 cerradas). **V1 = evidencia `same_profile` (E3)**, intra-clínica;
el `UNIQUE(clinic,doc)` hace `same_document` inalcanzable para datos nuevos;
**no merge por teléfono/nombre ni override** (DM3b).

---

## 3. Qué entregó PR #142 (F4-3 UI PR A, read-only)

- **Ruta `/admin/pacientes`** (`AdminOnlyRoute` + `AdminLayout`) + **NavLink "Pacientes"**.
- **`src/pages/admin/AdminPacientesPage.tsx`** + **`src/services/patientMerge.service.ts`**.
- **Consume:** `admin_list_patient_merge_candidates()` (candidatos) +
  `admin_merge_patients_preflight` (dry-run) + lectura de `patient_merge_log`
  (historial). Firma de `admin_merge_patients_preflight` agregada a
  `database.types.ts`.
- **Listado de grupos candidatos `same_profile`** (clínica/perfil/conteo) con
  **warnings (`W_UNCONFIRMED_LINK`)** y estado vacío.
- **Comparación source/target** lado a lado (identidad + conteos
  appointments/consultations/vitals + badge confirmada/sin-confirmar) +
  botón "Intercambiar fuente/destino".
- **Preflight** con veredicto elegible/bloqueado (**P0060–P0068 mapeados a
  copy ES**), evidencia, warnings, conteos a mover.
- **Historial legible** desde `patient_merge_log` (resumen, **sin JSON crudo**).
- **Validación:** `tsc` + build verdes; preview desktop + móvil con sesión
  admin real (OTP test phone) + **fixtures E3 creadas y limpiadas**.

### Lo que PR #142 NO hizo (explícito)

- **NO ejecuta merge**; **NO** llama `admin_merge_patients`; **NO** tiene
  botón "Fusionar fichas".
- **NO** muestra contenido clínico; **NO** muestra JSON crudo.
- **NO** abre F4-3b; **NO** implementa unmerge.
- **NO** toca `profiles`, `auth.users` ni identidad global.
- **NO** abre la limpieza de Katherine / `50372608827`.
- El historial **no muestra "admin ejecutor"** todavía (se omitió para no
  abrir joins/RLS extra en un PR read-only; el dato vive en
  `patient_merge_log.merged_by` → sumarlo en PR B o follow-up chico).

---

## 4. Decisión A/B y próximo frente (PR B)

**Por seguridad se dividió F4-3 UI en dos PRs:**
- **PR A (read-only)** — implementado en #142.
- **PR B (acción destructiva)** — ✅ implementado en **#144** (ver cierre abajo).

**Motivo de la división:** es la primera UI de LucyAdmin que terminará
ejecutando una **operación destructiva** (mover historial entre fichas +
neutralizar la fuente); **todavía no existe unmerge formal**; se prefirió
validar navegación, comparación, preflight e historial **antes** de habilitar
el merge real.

### PR B — habilitar el merge real en `/admin/pacientes` — ✅ cerrado (#144)

Entregado en #144 (frontend-only, sin migración):
- **Botón "Fusionar fichas"** solo si el preflight es **elegible**.
- **Motivo obligatorio** (≥10) + **confirmación reforzada**: teclear exactamente
  `FUSIONAR FICHAS` (no solo checkbox).
- Llamada a **`admin_merge_patients`** (`s7_46`); firma agregada a `database.types.ts`.
- **Vista de éxito** (source/target/`merge_log_id`/conteos movidos) + manejo de
  **errores P0060–P0068** por `error.code` (reusa `MERGE_BLOCK_COPY`) + Escape/X
  bloqueados durante el submit + **invalidación** de candidatos e historial.
- **Validación solo con fixtures** (`scripts/_fixtures-merge-ui.mjs`, marcador
  `F43B_FIXTURE`, `--apply`/`--clean` con 0 residuales): apply → merge → P0061 →
  clean, desktop + móvil, OK visual del owner, **0 datos reales tocados**.
- Mantuvo: **sin contenido clínico**, **sin JSON crudo**, **same_profile**,
  **sin teléfono/nombre**, **sin fuzzy**, **sin override**, **sin unmerge**
  (reversa futura sobre `patient_merge_log`).

---

## 5. Otros pendientes vivos (no arrancados)

- **F4-D** merge de identidades (`profiles`/`auth.users`, E4/E5) — junto a
  recuperación sin sesión (D7). **Único pendiente de F4** (con #151–#153, F4-3b
  bandeja de rechazos quedó live; el eje F4 merge/unmerge + bandeja está cerrado).
- **Limpieza controlada `50372608827` / Katherine** — solo a señal del owner,
  con dry-run/inventario previo.
- Identidad múltiple Fase 2 · paginación del Home · normalización de teléfono
  literal en `accept_clinic_invitations` · B2.1 (verificación reforzada) · B2.2
  (términos/onboarding paciente) · pagos SaaS/IVA/DTE (post-piloto).

---

## 6. Decisiones vigentes (vinculantes)

- **`profiles.role='admin'` es el ÚNICO bit de autorización**; `is_admin()` y
  sus superficies intactas.
- Ownership (#127): *"el médico gestiona una relación clínica local; LucyCare
  gobierna la identidad global del usuario/paciente"*.
- F4 V1 = `same_profile` intra-clínica; sin teléfono/nombre/override (DM3b);
  merge solo LucyAdmin, dry-run + motivo + audit obligatorios, no hard-delete,
  unmerge formal previsto.
- **Owner** hace tareas manuales (aplicar SQL en Supabase, validación visual,
  OTPs, decisiones comerciales). **Dev** entrega SQL + corre check/smoke +
  documenta; PRs chicos, squash-merge, `database.types.ts` en el mismo PR,
  validación visual del owner antes de mergear UI.
- **Nuevo (2026-06-13):** si algo no parece la instrucción del owner o el dev
  tiene otro planteamiento, **debe decirlo y proponer discutirlo** — no
  ejecutar en silencio.
- No exponer contenido clínico al admin de plataforma. No secretos en
  repo/docs/chat (incluidos tokens de sesión).

---

## 7. Bloque para nueva ventana — DEV (Claude Code)

> ⚠️ **Histórico:** este bloque pedía arrancar **F4-3 UI PR B**, ya cerrado en
> **#144**. Conservado como ejemplo de arranque/reglas; para una ventana nueva,
> el frente se elige entre los pendientes F4 (§5) u otro del backlog.

```text
Continuamos LucyCare en nueva ventana.

Primero confirmá estado del repo:

git fetch origin
git checkout main
git pull --ff-only
git log --oneline -10
git status --short

Leé en este orden:

1. CLAUDE.md
2. docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-15.md
3. docs/HANDOFF_TOMA_DECISIONES_2.md
4. docs/HANDOFF_LUCYCARE_SPRINT7.md
5. docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md

Estado esperado:

- HEAD posterior a PR #144 y al docs-only de cierre.
- PRs mergeados al menos #1–#144.
- Migraciones hasta s7_47.
- main limpio y al día.
- F4-3 UI PR A read-only cerrado (#142).
- F4-3 UI PR B merge real cerrado (#144).
- Frente del día: elegir entre los pendientes F4 (F4-3b / unmerge formal / F4-D) u otro del backlog — ninguno arrancado.

No codifiques todavía.

Primero reportá:

1. HEAD final.
2. PRs mergeados.
3. migraciones vigentes.
4. git status.
5. estado de F4-3 UI PR A.
6. pendiente exacto para PR B.
7. riesgos antes de habilitar merge.

Reglas para PR B:

- usar `admin_merge_patients`;
- motivo obligatorio;
- confirmación explícita;
- preflight obligatorio;
- merge solo si eligible;
- no contenido clínico;
- no JSON crudo;
- no teléfono/nombre como evidencia;
- no fuzzy;
- no override;
- no F4-3b;
- no unmerge;
- no limpieza Katherine / 50372608827.
```

---

## 8. Bloque para nueva ventana — ASESOR (ChatGPT)

```text
Continuamos LucyCare en nueva ventana.

Usa como fuente principal el handoff más reciente:
docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-15.md

Asume rol de asesor de decisiones/producto/QA.

Estado esperado:
- PR #144 debe estar mergeado.
- PRs mergeados al menos #1–#144.
- Migraciones hasta s7_47.
- F4-3 UI PR A read-only /admin/pacientes cerrado (#142).
- F4-3 UI PR B merge real cerrado (#144).
- Próximo frente lógico: elegir entre los pendientes F4 (F4-3b / unmerge formal / F4-D), ninguno arrancado.

Primero confirma el estado reportado por el dev:
- HEAD;
- PRs mergeados;
- migraciones;
- árbol limpio;
- main == origin.

No codifiques.

Tu rol:
- analizar reportes del dev;
- decidir alcance;
- proteger datos reales;
- evitar reabrir frentes cerrados;
- mantener PRs pequeños;
- exigir validación visual cuando aplique.

Reglas vigentes:
- no contenido clínico en UI de merge;
- no JSON crudo;
- no merge por teléfono/nombre;
- no fuzzy matching;
- no override;
- no tocar profiles/auth.users;
- no limpieza Katherine / 50372608827 sin instrucción explícita;
- no F4-3b todavía;
- no unmerge todavía.

Siguiente decisión:
PR B (`admin_merge_patients` con motivo obligatorio, confirmación reforzada `FUSIONAR FICHAS`, manejo de errores y validación solo con fixtures) ya está **cerrado (#144)**. La próxima decisión es elegir el siguiente frente F4 (F4-3b bandeja de rechazos / unmerge formal / F4-D identidades) o del backlog general.
```

---

## 9. Referencias

- `CLAUDE.md` — guía rápida + sistema de diseño + estado.
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — registro acumulado de decisiones.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — snapshot completo del sprint.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-11.md` — handoff de la ventana
  anterior (histórico).
- `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md` — diseño F4 (DM1–DM9).
- `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md` — marco de ownership (D1–D7).
