# `s7_78` — guía de aplicación para el owner

> **Frente:** `ADMIN-DOCTOR-EXPORT-P0`
> **Migración:** `migrations/s7_78_admin_doctor_export.sql` — sería la **99**
> **Estado:** **PREPARADA, NO APLICADA.** Nada de esto se ha ejecutado.

---

## 0 · Qué hace

Crea **una función** —`admin_export_doctors`— para que el Owner Admin descargue
desde `/admin/medicos` la base de médicos que cumple **exactamente los filtros
activos**, no la página visible.

**No crea tablas, no altera nada existente, no migra datos.** El único efecto
sobre datos es la fila de auditoría que escribe **cada vez que alguien exporta**,
no al aplicarla.

**No toca `admin_list_doctors`**: la invoca. El predicado de búsqueda y filtros
sigue viviendo en un solo lugar (`s7_04`), así que **listado y export no pueden
divergir**.

---

## 1 · Por qué este número

`s7_78` estaba **reservado especulativamente** en `docs/ANALISIS_PATIENT_CRM.md`
para dos frentes distintos que **nunca se iniciaron**. Por decisión del owner
(2026-08-26) no se reservan números para frentes no iniciados: esas referencias
pasaron a **«migración futura (TBD)»** y el identificador queda para este frente.

**Dos menciones quedaron a propósito sin tocar** — en
`migrations/s7_76_patient_crm_foundation.sql` y en `docs/OWNER_S7_76_APPLY.md`—
porque ese archivo ya se aplicó y su contenido es el registro de lo ejecutado.
Está explicado en el análisis.

---

## 2 · PRE — para correr en el SQL Editor antes de aplicar

```sql
-- 1 · la función NO debe existir todavía
SELECT count(*) AS debe_ser_0
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';

-- 2 · el listado del que depende SÍ debe existir, y sin techo en el LIMIT
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       (p.prosrc LIKE '%GREATEST(p_limit, 1)%') AS piso_sin_techo,
       (p.prosrc LIKE '%LEAST%')                AS tiene_clamp_debe_ser_false
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors';

-- 3 · baseline del universo, para comparar contra el POST
SELECT count(*) AS medicos_totales FROM public.doctors;
SELECT count(*) FILTER (WHERE is_published)   AS publicados,
       count(*) FILTER (WHERE is_operational) AS operativos
  FROM public.doctors;

-- 4 · auditoría: cuántas filas de export de médicos hay (debe ser 0)
SELECT count(*) AS debe_ser_0
  FROM public.audit_log WHERE table_name = 'admin_doctor_export';
```

**Esperado:** `0` · una sola definición de `admin_list_doctors`, `SECURITY
DEFINER`, `piso_sin_techo = true`, `tiene_clamp = false` · el conteo de médicos
(el 2026-08-26 eran **115**, de los cuales 36 publicados y 4 operativos) · `0`
filas de auditoría.

> Si `tiene_clamp` fuera `true`, **no aplicar**: significaría que
> `admin_list_doctors` adquirió un límite superior y el tope de 10 000 dejaría de
> funcionar. La migración también lo verifica sola y abortaría.

---

## 3 · Aplicar

Pegar íntegro `migrations/s7_78_admin_doctor_export.sql` en el SQL Editor y
correrlo. Trae **24 guardas POST internas**: si algo no queda como se espera,
aborta sola y no deja media migración aplicada.

**Esperado:** `Success. No rows returned`, con el `NOTICE`
`s7_78: guardas POST OK`.

---

## 4 · POST de catálogo

```sql
-- existe, SECURITY DEFINER, VOLATILE, search_path fijo
SELECT p.prosecdef AS security_definer,
       p.provolatile::text AS volatilidad_debe_ser_v,
       p.proconfig AS debe_incluir_search_path
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';

-- privilegios EXPLÍCITOS de los cuatro roles, sin depender de defaults
SELECT has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_debe_ser_false,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_debe_ser_false,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_debe_ser_true,
       (p.proacl IS NOT NULL)                                    AS acl_explicita_debe_ser_true,
       p.proacl                                                  AS acl_sin_entrada_de_PUBLIC
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';

-- La entrada de PUBLIC es la que EMPIEZA por "=": no debe existir ninguna.
-- (Buscar "=X/" en el ACL entero daría un falso positivo con authenticated=X/…)
SELECT count(*) AS entradas_de_PUBLIC_debe_ser_0
  FROM pg_proc p, unnest(p.proacl) AS a
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors'
   AND a::text LIKE '=%';

-- el cuerpo reutiliza el listado y no filtra por su cuenta
-- (se mira SIN comentarios: el texto crudo nombra a propósito lo prohibido)
WITH ejecutable AS (
  SELECT regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/','','gs'),'--[^\n]*','','g') AS src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_export_doctors'
)
SELECT (src LIKE '%admin_list_doctors%')  AS reutiliza_listado_debe_ser_true,
       (src LIKE '%license_number%')      AS expone_licencia_debe_ser_false,
       (src LIKE '%10000%')               AS tope_correcto_debe_ser_true,
       (src LIKE '%con_busqueda%')        AS audita_booleano_debe_ser_true
  FROM ejecutable;

-- el listado sigue intacto: una sola definición
SELECT count(*) AS debe_ser_1
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors';
```

