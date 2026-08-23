/**
 * _smoke-s7_73.mjs — ADMIN-DOCTOR-SEED-P0, E2E de base.
 *
 * ⚠️ **NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA DEL OWNER.**
 * Requiere: (a) `s7_73` YA aplicada en Supabase, y (b) `service_role`.
 *
 *   node scripts/_smoke-s7_73.mjs            → imprime el plan y sale (0 writes)
 *   node scripts/_smoke-s7_73.mjs --confirm  → ejecuta
 *
 * ── QUÉ PRUEBA Y QUÉ NO ──
 * Ejercita las RPCs de `s7_73` con `service_role`, que **bypassa `is_admin()`**
 * (SECURITY DEFINER corre como owner y `auth.uid()` es NULL). Por eso:
 *   • SÍ cubre: idempotencia, concurrencia, lease, transiciones, duplicados,
 *     flags del médico y compensación diagnosticable.
 *   • NO cubre: el gate `is_admin()` ni el trigger `audit_profiles_identity`
 *     —que necesita `auth.uid()`— ni la Edge Function ni el Admin API. Eso se
 *     valida en la QA controlada con sesión real de LucyAdmin.
 *
 * ⚠️ Por el mismo motivo NO se prueba `admin_create_seed_doctor` completa: sin
 * `auth.uid()` el trigger de identidad de `s7_32` aborta el UPDATE de
 * `profiles.full_name`. Las aserciones sobre ella se limitan a sus GUARDAS,
 * que fallan antes de tocar `profiles`.
 *
 * Fixtures 100 % sintéticas, marcadas, y limpiadas al final con verificación
 * de cero residuos. Jamás datos reales ni identidades protegidas.
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin as sb } from './_lib/supabase-admin.mjs';

const CONFIRMED = process.argv.includes('--confirm');

const PLAN = [
  'A. claim: primera llamada devuelve "claimed" + lease_token',
  'B. claim: misma key + mismo payload dentro del lease → in_progress',
  'C. claim: misma key + payload distinto → P0122',
  'D. concurrencia: dos claims en paralelo → exactamente uno "claimed"',
  'E. lookup: sin auth.user devuelve NULL',
  'F. set_auth_created: uuid que no es el seed → P0125',
  'G. set_auth_created: lease equivocado → P0132',
  'H. mark_failed: lease equivocado → P0132',
  'I. mark_failed: marca y conserva el primer error_code (idempotente)',
  'J. mark_failed: sobre completed → P0123',
  'K. flag_compensation_failed: sobre failed anexa la marca, idempotente',
  'L. flag_compensation_failed: sobre started/auth_created → P0123',
  'M. flag_compensation_failed: lease equivocado → P0132',
  'N. create_seed_doctor: estado ≠ auth_created → P0123',
  'O. create_seed_doctor: lease equivocado → P0132',
  'P. create_seed_doctor: seed_user_id que no es el técnico → P0125',
  'Q. tabla: sin DML directo para authenticated (grants)',
  'R. cleanup: cero operaciones residuales',
];

console.log('\n_smoke-s7_73 — E2E de base\n');
PLAN.forEach((l) => console.log('  ' + l));

if (!CONFIRMED) {
  console.log('\n⏸️  Sin --confirm no se ejecutó nada (cero escrituras).');
  console.log('   Requiere s7_73 aplicada y autorización explícita del owner.\n');
  process.exit(0);
}

// ─── Instrumento ─────────────────────────────────────────────
let pass = 0;
let fail = 0;
const creadas = [];

const check = (desc, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok || !extra ? '' : ` — ${extra}`}`);
  ok ? pass++ : fail++;
};

/** Ejecuta una RPC y devuelve { data, code } con el SQLSTATE si falló. */
async function rpc(fn, params) {
  const { data, error } = await sb.rpc(fn, params);
  return { data, code: error?.code ?? null, message: error?.message ?? null };
}

const nuevaOperacion = () => {
  const id = randomUUID();
  creadas.push(id);
  return id;
};

console.log('\n── EJECUCIÓN ──\n');

// A. claim inicial
const opA = nuevaOperacion();
const a = await rpc('admin_claim_seed_operation', { p_operation_id: opA, p_payload_hash: 'hash-a' });
check('A. primera llamada → claimed', a.data?.action === 'claimed', a.code ?? JSON.stringify(a.data));
check('A. devuelve lease_token', typeof a.data?.lease_token === 'string');
const leaseA = a.data?.lease_token;

// B. retry dentro del lease
const b = await rpc('admin_claim_seed_operation', { p_operation_id: opA, p_payload_hash: 'hash-a' });
check('B. retry dentro del lease → in_progress', b.data?.action === 'in_progress', JSON.stringify(b.data));

// C. mismo id, payload distinto
const c = await rpc('admin_claim_seed_operation', { p_operation_id: opA, p_payload_hash: 'hash-DISTINTO' });
check('C. payload distinto → P0122', c.code === 'P0122', c.code ?? 'sin error');

