# LucyCare — Contexto para Claude Code

> ⚠️ **Este archivo es una GUÍA RÁPIDA.** La referencia operativa
> detallada y vigente está en `docs/` (ver abajo). Si algo de este
> archivo contradice a `docs/`, mandan los `docs/`.

> 🟢 **ESTADO VIGENTE (2026-08-27) — post PR #352 en `main`. PILOTO = GO.**
> **Punto de entrada canónico:
> `docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-08-27_POST_PR352.txt`
> (leer PRIMERO).** Reemplaza al `2026-08-24_PATIENT_CRM_P0`, que pasa a
> **histórico** junto con todos los anteriores. El detalle por PR de los frentes
> cerrados vive en **`docs/HISTORIAL_FRENTES.md`** — este archivo no lo duplica.
>
> ✅ **`ADMIN-DOCTOR-SEED-P0` = CLOSED.** PR **#348 mergeado** (2026-08-24);
> `main` quedó en **`b9edf91d135c74404711c2b8f9bffebdc0ad497e`** ·
> **96 migraciones aplicadas** (hasta `s7_75`) · Edge Function
> `admin-create-seed-doctor` **`ACTIVE` v4** · E2E real y cleanup **PASS** ·
> **0 seeds en producción**.
>
> ✅ **`PATIENT-CRM-P0` = CLOSED (2026-08-25).** CRM de pacientes en LucyAdmin,
> **en producción**. PR **#349 MERGED** por **squash and merge**; `main` quedó en
> **`38fa67c18efbf760c1a8a18d7beccb58b75b81b3`**. `s7_76` (migración **97**) y
> `s7_77` (**98**) = **APPLIED / VERIFIED / CLOSED** desde el 2026-08-24, con PRE,
> POST de catálogo y POST funcional en **0 FAIL**; **entraron al PR solo como
> registro versionado y no se ejecutaron con el merge**. **Ninguna se vuelve a
> aplicar.** Evidencia en `docs/OWNER_S7_76_APPLY.md` y
> `docs/OWNER_S7_77_APPLY.md`.
>
> **Validación:** QA local **PASS** · **smoke del Preview PASS** (owner) ·
> **Vercel Production PASS / desplegado** · **smoke autenticado de producción
> PASS** (owner): «Base de pacientes», búsqueda, los **6** estados, selector
> **25/50**, «Pendientes de identificar» y «Fusión de fichas» **OK**, **consola
> sin errores**. Durante los smokes **no se pulsó «Exportar CSV»**, no se ejecutó
> **merge/unmerge/rechazos** y **no hubo ninguna escritura**.
>
> **Turnstile:** el hostname temporal del Preview quedó **REMOVED** (retirado por
> el owner el 2026-08-25) y **`lucycare.app` permanece autorizado**. No queda
> ningún cambio de configuración vivo de este frente.
>
> **Decisiones de producto vigentes:** orden por defecto
> `profiles.created_at DESC` con **desempate estable por ID** (la identidad
> LucyCare más reciente primero, **no** la fecha de la ficha) · **`Nuevo`** =
> identidad creada en los **últimos 30 días**, salvo que aplique antes un estado
> de mayor prioridad · **prioridad**
> `Bloqueado → En seguimiento → Recurrente → Nuevo → Activo → Inactivo` (es el
> orden de evaluación del `CASE` de `_crm_estado`; **`Nuevo` gana sobre
> `Activo`**) · **P0 CONGELADO** en búsqueda · filtro por estado · paginación
> **25/50** · exportación **CSV** del conjunto filtrado · los **walk-ins**
> permanecen **separados** como fichas **sin identidad global vinculada**, en la
> pestaña «Pendientes de identificar», y **no se suman** al universo del CRM.
>
> ✅ **`CRM-CSV-FECHAS-P0` = CLOSED (2026-08-26).** PR **#350 MERGED** por
> **squash and merge**; `main` quedó en
> **`7f802d3ce1b3fe2c5b4278d063021ee8fd3b0181`**. Las tres columnas de
> fecha/hora del **export CSV** del CRM —`Fecha de registro`,
> `Última actividad` y `Próxima cita`— se escribían como timestamps ISO
> crudos (`2026-08-02T13:49:49.181225-06:00`) y ahora salen como
> **`02/08/2026 13:49`**, con la zona **`America/El_Salvador` fijada
> explícitamente** para que no dependa del reloj del navegador.
>
> **Frontend-only: sin SQL, sin Supabase, sin migraciones, sin backend, sin
> configuración.** Un solo archivo de producto,
> `src/services/patientCrm.service.ts` (+58/−0), más el check nuevo
> `scripts/check-crm-csv-fechas.mjs`. Las otras **11 columnas quedan
> byte-equivalentes**, la **visualización en pantalla no cambia** y
> `src/lib/csv.ts` **no se tocó**: la protección contra CSV/formula injection
> y el escape RFC 4180 se aplican igual, porque el valor formateado sigue
> pasando por `csvCell`. **NULL sigue dando celda vacía** y una fecha ilegible
> **conserva el valor original** en vez de escribir `Invalid Date`.
>
> **Validación:** `check-crm-csv-fechas` **33/33** (prueba **conductual**: el
> servicio real transpilado con esbuild, no inspección de texto) · `tsc` y
> `build` **PASS** · `_qa-crm-paginacion` **35/35** · **Vercel Production
> PASS** · **CSV descargado y validado por el owner en producción**: formato
> correcto en las tres columnas, sin `T`, sin microsegundos, sin offset, y las
> celdas vacías siguen vacías.
>
> Detalle de implementación: se ensambla con
> `Intl.DateTimeFormat().formatToParts()` y **no** con `toLocaleString`,
> porque `es-SV` es un locale de **12 horas** (daría `01:49 p. m.`) y
> `toLocaleString` **intercala una coma** entre fecha y hora. Se usa
> `hourCycle: 'h23'` y no `hour12: false`: este último puede rendir `24:15`
> para la medianoche.
>
> ✅ **`ADMIN-DOCTOR-EXPORT-URL-P0` = CLOSED (2026-08-27).** Follow-up de
> `ADMIN-DOCTOR-EXPORT-P0`: el CSV de médicos pasa de **15 a 17 columnas** con
> **`Slug`** y **`URL pública`**. PR **#352 MERGED** por **squash and merge**;
> `main` quedó en **`f7213d29af0b61ea6104da8a962597bb005e658b`**. **`s7_79` =
> migración 100, APPLIED / VERIFIED / CLOSED** (aplicada por el owner el
> 2026-08-27, ANTES del PR; entró como registro versionado y **no se ejecutó con
> el merge**).
>
> **El cambio backend es UNA clave:** `CREATE OR REPLACE` de
> `admin_export_doctors` añadiendo `'slug', d.slug` a la allowlist. `doctors`
> ya estaba unido para llegar a `profile_id` y `clinic_id`, así que **no hay
> JOIN nuevo y el plan de ejecución no cambia**. Verificado con **A/B
> estructural**: quitando esa clave, el cuerpo es **idéntico** al de `s7_78`.
> **`s7_78` no se modificó** y **`admin_list_doctors` tampoco se tocó** — una
> guarda POST verifica que el listado no gane la columna.
>
> **Regla de la URL — es deliberada:**
> `publicado + slug` → Slug lleno y `https://lucycare.app/doctor/<slug>` ·
> `NO publicado + slug` → **Slug lleno y URL VACÍA** ·
> `sin slug` → **ambas vacías**. `fetchDoctorDetail` filtra por
> `is_published = true`, así que la URL de un no publicado renderiza «Médico no
> encontrado»: una columna llamada «URL pública» no debe contener enlaces
> muertos. El caso existe porque `trg_set_doctor_slug` asigna el slug **al
> publicar y nunca lo reescribe**, de modo que un médico despublicado conserva
> el suyo. **El export NUNCA reconstruye el slug desde el nombre.**
>
> **Dominio `https://lucycare.app` como constante literal del servicio**, no
> `window.location.origin`: exportar desde un Preview habría producido enlaces
> `vercel.app` que fallan fuera del navegador que los generó, y el error sería
> invisible hasta que alguien hiciera clic. La URL se arma en el frontend porque
> el dominio es **presentación, no dato**.
>
> **Sin cambios** en filtros, paginación, auditoría, `MAX_EXPORT = 10000`,
> `P0140`/`P0142`/`P0146`, gate `is_admin()`, grants de los cuatro roles ni el
> orden dentro de `jsonb_agg`. El bloque de auditoría es **idéntico** al de
> `s7_78`, comprobado por A/B: el slug es una columna más del archivo, y la
> auditoría registra **cuántas** filas salieron, no cuáles.
>
> **Validación:** `check-s7_79` **99/99** (con A/B del instrumento) ·
> `check-admin-doctor-csv` **68/68** (**conductual**) · `check-s7_78` **117/117**
> · `check-crm-csv-fechas` **33/33** sin regresión · `_qa-crm-paginacion`
> **35/35** · `tsc` y `build` **PASS** · **Vercel Production PASS** · **smoke del
> Preview PASS** y **smoke autenticado de producción PASS** (owner), con la **URL
> real abierta manualmente en Internet**. Evidencia del CSV: **115 médicos · 17
> columnas · 39 slugs · 36 URLs públicas · 3 con slug histórico y URL vacía · 76
> sin slug ni URL · 0 inconsistencias · 0 URLs `vercel.app` · 0 duplicados**. Los
> **7** eventos de `audit_log` verificados: solo metadata aprobada, **sin slug ni
> URL en el payload**.
>
> **Turnstile:** el hostname temporal del Preview quedó **REMOVED** y
> `lucycare.app` **permanece autorizado**. Sin pendientes de Cloudflare.
>
> **Nota operativa:** el despliegue de producción de este merge **tardó ~30 min**
> en dispararse —el webhook de Vercel no creó el deployment hasta bastante
> después del merge—. No fue un fallo del código: el deployment `6125658489`
> terminó en `success` y el bundle sirve el cambio. Conviene no dar por caído un
> despliegue solo porque tarde.

