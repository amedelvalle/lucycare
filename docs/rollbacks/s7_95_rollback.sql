-- ============================================================
-- ROLLBACK de s7_95 · MULTICOUNTRY-GEO-P0 · F3E-0 · M0.5
-- Vuelve a S0 (country_id NULL) las 36 clinicas del pais atestado.
-- ============================================================
--
-- ⛔ NO EJECUTAR SIN ORDEN EXPLICITA DEL OWNER.
--
-- ⛔ VALIDO SOLO MIENTRAS:
--   · las 36 clinicas sigan EXACTAMENTE como las dejo s7_95: S2 SV, sin legacy,
--     sin territorio, mismo dueno, mismo medico y mismo updated_at (la huella del
--     estado del preflight H, tratando su pais como NULL). Si alguna paso a S1 o
--     a S0, o cambio cualquier otra de esas columnas, se niega: reevaluar;
--   · ningun objeto consuma el modelo territorial (funciones, vistas, policies):
--     tras F3E-1 este rollback cambiaria lo que ven los lectores y ya no es valido.
--
-- ── ORDEN VIGENTE ──
--   rollback de s7_95 -> s7_94 -> s7_93 R2 -> verificar estado -> s7_92.
-- Este archivo es el PRIMER paso. La VERIFICA del rollback de s7_92 exige
-- 0 clinicas con pais: sin este paso previo, fallaria.
--
-- ── QUE HACE ──
--   BEGIN -> lock_timeout 5s -> LOCK clinics y doctors -> PREVIA -> desactiva
--   SOLO trg_clinics_updated_at -> UPDATE country_id = NULL de las 36 con la
--   sincronizacion de s7_92 ACTIVA (vaciar el pais de una clinica sin legacy es
--   coherente con el resolver) -> 36 filas de auditoria de reversion -> reactiva
--   -> VERIFICA -> COMMIT.
--
-- ── AUDITORIA ──
-- audit_log es append-only: las 36 filas de s7_95 NO se borran. Este rollback
-- anade 36 filas con edited_via = owner_attestation_f3e0_rollback. La guarda de
-- s7_95 compara aplicacion y reversion, asi que tras revertir podria volver a
-- aplicarse con un preflight fresco y nueva autorizacion.
--
-- Pegar ENTERO en una pestaña nueva. Ante cualquier error del editor, clasificar
-- primero el estado con docs/smokes/s7_95_state_readonly.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.doctors IN SHARE ROW EXCLUSIVE MODE;


