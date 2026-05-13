import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const file = 'C:/Users/admic/lucycare/imports/Medicamentos_Depurados_ESV_FINAL.xlsx';
const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Base_Depurada'], { defval: null });

// Valores únicos en Presentación
const presentations = new Map();
for (const r of rows) {
  const p = r['Presentación'];
  presentations.set(p, (presentations.get(p) ?? 0) + 1);
}
console.log('=== Valores únicos en "Presentación" ===');
[...presentations.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));

// Detectar duplicados por (nombre comercial + concentración)
const byKey = new Map();
for (const r of rows) {
  const key = `${(r['Nombre Comercial'] ?? '').trim().toLowerCase()}|${(r['Concentración'] ?? '').trim().toLowerCase()}`;
  byKey.set(key, (byKey.get(key) ?? 0) + 1);
}
const dups = [...byKey.entries()].filter(([, v]) => v > 1);
console.log(`\n=== Duplicados (mismo nombre+concentración): ${dups.length} ===`);
dups.slice(0, 5).forEach(([k, v]) => console.log(`  ${v}x  ${k}`));

// Filas con campos vacíos
const emptyName = rows.filter((r) => !r['Nombre Comercial']).length;
const emptyIngredient = rows.filter((r) => !r['Principio activo']).length;
console.log(`\n=== Campos vacíos ===`);
console.log(`  Sin nombre comercial: ${emptyName}`);
console.log(`  Sin principio activo: ${emptyIngredient}`);
console.log(`  Total filas: ${rows.length}`);
