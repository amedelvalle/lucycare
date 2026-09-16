-- ════════════════════════════════════════════════════════════════════
-- s7_95 · VERIFICACION POST · justo despues de aplicar
-- SOLO LECTURA · UNA sola sentencia SELECT · NO lee auth.users.
-- Salida: seccion, orden, clave, valor, esperado, ok, y una fila final Z con el
-- numero de comprobaciones fallidas (debe ser 0). Las filas marcadas «justo tras
-- aplicar» dejan de ser validas cuando otras clinicas cambien legitimamente.
-- Sin datos personales: ids internos, conteos, banderas y huellas.
-- Primera linea de la sentencia: WITH · ultima: ORDER BY seccion, orden;
-- ════════════════════════════════════════════════════════════════════
WITH
lista AS MATERIALIZED (
  SELECT split_part(x, '|', 1)::uuid AS doctor_id, split_part(x, '|', 2)::uuid AS clinic_id
    FROM unnest(string_to_array(
    '01eb36db-1ccd-4a38-b54c-726847fe52ec|9f3d62de-8153-4c76-a410-a0f6db4e9320 ; '
    '05ae4d89-9a42-4136-be51-de5256ec3115|5ff14e28-81e4-459c-89a3-e207c9fab5e4 ; '
    '08c6e2fa-a0b8-4dd8-9808-c32a62b09c9e|f5504f6b-2206-4e47-97a7-76fa7401a3b5 ; '
    '0f4ac485-64ac-46b7-be94-8783611aed6f|45857d43-e325-4baa-8b36-3045bfb42e7a ; '
    '186e19ee-399f-428b-a960-4823d13b4872|9af14bd8-79b9-42b4-a38d-ab0142c059e3 ; '
    '1a93f6ab-4610-41ac-beb4-3ed85d90368e|cc536fb7-8533-4a9d-9590-e6fdde7e8d32 ; '
    '1ddd12e8-abc4-4c27-96eb-b535a3a186a0|0115e674-7c6b-4280-99ca-cfce0f776796 ; '
    '23c26f06-f2ee-494d-beed-49df86a4107b|69a66001-6829-474c-baa8-85d35d5bc029 ; '
    '2a9fdd1b-2d70-49ca-8997-3af7af2d62f1|b80c8cde-61bc-4d02-bb03-ed27084d3b8f ; '
    '322d56dc-340b-4f77-8d86-75132bc35acd|fdde6177-3572-4f48-b51e-7d4ab212465e ; '
    '32ef6c56-89d7-4e66-8aa5-f3e2e724652e|a2f0a3d9-6947-4acd-81e7-4db543aef70b ; '
    '340c5f31-ccfe-4083-84a4-6d31c2266893|5fbac482-7ef1-4cac-b7fd-3003ffad84b7 ; '
    '52193263-d09b-493b-ab76-08f0129cd2aa|5111631f-5573-4882-88d6-b668a63953f8 ; '
    '52706672-085b-4a69-ad24-ed290dfd6ded|baad0d18-03b2-4c21-b0c4-f9ee8dbd65fe ; '
    '6023fd15-15c9-4f02-ac21-c7e1c574a598|e66b9460-e49d-4d24-8c65-b80cc5e52d30 ; '
    '6268dfc1-78b9-46b4-a194-20c7597bfae8|9bd000d9-42f7-473b-93bb-48e967e460fc ; '
    '68e2717d-0dae-41f5-9889-41501c16168d|f742e829-5f12-47b9-b9c8-0d399d77f3fc ; '
    '791bd9f4-6ee0-44c9-8594-5e923597fdbc|e157b76d-41f8-4607-8d3d-3d1da9bc525f ; '
    '80ecd0fe-4290-4ac1-9f29-c95d06e62ddd|92e16813-c4f2-4965-b367-3839c32d510f ; '
    '97b9de48-880a-4839-8139-bcb1ce6b7805|dea5cacf-5e98-46b4-ad9a-16beff4f07e8 ; '
    '9bbbb092-b549-4494-a2cc-03a9f9c53ce6|02f4e967-9056-4a8d-992c-0bc005cce104 ; '
    '9bf92db1-8c41-4b1c-9613-874a903be10b|6706dada-0028-4daa-b027-f9f76eac36b2 ; '
    'a49fcea6-5da0-449b-855b-3b99e060699b|5e90dd1b-3376-4d5d-b3e4-353ca2a8fae2 ; '
    'a5cf3a75-0dee-4ace-b1b2-13a2f834ed7d|cae0ca95-ce97-4232-b8da-a65413168ec5 ; '
    'b9f98215-3ebe-4093-a3d7-d2dbc565f356|c79254e5-55e2-4454-8c02-bdd678328721 ; '
    'bcf4e6a5-622b-4192-87eb-43dd5d83cc43|be8859d3-cfaa-4a03-9ae3-43cf302d4f82 ; '
    'c4ecc733-84d3-48c8-9435-716ac0e8f544|d1045688-4856-4b80-ad36-fa04b4547a8b ; '
    'c737870b-be38-4331-a3ec-b425cf69eaba|3d8c9fed-d5d2-445f-9b61-1b4404dcd68c ; '
    'd4bee838-d556-4ff9-af2f-fdc240323c18|4b6c02c2-a7a5-4a50-b8bb-1d84d88511ad ; '
    'd8d2e8f2-8c3f-4f1d-a096-ede1a3b07c1e|f275c2a9-df0d-4223-93fc-4372a3535d14 ; '
    'e05644f8-9bde-473b-b607-0e830bb96eba|39c9b1cc-a4e0-4a67-8d56-0a66b7109439 ; '
    'e7308e96-f04a-438f-ad8d-ff04564a45b1|151b9b88-fc17-4304-80b0-f1fc312b8b8f ; '
    'f4c8ae94-ba6b-4081-9850-dfdbd5e2e0c8|16778370-90e5-4171-8379-98033ed5a15b ; '
    'f7ba1490-19b8-4afc-9fbd-2315a7ee1a5c|a1b58063-5396-4dc1-9d59-f71c6be5383a ; '
    'fe7b90d1-d025-4c75-8132-7df4f11e4826|5588d2ad-0f30-43f9-96ba-d6db2fe6b7ee ; '
    'ff5b38ce-d9b2-40cc-a1b1-1acfe75781de|e873a6e7-dc19-4414-936e-b76ee5946fff', ' ; ')) x
),
sv AS (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV'),
aud AS MATERIALIZED (
  SELECT a.* FROM public.audit_log a WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95'
),
pub AS MATERIALIZED (
  SELECT d.id, c.country_id,
         (coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
          AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '') AS visible
    FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id LEFT JOIN public.profiles p ON p.id = d.profile_id
   WHERE d.is_published
),
filas (seccion, orden, clave, valor, esperado) AS (
  SELECT 'A datos', 10, 'clinicas de la lista en S2 SV (sin legacy, sin territorio)',
         (SELECT count(*) FROM public.clinics c JOIN lista l ON l.clinic_id = c.id
           WHERE c.country_id = (SELECT id FROM sv) AND c.territory_unit_id IS NULL AND c.department_id IS NULL AND c.municipality_id IS NULL)::text, '36'
  UNION ALL SELECT 'A datos', 11, 'sha256 de los pares literales', (SELECT encode(sha256(convert_to(string_agg(doctor_id || '|' || clinic_id, E'\n' ORDER BY doctor_id), 'UTF8')), 'hex') FROM lista),
         '68ff3c1509311c975e22b1df77990622a7247a7a1840e9c76ae7833062f7303c'
  UNION ALL SELECT 'A datos', 12, 'pares cuyo medico ya no apunta a su clinica', (SELECT count(*) FROM lista l LEFT JOIN public.doctors d ON d.id = l.doctor_id WHERE d.clinic_id IS DISTINCT FROM l.clinic_id)::text, '0'
  UNION ALL SELECT 'A datos', 13, 'estado del conjunto con su pais tratado como NULL = huella del preflight H (justo tras aplicar)',
         (SELECT encode(sha256(convert_to(string_agg(d.id || '|' || c.id || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
                   || coalesce(CASE WHEN c.country_id = (SELECT id FROM sv) THEN NULL ELSE c.country_id END::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL') || '|'
                   || coalesce(c.owner_id::text, 'NULL') || '|' || coalesce(d.profile_id::text, 'NULL') || '|' || (extract(epoch FROM c.updated_at) * 1000000)::bigint,
                   E'\n' ORDER BY d.id), 'UTF8')), 'hex')
            FROM lista l JOIN public.doctors d ON d.id = l.doctor_id JOIN public.clinics c ON c.id = l.clinic_id),
         'e12195c655220975ce87fabc6c4e8875bfa4ef59427c018a2f26532051819a18'
  UNION ALL SELECT 'A datos', 14, 'C2 de clinics con el pais de la lista tratado como NULL = C2 del preflight H (justo tras aplicar)',
         (SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
                   || coalesce(CASE WHEN c.id IN (SELECT clinic_id FROM lista) THEN NULL ELSE c.country_id END::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), ''))
            FROM public.clinics c), '7c823ad1f5c30fc7a2b5a33fe62c68a7'
  UNION ALL SELECT 'A datos', 15, 'C2 de clinics tras aplicar (info: nueva referencia)',
         (SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
                   || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), '')) FROM public.clinics c), '(info)'

  UNION ALL SELECT 'B invariante v2', 20, 'clinicas con pais sin legacy FUERA de la lista',
         (SELECT count(*) FROM public.clinics c WHERE c.department_id IS NULL AND c.country_id IS NOT NULL AND c.id NOT IN (SELECT clinic_id FROM lista))::text, '0'
  UNION ALL SELECT 'B invariante v2', 21, 'clinicas con legacy cuya geo no es la derivada del catalogo (reglas del resolver de s7_92)',
         (SELECT count(*) FROM public.clinics c
           WHERE c.department_id IS NOT NULL
             AND (c.country_id IS DISTINCT FROM (SELECT id FROM sv)
                  OR c.territory_unit_id IS DISTINCT FROM
                     CASE WHEN c.municipality_id IS NULL THEN
                            (SELECT u.id FROM public.administrative_units u WHERE u.country_id = (SELECT id FROM sv) AND u.legacy_id = c.department_id AND u.level = 1)
                          ELSE
                            (SELECT u3.id FROM public.administrative_units u3
                               JOIN public.administrative_units u2 ON u2.id = u3.parent_id
                               JOIN public.administrative_units u1 ON u1.id = u2.parent_id
                              WHERE u3.country_id = (SELECT id FROM sv) AND u3.legacy_id = c.municipality_id AND u3.level = 3
                                AND u1.level = 1 AND u1.legacy_id = c.department_id
                                AND EXISTS (SELECT 1 FROM public.municipalities m WHERE m.id = c.municipality_id AND m.department_id = c.department_id))
                     END))::text, '0'
  UNION ALL SELECT 'B invariante v2', 22, 'territorio o municipio sin departamento',
         (SELECT count(*) FROM public.clinics c WHERE c.department_id IS NULL AND (c.territory_unit_id IS NOT NULL OR c.municipality_id IS NOT NULL))::text, '0'

  UNION ALL SELECT 'C auditoria', 30, 'filas s7_95 netas (aplicacion - reversion)',
         (SELECT count(*) FILTER (WHERE new_data ->> 'edited_via' = 'owner_attestation_f3e0') - count(*) FILTER (WHERE new_data ->> 'edited_via' = 'owner_attestation_f3e0_rollback') FROM aud)::text, '36'
  UNION ALL SELECT 'C auditoria', 30.5, 'filas s7_95: aplicacion · reversion (info)',
         (SELECT count(*) FILTER (WHERE new_data ->> 'edited_via' = 'owner_attestation_f3e0') || ' · ' || count(*) FILTER (WHERE new_data ->> 'edited_via' = 'owner_attestation_f3e0_rollback') FROM aud), '(info)'
  UNION ALL SELECT 'C auditoria', 31, 'clinicas de la lista con fila de aplicacion valida (autor, valores y claves exactas)',
         (SELECT count(DISTINCT a.record_id) FROM aud a
           WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0' AND a.user_id = '739cac58-4ad2-4efe-9fbf-91921e208b8f' AND a.action::text = 'update'
             AND a.record_id IN (SELECT clinic_id FROM lista)
             AND a.old_data = jsonb_build_object('country_id', NULL, 'territory_unit_id', NULL, 'department_id', NULL, 'municipality_id', NULL)
             AND (a.new_data ->> 'country_id')::smallint = (SELECT id FROM sv) AND a.new_data ->> 'country_iso' = 'SV'
             AND a.new_data -> 'territory_unit_id' = 'null'::jsonb AND a.new_data ->> 'source' = 'owner_attestation'
             AND a.new_data ->> 'batch' = 'Importar_100' AND a.new_data ->> 'batch_membership' = 'measured' AND a.new_data ->> 'territory' = 'unknown'
             AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(a.new_data) k)
                 = ARRAY['batch', 'batch_membership', 'country_id', 'country_iso', 'edited_via', 'evidence', 'migration', 'source', 'territory', 'territory_unit_id'])::text, '36'
  UNION ALL SELECT 'C auditoria', 32, 'clinicas distintas con fila de aplicacion', (SELECT count(DISTINCT record_id) FROM aud WHERE new_data ->> 'edited_via' = 'owner_attestation_f3e0')::text, '36'
  UNION ALL SELECT 'C auditoria', 33, 'autor sigue siendo admin activo', (SELECT (count(*) = 1)::text FROM public.profiles WHERE id = '739cac58-4ad2-4efe-9fbf-91921e208b8f' AND role::text = 'admin' AND is_active), 'true'

  UNION ALL SELECT 'D runtime', 40, 'triggers de clinics',
         (SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal),
         'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]'
  UNION ALL SELECT 'D runtime', 41, 'definicion de trg_clinics_territory_sync es la de s7_92',
         (SELECT (count(*) = 1)::text FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND t.tgname = 'trg_clinics_territory_sync'
             AND pg_get_triggerdef(t.oid) LIKE '% BEFORE INSERT OR UPDATE OF department_id, municipality_id, country_id, territory_unit_id ON public.clinics FOR EACH ROW EXECUTE FUNCTION %_clinics_territory_sync()'), 'true'
  UNION ALL SELECT 'D runtime', 42, '_clinics_territory_sync: cuerpo, SECURITY DEFINER, search_path y ACL de s7_92',
         (SELECT (count(*) = 1)::text FROM pg_proc p WHERE p.oid = to_regprocedure('public._clinics_territory_sync()')
             AND md5(p.prosrc) IN ('d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202') AND p.prosecdef
             AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp' AND p.proacl::text = '{postgres=X/postgres}'), 'true'
  UNION ALL SELECT 'D runtime', 43, 'clinics: relacl | RLS | force',
         (SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity FROM pg_class WHERE oid = 'public.clinics'::regclass),
         '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}|true|false'
  UNION ALL SELECT 'D runtime', 44, 'clinics: md5 de policies empieza por 20ad37b9',
         (SELECT left(md5(coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' ORDER BY policyname), '')), 8)
            FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics'), '20ad37b9'
  UNION ALL SELECT 'D runtime', 45, 'escritores de clinics',
         (SELECT string_agg(DISTINCT p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?clinics\M'),
         'admin_approve_and_create_doctor,admin_create_seed_doctor,admin_update_doctor_clinic'
  UNION ALL SELECT 'D runtime', 46, 'consumidores del modelo territorial (funciones fuera de s7_92, vistas y policies)',
         ((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
              AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\M')
          + (SELECT count(*) FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
              WHERE dp.classid = 'pg_rewrite'::regclass AND dp.refobjid = 'public.clinics'::regclass AND a.attname IN ('country_id', 'territory_unit_id'))
          + (SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(country_id|territory_unit_id)\M'))::text, '0'

  UNION ALL SELECT 'E directorio', 50, 'publicados: total|con pais|sin pais',
         (SELECT count(*) || '|' || count(*) FILTER (WHERE country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE country_id IS NULL) FROM pub), '46|45|1'
  UNION ALL SELECT 'E directorio', 51, 'visibles D1: total|con pais|sin pais',
         (SELECT count(*) FILTER (WHERE visible) || '|' || count(*) FILTER (WHERE visible AND country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE visible AND country_id IS NULL) FROM pub), '43|42|1'
  UNION ALL SELECT 'E directorio', 52, 'publicados que siguen sin pais (debe ser solo el caso D)',
         (SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '(ninguno)') FROM pub WHERE country_id IS NULL), '96dffdc8-0764-4adb-a4eb-3a7a198cf51d'
  UNION ALL SELECT 'E directorio', 53, 'medicos de la lista que siguen publicados (info)',
         (SELECT count(*) FROM pub WHERE id IN (SELECT doctor_id FROM lista))::text, '(info)'
  UNION ALL SELECT 'E directorio', 54, 'current_user (info)', current_user::text, '(info)'
),
res AS (
  SELECT seccion, orden, clave, valor, esperado, CASE WHEN esperado = '(info)' THEN NULL ELSE valor IS NOT DISTINCT FROM esperado END AS ok FROM filas
)
SELECT seccion, orden, clave, valor, esperado, ok FROM res
UNION ALL
SELECT 'Z resultado', 99, 'comprobaciones fallidas', (SELECT count(*) FROM res WHERE ok = false)::text, '0', (SELECT count(*) FROM res WHERE ok = false) = 0
ORDER BY seccion, orden;
