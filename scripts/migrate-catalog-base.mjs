/**
 * Migración de catálogo base replicado → global (Catálogos PR-5).
 *
 *   node scripts/migrate-catalog-base.mjs            # DRY-RUN (default, no escribe)
 *   node scripts/migrate-catalog-base.mjs --dry-run  # idem
 *   node scripts/migrate-catalog-base.mjs --apply     # APLICA cambios
 *
 * Estrategia (decisiones del owner):
 *  - Fuente de verdad = seed s5_03 (diagnósticos) / s5_04 (medicamentos).
 *  - Crea 1 GLOBAL canónico (doctor_id NULL) por ítem del seed (idempotente:
 *    salta si ya existe un global con esa clave normalizada).
 *  - INACTIVA (is_active=false, NUNCA hard-delete) las copias per-médico que
 *    igualan EXACTO a un ítem del seed. Las que difieren en algún campo se
 *    conservan como propias (posible personalización).
 *  - NO reapunta FK: el snapshot de s7_37 ya congeló el texto histórico; la
 *    copia inactivada sigue existiendo → FK válido.
 *  - Escribe catalog_migration_map (old_id → global_id) para reversibilidad.
 *  - Globales de prueba "(base Lucy)"/"prueba"/"smoke": si NO están usados, se
 *    inactivan; si están usados, se reportan y NO se tocan.
 *  - Auditoría: el trigger audit_catalog (s7_38) registra cada inactivación.
 *
 * Requiere s7_39 aplicada para --apply (catalog_migration_map + UNIQUE parcial).
 * El --dry-run NO necesita s7_39 (solo lee).
 */
import { readFileSync } from 'node:fs';
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

const APPLY = process.argv.includes('--apply');
const norm = (s) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const TEST_RX = /\(base lucy\)|prueba|smoke/i;

async function fetchAll(table, cols) {
  let rows = [], from = 0; const size = 1000;
  for (;;) {
    const { data, error } = await admin.from(table).select(cols).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows = rows.concat(data || []);
    if (!data || data.length < size) break;
    from += size;
  }
  return rows;
}

// ─── Parseo del seed (fuente de verdad) ───────────────────────────────
function parseSeedDiagnoses() {
  const txt = readFileSync(new URL('../migrations/s5_03_seed_diagnoses.sql', import.meta.url), 'utf8');
  const rx = /^\s*\('((?:[^']|'')*)',\s*(?:'((?:[^']|'')*)'|NULL)\)/;
  const out = [];
  for (const line of txt.split('\n')) {
    const m = line.match(rx);
    if (m) out.push({ name: m[1].replace(/''/g, "'"), description: m[2] === undefined ? null : m[2].replace(/''/g, "'") });
  }
  return out;
}
function parseSeedMedications() {
  const txt = readFileSync(new URL('../migrations/s5_04_seed_medications.sql', import.meta.url), 'utf8');
  const rx = /^\s*\('((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)'(?:::medication_presentation)?\)/;
  const out = [];
  for (const line of txt.split('\n')) {
    const m = line.match(rx);
    if (m) out.push({
      commercial_name: m[1].replace(/''/g, "'"),
      active_ingredient: m[2].replace(/''/g, "'"),
      concentration: m[3].replace(/''/g, "'"),
      presentation: m[4].replace(/''/g, "'"),
    });
  }
  return out;
}

const dxTuple = (name, description) => `${name}${description ?? ''}`;
const medTuple = (m) => [m.commercial_name, m.active_ingredient ?? '', m.concentration ?? '', m.presentation ?? ''].join('');

console.log(`═══ Migración catálogo base → global  [${APPLY ? 'APPLY' : 'DRY-RUN'}] ═══\n`);

// ─── Cargar seed + DB ─────────────────────────────────────────────────
const seedDx = parseSeedDiagnoses();
const seedMed = parseSeedMedications();
console.log(`Seed parseado: ${seedDx.length} diagnósticos · ${seedMed.length} medicamentos`);

const dbDx = await fetchAll('diagnoses', 'id, name, description, doctor_id, is_active');
const dbMed = await fetchAll('medications', 'id, commercial_name, active_ingredient, concentration, presentation, doctor_id, is_active');
const dxUsed = new Set((await fetchAll('consultation_diagnoses', 'diagnosis_id')).map((r) => r.diagnosis_id));
const medUsed = new Set((await fetchAll('prescriptions', 'medication_id')).map((r) => r.medication_id));

