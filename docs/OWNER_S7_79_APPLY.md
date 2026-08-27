# `s7_79` — guía de aplicación para el owner

> **Frente:** `ADMIN-DOCTOR-EXPORT-URL-P0`
> **Migración:** `migrations/s7_79_admin_doctor_export_slug.sql` — sería la **100**
> **Estado:** **PREPARADA, NO APLICADA.**

---

## 0 · Qué hace

`CREATE OR REPLACE` de **`admin_export_doctors`** para añadir **una sola clave** a
la allowlist: `'slug', d.slug`. El CSV pasa de **15 a 17 columnas** — `Slug` y
`URL pública`.

**No crea nada, no altera tablas, no migra datos.** No hay JOIN nuevo: `doctors d`
ya estaba unido para llegar a `profile_id` y `clinic_id`, así que **el plan de
ejecución no cambia**.

> ### ⚠️ `s7_78` no se modifica ni se reaplica.
> Es el registro de lo que se ejecutó el 2026-08-26 y se queda como está.

**`admin_list_doctors` tampoco se toca.** Podría haberse extendido para devolver
el slug, pero es la fuente del predicado que comparten listado y export: tocarla
arriesgaría el universo de ambos para ahorrar un `d.slug` que ya se tenía.

---

## 1 · Las dos columnas

| Columna | Regla |
|---|---|
| **`Slug`** | `doctors.slug` **tal cual**. Nunca reconstruido desde el nombre. NULL → celda vacía. |
| **`URL pública`** | `https://lucycare.app/doctor/<slug>` **solo si hay slug Y el médico está publicado**. En cualquier otro caso, celda vacía. |

**Por qué la URL exige `publicado`:** `fetchDoctorDetail` filtra por
`is_published = true`, así que la URL de un médico no publicado renderiza
**«Médico no encontrado»**. Una columna llamada «URL pública» no debe contener
enlaces muertos.

**El caso existe de verdad:** el trigger `trg_set_doctor_slug` asigna el slug al
publicar y **nunca lo reescribe**, así que un médico despublicado **conserva su
slug**. Ese slug sí se exporta —es el valor canónico— pero su URL queda vacía.

**El dominio es literal**, no `window.location.origin`: exportar desde un Preview
habría producido enlaces `…vercel.app` que fallan en cuanto el archivo sale del
navegador que lo generó.

---

## 2 · PRE — para correr en el SQL Editor

```sql
-- 1 · el export existe y HOY no emite slug
WITH ejecutable AS (
  SELECT regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/','','gs'),'--[^\n]*','','g') AS src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_export_doctors'
)
SELECT (src LIKE '%d.slug%') AS emite_slug_debe_ser_false,
       (src LIKE '%admin_list_doctors%') AS reutiliza_listado_debe_ser_true
  FROM ejecutable;

-- 2 · una sola definición, con la firma esperada
SELECT count(*) AS debe_ser_1,
       max(pg_get_function_identity_arguments(p.oid)) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_export_doctors';

-- 3 · baseline de slugs, para comparar contra el POST
SELECT count(*) AS medicos,
       count(*) FILTER (WHERE slug IS NOT NULL)                       AS con_slug,
       count(*) FILTER (WHERE slug IS NOT NULL AND is_published)      AS con_slug_publicados,
       count(*) FILTER (WHERE slug IS NOT NULL AND NOT is_published)  AS con_slug_no_publicados,
       count(*) FILTER (WHERE slug IS NULL AND is_published)          AS publicados_sin_slug
  FROM public.doctors;
```

**Esperado:** `emite_slug = false` · `reutiliza_listado = true` · **1** definición
con `p_search text, p_published boolean, p_operational boolean, p_lucy_status
lucy_status, p_formato text`.

Medido el 2026-08-26, **como referencia y NO como invariante** —la base se mueve—:
115 médicos · **39** con slug · **36** con slug y publicados · **3** con slug sin
publicar · **0** publicados sin slug.

---

## 3 · Aplicar

Pegar íntegro `migrations/s7_79_admin_doctor_export_slug.sql` en el SQL Editor.
Trae **guardas POST internas**: si algo no queda como se espera, aborta sola.