> ✅ **`ADMIN-DOCTOR-EXPORT-P0` = CLOSED (2026-08-26).** Exportación CSV de la
> base de médicos desde LucyAdmin, **en producción**. PR **#351 MERGED** por
> **squash and merge**; `main` quedó en
> **`61da06e372ecb5c8a4f602492f04ce77a72020f4`**. **`s7_78` = migración 99,
> APPLIED / VERIFIED / CLOSED** (aplicada por el owner el 2026-08-26, ANTES del
> PR; entró como registro versionado y **no se ejecutó con el merge**).
>
> **Qué hace:** desde `/admin/medicos`, el **Owner Admin** descarga los médicos
> que cumplen **exactamente los filtros activos** —búsqueda, publicado,
> operativo, `lucy_status`—, **no la página visible de 25**. La RPC
> `admin_export_doctors` **reutiliza `admin_list_doctors`** para resolver el
> universo, así que el predicado vive en **un solo lugar** y listado y export no
> pueden divergir; solo enriquece por `id` el correo, la dirección, el
> departamento y el municipio. El array JSON se ordena **dentro de `jsonb_agg`**
> por `created_at DESC, id`.
>
> **15 columnas:** Nombre · Especialidad · Teléfono · Correo · Clínica ·
> Dirección · Departamento · Municipio · Estado LucyCare · **Perfil reclamado** ·
> **Verificado en LucyCare** · Publicado · Agenda habilitada · Operativo ·
> **Fecha de alta en LucyCare**. Fechas en **`DD/MM/YYYY HH:mm`** con
> `America/El_Salvador` fijada explícitamente. CSV UTF-8 con BOM, CRLF y la
> protección contra formula injection de `src/lib/csv.ts`, reutilizada tal cual.
>
> **Seguridad:** `SECURITY DEFINER` · `VOLATILE` · `search_path` fijo · gate
> `is_admin()` con **`P0140`** · privilegios **explícitos** de los cuatro roles
> (`REVOKE` de `PUBLIC`, `anon` y `service_role`; `GRANT` solo a
> `authenticated`). **`directory_editor` recibe el GRANT y aun así obtiene
> `P0140`**: autenticado sí, autorizado no. El botón vive solo en
> `OwnerDoctorsView`. **`MAX_EXPORT = 10000`**: se piden 10 001 para detectar el
> exceso y por encima **aborta con `P0146` en vez de truncar**.
>
> **Auditoría no-PII**, escrita **después** de las tres validaciones: actor,
> formato, nº de registros, **si hubo búsqueda (booleano, nunca el texto)** y los
> filtros normalizados. Cero nombres, correos, teléfonos o filas exportadas.
>
> **Validación:** `check-s7_78` **115/115** (con A/B del instrumento) ·
> `check-admin-doctor-csv` **50/50** (**conductual**: el servicio real
> transpilado con esbuild) · `tsc` y `build` **PASS** · **Vercel Production
> PASS** · **smoke del Preview PASS** (owner, 3 CSV revisados que particionan el
> universo: **36 + 2 + 77 = 115**) · **smoke autenticado de producción PASS**.
> Los **5** eventos de `audit_log` verificados: solo metadata aprobada, cero PII.
>
> **Turnstile:** el hostname temporal del Preview quedó **REMOVED** (retirado por
> el owner) y **`lucycare.app` permanece autorizado**. Sin pendientes de
> Cloudflare.
>
> **Decisiones vigentes:** **CSV en P0, no XLSX** (no hay formato condicional,
> hojas ni fórmulas que justifiquen una librería nueva) · **sin `license_number`
> ni JVPM** —protegido por RLS por fila en `s7_61`, y la columna de `doctors`
> está en retiro lógico— · **sin citas, atenciones, última actividad, próxima
> cita ni rating**, que exigirían agregaciones sobre tablas que crecen con el uso
> · **fecha de reclamación, de verificación y de afiliación OMITIDAS**: se
> verificó que **no existe fuente canónica fiable** (`doctors.claimed_at` no
> existe —el `claimed_at` de `s7_13` vive dentro del payload de `audit_log`—,
> `tos_accepted_at` cubre 1/115, `doctor_credentials.verified_at` está en 0/115
> porque las 115 credenciales son `pending`, y `clinic_members.joined_at` cubre
> 15/115 y todas con rol `owner`) · **Departamento y Municipio pueden salir
> vacíos**: solo 20/115 clínicas los tienen cargados. Es **dato faltante, no
> defecto del export**.
>
> 🟡 **`DOCTOR-OWNER-NOTIFICATIONS-P0` = IMPLEMENTADO Y EN PRODUCCIÓN, PR
> ABIERTO (2026-08-28).** Avisa por correo al owner cuando (1) un médico
> completa el formulario de afiliación y (2) un médico reclama un perfil. Nada
> más. **`s7_80`, `s7_81` y `s7_82` = APPLIED / VERIFIED / NO REAPLICAR**
> (migraciones **101, 102 y 103**), aplicadas por el owner ANTES del PR y
> entradas al repositorio solo como registro versionado.
>
> **Arquitectura:** `evento → outbox → wakeup (pg_net) → Edge Function → Resend`.
>
> **El disparo es backend y posterior a la persistencia, nunca frontend**, y no
> por gusto: `submit_affiliation_request` devuelve `success:true` **también
> cuando NO inserta** (dedup anti-enumeración de `s7_21`), y el claim se consuma
> en el **paso 2 de 4** del modal, así que `onSuccess` daría falsos positivos y
> perdería eventos. Afiliación → trigger `AFTER INSERT`. Claim → dentro de
> `claim_doctor_profile`, porque un trigger sobre `doctors` **no distingue** el
> claim self-service de un `admin_set_lucy_status`.
>
> **El evento de negocio siempre gana.** El encolado va en un bloque
> `EXCEPTION WHEN OTHERS` que se traga cualquier error. Y el `EXCEPTION` del
> wakeup (`s7_82`) **no es redundante**: si propagara, la captura de
> `_enqueue_…` revertiría su subtransacción **y con ella el INSERT de la
> outbox** — el aviso pasaría de *retrasado* a *perdido*. Protegen cosas
> distintas.
>
> **Ventana de idempotencia = 23 h**, porque Resend olvida la `Idempotency-Key`
> a las 24. Dentro de ventana se reintenta con el mismo `outbox.id`; fuera, la
> fila pasa a **`needs_reconciliation`** y **no se reenvía**. El techo se aplica
> con `LEAST`: ningún llamador puede superarlo. Drenado atómico con
> `FOR UPDATE SKIP LOCKED`.
>
> **Cada claim real genera un `outbox.id` nuevo** — sin deduplicar por
> `doctor_id`, para que un claim legítimo posterior vuelva a notificar.
>
> ⚠️ **NO se usa la Database Webhook del Dashboard.** El proyecto **no tiene**
> el esqueleto `supabase_functions` (`3F000` al crearla) y reconstruirlo exigiría
> `CREATE USER … CREATEROLE`, `REASSIGN OWNED` y alterar funciones de
> `supabase_admin`: privilegios que el `postgres` de un proyecto alojado no
> tiene. No hacía falta: lo único que aporta `http_request()` es un payload que
> **nuestra Edge Function descarta**. `s7_82` llama a `net.http_post` con un
> trigger propio. **No recrear ese esqueleto.**
>
> ⚠️ **NO existe `supabase/config.toml`, y es DELIBERADO.** Se creó y se
> eliminó: un config parcial es superficie para `supabase config push`, que
> empujaría los defaults de la CLI sobre la configuración remota y podría pisar
> **Turnstile, el SMTP de Resend y Twilio**. Un comentario de advertencia dentro
> del archivo **no es un control técnico**. El deploy usa
> `supabase functions deploy notify-owner-doctor-events --no-verify-jwt`, que es
> por invocación y solo afecta a esa función. **`admin-create-seed-doctor` no se
> toca ni se redespliega.** `check-s7_80` falla si el archivo reaparece.
>
> **El secreto no está en el repo.** El trigger lo lee de **Supabase Vault** por
> nombre (`DOCTOR_NOTIFICATION_WEBHOOK_SECRET`) en runtime. ⚠️ Vive en **dos
> sitios con papeles distintos**: Vault es lo que el trigger **envía**, el Edge
> Function secret es contra lo que se **compara**. Si difieren, cada wakeup da
> 401 y no sale ningún correo. **Rotar = actualizar los dos**, primero el de la
> función.
>
> **Evidencia de cierre:** Edge Function `notify-owner-doctor-events` **ACTIVE
> v1** · gates **200 / 401 / 401 PASS** · `pg_net 0.20.0` habilitado · Vault con
> **exactamente 1** secreto · trigger propio `trg_notify_owner_wakeup` ·
> **E2E afiliación PASS** (correo real recibido) · **E2E claim PASS** (`sent`,
> `attempts=1`, `provider_message_id`) · **cola final vacía**, sin `failed` ni
> `needs_reconciliation`. Residuo aceptado de la variante A: **2 filas
> inmutables de `audit_log`** del trigger de `s7_21`; la variante B dejó
> **residuo cero**.
>
> **Sin cambios en `src/`.** Sin PII en la outbox ni en `audit_log`.
> Validación: `check-s7_80` **223/223**, `check-s7_81` **59/59** (con A/B
> estructural), `check-s7_82` **128/128**, mutation tests **18/18** y **29/29**,
> smoke SQL transaccional **PASS** con 0 residuales, `build` **PASS**.
>
> ⚠️ **LECCIÓN CARA:** `pg_proc.prosrc` **incluye los comentarios**. El primer
> apply de `s7_82` abortó con *«POST falló: el WARNING usa SQLERRM»* — la guarda
> se disparó con **su propio comentario**. `check-s7_82.mjs` sí quitaba
> comentarios y daba PASS: **los dos instrumentos medían textos distintos y solo
> se notó al aplicar en producción**. Regla: una guarda SQL y su equivalente en
> JS deben normalizar igual. El mutation test necesita **expectativa invertida**
> para probar la ausencia de falsos positivos.
>
> ℹ️ **`TYPES-RECONCILIATION-P0` es un frente aparte, no iniciado.**
> `src/types/database.types.ts` está desactualizado desde antes de estos frentes
> y **no se toca** dentro de `PATIENT-CRM-P0`.
>
> **Último HEAD funcional confirmado:
> `f7213d29af0b61ea6104da8a962597bb005e658b` — PR #352.** · **PRs funcionales
> mergeados hasta #352** · **103 migraciones aplicadas** (hasta `s7_82`) ·
> producción desplegada y **validada** contra el dominio.
>
> ⚠️ **Estado vigente distinto al de arriba:** `DOCTOR-OWNER-NOTIFICATIONS-P0`
> está **en producción con PR ABIERTO y sin mergear**. Las tres migraciones del
> frente (`s7_80`–`s7_82`) ya están aplicadas. Para el tip de `main` y el estado
> de los PRs, consultar Git y `gh pr list` — no este párrafo.
>
> ⚠️ **`f7213d2` es el último HEAD funcional confirmado, NO el tip eterno del
> repositorio.** Los commits posteriores **exclusivamente documentales no
> modifican este baseline funcional**. **Para el tip exacto vigente de `main`,
> consultar Git: `git rev-parse HEAD`.**
>
> **Último cambio funcional:** #352 (Slug y URL pública en el CSV de médicos,
> `s7_79`). Antes: #351 (exportación CSV de la base de médicos, `s7_78`), #350
> (fechas del export CSV del CRM), #349 (CRM de pacientes), #348 (seed de médico)
> y #346, #345, #344, #342/#343. **Desde el handoff `2026-08-18` se cerraron 4 frentes funcionales
> mediante 5 PRs (#342–#346), ninguno con migración ni cambio de
> configuración** — ver §5 del handoff vigente. Los PRs docs-only mueven el SHA
> del repositorio pero **no** el estado funcional, las migraciones, la DB, la
> configuración ni producción. **El SHA vigente se consulta con
> `git rev-parse HEAD`.**
>
> **🚀 GO/NO-GO DEL PILOTO = GO (2026-08-14).** **Cero FAIL bloqueantes.** PASS en:
> producción desplegada · Home/directorio · perfil y Booking de Camilo ·
> Auth/login con contraseña · recuperación por email · OTP real con Twilio Verify ·
> Turnstile · **Booking E2E real** · "Mis atenciones" · panel médico y
> notificaciones · Legal · perfiles QA públicos · safeguard de saldo de Twilio.
> Todas las deudas vigentes son **WARN no bloqueantes** (ver §H del handoff).
>
> **✅ BOOKING E2E REAL = PASS (2026-08-14).** Validada en producción la cadena
> completa `booking_intent → auth_creation_grant → consentimiento OTP → Turnstile →
> Twilio Verify real → Before User Created Hook → auth.user → contraseña → login →
> patient → appointment → intent consumido`. **La ruta del grant quedó demostrada
> por descarte:** en el instante de la creación, las otras cuatro ramas del hook
> (`patients`, `doctors`, `clinic_invitations`, `platform_admin_invitations`)
> estaban vacías para ese teléfono. Cleanup posterior completo, **cero residuos
> operativos**; `otp_consent_events` y `audit_log` **preservados** como evidencia.
> **No repetir el E2E.** Detalle en el handoff vigente §3.2.
>
> **✅ PR #334 — nombre del paciente nuevo.** Un paciente creado por OTP nacía con
> `profiles.full_name` vacío y la reserva caía al teléfono como nombre: la agenda
> del médico mostraba números. Ahora se pide **"Nombre completo"** *solo* cuando el
> perfil no lo tiene, se guarda primero con `updateMyProfile()` y recién entonces
> se reserva. Incluye protección contra **intent/slot obsoleto** (cambio de
> servicio/fecha/horario) y contra la **carrera** entre el guardado y ese cambio.
> **Sin migración, sin backend nuevo.**
>
> **✅ PR #335 — CALIFICACIÓN-COPY-P0.** Solo copy en
> `src/pages/calificar/CalificarPage.tsx`: *"Tu opinión es confidencial y completar
> la calificación toma menos de un minuto."* · *"¿Recomendarías a este médico a un
> familiar o amigo?"* · *"LucyCare · Calificación de la atención"*. **Sin lógica,
> submit, backend, DB, RPC, RLS, Auth, Booking ni SEO.**
>
> **✅ HIGIENE QA = CLOSED (2026-08-14).** El **único** perfil QA público
> (`QA LucyCare — Perfil médico de prueba`) fue **despublicado**: `is_published=false`.
> **Se conserva la identidad** (médico, profile, clínica, `auth.user`); solo cambió
> ese flag. Salió de Home/directorio y del sitemap; la URL directa responde
> `noindex,follow` **sin exponer datos del perfil**. **0 otros perfiles QA
> publicados.**
>
> **🔗 RATING-URL-P0 = APLICADA Y VERIFICADA (2026-08-14) — `s7_72`, PR #338.**
> La URL de calificación pasó de **64 caracteres hex** a **20 caracteres
> Crockford Base32** (`/calificar/K7M4QP2XR9TBNHF3VJCD`). `s7_72` es la
> **migración 93**, aplicada en producción: crea el helper
> `public._review_short_code()` (**100 bits exactos**, `gen_random_uuid()` /
> `pg_strong_random`, uniforme por construcción) y reemplaza **solo la expresión
> del token** en `generate_review_token()`. **Los enlaces de 64 caracteres ya
> emitidos siguen funcionando** hasta usarse o vencer (7 días); **sin backfill**.
> **Sin cambios** en `submit_review`, el esquema/índices de `review_tokens`, el
> trigger, la ruta `/calificar/:token`, el frontend ni el middleware. El helper
> queda **sin EXECUTE** para `PUBLIC`, `anon`, `authenticated` ni `service_role`.
> Verificación: PRE 16/16 · POST 15/15 · **10 000 generaciones, 10 000 únicas** ·
> `_smoke-s7_72.mjs` 5/5. Detalle en el handoff vigente §3.5 y guía de aplicación en
> `docs/OWNER_S7_72_APPLY.md`.
>
> **📞 SAFEGUARD DE SALDO TWILIO = CLOSED (2026-08-14) — reportado y verificado por
> el owner en la consola, no medido desde el repo.** Cuenta **Paid** · Twilio Verify
> operativo · saldo recargado a **~US$50** para el piloto · **Balance notification
> en US$25** · **Auto Recharge OFF** (decisión deliberada del piloto, no una deuda).
> Costo observado por verificación exitosa de un solo SMS: **~US$0.349**
> (US$0.05 Verify + US$0.299 SMS El Salvador). **Mantener vigilancia del saldo
> durante el piloto:** sin saldo no hay OTP, y el OTP es el único camino de alta de
> pacientes nuevos.
>
> **✅ LEGAL-P0 = CLOSED (2026-08-13) — PRs #331 y #332.**
> **#331 (publicación):** `/terminos` **existe** —cierra el enlace que caía en
> `NotFound`— y `/privacidad` reemplazó el texto provisional del MVP. Ambos son los
> documentos definitivos del owner (**Versión 1.0 · julio de 2026**), reproducidos
> sin resumir; se eliminó el descargo "versión inicial / será revisado por asesoría
> legal". `/terminos` entró al allowlist de `PublicAnalytics`.
> **#332 (integración):** `TOS_VERSION = 'tos-2026-08-13'` para las aceptaciones
> **nuevas** del claim; el identificador es técnico y **NO se imprime en la UI**;
> línea legal discreta bajo el CTA de `BookingCard` —*"Al reservar, aceptas los
> Términos y Condiciones y reconoces la Política de Privacidad"*— con enlaces a
> `/terminos` y `/privacidad` en pestaña nueva. `MobileBookingSheet` reutiliza
> `BookingCard`: móvil cubierto sin segunda implementación.
> **Sin migración, sin backend, sin checkbox nuevo ni modal.**
>
> ⚠️ **Las aceptaciones históricas `v1.0` NO se reinterpretan ni se migran:** se
> firmaron contra un documento que no estaba publicado. **`CONSENT_VERSION` de
> `AffiliationRequestModal` queda en `v1.0` y es otra cosa** — versiona el
> consentimiento LOPD del lead (`doctor_affiliation_requests.consent_version`,
> `s7_21`), no la Política de Privacidad.
>
> **PR 3 / evidencia explícita del paciente = DIFERIDO por decisión del owner.**
> No se agregan columnas a `appointments` ni se toca `create_booking_with_intent`.
> **No bloquea el piloto.**
>
> **✅ RECOVERY-EMAIL-P0 = CLOSED (2026-08-13).** El recovery real por email pasó
> end-to-end: enlace → contraseña establecida → login email+contraseña → sesión
> válida. El PR #327 había eliminado la realimentación
> `TOKEN_REFRESHED → useIdleLogout → refresh() → getSession()`, que podía agotar el
> rate limit de Auth (el 429 **no es reintentable** para auth-js, que borra la
> sesión y hace que `/reset-password` muestre falsamente "link expirado").
> **No reabrir Auth ni recovery salvo un incidente nuevo con evidencia propia.**
>
> **✅ ADMIN-JUNIOR = CLOSED (2026-08-13) — PR #329.** El acceso de
> `operations_admin` a LucyAdmin ya estaba resuelto server-side; lo que fallaba era
> **solo la navegación**: `destinationForRole` y el menú miraban únicamente
> `profiles.role`, y un `operations_admin` tiene `role='patient'`. #329 agregó
> `destinationAfterLogin()` (consulta la MISMA RPC del guard, `my_lucyadmin_access`)
> y el ítem **"Ir a LucyAdmin"** en `PatientAccountMenu`. Sin migración, sin
> backend, sin privilegios nuevos. La RPC **no corre para visitantes anónimos**
> (verificado en producción con Performance API: 0 llamadas en el Home anónimo).
>
> **✅ TESTPHONE-CLEANUP-P0 = CLOSED (2026-08-13).** `50377507479` retirado de Test
> Phones; el login posterior de `operations_admin` por email+contraseña = PASS.
> **Josué ya no depende de ningún Test Phone.** Quedan **exactamente 2**.
>
> **⚖️ ENTIDAD OPERADORA = DIVALUX (2026-08-17, PR #340).** La empresa que figura
> como responsable/operadora de LucyCare es **Divalux**, y donde corresponde la
> razón social completa, **Divalux, S.A. de C.V.** Se cambiaron las **5
> referencias user-facing** de `/terminos` y `/privacidad`; verificado en
> producción: **`Valux` vigente = 0**. **No se tocó `TOS_VERSION`**, aceptaciones,
> DB, RPC, migraciones ni lógica. **No volver a presentar Valux como entidad
> vigente.** El trámite societario es del owner y queda fuera del frente técnico.
>
> **✅ LOGIN-FIRST-TIME-COPY-P0 = CLOSED (2026-08-14, PR #337).** Cuando el login
> genérico apunta a un teléfono sin cuenta, GoTrue responde `otp_disabled` y **no
> envía SMS**. El copy pasó a: *"¿Primera vez en LucyCare? Reserva una cita para
> crear tu acceso. Si ya tienes cuenta, verifica tu número e inténtalo de nuevo."*
> Conserva el criterio **anti-enumeración**. `shouldCreateUser=false` intacto,
> verificado con `check-auth-p1b2a-login-gating` **15/15**.
>
> **✅ SECUENCIA HACIA EL PILOTO — COMPLETA.** Booking E2E real ✅ → safeguard de
> saldo de Twilio ✅ → higiene de perfiles QA publicados ✅ → **GO/NO-GO final ✅ =
> GO**. **No queda ningún frente funcional abierto**; nada se abre sin instrucción
> del owner.
>
> **📋 Aclaración del directorio (comportamiento esperado, NO es un hallazgo):**
> hay **36** médicos con `is_published=true` en la base, pero el Home muestra
> **35**. El excluido es **Dr. Abraham Alfredo Amaya Mendoza**
> (`fe7f4f9c-1ffd-4af6-954d-41c9cdc9aa02`), cuya **clínica no tiene dirección**, y
> lo filtra la regla **D1 de completitud mínima**
> (`full_name` + especialidad + `clinic.name` + `clinic.address`,
> `src/services/directory.service.ts`). Verificado también con el cliente `anon`:
> la RLS no oculta a nadie. Matiz intencional: **D1 gobierna el listado, no el
> sitemap** — `isSitemapEligible` no exige ubicación, así que ese perfil sí está
> indexado. Para incorporarlo basta cargarle la dirección desde LucyAdmin. **No se
> modificó en este ciclo.**
>
> **📉 Deuda menor de performance (registrada, NO urgente):** el bundle principal
> quedó en **~671,5 kB** (medición del 2026-08-20) porque las dos páginas legales viajan en el chunk inicial,
> siguiendo la convención del router de mantener estáticas las rutas públicas/SEO.
> El arreglo sería `lazy()` en ambas. **No es bloqueante y el owner decidió no
> hacerlo ahora.**
>
> **Último eje funcional cerrado antes — cancelación por el paciente (#310 / `s7_70` + #311):**
> el paciente cancela su cita desde "Mis atenciones"; el historial la conserva como
> *Cancelada*; el horario se libera; el médico ve la tarjeta "Cancelaciones
> recientes". **`NotificationBell` NO se modificó.**
>
> **🔐 Turnstile: ACTIVO en producción y configurado también en Preview**
> (variables de Preview configuradas y hostname del Preview autorizado en
> Cloudflare). La **Site Key es PÚBLICA** y la **Secret Key es SENSIBLE**:
> **ninguna se documenta, imprime ni guarda en el repo**. Consecuencia vigente: el
> **cambio de teléfono sigue SUSPENDIDO** (`PHONE_CHANGE_SUSPENDED = CAPTCHA_ENABLED`,
> porque `updateUser({phone})` no admite `captchaToken`).
>
> **⚠️ Orden VINCULANTE al tocar el CAPTCHA:** el frontend debe estar enviando
> tokens **antes** de que Supabase los exija. Frontend ON + Supabase OFF =
> inofensivo (GoTrue ignora el token). **Supabase ON + frontend OFF = caída total de
> Auth.** Para desactivar, el orden es el inverso: **apagar el enforcement en
> Supabase primero**, y recién después quitar `VITE_CAPTCHA_ENABLED` y redeployar.
>
> **🟢 AUDIT-SEC-P0 = CLOSED (2026-08-07).** La escritura arbitraria sobre
> `audit_log` está **cerrada en producción y reconciliada en el repo**. `s7_71a`
> (#313) añadió la cobertura server-side de `appointments`; `s7_71b` (#321) revocó
> los privilegios de cliente, eliminó la única policy permisiva y cerró
> `_admin_log_doctor_change`. `anon` y `authenticated` **sin ningún privilegio** ·
> `service_role` **solo `SELECT`** · **cero policies** · secuencia solo para el
> owner. El escritor de frontend (`auditLog.service.ts`) fue eliminado.
> **Prueba QA post-hardening: PASS** — la ruta
> `LucyAdmin → admin_set_doctor_operational → _admin_log_doctor_change → audit_log`
> quedó demostrada (filas `14494`/`14495`, que **se conservan**).
>
> ⚠️ **El histórico anterior al corte NO se reinterpreta como evidencia
> infalsificable.** Hasta `s7_71b`, `audit_log` admitía escritura arbitraria: esas
> filas son trazas operativas observadas, no prueba de no-repudio.
>
> **📱 TWILIO-P0 = CLOSED / VALIDATED FOR PILOT (2026-08-11).** El OTP por SMS
> real está **activo y validado end-to-end**. Supabase usa **Twilio Verify**
> (SMS · 6 dígitos · Fraud Guard · Geo Permissions solo El Salvador · sin número
> comprado). **El cambio no requirió código.** QA: control con Test Phone PASS +
> **un único SMS real** con Twilio `Approved`, intentos **1/1**, sesión válida y
> **cero efectos colaterales**; la identidad QA temporal se eliminó por Admin API
> y `profiles` volvió a su baseline. Turnstile **ACTIVO**, Before User Created
> Hook **ACTIVO**, Test Phones **conservados**.
>
> **Alcance de la validación:** cubre OTP SMS real · Turnstile · consentimiento ·
> Supabase Auth · Twilio Verify · `verifyOtp` · creación de contraseña · sesión ·
> cleanup. **NO cubre todavía** booking real con `shouldCreateUser=true`,
> comportamiento bajo carga/rate limits, ni países fuera de El Salvador.
> Detalle y alcance exacto en el handoff vigente **§14**.
>
> **✅ Safeguard operativo = RESUELTO (2026-08-14):** saldo recargado a ~US$50,
> Balance notification en US$25 y **Auto Recharge OFF por decisión del piloto**
> (ver bloque de safeguard arriba). **Ya no es un pendiente.**
>
> **Prohibiciones vigentes:** **no desactivar ni reconfigurar Turnstile/CAPTCHA** ·
> **no revertir de Twilio Verify a Programmable Messaging sin autorización
> explícita del owner** · **no reconfigurar el Verify Service, Geo Permissions,
> Fraud Guard, canales ni credenciales sin autorización explícita del owner** · no
> tocar claves en Vercel/Supabase/Cloudflare · no ejecutar SQL ni usar
> `service_role` sin autorización puntual · **no tocar `auth.users` por SQL —
> siempre Admin API** · **jamás Katherine (`50372608827`)** · no modificar la
> identidad ni la configuración permanente de **Camilo (`50378056365`)** ni de
> **LucyAdmin (`50378627694`)** · no iniciar ningún pendiente del backlog sin
> instrucción del owner.
>
> **Objetivo comercial:** LucyCare listo para lanzamiento en El Salvador **a más
> tardar el 2 de octubre de 2026** (sin expansión regional en este ciclo).
> Secuencia: #311 ✅ → AUDIT-SEC-P0 ✅ → TWILIO-P0 ✅ → RECOVERY-EMAIL-P0 ✅ →
> ADMIN-JUNIOR ✅ → TESTPHONE-CLEANUP-P0 ✅ → LEGAL-P0 ✅ → Booking E2E real ✅ →
> safeguard de saldo Twilio ✅ → higiene de perfiles QA ✅ → **GO/NO-GO ✅ = GO**.
> **BILLING-P0 sigue PAUSADO** y **no bloquea el piloto**.
>
> **Nota de smokes SQL:** no usar tablas temporales en el SQL Editor de Supabase
> (`42P01` por `search_path`, `3F000` porque `pg_temp` no resuelve hasta que la
> sesión materializa su esquema temporal). Patrón vigente: variable `jsonb` +
> `set_config`/`current_setting` dentro de `BEGIN … ROLLBACK`
> (ver `docs/OWNER_S7_69_SMOKE.md`).
>
> **Identidad de git (corregida 2026-08-03):** local en este repo
> `amedelvalle / lucycare.digital@gmail.com`; global
> `amedelvalle / 240200944+amedelvalle@users.noreply.github.com`. No se reescribió
> ningún commit anterior.

## Cómo retomar el proyecto en una sesión nueva

`origin/main` (GitHub) es la **única fuente de verdad**. Antes de
trabajar, sincronizá el repo local:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
```

Luego leé los documentos oficiales según el objetivo del día:

**Continuidad / base (siempre):**
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — **histórico**: snapshot del Sprint 7. El estado vigente lo manda el handoff canónico listado abajo.
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — handoff corto de decisiones + estado de infra + próximos pasos.
- `docs/ESTADO_TECNICO.md` — ER/BD, matriz de reglas, flujos UI/UX.

**Análisis vivos (cada uno cubre un eje):**
- `docs/ANALISIS_ANALYTICS_LUCYCARE.md` — medición de tráfico/conversión de `lucycare.app`: Q1–Q5 cerradas (Vercel Web Analytics + Speed Insights **cookieless** como primario, GA4 descartado; `doctor_slug` como id de evento; **jamás PII/clínico ni texto libre de búsqueda**; dashboard DB LucyAdmin separado y posterior). **PR-0 diseño ✅ #214. Fase 1A ✅ live #215 + prod + validación owner** — `@vercel/analytics` + `@vercel/speed-insights` + componente `PublicAnalytics` (montaje único en `App.tsx`, **defensa doble**: render allowlist `/`·`/doctor/*`·`/privacidad` + `beforeSend` backstop que retorna `null` fuera del allowlist y recorta query/hash; excluye `/panel`·`/admin`·`/paciente`·`/reset-password`·`/calificar`; sin eventos custom/cookies/PII/dashboard). **Fase 1B ✅ operativa (2026-07-02):** Google Search Console verificado (archivo HTML — `public/google3f2e02a3c176b538.html` #217 + `public/googlef334c08cb9e5d942.html` #218, **permanentes, no borrar**) + sitemap `lucycare.app/sitemap.xml` enviado/procesado (**Correcto**, 35 páginas descubiertas). **Pendiente NO iniciado:** 2 (eventos custom, sujeto a soporte del plan Vercel) · 3 (dashboard conversión DB) · 4 (dashboards por médico/especialidad/canal).
- `docs/ANALISIS_ANALYTICS_FARMA.md` — **capa estratégica INTERNA** de inteligencia de prescripción por médico (agregados, admin-only, no divulgable, sin paciente/receta individual/texto clínico). **PR-0 read-only ✅ (diseño):** viable hoy sobre `prescriptions` (snapshots `s7_37`) → `consultations.doctor_id`; base V1 = `is_current=true` + `status='signed'` + fecha `signed_at`; presentación (enum)/fuente global-vs-personal (`medications.doctor_id`)/crónicos (`duration_unit='permanente'`)/especialidad/tendencia son limpios; principio activo/concentración requieren normalización; **no existe categoría terapéutica**. **NO implementado** (backend `s7_54` / RPCs `admin_pharma_*` / módulo `/admin/analytics/farma` pendientes, sin abrir).
- `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` — **única fuente canónica de BILLING** (pagos, suscripción, planes, facturación). Reconciliado el 2026-08-07 con la arquitectura BILLING-P0: `billing_account` como entidad independiente, máquina de cinco estados sin `canceled`, entitlements derivados, **`is_operational` NO es estado de pago**, fases P0–P3 con enforcement al final, y grilla de evaluación de proveedor. **BILLING-P0 = PAUSADO — arquitectura definida**; proveedor no elegido; no bloquea el piloto.
- `docs/SECURITY_GATE_PILOTO.md` — auditoría pre-piloto + hallazgos cerrados.
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — diseño del reclamo (Fase 2 ✅ live).
- `docs/ANALISIS_AUTH_MEDICO.md` — plan auth email+password (PR-A ✅ live, PR-B en cola).
- `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md` — modelo comercial del directorio.
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — modelo de identidad de paciente (Fases 1, 2, 3 y 5 ✅ live; Fase 4: F4-1/F4-2/F4-3 search+UI A+UI B + unmerge backend+UI + **F4-3b bandeja de rechazos** ✅ live #135–#153 (`s7_45`–`s7_49`); F4-D identidades diferido).
- `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md` — identidad única + capacidades múltiples (5 decisiones aprobadas; Fase 1 ✅ live en #125; Fase 2 selector de contexto en cola; prerequisito de recuperación sin sesión y merge admin).
- `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md` — ownership del paciente: "el médico gestiona una relación clínica local; LucyCare gobierna la identidad global" (D1–D7 aprobadas; B2 confirmación post-claim ✅ live en #128/`s7_43`; B1 merge admin con diseño propio cerrado en #134).
- `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md` — diseño del merge admin de fichas duplicadas (Fase 4 / B1), **DM1–DM9 cerradas (#134)**. Alcance = fichas `patients` intra-clínica; reglas vinculantes; fases F4-1 (✅ #135/`s7_45`) → **F4-2 backend (✅ #138/`s7_46`, V1=`same_profile`)** → **F4-3-search RPC candidatos (✅ #140/`s7_47`)** → **F4-3 UI PR A read-only `/admin/pacientes` (✅ #142)** → **F4-3 UI PR B merge real `/admin/pacientes` (✅ #144)** → **unmerge formal backend (✅ #147/`s7_48`)** → **unmerge UI "Deshacer fusión" (✅ #149)** → **F4-3b bandeja de rechazos (`patient_link_rejections`): backend ✅ #151/`s7_49`, UI ✅ #153** → pendiente: F4-D identidades (diferido).
- `docs/ANALISIS_PACIENTE_GLOBAL_F4_UNMERGE.md` — diseño del unmerge formal (reversa del merge), decisiones cerradas; **backend ✅ live en #147/`s7_48`** (`admin_unmerge_patients_preflight` + `admin_unmerge_patients`, códigos P0070–P0077) + **UI "Deshacer fusión" ✅ live en #149** (`/admin/pacientes`, acción en el historial). F4-3b (bandeja `patient_link_rejections`) ✅ live #151/`s7_49`+#153; F4-D pendiente.
- `docs/ANALISIS_ADMINISTRADORES_LUCY.md` — administración de LucyAdmins (Opción B, D1–D6 aprobadas; Fase 1 ✅ live en #132/`s7_44`; owner/superadmin y capacidades granulares = Fase 2).
- `docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-08-27_POST_PR352.txt` — **HANDOFF CANÓNICO VIGENTE**. Autosuficiente y pensado para entregarse tal cual a una ventana nueva: baseline Git, producción y el incidente del webhook de Vercel, las 100 migraciones, los dos exports de médicos (#351 y #352) con sus reglas canónicas de `Slug` y `URL pública`, el CRM de pacientes, Auth/Twilio/Turnstile, LucyCare Médicos, SEO, deudas técnicas, reglas operativas permanentes, el frente potencial `DOCTOR-OWNER-NOTIFICATIONS-P0` (**NO abierto**) y la lista de cosas que NO deben repetirse. Los conteos de médicos, slugs y eventos de auditoría van etiquetados como **baseline dinámico**, no como invariantes.
- `docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-08-24_PATIENT_CRM_P0.md` — **histórico**. Cubre el frente `PATIENT-CRM-P0`: baseline, objetivo y principios, diagnóstico de `/admin/pacientes`, modelo observado, decisiones **D1–D5**, frontera clínica, timeline, performance, seguridad, evolución del predicado **P1/P1.1**, **P2–P5**, y el estado real del backend — `s7_76` y `s7_77` **aplicadas y verificadas**. Cerró el frente: PR #349 **MERGED**, producción **PASS**.
- `docs/ANALISIS_PATIENT_CRM.md` — **análisis vivo de `PATIENT-CRM-P0`**: diagnóstico completo, arquitectura, UX, allowlists, y el detalle de P1–P5. Lo referencia el handoff vigente.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-22_ADMIN_DOCTOR_SEED_P0.md` — **histórico** (frente `ADMIN-DOCTOR-SEED-P0`, cerrado en PR #348): AUTH-SEED-PROBE, `s7_73`/`s7_74`/`s7_75`, Edge v4, idempotencia y compensación, DB smoke, E2E real y cleanup.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-20.md` — **histórico** (post-#346, **piloto = GO**). Sigue siendo la mejor descripción del **estado general del producto**: reglas operativas, piloto, Auth/Booking/Twilio/Turnstile, calificaciones (`s7_72`), Legal + entidad **Divalux**, identidades protegidas y de QA, regla D1, SEO y backlog clasificado.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-18.md` — **histórico** (post-#340, **piloto = GO**). Autosuficiente y consolidado: estado del repo y producción, reglas operativas, cierre del piloto, Auth/login, Booking E2E, Twilio, calificaciones (copy + URL corta `s7_72`), Legal + **entidad Divalux**, identidades protegidas y de QA, regla D1 del directorio, SEO/Search Console, pendientes clasificados y estado del piloto operativo.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-12.md` — **histórico** (post-#335: cierre de RECOVERY-EMAIL-P0 / ADMIN-JUNIOR / TESTPHONE-CLEANUP-P0 / LEGAL-P0, Booking E2E, safeguard Twilio, higiene QA y matriz del GO).
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-06.md` — **histórico** (post-#314: AUDIT-SEC-P0 en curso, `s7_71a` aplicada, `s7_71b` bloqueada; su §13 y §14 quedaron actualizados con el cierre de BILLING y TWILIO).
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-03.md` — **histórico** (estado post-#311: eje de cancelación por el paciente #310/`s7_70`+#311, QA manual y sus límites, Turnstile ACTIVO en producción y configurado en Preview).
- `docs/HISTORIAL_FRENTES.md` — detalle por PR de todos los frentes cerrados (#105–#311) + migraciones. Consultarlo en lugar de duplicar historial en `CLAUDE.md`.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-30.md` — **histórico** (estado post-#308: eje Auth cerrado #304/#305/#306, `s7_69` aplicada y validada, **§M = cierre de PILOTO-P0**). Su texto histórico dice "CAPTCHA desactivado" en algunas secciones: **está obsoleto**, manda el handoff `2026-08-03`.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-14.md` — **histórico** (estado post-#277: **eje clínico F1–F6 CERRADO** (#272–#277) + `s7_58` aplicada + limpieza manual de `vitals` vacías; **regla vinculante de `amend_consultation`** (presencia de clave); pendientes vivos (F7, F8); reglas operativas; aprendizajes de método; prompt de arranque).
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-13.md` — **histórico** (estado post-#270: rediseño de receta #268, fix del race de campos de receta #269, manejo de error de sesión/cuenta #270; SEO Brand #266/#267).
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-09.md` — **histórico** (estado post-#257: Analytics Fase 3 conversión + Analytics Farma COMPLETO + fix doble reserva `s7_55` + Brand/Favicon corregido en prod; niveles de acceso LucyAdmin `directory_editor` #261–#264). El `2026-07-03_POST_PR220` (y anteriores) también históricos.
- `docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-07-03_POST_PR220.md` — histórico (estado post-#220: Slugs+SEO hasta PR C + Analytics/Search Console Fase 1A/1B + favicon inicial).
- `docs/ANALISIS_CATALOGOS_PERSONALIZADOS.md` — catálogo global Lucy + personal por médico + snapshot histórico (✅ COMPLETO: PRs #105–#111 + migración de base replicada, `s7_37`/`s7_38`/`s7_39`).
- `docs/FASE_4_AUTH_EMAIL.md` — guía operativa Supabase URL/email config.
- `docs/SETUP_SMTP_RESEND.md` — Resend como SMTP custom de Supabase Auth (✅ live desde 2026-05-26, dominio `lucycare.app`).
- `docs/CUENTA_DEMO_CAMILO.md` — credenciales y reglas de la cuenta demo oficial.

**Planes:**
- `docs/PLAN_SPRINT7_ADMIN.md` — plan original Sprint 7 (cerrado en mayo).
- `docs/PLAN_PILOTO_5_MEDICOS.md` — checklist de piloto.

⚠️ **No mergear branches `claude/*` viejas.** Las fases se integran a
`main` por **squash-merge**: la rama queda en el remoto pero su
contenido YA está en `main`. Re-mergearlas genera conflictos. Tras un
squash-merge, la rama puede borrarse.

## Frentes cerrados (resumen) — detalle en `docs/HISTORIAL_FRENTES.md`

- **Sprint 1–7 (#1–#30)** ✅ — directorio, booking, panel, reputación, admin SaaS inicial → [detalle](docs/HISTORIAL_FRENTES.md)
- **Pre-piloto (#32–#61)** ✅ — reclamo seguro, auth email+pass, afiliación F1+F2, SMTP Resend, dominio `lucycare.app` → [detalle](docs/HISTORIAL_FRENTES.md)
- **#62–#86** ✅ — correcciones post-firma eje completo (s7_28–s7_31), pagos SaaS diseño → [detalle](docs/HISTORIAL_FRENTES.md)
- **#87–#104** ✅ — Paciente Global F2+F3+F5 (s7_32–s7_35), cambio teléfono OTP (s7_34), Mi equipo F1+F2 (s7_27/s7_36) → [detalle](docs/HISTORIAL_FRENTES.md)
- **#105–#114** ✅ — Catálogos global+personal completo (s7_37–s7_39) + UI LucyAdmin → [detalle](docs/HISTORIAL_FRENTES.md)
- **#115–#139** ✅ — ubicación estructurada (s7_25), gate clínico asistente (s7_26), Lista de espera global (s7_41), Afiliación desde paciente existente (s7_42) → [detalle](docs/HISTORIAL_FRENTES.md)
- **#140–#163** ✅ — Paciente Global F4: merge+unmerge+F4-3b (s7_45–s7_49), lista de espera panel (s7_51) → [detalle](docs/HISTORIAL_FRENTES.md)
- **#164–#212** ✅ — correcciones clínicas F1–F7 (s7_58–s7_59), onboarding médico, resumen paciente, paginación, Slugs+SEO F1-3 (s7_52) → [detalle](docs/HISTORIAL_FRENTES.md)
- **#213–#264** ✅ — Analytics conversión (s7_53), Analytics Farma (s7_54), anti-solapamiento (s7_55), índices (s7_56), LucyAdmin niveles (s7_57), favicon, branding completo, Perf P1+P2 → [detalle](docs/HISTORIAL_FRENTES.md)
- **#265–#293** ✅ — SEO JSON-LD+OG, receta corregida minimal, hardening grants (s7_60), doctor_credentials F1-a/F1-b (s7_61–s7_62) → [detalle](docs/HISTORIAL_FRENTES.md)
- **#295–#311** ✅ — **F1-c1** cutover lógico de `doctor_credentials` (s7_63–s7_64; **F1-c2 / DROP físico sigue PENDIENTE**), eje Auth completo OTP+contraseña+consentimiento (s7_65–s7_69), PILOTO-P0 Turnstile (#308), cancelación por paciente (s7_70, #310–#311) → [detalle](docs/HISTORIAL_FRENTES.md)

- **#313–#321** ✅ — **AUDIT-SEC-P0 completo**: cobertura server-side de `appointments` (`s7_71a`, #313), instrumento del smoke corregido en cuatro PRs (#316–#320), cierre de la escritura arbitraria sobre `audit_log` (`s7_71b`, #321) y prueba QA de continuidad post-hardening PASS

- **#327–#329** ✅ — fix de Auth `useIdleLogout`/`TOKEN_REFRESHED` (#327), handoff canónico (#328) y **ADMIN-JUNIOR: navegación de `operations_admin` a LucyAdmin** (#329, frontend, sin migración) → [detalle](docs/HISTORIAL_FRENTES.md)

- **#330–#332** ✅ — cierre documental post-#329 (#330) y **LEGAL-P0 completo**: publicación de `/terminos` y `/privacidad` definitivos (#331) + integración `tos-2026-08-13` en el claim y línea legal en la reserva (#332). Todo frontend/docs, **sin migración** → [detalle](docs/HISTORIAL_FRENTES.md)

- **#333–#335** ✅ — cierre documental de LEGAL-P0 (#333), **nombre del paciente nuevo en Booking** (#334, frontend) y **CALIFICACIÓN-COPY-P0** (#335, solo copy). Todo frontend/docs, **sin migración** → [detalle](docs/HISTORIAL_FRENTES.md)

- **#336–#340** ✅ — cierre documental post-GO (#336), **LOGIN-FIRST-TIME-COPY-P0** (#337, una cadena), **RATING-URL-P0** (#338 `s7_72` + #339 tooling/docs) y **LEGAL-ENTITY-RENAME-P0** (#340, Valux → Divalux) → [detalle](docs/HISTORIAL_FRENTES.md)

- **#341–#346** ✅ — handoff `2026-08-18` (#341, docs-only; **hoy histórico**, superado por el `2026-08-20`) y **4 frentes funcionales, todos frontend, sin migración ni configuración**: **PASSWORD-ERROR-COPY-P0** (#342 + #343, este último ajuste post-cierre del mismo frente, **no un frente separado**), **NOTIFICATION-BELL-A11Y-P0** (#344), **CLAIM-COPY-TUTEO-P0** (#345) y **CLAIM-COPY-HYGIENE-P0** (#346) → [detalle](docs/HISTORIAL_FRENTES.md)

- **#347–#349** ✅ — handoff canónico post-#346 (#347, docs-only), **ADMIN-DOCTOR-SEED-P0** (#348, `s7_73`–`s7_75` + Edge Function `admin-create-seed-doctor` v4) y **PATIENT-CRM-P0** (#349, `s7_76`/`s7_77` **ya aplicadas antes del PR**, CRM de pacientes en LucyAdmin con las tres pestañas). Ambos frentes **CLOSED** y validados en producción → [detalle](docs/HISTORIAL_FRENTES.md)

- **#350** ✅ — **CRM-CSV-FECHAS-P0**: las tres columnas de fecha/hora del export CSV del CRM pasan de timestamp ISO crudo a `DD/MM/YYYY HH:mm` en hora de El Salvador. **Frontend-only, sin migración ni backend.** CSV validado por el owner en producción → [detalle](docs/HISTORIAL_FRENTES.md)

- **#351** ✅ — **ADMIN-DOCTOR-EXPORT-P0**: exportación CSV de la base de médicos desde `/admin/medicos`, solo para Owner Admin. `s7_78` (**migración 99**, aplicada antes del PR) crea `admin_export_doctors`, que **reutiliza `admin_list_doctors`** para el universo filtrado. 15 columnas, tope 10 000, auditoría no-PII. CSV validado por el owner en Preview y en producción → [detalle](docs/HISTORIAL_FRENTES.md)

- **#352** ✅ — **ADMIN-DOCTOR-EXPORT-URL-P0**: el CSV de médicos pasa de 15 a **17 columnas** con `Slug` y `URL pública`. `s7_79` (**migración 100**, aplicada antes del PR) añade **una sola clave** a la allowlist. La URL se llena **solo si hay slug Y el médico está publicado**; el dominio es constante literal, no el origen del navegador. CSV y URL real validados por el owner en producción → [detalle](docs/HISTORIAL_FRENTES.md)

- **DOCTOR-OWNER-NOTIFICATIONS-P0** 🟡 — aviso por correo al owner en afiliación
  y claim. `s7_80`/`s7_81`/`s7_82` **APPLIED**, Edge Function **ACTIVE v1**,
  **E2E real PASS** en ambos eventos. **PR abierto, sin mergear.** Detalle en el
  bloque de estado de arriba y en `docs/OWNER_S7_80_APPLY.md` →
  [detalle](docs/HISTORIAL_FRENTES.md)

**Secuencia prioritaria — TODA CERRADA. El piloto quedó en GO (2026-08-14):**
0. ~~**RECOVERY-EMAIL-P0 · ADMIN-JUNIOR · TESTPHONE-CLEANUP-P0**~~ — **✅ CLOSED (2026-08-13).** Recovery real por email PASS · login email+contraseña PASS · redirect a `/admin/medicos` PASS · permisos `operations_admin` acotados PASS · `50377507479` fuera de Test Phones con login posterior PASS · Home anónimo sin `my_lucyadmin_access` PASS. **No reabrir Auth/recovery salvo incidente nuevo.**
1. ~~**AUDIT-SEC-P0**~~ — **✅ CLOSED (2026-08-07).** `s7_71a` + `s7_71b` aplicadas y reconciliadas; `anon`/`authenticated` sin privilegios sobre `audit_log`; cero policies; `service_role` solo `SELECT`; `_admin_log_doctor_change` cerrado; escritor de frontend eliminado; continuidad demostrada. Detalle en `docs/OWNER_S7_71B_APPLY.md`.
2. ~~**TWILIO-P0**~~ — **✅ CLOSED / VALIDATED FOR PILOT (2026-08-11).** Supabase con **Twilio Verify** (SMS · 6 dígitos · Fraud Guard · solo El Salvador); sin cambios de código. QA: Test Phone PASS + un único SMS real (`Approved`, 1/1) con sesión válida y cero efectos colaterales; identidad QA temporal eliminada por Admin API. Detalle en el handoff vigente §3.4. **Safeguard de saldo cerrado el 2026-08-14** (saldo ~US$50, alerta US$25, Auto Recharge OFF por decisión).
3. ~~**LEGAL-P0**~~ — **✅ CLOSED (2026-08-13).** `/terminos` y `/privacidad` publicados con los documentos definitivos (#331) · `TOS_VERSION='tos-2026-08-13'` para nuevas aceptaciones del claim, sin exponer el identificador en la UI, y línea legal discreta en `BookingCard` con enlaces a ambos documentos (#332). Sin migración ni backend. **PR 3 / evidencia explícita del paciente = DIFERIDO, no requerido para el piloto.** Detalle en el handoff vigente §3.6.
4. ~~**Booking E2E real controlado**~~ — **✅ PASS (2026-08-14).** Cadena completa validada en producción con un único SMS real; ruta del grant demostrada por descarte; cleanup completo con cero residuos operativos; `otp_consent_events` y `audit_log` preservados. **No repetir.** Detalle en el handoff vigente §3.2.
5. ~~**Safeguard de saldo de Twilio**~~ — **✅ CLOSED (2026-08-14).** Ver el bloque de safeguard arriba.
6. ~~**Higiene final de perfiles QA publicados**~~ — **✅ CLOSED (2026-08-14).** Único perfil QA público despublicado; identidad conservada; 0 QA públicos restantes.
7. ~~**GO/NO-GO final**~~ — **✅ CLOSED (2026-08-14) = GO.** Cero FAIL bloqueantes.

**Pendientes registrados como frentes SEPARADOS — NO abrir sin instrucción:**
- **Tres funciones `_func` huérfanas** (`audit_consultations_func`, `audit_patients_func`, `audit_prescriptions_func`): `SECURITY DEFINER`, owner `postgres`, **no versionadas** y **sin trigger asociado**. Código muerto; no son vector (devuelven `trigger`).
- **Debt de `search_path`**: ocho funciones escritoras de `audit_log` sin `SET search_path` — las tres `_func` más `audit_clinic_invitations`, `audit_consultation_family_history`, `audit_consultations`, `audit_patients` y `audit_prescriptions`. Heredan el del caller; ya lo documentó `s7_66`.
- **`.gitignore` y `docs/rollbacks/`**: la regla `*.sql` (línea 32) solo exceptúa `!migrations/*.sql`, así que todo rollback nuevo requiere `git add -f` y puede quedarse fuera de un PR en silencio. Ocurrió en #321 y lo detectó la aserción de rastreo de `check-s7_71b`.
- **`check-s7_76` incompatible con CRLF en Windows — da `329/353`.** Deuda **PREEXISTENTE**, detectada durante `CRM-CSV-FECHAS-P0` (#350) y **demostrada A/B contra el archivo original**: da exactamente lo mismo sin ese cambio, así que **no es una regresión**. Causa: `core.autocrlf=true` deja los `.sql` con **CRLF** en el working tree y los regex del check anclan en `;\n`, que no casa con `;\r\n`. En git el blob está en **LF**. **No afecta a producción** —esas migraciones ya están aplicadas— y **no se corrigió**: es un frente aparte. **No tratarla como fallo de un PR nuevo.**

**Frente diferido con precondiciones (fuera del backlog no bloqueante):**
- **F1-c2 · DROP físico de `doctors.license_number`** (`docs/ANALISIS_CREDENCIALES_MEDICAS.md` §F1-c2) — irreversible. No abrir sin: sincronía fresca, respaldo, preflight `service_role` y autorización del owner. **F1-c1 (retiro lógico) ya está cerrado** en #295/#296 (`s7_63`/`s7_64`).

**Backlog no bloqueante del piloto — no abrir sin instrucción del owner.
Detalle completo en el handoff vigente §6:**
- (1) ~~**Traducir al español los errores de contraseña**~~ — **✅ CLOSED (2026-08-20, PASSWORD-ERROR-COPY-P0, #342 + #343).** `src/lib/passwordErrors.ts` es la fuente única del copy: clasifica por `error.code` → HTTP status → `error.message` **solo como fallback de clasificación**, y el texto del proveedor **nunca se muestra**. `same_password` quedó separado de `weak_password`. `/reset-password` en español y tuteo, con `link` → `enlace`.
- (2) ~~**`NotificationBell`**~~ — **✅ CLOSED (2026-08-20, NOTIFICATION-BELL-A11Y-P0, #344).** Escape cierra y devuelve el foco, `aria-expanded` + `aria-controls`, contador en el nombre accesible y `useId()` para que las dos instancias (móvil/desktop) no compartan id. Sin focus trap ni `role="menu"` artificial. **Quedan dos deudas menores registradas:** `setTimeout(markAllAsRead, 800)` sin cleanup y las dos suscripciones paralelas de `usePanelNotifications`.
- (3) Correo verificado como canal secundario de recuperación (el teléfono sigue siendo la identidad principal).
- (4) **Acceso "Planes y facturación"** hacia `medicos.lucycare.app` — **PR #323 CERRADO SIN MERGE** (2026-08-07): el destino sigue siendo **demostrativo** y **no** es todavía sistema autoritativo de cobro. **El CTA NO está publicado** y se recrea en **BILLING-P3**, no antes. Detalle en `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` §18.
- (5) Entregabilidad de correo (SPF/DKIM/DMARC + plantilla de Supabase/Resend).
- (6) Razón genérica "Otro motivo" en `cancel_reasons` (tabla no versionada en `migrations/`).
- (7) Revisión de `cancel_reasons` como tabla legacy — entrar por migración versionada.
- (8) UX del widget de Turnstile en móvil — mejora cosmética, no bloqueante.
- (9) ~~**Auto Recharge / alerta de saldo de Twilio**~~ — **✅ RESUELTO (2026-08-14).** Saldo recargado a ~US$50, Balance notification en US$25, **Auto Recharge OFF por decisión deliberada del piloto** (no es deuda). Reevaluar Auto Recharge si el consumo mensual crece o si entran usuarios sin supervisión. **Vigilancia de saldo = tarea operativa viva durante el piloto.**
- (10) **Admin API `listUsers` no enumera todo el padrón** — falla con `Database error finding users` de forma persistente en la cola del listado (~15 de ~140 usuarios ilegibles) y `GET /auth/v1/admin/users?filter=` **no filtra por teléfono** (devuelve 0 incluso para números que existen → falsos limpios). **No afecta el runtime de Auth**, solo scripts de administración. Para buscar un teléfono, el camino fiable es la búsqueda del Dashboard.
- (11) **Seguimiento SEO / Search Console** — el perfil QA estuvo publicado e indexable antes de despublicarse; ya sirve `noindex,follow` y saldrá del índice al próximo rastreo. "Eliminación de URLs" en Search Console lo acelera. No bloqueante.

## Decisiones cerradas (NO reabrir)

### Stack
- Backend: Supabase (Postgres + Auth + Edge Functions + Storage).
- Frontend: React 19 + TypeScript + Tailwind + Vite + React Query.
- Pagos: **proveedor NO elegido** — la elección es parte de **BILLING-P0**
  (PAUSADO). "Stripe Checkout hosted" fue una decisión tentativa **reabierta**;
  no comprometer ninguna pasarela sin la grilla de
  `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` §15 y la validación fiscal.
- **Billing NO controla `doctors.is_operational`.** El estado comercial vive en
  una entidad separada (`billing_account` → `subscription` → entitlements);
  `is_operational` sigue siendo el flag administrativo de LucyAdmin.
- Hosting: Vercel + Supabase.
- Facturación DTE: diferida (API externa, no se desarrolla internamente).

### Modelo de datos / dominio
- Citas: una sola tabla `appointments` con campo `source`.
- Consulta clínica: guardar = borrador, firmar = inmutable.
- Servicios, diagnósticos, medicamentos: catálogos per-doctor (no globales, no CIE-10).
- Rol secretaria/asistente: incluido (agenda sí, ficha clínica no).
- Single-tenant operativo, **diseño tenant-ready** (conservar `clinic_id` siempre).
- **Modelo de paciente global (firmado en `docs/ANALISIS_PACIENTE_GLOBAL.md`):**
  - DA1: identidad global vive en `profiles` extendido. `patients` sigue como ficha por clínica.
  - DA2: vinculación retroactiva automática **solo** con phone OTP-verified.
  - DA3: walk-in editable libremente hasta reclamo.
  - DA4: "Mis atenciones" muestra la clínica.

### Auth
- OTP por SMS con Twilio para todos (paciente, médico, asistente, admin).
- Email + password como **segunda opción** para médico/admin (PR #39 ✅).
- Reset de password por email (PR #39 ✅).
- Activación de password dentro del flujo de Reclamar perfil (PR #50 ✅ — paso obligatorio post-claim con dos caminos: crear ahora / recibir link por email).
- **Ningún flujo público crea médicos `claimed` automáticamente** (PR #53 cerró esa puerta). Quien quiera afiliarse llena el formulario `/admin/afiliaciones` (PR #56 Fase 1) → LucyAdmin valida → en Fase 2 crea el `doctors` row como `listed_only` → médico hace el reclamo estándar (PR #32 + PR #50).
- **Afiliación Fase 1** (PR #56): captura de leads en `doctor_affiliation_requests` con bandeja admin para triage.
- **Afiliación Fase 2** (PR #58 + migraciones s7_22 y s7_23): RPC `admin_approve_and_create_doctor(p_request_id, p_overrides)` que en una transacción crea `auth.users` dormant + `profile` + `clinics` + `clinic_members` (owner) + `doctors` en `lucy_status='listed_only'` con flags conservadores (`is_published=false`, `is_operational=false`, `booking_enabled=false`). Email override solo aceptado si el lead no trajo email (regla server-side en s7_23). UI: botón "Crear médico" en `AdminAffiliationDetailModal` con form de overrides + pantalla éxito con link a ficha admin (no perfil público — el doctor no está publicado). El médico creado entra al flujo de Reclamar perfil estándar (PR #32 + #50) sin código nuevo del lado del médico.
- **Afiliación — médico desde paciente existente** (PR #122, `s7_42`): si el teléfono del lead ya pertenece a un `auth.user` (típico: ya es paciente), `admin_approve_and_create_doctor` ya **no** crashea con `users_phone_key`. Clasifica (`_affiliation_classify` + preflight `admin_affiliation_preflight`) y ramifica: **`reuse_patient`** → reusa el profile del paciente (sin crear otro `auth.user`), crea clinic/doctor sobre ese profile, **completa `full_name` solo si está vacío**, y **NO toca phone/email/role** (decisión cerrada: el email del lead **no** se copia automáticamente; se completa/valida en el reclamo). Requiere confirmación explícita (`confirm_reuse`, si no → `P0013`). Casos sensibles/duplicados **bloqueados**: `P0010` (ya es médico, con link a ficha), `P0011` (rol sensible/membresía o `auth.user` sin profile → revisión manual), `P0012` (email de otra cuenta / identidad ambigua). El médico creado por reuse igual nace `listed_only`/no publicado/no operativo/no verified y reclama con OTP+licencia+TOS. **Aprendizaje (Katherine):** los doctores creados ANTES de `s7_42` sobre un paciente con `full_name=''` quedaron "(sin nombre)"; se corrigen puntualmente desde la ficha admin (no se auto-arreglan al reemplazar la RPC).

### Ejes del médico (independientes)
- `lucy_status` enum: `listed_only | claimed | booking_enabled | verified`.
- `is_published`: aparece en directorio.
- `is_operational`: gate del panel (operar agenda).
- `booking_enabled`: muestra reserva en línea.
- `is_verified`: GENERATED de `lucy_status='verified'`. No editable a mano.
- **Regla clave del PR #41:** `is_published` ya **NO** exige `is_operational` para directorio. Solo controla visibilidad. Esto habilita médicos informativos.

### Directorio informativo (firmado en `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md`)
- D1: completitud mínima — full_name + specialty + clinic.name + address.
- D2: pill "Agenda en línea" / "Sin agenda en línea". Copy ES (sin "booking", "online", "onboarding" en UI pública).
- D3: waitlist idempotente con UNIQUE(doctor_id, phone_norm).
- D4: notificación manual desde admin (sin SMS auto, sin Edge Functions).

### Seguridad
- RLS en todas las tablas, audit_log inmutable.
- `service_role` solo en scripts admin via `.env.local` (NO en frontend).
- `profiles` con RLS columna-level (anon solo (id, full_name, avatar_url) de publicados).
- Modales sensibles (LoginModal, ClaimProfileModal, WaitlistModal) NO cierran al click outside.

## Stack técnico verificado

- Imports usan alias `@/` (ej: `@/lib/supabase`).
- Auth usa `supabase.auth.getSession()` con timeout duro en `src/lib/session.ts` (a prueba del lock interno de supabase-js).
- React Query: `refetchInterval 30s` para citas, `60s` para notificaciones, `staleTime` variable.
- Iconos Remix (`ri-*`) en PanelLayout, SVG inline en componentes nuevos.
- Color acento del panel: emerald.
- Cliente Supabase con **lock no-op** (`src/lib/supabase.ts`) — evita pantallas blancas por locks huérfanos de navigator.locks.
- Bootstrap defensivo en `main.tsx`: valida sesión con timeout 3s antes de renderizar (PR #33).
- División territorial El Salvador 2024 cargada: `municipalities.name` = distrito (antiguo municipio), `municipalities.district` = nuevo municipio agrupador.
- Helpers compartidos:
  - `src/lib/phone.ts` — `normalizePhoneSV`.
  - `src/lib/document.ts` — `validateDocument`, `sanitizeDuiInput`, `formatDuiDisplay`.
  - `src/lib/errors.ts` — `friendlyErrorMessage`.
  - `src/lib/session.ts` — `getSessionWithTimeout` con `Promise.race`.

## Sistema de diseño (Sprint 4 — vinculante)

Establecido al notar inconsistencias acumuladas. **Toda pantalla nueva debe seguir esto. Páginas de referencia: `/panel/catalogos` y `/panel/servicios`.**

### Colores semánticos

- `emerald` → acción primaria, estado positivo (consulta firmada, paciente atendido).
- `blue` → información neutra, badges secundarios (asistente, permanente).
- `amber` → advertencia / borrador / validación inline.
- `red` → destructivo / cancelado / no asistió / errores.
- `gray` → neutro, fondos, texto secundario.

### Spacing y radius

- **Cards principales**: `bg-white rounded-2xl border border-gray-200 p-5`.
- **Sub-items dentro de cards** (filas de lista, items en form): `bg-gray-50 rounded-lg p-3`.
- **Inputs y selects**: `border border-gray-200 rounded-lg px-3 py-2 text-sm`.
- **Pills/badges**: `rounded-full px-2.5 py-0.5 text-xs font-medium`.
- **Modales**: `rounded-2xl shadow-xl p-6`.
- Gap consistente: `gap-3` para grupos relacionados, `gap-5` entre secciones.

### Botones — usar `<Button>` de `src/components/ui/Button.tsx`

4 variants: `primary` (emerald solid), `secondary` (gray solid), `subtle` (emerald soft pill), `danger` (red solid).
3 sizes: `sm`, `md`, `lg`.

### Copy en español (vinculante en UI pública)

- "Agenda en línea" (NO "online booking" / "agenda online").
- "Sin agenda en línea" (NO "no operativo" / "booking disabled").
- "Lista de espera" (NO "waitlist").
- "Reserva en línea" (NO "online booking").

### Patrones de modal

- **NO cerrar al click outside** en modales con form (LoginModal, ClaimProfileModal, WaitlistModal).
- Cerrar solo por: botón X, Escape, o éxito.
- Botón X disabled durante loading.
- `useEffect` con listeners siempre **antes** de cualquier `return null` por estado.

## Patrones de infraestructura (vinculantes)

### Cliente Supabase
- `src/lib/supabase.ts` con `lock: noopLock` (PR #33).
- NUNCA exponer `service_role` en frontend.
- Scripts admin: `import { supabaseAdmin } from './_lib/supabase-admin.mjs'` (lee de `.env.local`).

### useClinicContext (`src/hooks/useClinicContext.ts`)
Hook unificado que devuelve `{ profileId, role, clinicId, doctorId, doctorName, doctorIsOperational, availableDoctors }` para doctor o asistente. **Toda página del panel debe usarlo** — NO hacer lookup inline a `from('doctors')`. **Lee identidad con `getSession()`** (no `getUser()`; PR #116) para alinear con `getCurrentAuthUser` y evitar el race de primera carga. Lanza `ClinicContextError` tipado (`kind`: `auth`/`no_clinic`/`no_doctor`/`role`/`unknown`); la query **no reintenta** errores estructurales. Helpers exportados: `contextErrorKind`, `isStructuralContextError`.

### Audit log
- `src/services/auditLog.service.ts` con `logAuditEntry()` — no bloquea si falla.
- Schema: `audit_log` action ENUM ('select','insert','update','delete') — siempre minúsculas.
- Triggers de audit en: `consultations`, `patients`, `prescriptions`, `consultation_family_history`, `clinic_invitations`, `profiles.avatar_url`, `reviews` (s7_15), `waitlist_entries` (s7_18).
- Las RPCs admin (`admin_*`) escriben audit_log directamente en su cuerpo, con `edited_via: 'admin'` en `new_data`.
- RPCs especiales (claim, waitlist, paciente global) auditan con `edited_via` distintivo.

### Notificaciones del panel
- NO usa la tabla `notifications` (esa es para SMS/email salientes, futuro).
- Se derivan de `appointments` en `src/services/panelNotifications.service.ts`.
- Read/unread con timestamp en `localStorage`.

### Cuenta demo oficial — Dr. Camilo Carrillo / Pepe Toro

Detallada en `docs/CUENTA_DEMO_CAMILO.md`. NO incluir en limpiezas de seed.

| Campo | Valor |
|---|---|
| `profile_id` | `db1fba98-a299-4f25-82f1-7feff01e58fa` |
| `doctor_id` | `783a902a-55fd-407c-9e0a-69568135c7f5` |
| Phone (Test Phone) | `50378056365` — **cambió en el swap del 2026-08-12**. El OTP **no se documenta** |
| Email | `carlosmartinezddv@gmail.com` |

Estado: `lucy_status='verified'`, `is_published=true`, `is_operational=true`, `booking_enabled=true`. Con servicios, availability, ~50 appointments, ~15 consultations.

### Test Phones configurados

> ⚠️ **Los OTP fijos NO se documentan en el repositorio.** Viven solo en el
> Dashboard de Supabase, en poder del owner. Estado tras TESTPHONE-CLEANUP-P0
> (**2026-08-13**): **objetivo final alcanzado — exactamente 2**.

| Phone | Uso | Estado |
|---|---|---|
| `50378056365` | **Camilo** (médico demo) — recibió este número en el swap | **KEEP** |
| `50378626108` | Paciente QA | **KEEP** |
| `50377507479` | `operations_admin` (Josué) | **FUERA (2026-08-13)** — accede por email+contraseña |
| `50378627694` | **LucyAdmin** — su teléfono real, con SMS por Twilio Verify | **FUERA — nunca reponer** |

Los demás (`50375000001`, `50375000099`, `50376193396`, `50370007201`,
`50370008803`, `50378873634`, `50378590126`) fueron **retirados de Test Phones**
el 2026-08-12. **Retirarlos no eliminó identidades ni datos** — es configuración
de GoTrue, no identidad. Consecuencia vigente: un número fuera de la lista que
intente OTP por teléfono consume **SMS real de Twilio Verify** (ver backlog #9,
Auto Recharge).

## Sprints completados

### Sprint 1-2 ✅
Directorio público + booking público con OTP + panel médico básico (disponibilidad, bloqueos).

### Sprint 3 ✅
Panel del médico: calendario 3 vistas, marcar estado + audit log, walk-in, pacientes, perfil público editable, rol asistente.

### Sprint 4 ✅
MVP de consulta clínica firmable e imprimible. Sistema de diseño documentado.

### Sprint 5 ✅
Antecedentes familiares, plan de seguimiento inline, estados de diagnóstico expandidos, Mi equipo, multi-doctor selector para asistente, paginación admin catálogos.

### Sprint 6 — Reputación médica ✅ (PRs #2–#10)
Encuesta post-cita con token único, NPS, score público ajustado bayesianamente, badges, comentarios anónimos, trazabilidad admin.

### Sprint 7 — Admin SaaS + Robustez ✅ (PRs #16–#30)
Admin SaaS completo (dashboard, listado, edición perfil/clínica/info/servicios). Robustez pacientes (document_number nullable, dedup teléfono, normalización SV, validación DUI).

### Pre-piloto — Bloqueantes cerrados ✅ (PRs #32–#58)
- **Reclamo seguro** (PR #32, s7_13).
- **Estabilización supabase-js lock** (PR #33).
- **Foto de perfil** (PR #34, s7_14).
- **Security Gate audit + trigger reviews** (PR #35, s7_15).
- **Rotar service_role + ENV vars** (PR #36).
- **RLS hardening profiles** (PR #37, s7_16, s7_16b).
- **Desactivar seed *.lucycare.test** (PR #38, s7_17).
- **Auth email + password + reset por email** (PR #39, Fase 4 PR-A).
- **LoginModal no cierra al click outside** (PR #40).
- **Directorio informativo + copy ES** (PR #41).
- **Análisis paciente global + decisiones** (PR #42).
- **Lista de espera real + badge admin** (PR #43, s7_18, s7_19).
- **Paciente Global Fase 1** (PR #44, s7_20).
- **SMTP externo Resend + reset por email validado** (PR #46, doc + setup operativo 2026-05-26, dominio `lucycare.app`).
- **Dominio público `lucycare.app` live en Vercel** (PR #48, setup operativo 2026-05-26, DNS en Cloudflare, www→apex 308, Supabase Site URL + reset email validados).
- **Password en flujo de Reclamar perfil** (PR #50, Fase 4 PR-B — step obligatorio post-claim, dos caminos: crear ahora / recibir link por email; copy "Perfil reclamado" diferenciado de "Cuenta suspendida"; sin migración).
- **Análisis del flujo "Solicitar afiliación"** (PR #52, `docs/ANALISIS_AFILIACION_MEDICO.md` — 10 secciones, 10 preguntas de decisión pendientes Q1-Q10).
- **Mitigación flujo "Soy médico"** (PR #53) — DoctorInterestModal temporal, legacy marcado deprecated.
- **Afiliación Fase 1** (PR #56, `s7_21`) — captura de leads, bandeja admin triage.
- **Afiliación Fase 2** (PR #58, `s7_22`+`s7_23`) — `admin_approve_and_create_doctor`, smoke e2e validado (PR #61, `s7_24`).

## Próximas fases (post-piloto)

> El backlog vigente está más arriba, en una sola sección. Aquí quedan
> las fases de horizonte largo. Detalle histórico de fases cerradas en
> `docs/HISTORIAL_FRENTES.md`.

### Fase 4 — Auth robusta del médico
- ✅ PR-A (PR #39): login email/password + reset por email.
- ✅ PR-B (PR #50): password en flujo de Reclamar perfil.
- Post-piloto: Fase 2 self-service cambio email/teléfono · Fase 3 2FA opcional. Ver `docs/ANALISIS_AUTH_MEDICO.md`.

### Directorio (follow-ups pendientes)
- Sección "Lista de espera" en panel del médico (RLS ya permite, falta UI).
- Rate limit fuerte para tráfico público real (Cloudflare o counter por IP).
- Notificación automática al activar `booking_enabled` (Edge Function + Twilio).

### Admin SaaS restantes (post-piloto)
- B4: disponibilidad/horarios desde admin.
- C: suspender pacientes/asistentes.
- D: dashboard tracción mensual.
- E: UI sobre `admin_review_traceability` + moderar reseñas.
- F: explorador de `audit_log` con filtros.
- G: catálogos globales + onboarding manual de médico.

### Otros pendientes conocidos
- **Verificación reforzada de "Sí, son mías"** — evaluar después pedir dato adicional de la ficha.
- **Términos/onboarding del paciente** — aceptación de que solo puede confirmar atenciones propias.
- **Identidad múltiple Fase 2** — selector "modo paciente / modo médico". Ver `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md`.
- **⚠ OPERATIVO — registro de Katherine (`50372608827`):** decidir conservar/corregir/limpiar solo con autorización del owner.
- S5-01 Estilo de vida · S5-08 SMS automático al invitar asistente · Vista `/panel/consultas` global · Borradores pendientes en panel home · Vistas históricas laboratorios/PDFs · Reportes/estadísticas médico · Extraer modales legacy a `src/components/`.

## Deudas técnicas conocidas (priorizadas)

1. ~~**Asistente puede firmar consulta**~~ → ✅ cerrado PR #67 (`s7_26`). Ver `docs/HISTORIAL_FRENTES.md`.
2. ~~**Inmutabilidad + corrección controlada de consultas firmadas**~~ → ✅ eje completo PRs #74–#85 (`s7_28`–`s7_31`). Ver `docs/HISTORIAL_FRENTES.md`.
3. **Inconsistencia visual** pantallas legacy — no usan `<Button>` reusable.
4. **Sin sistema global de toasts** — `friendlyErrorMessage` ayuda, pero algunos flujos sin feedback.
5. **Print de receta minimalista** — sin logo de clínica, sin QR.
6. **No hay vista `/panel/consultas`** — solo se accede via cita o paciente.
7. **WaitlistModal** — click-outside-cierra (legacy); hardening pendiente cuando se toque.

## Datos en DB (snapshot 2026-05-27)

- ~113 doctores totales. 5 publicados (4 informativos + 1 con agenda en línea).
- 12 seed `*.lucycare.test` desactivados (`is_active=false`).
- 14 departments, 262 municipalities con `district` (división 2024).
- 20+ especialidades.
- 10 cancel_reasons pre-cargadas.
- ~1651 diagnósticos + ~9568 medicamentos en catálogos per-doctor.
- ~22 pacientes en `patients`. Mismo phone puede aparecer en N clínicas (modelo legacy tenant-aware, en proceso de evolución a global — Fase 1 lo vincula vía profile_id).
- ~54 appointments, ~15 consultations.
- waitlist_entries: tabla activa.

## Migraciones SQL aplicadas

Todas corridas en Supabase. Cada `s6_*`/`s7_*` con `check-*.mjs` cuando aplica.

**Sprint 4-5:** `s4_01..s4_02`, `s5_01..s5_07`.

**Sprint 6 (reputación):** `s6_01..s6_10`.

**Sprint 7 (admin + robustez):**
- `s7_01` admin foundation.
- `s7_02` admin doctors.
- `s7_03` is_verified GENERATED.
- `s7_04` admin search/paginate.
- `s7_05` admin edit doctor.
- `s7_06` fix clinic update.
- `s7_07` clinics updated_at.
- `s7_08` services delete policy.
- `s7_09` block inactive service.
- `s7_10` patient document nullable.
- `s7_11` normalize patient phone.
- `s7_12` admin services RPCs.

**Pre-piloto (PRs #32+):**
- `s7_13` reclamo seguro — RPC `claim_doctor_profile`.
- `s7_14` foto de perfil — bucket avatars + RLS + RPC admin + trigger audit.
- `s7_15` audit log trigger para reviews.
- `s7_16` + `s7_16b` RLS hardening de profiles (column-level + drop policies legacy).
- `s7_17` desactivación seed `*.lucycare.test`.
- `s7_18` waitlist_entries — tabla + RPC público + RPCs admin + triggers audit.
- `s7_19` bulk count waitlist por doctor.
- `s7_20` Paciente Global Fase 1 — RPC `claim_patient_records` + policies SELECT-self.
- `s7_21`–`s7_24` afiliación F1+F2 + fix smoke.
- `s7_25` ubicación estructurada (depto/muni en `clinics`).
- `s7_26` gate clínico del rol asistente (doctor-scoped RLS).
- `s7_27` Mi equipo límite de asistentes.
- `s7_28`–`s7_31` correcciones post-firma (inmutabilidad A + corrección B1 + affects_prescriptions + diag/antecedentes/vitales).
- `s7_32`–`s7_35` Paciente Global F2+F3+F5 (identidad global, sync espejo, dedup preventivo).
- `s7_34` sync cambio de teléfono por OTP.
- `s7_36` Mi equipo Fase 2 (TTL invitaciones, resend).
- `s7_37`–`s7_39` Catálogos global+personal+infra dedup.
- `s7_40` F5 tolerante a teléfono crudo.
- `s7_41` lista de espera global cross-médicos.
- `s7_42` afiliación desde paciente existente.
- `s7_43` confirmación post-claim (B2) + `patient_link_rejections`.
- `s7_44` administración LucyAdmins Fase 1.
- `s7_45`–`s7_49` Paciente Global F4: merge+unmerge+F4-3b.
- `s7_50` `accept_clinic_invitations` tolerante a formato de teléfono.
- `s7_51` lista de espera en panel médico/asistente.
- `s7_52` Slugs (columna `doctors.slug` + trigger + backfill).
- `s7_53`–`s7_54` Analytics conversión + Analytics Farma (RPCs admin read-only).
- `s7_55` trigger anti-solapamiento de citas (P0090).
- `s7_56` índices de soporte para Analytics/Farma.
- `s7_57` niveles de acceso LucyAdmin (`directory_editor`, `operations_admin`).
- `s7_58`–`s7_59` corrección post-firma receta (F6: pattern presencia-de-clave; F7: alternatives).
- `s7_60` hardening de grants sobre `public.doctors`.
- `s7_61`–`s7_62` `doctor_credentials` F1-a (modelo) + F1-b (cutover lectores).
- `s7_63`–`s7_64` F1-c1 cutover lógico (approve escribe credencial, frontend sin fallback).
- `s7_65`–`s7_69` eje Auth: Before User Created Hook, contraseña obligatoria OTP, consentimiento OTP append-only.
- `s7_70` cancelación por el paciente (hardening de appointments).
- `s7_71a`–`s7_71b` AUDIT-SEC-P0: cobertura server-side de `appointments` y cierre de la escritura arbitraria sobre `audit_log`.
- `s7_82` DOCTOR-OWNER-NOTIFICATIONS-P0 (**migración 103**): despertador propio.
  Trigger `trg_notify_owner_wakeup` `AFTER INSERT FOR EACH ROW` sobre la outbox
  que llama **`net.http_post`** directamente — sin el esqueleto
  `supabase_functions`, que este proyecto no tiene. El secreto se lee de
  **Vault** por nombre en runtime; no está en la migración, ni en los
  argumentos del trigger, ni en `pg_get_triggerdef()`. Best-effort: bloque
  `EXCEPTION WHEN OTHERS` con WARNING de **SQLSTATE, nunca `SQLERRM`** (podría
  arrastrar el secreto desde los argumentos), y `RETURN NEW`. Timeout 5000 ms,
  payload `{}`, POST únicamente, `SECURITY DEFINER`, `search_path` fijo,
  `EXECUTE` revocado a los cuatro roles. El PRE aborta sin `pg_net`, sin Vault,
  si el secreto no está **exactamente una vez**, si `s7_82` ya está aplicada, o
  si la outbox tiene **cualquier** trigger previo — toda webhook es un trigger,
  y otro más produciría doble wakeup.
- `s7_81` DOCTOR-OWNER-NOTIFICATIONS-P0 (**migración 102**): el aviso de claim
  representa el EVENTO, no el presente. `CREATE OR REPLACE` de
  `notify_owner_claim_batch` con **exactamente tres cambios**, demostrados por
  A/B: el CTE devuelve `subject_profile_id`, el nombre sale de
  `profiles p ON p.id = c.subject_profile_id` (el perfil **del evento**, no el
  actual del médico) y `lucy_status` del claim es el literal **`'claimed'`**.
  Sin esto, un admin que moviera `profile_id` o revirtiera `lucy_status` entre
  el encolado y el envío produciría un correo que se contradice a sí mismo. La
  **especialidad** se sigue leyendo del médico actual, deliberadamente: es
  atributo del profesional, no del claim.
- `s7_80` DOCTOR-OWNER-NOTIFICATIONS-P0 (**migración 101**): outbox
  `doctor_owner_notifications` (RLS, sin DML de cliente, `service_role`
  SELECT-only), helper `_enqueue_doctor_owner_notification` best-effort, trigger
  `AFTER INSERT` sobre `doctor_affiliation_requests`, encolado dentro de
  `claim_doctor_profile` (cuerpo verbatim de `s7_64` + un bloque sentinelado,
  verificado por A/B) y las dos RPCs del procesador —
  `notify_owner_claim_batch` (drenado atómico con `FOR UPDATE SKIP LOCKED`,
  ventana de idempotencia de **23 h** con techo por `LEAST`, estado
  `needs_reconciliation` fuera de ventana) y `notify_owner_mark_result`
  (`P0150`). Allowlist de campos **en la base**: sin licencia/JVPM, DUI,
  direcciones, texto libre del lead ni datos clínicos. Sin PII en la outbox.
- `s7_79` ADMIN-DOCTOR-EXPORT-URL-P0: `CREATE OR REPLACE` de
  `admin_export_doctors` que añade **una sola clave** a la allowlist,
  `'slug', d.slug`. Sin JOIN nuevo —`doctors` ya estaba unido— y sin cambio en
  el plan de ejecución. Conserva firma, `SECURITY DEFINER`, `VOLATILE`,
  `search_path`, grants de los cuatro roles, gate, tope 10 000, orden dentro de
  `jsonb_agg` y la auditoría, verificado con A/B contra `s7_78`. **No genera
  slugs** ni construye la URL: eso es presentación y vive en el frontend.
- `s7_78` ADMIN-DOCTOR-EXPORT-P0: RPC `admin_export_doctors` (`SECURITY
  DEFINER`, `VOLATILE`, gate `is_admin()`/`P0140`, solo `csv`/`P0142`, tope
  10 000/`P0146`). **Reutiliza `admin_list_doctors`** para el universo filtrado
  y enriquece por `id`; ordena **dentro de `jsonb_agg`** por `created_at DESC,
  id`. Privilegios explícitos: `REVOKE` de `PUBLIC`, `anon` y `service_role`,
  `GRANT` solo a `authenticated`. Auditoría **no-PII**. No crea tablas ni altera
  nada existente.
- `s7_76`–`s7_77` PATIENT-CRM-P0: fundación de datos del CRM (4 tablas, RLS,
  índices, auditoría) y RPCs de lectura (vista canónica de identidad, listado
  paginado, pendientes de identificar, métricas y exportación CSV auditada).
- `s7_72` RATING-URL-P0: helper `_review_short_code()` (20 caracteres Crockford Base32, 100 bits) y token corto en `generate_review_token()`. Sin backfill; los enlaces de 64 caracteres siguen válidos hasta vencer.

> Detalle completo de cada migración en `docs/HISTORIAL_FRENTES.md`.

## Scripts utilitarios (`/scripts/`)

**Setup** (cada máquina, una vez):
- Copiar `.env.local.example` → `.env.local` con `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Los scripts leen de ahí automáticamente vía `scripts/_lib/env.mjs`.

**Helpers compartidos:**
- `scripts/_lib/env.mjs` — carga `.env.local`.
- `scripts/_lib/supabase-admin.mjs` — cliente service_role.
- `scripts/_lib/supabase-anon.mjs` — cliente anon.

**Comandos típicos:**
- `node scripts/check-s7_NN.mjs` — verifica una migración (NN del 13 al 20).
- `node scripts/import-doctors.mjs --file ... --apply` — importador idempotente.
- `node scripts/_deactivate-demos.mjs` — desactiva demos, preserva Camilo.
- `node scripts/setup-test-patient.mjs --apply|--reset|--clean` — datos de prueba paciente global.
- `node scripts/check-patient-documents.mjs` — diagnóstico DUIs.

`scripts/README.md` tiene la guía completa.

## Cómo crear una asistente

Desde `/panel/equipo` → "Invitar asistente" → teléfono → la asistente se loguea con OTP y queda activa automáticamente vía RPC `accept_clinic_invitations`. SMS automático al invitar **no está implementado** (S5-08, en backlog).

## Reglas operativas (VINCULANTES)

- **Un solo frente a la vez.**
- **No abrir PR sin autorización** del owner; **no mergear sin su OK explícito**.
- **No tocar DB / SQL / migraciones / `auth.users`** sin autorización. **El owner
  aplica el SQL** en el SQL Editor de Supabase; el dev corre los `check`/`smoke`.
- **`service_role` requiere autorización explícita del owner, INCLUSO read-only.**
  Si una tarea lo necesita (p. ej. un inventario global que la RLS no deja leer),
  **plantearlo y esperar el OK** antes de ejecutar.
- **Datos de validación: jamás Katherine (`50372608827`)** ni datos reales
  sensibles (ni en read-only). **Camilo solo como demo controlado** — su Test
  Phone es `50378056365` desde el swap del 2026-08-12; **el OTP no se documenta**.
- **Fixtures: propias, creadas desde cero, marcadas** (p. ej. `F6_FIXTURE`),
  **limpiadas al final** con **verificación de 0 residuales**. Si la prueba crea
  algo **irreversible** (p. ej. una **adenda** de corrección post-firma), **NO
  usar el paciente demo** — crear paciente/cita/consulta propios.
- **PR que toca DB → migración + `check-s7_NN.mjs` + `_smoke-s7_NN.mjs`.**
- **Para cambios de UI:** pedir **preview / OK visual** del owner antes de mergear.
- **No mezclar** SEO / Analytics / Auth / Clínico / DB en un mismo PR.
- **No tocar el stash viejo** `stash@{0}: WIP on claude/admin-fase-a` (ni borrar,
  ni aplicar, ni inspeccionar) **salvo autorización explícita**.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones, `main==origin/main`,
  `git status` vacío, rama borrada local+remoto, 0 PRs abiertos, sin residuos
  (preview / servers / fixtures / scripts / ZIPs).
- **Validar el instrumento, no solo el fix:** correr la misma medición contra el
  código/RPC **anterior** para comprobar que el bug se reproduce (A/B). Un test
  que solo pasa "después" no prueba nada.

## Cómo arrancar en un nuevo chat de Claude Code

1. Sincronizar repo + leer este archivo + los docs oficiales del objetivo de hoy.
2. `git log --oneline -10` para ver el último estado.
3. NO asumir nada — leer el código antes de tocarlo.
4. Decisión grande sin consultar = problema. Cuestionar suposiciones.
5. Seguir el sistema de diseño documentado arriba para toda pantalla nueva.
6. Si el objetivo es algo ya analizado (auth, reclamo, paciente global, directorio), leer el `docs/ANALISIS_*.md` correspondiente — **no re-analizar**.
7. Mantener branches con nombres cortos (`claude/<8-12 chars>`) para que Vercel no las trunque.

## Plantilla para arrancar una sesión nueva

```
Continuamos LucyCare.

git fetch origin && git checkout main && git pull --ff-only
git log --oneline -10

Leé en este orden:
1. CLAUDE.md
2. docs/HANDOFF_LUCYCARE_SPRINT7.md
3. [docs/ANALISIS_*.md o docs/FASE_*.md según objetivo de hoy]

Estado: PRs #1–#77 mergeados (HEAD 611acf8), migraciones hasta s7_29 (aplicadas en Supabase). SMTP Resend + dominio `lucycare.app` + Fase 4 PR-B ✅. Afiliación Fase 1+2 + smoke ✅. Ubicación estructurada admin ✅ (PR #64). Gate clínico asistente ✅ (PR #67). Mi equipo Fase 1 límite 2 asistentes ✅ (PR #70). Correcciones post-firma: análisis (#72) + plan (#73) + **Etapa A inmutabilidad ✅ (#74, `s7_28`) + Etapa B1 corrección controlada ✅ (#76, `s7_29`)** → ⏳ B1.5 (diag/antecedentes/vitales), B2 (UI), B3 (impresión receta corregida). Análisis pagos SaaS ✅ doc base (PR #62).

Hoy hacemos: ___[opciones en cola (smoke afiliación ya cerrado):
                   - análisis de pagos SaaS autoservicio;
                   - vista global /admin/lista-espera cross-médicos;
                   - Paciente Global Fase 2 (DUI/DOB/dpto/muni);
                   - DUI + TOS del médico pre-verificación (PLAN_AFILIACION §11.bis);
                   - ubicación estructurada Depto/Muni en ficha admin del médico;
                   - Admin SaaS B4 (disponibilidad desde admin);
                   - smoke 7.3 opcional capacidad SMTP;
                   - etc.]___
```

## Documentos fuente originales (en raíz)

- `LucyCare_Schema_DB.docx`
- `LucyCare_Backlog_Estrategico.docx`
- `LucyCare_DocTecnico_Completo.docx`
- `Notas_Sprint3.docx`
