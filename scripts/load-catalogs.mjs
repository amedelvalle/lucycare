/**
 * Carga programática de catálogos desde los Excel/CSV en /imports.
 *
 * Inserta 127 diagnósticos + 736 medicamentos para CADA doctor existente,
 * con dedupe case-insensitive. Idempotente.
 *
 * Limitación: NO puede correr ALTER TYPE para extender enum (eso es DDL,
 * requiere PAT que no tengo). Si el enum no tiene 'sobre' y 'gel', hace
 * fallback a 'otro' para esos 16 medicamentos y loguea aviso.
 */

import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

// ─── 1. Detectar si el enum tiene 'sobre' y 'gel' ─────────────────────
console.log('═══ Detectando enum medication_presentation ═══');
let enumHasSobreGel = true;
{
  const { error } = await admin
    .from('medications')
    .insert({
      doctor_id: '00000000-0000-0000-0000-000000000000', // doctor_id inválido a propósito
      commercial_name: '__ENUM_TEST__',
      presentation: 'sobre',
    });
  // Si el error es por enum, ya lo sabemos. Si es por FK, el enum sí existe.
  if (error?.message?.includes('invalid input value for enum')) {
    enumHasSobreGel = false;
  }
}
console.log(`  Enum 'sobre' y 'gel': ${enumHasSobreGel ? '✅ disponibles' : '❌ no disponibles → mapeo a "otro"'}`);

// ─── 2. Cargar archivos ───────────────────────────────────────────────
const diagCsv = readFileSync(
  'C:/Users/admic/lucycare/imports/20260303_Catalogo de diagnosticos.csv',
  'utf8'
);
const diagRows = diagCsv
  .replace(/\r/g, '')
  .split('\n')
  .filter((l) => l.length > 0)
  .slice(1) // skip header
  .map((line) => {
    const [id_normalizado, nombre_estandar] = line.split(',').map((s) => s.trim());
    return { id_normalizado, nombre_estandar };
  })
  .filter((r) => r.nombre_estandar);

const wb = XLSX.read(
  readFileSync('C:/Users/admic/lucycare/imports/Medicamentos_Depurados_ESV_FINAL.xlsx'),
  { type: 'buffer' }
);
const medRows = XLSX.utils
  .sheet_to_json(wb.Sheets['Base_Depurada'], { defval: null })
  .filter((r) => r['Nombre Comercial']);

console.log(`\n═══ Datos a cargar ═══`);
console.log(`  Diagnósticos:  ${diagRows.length}`);
console.log(`  Medicamentos:  ${medRows.length}`);

// ─── 3. Obtener doctores ──────────────────────────────────────────────
const { data: doctors, error: dErr } = await admin.from('doctors').select('id');
if (dErr) throw dErr;
console.log(`  Doctores:      ${doctors.length}`);

// ─── 4. Diagnósticos ──────────────────────────────────────────────────
console.log(`\n═══ Cargando diagnósticos ═══`);

const { data: existingDiag } = await admin.from('diagnoses').select('doctor_id, name');
const existingDiagSet = new Set(
  (existingDiag ?? []).map((d) => `${d.doctor_id}:${d.name.toLowerCase()}`)
);

const newDiagnoses = [];
for (const doc of doctors) {
  for (const d of diagRows) {
    const name = d.nombre_estandar;
    const key = `${doc.id}:${name.toLowerCase()}`;
    if (existingDiagSet.has(key)) continue;
    newDiagnoses.push({
      doctor_id: doc.id,
      name,
      description: d.id_normalizado ? `Código: ${d.id_normalizado}` : null,
      is_active: true,
      usage_count: 0,
    });
  }
}

console.log(`  Inserts pendientes: ${newDiagnoses.length} (${doctors.length} doctores × ${diagRows.length} diag)`);