**Esperado:** `Success. No rows returned` + `NOTICE: s7_79: guardas POST OK`.

---

## 4 · POST de catálogo

```sql
WITH ejecutable AS (
  SELECT p.oid,
         regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/','','gs'),'--[^\n]*','','g') AS src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_export_doctors'
)
SELECT (src ~ '''slug'',\s*d\.slug')          AS emite_slug_debe_ser_true,
       (src LIKE '%slugify_name%')            AS genera_slug_debe_ser_false,
       (src LIKE '%lucycare.app%')            AS url_en_la_rpc_debe_ser_false,
       (src LIKE '%admin_list_doctors%')      AS reutiliza_listado_debe_ser_true,
       (src LIKE '%10000%')                   AS tope_debe_ser_true,
       (src LIKE '%P0140%')                   AS gate_debe_ser_true,
       (src LIKE '%con_busqueda%')            AS auditoria_debe_ser_true
  FROM ejecutable;

-- atributos y privilegios, sin depender de defaults
SELECT p.prosecdef AS security_definer_debe_ser_true,
       p.provolatile::text AS volatilidad_debe_ser_v,
       pg_get_function_identity_arguments(p.oid) AS firma,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_debe_ser_false,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_debe_ser_false,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_debe_ser_true
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_export_doctors';

-- una sola definición: CREATE OR REPLACE no debe haber creado un overload
SELECT count(*) AS debe_ser_1
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_export_doctors';

-- admin_list_doctors intacta y SIN slug: el export lo toma del JOIN
SELECT count(*) AS definiciones_debe_ser_1,
       bool_or(p.prosrc LIKE '%slug%') AS listado_con_slug_debe_ser_false
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_list_doctors';
```

---

## 5 · POST funcional — desde LucyAdmin, con sesión de Owner Admin

1. `/admin/medicos` → **«Exportar CSV»**. El archivo debe traer **17 columnas**,
   con `Slug` y `URL pública` al final.
2. Un médico **publicado con slug**: Slug lleno y URL
   `https://lucycare.app/doctor/<slug>`. **Abrirla y confirmar que carga el
   perfil.**
3. Un médico **no publicado**: si tiene slug, la columna `Slug` lo muestra y
   **`URL pública` queda VACÍA**. Con los datos del 2026-08-26 son **3 filas**.
4. Un médico **sin slug**: **ambas** columnas vacías. Eran **76 filas**.
5. **Ninguna URL debe contener `vercel.app`.**
6. Las **15 columnas anteriores** sin cambios: fechas `DD/MM/YYYY HH:mm`, tildes
   y eñes, celdas vacías donde no hay dato.
7. Filtros: el total del CSV debe seguir coincidiendo con el de la pantalla.

Y del lado del repositorio:

```bash
node scripts/check-s7_79.mjs
```

```bash
node scripts/check-admin-doctor-csv.mjs
```

**99/99** y **68/68**. Ambos estáticos/conductuales, sin tocar la base.

---

## 6 · Auditoría

**No cambia.** El slug es una columna más del archivo; la auditoría registra
**cuántas** filas salieron, no cuáles ni con qué campos. Tras exportar habrá un
evento nuevo con la misma forma de siempre — solo metadata no-PII.

---

## 7 · Rollback

`docs/rollbacks/s7_79_rollback.sql` — **no ejecutar salvo FAIL.**

Devuelve el export a su definición de `s7_78`, sin `slug`. El CSV vuelve a 15
columnas.

> El bloque restaurado **no se transcribió a mano**: se extrajo del propio
> `migrations/s7_78_admin_doctor_export.sql`, para que no pueda divergir por un
> error de copia. **`s7_78` no se reaplica**: el rollback reproduce su función,
> no ejecuta su migración.

No toca `admin_list_doctors` ni borra las filas de `audit_log`.

Tras el rollback, el frontend desplegado pediría dos columnas que la RPC ya no
devuelve: `Slug` y `URL pública` saldrían **vacías** —no rotas, porque el
servicio trata el campo ausente como `null`—. Aun así conviene revertir también
ese despliegue.

> ⚠️ El archivo cae en la regla `*.sql` del `.gitignore`. **Requiere `git add -f`.**
