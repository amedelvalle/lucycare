-- ════════════════════════════════════════════════════════════════════
-- s7_95 · ESTADO · clasifica aplicada / no aplicada / revertida / mixta / invalida
-- SOLO LECTURA · UNA sola sentencia SELECT · NO lee auth.users.
-- Correr PRIMERO ante cualquier error del SQL Editor en el PASO 2 o en un rollback,
-- antes de reintentar o de concluir nada: un error mostrado no prueba que la
-- transaccion abortara.
-- No llama a funciones de s7_92: la coherencia S1 se deriva del catalogo con las
-- mismas reglas del resolver, para poder clasificar tambien si ese runtime falta.
-- OPERACION INVALIDA = s7_95 sigue aplicada (auditoria neta > 0) y el runtime de
-- s7_92 no existe: se ejecuto el rollback de s7_92 sin revertir antes s7_95.
-- Sin datos personales: solo conteos, estados y huellas.
-- Primera linea de la sentencia: WITH · ultima: ORDER BY orden;
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
m AS MATERIALIZED (
  SELECT
    (SELECT count(*) FROM lista)                                                                                   AS n,
    (SELECT count(*) FROM deriv c JOIN lista l ON l.clinic_id = c.id
      WHERE c.country_id = (SELECT id FROM sv) AND c.territory_unit_id IS NULL AND c.department_id IS NULL AND c.municipality_id IS NULL) AS s2,
    (SELECT count(*) FROM deriv c JOIN lista l ON l.clinic_id = c.id
      WHERE c.country_id IS NULL AND c.territory_unit_id IS NULL AND c.department_id IS NULL AND c.municipality_id IS NULL)             AS s0,
    (SELECT count(*) FROM deriv c JOIN lista l ON l.clinic_id = c.id
      WHERE c.department_id IS NOT NULL AND c.unidad_esperada IS NOT NULL
        AND c.country_id = (SELECT id FROM sv) AND c.territory_unit_id = c.unidad_esperada)                        AS s1,
    (SELECT count(*) FILTER (WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0') FROM public.audit_log a
      WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95')                                  AS aud_aplicacion,
    (SELECT count(*) FILTER (WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0_rollback') FROM public.audit_log a
      WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95')                                  AS aud_reversion,
    (SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) FROM pg_trigger t
      WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal)                                       AS triggers,
    (to_regprocedure('public._territory_from_legacy_sv(text, text)') IS NOT NULL
      AND to_regprocedure('public._clinics_territory_sync()') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND t.tgname = 'trg_clinics_territory_sync')) AS runtime_s7_92,
    coalesce((SELECT md5(p.prosrc) IN ('d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202') FROM pg_proc p
      WHERE p.oid = to_regprocedure('public._clinics_territory_sync()')), false)                                  AS fn_s7_92,
    (SELECT count(*) FROM public.clinics c WHERE c.department_id IS NULL AND c.country_id IS NOT NULL
        AND c.id NOT IN (SELECT clinic_id FROM lista))                                                           AS s2_fuera
)
SELECT 1 AS orden, 'ESTADO' AS clave,
       CASE
         WHEN NOT m.runtime_s7_92 AND m.aud_aplicacion - m.aud_reversion > 0
           THEN 'OPERACION INVALIDA — s7_95 sigue aplicada (auditoria neta ' || (m.aud_aplicacion - m.aud_reversion)
                || ') y el runtime de s7_92 no existe: se ejecuto el rollback de s7_92 sin revertir antes s7_95. NO continuar, reportar'
         WHEN NOT m.runtime_s7_92 THEN 'SIN RUNTIME DE s7_92 — fuera del alcance de s7_95: NO continuar, reportar'
         WHEN m.triggers IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]'
           THEN 'ANOMALIA — triggers de clinics no normales (' || coalesce(m.triggers, 'ninguno') || '): NO continuar, reportar'
         WHEN NOT m.fn_s7_92 THEN 'ANOMALIA — _clinics_territory_sync no es la de s7_92: NO continuar, reportar'
         WHEN m.s2_fuera <> 0 THEN 'ANOMALIA — ' || m.s2_fuera || ' clinicas con pais sin legacy fuera de la lista: NO continuar, reportar'
         WHEN m.aud_aplicacion = 0 AND m.aud_reversion = 0 AND m.s0 = m.n THEN 'S7_95 NO APLICADA'
         WHEN m.aud_aplicacion - m.aud_reversion = m.n AND m.s2 = m.n THEN 'S7_95 APLICADA COMPLETA'
         WHEN m.aud_aplicacion - m.aud_reversion = m.n AND m.s2 + m.s1 + m.s0 = m.n
           THEN 'S7_95 APLICADA — evolucionada despues (S2=' || m.s2 || ', paso a S1=' || m.s1 || ', paso a S0=' || m.s0 || ')'
         WHEN m.aud_aplicacion > 0 AND m.aud_aplicacion = m.aud_reversion AND m.s0 = m.n THEN 'S7_95 REVERTIDA'
         ELSE 'MIXTO — no encaja en ningun estado conocido: NO continuar, reportar'
       END AS valor
  FROM m
UNION ALL SELECT 2, 'clinicas de la lista', n::text FROM m
UNION ALL SELECT 3, 'lista en S2 SV · S1 coherente · S0', s2 || ' · ' || s1 || ' · ' || s0 FROM m
UNION ALL SELECT 4, 'auditoria s7_95: aplicacion · reversion (neto = aplicacion - reversion)', aud_aplicacion || ' · ' || aud_reversion || ' (neto ' || (aud_aplicacion - aud_reversion) || ')' FROM m
UNION ALL SELECT 5, 'runtime de s7_92 presente (resolver, sincronizacion y trigger)', runtime_s7_92::text FROM m
UNION ALL SELECT 6, 'triggers de clinics', coalesce(triggers, '(ninguno)') FROM m
UNION ALL SELECT 7, '_clinics_territory_sync es la de s7_92', fn_s7_92::text FROM m
UNION ALL SELECT 8, 'clinicas con pais sin legacy fuera de la lista', s2_fuera::text FROM m
UNION ALL SELECT 9, 'current_user', current_user::text
ORDER BY orden;
