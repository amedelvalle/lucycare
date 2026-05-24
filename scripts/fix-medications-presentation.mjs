/**
 * Fix de los 16 medicamentos del Excel que originalmente eran "Sobre" o "Gel"
 * pero quedaron como 'otro' porque el enum aún no los tenía.
 *
 * Ahora que s5_02 corrió y el enum los acepta, mapeamos a la presentación
 * correcta. Match por (commercial_name + concentration) — ya garantizado
 * único en el seed.
 */

import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

// Verificar que el enum acepta los nuevos valores
console.log('═══ Verificando enum ═══');
{
  const { error } = await admin
    .from('medications')
    .insert({
      doctor_id: '00000000-0000-0000-0000-000000000000',
      commercial_name: '__ENUM_TEST__',
      presentation: 'sobre',
    });
  if (error?.message?.includes('invalid input value for enum')) {
    console.error('❌ El enum aún no tiene "sobre". Corré el ALTER TYPE primero.');
    process.exit(1);
  }
}
console.log('  ✅ Enum acepta sobre/gel\n');

// Leer Excel
const wb = XLSX.read(
  readFileSync('C:/Users/admic/lucycare/imports/Medicamentos_Depurados_ESV_FINAL.xlsx'),
  { type: 'buffer' }
);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Base_Depurada'], { defval: null });

// Filas del Excel con Sobre o Gel
const TARGET_PRESENTATIONS = { Sobre: 'sobre', Gel: 'gel' };
const targets = rows
  .filter((r) => TARGET_PRESENTATIONS[r['Presentación']])
  .map((r) => ({
    commercial_name: String(r['Nombre Comercial']).trim(),
    concentration: r['Concentración'] ? String(r['Concentración']).trim() : null,
    correct: TARGET_PRESENTATIONS[r['Presentación']],
  }));

console.log(`═══ Targets en Excel ═══`);
console.log(`  Sobre: ${targets.filter((t) => t.correct === 'sobre').length} filas`);
console.log(`  Gel:   ${targets.filter((t) => t.correct === 'gel').length} filas`);
console.log(`  Total: ${targets.length} × N doctores\n`);

// Aplicar fix
console.log(`═══ Actualizando ═══`);
let updated = 0;
let skipped = 0;
for (const t of targets) {
  let q = admin
    .from('medications')
    .update({ presentation: t.correct })
    .ilike('commercial_name', t.commercial_name)
    .eq('presentation', 'otro');
  // El concentration puede ser null
  q = t.concentration === null
    ? q.is('concentration', null)
    : q.ilike('concentration', t.concentration);

  const { error, count } = await q.select('*', { count: 'exact', head: true });
  if (error) {
    console.error(`  ❌ ${t.commercial_name}: ${error.message}`);
    skipped++;
  } else {
    updated += count ?? 0;
  }
}

console.log(`\n  ✅ ${updated} rows actualizadas`);
if (skipped > 0) console.log(`  ⚠️  ${skipped} filas con error`);

// Stats finales
console.log(`\n═══ Distribución final por presentación ═══`);
const presentations = ['tableta', 'capsula', 'inyectable', 'inhalador', 'jarabe', 'gotas', 'crema', 'sobre', 'gel', 'otro'];
for (const p of presentations) {
  const { count } = await admin
    .from('medications')
    .select('id', { count: 'exact', head: true })
    .eq('presentation', p);
  if ((count ?? 0) > 0) {
    console.log(`  ${(count ?? 0).toString().padStart(5)}  ${p}`);
  }
}