const BATCH = 500;
let diagOk = 0;
for (let i = 0; i < newDiagnoses.length; i += BATCH) {
  const batch = newDiagnoses.slice(i, i + BATCH);
  const { error } = await admin.from('diagnoses').insert(batch);
  if (error) {
    console.error(`  ❌ Batch ${i}-${i + batch.length}:`, error.message);
  } else {
    diagOk += batch.length;
    process.stdout.write(`\r  Insertados ${diagOk}/${newDiagnoses.length}`);
  }
}
console.log(`\n  ✅ ${diagOk} diagnósticos insertados`);

// ─── 5. Medicamentos ──────────────────────────────────────────────────
console.log(`\n═══ Cargando medicamentos ═══`);

const PRESENTATION_MAP = {
  Comprimidos: 'tableta',
  Cápsulas: 'capsula',
  Vial: 'inyectable',
  Sobre: 'sobre',
  Pluma: 'inyectable',
  Ampolla: 'inyectable',
  Aerosol: 'inhalador',
  Jarabe: 'jarabe',
  Gotas: 'gotas',
  Crema: 'crema',
  Inhalador: 'inhalador',
  Gel: 'gel',
  Frasco: 'otro',
};

const mapPresentation = (raw) => {
  if (!raw) return null;
  let mapped = PRESENTATION_MAP[raw] ?? 'otro';
  if (!enumHasSobreGel && (mapped === 'sobre' || mapped === 'gel')) {
    mapped = 'otro';
  }
  return mapped;
};

const { data: existingMed } = await admin
  .from('medications')
  .select('doctor_id, commercial_name, concentration');
const existingMedSet = new Set(
  (existingMed ?? []).map(
    (m) => `${m.doctor_id}:${m.commercial_name.toLowerCase()}|${(m.concentration ?? '').toLowerCase()}`
  )
);

const newMedications = [];
for (const doc of doctors) {
  for (const m of medRows) {
    const commercial_name = String(m['Nombre Comercial']).trim();
    const concentration = m['Concentración'] ? String(m['Concentración']).trim() : null;
    const key = `${doc.id}:${commercial_name.toLowerCase()}|${(concentration ?? '').toLowerCase()}`;
    if (existingMedSet.has(key)) continue;
    newMedications.push({
      doctor_id: doc.id,
      commercial_name,
      active_ingredient: m['Principio activo'] ? String(m['Principio activo']).trim() : null,
      concentration,
      presentation: mapPresentation(m['Presentación'] ? String(m['Presentación']).trim() : null),
      is_active: true,
      usage_count: 0,
    });
  }
}

console.log(`  Inserts pendientes: ${newMedications.length} (${doctors.length} doctores × ${medRows.length} med)`);

let medOk = 0;
for (let i = 0; i < newMedications.length; i += BATCH) {
  const batch = newMedications.slice(i, i + BATCH);
  const { error } = await admin.from('medications').insert(batch);
  if (error) {
    console.error(`\n  ❌ Batch ${i}-${i + batch.length}:`, error.message);
  } else {
    medOk += batch.length;
    process.stdout.write(`\r  Insertados ${medOk}/${newMedications.length}`);
  }
}
console.log(`\n  ✅ ${medOk} medicamentos insertados`);

// ─── 6. Resumen final ─────────────────────────────────────────────────
console.log('\n═══ Resumen ═══');
const [{ count: finalDiag }, { count: finalMed }] = await Promise.all([
  admin.from('diagnoses').select('id', { count: 'exact', head: true }),
  admin.from('medications').select('id', { count: 'exact', head: true }),
]);
console.log(`  Diagnósticos en DB:  ${finalDiag}`);
console.log(`  Medicamentos en DB:  ${finalMed}`);

if (!enumHasSobreGel) {
  console.log('\n⚠️  16 medicamentos cargados con presentación "otro" en lugar de "sobre"/"gel".');
  console.log('   Para fix: corré migrations/s5_02_extend_medication_presentation.sql en Supabase,');
  console.log('   luego este script de nuevo (es idempotente — no duplicará nada).');
}
