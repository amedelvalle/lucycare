-- ============================================================
-- s7_95 · MULTICOUNTRY-GEO-P0 · F3E-0 · M0.5
-- Pais atestado por el owner para 36 clinicas del lote Importar_100
-- ============================================================
--
-- Migracion 116. Backfill controlado de DATOS: asigna country_id = SV a las 36
-- clinicas de los 36 medicos publicados del lote tecnico Importar_100
-- (2026-05-21), sin territorio y sin legacy. Resultado: estado S2
-- (country_id = SV, territory_unit_id NULL, department_id y municipality_id NULL).
--
-- ── EVIDENCIA Y ATESTACION ──
--   · Pertenencia al lote: MEDIDA (preflights E y H de produccion, 2026-09-15):
--     100 altas en la ventana 13:58:28 .. 13:59:37 (-06), commit b794761,
--     hoja Importar_100; los 36 son los publicados del lote con clinica sin pais.
--   · Pais SV: ATESTACION EXPLICITA DEL OWNER («la base importada corresponde
--     unicamente a medicos de El Salvador»). NO procede de ninguna fuente oficial
--     ni de la direccion, el telefono, el nombre o la colegiacion.
--   · Territorio: DESCONOCIDO. No se asigna departamento, municipio ni distrito.
--   · Preflight H: 36 medicos, 36 clinicas unicas, 0 compartidas, 36 en S0,
--     0 diferencias con el preflight B; huellas incrustadas abajo.
--
-- ── DECISIONES DEL OWNER (M0.5, 2026-09-15) ──
--   · sin comportamiento runtime permanente nuevo: al COMMIT, el cuerpo de
--     _clinics_territory_sync() y los triggers de clinics son los de s7_92;
--     sin tablas, funciones, RPC, grants ni policies nuevas (M1 y M2 descartadas);
--   · updated_at preservado (precedente C1 de s7_93);
--   · una fila de audit_log por clinica, autor = perfil admin confirmado por el
--     owner, con la procedencia explicita y sin datos personales;
--   · riesgo residual aceptado: un escritor autorizado de la fila (dueno por RLS
--     o service_role) puede vaciar el pais de una S2 y dejarla en S0, igual que
--     hoy puede vaciar la ubicacion de una S1. Lo detecta la verificacion del
--     invariante v2 (docs/smokes/s7_95_territorial_invariant_readonly.sql);
--   · el caso D (medico seed del 2026-09-14) NO entra: se resolvera cargando su
--     ubicacion real en LucyAdmin.
--
-- ── POR QUE SE DESACTIVAN LOS TRIGGERS DENTRO DE LA TRANSACCION ──
-- El trigger de s7_92 rechaza (P0183) cualquier pais que no derive del legacy.
-- La unica forma de registrar S2 sin cambiar su cuerpo es desactivarlo durante
-- el UPDATE. Medido en el arnes:
--   · DISABLE TRIGGER pide SHARE ROW EXCLUSIVE, el mismo lock ya tomado;
--   · otra sesion sigue viendo los triggers en [O] durante la transaccion;
--   · los escritores concurrentes esperan al lock y, tras el COMMIT, el trigger
--     vuelve a actuar para ellos (P0183); los lectores no se bloquean;
--   · cualquier error aborta la transaccion entera y deja los triggers en [O].
-- Se bloquea tambien doctors: el conjunto se define por doctors.clinic_id e
-- is_published, y no puede cambiar entre la guarda y el COMMIT.
--
-- ── ROLLBACK ──
-- docs/rollbacks/s7_95_rollback.sql. Cadena vigente:
--   s7_95 -> s7_94 -> s7_93 R2 -> verificar estado -> s7_92.
-- La VERIFICA del rollback de s7_92 exige 0 clinicas con pais: requiere revertir
-- antes s7_95 y s7_93. La auditoria es append-only: el rollback no borra las 36
-- filas, anade 36 de reversion.
--
-- ── VERIFICADORES HISTORICOS ──
-- Los POST ya ejecutados de s7_92 y s7_93, y la fila 41 de
-- docs/smokes/s7_94_post_verification_readonly.sql, se disenaron antes de S2 y
-- NO describen el invariante nuevo (contarian las 36 como divergencias o su
-- huella C2 cambiara). No se modifican. El invariante vigente lo mide
-- docs/smokes/s7_95_territorial_invariant_readonly.sql.
--
-- ── COMO APLICARLA ──
-- BLOQUES AUTONOMOS, cada uno pegado ENTERO en una pestaña nueva:
--   PASO 1 = seccion 0      · guardas PRE · solo lectura
--   PASO 2 = secciones 1-7  · BEGIN -> ... -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar. Ante cualquier error del editor,
-- clasificar primero con docs/smokes/s7_95_state_readonly.sql.
-- Runbook: docs/OWNER_S7_95_APPLY.md.