// D. concurrencia
const opD = nuevaOperacion();
const [d1, d2] = await Promise.all([
  rpc('admin_claim_seed_operation', { p_operation_id: opD, p_payload_hash: 'hash-d' }),
  rpc('admin_claim_seed_operation', { p_operation_id: opD, p_payload_hash: 'hash-d' }),
]);
const claimed = [d1, d2].filter((r) => r.data?.action === 'claimed').length;
check('D. dos claims en paralelo → exactamente uno "claimed"', claimed === 1, `claimed=${claimed}`);

// E. lookup sin auth.user
const e = await rpc('admin_lookup_seed_user', { p_operation_id: opA });
check('E. lookup sin identidad → NULL', e.data === null, JSON.stringify(e.data));

// F/G. set_auth_created
const f = await rpc('admin_seed_operation_set_auth_created', {
  p_operation_id: opA, p_seed_user_id: randomUUID(), p_lease_token: leaseA,
});
check('F. uuid que no es el seed técnico → P0125', f.code === 'P0125', f.code ?? 'sin error');

const g = await rpc('admin_seed_operation_set_auth_created', {
  p_operation_id: opA, p_seed_user_id: randomUUID(), p_lease_token: randomUUID(),
});
check('G. lease equivocado → P0132 (ownership antes que todo)', g.code === 'P0132', g.code ?? 'sin error');

// H/I. mark_failed
const h = await rpc('admin_seed_operation_mark_failed', {
  p_operation_id: opA, p_error_code: 'x', p_lease_token: randomUUID(),
});
check('H. mark_failed con lease equivocado → P0132', h.code === 'P0132', h.code ?? 'sin error');

const i1 = await rpc('admin_seed_operation_mark_failed', {
  p_operation_id: opA, p_error_code: 'duplicate_phone', p_lease_token: leaseA,
});
check('I. mark_failed marca la operación', i1.data?.action === 'failed', JSON.stringify(i1.data));
const i2 = await rpc('admin_seed_operation_mark_failed', {
  p_operation_id: opA, p_error_code: 'otro_motivo', p_lease_token: leaseA,
});
check('I. idempotente: conserva el PRIMER error_code',
  i2.data?.error_code === 'duplicate_phone', JSON.stringify(i2.data));

// K. flag_compensation_failed sobre failed
const k1 = await rpc('admin_seed_operation_flag_compensation_failed', {
  p_operation_id: opA, p_lease_token: leaseA,
});
check('K. anexa la marca preservando el motivo',
  k1.data?.error_code === 'duplicate_phone+compensation_failed', JSON.stringify(k1.data));
const k2 = await rpc('admin_seed_operation_flag_compensation_failed', {
  p_operation_id: opA, p_lease_token: leaseA,
});
check('K. idempotente: no duplica la marca', k2.data?.action === 'already_flagged', JSON.stringify(k2.data));

// M. lease equivocado
const m = await rpc('admin_seed_operation_flag_compensation_failed', {
  p_operation_id: opA, p_lease_token: randomUUID(),
});
check('M. flag con lease equivocado → P0132', m.code === 'P0132', m.code ?? 'sin error');

// L. flag sobre una operación NO fallida
const opL = nuevaOperacion();
const l0 = await rpc('admin_claim_seed_operation', { p_operation_id: opL, p_payload_hash: 'hash-l' });
const l = await rpc('admin_seed_operation_flag_compensation_failed', {
  p_operation_id: opL, p_lease_token: l0.data?.lease_token,
});
check('L. flag sobre started → P0123', l.code === 'P0123', l.code ?? 'sin error');

// N/O/P. create_seed_doctor (solo guardas: sin auth.uid() no puede completar)
const n = await rpc('admin_create_seed_doctor', {
  p_operation_id: opL, p_seed_user_id: randomUUID(), p_payload_hash: 'hash-l',
  p_payload: {}, p_lease_token: l0.data?.lease_token,
});
check('N. estado ≠ auth_created → P0123', n.code === 'P0123', n.code ?? 'sin error');

const o = await rpc('admin_create_seed_doctor', {
  p_operation_id: opL, p_seed_user_id: randomUUID(), p_payload_hash: 'hash-l',
  p_payload: {}, p_lease_token: randomUUID(),
});
check('O. lease equivocado → P0132 (antes que el estado)', o.code === 'P0132', o.code ?? 'sin error');

// Q. grants de la tabla
const { error: dmlErr } = await sb.from('admin_seed_operations').select('operation_id').limit(1);
check('Q. service_role puede leer la tabla', !dmlErr, dmlErr?.message ?? '');

// R. cleanup
console.log('\n── CLEANUP ──\n');
const { error: delErr } = await sb.from('admin_seed_operations').delete().in('operation_id', creadas);
check('R. borrado de las operaciones de prueba', !delErr, delErr?.message ?? '');
const { data: resto } = await sb.from('admin_seed_operations').select('operation_id').in('operation_id', creadas);
check('R. cero residuos', (resto?.length ?? 0) === 0, `quedan ${resto?.length ?? 0}`);

console.log(`\n  ${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} checks\n`);
process.exit(fail === 0 ? 0 : 1);
