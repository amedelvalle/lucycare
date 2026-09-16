-- ════════════════════════════════════════════════════════════════════
-- Invariante territorial v2 de clinics (vigente desde s7_95) · en cualquier momento
-- SOLO LECTURA · UNA sola sentencia SELECT · NO lee auth.users.
-- Toda clinica debe estar en exactamente uno de:
--   S0  sin legacy, sin pais, sin territorio;
--   S1  con legacy y (country_id, territory_unit_id) = _territory_from_legacy_sv(legacy);
--   S2  sin legacy, sin territorio, country_id = SV y en la lista atestada por s7_95
--       (clinicas con auditoria neta de s7_95 = 1: aplicaciones - reversiones).
-- Salida: seccion, orden, clave, valor, esperado, ok y fila final Z = anomalias.
-- Informativo, NO anomalia: una clinica atestada que paso a S1 (ubicacion cargada,
-- mejora legitima) o a S0 (se vacio su pais: riesgo residual aceptado por el owner).
-- Sustituye, para el estado posterior a s7_95, a las verificaciones historicas de
-- s7_92 y s7_93, disenadas antes de S2.
-- Orden obligatorio de reversion: s7_95 -> s7_94 -> s7_93 R2 -> verificar -> s7_92.
-- Saltarse s7_95 es una OPERACION INVALIDA: el rollback historico de s7_92 no la
-- detecta y vaciaria S2, la geo previa y el trigger. Este bloque la marca (seccion 0).
-- Primera linea de la sentencia: WITH · ultima: ORDER BY seccion, orden;
-- ════════════════════════════════════════════════════════════════════
WITH
sv AS (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV'),
aud AS MATERIALIZED (
  SELECT a.record_id, a.new_data ->> 'edited_via' AS via, a.user_id, a.new_data
    FROM public.audit_log a WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95'
),
neto AS MATERIALIZED (
  SELECT record_id AS clinic_id,
         count(*) FILTER (WHERE via = 'owner_attestation_f3e0') - count(*) FILTER (WHERE via = 'owner_attestation_f3e0_rollback') AS n
    FROM aud GROUP BY record_id
),
lista AS MATERIALIZED (SELECT clinic_id FROM neto WHERE n = 1),
-- Unidad esperada con las MISMAS reglas del resolver de s7_92, derivada del catalogo
-- (sin llamar a la funcion: el bloque debe poder clasificar aunque ese runtime falte).
deriv AS MATERIALIZED (
  SELECT c.id, c.department_id, c.municipality_id, c.country_id, c.territory_unit_id,
         CASE WHEN c.department_id IS NULL THEN NULL
              WHEN c.municipality_id IS NULL THEN
                (SELECT u.id FROM public.administrative_units u
                  WHERE u.country_id = (SELECT id FROM sv) AND u.legacy_id = c.department_id AND u.level = 1)
              ELSE
                (SELECT u3.id FROM public.administrative_units u3
                   JOIN public.administrative_units u2 ON u2.id = u3.parent_id
                   JOIN public.administrative_units u1 ON u1.id = u2.parent_id
                  WHERE u3.country_id = (SELECT id FROM sv) AND u3.legacy_id = c.municipality_id AND u3.level = 3
                    AND u1.level = 1 AND u1.legacy_id = c.department_id
                    AND EXISTS (SELECT 1 FROM public.municipalities m WHERE m.id = c.municipality_id AND m.department_id = c.department_id))
         END AS unidad_esperada
    FROM public.clinics c
),
cl AS MATERIALIZED (
  SELECT c.id, c.department_id, c.municipality_id, c.country_id, c.territory_unit_id,
         (c.id IN (SELECT clinic_id FROM lista)) AS atestada,
         CASE WHEN c.department_id IS NULL AND c.municipality_id IS NULL AND c.country_id IS NULL AND c.territory_unit_id IS NULL THEN 'S0'
              WHEN c.department_id IS NOT NULL AND c.unidad_esperada IS NOT NULL
                   AND c.country_id = (SELECT id FROM sv) AND c.territory_unit_id = c.unidad_esperada THEN 'S1'
              WHEN c.department_id IS NULL AND c.municipality_id IS NULL AND c.territory_unit_id IS NULL AND c.country_id = (SELECT id FROM sv)
                   AND c.id IN (SELECT clinic_id FROM lista) THEN 'S2'
              ELSE 'ANOMALIA' END AS estado
    FROM deriv c
),
rt AS (
  SELECT (to_regprocedure('public._territory_from_legacy_sv(text, text)') IS NOT NULL
          AND to_regprocedure('public._clinics_territory_sync()') IS NOT NULL
          AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND t.tgname = 'trg_clinics_territory_sync')) AS presente
),
filas (seccion, orden, clave, valor, esperado) AS (
  SELECT '0 operacion', 1, 'runtime de s7_92 presente (resolver, sincronizacion y trigger)', (SELECT presente FROM rt)::text, 'true'
  UNION ALL SELECT '0 operacion', 2, 'OPERACION INVALIDA: s7_95 sigue aplicada sin runtime de s7_92 (rollback de s7_92 fuera de orden)',
         (CASE WHEN NOT (SELECT presente FROM rt) AND (SELECT count(*) FROM lista) > 0 THEN 'INVALIDA' ELSE 'no' END), 'no'
  UNION ALL SELECT 'A lista atestada', 10, 'clinicas atestadas vigentes (aplicaciones - reversiones = 1)', (SELECT count(*) FROM lista)::text, '(info: 36 si s7_95 esta aplicada, 0 si no)'
  UNION ALL SELECT 'A lista atestada', 11, 'sha256 de la lista atestada vigente (orden clinic_id)',
         coalesce((SELECT encode(sha256(convert_to(string_agg(clinic_id::text, E'\n' ORDER BY clinic_id), 'UTF8')), 'hex') FROM lista), '(vacia)'),
         '(info: 783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8 si aplicada)'
  UNION ALL SELECT 'A lista atestada', 12, 'filas de s7_95 con autor distinto del confirmado + clinicas con neto de auditoria fuera de {0, 1}',
         ((SELECT count(*) FROM aud WHERE user_id IS DISTINCT FROM '739cac58-4ad2-4efe-9fbf-91921e208b8f')
          + (SELECT count(*) FROM neto WHERE n NOT IN (0, 1)))::text, '0'

  UNION ALL SELECT 'B anomalias', 20, 'clinicas fuera de S0/S1/S2 (total)', (SELECT count(*) FROM cl WHERE estado = 'ANOMALIA')::text, '0'
  UNION ALL SELECT 'B anomalias', 21, '  con pais sin legacy y NO atestadas (S2 no autorizada)',
         (SELECT count(*) FROM cl WHERE estado = 'ANOMALIA' AND department_id IS NULL AND country_id IS NOT NULL AND NOT atestada)::text, '0'
  UNION ALL SELECT 'B anomalias', 22, '  atestadas con pais distinto de SV',
         (SELECT count(*) FROM cl WHERE estado = 'ANOMALIA' AND atestada AND department_id IS NULL AND country_id IS DISTINCT FROM (SELECT id FROM sv) AND country_id IS NOT NULL)::text, '0'
  UNION ALL SELECT 'B anomalias', 23, '  con legacy y geo distinta del resolver',
         (SELECT count(*) FROM cl WHERE estado = 'ANOMALIA' AND department_id IS NOT NULL)::text, '0'
  UNION ALL SELECT 'B anomalias', 24, '  territorio o municipio sin departamento',
         (SELECT count(*) FROM cl WHERE estado = 'ANOMALIA' AND department_id IS NULL AND (territory_unit_id IS NOT NULL OR municipality_id IS NOT NULL))::text, '0'
  UNION ALL SELECT 'B anomalias', 25, '  detalle (clinic_id)',
         (SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '(ninguna)') FROM cl WHERE estado = 'ANOMALIA'), '(ninguna)'

  UNION ALL SELECT 'C informativo', 30, 'todas las clinicas: S0 · S1 · S2', (SELECT count(*) FILTER (WHERE estado = 'S0') || ' · ' || count(*) FILTER (WHERE estado = 'S1') || ' · ' || count(*) FILTER (WHERE estado = 'S2') FROM cl), '(info)'
  UNION ALL SELECT 'C informativo', 31, 'atestadas: siguen S2 · pasaron a S1 (mejora legitima) · pasaron a S0 (riesgo residual aceptado)',
         (SELECT count(*) FILTER (WHERE estado = 'S2') || ' · ' || count(*) FILTER (WHERE estado = 'S1') || ' · ' || count(*) FILTER (WHERE estado = 'S0') FROM cl WHERE atestada), '(info)'
  UNION ALL SELECT 'C informativo', 32, 'atestadas que pasaron a S0 (clinic_id)',
         (SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '(ninguna)') FROM cl WHERE atestada AND estado = 'S0'), '(info)'
  UNION ALL SELECT 'C informativo', 33, 'gate F3E-2: publicados visibles (D1) sin pais (doctor_id)',
         (SELECT coalesce(string_agg(d.id::text, ',' ORDER BY d.id), '(ninguno)') FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id
            LEFT JOIN public.profiles p ON p.id = d.profile_id
           WHERE d.is_published AND c.country_id IS NULL AND coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
             AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> ''), '(info: debe ser (ninguno) antes de F3E-2)'
),
res AS (
  SELECT seccion, orden, clave, valor, esperado, CASE WHEN esperado LIKE '(%' THEN NULL ELSE valor IS NOT DISTINCT FROM esperado END AS ok FROM filas
)
SELECT seccion, orden, clave, valor, esperado, ok FROM res
UNION ALL
SELECT 'Z resultado', 99, 'anomalias', (SELECT count(*) FROM res WHERE ok = false)::text, '0', (SELECT count(*) FROM res WHERE ok = false) = 0
ORDER BY seccion, orden;
