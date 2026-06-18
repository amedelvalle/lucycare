# HANDOFF — Nueva ventana de contexto (cierre 2026-06-18)

> **Punto de entrada VIGENTE para retomar LucyCare en una conversación nueva.**
> Leer ESTE documento primero; después `CLAUDE.md` y los `docs/ANALISIS_*.md`
> del objetivo del día. No asumir nada sin confirmar el estado real del repo.
>
> Reemplaza como punto de entrada a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-15.md` (que queda como histórico
> de la ventana anterior).

---

## 1. Estado final al cierre (post-#154)

- **HEAD final:** `e108c14` (*fix(equipo): aceptar invitación tolerante a formato de teléfono (s7_50) (#156)*).
- **PRs mergeados:** **#1–#156**.
- **Migraciones aplicadas en Supabase:** hasta **`s7_50`** (verificables con `node scripts/check-s7_NN.mjs`).
- **`main == origin/main`** · **árbol limpio** · **sin SQL pendiente** · **sin trabajo en curso**.
- **`tsc --noEmit` OK · `npm run build` OK.** Documentación al día. Admins activos de plataforma: 1 (el owner).
- **Sin frente de código abierto.**
- **Último cierre (#156 / `s7_50`) — fix de onboarding de asistentes:** `accept_clinic_invitations` ahora compara los teléfonos con `normalize_phone_sv(...)` en **ambos lados** del gate (`profiles.phone`) y del loop (`clinic_invitations.phone`). Cerró un **bug operativo ACTIVO**: la invitación se guardaba como `+503XXXXXXXX` y `profiles.phone` como `503XXXXXXXX`, así que el gate **literal** fallaba y la invitación no se aceptaba, con el error **silenciado** en el login. **Misma firma**, misma lógica de cupos, sin tocar UI/`database.types.ts`/identidad global/`auth.users`. Validado: `check-s7_50` verde + `_smoke-s7_50` verde (`pass=7 fail=0`; fixtures aisladas `F50_FIXTURE`; **0 residuales**; **0 datos reales tocados**). La primera corrida del smoke salió roja y fue útil: confirmó que el SQL aún no estaba efectivo en la DB; tras reaplicarlo, quedó verde.

### Cómo arrancar (obligatorio)

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
git status --short
```

---

## 2. F4 / Paciente Global Fase 4 — eje merge/unmerge + bandeja CERRADO