DO $PREVIA$
DECLARE
  v_pares       CONSTANT text :=
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
    'ff5b38ce-d9b2-40cc-a1b1-1acfe75781de|e873a6e7-dc19-4414-936e-b76ee5946fff';
  v_n           CONSTANT int := 36;
  v_sha_pares   CONSTANT text := '68ff3c1509311c975e22b1df77990622a7247a7a1840e9c76ae7833062f7303c';
  v_sha_estado  CONSTANT text := 'e12195c655220975ce87fabc6c4e8875bfa4ef59427c018a2f26532051819a18';
  v_owner       CONSTANT uuid := '739cac58-4ad2-4efe-9fbf-91921e208b8f';
  v_fn_md5      CONSTANT text[] := ARRAY['d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202'];
  v_sv  smallint;
  v_i   bigint;
  v_txt text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'rollback s7_95: ejecutar como postgres (current_user=%)', current_user;
  END IF;
  SELECT encode(sha256(convert_to(string_agg(l.d || '|' || l.c, E'\n' ORDER BY l.d), 'UTF8')), 'hex') INTO v_txt
    FROM (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x) l;
  IF v_txt IS DISTINCT FROM v_sha_pares THEN
    RAISE EXCEPTION 'rollback s7_95: la lista literal no es la de s7_95 (%)', v_txt;
  END IF;
  SELECT co.id INTO STRICT v_sv FROM public.countries co WHERE co.iso_alpha2 = 'SV';
  SELECT (has_table_privilege(current_user, 'public.audit_log', 'INSERT')
          AND coalesce(has_sequence_privilege(current_user, pg_get_serial_sequence('public.audit_log', 'id'), 'USAGE'), true)
          AND ((SELECT NOT (c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c WHERE c.oid = 'public.audit_log'::regclass)
               OR (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user)))::text
    INTO v_txt;
  IF v_txt IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'rollback s7_95: % no puede escribir en audit_log (INSERT, secuencia o RLS)', current_user;
  END IF;

  -- s7_95 aplicada y sin revertir.
  SELECT count(*) FILTER (WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0')
       - count(*) FILTER (WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0_rollback')
    INTO v_i FROM public.audit_log a WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95';
  IF v_i <> v_n THEN
    RAISE EXCEPTION 'rollback s7_95: auditoria neta (aplicacion - reversion) = % (se esperaba %) — s7_95 no esta aplicada o ya se revirtio', v_i, v_n;
  END IF;

  -- Las v_n siguen en S2 SV y nada mas de su estado cambio desde el preflight H.
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x)
  SELECT count(*) INTO v_i FROM public.clinics c
   WHERE c.id IN (SELECT l.c FROM l) AND c.country_id = v_sv AND c.territory_unit_id IS NULL AND c.department_id IS NULL AND c.municipality_id IS NULL;
  IF v_i <> v_n THEN
    RAISE EXCEPTION 'rollback s7_95: solo % de % clinicas siguen en S2 SV — no se revierte', v_i, v_n;
  END IF;
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x)
  SELECT encode(sha256(convert_to(string_agg(d.id || '|' || c.id || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
           || coalesce(CASE WHEN c.country_id = v_sv THEN NULL ELSE c.country_id END::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL') || '|'
           || coalesce(c.owner_id::text, 'NULL') || '|' || coalesce(d.profile_id::text, 'NULL') || '|' || (extract(epoch FROM c.updated_at) * 1000000)::bigint,
           E'\n' ORDER BY d.id), 'UTF8')), 'hex')
    INTO v_txt
    FROM l JOIN public.doctors d ON d.id = l.d AND d.clinic_id = l.c JOIN public.clinics c ON c.id = l.c;
  IF v_txt IS DISTINCT FROM v_sha_estado THEN
    RAISE EXCEPTION 'rollback s7_95: el estado de las clinicas cambio despues de s7_95 (%) — no se revierte', v_txt;
  END IF;

  -- Runtime de s7_92 normal y sin consumidores del modelo territorial.
  SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 'rollback s7_95: triggers de clinics inesperados (%)', v_txt;
  END IF;
  SELECT count(*) INTO v_i FROM pg_proc p WHERE p.oid = 'public._clinics_territory_sync()'::regprocedure AND md5(p.prosrc) = ANY (v_fn_md5);
  IF v_i <> 1 THEN
    RAISE EXCEPTION 'rollback s7_95: _clinics_territory_sync no es la de s7_92 — el vaciado no es seguro';
  END IF;
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
             AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\M')
       + (SELECT count(*) FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
           WHERE dp.classid = 'pg_rewrite'::regclass AND dp.refobjid = 'public.clinics'::regclass AND a.attname IN ('country_id', 'territory_unit_id'))
       + (SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(country_id|territory_unit_id)\M')
    INTO v_i;
  IF v_i <> 0 THEN
    RAISE EXCEPTION 'rollback s7_95: % consumidores del modelo territorial — el rollback ya no es valido', v_i;
  END IF;

  PERFORM set_config('s7_95rb.n', v_n::text, true);
  PERFORM set_config('s7_95rb.sv', v_sv::text, true);
  PERFORM set_config('s7_95rb.owner', v_owner::text, true);
  PERFORM set_config('s7_95rb.sha_estado', v_sha_estado, true);
  PERFORM set_config('s7_95rb.pares', v_pares, true);
  PERFORM set_config('s7_95rb.clinicas',
    (SELECT string_agg(l.c::text, ',' ORDER BY l.c) FROM (SELECT split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x) l), true);
  PERFORM set_config('s7_95rb.runtime',
    (SELECT md5(p.prosrc) || '|' || p.oid FROM pg_proc p WHERE p.oid = 'public._clinics_territory_sync()'::regprocedure)
    || '|' || (SELECT string_agg(t.oid || '|' || pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text, ';' ORDER BY t.tgname)
                 FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal), true);
  PERFORM set_config('s7_95rb.filas_sin_pais',
    (SELECT md5(string_agg((to_jsonb(c) - 'country_id')::text, E'\n' ORDER BY c.id)) FROM public.clinics c), true);
  PERFORM set_config('s7_95rb.filas_fuera',
    (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c
      WHERE NOT (c.id = ANY (string_to_array(current_setting('s7_95rb.clinicas'), ',')::uuid[]))), true);
  PERFORM set_config('s7_95rb.audit_max', (SELECT coalesce(max(a.id), 0)::text FROM public.audit_log a), true);
END $PREVIA$;


ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;


DO $REVIERTE$
DECLARE
  v_lista uuid[]   := string_to_array(current_setting('s7_95rb.clinicas'), ',')::uuid[];
  v_n     int      := current_setting('s7_95rb.n')::int;
  v_sv    smallint := current_setting('s7_95rb.sv')::smallint;
  v_owner uuid     := current_setting('s7_95rb.owner')::uuid;
  v_i     bigint;
BEGIN
  UPDATE public.clinics c
     SET country_id = NULL
   WHERE c.id = ANY (v_lista)
     AND c.country_id = v_sv AND c.territory_unit_id IS NULL
     AND c.department_id IS NULL AND c.municipality_id IS NULL;
  GET DIAGNOSTICS v_i = ROW_COUNT;
  IF v_i <> v_n THEN
    RAISE EXCEPTION 'rollback s7_95: se revirtieron % clinicas, se esperaban %', v_i, v_n;
  END IF;

  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  SELECT v_owner, 'update', 'clinics', x.id,
         jsonb_build_object('country_id', v_sv, 'country_iso', 'SV'),
         jsonb_build_object('country_id', NULL, 'edited_via', 'owner_attestation_f3e0_rollback', 'migration', 's7_95', 'source', 'rollback')
    FROM unnest(v_lista) AS x(id);
  GET DIAGNOSTICS v_i = ROW_COUNT;
  IF v_i <> v_n THEN
    RAISE EXCEPTION 'rollback s7_95: % filas de auditoria de reversion, se esperaban %', v_i, v_n;
  END IF;
END $REVIERTE$;


ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;


DO $VERIFICA$
DECLARE
  v_lista uuid[]   := string_to_array(current_setting('s7_95rb.clinicas'), ',')::uuid[];
  v_pares text     := current_setting('s7_95rb.pares');
  v_n     int      := current_setting('s7_95rb.n')::int;
  v_i     bigint;
  v_txt   text;
BEGIN
  IF ((SELECT md5(p.prosrc) || '|' || p.oid FROM pg_proc p WHERE p.oid = 'public._clinics_territory_sync()'::regprocedure)
      || '|' || (SELECT string_agg(t.oid || '|' || pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text, ';' ORDER BY t.tgname)
                   FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal)) IS DISTINCT FROM current_setting('s7_95rb.runtime') THEN
    RAISE EXCEPTION 'rollback s7_95 VERIFICA: la funcion o los triggers de clinics cambiaron';
  END IF;
  SELECT count(*) INTO v_i FROM public.clinics c
   WHERE c.id = ANY (v_lista) AND c.country_id IS NULL AND c.territory_unit_id IS NULL AND c.department_id IS NULL AND c.municipality_id IS NULL;
  IF v_i <> v_n THEN
    RAISE EXCEPTION 'rollback s7_95 VERIFICA: solo % de % clinicas volvieron a S0', v_i, v_n;
  END IF;
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x)
  SELECT encode(sha256(convert_to(string_agg(d.id || '|' || c.id || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
           || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL') || '|' || coalesce(c.owner_id::text, 'NULL') || '|'
           || coalesce(d.profile_id::text, 'NULL') || '|' || (extract(epoch FROM c.updated_at) * 1000000)::bigint, E'\n' ORDER BY d.id), 'UTF8')), 'hex')
    INTO v_txt
    FROM l JOIN public.doctors d ON d.id = l.d JOIN public.clinics c ON c.id = l.c;
  IF v_txt IS DISTINCT FROM current_setting('s7_95rb.sha_estado') THEN
    RAISE EXCEPTION 'rollback s7_95 VERIFICA: el estado no volvio exactamente al del preflight H (%)', v_txt;
  END IF;
  IF (SELECT md5(string_agg((to_jsonb(c) - 'country_id')::text, E'\n' ORDER BY c.id)) FROM public.clinics c) IS DISTINCT FROM current_setting('s7_95rb.filas_sin_pais') THEN
    RAISE EXCEPTION 'rollback s7_95 VERIFICA: cambio alguna columna distinta de country_id (updated_at incluido)';
  END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c WHERE NOT (c.id = ANY (v_lista))) IS DISTINCT FROM current_setting('s7_95rb.filas_fuera') THEN
    RAISE EXCEPTION 'rollback s7_95 VERIFICA: cambio alguna clinica fuera de la lista';
  END IF;
  SELECT count(*) INTO v_i FROM public.audit_log a
   WHERE a.id > current_setting('s7_95rb.audit_max')::bigint AND a.record_id = ANY (v_lista)
     AND a.new_data ->> 'edited_via' = 'owner_attestation_f3e0_rollback' AND a.new_data ->> 'migration' = 's7_95';
  IF v_i <> v_n THEN
    RAISE EXCEPTION 'rollback s7_95 VERIFICA: % filas de auditoria de reversion', v_i;
  END IF;
  SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
           || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  RAISE NOTICE 'rollback s7_95 OK — % clinicas en S0, estado del preflight H restaurado; C2 actual = % (igual a la de H solo si ninguna otra clinica cambio desde entonces)', v_n, v_txt;
END $VERIFICA$;

COMMIT;
