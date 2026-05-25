/**
 * Verifica s7_17: desactivación de médicos seed *.lucycare.test.
 *
 * Casos:
 *   1. Los 12 seed quedaron con profiles.is_active = false.
 *   2. Sus doctors quedaron con booking_enabled = false.
 *   3. doctors siguen con is_published=false y is_operational=false (no se tocaron).
 *   4. Camilo (cuenta demo) NO fue afectado: sigue activo, operational, verified.
 *   5. No quedan profiles con email *.lucycare.test marcados como is_active.
 *
 * Uso: node scripts/check-s7_17.mjs
 */
import { supabaseAdmin as s } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_17 (desactivación seed *.lucycare.test) ═══\n');

let allOk = true;
function pass(msg) { console.log('  ✅', msg); }
function fail(msg) { console.log('  ❌', msg); allOk = false; }
function warn(msg) { console.log('  ⚠️ ', msg); }

const CAMILO_PROFILE = 'db1fba98-a299-4f25-82f1-7feff01e58fa';
const CAMILO_DOCTOR  = '783a902a-55fd-407c-9e0a-69568135c7f5';

// 1. Encontrar todos los seed *.lucycare.test
const { data: seeds, error: e1 } = await s
  .from('profiles')
  .select('id, full_name, email, is_active')
  .like('email', '%@lucycare.test');

if (e1) { fail('SELECT profiles: ' + e1.message); process.exit(1); }
console.log(`  → seed encontrados: ${seeds?.length ?? 0}`);
if (seeds?.length !== 12) {
  warn(`Se esperaban 12 seed, se encontraron ${seeds?.length}`);
}

// 2. Todos los seed deben tener is_active=false
const seedActive = (seeds || []).filter((p) => p.is_active);
if (seedActive.length === 0) {
  pass('todos los seed *.lucycare.test tienen is_active=false');
} else {
  fail(`${seedActive.length} seed siguen con is_active=true:`);
  for (const p of seedActive) console.log(`        - ${p.full_name} (${p.email})`);
}

// 3. doctors de los seed: booking_enabled=false, published=false, operational=false
const seedIds = (seeds || []).map((p) => p.id);
const { data: docs } = await s
  .from('doctors')
  .select('id, profile_id, lucy_status, is_published, is_operational, booking_enabled')
  .in('profile_id', seedIds);

const violations = [];
for (const d of docs || []) {
  if (d.booking_enabled) violations.push(`${d.id}: booking_enabled=true`);
  if (d.is_published) violations.push(`${d.id}: is_published=true`);
  if (d.is_operational) violations.push(`${d.id}: is_operational=true`);
  if (d.lucy_status !== 'listed_only') violations.push(`${d.id}: lucy_status=${d.lucy_status}`);
}
if (violations.length === 0) {
  pass(`${docs?.length ?? 0} doctors seed: booking_enabled=false, is_published=false, is_operational=false, lucy_status=listed_only`);
} else {
  fail(`${violations.length} violaciones en doctors seed:`);
  for (const v of violations) console.log(`        - ${v}`);
}

// 4. Camilo NO afectado
const { data: camProf } = await s.from('profiles').select('is_active, role, email').eq('id', CAMILO_PROFILE).single();
const { data: camDoc }  = await s.from('doctors').select('is_published, is_operational, lucy_status, booking_enabled, is_verified').eq('id', CAMILO_DOCTOR).single();

const camOk = camProf?.is_active === true
  && camProf?.role === 'doctor'
  && !camProf?.email?.endsWith('@lucycare.test')
  && camDoc?.is_published === true
  && camDoc?.is_operational === true
  && camDoc?.lucy_status === 'verified';

if (camOk) {
  pass('Camilo intacto: is_active=true, role=doctor, email real, doctor verified+published+operational');
} else {
  fail('Camilo afectado o estado inesperado:');
  console.log('        profile:', camProf);
  console.log('        doctor:', camDoc);
}

// 5. ¿Algún profile activo todavía con email *.lucycare.test?
const { count: activeSeed } = await s
  .from('profiles')
  .select('id', { count: 'exact', head: true })
  .like('email', '%@lucycare.test')
  .eq('is_active', true);

if (activeSeed === 0) {
  pass('ningún email *.lucycare.test queda como is_active=true');
} else {
  fail(`${activeSeed} email *.lucycare.test siguen como is_active=true`);
}

// 6. audit_log: ¿quedaron las filas del audit manual?
const { count: auditRows } = await s
  .from('audit_log')
  .select('id', { count: 'exact', head: true })
  .eq('table_name', 'profiles')
  .filter('new_data->>reason', 'eq', 'seed_deactivation_s7_17');
console.log(`  → audit_log entries de la migración: ${auditRows}`);

console.log(`\n${allOk ? '✅ s7_17 OK' : '❌ s7_17 con fallas — revisar'}`);
process.exit(allOk ? 0 : 1);
