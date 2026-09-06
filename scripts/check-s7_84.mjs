#!/usr/bin/env node
/**
 * check-s7_84.mjs — volatilidad de `_welcome_email_claimable`.
 *
 * La aserción fuerte NO es "s7_84 dice STABLE": es que el bloque de la función
 * en `s7_84` sea **byte-idéntico** al de `s7_83` una vez normalizada la palabra
 * de volatilidad. Eso demuestra que cambió la volatilidad y NADA MÁS — ni la
 * firma, ni el cuerpo, ni las ventanas de 23 h / 10 min.
 *
 * Impide la regresión en las dos direcciones: que `s7_84` vuelva a IMMUTABLE, y
 * que alguien "aproveche" la migración para tocar la lógica.
 *
 *   node scripts/check-s7_84.mjs
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

console.log('\ncheck-s7_84 — _welcome_email_claimable pasa a STABLE\n');

const P83 = path.join('migrations', 's7_83_doctor_welcome_email.sql');
const P84 = path.join('migrations', 's7_84_welcome_claimable_stable.sql');
const raw83 = fs.readFileSync(P83, 'utf8');
const raw84 = fs.readFileSync(P84, 'utf8');

const SIG = 'CREATE OR REPLACE FUNCTION public._welcome_email_claimable';

/** Bloque completo de la función: del CREATE al cierre `$$;`. */
function bloqueFuncion(sql) {
  const i = sql.indexOf(SIG);
  if (i === -1) return null;
  const j = sql.indexOf('$$;', i);
  if (j === -1) return null;
  return sql.slice(i, j + 3);
}

const b83 = bloqueFuncion(raw83);
const b84 = bloqueFuncion(raw84);

check('s7_83 contiene la función', b83 !== null, true);
check('s7_84 contiene la función', b84 !== null, true);

// ── Lo que debe haber cambiado ──
has('s7_84 declara STABLE', b84, '\nSTABLE\n');
hasNot('s7_84 NO declara IMMUTABLE', b84, 'IMMUTABLE');
hasNot('s7_84 NO declara VOLATILE', b84, '\nVOLATILE\n');

// ── s7_83 NO se toca: es el registro de lo que se ejecutó ──
has('s7_83 conserva IMMUTABLE (no se editó)', b83, '\nIMMUTABLE\n');

// ── A/B: normalizada la volatilidad, los bloques son IDÉNTICOS ──
// Splice por índice, nunca `replace` con cadena: `$$` se interpretaría.
function normalizarVolatilidad(bloque) {
  const k = bloque.indexOf('\nIMMUTABLE\n');
  if (k === -1) return bloque;
  return bloque.slice(0, k) + '\nSTABLE\n' + bloque.slice(k + '\nIMMUTABLE\n'.length);
}
check('A/B: solo cambia la volatilidad, el resto es byte-idéntico',
  normalizarVolatilidad(b83) === b84, true);

// ── Las ventanas siguen intactas ──
has('ventana de 23 h intacta', b84, "interval '23 hours'");
has('espera de 10 minutos intacta', b84, "interval '10 minutes'");
has('sent nunca se reclama', b84, "WHEN p_status = 'sent'     THEN false");
has('firma intacta: p_status', b84, 'p_status           text');
has('firma intacta: p_first_attempt_at', b84, 'p_first_attempt_at timestamptz');
has('firma intacta: p_last_attempt_at', b84, 'p_last_attempt_at  timestamptz');
has('search_path fijo', b84, 'SET search_path = public');

// ── s7_84 no aprovecha para tocar nada más ──
const cuerpo84 = raw84.replace(/--[^\n]*/g, '');
check('s7_84 crea/reemplaza UNA sola función',
  (cuerpo84.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
for (const prohibido of [
  'ALTER TABLE', 'DROP FUNCTION', 'CREATE TABLE', 'CREATE TRIGGER',
  'admin_welcome_email_state', 'admin_welcome_email_claim', 'admin_welcome_email_mark',
  'doctor_owner_notifications', 'net.http_post', 'vault',
]) {
  hasNot(`s7_84 no toca ${prohibido}`, cuerpo84, prohibido);
}

// ── Privilegios re-afirmados para los cuatro roles ──
const SIG_FULL = 'public._welcome_email_claimable(text, timestamptz, timestamptz)';
has('REVOKE PUBLIC', raw84, `REVOKE ALL ON FUNCTION ${SIG_FULL} FROM PUBLIC`);
has('REVOKE anon', raw84, `REVOKE ALL ON FUNCTION ${SIG_FULL} FROM anon`);
has('REVOKE service_role', raw84, `REVOKE ALL ON FUNCTION ${SIG_FULL} FROM service_role`);
has('GRANT authenticated', raw84, `GRANT EXECUTE ON FUNCTION ${SIG_FULL} TO authenticated`);

// ═══════════════════════════════════════════════════════════
// MUTATION TESTS
// ═══════════════════════════════════════════════════════════
console.log('\nmutation tests');
{
  // Debe CAZAR: volver a IMMUTABLE.
  const regresion = normalizarVolatilidad(b83); // = el bloque con STABLE
  const vuelta = regresion.slice(0, regresion.indexOf('\nSTABLE\n'))
    + '\nIMMUTABLE\n'
    + regresion.slice(regresion.indexOf('\nSTABLE\n') + '\nSTABLE\n'.length);
  check('caza la regresión a IMMUTABLE', vuelta.includes('IMMUTABLE'), true);
  check('caza que el A/B ya no case', normalizarVolatilidad(b83) === vuelta, false);

  // Debe CAZAR: tocar una ventana con la excusa de la migración.
  const k = b84.indexOf("interval '23 hours'");
  const ventanaMutada = b84.slice(0, k) + "interval '48 hours'" + b84.slice(k + "interval '23 hours'".length);
  check('caza un cambio de la ventana de 23 h',
    normalizarVolatilidad(b83) === ventanaMutada, false);

  // EXPECTATIVA INVERTIDA: un comentario FUERA de la función no debe cazarse.
  const soloComentario = raw84.replace(
    '-- s7_84 · DOCTOR-WELCOME-EMAIL-P0 · corrección de volatilidad',
    '-- s7_84');
  check('NO caza un cambio de comentario fuera de la función',
    bloqueFuncion(soloComentario) === b84, true);

  // EXPECTATIVA INVERTIDA: reordenar los REVOKE no altera el bloque.
  check('NO caza el orden de los REVOKE',
    bloqueFuncion(raw84) === b84, true);
}

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