---

## 5 · POST funcional — desde LucyAdmin, con sesión de Owner Admin

Estas pruebas **no se pueden hacer desde el SQL Editor**: la RPC exige
`is_admin()`, que depende de `auth.uid()`.

1. Entrar a `/admin/medicos`, **sin filtros**. Anotar el total que muestra la
   paginación. Pulsar **«Exportar CSV»** y comprobar que el archivo trae **ese
   mismo número de filas** —no 25—.
2. Aplicar el filtro **Publicado = Sí**. El total debe cambiar, y el CSV debe
   traer exactamente ese total.
3. Buscar un nombre parcial. Idem.
4. Combinar búsqueda + `lucy_status`. Idem.
5. Comprobar en el archivo: **15 columnas**, tildes y eñes correctas, fechas como
   `DD/MM/YYYY HH:mm`, celdas vacías donde no hay dato.
6. **Durante la descarga**, el botón debe decir **«Preparando CSV…»** y estar
   deshabilitado. Un doble clic **no** debe lanzar dos descargas.
7. Con una sesión de **`directory_editor`**: el botón **no debe existir**. Y si
   invocara la RPC directamente, debe recibir **P0140**: es `authenticated`, así
   que tiene el GRANT, pero `is_admin()` lo rechaza. Autenticado sí, autorizado no.
8. Exportar dos veces seguidas y comprobar que el **orden de las filas es
   idéntico**: el array JSON se ordena dentro de `jsonb_agg` por
   `created_at DESC, id`, así que es determinista entre corridas.

Y del lado del repositorio:

```bash
node scripts/check-s7_78.mjs
```

```bash
node scripts/check-admin-doctor-csv.mjs
```

**115/115** y **50/50** respectivamente. Ambos son estáticos/conductuales y no
tocan la base.

---

## 6 · Verificar la auditoría — y que NO tiene PII

Después de exportar al menos una vez:

```sql
SELECT created_at, user_id, new_data
  FROM public.audit_log
 WHERE table_name = 'admin_doctor_export'
 ORDER BY created_at DESC LIMIT 5;
```

**Debe haber:** `accion`, `formato`, `registros`, `con_busqueda` (**booleano**),
`filtro_published`, `filtro_operational`, `filtro_lucy_status`, `exportado_at`.

**NO debe haber:** el texto buscado, nombres, correos, teléfonos ni las filas
exportadas. Si aparece cualquiera de esos, es un defecto — y `audit_log` es
**inmutable** desde `s7_71b`, así que no se puede corregir después.

---

## 7 · Rollback

`docs/rollbacks/s7_78_rollback.sql` — **no ejecutar salvo FAIL.**

Solo hace `DROP FUNCTION` de lo que se añadió. **No toca `admin_list_doctors`** y
**no borra las filas de auditoría**: son evidencia de exportaciones que
realmente ocurrieron, y borrarlas sería falsificar el historial, no revertir.

Tras el rollback, el botón de la pantalla deja de funcionar; conviene revertir
también el despliegue del frontend.

> ⚠️ El archivo cae en la regla `*.sql` del `.gitignore`, cuya única excepción es
> `!migrations/*.sql`. **Requiere `git add -f`** para entrar al commit. Ya pasó
> una vez, en #321.

---

## 8 · Lo que este frente NO incluye

Registrado como **`ADMIN-DOCTOR-EXPORT-P1`**, sin iniciar: total de citas, citas
atendidas, última actividad, próxima cita y rating. Todo eso exige agregaciones
sobre tablas que crecen con el uso, y este export debe seguir siendo **una sola
pasada** hasta 10 000 médicos.

**`ADMIN-DOCTOR-EXPORT-P2`:** streaming o job asíncrono, si algún día el universo
supera de forma habitual el tope.

**Deuda registrada, no corregida:** `admin_list_doctors` ordena por
`created_at DESC` **sin desempate**, así que dos médicos creados en el mismo
instante pueden intercambiarse entre páginas de la pantalla. Es un defecto de la
paginación existente; el export aplica su propio orden determinista.
