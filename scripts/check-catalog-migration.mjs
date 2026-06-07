/**
 * Verificación post-apply de la migración de catálogo base (Catálogos PR-5b).
 * Read-only. Correr DESPUÉS de `node scripts/migrate-catalog-base.mjs --apply`.
 *
 *   node scripts/check-catalog-migration.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

const pass = (m) => console.log('  ✅', m);
const info = (m) => console.log('  •', m);

async function count(table, build) {
  const q = build(admin.from(table).select('id', { count: 'exact', head: true }));
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

console.log('═══ Verificación post-migración de catálogo ═══\n');

const dxGlobal = await count('diagnoses', (q) => q.is('doctor_id', null).eq('is_active', true));
const medGlobal = await count('medications', (q) => q.is('doctor_id', null).eq('is_active', true));
info(`Base Lucy activos — diagnósticos: ${dxGlobal} (esperado ~127) · medicamentos: ${medGlobal} (esperado ~736)`);

const dxOwnActive = await count('diagnoses', (q) => q.not('doctor_id', 'is', null).eq('is_active', true));
const medOwnActive = await count('medications', (q) => q.not('doctor_id', 'is', null).eq('is_active', true));
info(`Propios ACTIVOS (Míos) — diagnósticos: ${dxOwnActive} · medicamentos: ${medOwnActive} (debería ser solo personalizaciones reales)`);

const dxOwnInactive = await count('diagnoses', (q) => q.not('doctor_id', 'is', null).eq('is_active', false));
const medOwnInactive = await count('medications', (q) => q.not('doctor_id', 'is', null).eq('is_active', false));
info(`Copias replicadas inactivadas — diagnósticos: ${dxOwnInactive} · medicamentos: ${medOwnInactive}`);

const { count: mapN } = await admin.from('catalog_migration_map').select('id', { count: 'exact', head: true });
info(`catalog_migration_map filas: ${mapN ?? 0}`);

const { data: testDx } = await admin.from('diagnoses').select('id, name, is_active').is('doctor_id', null).ilike('name', '%(base lucy)%');
const { data: testMed } = await admin.from('medications').select('id, commercial_name, is_active').is('doctor_id', null).ilike('commercial_name', '%(base lucy)%');
info(`Globales de prueba "(base Lucy)" restantes activos: dx=${(testDx ?? []).filter((d) => d.is_active).length} med=${(testMed ?? []).filter((m) => m.is_active).length} (esperado 0 si no estaban usados)`);

pass('Verificación impresa. Revisá que los conteos cuadren con el dry-run.');
console.log('\n  Recordá: históricos (recetas/consultas) se ven por snapshot s7_37 — no dependen del catálogo vivo.');
