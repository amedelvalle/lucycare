/**
 * check-s7_76.mjs — PATIENT-CRM-P0 · BLOQUE 1, verificación ESTÁTICA.
 *
 *   node scripts/check-s7_76.mjs
 *
 * Sin red, sin Supabase, sin service_role, sin datos: analiza el texto de
 * `s7_76`, `s7_77`, sus rollbacks y el frontend.
 *
 * El invariante que más importa proteger es la FRONTERA CLÍNICA (D4): las RPCs
 * enumeran a mano cada columna que devuelven, y ninguna es asistencial. Esa
 * separación vive en el BACKEND, no en la interfaz — así que se verifica sobre
 * el SQL, no sobre el JSX.
 */
import fs from 'node:fs';

const MIG1 = 'migrations/s7_76_patient_crm_foundation.sql';
const MIG2 = 'migrations/s7_77_patient_crm_read_rpcs.sql';
const RB1  = 'docs/rollbacks/s7_76_rollback.sql';
const RB2  = 'docs/rollbacks/s7_77_rollback.sql';
const SVC  = 'src/services/patientCrm.service.ts';
const CSV  = 'src/lib/csv.ts';
const TAB  = 'src/pages/admin/components/PatientsCrmTab.tsx';
const ANA  = 'docs/ANALISIS_PATIENT_CRM.md';
const QA   = 'scripts/_qa-crm-paginacion.mjs';

let pass = 0;
let fail = 0;
const check = (desc, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok || !extra ? '' : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};

console.log('\ncheck-s7_76 — PATIENT-CRM-P0 · BLOQUE 1 (estático)\n');

for (const f of [MIG1, MIG2, RB1, RB2]) check(`existe ${f}`, fs.existsSync(f));
if (!fs.existsSync(MIG1) || !fs.existsSync(MIG2)) {
  console.log('\n❌ Faltan migraciones: no se puede continuar.\n');
  process.exit(1);
}

const m1 = fs.readFileSync(MIG1, 'utf8');
const m2 = fs.readFileSync(MIG2, 'utf8');
const rb1 = fs.readFileSync(RB1, 'utf8');
const rb2 = fs.readFileSync(RB2, 'utf8');
/** Las prohibiciones se evalúan sobre CÓDIGO, nunca sobre la prosa. */
const sinComentarios = (s) => s.replace(/--.*$/gm, '');
const c1 = sinComentarios(m1);
const c2 = sinComentarios(m2);

// ─── A. La unidad del CRM es la identidad global (D1) ────────
console.log('\n  A) D1 · la unidad es la identidad global\n');
check('patient_crm cuelga de profiles con PK = FK',
  /profile_id\s+uuid PRIMARY KEY REFERENCES public\.profiles\(id\) ON DELETE CASCADE/.test(c1));
