#!/usr/bin/env node
/**
 * check-s7_86.mjs — onboarding en el export CSV de médicos.
 *
 * La aserción fuerte NO es «s7_86 menciona onboarding»: es que su bloque de
 * función sea **byte-idéntico** al de `s7_79` una vez retiradas las DOS
 * ediciones declaradas —el LEFT JOIN LATERAL y las tres claves—. Eso demuestra
 * que no se aprovechó la migración para tocar el gate, el tope, el orden del
 * `jsonb_agg` ni la auditoría.
 *
 *   node scripts/check-s7_86.mjs
 *
 * No toca la base de datos ni la red.
 */
import path from 'path';
import fs from 'fs';

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else {
    fail++;
    console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`);
  }
};
const has = (label, hay, needle) => check(label, hay.includes(needle), true);
const hasNot = (label, hay, needle) => check(label, hay.includes(needle), false);

console.log('\ncheck-s7_86 — onboarding en el export CSV\n');

const P79 = path.join('migrations', 's7_79_admin_doctor_export_slug.sql');
const P86 = path.join('migrations', 's7_86_admin_doctor_export_onboarding.sql');
const PRB = path.join('docs', 'rollbacks', 's7_86_rollback.sql');
const PSV = path.join('src', 'services', 'admin.service.ts');

/**
 * Normaliza CRLF → LF. En Windows `core.autocrlf=true` deja los `.sql` con
 * CRLF en el working tree mientras el blob de git está en LF: sin esto el
 * check pasa en un checkout y falla en otro. Es la deuda de `check-s7_76`,
 * cerrada en origen desde `check-s7_84`.
 */
const leerLFDe = (s) => s.split('\r\n').join('\n');
const leerLF = (p) => leerLFDe(fs.readFileSync(p, 'utf8'));

const raw79 = leerLF(P79);
const raw86 = leerLF(P86);
const rawRb = leerLF(PRB);
const svc = leerLF(PSV);

const SIG = 'CREATE OR REPLACE FUNCTION public.admin_export_doctors';

/** Bloque completo de la función: del CREATE al cierre `$$;`. */
function bloqueFuncion(sql) {
  const i = sql.indexOf(SIG);
  if (i === -1) return null;
  const j = sql.indexOf('\n$$;', i);
  if (j === -1) return null;
  return sql.slice(i, j + 4);
}

const b79 = bloqueFuncion(raw79);
const b86 = bloqueFuncion(raw86);
check('s7_79 contiene la función', b79 !== null, true);
check('s7_86 contiene la función', b86 !== null, true);

// ═══════════════════════════════════════════════════════════
// 1 · LAS DOS EDICIONES DECLARADAS
// ═══════════════════════════════════════════════════════════
console.log('\n1 · las dos ediciones');
has('LEFT JOIN LATERAL de _doctor_onboarding', b86,
  'LEFT JOIN LATERAL public._doctor_onboarding(d.id) AS onb(payload) ON true');
has('clave onb_stage', b86, "'onb_stage',       onb.payload ->> 'stage'");
has('clave onb_next_action', b86, "'onb_next_action', onb.payload ->> 'next_action'");
has('clave booking_ready', b86, "'booking_ready',   coalesce((onb.payload -> 'booking_ready')::boolean, false)");

// UNA sola llamada en todo el bloque. Es LA garantía de rendimiento.
const llamadas = (b86.match(/_doctor_onboarding\s*\(/g) || []).length;
check('EXACTAMENTE una llamada a _doctor_onboarding', llamadas, 1);

// Y ninguna en la lista de selección: si estuviera ahí, serían N por fila.
const listaSeleccion = b86.slice(
  b86.indexOf('jsonb_build_object('),
  b86.indexOf('FROM public.admin_list_doctors'),
);
hasNot('la función NO se llama en la lista de selección', listaSeleccion, '_doctor_onboarding');

// ═══════════════════════════════════════════════════════════
// 2 · A/B — retiradas las dos ediciones, es s7_79 byte a byte
// ═══════════════════════════════════════════════════════════
console.log('\n2 · A/B contra s7_79');
{
  // Splice por índice, nunca `String.replace` con cadena: `$$` se interpretaría
  // como el marcador de "coincidencia completa". Lección de s7_81.
  function quitar(texto, fragmento) {
    const k = texto.indexOf(fragmento);
    if (k === -1) return null;
    return texto.slice(0, k) + texto.slice(k + fragmento.length);
  }

  const LATERAL_BLOQUE =
    '    -- s7_86 · UNA evaluación de onboarding por médico.\n' +
    '    -- La función va en el FROM, no en la lista de selección: así es un\n' +
    '    -- Function Scan que se evalua una vez por fila externa, y las tres\n' +
    '    -- claves de abajo leen una columna ya materializada. Con tres llamadas\n' +
    '    -- escalares serian tres evaluaciones por medico: PostgreSQL no deduplica\n' +
    '    -- llamadas a funcion, y _doctor_onboarding no se puede inlinear por ser\n' +
    '    -- SECURITY DEFINER y tener SET search_path.\n' +
    '    -- LEFT JOIN y no CROSS JOIN: si la funcion no devolviera fila, un CROSS\n' +
    '    -- JOIN borraria al medico del CSV en silencio.\n' +
    '    LEFT JOIN LATERAL public._doctor_onboarding(d.id) AS onb(payload) ON true\n';

  const CLAVES_BLOQUE =
    ",\n        -- s7_86 · las TRES salen del mismo payload ya evaluado.\n" +
    "        'onb_stage',       onb.payload ->> 'stage',\n" +
    "        'onb_next_action', onb.payload ->> 'next_action',\n" +
    "        'booking_ready',   coalesce((onb.payload -> 'booking_ready')::boolean, false)";

  let reducido = quitar(b86, LATERAL_BLOQUE);
  check('el bloque LATERAL está tal como se declara', reducido !== null, true);
  if (reducido !== null) {
    reducido = quitar(reducido, CLAVES_BLOQUE);
    check('el bloque de claves está tal como se declara', reducido !== null, true);
  }
  check('A/B: retiradas las dos ediciones, es s7_79 byte a byte',
    reducido === b79, true);

  // CONTROL DE SANIDAD invertido: si el A/B no distinguiera nada, mutar el
  // tope tendría que seguir casando. Debe FALLAR.
  if (reducido !== null) {
    const k = reducido.indexOf('MAX_EXPORT constant int := 10000');
    const mutado = reducido.slice(0, k)
      + 'MAX_EXPORT constant int := 99999'
      + reducido.slice(k + 'MAX_EXPORT constant int := 10000'.length);
    check('control: el A/B caza un cambio del tope', mutado === b79, false);
  }
}

// ═══════════════════════════════════════════════════════════
// 3 · LO QUE NO SE TOCA
// ═══════════════════════════════════════════════════════════
console.log('\n3 · invariantes del export');
has('sigue reutilizando admin_list_doctors', b86, 'public.admin_list_doctors(');
has('gate P0140', b86, 'P0140');
has('formato P0142', b86, 'P0142');
has('tope P0146', b86, 'P0146');
has('MAX_EXPORT 10000', b86, 'MAX_EXPORT constant int := 10000');
has('ORDER BY dentro de jsonb_agg', b86,
  "jsonb_agg(x.fila ORDER BY x.created_at DESC, x.id)");
has('auditoría no-PII conserva con_busqueda', b86, "'con_busqueda'");
has('slug de s7_79 intacto', b86, "'slug',         d.slug");
has('SECURITY DEFINER', b86, 'SECURITY DEFINER');
has('search_path fijo', b86, 'SET search_path = public, pg_catalog');

// El cuerpo ejecutable no debe filtrar el checklist detallado ni PII.
//
// ⚠️ Se mide SOLO el bloque de la función, NO el archivo. Las guardas POST
// nombran a propósito todo lo prohibido —es su trabajo— y medir el archivo
// entero las contaba como violaciones. Es la misma lección de s7_82: la guarda
// y su equivalente en JS tienen que medir el MISMO texto.
const ejecutable86 = b86
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');
for (const prohibido of [
  'profile_missing', 'license_number', 'doctor_credentials',
  'tos_accepted_at', 'avatar_url', 'd.bio',
]) {
  hasNot(`no expone ${prohibido}`, ejecutable86, prohibido);
}
check('sin SELECT *', /SELECT\s+\*/.test(ejecutable86), false);

// s7_79 y s7_78 no se editan: son el registro de lo que se ejecutó.
has('s7_79 conserva su propio cuerpo sin onboarding', raw79, "'slug',         d.slug");
hasNot('s7_79 NO menciona onboarding', raw79, '_doctor_onboarding');

// ═══════════════════════════════════════════════════════════
// 4 · PRE y POST
// ═══════════════════════════════════════════════════════════
console.log('\n4 · guardas');
has('PRE exige s7_85 aplicada', raw86, "p.proname = '_doctor_onboarding'");
has('PRE exige SECURITY DEFINER en _doctor_onboarding', raw86,
  'perdio SECURITY DEFINER o SET search_path');
has('PRE aborta si ya está aplicada', raw86, 'ya aplicada — no reaplicar');
has('POST cuenta las llamadas', raw86, "regexp_matches(v_src, '_doctor_onboarding\\s*\\(', 'g')");
has('POST exige exactamente 1 llamada', raw86, 'esperaba exactamente 1');
has('POST normaliza comentarios antes de medir', raw86, "'--[^\\n]*', '', 'g'");
has('POST verifica que admin_list_doctors no cambió', raw86,
  'este frente NO debia tocarla');
has('POST verifica los cuatro roles', raw86, "has_function_privilege('service_role'");

// ═══════════════════════════════════════════════════════════
// 5 · ROLLBACK
// ═══════════════════════════════════════════════════════════
console.log('\n5 · rollback');
has('el rollback existe y describe la reversa', rawRb, 's7_79_admin_doctor_export_slug.sql');
has('verifica que el onboarding salió', rawRb, 'sigue llamando a _doctor_onboarding');
has('NO elimina _doctor_onboarding', rawRb, 'no debe eliminarse');
hasNot('el rollback no hace DROP de la función del export', rawRb,
  'DROP FUNCTION public.admin_export_doctors');

// ═══════════════════════════════════════════════════════════
// 6 · FRONTEND — 20 columnas y una sola petición
// ═══════════════════════════════════════════════════════════
console.log('\n6 · frontend del CSV');
has('la fila del export declara onb_stage', svc, 'onb_stage');
has('la fila del export declara onb_next_action', svc, 'onb_next_action');
has('la fila del export declara booking_ready', svc, 'booking_ready');
has('columna Onboarding', svc, "header: 'Onboarding'");
has('columna Próxima acción', svc, "header: 'Próxima acción'");
has('columna Listo para reservas', svc, "header: 'Listo para reservas'");
has('reutiliza el mapa de etapas', svc, 'ONBOARDING_STAGE_LABEL[');
has('reutiliza el mapa de próximas acciones', svc, 'ONBOARDING_NEXT_ACTION_LABEL[');

// Una sola llamada RPC para el export completo: cero N+1.
const cuerpoExport = svc.slice(
  svc.indexOf('export async function fetchDoctorsForExport'),
  svc.indexOf('const LUCY_STATUS_LABEL'),
);
check('el export hace UNA sola llamada RPC',
  (cuerpoExport.match(/supabase\.rpc\(/g) || []).length, 1);
hasNot('el export NO pide onboarding por médico', cuerpoExport, 'getDoctorsOnboarding');
hasNot('el export NO llama a admin_doctors_onboarding', cuerpoExport,
  'admin_doctors_onboarding');

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
