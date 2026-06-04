/**
 * Verifica PR-1 (filtro is_current en lecturas/impresión de recetas).
 *
 * No toca nada. Confirma contra la DB que el filtro is_current=true es
 * EQUIVALENTE al comportamiento actual para los datos existentes: hoy, sin
 * ninguna corrección emitida (amend_consultation), todas las recetas son
 * version=1 / is_current=true, así que filtrar no cambia ningún caso normal.
 *
 * Qué chequea (con service_role — RLS bloquea a anon en prescriptions):
 *  - la columna is_current existe y es consultable.
 *  - count(is_current=false) == 0  → no hay recetas históricas todavía.
 *  - count(total) == count(is_current=true)  → equivalencia de lecturas.
 *
 * Cuando exista una corrección de receta, is_current=false dejará de ser 0
 * (esperado); este check documenta el estado base pre-corrección.
 *
 * Uso: node scripts/check-pr1-rx-current.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando PR-1 (is_current en lecturas de recetas) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// Helper: count con head:true
async function count(filter) {
  let q = admin.from('prescriptions').select('id', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: n, error } = await q;
  return { n: n ?? 0, error };
}

// 1. La columna is_current existe / es consultable
{
  const { error } = await admin.from('prescriptions').select('id, is_current, version, replaces_id').limit(1);
  if (error) fail('No se pudo consultar is_current/version/replaces_id — ¿s7_29 aplicada?: ' + error.message);
  else pass('Columnas is_current / version / replaces_id consultables');
}

// 2 + 3. Equivalencia de conteos
{
  const total = await count(null);
  const current = await count((q) => q.eq('is_current', true));
  const historic = await count((q) => q.eq('is_current', false));

  if (total.error || current.error || historic.error) {
    fail('Error contando prescriptions: ' + (total.error || current.error || historic.error)?.message);
  } else {
    console.log(`     total=${total.n} · vigentes(is_current=true)=${current.n} · históricas(false)=${historic.n}`);
    if (historic.n === 0) pass('No hay recetas históricas todavía (is_current=false == 0)');
    else console.log(`  ⚠️  Hay ${historic.n} recetas históricas (esperado solo si ya se corrigió alguna receta)`);

    if (total.n === current.n + historic.n) pass('total == vigentes + históricas (conteo consistente)');
    else fail(`Conteo inconsistente: ${total.n} != ${current.n} + ${historic.n}`);

    if (historic.n === 0 && total.n === current.n)
      pass('Filtrar is_current=true es EQUIVALENTE al comportamiento actual (sin correcciones aún)');
  }
}

console.log('\n  ⏭️  Smoke empírico (post-corrección, sesión médico real, futuro B2):');
console.log('     - tras amend_consultation con receta corregida: la v1 queda is_current=false');
console.log('       y display/impresión muestran SOLO la v2 (no duplican v1+v2).\n');

console.log(`${allOk ? '✅ PR-1 sanity OK' : '❌ PR-1 con fallas'}`);
process.exit(allOk ? 0 : 1);