-- ─── 0. Guardas PRE (solo lectura) ──────────────────────────
DO $PRE$
DECLARE
  -- Constantes del preflight H de produccion (2026-09-15), aprobadas por el owner.
  v_pares            CONSTANT text :=
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
  v_n                CONSTANT int := 36;
  v_sha_pares        CONSTANT text := '68ff3c1509311c975e22b1df77990622a7247a7a1840e9c76ae7833062f7303c';
  v_sha_clinicas     CONSTANT text := '783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8';
  v_sha_estado       CONSTANT text := 'e12195c655220975ce87fabc6c4e8875bfa4ef59427c018a2f26532051819a18';
  v_huella_c2        CONSTANT text := '7c823ad1f5c30fc7a2b5a33fe62c68a7';
  v_ventana_ini      CONSTANT timestamptz := '2026-05-21 13:58:28.852053-06';
  v_ventana_fin      CONSTANT timestamptz := '2026-05-21 13:59:37.125681-06';
  v_lote             CONSTANT int := 100;
  v_publicados       CONSTANT text := '46|9|37';
  v_visibles         CONSTANT text := '43|8|35';
  v_publicados_post  CONSTANT text := '46|45|1';
  v_visibles_post    CONSTANT text := '43|42|1';
  v_owner            CONSTANT uuid := '739cac58-4ad2-4efe-9fbf-91921e208b8f';
  v_relacl           CONSTANT text := '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}|true|false';
  v_policies_prefijo CONSTANT text := '20ad37b9';
  v_escritores       CONSTANT text := 'admin_approve_and_create_doctor,admin_create_seed_doctor,admin_update_doctor_clinic';
  v_fn_md5           CONSTANT text[] := ARRAY['d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202'];
  v_sv  smallint;
  v_i   bigint;
  v_txt text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_95 PRE: ejecutar como postgres (current_user=%)', current_user;
  END IF;

  -- Lista literal: v_n pares con doctores y clinicas distintos y las huellas del preflight H.
  SELECT count(*) || '|' || count(DISTINCT l.d) || '|' || count(DISTINCT l.c) || '|'
         || encode(sha256(convert_to(string_agg(l.d || '|' || l.c, E'\n' ORDER BY l.d), 'UTF8')), 'hex')
    INTO v_txt
    FROM (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x) l;
  IF v_txt IS DISTINCT FROM v_n || '|' || v_n || '|' || v_n || '|' || v_sha_pares THEN
    RAISE EXCEPTION 's7_95 PRE: la lista literal no es la del preflight H (%)', v_txt;
  END IF;
  SELECT encode(sha256(convert_to(string_agg(l.c::text, E'\n' ORDER BY l.c), 'UTF8')), 'hex')
    INTO v_txt
    FROM (SELECT split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x) l;
  IF v_txt IS DISTINCT FROM v_sha_clinicas THEN
    RAISE EXCEPTION 's7_95 PRE: la huella de la lista de clinicas no es la del preflight H (%)', v_txt;
  END IF;

  -- Lote Importar_100: la ventana exacta del preflight E sigue teniendo v_lote medicos.
  SELECT count(*) INTO v_i FROM public.doctors d WHERE d.created_at >= v_ventana_ini AND d.created_at <= v_ventana_fin;
  IF v_i <> v_lote THEN
    RAISE EXCEPTION 's7_95 PRE: la ventana del lote tiene % medicos, se esperaban %', v_i, v_lote;
  END IF;

  -- Conjunto vivo (lote, publicado, clinica sin pais) = lista literal, par a par.
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x),
       cand AS (SELECT d.id AS d, d.clinic_id AS c FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id
                 WHERE d.is_published AND c.country_id IS NULL AND d.created_at >= v_ventana_ini AND d.created_at <= v_ventana_fin)
  SELECT (SELECT count(*) FROM (SELECT d, c FROM cand EXCEPT SELECT d, c FROM l) s) || '|'
      || (SELECT count(*) FROM (SELECT d, c FROM l EXCEPT SELECT d, c FROM cand) f)
    INTO v_txt;
  IF v_txt IS DISTINCT FROM '0|0' THEN
    RAISE EXCEPTION 's7_95 PRE: el conjunto vivo no coincide con la lista (sobran|faltan = %)', v_txt;
  END IF;

  -- Las v_n clinicas siguen en S0 y ninguna la usa un medico fuera de la lista.
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x)
  SELECT (SELECT count(*) FROM public.clinics c WHERE c.id IN (SELECT l.c FROM l)
             AND c.department_id IS NULL AND c.municipality_id IS NULL AND c.country_id IS NULL AND c.territory_unit_id IS NULL) || '|'
      || (SELECT count(*) FROM public.doctors d WHERE d.clinic_id IN (SELECT l.c FROM l) AND d.id NOT IN (SELECT l.d FROM l))
    INTO v_txt;
  IF v_txt IS DISTINCT FROM v_n || '|0' THEN
    RAISE EXCEPTION 's7_95 PRE: S0 de la lista | clinicas compartidas = % (se esperaba %|0)', v_txt, v_n;
  END IF;

  -- Huella del estado del conjunto (formula de la fila 42 del preflight H).
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x)
  SELECT encode(sha256(convert_to(string_agg(d.id || '|' || c.id || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
           || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL') || '|' || coalesce(c.owner_id::text, 'NULL') || '|'
           || coalesce(d.profile_id::text, 'NULL') || '|' || (extract(epoch FROM c.updated_at) * 1000000)::bigint, E'\n' ORDER BY d.id), 'UTF8')), 'hex')
    INTO v_txt
    FROM l JOIN public.doctors d ON d.id = l.d JOIN public.clinics c ON c.id = l.c;
  IF v_txt IS DISTINCT FROM v_sha_estado THEN
    RAISE EXCEPTION 's7_95 PRE: el estado del conjunto cambio desde el preflight H (%)', v_txt;
  END IF;

  -- Huella C2 de todas las clinicas (formula de s7_93): ninguna ubicacion cambio desde H.
  SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
           || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM v_huella_c2 THEN
    RAISE EXCEPTION 's7_95 PRE: la huella C2 de clinics cambio desde el preflight H (%)', v_txt;
  END IF;
  SELECT count(*) INTO v_i FROM public.clinics c WHERE c.department_id IS NULL AND c.country_id IS NOT NULL;
  IF v_i <> 0 THEN
    RAISE EXCEPTION 's7_95 PRE: ya existen % clinicas con pais sin legacy', v_i;
  END IF;

  -- Directorio igual al del preflight H (publicados y visibles D1: total|con pais|sin pais).
  SELECT count(*) || '|' || count(*) FILTER (WHERE c.country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE c.country_id IS NULL) || '#'
      || count(*) FILTER (WHERE coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '') || '|'
      || count(*) FILTER (WHERE c.country_id IS NOT NULL AND coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '') || '|'
      || count(*) FILTER (WHERE c.country_id IS NULL AND coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '')
    INTO v_txt
    FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id LEFT JOIN public.profiles p ON p.id = d.profile_id
   WHERE d.is_published;
  IF v_txt IS DISTINCT FROM v_publicados || '#' || v_visibles THEN
    RAISE EXCEPTION 's7_95 PRE: el directorio cambio desde el preflight H (%)', v_txt;
  END IF;

  -- Autor de la auditoria: el perfil confirmado por el owner, admin y activo.
  SELECT count(*) INTO v_i FROM public.profiles p WHERE p.id = v_owner AND p.role::text = 'admin' AND p.is_active;
  IF v_i <> 1 THEN
    RAISE EXCEPTION 's7_95 PRE: el perfil autor no existe, no es admin o no esta activo';
  END IF;

  -- SV desde el catalogo por iso_alpha2, y coherente con el pais de todas las clinicas S1.
  SELECT co.id INTO STRICT v_sv FROM public.countries co WHERE co.iso_alpha2 = 'SV';
  SELECT count(*) FILTER (WHERE c.country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE c.country_id IS NOT NULL AND c.country_id <> v_sv)
    INTO v_txt FROM public.clinics c;
  IF split_part(v_txt, '|', 1)::int = 0 OR split_part(v_txt, '|', 2) <> '0' THEN
    RAISE EXCEPTION 's7_95 PRE: el id de SV no coincide con el pais de las clinicas S1 (con pais|otro pais = %)', v_txt;
  END IF;

  -- Runtime de s7_92 intacto.
  SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_95 PRE: triggers de clinics inesperados (%)', v_txt;
  END IF;
  SELECT count(*) INTO v_i FROM pg_trigger t
   WHERE t.tgrelid = 'public.clinics'::regclass AND t.tgname = 'trg_clinics_territory_sync'
     AND pg_get_triggerdef(t.oid) LIKE '% BEFORE INSERT OR UPDATE OF department_id, municipality_id, country_id, territory_unit_id ON public.clinics FOR EACH ROW EXECUTE FUNCTION %_clinics_territory_sync()';
  IF v_i <> 1 THEN
    RAISE EXCEPTION 's7_95 PRE: la definicion de trg_clinics_territory_sync no es la de s7_92';
  END IF;
  SELECT count(*) INTO v_i FROM pg_proc p
   WHERE p.oid = 'public._clinics_territory_sync()'::regprocedure
     AND md5(p.prosrc) = ANY (v_fn_md5) AND p.prosecdef
     AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp' AND p.proacl::text = '{postgres=X/postgres}';
  IF v_i <> 1 THEN
    RAISE EXCEPTION 's7_95 PRE: _clinics_territory_sync no es la de s7_92 (cuerpo, SECURITY DEFINER, search_path o ACL)';
  END IF;

  -- Seguridad de clinics igual a la del preflight H.
  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity INTO v_txt
    FROM pg_class WHERE oid = 'public.clinics'::regclass;
  IF v_txt IS DISTINCT FROM v_relacl THEN
    RAISE EXCEPTION 's7_95 PRE: ACL o RLS de clinics cambio (%)', v_txt;
  END IF;
  SELECT md5(coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' ORDER BY policyname), ''))
    INTO v_txt FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics';
  IF left(v_txt, 8) IS DISTINCT FROM v_policies_prefijo THEN
    RAISE EXCEPTION 's7_95 PRE: las policies de clinics cambiaron (%)', v_txt;
  END IF;

  -- Sin escritores ni consumidores nuevos.
  SELECT string_agg(DISTINCT p.proname, ',' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?clinics\M';
  IF v_txt IS DISTINCT FROM v_escritores THEN
    RAISE EXCEPTION 's7_95 PRE: escritores de clinics inesperados (%)', v_txt;
  END IF;
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
             AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\M')
       + (SELECT count(*) FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
           WHERE dp.classid = 'pg_rewrite'::regclass AND dp.refobjid = 'public.clinics'::regclass AND a.attname IN ('country_id', 'territory_unit_id'))
       + (SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(country_id|territory_unit_id)\M')
       + (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal AND t.tgrelid <> 'public.clinics'::regclass AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?clinics\M')
    INTO v_i;
  IF v_i <> 0 THEN
    RAISE EXCEPTION 's7_95 PRE: % consumidores o escritores nuevos del modelo territorial', v_i;
  END IF;

  -- La sesion puede escribir la auditoria (se comprueba antes de desactivar nada): INSERT en
  -- audit_log, USAGE de su secuencia y RLS de audit_log no forzada o rol con BYPASSRLS (s7_71b).
  SELECT (has_table_privilege(current_user, 'public.audit_log', 'INSERT')
          AND coalesce(has_sequence_privilege(current_user, pg_get_serial_sequence('public.audit_log', 'id'), 'USAGE'), true)
          AND ((SELECT NOT (c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c WHERE c.oid = 'public.audit_log'::regclass)
               OR (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user)))::text
    INTO v_txt;
  IF v_txt IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 's7_95 PRE: % no puede escribir en audit_log (INSERT, secuencia o RLS) — la auditoria es obligatoria', current_user;
  END IF;

  -- No aplicada (o revertida): las filas de auditoria de aplicacion y de reversion se compensan.
  SELECT count(*) FILTER (WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0')
       - count(*) FILTER (WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0_rollback')
    INTO v_i FROM public.audit_log a WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95';
  IF v_i <> 0 THEN
    RAISE EXCEPTION 's7_95 PRE: s7_95 ya esta aplicada (% filas netas de auditoria) — no reaplicar', v_i;
  END IF;
  RAISE NOTICE 's7_95 PRE OK — lista, huellas, directorio, autor, SV, runtime, seguridad y consumidores como en el preflight H';
END $PRE$;


-- ─── 1. Transaccion y locks ─────────────────────────────────
BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.doctors IN SHARE ROW EXCLUSIVE MODE;


-- ─── 2. Guarda bajo lock y huellas para el POST ─────────────
DO $GUARDA$
DECLARE
  -- Constantes del preflight H de produccion (2026-09-15), aprobadas por el owner.
  v_pares            CONSTANT text :=
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
  v_n                CONSTANT int := 36;
  v_sha_pares        CONSTANT text := '68ff3c1509311c975e22b1df77990622a7247a7a1840e9c76ae7833062f7303c';
  v_sha_clinicas     CONSTANT text := '783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8';
  v_sha_estado       CONSTANT text := 'e12195c655220975ce87fabc6c4e8875bfa4ef59427c018a2f26532051819a18';
  v_huella_c2        CONSTANT text := '7c823ad1f5c30fc7a2b5a33fe62c68a7';
  v_ventana_ini      CONSTANT timestamptz := '2026-05-21 13:58:28.852053-06';
  v_ventana_fin      CONSTANT timestamptz := '2026-05-21 13:59:37.125681-06';
  v_lote             CONSTANT int := 100;
  v_publicados       CONSTANT text := '46|9|37';
  v_visibles         CONSTANT text := '43|8|35';
  v_publicados_post  CONSTANT text := '46|45|1';
  v_visibles_post    CONSTANT text := '43|42|1';
  v_owner            CONSTANT uuid := '739cac58-4ad2-4efe-9fbf-91921e208b8f';
  v_relacl           CONSTANT text := '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}|true|false';
  v_policies_prefijo CONSTANT text := '20ad37b9';
  v_escritores       CONSTANT text := 'admin_approve_and_create_doctor,admin_create_seed_doctor,admin_update_doctor_clinic';
  v_fn_md5           CONSTANT text[] := ARRAY['d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202'];
  v_sv  smallint;
  v_i   bigint;
  v_txt text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_95 GUARDA: ejecutar como postgres (current_user=%)', current_user;
  END IF;

  -- Lista literal: v_n pares con doctores y clinicas distintos y las huellas del preflight H.
  SELECT count(*) || '|' || count(DISTINCT l.d) || '|' || count(DISTINCT l.c) || '|'
         || encode(sha256(convert_to(string_agg(l.d || '|' || l.c, E'\n' ORDER BY l.d), 'UTF8')), 'hex')
    INTO v_txt
    FROM (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x) l;
  IF v_txt IS DISTINCT FROM v_n || '|' || v_n || '|' || v_n || '|' || v_sha_pares THEN
    RAISE EXCEPTION 's7_95 GUARDA: la lista literal no es la del preflight H (%)', v_txt;
  END IF;
  SELECT encode(sha256(convert_to(string_agg(l.c::text, E'\n' ORDER BY l.c), 'UTF8')), 'hex')
    INTO v_txt
    FROM (SELECT split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x) l;
  IF v_txt IS DISTINCT FROM v_sha_clinicas THEN
    RAISE EXCEPTION 's7_95 GUARDA: la huella de la lista de clinicas no es la del preflight H (%)', v_txt;
  END IF;

  -- Lote Importar_100: la ventana exacta del preflight E sigue teniendo v_lote medicos.
  SELECT count(*) INTO v_i FROM public.doctors d WHERE d.created_at >= v_ventana_ini AND d.created_at <= v_ventana_fin;
  IF v_i <> v_lote THEN
    RAISE EXCEPTION 's7_95 GUARDA: la ventana del lote tiene % medicos, se esperaban %', v_i, v_lote;
  END IF;

  -- Conjunto vivo (lote, publicado, clinica sin pais) = lista literal, par a par.
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x),
       cand AS (SELECT d.id AS d, d.clinic_id AS c FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id
                 WHERE d.is_published AND c.country_id IS NULL AND d.created_at >= v_ventana_ini AND d.created_at <= v_ventana_fin)
  SELECT (SELECT count(*) FROM (SELECT d, c FROM cand EXCEPT SELECT d, c FROM l) s) || '|'
      || (SELECT count(*) FROM (SELECT d, c FROM l EXCEPT SELECT d, c FROM cand) f)
    INTO v_txt;
  IF v_txt IS DISTINCT FROM '0|0' THEN
    RAISE EXCEPTION 's7_95 GUARDA: el conjunto vivo no coincide con la lista (sobran|faltan = %)', v_txt;
  END IF;

  -- Las v_n clinicas siguen en S0 y ninguna la usa un medico fuera de la lista.
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x)
  SELECT (SELECT count(*) FROM public.clinics c WHERE c.id IN (SELECT l.c FROM l)
             AND c.department_id IS NULL AND c.municipality_id IS NULL AND c.country_id IS NULL AND c.territory_unit_id IS NULL) || '|'
      || (SELECT count(*) FROM public.doctors d WHERE d.clinic_id IN (SELECT l.c FROM l) AND d.id NOT IN (SELECT l.d FROM l))
    INTO v_txt;
  IF v_txt IS DISTINCT FROM v_n || '|0' THEN
    RAISE EXCEPTION 's7_95 GUARDA: S0 de la lista | clinicas compartidas = % (se esperaba %|0)', v_txt, v_n;
  END IF;

  -- Huella del estado del conjunto (formula de la fila 42 del preflight H).
  WITH l AS (SELECT split_part(x, '|', 1)::uuid AS d, split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x)
  SELECT encode(sha256(convert_to(string_agg(d.id || '|' || c.id || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
           || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL') || '|' || coalesce(c.owner_id::text, 'NULL') || '|'
           || coalesce(d.profile_id::text, 'NULL') || '|' || (extract(epoch FROM c.updated_at) * 1000000)::bigint, E'\n' ORDER BY d.id), 'UTF8')), 'hex')
    INTO v_txt
    FROM l JOIN public.doctors d ON d.id = l.d JOIN public.clinics c ON c.id = l.c;
  IF v_txt IS DISTINCT FROM v_sha_estado THEN
    RAISE EXCEPTION 's7_95 GUARDA: el estado del conjunto cambio desde el preflight H (%)', v_txt;
  END IF;

  -- Huella C2 de todas las clinicas (formula de s7_93): ninguna ubicacion cambio desde H.
  SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
           || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM v_huella_c2 THEN
    RAISE EXCEPTION 's7_95 GUARDA: la huella C2 de clinics cambio desde el preflight H (%)', v_txt;
  END IF;
  SELECT count(*) INTO v_i FROM public.clinics c WHERE c.department_id IS NULL AND c.country_id IS NOT NULL;
  IF v_i <> 0 THEN
    RAISE EXCEPTION 's7_95 GUARDA: ya existen % clinicas con pais sin legacy', v_i;
  END IF;

  -- Directorio igual al del preflight H (publicados y visibles D1: total|con pais|sin pais).
  SELECT count(*) || '|' || count(*) FILTER (WHERE c.country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE c.country_id IS NULL) || '#'
      || count(*) FILTER (WHERE coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '') || '|'
      || count(*) FILTER (WHERE c.country_id IS NOT NULL AND coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '') || '|'
      || count(*) FILTER (WHERE c.country_id IS NULL AND coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '')
    INTO v_txt
    FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id LEFT JOIN public.profiles p ON p.id = d.profile_id
   WHERE d.is_published;
  IF v_txt IS DISTINCT FROM v_publicados || '#' || v_visibles THEN
    RAISE EXCEPTION 's7_95 GUARDA: el directorio cambio desde el preflight H (%)', v_txt;
  END IF;

  -- Autor de la auditoria: el perfil confirmado por el owner, admin y activo.
  SELECT count(*) INTO v_i FROM public.profiles p WHERE p.id = v_owner AND p.role::text = 'admin' AND p.is_active;
  IF v_i <> 1 THEN
    RAISE EXCEPTION 's7_95 GUARDA: el perfil autor no existe, no es admin o no esta activo';
  END IF;

  -- SV desde el catalogo por iso_alpha2, y coherente con el pais de todas las clinicas S1.
  SELECT co.id INTO STRICT v_sv FROM public.countries co WHERE co.iso_alpha2 = 'SV';
  SELECT count(*) FILTER (WHERE c.country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE c.country_id IS NOT NULL AND c.country_id <> v_sv)
    INTO v_txt FROM public.clinics c;
  IF split_part(v_txt, '|', 1)::int = 0 OR split_part(v_txt, '|', 2) <> '0' THEN
    RAISE EXCEPTION 's7_95 GUARDA: el id de SV no coincide con el pais de las clinicas S1 (con pais|otro pais = %)', v_txt;
  END IF;

  -- Runtime de s7_92 intacto.
  SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_95 GUARDA: triggers de clinics inesperados (%)', v_txt;
  END IF;
  SELECT count(*) INTO v_i FROM pg_trigger t
   WHERE t.tgrelid = 'public.clinics'::regclass AND t.tgname = 'trg_clinics_territory_sync'
     AND pg_get_triggerdef(t.oid) LIKE '% BEFORE INSERT OR UPDATE OF department_id, municipality_id, country_id, territory_unit_id ON public.clinics FOR EACH ROW EXECUTE FUNCTION %_clinics_territory_sync()';
  IF v_i <> 1 THEN
    RAISE EXCEPTION 's7_95 GUARDA: la definicion de trg_clinics_territory_sync no es la de s7_92';
  END IF;
  SELECT count(*) INTO v_i FROM pg_proc p
   WHERE p.oid = 'public._clinics_territory_sync()'::regprocedure
     AND md5(p.prosrc) = ANY (v_fn_md5) AND p.prosecdef
     AND array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp' AND p.proacl::text = '{postgres=X/postgres}';
  IF v_i <> 1 THEN
    RAISE EXCEPTION 's7_95 GUARDA: _clinics_territory_sync no es la de s7_92 (cuerpo, SECURITY DEFINER, search_path o ACL)';
  END IF;

  -- Seguridad de clinics igual a la del preflight H.
  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity INTO v_txt
    FROM pg_class WHERE oid = 'public.clinics'::regclass;
  IF v_txt IS DISTINCT FROM v_relacl THEN
    RAISE EXCEPTION 's7_95 GUARDA: ACL o RLS de clinics cambio (%)', v_txt;
  END IF;
  SELECT md5(coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' ORDER BY policyname), ''))
    INTO v_txt FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics';
  IF left(v_txt, 8) IS DISTINCT FROM v_policies_prefijo THEN
    RAISE EXCEPTION 's7_95 GUARDA: las policies de clinics cambiaron (%)', v_txt;
  END IF;

  -- Sin escritores ni consumidores nuevos.
  SELECT string_agg(DISTINCT p.proname, ',' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?clinics\M';
  IF v_txt IS DISTINCT FROM v_escritores THEN
    RAISE EXCEPTION 's7_95 GUARDA: escritores de clinics inesperados (%)', v_txt;
  END IF;
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
             AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\M')
       + (SELECT count(*) FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
           WHERE dp.classid = 'pg_rewrite'::regclass AND dp.refobjid = 'public.clinics'::regclass AND a.attname IN ('country_id', 'territory_unit_id'))
       + (SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(country_id|territory_unit_id)\M')
       + (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal AND t.tgrelid <> 'public.clinics'::regclass AND p.prosrc ~* '(insert\s+into|update)\s+(public\.)?clinics\M')
    INTO v_i;
  IF v_i <> 0 THEN
    RAISE EXCEPTION 's7_95 GUARDA: % consumidores o escritores nuevos del modelo territorial', v_i;
  END IF;

  -- La sesion puede escribir la auditoria (se comprueba antes de desactivar nada): INSERT en
  -- audit_log, USAGE de su secuencia y RLS de audit_log no forzada o rol con BYPASSRLS (s7_71b).
  SELECT (has_table_privilege(current_user, 'public.audit_log', 'INSERT')
          AND coalesce(has_sequence_privilege(current_user, pg_get_serial_sequence('public.audit_log', 'id'), 'USAGE'), true)
          AND ((SELECT NOT (c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c WHERE c.oid = 'public.audit_log'::regclass)
               OR (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user)))::text
    INTO v_txt;
  IF v_txt IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 's7_95 GUARDA: % no puede escribir en audit_log (INSERT, secuencia o RLS) — la auditoria es obligatoria', current_user;
  END IF;

  -- No aplicada (o revertida): las filas de auditoria de aplicacion y de reversion se compensan.
  SELECT count(*) FILTER (WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0')
       - count(*) FILTER (WHERE a.new_data ->> 'edited_via' = 'owner_attestation_f3e0_rollback')
    INTO v_i FROM public.audit_log a WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95';
  IF v_i <> 0 THEN
    RAISE EXCEPTION 's7_95 GUARDA: s7_95 ya esta aplicada (% filas netas de auditoria) — no reaplicar', v_i;
  END IF;

  -- Parametros para BACKFILL y POST (locales a la transaccion).
  PERFORM set_config('s7_95.n', v_n::text, true);
  PERFORM set_config('s7_95.sv', v_sv::text, true);
  PERFORM set_config('s7_95.owner', v_owner::text, true);
  PERFORM set_config('s7_95.sha_pares', v_sha_pares, true);
  PERFORM set_config('s7_95.sha_clinicas', v_sha_clinicas, true);
  PERFORM set_config('s7_95.huella_c2', v_huella_c2, true);
  PERFORM set_config('s7_95.publicados_post', v_publicados_post, true);
  PERFORM set_config('s7_95.visibles_post', v_visibles_post, true);
  PERFORM set_config('s7_95.clinicas',
    (SELECT string_agg(l.c::text, ',' ORDER BY l.c) FROM (SELECT split_part(x, '|', 2)::uuid AS c FROM unnest(string_to_array(v_pares, ' ; ')) x) l), true);

  -- Huellas del estado previo (misma sesion: to_jsonb es comparable dentro de la transaccion).
  PERFORM set_config('s7_95.fn',
    (SELECT md5(p.prosrc) || '|' || p.oid || '|' || coalesce(p.proacl::text, 'NULL') || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), 'NULL')
       FROM pg_proc p WHERE p.oid = 'public._clinics_territory_sync()'::regprocedure), true);
  PERFORM set_config('s7_95.triggers',
    (SELECT string_agg(t.oid || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text, ';' ORDER BY t.tgname)
       FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal), true);
  PERFORM set_config('s7_95.seguridad',
    (SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity FROM pg_class WHERE oid = 'public.clinics'::regclass)
    || '|' || (SELECT md5(coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' ORDER BY policyname), ''))
                 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics')
    || '|' || (SELECT md5(coalesce(string_agg(a.attname || '=' || coalesce(a.attacl::text, 'NULL'), ',' ORDER BY a.attnum), ''))
                 FROM pg_attribute a WHERE a.attrelid = 'public.clinics'::regclass AND a.attnum > 0 AND NOT a.attisdropped), true);
  PERFORM set_config('s7_95.objetos',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
    || '|' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
    || '|' || (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal)
    || '|' || (SELECT count(*) FROM pg_policies)
    || '|' || (SELECT md5(coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(p.prosrc) || coalesce(p.proacl::text, ''), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), ''))
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'), true);
  PERFORM set_config('s7_95.filas_sin_pais',
    (SELECT md5(string_agg((to_jsonb(c) - 'country_id')::text, E'\n' ORDER BY c.id)) FROM public.clinics c), true);
  PERFORM set_config('s7_95.filas_fuera',
    (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c
      WHERE NOT (c.id = ANY (string_to_array(current_setting('s7_95.clinicas'), ',')::uuid[]))), true);
  PERFORM set_config('s7_95.publicados_sin_pais_fuera',
    (SELECT coalesce(string_agg(d.id::text, ',' ORDER BY d.id), '') FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id
      WHERE d.is_published AND c.country_id IS NULL AND NOT (c.id = ANY (string_to_array(current_setting('s7_95.clinicas'), ',')::uuid[]))), true);
  PERFORM set_config('s7_95.audit_max', (SELECT coalesce(max(a.id), 0)::text FROM public.audit_log a), true);

  RAISE NOTICE 's7_95 GUARDA OK — conjunto exacto bajo lock';
END $GUARDA$;


-- ─── 3. Desactivacion temporal de los triggers de clinics ───
ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_territory_sync;
ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;


-- ─── 4. Backfill del pais atestado y auditoria ──────────────
DO $BACKFILL$
DECLARE
  v_lista uuid[]   := string_to_array(current_setting('s7_95.clinicas'), ',')::uuid[];
  v_n     int      := current_setting('s7_95.n')::int;
  v_sv    smallint := current_setting('s7_95.sv')::smallint;
  v_owner uuid     := current_setting('s7_95.owner')::uuid;
  v_i     bigint;
BEGIN
  UPDATE public.clinics c
     SET country_id = v_sv
   WHERE c.id = ANY (v_lista)
     AND c.department_id IS NULL AND c.municipality_id IS NULL
     AND c.country_id IS NULL AND c.territory_unit_id IS NULL;
  GET DIAGNOSTICS v_i = ROW_COUNT;
  IF v_i <> v_n THEN
    RAISE EXCEPTION 's7_95 BACKFILL: se actualizaron % clinicas, se esperaban %', v_i, v_n;
  END IF;

  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  SELECT v_owner, 'update', 'clinics', x.id,
         jsonb_build_object('country_id', NULL, 'territory_unit_id', NULL, 'department_id', NULL, 'municipality_id', NULL),
         jsonb_build_object(
           'country_id', v_sv,
           'country_iso', 'SV',
           'territory_unit_id', NULL,
           'edited_via', 'owner_attestation_f3e0',
           'migration', 's7_95',
           'source', 'owner_attestation',
           'batch', 'Importar_100',
           'batch_membership', 'measured',
           'territory', 'unknown',
           'evidence', 'preflights E y H de produccion 2026-09-15; pares sha256 ' || current_setting('s7_95.sha_pares'))
    FROM unnest(v_lista) AS x(id);
  GET DIAGNOSTICS v_i = ROW_COUNT;
  IF v_i <> v_n THEN
    RAISE EXCEPTION 's7_95 BACKFILL: % filas de auditoria, se esperaban %', v_i, v_n;
  END IF;
END $BACKFILL$;


-- ─── 5. Reactivacion de los triggers antes del POST ─────────
ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_territory_sync;
ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;


-- ─── 6. POST ────────────────────────────────────────────────
DO $POST$
DECLARE
  v_lista uuid[]   := string_to_array(current_setting('s7_95.clinicas'), ',')::uuid[];
  v_n     int      := current_setting('s7_95.n')::int;
  v_sv    smallint := current_setting('s7_95.sv')::smallint;
  v_owner uuid     := current_setting('s7_95.owner')::uuid;
  v_i     bigint;
  v_txt   text;
BEGIN
  -- Runtime identico al previo.
  IF (SELECT md5(p.prosrc) || '|' || p.oid || '|' || coalesce(p.proacl::text, 'NULL') || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), 'NULL')
        FROM pg_proc p WHERE p.oid = 'public._clinics_territory_sync()'::regprocedure) IS DISTINCT FROM current_setting('s7_95.fn') THEN
    RAISE EXCEPTION 's7_95 POST: _clinics_territory_sync cambio';
  END IF;
  IF (SELECT string_agg(t.oid || '|' || t.tgname || '|' || pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text, ';' ORDER BY t.tgname)
        FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM current_setting('s7_95.triggers') THEN
    RAISE EXCEPTION 's7_95 POST: los triggers de clinics cambiaron (OID, definicion o estado)';
  END IF;
  SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_95 POST: los triggers no quedaron en modo normal (%)', v_txt;
  END IF;

  -- Seguridad y objetos identicos: sin tablas, funciones, triggers, policies ni grants nuevos.
  IF ((SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity FROM pg_class WHERE oid = 'public.clinics'::regclass)
      || '|' || (SELECT md5(coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' ORDER BY policyname), ''))
                   FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics')
      || '|' || (SELECT md5(coalesce(string_agg(a.attname || '=' || coalesce(a.attacl::text, 'NULL'), ',' ORDER BY a.attnum), ''))
                   FROM pg_attribute a WHERE a.attrelid = 'public.clinics'::regclass AND a.attnum > 0 AND NOT a.attisdropped))
     IS DISTINCT FROM current_setting('s7_95.seguridad') THEN
    RAISE EXCEPTION 's7_95 POST: ACL, RLS, policies o privilegios de columna de clinics cambiaron';
  END IF;
  IF ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public')
      || '|' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
      || '|' || (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal)
      || '|' || (SELECT count(*) FROM pg_policies)
      || '|' || (SELECT md5(coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(p.prosrc) || coalesce(p.proacl::text, ''), ',' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), ''))
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'))
     IS DISTINCT FROM current_setting('s7_95.objetos') THEN
    RAISE EXCEPTION 's7_95 POST: aparecieron o cambiaron objetos (relaciones, funciones, triggers o policies)';
  END IF;

  -- Datos: solo cambio country_id de las v_n clinicas de la lista.
  IF (SELECT md5(string_agg((to_jsonb(c) - 'country_id')::text, E'\n' ORDER BY c.id)) FROM public.clinics c) IS DISTINCT FROM current_setting('s7_95.filas_sin_pais') THEN
    RAISE EXCEPTION 's7_95 POST: cambio alguna columna distinta de country_id (updated_at y legacy incluidos)';
  END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c WHERE NOT (c.id = ANY (v_lista))) IS DISTINCT FROM current_setting('s7_95.filas_fuera') THEN
    RAISE EXCEPTION 's7_95 POST: cambio alguna clinica fuera de la lista';
  END IF;
  SELECT count(*) INTO v_i FROM public.clinics c
   WHERE c.id = ANY (v_lista) AND c.country_id = v_sv AND c.territory_unit_id IS NULL AND c.department_id IS NULL AND c.municipality_id IS NULL;
  IF v_i <> v_n THEN
    RAISE EXCEPTION 's7_95 POST: % de % clinicas en S2 SV', v_i, v_n;
  END IF;
  -- C2 reconstruida: tratando el pais de la lista como NULL, es la huella del preflight H.
  SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
           || coalesce(CASE WHEN c.id = ANY (v_lista) THEN NULL ELSE c.country_id END::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM current_setting('s7_95.huella_c2') THEN
    RAISE EXCEPTION 's7_95 POST: la C2 reconstruida no es la del preflight H (%)', v_txt;
  END IF;

  -- Invariante territorial v2: S0, S1 coherente o S2 de la lista; nada mas.
  SELECT (SELECT count(*) FROM public.clinics c WHERE c.department_id IS NULL AND c.country_id IS NOT NULL AND NOT (c.id = ANY (v_lista)))
       + (SELECT count(*) FROM public.clinics c WHERE c.department_id IS NULL AND c.territory_unit_id IS NOT NULL)
       + (SELECT count(*) FROM public.clinics c WHERE c.department_id IS NULL AND c.municipality_id IS NOT NULL)
       + (SELECT count(*) FROM public.clinics c CROSS JOIN LATERAL public._territory_from_legacy_sv(c.department_id, c.municipality_id) t
           WHERE c.department_id IS NOT NULL AND (c.country_id IS DISTINCT FROM t.country_id OR c.territory_unit_id IS DISTINCT FROM t.territory_unit_id))
    INTO v_i;
  IF v_i <> 0 THEN
    RAISE EXCEPTION 's7_95 POST: % anomalias del invariante territorial v2', v_i;
  END IF;

  -- Auditoria: exactamente una fila por clinica, del owner, con la procedencia y sin mas claves.
  SELECT count(*) || '|' || count(DISTINCT a.record_id) || '|'
      || count(*) FILTER (WHERE a.user_id = v_owner AND a.action::text = 'update' AND a.record_id = ANY (v_lista)
                            AND a.old_data = jsonb_build_object('country_id', NULL, 'territory_unit_id', NULL, 'department_id', NULL, 'municipality_id', NULL)
                            AND (a.new_data ->> 'country_id')::smallint = v_sv AND a.new_data ->> 'country_iso' = 'SV'
                            AND a.new_data ? 'territory_unit_id' AND a.new_data -> 'territory_unit_id' = 'null'::jsonb
                            AND a.new_data ->> 'edited_via' = 'owner_attestation_f3e0' AND a.new_data ->> 'source' = 'owner_attestation'
                            AND a.new_data ->> 'batch' = 'Importar_100' AND a.new_data ->> 'territory' = 'unknown'
                            AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(a.new_data) k)
                                = ARRAY['batch', 'batch_membership', 'country_id', 'country_iso', 'edited_via', 'evidence', 'migration', 'source', 'territory', 'territory_unit_id'])
    INTO v_txt
    FROM public.audit_log a WHERE a.id > current_setting('s7_95.audit_max')::bigint;
  IF v_txt IS DISTINCT FROM v_n || '|' || v_n || '|' || v_n THEN
    RAISE EXCEPTION 's7_95 POST: auditoria inesperada (filas|clinicas|validas = %)', v_txt;
  END IF;

  -- Directorio: publicados y visibles D1 (total|con pais|sin pais) y quien sigue sin pais.
  SELECT count(*) || '|' || count(*) FILTER (WHERE c.country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE c.country_id IS NULL) || '#'
      || count(*) FILTER (WHERE coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '') || '|'
      || count(*) FILTER (WHERE c.country_id IS NOT NULL AND coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '') || '|'
      || count(*) FILTER (WHERE c.country_id IS NULL AND coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
                            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '')
    INTO v_txt
    FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id LEFT JOIN public.profiles p ON p.id = d.profile_id
   WHERE d.is_published;
  IF v_txt IS DISTINCT FROM current_setting('s7_95.publicados_post') || '#' || current_setting('s7_95.visibles_post') THEN
    RAISE EXCEPTION 's7_95 POST: directorio inesperado tras el backfill (%)', v_txt;
  END IF;
  IF (SELECT coalesce(string_agg(d.id::text, ',' ORDER BY d.id), '') FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id
       WHERE d.is_published AND c.country_id IS NULL) IS DISTINCT FROM current_setting('s7_95.publicados_sin_pais_fuera') THEN
    RAISE EXCEPTION 's7_95 POST: los publicados que siguen sin pais no son los previstos';
  END IF;

  RAISE NOTICE 's7_95 POST OK — % clinicas en S2 SV, runtime de s7_92 intacto, % filas de auditoria, directorio %',
    v_n, v_n, current_setting('s7_95.publicados_post') || '#' || current_setting('s7_95.visibles_post');
END $POST$;


-- ─── 7. COMMIT ──────────────────────────────────────────────
COMMIT;
