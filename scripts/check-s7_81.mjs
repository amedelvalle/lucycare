#!/usr/bin/env node
/**
 * check-s7_81.mjs — DOCTOR-OWNER-NOTIFICATIONS-P0 · corrección semántica
 *
 * s7_81 corrige que un aviso de `doctor_profile_claimed` se renderizaba con
 * datos del PRESENTE (perfil actual del médico, `lucy_status` actual) en vez
 * de con los del evento que anuncia.
 *
 * La prueba central es un A/B: aplicando TRES ediciones al cuerpo de s7_80 se
 * obtiene el de s7_81, byte a byte. Si coincide, no se coló ningún cambio
 * silencioso; si no coincide, el check dice en qué línea.
 *
 *   node scripts/check-s7_81.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const M80 = 'migrations/s7_80_doctor_owner_notifications.sql';
const M81 = 'migrations/s7_81_notification_event_semantics.sql';
const RB = 'docs/rollbacks/s7_81_rollback.sql';

let pass = 0, fail = 0;
const check = (l, ok, d) => {
  if (ok) { pass++; console.log(`  ok   ${l}`); }
  else { fail++; console.log(`  FAIL ${l}${d ? `\n         ${d}` : ''}`); }
};

// Normalización a LF en la puerta: con core.autocrlf=true los .sql quedan con
// CRLF y cualquier ancla multilínea dejaría de casar (la deuda de check-s7_76).
const read = (p) => {
  const f = resolve(ROOT, p);
  if (!existsSync(f)) { console.error(`\nNo existe ${p}`); process.exit(1); }
  return readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
};

/** Cuerpo de notify_owner_claim_batch como array de líneas. */
const funcion = (txt) => {
  const l = txt.split('\n');
  const a = l.findIndex((x) => x.startsWith('CREATE OR REPLACE FUNCTION public.notify_owner_claim_batch('));
  if (a < 0) return [];
  let b = -1;
  for (let i = a; i < l.length; i++) if (l[i] === '$batch$;') { b = i; break; }
  return b < 0 ? [] : l.slice(a, b + 1);
};

const s80 = read(M80), s81 = read(M81), rb = read(RB);
const f80 = funcion(s80), f81 = funcion(s81), fRb = funcion(rb);

console.log('\ncheck-s7_81 — el aviso de claim representa el evento, no el presente\n');

// ─── 0 · Control de sanidad ─────────────────────────────────
console.log('0. Control de sanidad del instrumento');
check('CONTROL: s7_80 expone la función', f80.length > 50);
check('CONTROL: s7_81 expone la función', f81.length > 50);
check('CONTROL: el rollback expone la función', fRb.length > 50);
check('CONTROL: s7_80 NO se modificó (sigue con el defecto)', f80.join('\n').includes('p.id  = d.profile_id'));

// ─── 1 · A/B: s7_80 + tres ediciones == s7_81 ───────────────
console.log('\n1. A/B estructural');
const EDICIONES = [
  {
    n: 'el CTE conserva subject_profile_id',
    de: '    RETURNING n.id, n.event_type, n.occurred_at, n.attempts,\n              n.subject_request_id, n.subject_doctor_id',
    a: '    RETURNING n.id, n.event_type, n.occurred_at, n.attempts,\n              n.subject_request_id, n.subject_doctor_id, n.subject_profile_id',
  },
  {
    n: 'el nombre sale del profile DEL EVENTO',
    de: '    LEFT JOIN public.profiles    p  ON p.id  = d.profile_id;',
    a: '    LEFT JOIN public.profiles    p  ON p.id  = c.subject_profile_id;',
  },
  {
    n: 'lucy_status del claim es el literal del evento',
    de: "             'lucy_status',\n               CASE WHEN c.event_type = 'doctor_profile_claimed'\n                    THEN d.lucy_status::text END",
    a: "             'lucy_status',\n               CASE WHEN c.event_type = 'doctor_profile_claimed'\n                    THEN 'claimed' END",
  },
];

let derivado = f80.join('\n');
for (const e of EDICIONES) {
  const veces = derivado.split(e.de).length - 1;
  check(`ancla única en s7_80: ${e.n}`, veces === 1, `apariciones: ${veces}`);
  derivado = derivado.split(e.de).join(e.a);
}

const igual = derivado === f81.join('\n');
if (!igual) {
  const A = derivado.split('\n'), B = f81.join('\n').split('\n');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) {
      check('A/B: s7_80 + las TRES ediciones == s7_81', false,
        `línea ${i}\n           esperado: ${JSON.stringify(A[i])}\n           obtuvo  : ${JSON.stringify(B[i])}`);
      break;
    }
  }
} else {
  check('A/B: s7_80 + las TRES ediciones == s7_81', true);
}
check('A/B: sin las ediciones NO coincide (el instrumento discrimina)', f80.join('\n') !== f81.join('\n'));

// Exactamente tres líneas distintas, ni una más.
const distintas = f80.reduce((n, l, i) => n + (l !== f81[i] ? 1 : 0), 0);
check('exactamente 3 líneas difieren', distintas === 3, `difieren ${distintas}`);
check('mismo número de líneas', f80.length === f81.length, `${f80.length} vs ${f81.length}`);

// ─── 2 · La semántica corregida ─────────────────────────────
console.log('\n2. Semántica del evento');
const c81 = f81.join('\n');
check('el CTE devuelve subject_profile_id', /RETURNING[\s\S]{0,140}n\.subject_profile_id/.test(c81));
check('el nombre usa el profile del evento', c81.includes('LEFT JOIN public.profiles    p  ON p.id  = c.subject_profile_id;'));
check('YA NO usa el profile actual del médico', !c81.includes('p.id  = d.profile_id'));
check("lucy_status del claim es el literal 'claimed'", /THEN 'claimed' END/.test(c81));
check('YA NO lee d.lucy_status', !c81.includes('d.lucy_status'));
check('el evento de afiliación NO cambió', c81.includes('THEN r.full_name ELSE p.full_name END'));

