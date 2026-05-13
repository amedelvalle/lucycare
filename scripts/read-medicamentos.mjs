import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const file = 'C:/Users/admic/lucycare/imports/Medicamentos_Depurados_ESV_FINAL.xlsx';
const buf = readFileSync(file);
const wb = XLSX.read(buf, { type: 'buffer' });

console.log('SHEETS:', wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`\n=== Sheet: ${sheetName} ===`);
  console.log('Total rows:', rows.length);
  if (rows.length > 0) {
    console.log('Columns:', Object.keys(rows[0]));
    console.log('\nFirst 8 rows:');
    rows.slice(0, 8).forEach((r, i) => {
      console.log(`Row ${i + 1}:`, JSON.stringify(r));
    });
  }
}
