/**
 * Desactiva los médicos demo ficticios actuales, dejando SOLO al
 * médico real Pepe Toro / Dr. Camilo Carrillo (phone=50378627694)
 * como demo operativo para pruebas E2E.
 *
 * Defaults seguros aplicados: is_published=false, is_operational=false,
 * lucy_status='listed_only'. NO borra (preserva citas/consultas/reviews).
 * is_verified queda automático en false (GENERATED).
 *
 * Idempotente. Uso:
 *   node scripts/_deactivate-demos.mjs --dry-run
 *   node scripts/_deactivate-demos.mjs --apply
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const KEEP_PHONE = '50378627694'; // Pepe Toro / Dr. Camilo Carrillo

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply') && !args.has('--dry-run');

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await sb
  .from('doctors')
  .select('id, lucy_status, is_published, is_operational, profiles(full_name, phone)');
if (error) { console.error('Error:', error.message); process.exit(1); }

const all = data ?? [];
const toKeep = all.filter((d) => d.profiles?.phone === KEEP_PHONE);
const toDeactivate = all.filter((d) => d.profiles?.phone !== KEEP_PHONE);

console.log(`Modo: ${APPLY ? 'APPLY (escribirá DB)' : 'DRY-RUN (no escribe)'}\n`);
console.log(`Total médicos en DB: ${all.length}`);

// Demo operativo: published=true, operational=true, lucy='verified'
const keepNeedsUpdate = toKeep.filter(
  (d) => d.is_published !== true || d.is_operational !== true || d.lucy_status !== 'verified'
);
console.log(`Demo operativo (Camilo): ${toKeep.length}`);
toKeep.forEach((d) =>
  console.log(`  ✓ ${d.profiles?.full_name} · ${d.profiles?.phone} · actual: published=${d.is_published} operational=${d.is_operational} lucy=${d.lucy_status}`)
);
if (keepNeedsUpdate.length > 0) {
  console.log(`  → será promovido a: published=true, operational=true, lucy='verified' (is_verified derivado → true)`);
}

console.log(`\nA desactivar: ${toDeactivate.length}`);
const willChange = [];
for (const d of toDeactivate) {
  const needs =
    d.is_published === true ||
    d.is_operational === true ||
    d.lucy_status !== 'listed_only';
  console.log(`  ${needs ? '→' : '·'} ${d.profiles?.full_name ?? '(sin nombre)'} · ${d.profiles?.phone ?? '-'} · published=${d.is_published} operational=${d.is_operational} lucy=${d.lucy_status}${needs ? '  ← cambia' : '  (ya en defaults)'}`);
  if (needs) willChange.push(d.id);
}
console.log(`\nCambios efectivos: ${willChange.length}`);

if (!APPLY) {
  console.log('\n[DRY-RUN] No se escribió nada en DB.');
  process.exit(0);
}

// APPLY: update directo con service_role (bypasea RLS y triggers de admin).
// is_verified es GENERATED → no se setea; sale automático de lucy_status.
let updated = 0;
let failed = 0;

// Promover a Camilo (KEEP) al estado demo operativo si falta
for (const d of keepNeedsUpdate) {
  const { error } = await sb.from('doctors').update({
    is_published: true,
    is_operational: true,
    lucy_status: 'verified',
    updated_at: new Date().toISOString(),
  }).eq('id', d.id);
  if (error) { console.error(`  ❌ KEEP ${d.id}: ${error.message}`); failed++; continue; }
  await sb.from('audit_log').insert({
    user_id: null, action: 'update', table_name: 'doctors', record_id: d.id,
    new_data: { promoted_by: 'demo_cleanup_script', state: 'demo_e2e_operational' },
  });
  console.log(`  ✓ KEEP promovido: ${d.profiles?.full_name}`);
  updated++;
}

for (const id of willChange) {
  const { error: upErr } = await sb
    .from('doctors')
    .update({
      is_published: false,
      is_operational: false,
      lucy_status: 'listed_only',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (upErr) { console.error(`  ❌ ${id}: ${upErr.message}`); failed++; continue; }
  await sb.from('audit_log').insert({
    user_id: null,
    action: 'update',
    table_name: 'doctors',
    record_id: id,
    new_data: { deactivated_by: 'demo_cleanup_script', defaults_applied: true },
  });
  updated++;
}
console.log(`\n═══ APPLY FINAL ═══`);
console.log(`Actualizados: ${updated}`);
console.log(`Fallidos: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
