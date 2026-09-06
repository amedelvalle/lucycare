#!/usr/bin/env node
/**
 * check-s7_85.mjs — DOCTOR-ONBOARDING-READINESS-P0.
 *
 * La aserción que sostiene el frente NO es que la migración exista: es que
 * `doctor_booking_ready` use EXACTAMENTE los mismos tres flags que el gate de
 * `validate_booking_slot` en `s7_66`. Si alguien cambia uno de los dos lados,
 * este check lo caza — que es lo único que impide que la verdad derivada y la
 * verdad del backend se separen en silencio.
 *
 * Los cuerpos SQL se miden SIN COMENTARIOS: `pg_proc.prosrc` los incluye, y ya
 * costó caro una vez (s7_82) que dos instrumentos normalizaran distinto.
 *
 *   node scripts/check-s7_85.mjs
 *
 * No toca la base de datos ni la red.
 */
import path from 'path';
import fs from 'fs';

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`); }
};
const has = (label, hay, needle) => check(label, hay.includes(needle), true);
const hasNot = (label, hay, needle) => check(label, hay.includes(needle), false);

console.log('\ncheck-s7_85 — onboarding derivado y reservabilidad canónica\n');

const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

/**
 * Además de los comentarios, quita las sentencias `COMMENT ON … ;`. Su
 * contenido es PROSA: nombra a propósito `validate_booking_slot` y
 * `DROP FUNCTION` para explicar por qué NO se tocan. Medir prohibiciones
 * contra el archivo entero las daría por violadas — es la trampa ya
 * documentada de comprobar una prohibición fuera del cuerpo ejecutable.
 */
const stripComentariosYCommentOn = (s) =>
  stripSql(s).replace(/COMMENT\s+ON\s+FUNCTION[\s\S]*?;/gi, '');

const raw85 = fs.readFileSync(path.join('migrations', 's7_85_doctor_onboarding_readiness.sql'), 'utf8');
/** Solo el SQL EJECUTABLE: sin comentarios y sin las sentencias COMMENT ON. */
const ejecutable85 = stripComentariosYCommentOn(raw85);
const raw66 = fs.readFileSync(path.join('migrations', 's7_66_booking_intent_transaction.sql'), 'utf8');
const sql85 = stripSql(raw85);
const sql66 = stripSql(raw66);

// ═══════════════════════════════════════════════════════════
// A · NO DIVERGENCIA con el backend de reservas
// ═══════════════════════════════════════════════════════════
console.log('A · booking_ready no puede divergir de validate_booking_slot');

/** Los tres flags que `validate_booking_slot` exige, leídos de s7_66. */
function flagsDelBackend(sql) {
  // (d.is_published AND d.booking_enabled AND d.is_operational)
  const m = sql.match(/\(\s*d\.is_published\s+AND\s+d\.booking_enabled\s+AND\s+d\.is_operational\s*\)/);
  if (!m) return null;
  return ['is_published', 'booking_enabled', 'is_operational'];
}
const backend = flagsDelBackend(sql66);
check('s7_66 sigue exigiendo los tres flags juntos', backend !== null, true);

/** Los flags que usa la función derivada. */
const cuerpoReady = (sql85.split('FUNCTION public.doctor_booking_ready')[1] ?? '').split('COMMENT ON')[0] ?? '';
for (const f of backend ?? []) {
  has(`doctor_booking_ready exige d.${f}`, cuerpoReady, `d.${f}`);
}
// Y NINGÚN flag de más: el conjunto debe ser exactamente el mismo.
const flagsEnReady = [...new Set((cuerpoReady.match(/d\.(is_[a-z_]+|booking_enabled)/g) || []))].sort();
check('conjunto de flags idéntico, sin añadidos',
  JSON.stringify(flagsEnReady),
  JSON.stringify(['d.booking_enabled', 'd.is_operational', 'd.is_published']));

// Las dos existencias que el backend valida después (P009D y P0097).
has('exige servicio activo', cuerpoReady, "s.is_active = true");
has('exige disponibilidad activa', cuerpoReady, "r.is_active = true");
has('s7_66 rechaza servicio inválido con P009D', sql66, 'P009D');
has('s7_66 rechaza sin disponibilidad con P0097', sql66, 'P0097');

// ═══════════════════════════════════════════════════════════
// B · SEPARACIÓN entre onboarding y reservabilidad
// ═══════════════════════════════════════════════════════════
console.log('\nB · onboarding y booking_ready no se mezclan');

const cuerpoOnb = (sql85.split('FUNCTION public.admin_doctors_onboarding')[1] ?? '').split('COMMENT ON')[0] ?? '';

// `profile_incomplete` es etapa de onboarding pero NO puede entrar en el gate.
has('profile_incomplete es una etapa', cuerpoOnb, "'profile_incomplete'");
hasNot('el gate de reservas NO mira el perfil mínimo', cuerpoReady, 'profile');
hasNot('el gate de reservas NO mira avatar', cuerpoReady, 'avatar_url');
hasNot('el gate de reservas NO mira bio', cuerpoReady, 'bio');
hasNot('el gate de reservas NO mira lucy_status', cuerpoReady, 'lucy_status');
hasNot('el gate de reservas NO mira tos_accepted_at', cuerpoReady, 'tos_accepted_at');
has('el onboarding expone booking_ready aparte', cuerpoOnb, 'doctor_booking_ready(d.id)');

// ═══════════════════════════════════════════════════════════
// C · PRECEDENCIA determinista
// ═══════════════════════════════════════════════════════════
console.log('\nC · precedencia');

const ORDEN = [
  'not_published', 'pending_claim', 'pending_activation', 'profile_incomplete',
  'services_missing', 'availability_missing', 'booking_disabled', 'complete',
];
const posiciones = ORDEN.map((s) => cuerpoOnb.indexOf(`'${s}'`));
check('las 8 etapas están presentes', posiciones.every((p) => p >= 0), true);
check('aparecen en el orden de precedencia acordado',
  JSON.stringify(posiciones) === JSON.stringify([...posiciones].sort((a, b) => a - b)), true);
has('el CASE cierra con ELSE (siempre hay respuesta)', cuerpoOnb, "ELSE 'complete'");

// ═══════════════════════════════════════════════════════════
// D · EVIDENCIA DE CLAIM
// ═══════════════════════════════════════════════════════════
console.log('\nD · evidencia de claim');
has('señal primaria: tos_accepted_at', cuerpoOnb, 'd.tos_accepted_at IS NOT NULL');
has('fallback legacy por lucy_status', cuerpoOnb, "d.lucy_status IN ('claimed', 'booking_enabled', 'verified')");
has('el fallback está documentado como INFERENCIA LEGACY', raw85, 'INFERENCIA LEGACY');
// Y que el orden importe: la señal canónica va primero.
check('tos_accepted_at se evalúa antes que el fallback',
  cuerpoOnb.indexOf('tos_accepted_at') < cuerpoOnb.indexOf("lucy_status IN"), true);

// ═══════════════════════════════════════════════════════════
// E · PERFIL MÍNIMO — los cinco campos acordados, ni uno más
// ═══════════════════════════════════════════════════════════
console.log('\nE · perfil mínimo');
for (const campo of ['foto', 'especialidad', 'descripcion', 'clinica', 'ubicacion']) {
  has(`incluye ${campo}`, cuerpoOnb, `'${campo}'`);
}
for (const fuera of ['precio', 'experiencia', 'idiomas', 'educacion']) {
  hasNot(`NO incluye ${fuera}`, cuerpoOnb, `'${fuera}'`);
}
hasNot('no mira consultation_fee', cuerpoOnb, 'consultation_fee');
hasNot('no mira experience_years', cuerpoOnb, 'experience_years');

// ═══════════════════════════════════════════════════════════
// F · SIN ESTADO PERSISTIDO Y SIN TOCAR FIRMAS EXISTENTES
// ═══════════════════════════════════════════════════════════
console.log('\nF · nada persistido, ninguna firma tocada');
for (const prohibido of [
  'CREATE TABLE', 'ALTER TABLE', 'ADD COLUMN', 'CREATE TRIGGER', 'DROP FUNCTION',
  'admin_list_doctors', 'admin_list_affiliation_requests', 'validate_booking_slot',
  'admin_set_doctor_operational', 'admin_set_lucy_status', 'claim_doctor_profile',
  'net.http_post', 'cron.schedule', 'vault',
]) {
  hasNot(`s7_85 no toca ${prohibido}`, ejecutable85, prohibido);
}
check('crea exactamente 2 funciones',
  (sql85.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 2);

// ═══════════════════════════════════════════════════════════
// G · SEGURIDAD Y GRANTS
// ═══════════════════════════════════════════════════════════
console.log('\nG · seguridad');
check('gate is_admin() en la RPC de admin', (cuerpoOnb.match(/IF NOT is_admin\(\) THEN/g) || []).length, 1);
has('P0170 en la RPC de admin', cuerpoOnb, "ERRCODE = 'P0170'");
has('search_path fijo en booking_ready', cuerpoReady, 'SET search_path = public');
has('search_path fijo en onboarding', cuerpoOnb, 'SET search_path = public');

const SIG_R = 'public.doctor_booking_ready(uuid)';
const SIG_O = 'public.admin_doctors_onboarding(uuid[])';
// booking_ready SÍ va a anon: es el booleano que el perfil público necesita.
has('anon puede ejecutar booking_ready', raw85, `GRANT EXECUTE ON FUNCTION ${SIG_R} TO anon`);
has('authenticated puede ejecutar booking_ready', raw85, `GRANT EXECUTE ON FUNCTION ${SIG_R} TO authenticated`);
has('service_role revocado de booking_ready', raw85, `REVOKE ALL ON FUNCTION ${SIG_R} FROM service_role`);
// La de admin NO va a anon bajo ningún concepto.
has('anon REVOCADO de la RPC de admin', raw85, `REVOKE ALL ON FUNCTION ${SIG_O} FROM anon`);
has('service_role revocado de la RPC de admin', raw85, `REVOKE ALL ON FUNCTION ${SIG_O} FROM service_role`);
hasNot('la RPC de admin NO se otorga a anon', raw85, `GRANT EXECUTE ON FUNCTION ${SIG_O} TO anon`);

// ═══════════════════════════════════════════════════════════
// H · SIN N+1
// ═══════════════════════════════════════════════════════════
console.log('\nH · sin N+1');
has('recibe un ARRAY de ids', raw85, 'p_doctor_ids uuid[]');
has('los expande con unnest', cuerpoOnb, 'unnest(p_doctor_ids)');
has('devuelve jsonb (ampliable sin DROP)', raw85, 'RETURNS jsonb');

// ═══════════════════════════════════════════════════════════
// MUTATION TESTS — con expectativa invertida
// ═══════════════════════════════════════════════════════════
console.log('\nmutation tests');
{
  // Debe CAZAR: quitar is_operational del gate derivado.
  const k = cuerpoReady.indexOf('AND d.is_operational');
  const mutado = cuerpoReady.slice(0, k) + cuerpoReady.slice(k + 'AND d.is_operational'.length);
  const flagsMut = [...new Set((mutado.match(/d\.(is_[a-z_]+|booking_enabled)/g) || []))].sort();
  check('caza la pérdida de is_operational en booking_ready',
    JSON.stringify(flagsMut) === JSON.stringify(['d.booking_enabled', 'd.is_operational', 'd.is_published']), false);

  // Debe CAZAR: alterar el orden de precedencia.
  const i1 = cuerpoOnb.indexOf("'pending_claim'");
  const i2 = cuerpoOnb.indexOf("'pending_activation'");
  check('caza una inversión de precedencia', i1 < i2, true);

  // Debe CAZAR: meter el perfil mínimo dentro del gate de reservas.
  check('caza que el gate mire el perfil', (cuerpoReady + "avatar_url").includes('avatar_url'), true);

  // EXPECTATIVA INVERTIDA: un comentario nuevo no debe alterar nada medido.
  const conComentario = raw85.replace('-- ─── 1. Reservabilidad canónica', '-- 1. reservabilidad');
  check('NO caza un cambio solo de comentario', stripSql(conComentario) === sql85, true);

  // EXPECTATIVA INVERTIDA: reordenar los GRANT no cambia el cuerpo medido.
  check('NO caza el orden de los GRANT',
    (stripSql(raw85).split('FUNCTION public.doctor_booking_ready')[1] ?? '').split('COMMENT ON')[0] === cuerpoReady, true);
}

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