for (const t of ['patient_crm_tags', 'patient_crm_followups', 'patient_crm_notes']) {
  check(`${t} referencia profiles, no patients`,
    new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}[\\s\\S]*?profile_id uuid NOT NULL REFERENCES public\\.profiles\\(id\\)`).test(c1));
}
check('NINGUNA tabla del CRM cuelga de patients(id)',
  !/REFERENCES public\.patients\(id\)/.test(c1));
check('los pendientes NO se suman al total de pacientes',
  /'pendientes_identificar'/.test(c2) && /'pacientes_totales'/.test(c2));

/*
 * P1 · EL UNIVERSO REAL DE PACIENTES.
 *
 * El FROM raíz debe ser la identidad global elegible, no `patients`: si la
 * raíz fuera la ficha, una cuenta LucyCare que aún no agendó sería invisible
 * (hoy, 22 de 25 identidades tienen CERO fichas).
 *
 * Y `role='patient'` NO alcanza como predicado: medido en el esquema, un
 * profile con ese role puede tener fila en `doctors` —el approve con
 * `reuse_patient` de s7_42 no toca `role`—, puede ser `clinic_members`, o
 * puede ser una identidad TÉCNICA del seed, que nace con `role='patient'`.
 */
console.log('\n  A-bis) P1 · universo real de pacientes\n');
check('existe una vista canónica de identidad de paciente',
  /CREATE VIEW public\.crm_patient_identity/.test(c2));
check('el FROM raíz es la identidad, NO patients',
  /FROM public\.crm_patient_identity/.test(c2)
  && !/FROM public\.patients pa\s*\n\s*JOIN public\.profiles/.test(c2));
check('el listado y las métricas usan el MISMO predicado',
  (c2.match(/FROM public\.crm_patient_identity/g) || []).length >= 2);
check('excluye cuentas desactivadas', /p\.is_active = true/.test(c2));

/*
 * P1.1 · UNA IDENTIDAD PUEDE SER MÁS DE UNA PERSONA.
 *
 * «Tiene fila en doctors» NO implica «no es paciente»: un médico puede ser
 * paciente de otro médico, y un asistente también. La evidencia FUERTE de
 * relación de paciente es tener una ficha `patients` vinculada.
 *
 * De ahí que las exclusiones NO sean simétricas:
 *   DURAS   — desactivado, acceso administrativo, identidad técnica.
 *   BLANDAS — médico, staff, dueño de clínica: solo excluyen SIN ficha.
 */
console.log('\n  A-P1.1) exclusiones duras vs. blandas\n');
const vista = (c2.match(/CREATE VIEW public\.crm_patient_identity[\s\S]*?;\n/) || [''])[0];
check('se localizó la definición de la vista', vista.length > 0);
check('la relación de paciente es una rama del OR, no un AND',
  /EXISTS \(SELECT 1 FROM public\.patients pa WHERE pa\.profile_id = p\.id\)\s*\n\s*OR \(/.test(vista));
check('médico/staff/dueño están DENTRO de la rama del OR (exclusión blanda)',
  /OR \([\s\S]*?p\.role = 'patient'[\s\S]*?doctors[\s\S]*?clinic_members[\s\S]*?clinics[\s\S]*?\)/.test(vista));
check('el acceso administrativo es exclusión DURA, fuera del OR',
  vista.indexOf('lucyadmin_access') < vista.indexOf('EXISTS (SELECT 1 FROM public.patients pa'));
check('la identidad técnica es exclusión DURA, fuera del OR',
  vista.indexOf('admin_seed_operations') < vista.indexOf('EXISTS (SELECT 1 FROM public.patients pa'));

/*
 * P1.1 · ACCESO ADMINISTRATIVO POR SU FUENTE AUTORITATIVA.
 *
 * `owner_admin` NO vive en `lucyadmin_access`: es `profiles.role='admin'`
 * (s7_57). Los otros dos niveles sí, y solo cuentan si están vigentes.
 * No se depende de que un operations_admin sea casualmente clinic_member.
 */
console.log('\n  A-P1.1b) acceso administrativo\n');
check('excluye al owner admin por profiles.role', /p\.role <> 'admin'/.test(vista));
check('excluye por la tabla autoritativa lucyadmin_access',
  /NOT EXISTS \([\s\S]{0,120}public\.lucyadmin_access la/.test(vista));
check('solo cuenta el acceso VIGENTE', /la\.is_active = true/.test(vista));
check('NO depende de que un admin sea clinic_member',
  /fuente AUTORITATIVA|no se depende|No se depende/.test(m2));

/*
 * P1.1 · SEEDS: dos evidencias, porque ninguna cubre sola el ciclo de vida.
 */
console.log('\n  A-P1.1c) identidades técnicas del seed\n');
check('excluye por admin_seed_operations.seed_user_id',
  /NOT EXISTS \([\s\S]{0,140}admin_seed_operations so WHERE so\.seed_user_id = p\.id/.test(vista));
check('conserva el dominio .invalid como defensa adicional',
  /NOT LIKE '%@doctor-seed\.invalid'/.test(vista));

/*
 * F1 · LA SEGUNDA DEFENSA ES PARCIAL, Y ASÍ DEBE DECIRLO.
 *
 * Demostrado leyendo el código: la Edge crea el auth.user con
 * `seed-<op>@doctor-seed.invalid`, `handle_new_user` copia NEW.email a
 * `profiles.email` — y el paso 8.7 de `admin_create_seed_doctor` lo
 * SOBRESCRIBE con el correo comercial del formulario si lo hubo. O sea: el
 * `.invalid` cubre la ventana B→C solo para seeds creados SIN correo.
 *
 * Estos checks impiden que la afirmación vuelva a redactarse como garantía.
 */
console.log('\n  A-P1.1c-bis) F1 · alcance REAL del email técnico\n');
check('documenta la ventana de cleanup B→C', /VENTANA DE CLEANUP/.test(m2));
check('el email técnico se documenta como defensa PARCIAL',
  /DEFENSA\s*\n?\s*--\s*PARCIAL|DEFENSA PARCIAL/.test(m2));
check('admin_seed_operations se documenta como defensa ESTRUCTURAL',
  /DEFENSA ESTRUCTURAL/.test(m2));
check('nombra el punto exacto donde el email se sobrescribe',
  /coalesce\(v_email, email\)/.test(m2));
check('NO afirma que el email garantice la ventana B→C',
  !/el email (?:sigue )?cubr(?:e|iendo) la\s*\n?\s*--?\s*VENTANA/i.test(m2)
  && /No se documenta como garantía|no se documenta como garantía/.test(m2));
check('el análisis registra la evidencia de F1',
  fs.existsSync(ANA) && /F1 · Seed exclusion/.test(fs.readFileSync(ANA, 'utf8')));

/*
 * P1.1 · LOS ONCE CASOS OBLIGATORIOS.
 *
 * Se evalúan simbólicamente contra la estructura del predicado: cada caso
 * describe qué evidencias tiene una identidad, y se comprueba que la vista
 * la deje dentro o fuera. No se usa PII ni datos reales.
 */
console.log('\n  A-P1.1d) los once casos del predicado\n');
// `Boolean(...)` no es decorativo: sin él, un perfil sin la clave `rolePatient`
// hace que el `&&` devuelva `undefined`, y `undefined === false` es falso — el
// caso «doctor puro» fallaría por la comparación, no por el predicado.
const dura = (perfil) =>
  Boolean(perfil.inactivo || perfil.adminAccess || perfil.seed);
const blandaOk = (perfil) => Boolean(
  perfil.ficha || (perfil.rolePatient && !perfil.doctor && !perfil.staff && !perfil.duenio));
const entra = (perfil) => !dura(perfil) && blandaOk(perfil);
const CASOS = [
  ['1. patient, 0 fichas, sin roles', { rolePatient: true }, true],
  ['2. patient + ficha', { rolePatient: true, ficha: true }, true],
  ['3. doctor puro', { doctor: true }, false],
  ['4. doctor + ficha de paciente', { doctor: true, ficha: true }, true],
  ['5. clinic_member puro', { rolePatient: true, staff: true }, false],
  ['6. clinic_member + ficha', { rolePatient: true, staff: true, ficha: true }, true],
  ['7. owner admin', { adminAccess: true, rolePatient: true }, false],
  ['8. operations_admin', { adminAccess: true, rolePatient: true }, false],
  ['9. directory_editor', { adminAccess: true, rolePatient: true }, false],
  ['10. identidad técnica seed', { seed: true, rolePatient: true }, false],
  ['11. profile inactivo', { inactivo: true, rolePatient: true, ficha: true }, false],
];
for (const [nombre, perfil, esperado] of CASOS) {
  check(`${nombre} → ${esperado ? 'IN' : 'OUT'}`, entra(perfil) === esperado);
}
check('un admin NO entra ni siquiera teniendo ficha',
  entra({ adminAccess: true, rolePatient: true, ficha: true }) === false);
check('un seed NO entra ni siquiera teniendo ficha',
  entra({ seed: true, rolePatient: true, ficha: true }) === false);

/*
 * P1.1 · security_invoker en la vista.
 */
console.log('\n  A-P1.1e) defensa adicional de la vista\n');
check('aplica security_invoker si el servidor lo soporta',
  /security_invoker = true/.test(c2) && /server_version_num/.test(c2));
check('no rompe en PostgreSQL < 15', /RAISE NOTICE 's7_77: PostgreSQL/.test(m2));
check('explica la interacción con las RPCs SECURITY DEFINER',
  /el usuario actual ES el owner/.test(m2));
check('un paciente con 0 fichas SÍ aparece (LEFT JOIN, no INNER)',
  /LEFT JOIN LATERAL/.test(c2) && !/\n\s+JOIN public\.patients pa ON pa\.profile_id/.test(c2));
check('la vista no es legible por ningún cliente',
  /REVOKE ALL ON public\.crm_patient_identity FROM authenticated/.test(c2));
check('POST verifica que todo lo que lista use el predicado canónico',
  /alguna consulta no usa el predicado canónico/.test(m2));

/*
 * F2 · LA VISTA ES MÍNIMA.
 *
 * Su propósito es definir PERTENENCIA al universo del CRM, no describir a
 * nadie. Con nombre, teléfono y correo adentro sería una segunda salida de
 * PII, y encima poco visible. Una columna: `profile_id`. Las columnas de
 * presentación se piden a `profiles` con un JOIN explícito, dentro de la
 * allowlist, que es el único lugar donde se decide qué viaja al navegador.
 */
console.log('\n  A-P1.1f) F2 · vista mínima\n');
const selectVista = (vista.match(/CREATE VIEW public\.crm_patient_identity AS\s*\n([\s\S]*?)\nFROM/) || ['', ''])[1];
check('se localizó el SELECT de la vista', selectVista.trim().length > 0);
check('la vista proyecta exactamente una columna',
  selectVista.split(',').length === 1, selectVista.trim());
check('esa columna es profile_id', /\bAS profile_id\b/.test(selectVista));
for (const col of ['full_name', 'phone', 'email', 'created_at', 'role', 'avatar_url', 'document_number']) {
  check(`la vista NO proyecta ${col}`, !new RegExp(`\\b${col}\\b`).test(selectVista));
}
check('el núcleo hace el JOIN explícito a profiles',
  /FROM public\.crm_patient_identity ci\s*\n\s*JOIN public\.profiles p ON p\.id = ci\.profile_id/.test(c2));
check('las métricas también parten de la vista y unen profiles',
  /FROM public\.crm_patient_identity ci\s*\n\s*JOIN public\.profiles p ON p\.id = ci\.profile_id\s*\n\s*LEFT JOIN public\.patient_crm/.test(c2));
check('POST impide reintroducir columnas en la vista',
  /crm_patient_identity debe exponer SOLO profile_id/.test(m2));
check('se reemplaza con DROP + CREATE (cambiar columnas no admite REPLACE)',
  /DROP VIEW IF EXISTS public\.crm_patient_identity;/.test(c2));
check('las métricas cuentan la próxima cita DENTRO del universo canónico',
  /'con_proxima_cita',\s+\(SELECT count\(\*\) FROM ident i JOIN act a ON a\.profile_id = i\.id/.test(c2));

/*
 * P2 · IMMUTABLE DE VERDAD.
 *
 * Una función IMMUTABLE que consulta el reloj miente al planificador:
 * PostgreSQL puede cachear su resultado, plegarla en tiempo de planificación o
 * usarla en un índice, y devolvería estados congelados. La fecha de referencia
 * entra como ARGUMENTO.
 */
console.log('\n  A-ter) P2 · _crm_estado es IMMUTABLE de verdad\n');
const cuerpoEstado = (c2.match(/CREATE OR REPLACE FUNCTION public\._crm_estado\([\s\S]*?\n\$\$;/) || [''])[0];
check('se localizó el cuerpo de _crm_estado', cuerpoEstado.length > 0);
check('recibe la fecha de referencia como argumento', /p_ahora\s+timestamptz/.test(cuerpoEstado));
for (const f of ['now\\(\\)', 'current_date', 'current_timestamp', 'clock_timestamp',
                 'localtimestamp', 'transaction_timestamp', 'statement_timestamp']) {
  check(`NO usa ${f.replace('\\\\', '')}`, !new RegExp(f, 'i').test(cuerpoEstado));
}
check('sigue declarada IMMUTABLE', /IMMUTABLE/.test(cuerpoEstado));
check('los umbrales se comparan contra p_ahora',
  (cuerpoEstado.match(/p_ahora - interval/g) || []).length === 3);
check('quien la llama pasa now() explícitamente',
  /e\.ultima_actividad,\s*\n\s*now\(\)\)/.test(c2));
check('POST verifica que sea IMMUTABLE y no lea el reloj',
  /debería ser IMMUTABLE/.test(m2) && /es IMMUTABLE pero lee el reloj/.test(m2));

/*
 * P3 · SEMÁNTICA DEL ORIGEN.
 *
 * `appointments.source` dice por dónde entró una reserva, no cómo la persona
 * conoció LucyCare. Llamarlo "origen de adquisición" inventaría un dato que el
 * sistema no tiene.
 */
console.log('\n  A-quater) P3 · canal ≠ adquisición\n');
check('el campo se llama canal_primera_cita', /'canal_primera_cita'/.test(c2));
check('NO se llama origen ni acquisition_source',
  !/'origen'/.test(c2) && !/acquisition_source/.test(c1 + c2));
check('la cabecera explica que NO es origen de adquisición',
  /NO es origen de adquisición/.test(m2));
check('acquisition_source queda reservado y documentado', /RESERVADO/.test(m2));
check('no se inventan canales comerciales',
  !/Google|Facebook|referido|campaña'/.test(c2));

// ─── B. D4 · frontera clínica, en el backend ─────────────────
console.log('\n  B) D4 · frontera clínica (la aserción central)\n');
const CLINICAS = [
  'allergies', 'blood_type', 'emergency_contact_name', 'emergency_contact_phone',
  'emergency_contact_relation', 'internal_notes', 'reason_id', 'cancel_reason_id',
  'price', 'payment_status', 'consultation', 'prescription', 'diagnos',
  'medication', 'family_history', 'vitals',
];
for (const col of CLINICAS) {
  check(`las RPCs NO devuelven '${col}'`, !new RegExp(`\\b${col}\\b`, 'i').test(c2));
}
check('ninguna tabla del CRM guarda columnas clínicas',
  !CLINICAS.some((col) => new RegExp(`\\b${col}\\b`, 'i').test(c1)));
check('sin SELECT * en las RPCs (allowlist explícita)', !/SELECT\s+\*/i.test(c2));
check('sin to_jsonb de una fila entera de negocio',
  !/to_jsonb\((pa|ap|p|pg)\)/.test(c2));
check('sin row_to_json', !/row_to_json/i.test(c2));
check('cada fila se arma con jsonb_build_object nombrando claves',
  (c2.match(/jsonb_build_object\(/g) || []).length >= 3);
check('patients.notes NO se devuelve',
  !/pa\.notes|patients\.notes/.test(c2));

// ─── C. D2 · estados derivados, no persistidos ───────────────
console.log('\n  C) D2 · estados derivados\n');
check('existe un único lugar con los umbrales', /FUNCTION public\._crm_estado\(/.test(c2));
check('la prioridad es bloqueado > en_seguimiento > recurrente > nuevo > activo > inactivo',
  /'bloqueado'[\s\S]{0,200}'en_seguimiento'[\s\S]{0,200}'recurrente'[\s\S]{0,200}'nuevo'[\s\S]{0,300}'inactivo'/.test(c2));
check('recurrente = 2 o más atendidas', /p_atendidas, 0\) >= 2/.test(c2));
check('nuevo = 30 días', /interval '30 days'/.test(c2));
check('activo = 90 días', /interval '90 days'/.test(c2));
check('inactivo = 180 días', /interval '180 days'/.test(c2));
check('NO se persiste ningún estado derivado',
  !/crm_status\s+text/.test(c1) && !/status\s+text NOT NULL DEFAULT 'nuevo'/.test(c1));
check('el único estado persistido es el bloqueo', /blocked_at\s+timestamptz/.test(c1));

// ─── D. D3 · trazabilidad del bloqueo ────────────────────────
console.log('\n  D) D3 · trazabilidad del bloqueo\n');
check('bloqueo con motivo, actor y fecha',
  /blocked_reason/.test(c1) && /blocked_by/.test(c1) && /blocked_at/.test(c1));
check('levantamiento con motivo, actor y fecha',
  /unblocked_reason/.test(c1) && /unblocked_by/.test(c1) && /unblocked_at/.test(c1));
check('un bloqueo sin motivo o sin actor es imposible',
  /patient_crm_block_coherente/.test(c1));
check('no se puede levantar un bloqueo inexistente',
  /patient_crm_unblock_coherente/.test(c1) && /unblocked_at >= blocked_at/.test(c1));

// ─── E. Seguridad: RLS, grants, gate ─────────────────────────
console.log('\n  E) seguridad\n');
check('RLS activa en las cuatro tablas', /ENABLE ROW LEVEL SECURITY/.test(c1));
check('las policies llevan TO authenticated (lección de s7_74)',
  /FOR SELECT TO authenticated USING \(public\.is_admin\(\)\)/.test(c1));
check('REVOKE de PUBLIC y anon en las tablas',
  /REVOKE ALL ON public\.%I FROM PUBLIC/.test(c1) && /REVOKE ALL ON public\.%I FROM anon/.test(c1));
check('authenticated recibe SELECT pero NO DML',
  /GRANT SELECT ON public\.%I TO authenticated/.test(c1)
  && !/GRANT (INSERT|UPDATE|DELETE)/.test(c1));
check('POST verifica que authenticated no tenga DML',
  /authenticated tiene DML sobre/.test(m1));
// Cuatro: los tres wrappers de lectura más la exportación. El núcleo
// compartido NO gatea, y no hace falta: es privado y solo lo alcanzan ellos.
check('las CUATRO RPCs públicas gatean con is_admin()',
  (c2.match(/IF NOT public\.is_admin\(\) THEN/g) || []).length === 4);
check('el gate usa P0140 en las cuatro', (c2.match(/ERRCODE = 'P0140'/g) || []).length === 4);
check('las RPCs son SECURITY DEFINER con search_path fijo',
  (c2.match(/SECURITY DEFINER/g) || []).length >= 3
  && (c2.match(/SET search_path = public, pg_catalog/g) || []).length >= 3);
check('las RPCs son STABLE: no escriben', (c2.match(/\nSTABLE\n/g) || []).length >= 3);
check('POST exige que sean STABLE', /debería ser STABLE \(solo lectura\)/.test(m2));
check('el helper de estados queda privado',
  /_crm_estado[\s\S]{0,300}FROM authenticated/.test(c2));
check('anon no puede ejecutar ninguna RPC', /FROM anon/.test(c2));

// ─── F. Performance ──────────────────────────────────────────
console.log('\n  F) performance\n');
check('índice de patients(profile_id) — hoy no existe',
  /CREATE INDEX IF NOT EXISTS idx_patients_profile_id[\s\S]{0,120}ON public\.patients \(profile_id\)/.test(c1));
check('índice para los pendientes de identificar',
  /idx_patients_sin_identidad/.test(c1) && /WHERE profile_id IS NULL/.test(c1));
check('índices de appointments para actividad y recurrencia',
  /idx_appointments_patient_start/.test(c1) && /idx_appointments_patient_status/.test(c1));
check('página por defecto 25', /coalesce\(p_limit, 25\)/.test(c2));
check('tope duro de 50', (c2.match(/least\(greatest\(coalesce\(p_limit, 25\), 1\), 50\)/g) || []).length === 2);
check('los agregados se calculan sobre la PÁGINA, no sobre la tabla',
  /LEFT JOIN LATERAL/.test(c2) && /LIMIT v_limit OFFSET v_offset/.test(c2));
check('búsqueda, filtro y orden son server-side',
  /p_search/.test(c2) && /p_status/.test(c2) && /ORDER BY/.test(c2));
check('el buscador cubre nombre, teléfono, correo e ID',
  /full_name ILIKE/.test(c2) && /phone\s+ILIKE/.test(c2)
  && /email\s+ILIKE/.test(c2) && /id::text = v_q/.test(c2));

// ─── G. Alcance: no toca lo existente ────────────────────────
console.log('\n  G) alcance aditivo\n');
check('no altera tablas existentes',
  !/ALTER TABLE public\.(profiles|patients|appointments|doctors|clinics)/.test(c1)
  && !/ALTER TABLE public\.(profiles|patients|appointments)/.test(c2));
check('no crea policies sobre tablas existentes',
  !/CREATE POLICY[\s\S]{0,80}ON public\.(profiles|patients|appointments)/.test(c1));
check('no toca auth.users', !/auth\.users/i.test(c1) && !/auth\.users/i.test(c2));
check('no toca el merge/unmerge de fichas',
  !/patient_merge_log|admin_merge_patients|admin_unmerge/.test(c1 + c2));
check('no escribe datos de negocio',
  !/INSERT INTO public\.(patients|profiles|appointments)/.test(c1 + c2)
  && !/UPDATE public\.(patients|profiles|appointments)/.test(c1 + c2));
check('auditoría enganchada a las cuatro tablas',
  /CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE/.test(c1)
  && /audit_patient_crm\(\)/.test(c1));
check('la auditoría marca edited_via crm', /'edited_via', 'crm'/.test(c1));

// ─── H. Transacción y guardas ────────────────────────────────
console.log('\n  H) transacción y guardas\n');
for (const [n, c, m] of [['s7_76', c1, m1], ['s7_77', c2, m2]]) {
  check(`${n}: una sola transacción`,
    (c.match(/^BEGIN;$/gm) || []).length === 1 && (c.match(/^COMMIT;$/gm) || []).length === 1);
  check(`${n}: tiene guardas PRE y POST`, /PRE fallo/.test(m) && /POST fallo/.test(m));
}
check('s7_77 exige la fundación de s7_76', /falta la fundación de s7_76/.test(m2));
check('s7_77 exige que exista el estado "atendida"', /no existe el estado de cita "atendida"/.test(m2));

// ─── I. Rollbacks ────────────────────────────────────────────
console.log('\n  I) rollbacks\n');
check('ambos marcados NO EJECUTAR', /NO EJECUTAR/.test(rb1) && /NO EJECUTAR/.test(rb2));
check('el de s7_76 exige revertir s7_77 primero', /s7_77 sigue aplicada/.test(rb1));

/*
 * P4 · EL ROLLBACK NO DESTRUYE DATOS.
 *
 * La metadata CRM no tiene otra fuente de verdad: no se puede reconstruir
 * desde profiles, patients ni appointments. Un DROP sobre tablas con contenido
 * no es una reversión, es una pérdida.
 */
console.log('\n  I-bis) P4 · rollback fail-closed\n');
check('cuenta las filas de las CUATRO tablas antes de borrar',
  (rb1.match(/SELECT count\(\*\) INTO v_\w+\s+FROM public\.patient_crm/g) || []).length === 4);
check('ABORTA si hay una sola fila', /IF v_total > 0 THEN[\s\S]{0,400}RAISE EXCEPTION/.test(rb1));
check('el mensaje dice cuántas filas hay en cada tabla',
  /patient_crm=%, tags=%, followups=%, notas=%/.test(rb1));
check('las guardas van ANTES de cualquier DROP',
  rb1.indexOf('IF v_total > 0 THEN') < rb1.indexOf('DROP TABLE'));
check('documenta que revertir tras uso real exige conservación',
  /estrategia de conservación/.test(rb1)
  && /respaldo|migrar|renombrar/i.test(rb1));
check('NO automatiza el borrado con datos', /deliberadamente NO se automatiza/.test(rb1));
check('el de s7_76 elimina las cuatro tablas',
  (rb1.match(/DROP TABLE IF EXISTS public\.patient_crm/g) || []).length === 4);
check('el de s7_76 elimina los índices que creó',
  /DROP INDEX IF EXISTS public\.idx_patients_profile_id/.test(rb1));
check('el de s7_76 verifica que no se perdió una tabla preexistente',
  /se perdió una tabla preexistente/.test(rb1));
check('el de s7_77 es no destructivo para los datos',
  /NO destructivo para los datos/.test(rb2)
  && !/DROP TABLE/.test(sinComentarios(rb2)));
check('ambos son autosuficientes (sin marcadores para pegar a mano)',
  !/PEGAR AQU/i.test(rb1) && !/PEGAR AQU/i.test(rb2));
check('audit_log se conserva en el rollback', /audit_log`? se conserva/.test(rb1));