// ─── Planificación genérica ───────────────────────────────────────────
function planDiagnoses() {
  const seedTuples = new Set(seedDx.map((s) => dxTuple(s.name, s.description)));
  const seedNames = new Set(seedDx.map((s) => norm(s.name)));
  const existingGlobalByName = new Map(); // norm(name) -> row
  for (const d of dbDx) if (d.doctor_id === null) existingGlobalByName.set(norm(d.name), d);

  const globalsToCreate = seedDx.filter((s) => !existingGlobalByName.has(norm(s.name)));
  const inactivate = dbDx.filter((d) => d.doctor_id && d.is_active && seedTuples.has(dxTuple(d.name, d.description)));
  const personalSameName = dbDx.filter((d) => d.doctor_id && d.is_active && !seedTuples.has(dxTuple(d.name, d.description)) && seedNames.has(norm(d.name)));
  const personalNew = dbDx.filter((d) => d.doctor_id && d.is_active && !seedNames.has(norm(d.name)));
  const usedInactivate = inactivate.filter((d) => dxUsed.has(d.id));
  const testGlobals = dbDx.filter((d) => d.doctor_id === null && TEST_RX.test(d.name));
  return { globalsToCreate, inactivate, personalSameName, personalNew, usedInactivate, testGlobals, existingGlobalByName };
}
function planMedications() {
  const seedTuples = new Set(seedMed.map(medTuple));
  const comboKey = (m) => [norm(m.commercial_name), norm(m.active_ingredient), norm(m.concentration), norm(m.presentation)].join('|');
  const seedCombos = new Set(seedMed.map(comboKey));
  const existingGlobalByCombo = new Map();
  for (const m of dbMed) if (m.doctor_id === null) existingGlobalByCombo.set(comboKey(m), m);

  const globalsToCreate = seedMed.filter((s) => !existingGlobalByCombo.has(comboKey(s)));
  const inactivate = dbMed.filter((m) => m.doctor_id && m.is_active && seedTuples.has(medTuple(m)));
  const personalSameCombo = dbMed.filter((m) => m.doctor_id && m.is_active && !seedTuples.has(medTuple(m)) && seedCombos.has(comboKey(m)));
  const personalNew = dbMed.filter((m) => m.doctor_id && m.is_active && !seedCombos.has(comboKey(m)));
  const usedInactivate = inactivate.filter((m) => medUsed.has(m.id));
  const testGlobals = dbMed.filter((m) => m.doctor_id === null && TEST_RX.test(m.commercial_name));
  return { globalsToCreate, inactivate, personalSameCombo, personalNew, usedInactivate, testGlobals, existingGlobalByCombo, comboKey };
}

const pdx = planDiagnoses();
const pmed = planMedications();

// ─── Reporte ──────────────────────────────────────────────────────────
function reportDx() {
  console.log('\n═══ DIAGNÓSTICOS ═══');
  console.log('  globales a crear:', pdx.globalsToCreate.length, `(ya existen ${pdx.existingGlobalByName.size} globales)`);
  console.log('  copias replicadas a INACTIVAR (match exacto seed):', pdx.inactivate.length);
  console.log('     de ellas, usadas en consultation_diagnoses:', pdx.usedInactivate.length, '(se inactivan; FK queda válido, texto por snapshot)');
  console.log('  conservadas como PROPIAS — mismo nombre, distinta descripción:', pdx.personalSameName.length);
  console.log('  conservadas como PROPIAS — nombre nuevo (no seed):', pdx.personalNew.length);
  if (pdx.personalNew.length) pdx.personalNew.slice(0, 20).forEach((d) => console.log('       ·', d.name, `(dr ${d.doctor_id.slice(0, 8)})`));
  if (pdx.personalSameName.length) { console.log('     [revisar] mismo nombre/distinta desc:'); pdx.personalSameName.slice(0, 20).forEach((d) => console.log('       ·', d.name, '→', JSON.stringify(d.description))); }
  console.log('  globales de PRUEBA detectados:', pdx.testGlobals.length);
  pdx.testGlobals.forEach((d) => console.log('       ·', d.name, dxUsed.has(d.id) ? '→ USADO (no tocar)' : '→ sin uso (se inactivará)'));
}
function reportMed() {
  console.log('\n═══ MEDICAMENTOS ═══');
  console.log('  globales a crear:', pmed.globalsToCreate.length, `(ya existen ${pmed.existingGlobalByCombo.size} globales)`);
  console.log('  copias replicadas a INACTIVAR (match exacto seed):', pmed.inactivate.length);
  console.log('     de ellas, usadas en prescriptions:', pmed.usedInactivate.length, '(se inactivan; FK queda válido, texto por snapshot)');
  console.log('  conservadas como PROPIAS — mismo combo base con algún campo distinto:', pmed.personalSameCombo.length);
  console.log('  conservadas como PROPIAS — combo nuevo (no seed):', pmed.personalNew.length);
  if (pmed.personalNew.length) pmed.personalNew.slice(0, 20).forEach((m) => console.log('       ·', m.commercial_name, m.concentration ?? '', `(dr ${m.doctor_id.slice(0, 8)})`));
  console.log('  globales de PRUEBA detectados:', pmed.testGlobals.length);
  pmed.testGlobals.forEach((m) => console.log('       ·', m.commercial_name, medUsed.has(m.id) ? '→ USADO (no tocar)' : '→ sin uso (se inactivará)'));
}
reportDx();
reportMed();