// ─── 3 · Lo que NO debía moverse ────────────────────────────
console.log('\n3. Todo lo demás, intacto');
for (const inv of [
  'FOR UPDATE SKIP LOCKED',
  "interval '23 hours'",
  'idem_window_expired',
  'first_attempt_at = COALESCE(n.first_attempt_at, now())',
  'ORDER BY n.occurred_at, n.id',
  "LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)",
  'LANGUAGE plpgsql SECURITY DEFINER',
  'SET search_path = public',
]) check(`conserva: ${inv}`, c81.includes(inv));

const ex81 = s81.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
check('NO crea ni altera tablas', !/CREATE TABLE|ALTER TABLE|DROP TABLE/i.test(ex81));
check('NO toca triggers', !/CREATE TRIGGER|DROP TRIGGER/i.test(ex81));
check('NO redefine el helper de encolado', !/CREATE OR REPLACE FUNCTION public\._enqueue/.test(ex81));
check('NO redefine mark_result', !/CREATE OR REPLACE FUNCTION public\.notify_owner_mark_result/.test(ex81));
check('NO redefine claim_doctor_profile', !/CREATE OR REPLACE FUNCTION claim_doctor_profile/.test(ex81));
check('NO instala pg_net', !/CREATE EXTENSION|pg_net/i.test(ex81));
check('NO toca auth.users', !/auth\.users/i.test(ex81));
check('una sola CREATE OR REPLACE FUNCTION', (ex81.match(/CREATE OR REPLACE FUNCTION/g) || []).length === 1);

// ─── 4 · Privilegios ────────────────────────────────────────
console.log('\n4. Privilegios');
check('REVOKE de PUBLIC', ex81.includes('REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM PUBLIC;'));
check('REVOKE de anon', ex81.includes('FROM anon;'));
check('REVOKE de authenticated', ex81.includes('FROM authenticated;'));
check('GRANT solo a service_role', /GRANT EXECUTE ON FUNCTION public\.notify_owner_claim_batch\(int, interval, interval\) TO service_role;/.test(ex81));
check('NO otorga a anon ni authenticated', !/GRANT EXECUTE[^;]*TO (anon|authenticated)/.test(ex81));

// ─── 5 · PRE y POST ─────────────────────────────────────────
console.log('\n5. PRE y POST');
check('PRE aborta si s7_80 no está aplicada', /PRE falló: no existe la outbox/.test(s81));
check('PRE aborta si la función no trae el defecto', /PRE falló: la función no trae el join defectuoso/.test(s81));
check('PRE aborta si s7_81 ya está aplicada', /PRE falló: la corrección ya está aplicada/.test(s81));
check('PRE verifica que la ventana de 23 h siga ahí', /PRE falló: falta la ventana de 23 h/.test(s81));
check('POST verifica el join corregido', /POST falló: el nombre no sale del profile del evento/.test(s81));
check('POST verifica que muera el join viejo', /POST falló: sobrevive el join al profile actual/.test(s81));
check('POST verifica el literal claimed', /POST falló: lucy_status del claim no es el literal/.test(s81));
check('POST verifica que no se alteró nada más', /POST falló: s7_81 alteró algo que debía quedar intacto/.test(s81));
check('POST verifica que la allowlist no ganó campos', /POST falló: la allowlist ganó un campo no aprobado/.test(s81));
check('POST verifica que sobrevive lo de s7_80', /POST falló: desapareció algo de s7_80/.test(s81));

// ─── 6 · Rollback ───────────────────────────────────────────
console.log('\n6. Rollback');
// Acotado al CUERPO de la función: el POST del rollback nombra a propósito lo
// prohibido, y medirlo contra el archivo entero daría un FAIL espurio.
const cRb = fRb.join('\n');
check('restaura EXACTAMENTE el cuerpo de s7_80', cRb === f80.join('\n'));
check('el cuerpo restaurado NO trae la corrección', !cRb.includes('c.subject_profile_id'));
check('reafirma los privilegios', /GRANT EXECUTE ON FUNCTION public\.notify_owner_claim_batch\(int, interval, interval\) TO service_role;/.test(rb));
check('NO borra la outbox', !/DROP TABLE/i.test(rb));
check('NO borra el helper ni mark_result', !/DROP FUNCTION/i.test(rb));
check('POST del rollback comprueba que vuelve el join de s7_80', /ROLLBACK fallo: no volvio el join de s7_80/.test(rb));
check('POST del rollback comprueba la ventana', /ROLLBACK fallo: se perdio la ventana de idempotencia/.test(rb));

// ─── 7 · Numeración y alcance ───────────────────────────────
console.log('\n7. Alcance');
check('la migración se llama s7_81', existsSync(resolve(ROOT, M81)));
check('s7_80 sigue existiendo', existsSync(resolve(ROOT, M80)));
check('s7_79 sigue existiendo', existsSync(resolve(ROOT, 'migrations/s7_79_admin_doctor_export_slug.sql')));
check('el rollback de s7_81 existe', existsSync(resolve(ROOT, RB)));

console.log(`\n${pass}/${pass + fail} · ${fail === 0 ? 'PASS' : `${fail} FAIL`}\n`);
process.exit(fail === 0 ? 0 : 1);