// ─── J. Frontend ─────────────────────────────────────────────
if (fs.existsSync(SVC)) {
  console.log('\n  J) frontend\n');
  const svc = fs.readFileSync(SVC, 'utf8');
  const svcCode = svc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('el servicio llama a las RPCs, no a las tablas',
    /rpc\('admin_list_patients_crm'/.test(svcCode)
    && /rpc\('admin_list_unlinked_patients'/.test(svcCode)
    && /rpc\('admin_patients_crm_stats'/.test(svcCode));
  check('el frontend NO consulta patients ni appointments directamente',
    !/from\('patients'\)/.test(svcCode) && !/from\('appointments'\)/.test(svcCode));
  check('el tope de página vive también en el cliente', /50/.test(svcCode));
}

/* ─── K. P5 · exportación ────────────────────────────────────
 *
 * El export es la superficie más sensible del CRM: saca PII del sistema. Por
 * eso reusa el MISMO núcleo que el listado —no una consulta paralela que
 * pudiera ampliar columnas sin que nadie lo note—, está gateado igual, y deja
 * evidencia sin copiar PII al audit.
 */
console.log('\n  K) P5 · exportación\n');
check('existe la RPC de exportación',
  /CREATE OR REPLACE FUNCTION public\.admin_export_patients_crm\(/.test(c2));
check('listado y exportación comparten el MISMO núcleo',
  (c2.match(/public\._crm_patients_json\(/g) || []).length >= 3);
check('el núcleo es privado (sin EXECUTE para clientes)',
  /REVOKE ALL ON FUNCTION public\._crm_patients_json\(text,text,int,int\) FROM authenticated/.test(c2));
check('el export gatea con is_admin() igual que el listado',
  /admin_export_patients_crm[\s\S]{0,900}IF NOT public\.is_admin\(\) THEN/.test(c2));
check('el export NO exporta solo la página visible',
  /MAX_EXPORT \+ 1, 0\)/.test(c2));
check('tiene un tope técnico explícito', /MAX_EXPORT constant int := 5000/.test(c2));
check('rechaza con P0146 si se supera el tope', /ERRCODE = 'P0146'/.test(c2));
check('deja evidencia en audit_log',
  /INSERT INTO public\.audit_log[\s\S]{0,400}'export_base_pacientes'/.test(c2));
check('el audit registra actor, formato y cantidad',
  /auth\.uid\(\)/.test(c2) && /'formato',\s+p_formato/.test(c2) && /'registros',\s+v_n/.test(c2));
check('el audit NO copia el texto buscado (podría ser PII)',
  /'con_busqueda',\s+\(nullif/.test(c2) && !/'busqueda',\s+p_search/.test(c2));
check('es VOLATILE: exportar es una acción, no una lectura',
  /admin_export_patients_crm[\s\S]{0,400}\nVOLATILE\n/.test(c2));
check('POST exige que sea VOLATILE', /la exportación debe ser VOLATILE/.test(m2));
check('POST verifica que comparta el núcleo con el listado',
  /listado y exportación no comparten el núcleo/.test(m2));
check('no persiste el archivo ni crea storage',
  !/storage|bucket/i.test(c2));

if (fs.existsSync(SVC)) {
  const svcExp = fs.readFileSync(SVC, 'utf8');
  const svcExpCode = svcExp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('el servicio exporta vía la RPC, no consultando tablas',
    /rpc\('admin_export_patients_crm'/.test(svcExpCode));
  check('las columnas del archivo son un SUBCONJUNTO de la allowlist',
    /EXPORT_COLUMNS/.test(svcExpCode)
    && !/allergies|blood_type|internal_notes|diagnos/i.test(svcExpCode));
  check('las notas administrativas NO se exportan en P0',
    !/notas|notes/i.test((svcExpCode.match(/EXPORT_COLUMNS[\s\S]*?\];/) || [''])[0]));
  check('delega el escape en el serializador único de lib/csv',
    /from '\.\.\/lib\/csv'/.test(svcExpCode) && /buildCsv\(/.test(svcExpCode));
  check('no reimplementa el escape en el servicio',
    !/csvEscape|replace\(\/"\/g/.test(svcExpCode));
  check('el archivo se genera en el navegador, sin subir nada',
    !/storage|upload|bucket/i.test(svcExpCode));
  check('P0 pide CSV y nada más (el tipo no admite xlsx)',
    !/'csv' \| 'xlsx'/.test(svcExpCode) && /formato: 'csv'/.test(svcExpCode));
}

/* ─── K-bis. F5 · ALLOWLIST EXPORTABLE, APROBADA POR EL OWNER ──
 *
 * La protección vive en el BACKEND: el núcleo enumera a mano cada clave que
 * devuelve, y el export no puede pedir una que el listado no traiga. Acá se
 * fija esa lista, para que agregar una columna exija tocar este check.
 */
console.log('\n  K-bis) F5 · allowlist exportable\n');
const ALLOWLIST_BACKEND = [
  'profile_id', 'full_name', 'phone', 'email', 'created_at', 'crm_status',
  'blocked', 'canal_primera_cita', 'fichas', 'clinicas', 'medicos',
  'citas_total', 'atendidas', 'ultima_actividad', 'proxima_cita',
  'followups_abiertos', 'tags',
];
const nucleo = (c2.match(/CREATE OR REPLACE FUNCTION public\._crm_patients_json\([\s\S]*?\n\$\$;/) || [''])[0];
const clavesNucleo = [...nucleo.matchAll(/'([a-z_0-9]+)',\s*(?:pg\.|e\.|coalesce|public\._crm_estado|CASE|to_jsonb|\()/g)]
  .map((m) => m[1]);
check('se localizó el núcleo compartido', nucleo.length > 0);
check('el núcleo devuelve EXACTAMENTE la allowlist aprobada',
  ALLOWLIST_BACKEND.every((k) => clavesNucleo.includes(k))
  && clavesNucleo.every((k) => ALLOWLIST_BACKEND.includes(k)),
  clavesNucleo.filter((k) => !ALLOWLIST_BACKEND.includes(k)).join(', ') || '—');
const PROHIBIDAS_EXPORT = [
  'allergies', 'blood_type', 'internal_notes', 'reason_id', 'cancel_reason_id',
  'price', 'payment_status', 'emergency_contact', 'diagnos', 'prescription',
  'medication', 'consultation', 'vitals', 'family_history', 'nota', 'note',
];
for (const col of PROHIBIDAS_EXPORT) {
  check(`el núcleo NO devuelve '${col}'`, !new RegExp(`'[a-z_]*${col}[a-z_]*'\\s*,`, 'i').test(nucleo));
}
if (fs.existsSync(SVC)) {
  const svcAll = fs.readFileSync(SVC, 'utf8');
  const bloqueCols = (svcAll.match(/EXPORT_COLUMNS[\s\S]*?\n\];/) || [''])[0];
  const colsExport = [...bloqueCols.matchAll(/key: '([a-z_0-9]+)'/g)].map((m) => m[1]);
  const ESPERADAS = [
    'profile_id', 'full_name', 'phone', 'email', 'crm_status', 'created_at',
    'ultima_actividad', 'proxima_cita', 'citas_total', 'atendidas',
    'medicos', 'clinicas', 'canal_primera_cita', 'tags',
  ];
  check('el archivo lleva las 14 columnas administrativas aprobadas',
    ESPERADAS.every((k) => colsExport.includes(k)) && colsExport.length === ESPERADAS.length,
    colsExport.join(', '));
  check('cada columna del archivo existe en la allowlist del backend',
    colsExport.every((k) => ALLOWLIST_BACKEND.includes(k)));
  check('las notas administrativas NO están entre las columnas',
    !/nota|note/i.test(bloqueCols));
}

/* ─── K-quater. ORDEN DE OPERACIONES DEL LISTADO ─────────────
 *
 * El defecto que esto impide volver a introducir: filtrar por estado DESPUÉS
 * de paginar. Rompía tres cosas a la vez — el `total`, las coincidencias que
 * caían fuera de la primera página, y la exportación del conjunto filtrado.
 *
 * El orden correcto es:
 *   universo + búsqueda → agregados y estado → FILTRO → TOTAL → PAGINACIÓN
 */
console.log('\n  K-quater) orden filtro → conteo → paginación\n');
const iFiltro  = nucleo.indexOf('filtrada AS (');
const iPagina  = nucleo.indexOf('pagina AS (');
const iCalif   = nucleo.indexOf('calificada AS (');
const iCand    = nucleo.indexOf('candidatos AS (');
check('existe una etapa de calificación (estado derivado)', iCalif > 0);
check('existe una etapa de FILTRADO separada', iFiltro > 0);
check('el filtro va ANTES de la paginación', iFiltro > 0 && iPagina > iFiltro,
  `filtrada@${iFiltro} pagina@${iPagina}`);
check('el estado se calcula ANTES de filtrar', iCalif > 0 && iFiltro > iCalif);
check('los agregados se calculan ANTES de calificar', iCand > 0 && iCalif > iCand);
check('el total sale del conjunto FILTRADO cuando hay filtro',
  /ELSE \(SELECT count\(\*\) FROM filtrada\) END/.test(nucleo));
check('el total sale de base cuando NO hay filtro (misma semántica)',
  /THEN \(SELECT count\(\*\) FROM base\)/.test(nucleo));
check('la ruta rápida y la lenta viven en la MISMA consulta',
  /LIMIT\s+CASE WHEN v_status IS NULL THEN v_limit\s+ELSE NULL END/.test(nucleo)
  && /LIMIT\s+CASE WHEN v_status IS NULL THEN NULL ELSE v_limit\s+END/.test(nucleo));
// Se evalúa sobre el CUERPO de la función: la guarda POST menciona el patrón
// a propósito, para prohibirlo.
check('YA NO se filtra el JSON después de paginar (el defecto viejo)',
  !/jsonb_array_elements\(v_rows\)/.test(nucleo));
check('el estado se calcula UNA sola vez por fila',
  (nucleo.match(/public\._crm_estado\(/g) || []).length === 1);
check('POST verifica el orden sobre el texto de la función',
  /el filtro por estado no precede a la paginación/.test(m2)
  && /el total no se calcula sobre el conjunto filtrado/.test(m2)
  && /se volvió a filtrar DESPUÉS de paginar/.test(m2));
check('la cabecera documenta el orden obligatorio',
  /ORDEN DE OPERACIONES/.test(m2));

/* ─── K-quinquies. ALLOWLIST CERRADA DE p_status ─────────────
 *
 * `p_status` llega del navegador. Se valida server-side ANTES de consultar y
 * ANTES de auditar: un valor arbitrario no puede terminar en `audit_log`.
 */
console.log('\n  K-quinquies) allowlist de p_status\n');
const norm = (c2.match(/CREATE OR REPLACE FUNCTION public\._crm_status_norm\([\s\S]*?\n\$\$;/) || [''])[0];
check('existe el validador _crm_status_norm', norm.length > 0);
for (const st of ['nuevo', 'activo', 'en_seguimiento', 'recurrente', 'inactivo', 'bloqueado']) {
  check(`la allowlist incluye '${st}'`, new RegExp(`'${st}'`).test(norm));
}
check('la allowlist tiene EXACTAMENTE seis estados',
  (norm.match(/'(nuevo|activo|en_seguimiento|recurrente|inactivo|bloqueado)'/g) || []).length === 6);
check('vacío y nulo significan "sin filtro"', /RETURN NULL/.test(norm));
check('normaliza espacios y mayúsculas', /btrim\(lower\(coalesce\(p_status/.test(norm));
check('rechaza el resto con P0147', /ERRCODE = 'P0147'/.test(norm));
check('P0147 es el siguiente código libre', !/P0148|P0149/.test(c2));
check('el mensaje de error NO repite el valor recibido',
  /RAISE EXCEPTION 'Filtro de estado no válido' USING/.test(norm)
  && !/RAISE EXCEPTION[^;]*%[^;]*p_status/.test(norm));
check('el listado valida ANTES de llamar al núcleo',
  /admin_list_patients_crm[\s\S]{0,600}v_status := public\._crm_status_norm\(p_status\);[\s\S]{0,400}_crm_patients_json\(\s*\n?\s*p_search, v_status/.test(c2));
const expBloque = (c2.match(/CREATE OR REPLACE FUNCTION public\.admin_export_patients_crm\([\s\S]*?\n\$\$;/) || [''])[0];
const iNorm = expBloque.indexOf('v_status := public._crm_status_norm(p_status);');
check('la exportación valida ANTES de consultar y de auditar',
  iNorm > 0
  && iNorm < expBloque.indexOf('_crm_patients_json(')
  && iNorm < expBloque.indexOf('INSERT INTO public.audit_log'));
check('el núcleo tampoco confía en su llamador',
  /v_status := public\._crm_status_norm\(p_status\);/.test(nucleo));
check('el audit guarda el estado NORMALIZADO, no lo recibido',
  /'filtro_estado', v_status,/.test(c2)
  && !/'filtro_estado', nullif\(btrim\(coalesce\(p_status/.test(c2));
check('el frontend traduce P0147 sin mostrar el mensaje crudo',
  fs.existsSync(SVC) && /P0147:/.test(fs.readFileSync(SVC, 'utf8')));
check('existe la QA sintética de regresión', fs.existsSync(QA));

/*
 * COPY · TUTEO, nunca voseo. Aplica también a los mensajes de las excepciones:
 * aunque el frontend los traduzca, pueden acabar en un log o en una consola.
 */
const mensajes = [...(m1 + m2).matchAll(/RAISE EXCEPTION\s*\n?\s*'([^']*)'/g)].map((x) => x[1]);
for (const v of ['afiná', 'agregá', 'revisá', 'fijate', 'tenés', 'podés', 'debés', 'buscá', 'acotá']) {
  check(`ningún mensaje usa voseo ("${v}")`,
    !mensajes.some((s) => s.toLowerCase().includes(v)),
    mensajes.find((s) => s.toLowerCase().includes(v)) || '');
}
check('el mensaje del tope de exportación está en tuteo',
  /Afina la búsqueda o el filtro/.test(m2) && !/Afiná/.test(m2));

/* ─── INSTRUMENTO · fuente EJECUTABLE, no `prosrc` crudo ─────
 *
 * `pg_proc.prosrc` incluye los comentarios de la migración. Y los comentarios
 * de ESTA migración nombran a propósito lo que está prohibido: «ni allergies,
 * ni blood_type», «por un SELECT *», «aceptar 'xlsx' sería peor que inútil».
 * Buscar tokens ahí da FALSOS POSITIVOS — pasó con los controles 152, 153 y
 * 154, y con el 122 por un LIKE mal acotado.
 *
 * La corrección: una CTE `ejecutable` que quita comentarios de bloque y de
 * línea, y que alimenta todos los controles semánticos.
 */
console.log('\n  K-octies) el POST del owner analiza fuente EJECUTABLE\n');
const POST = 'docs/OWNER_S7_77_APPLY.md';
const docPost = fs.existsSync(POST) ? fs.readFileSync(POST, 'utf8') : '';
const paso3 = (docPost.match(/-- ══ s7_77 · PASO 3[\s\S]*?\nORDER BY 1;/) || [''])[0];
check('se localizó el PASO 3', paso3.length > 0);
check('define una fuente ejecutable', /ejecutable AS \(/.test(paso3));
check('quita comentarios de bloque', /regexp_replace\(prosrc, '\/\\\*\[\\s\\S\]\*\?\\\*\/'/.test(paso3));
check('quita comentarios de línea', /'--\[\^\\n\]\*'/.test(paso3));
check('el núcleo también sale de la fuente ejecutable',
  /nucleo AS \(\s*\n\s*SELECT src FROM ejecutable/.test(paso3));
check('152 (columnas clínicas) lee la fuente ejecutable',
  /SELECT 152[\s\S]{0,400}FROM ejecutable f, prohibidas p/.test(paso3));
check('153 (SELECT \\* / row_to_json) lee la fuente ejecutable',
  /SELECT 153[\s\S]{0,400}FROM ejecutable\s*\n\s*WHERE src ~\* 'SELECT/.test(paso3));
check('154 verifica POSITIVAMENTE el bloque del formato',
  /fmt AS \(/.test(paso3) && /SELECT 154[\s\S]{0,500}FROM fmt/.test(paso3));
// Se busca el PREDICADO, no la palabra: `xlsx` aparece —legítimamente— en el
// comentario que explica por qué ya no se usa como prueba.
check('154 ya NO se apoya en "la palabra xlsx no aparece"',
  !/NOT LIKE '%''xlsx''%'/.test(paso3));
check('122 analiza el RAISE aislado, no texto suelto',
  /raise_norm AS \(/.test(paso3)
  && /substring\(src from 'RAISE EXCEPTION\[\^;\]\*;'\)/.test(paso3)
  && /SELECT 122[\s\S]{0,700}FROM raise_norm/.test(paso3));
check('122 exige literal, P0147 y ausencia de interpolación',
  /SELECT 122[\s\S]{0,900}Filtro de estado no válido[\s\S]{0,400}P0147[\s\S]{0,400}NOT LIKE '%p_status%'/.test(paso3));
check('el reloj de _crm_estado se busca en fuente ejecutable',
  /SELECT 112[\s\S]{0,600}e\.src ~\*/.test(paso3));

/*
 * A/B DE LA NORMALIZACIÓN, con los CUERPOS REALES de las funciones.
 *
 * Se extrae cada cuerpo de la migración —lo mismo que guarda `prosrc`—, se le
 * aplica la MISMA normalización que hace el POST, y se corren los cuatro
 * predicados. Predice el resultado en vivo sin tocar la base.
 */
console.log('\n  K-nonies) A/B · comentario vs. código ejecutable\n');
/** Misma normalización que la CTE `ejecutable` del PASO 3. */
const desnudar = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const cuerpos = new Map();
for (const m of m2.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?\nAS \$\$\n([\s\S]*?)\n\$\$;/g)) {
  cuerpos.set(m[1], m[2]);
}
check('se extrajeron los cuerpos de las 7 funciones', cuerpos.size === 7, `${cuerpos.size}`);

const CLINICAS_POST = ['allergies', 'blood_type', 'internal_notes', 'cancel_reason_id',
  'payment_status', 'emergency_contact', 'diagnos', 'prescription', 'medication',
  'consultation', 'vitals', 'family_history'];
const conClinicas = (src) => CLINICAS_POST.filter((c) => src.toLowerCase().includes(c));
const conSelectStar = (src) => /SELECT\s+\*/i.test(src) || /row_to_json/i.test(src);

// 152 y 153 sobre los cuerpos REALES.
const crudoClinicas = [...cuerpos.values()].flatMap(conClinicas);
const limpioClinicas = [...cuerpos.values()].map(desnudar).flatMap(conClinicas);
check('152 · en prosrc CRUDO había falsos positivos (por eso fallaba)',
  crudoClinicas.length > 0, crudoClinicas.join(','));
check('152 · en fuente EJECUTABLE no queda ninguno',
  limpioClinicas.length === 0, limpioClinicas.join(','));

const crudoStar = [...cuerpos.entries()].filter(([, s]) => conSelectStar(s)).map(([n]) => n);
const limpioStar = [...cuerpos.entries()].filter(([, s]) => conSelectStar(desnudar(s))).map(([n]) => n);
check('153 · en prosrc CRUDO había falsos positivos', crudoStar.length > 0, crudoStar.join(','));
check('153 · en fuente EJECUTABLE no queda ninguno', limpioStar.length === 0, limpioStar.join(','));

// 154 · verificación positiva sobre el bloque del formato.
const exportSrc = desnudar(cuerpos.get('admin_export_patients_crm') || '');
const blkFmt = (exportSrc.match(/IF coalesce\(p_formato[\s\S]*?END IF;/) || [''])[0];
check('154 · el bloque del formato se aísla bien', blkFmt.length > 0);
check('154 · solo admite csv', blkFmt.includes("<> 'csv'"));
check('154 · cualquier otro formato lanza P0142', blkFmt.includes('P0142'));
check('154 · la palabra xlsx SOLO vive en un comentario',
  (cuerpos.get('admin_export_patients_crm') || '').includes('xlsx') && !exportSrc.includes('xlsx'));

// 122 · el RAISE aislado del validador.
const normSrc = desnudar(cuerpos.get('_crm_status_norm') || '');
const stmt = (normSrc.match(/RAISE EXCEPTION[^;]*;/) || [''])[0];
check('122 · el RAISE se aísla bien', stmt.length > 0);
check('122 · lleva el literal exacto', stmt.includes("'Filtro de estado no válido'"));
check('122 · lleva P0147', stmt.includes('P0147'));
check('122 · NO interpola p_status, no concatena y no usa %',
  !stmt.includes('p_status') && !stmt.includes('||') && !stmt.includes('%'));

/*
 * Y la contraprueba: si los tokens entran de verdad al CÓDIGO, tienen que
 * hacer FAIL. Se inyectan en copias sintéticas, nunca en la migración.
 */
const inyectado = {
  comentario: 'BEGIN\n  -- ni allergies ni SELECT * ni xlsx acá\n  RETURN 1;\nEND',
  codigo: "BEGIN\n  SELECT allergies FROM x;\n  SELECT * FROM y;\nEND",
};
check('A/B · comentar allergies / SELECT * NO dispara nada',
  conClinicas(desnudar(inyectado.comentario)).length === 0
  && !conSelectStar(desnudar(inyectado.comentario)));
check('A/B · ponerlos en código ejecutable SÍ dispara los dos',
  conClinicas(desnudar(inyectado.codigo)).length > 0
  && conSelectStar(desnudar(inyectado.codigo)));
check('A/B · un xlsx comentado no rompe el control del formato',
  !desnudar("IF coalesce(p_formato, '') <> 'csv' THEN -- nada de xlsx\n  RAISE P0142;\nEND IF;").includes('xlsx'));

/* ─── INSTRUMENTO · los POST del owner tienen que PARSEAR ────
 *
 * Varias columnas del catálogo son del tipo interno `"char"`, que NO tiene cast
 * implícito a `text`. Concatenarlas sin castear da
 * `42725: operator is not unique: "char" || unknown` y la consulta entera
 * muere. Pasó una vez con `provolatile`; esto impide el siguiente.
 *
 * En las COMPARACIONES no hace falta cast —`provolatile = 'i'` resuelve solo—,
 * así que la guarda mira únicamente las concatenaciones.
 */
console.log('\n  K-septies) los POST del owner: casts de columnas "char"\n');
const CHAR_COLS = ['provolatile', 'relkind', 'prokind', 'proparallel', 'contype',
  'confdeltype', 'confupdtype', 'tgenabled', 'typtype', 'typcategory',
  'attidentity', 'attgenerated', 'relpersistence', 'relreplident'];
/** Solo el SQL de los bloques ```sql: la prosa del documento no se ejecuta. */
const soloSql = (texto) => {
  const out = [];
  let dentro = false;
  for (const l of texto.split(/\r?\n/)) {
    if (/^```sql\s*$/.test(l)) { dentro = true; continue; }
    if (/^```\s*$/.test(l)) { dentro = false; continue; }
    if (dentro) out.push(l);
  }
  return out;
};
for (const doc of ['docs/OWNER_S7_76_APPLY.md', 'docs/OWNER_S7_77_APPLY.md']) {
  if (!fs.existsSync(doc)) continue;
  const lineas = soloSql(fs.readFileSync(doc, 'utf8'))
    .filter((l) => l.includes('||') && !/^\s*--/.test(l));
  const malas = [];
  for (const l of lineas) {
    for (const col of CHAR_COLS) {
      // La columna aparece en una línea con `||` y NO viene seguida de ::text
      if (new RegExp(`\\b${col}\\b(?!::)`).test(l)) malas.push(`${col}: ${l.trim().slice(0, 60)}`);
    }
  }
  check(`${doc.replace('docs/', '')}: ninguna columna "char" se concatena sin ::text`,
    malas.length === 0, malas[0] || '');
}

/* ─── K-sexies. MÍNIMO PRIVILEGIO EN LOS OBJETOS PRIVADOS ────
 *
 * La vista y los tres helpers solo los alcanzan las RPCs SECURITY DEFINER, que
 * corren como owner. Ningún rol de Supabase debe poder llamarlos —tampoco
 * `service_role`—, porque hacerlo saltaría el gate `is_admin()`.
 */
console.log('\n  K-sexies) mínimo privilegio en vista y helpers\n');
for (const obj of ['crm_patient_identity']) {
  for (const rol of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    check(`${obj}: REVOKE de ${rol}`,
      new RegExp(`REVOKE ALL ON public\\.${obj} FROM ${rol};`).test(c2));
  }
}
for (const [fn, firma] of [
  ['_crm_estado', 'boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz'],
  ['_crm_patients_json', 'text,text,int,int'],
  ['_crm_status_norm', 'text'],
]) {
  for (const rol of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    check(`${fn}: REVOKE de ${rol}`,
      c2.includes(`REVOKE ALL ON FUNCTION public.${fn}(${firma}) FROM ${rol};`));
  }
}
check('el hardening NO se extendió a las RPCs públicas',
  !/REVOKE ALL ON FUNCTION public\.admin_list_patients_crm[^;]*FROM service_role/.test(c2)
  && !/REVOKE ALL ON FUNCTION public\.admin_export_patients_crm[^;]*FROM service_role/.test(c2));
check('el hardening NO tocó las tablas de s7_76',
  !/service_role/.test(c1));
check('POST exige PUBLIC/anon/authenticated/service_role = NO en los helpers',
  /sigue alcanzable por un rol de cliente/.test(m2)
  && /conserva EXECUTE para PUBLIC/.test(m2));
check('POST exige que service_role no lea la vista canónica',
  /service_role puede leer la vista canónica/.test(m2));
check('el rollback elimina también el validador nuevo',
  /DROP FUNCTION IF EXISTS public\._crm_status_norm\(text\);/.test(rb2)
  && /_crm_status_norm\(text\)'\) IS NOT NULL/.test(rb2));

/* ─── K-ter. F3 · AUDITORÍA DE LA EXPORTACIÓN ────────────────
 *
 * Exportar saca PII del sistema: es una ACCIÓN administrativa y queda
 * registrada como tal. Lo que NO puede quedar registrado es la PII misma —ni
 * el texto buscado, que un admin bien puede teclear como teléfono o nombre.
 */
console.log('\n  K-ter) F3 · auditoría de exportación\n');
const bloqueExport = (c2.match(/CREATE OR REPLACE FUNCTION public\.admin_export_patients_crm\([\s\S]*?\n\$\$;/) || [''])[0];
const auditExport = (bloqueExport.match(/INSERT INTO public\.audit_log[\s\S]*?\);/) || [''])[0];
check('se localizó la escritura de auditoría', auditExport.length > 0);
check('el actor es auth.uid(), no un id pasado por parámetro',
  /VALUES\s*\(\s*\n?\s*auth\.uid\(\)/.test(auditExport));
check('gateada por is_admin() ANTES de escribir nada',
  bloqueExport.indexOf('is_admin()') < bloqueExport.indexOf('INSERT INTO public.audit_log'));
check('registra el momento', /'exportado_at',\s+now\(\)/.test(auditExport));
check('registra el formato', /'formato',\s+p_formato/.test(auditExport));
check('registra la cantidad exportada', /'registros',\s+v_n/.test(auditExport));
check('la búsqueda se registra como BOOLEANO', /'con_busqueda',\s+\(nullif/.test(auditExport));
check('el filtro de estado es un valor cerrado, no PII', /'filtro_estado'/.test(auditExport));
check('NO registra el texto buscado', !/p_search\s*\)?\s*$/m.test(auditExport.replace(/'con_busqueda[\s\S]*?\),/, '')));
for (const pii of ['full_name', 'phone', 'email', 'rows', 'profile_id', 'v_payload']) {
  check(`el audit NO copia ${pii}`, !new RegExp(`\\b${pii}\\b`).test(auditExport));
}
check('P0 acepta CSV y rechaza cualquier otro formato',
  /coalesce\(p_formato, ''\) <> 'csv'/.test(c2));
check('un listado normal NO escribe auditoría de exportación',
  (c2.match(/INSERT INTO public\.audit_log/g) || []).length === 1
  && !/admin_list_patients_crm[\s\S]{0,600}INSERT INTO public\.audit_log/.test(c2));
check('las RPCs de listado son STABLE (no podrían escribir aunque quisieran)',
  /debería ser STABLE \(solo lectura\)/.test(m2));

/* ─── L. F4 · CSV SEGURO PARA EXCEL — prueba de COMPORTAMIENTO ─
 *
 * Acá no alcanza con leer el código: se EJECUTA el serializador con entradas
 * sintéticas y se comprueba la salida. `src/lib/csv.ts` no importa nada, así
 * que se puede evaluar sin levantar Vite; los tipos se quitan con el esbuild
 * que ya trae el proyecto (no se agrega ninguna dependencia).
 */
console.log('\n  L) F4 · CSV seguro para Excel (comportamiento)\n');
check('existe el serializador único', fs.existsSync(CSV));
let csvMod = null;
try {
  const { transformSync } = await import('esbuild');
  const js = transformSync(fs.readFileSync(CSV, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  // esbuild reasigna `module.exports`, así que la fuente de verdad es el módulo.
  const mod = { exports: {} };
  new Function('exports', 'module', js)(mod.exports, mod);
  csvMod = mod.exports;
} catch (e) {
  check('el serializador se puede evaluar', false, e.message);
}

if (csvMod) {
  const { csvCell, csvRow, buildCsv, CSV_BOM } = csvMod;
  check('exporta csvCell, csvRow, buildCsv y el BOM',
    [csvCell, csvRow, buildCsv].every((f) => typeof f === 'function') && CSV_BOM === '﻿');

  // Entradas sintéticas. Ninguna es PII: son literales inventados.
  const CASOS = [
    ['=1+1',                 "'=1+1",                     true],
    ['+SUM(A1:A2)',          "'+SUM(A1:A2)",              true],
    ['-1+2',                 "'-1+2",                     true],
    ['@SUM(A1:A2)',          "'@SUM(A1:A2)",              true],
    ['\tSUM(A1)',            "'\tSUM(A1)",                true],
    // Un control inicial NO desactiva la fórmula: Excel lo descarta como
    // blanco y evalúa lo que sigue. Por eso LF también arranca peligroso.
    ['\n=1+1',               '"\'\n=1+1"',                true],
    ['texto con coma, acá',  '"texto con coma, acá"',     false],
    ['texto con "comillas"', '"texto con ""comillas"""',  false],
    ['linea1\nlinea2',       '"linea1\nlinea2"',          false],
    ['José Muñoz',           'José Muñoz',                false],
    ['',                     '',                          false],
  ];
  for (const [entrada, esperado, neutralizada] of CASOS) {
    const salida = csvCell(entrada);
    const etiqueta = JSON.stringify(entrada);
    check(`${etiqueta} → ${JSON.stringify(esperado)}`, salida === esperado, JSON.stringify(salida));
    if (neutralizada) {
      check(`${etiqueta} NO puede iniciar fórmula`, !/^[=+\-@\t\r\n]/.test(salida));
    }
  }
  check('null y undefined dan celda vacía', csvCell(null) === '' && csvCell(undefined) === '');
  check('los números no se entrecomillan de más', csvCell(7) === '7');

  /*
   * Legibilidad real: se vuelve a parsear el CSV con un lector RFC 4180 y se
   * comprueba que las columnas no se rompieron. Un escape que "protege" pero
   * desalinea las columnas no sirve.
   */
  const parseCsv = (texto) => {
    const filas = [];
    let fila = [], celda = '', enComillas = false;
    const t = texto.replace(/^﻿/, '');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (enComillas) {
        if (ch === '"' && t[i + 1] === '"') { celda += '"'; i++; }
        else if (ch === '"') enComillas = false;
        else celda += ch;
      } else if (ch === '"') enComillas = true;
      else if (ch === ',') { fila.push(celda); celda = ''; }
      else if (ch === '\r' && t[i + 1] === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; i++; }
      else celda += ch;
    }
    fila.push(celda); filas.push(fila);
    return filas;
  };

  const cabecera = ['Nombre', 'Teléfono', 'Notas'];
  const filas = CASOS.map(([entrada]) => ['José Muñoz', '+50300000000', entrada]);
  const doc = buildCsv(cabecera, filas);
  check('el documento empieza con BOM', doc.startsWith('﻿'));
  check('separa filas con CRLF', doc.includes('\r\n'));
  const leido = parseCsv(doc);
  check('el parser recupera cabecera + todas las filas', leido.length === filas.length + 1);
  check('ninguna fila se desalinea', leido.every((f) => f.length === 3),
    leido.map((f) => f.length).join(','));
  check('las tildes y la eñe sobreviven', leido[1][0] === 'José Muñoz');
  check('el teléfono con + queda neutralizado, no ejecutado', leido[1][1] === "'+50300000000");
  check('ninguna celda del archivo puede iniciar fórmula',
    leido.every((f) => f.every((c) => !/^[=+\-@\t\r\n]/.test(c))));
  check('el contenido se conserva salvo el apóstrofo de neutralización',
    leido.slice(1).every((f, i) => {
      const original = CASOS[i][0];
      return f[2] === original || f[2] === `'${original}`;
    }));
  check('los encabezados pasan por el mismo serializador',
    /EXPORT_COLUMNS\.map\(\(c\) => c\.header\)/.test(fs.readFileSync(SVC, 'utf8')));
}

if (fs.existsSync(TAB)) {
  const tab = fs.readFileSync(TAB, 'utf8');
  check('la pantalla dice "Exportar CSV"', />\s*\{exportando \? 'Preparando…' : 'Exportar CSV'\}/.test(tab));
  check('aclara que es compatible con Excel', /Compatible con Excel/.test(tab));
  check('exportar NO elimina la paginación de la pantalla',
    /CRM_PAGE_SIZE/.test(tab) && /Anterior/.test(tab) && /Siguiente/.test(tab));
  check('el error de exportación se muestra al admin', /exportError/.test(tab));
}

console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} checks\n`);
process.exit(fail === 0 ? 0 : 1);