if (!APPLY) {
  console.log('\n— DRY-RUN: no se escribió nada. Revisá los conteos y autorizá --apply. —');
  process.exit(0);
}

// ─── APPLY ────────────────────────────────────────────────────────────
console.log('\n— APPLY: aplicando cambios… —');
async function chunk(arr, n) { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }

// 1. Crear globales canónicos faltantes (diagnósticos)
const dxGlobalByName = new Map(pdx.existingGlobalByName);
for (const s of pdx.globalsToCreate) {
  const { data, error } = await admin.from('diagnoses')
    .insert({ name: s.name, description: s.description, is_active: true, usage_count: 0 })
    .select('id, name').single();
  if (error) { console.log('  ⚠ global dx ya existía o error:', s.name, error.code); continue; }
  dxGlobalByName.set(norm(data.name), data);
}
// medications
const medGlobalByCombo = new Map(pmed.existingGlobalByCombo);
for (const s of pmed.globalsToCreate) {
  const { data, error } = await admin.from('medications')
    .insert({ commercial_name: s.commercial_name, active_ingredient: s.active_ingredient, concentration: s.concentration, presentation: s.presentation, is_active: true, usage_count: 0 })
    .select('id, commercial_name, active_ingredient, concentration, presentation').single();
  if (error) { console.log('  ⚠ global med ya existía o error:', s.commercial_name, error.code); continue; }
  medGlobalByCombo.set(pmed.comboKey(data), data);
}
console.log('  globales creados (dx/med):', dxGlobalByName.size - pdx.existingGlobalByName.size, '/', medGlobalByCombo.size - pmed.existingGlobalByCombo.size);

// 2. Inactivar copias + mapear (diagnósticos)
let dxMapped = 0;
for (const batch of await chunk(pdx.inactivate, 200)) {
  await admin.from('diagnoses').update({ is_active: false }).in('id', batch.map((d) => d.id));
  const rows = batch.map((d) => ({ item_type: 'diagnosis', old_id: d.id, old_doctor_id: d.doctor_id, global_id: dxGlobalByName.get(norm(d.name))?.id })).filter((r) => r.global_id);
  if (rows.length) { await admin.from('catalog_migration_map').upsert(rows, { onConflict: 'item_type,old_id', ignoreDuplicates: true }); dxMapped += rows.length; }
}
// medications
let medMapped = 0;
for (const batch of await chunk(pmed.inactivate, 200)) {
  await admin.from('medications').update({ is_active: false }).in('id', batch.map((m) => m.id));
  const rows = batch.map((m) => ({ item_type: 'medication', old_id: m.id, old_doctor_id: m.doctor_id, global_id: medGlobalByCombo.get(pmed.comboKey(m))?.id })).filter((r) => r.global_id);
  if (rows.length) { await admin.from('catalog_migration_map').upsert(rows, { onConflict: 'item_type,old_id', ignoreDuplicates: true }); medMapped += rows.length; }
}
console.log('  copias inactivadas + mapeadas (dx/med):', dxMapped, '/', medMapped);

// 3. Cleanup de globales de prueba NO usados (inactivar, sin hard-delete)
for (const d of pdx.testGlobals) if (!dxUsed.has(d.id)) await admin.from('diagnoses').update({ is_active: false }).eq('id', d.id);
for (const m of pmed.testGlobals) if (!medUsed.has(m.id)) await admin.from('medications').update({ is_active: false }).eq('id', m.id);
console.log('  globales de prueba inactivados (sin uso).');

console.log('\n✅ APPLY completo. Correr verificación: node scripts/check-catalog-migration.mjs');
process.exit(0);