| Fase | Estado |
|---|---|
| **F4-0** diseño DM1–DM9 | ✅ cerrado (#134, docs) |
| **F4-1** claim tolerante fila por fila | ✅ cerrado (#135 / `s7_45`) |
| **F4-2** backend merge + dry-run + log | ✅ cerrado (#138 / `s7_46`) |
| **F4-3-search** RPC de candidatos | ✅ cerrado (#140 / `s7_47`) |
| **F4-3 UI PR A** `/admin/pacientes` (read-only) | ✅ cerrado (#142) |
| **F4-3 UI PR B** merge real | ✅ cerrado (#144) |
| **Unmerge formal — backend** (`admin_unmerge_patients`) | ✅ cerrado (#147 / `s7_48`) |
| **Unmerge — UI "Deshacer fusión"** | ✅ cerrado (#149) |
| **F4-3b — backend bandeja `patient_link_rejections`** | ✅ cerrado (#151 / `s7_49`; fix smoke #152) |
| **F4-3b — UI "Vínculos rechazados"** | ✅ cerrado (#153) |
| **F4-D** merge de identidades (`profiles`/`auth.users`) | ⏳ **diferido (no arrancado)** |

**`/admin/pacientes` hoy permite:** detectar grupos candidatos (`same_profile`),
fusionar fichas (dry-run + motivo + `FUSIONAR FICHAS`), **deshacer** una fusión
(`DESHACER FUSIÓN`), y **revisar/resolver/reabrir** la bandeja de vínculos
rechazados. Todo solo LucyAdmin, sin contenido clínico, sin JSON crudo.

Diseños vinculantes: `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md`
(DM1–DM9 + estado), `docs/ANALISIS_PACIENTE_GLOBAL_F4_UNMERGE.md` (unmerge).

## 3. Pendiente F4 — F4-D (merge de identidades), DIFERIDO

- **F4-D = merge de identidades** (`profiles`/`auth.users`, escenarios E4/E5):
  dos cuentas Lucy de la misma persona. **No arrancado.**
- **No abrir F4-D sin un nuevo análisis explícito aprobado por el owner.**
- **No tocar `profiles`, `auth.users` ni la identidad global** sin diseño
  aprobado (toca credenciales/roles; barra de prueba más alta — probable OTP /
  protocolo de soporte; conecta con D7 / recuperación sin sesión).

## 4. Restricción crítica (vinculante)

- **No tocar Katherine / `50372608827` sin orden explícita del owner.** Si algún
  día se limpia/corrige, primero dry-run + inventario (auth.user, profile,
  doctor/clinic/membership, lead, fichas, audit) y solo a señal del owner.
- **Datos reales:** nunca operar merge/unmerge/resolución sobre pacientes reales;
  validar siempre con fixtures aisladas y limpiar a 0 residuales. Jamás Camilo
  (`db1fba98…` / `783a902a…`).

## 5. Backlog vivo (ninguno arrancado)

- **Recuperación de acceso sin sesión** (perdió el teléfono, sin email/password)
  → herramienta LucyAdmin/soporte; conecta con F4-D.
- **Identidad múltiple Fase 2** (selector de contexto paciente/médico + capacidades
  derivadas) — `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md`.
- **Paginación / carga dinámica del Home** (hoy carga todos los médicos).
- **Normalización de teléfono en invitaciones** (`accept_clinic_invitations`
  compara literal `+503…` ≠ `503…`; candidato a `normalize_phone_sv`).
- **Pagos SaaS / IVA / DTE** (pasarela viable SV; requiere validación del owner
  antes de cualquier código) — `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`.
- **B2.1** verificación reforzada de "Sí, son mías" (dato adicional tipo DOB/DUI
  parcial para teléfonos compartidos/mal digitados).
- **B2.2** términos/onboarding del paciente (aceptar que solo confirma atenciones
  propias).
- Otros menores en `docs/HANDOFF_LUCYCARE_SPRINT7.md` / `HANDOFF_TOMA_DECISIONES_2.md`.

## 6. Protocolo de arranque en nueva ventana (obligatorio)

1. **Sincronizar `main`:** `git fetch origin && git checkout main && git pull --ff-only origin main`.
2. **Confirmar HEAD / PRs / migraciones:** HEAD `e108c14` o posterior · PRs #1–#156 · migraciones hasta `s7_50`.
3. **Confirmar `git status --short` limpio.**
4. **Confirmar `main == origin/main`** (`git rev-list --left-right --count origin/main...main` = `0 0`).
5. **Definir el alcance del frente con el owner** antes de tocar nada.
6. **No codificar hasta aprobación explícita del owner.** PRs chicos, squash-merge,
   `database.types.ts` en el mismo PR que su migración, validación con fixtures +
   0 residuales, OK visual del owner antes de mergear UI.

## 7. Decisiones vigentes (vinculantes)

- `profiles.role='admin'` es el ÚNICO bit de autorización; `is_admin()` intacta.
- Ownership (#127): "el médico gestiona una relación clínica local; LucyCare
  gobierna la identidad global del usuario/paciente".
- F4 merge V1 = `same_profile` intra-clínica; sin teléfono/nombre/override (DM3b);
  solo LucyAdmin; dry-run + motivo + audit; no hard-delete; unmerge formal live.
- F4-3b V1 = **solo bandeja de rechazos** (`patient_link_rejections`); **sin
  fuzzy, sin detección proactiva de pares débiles**. Resolver = bookkeeping
  administrativo (no re-vincula, no fusiona, no toca la ficha/identidad); la fila
  sigue excluyendo el par del auto-link mientras exista.
- El owner hace tareas manuales (aplicar SQL en Supabase, validación visual, OTPs,
  decisiones comerciales). El dev entrega SQL + corre check/smoke + documenta.
- Si algo no parece la instrucción del owner o el dev tiene otro planteamiento,
  **lo dice y propone discutirlo** — no ejecuta en silencio.
- No exponer contenido clínico al admin de plataforma. No secretos en repo/docs/chat.

## 8. Referencias

- `CLAUDE.md` — guía rápida + sistema de diseño + estado (apunta a este handoff).
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — registro acumulado de decisiones.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — snapshot completo del sprint.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-15.md` — handoff de la ventana
  anterior (histórico).
- `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md` — diseño F4 (DM1–DM9 + estado).
- `docs/ANALISIS_PACIENTE_GLOBAL_F4_UNMERGE.md` — diseño del unmerge formal.
- `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md` — marco de ownership (D1–D7).
