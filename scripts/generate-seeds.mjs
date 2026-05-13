/**
 * Genera los SQL seeds para diagnósticos y medicamentos a partir de los
 * archivos en /imports. Inserta cada item para TODOS los doctores existentes,
 * con dedupe case-insensitive por nombre.
 *
 * Patrón usado:
 *   INSERT INTO catalog (doctor_id, ...) SELECT d.id, ... FROM doctors d
 *   CROSS JOIN (VALUES (...), (...)) AS x(...)
 *   WHERE NOT EXISTS (SELECT 1 FROM catalog WHERE doctor_id=d.id AND LOWER(name)=LOWER(x.name));
 *
 * Uso:
 *   node scripts/generate-seeds.mjs
 *
 * Output:
 *   migrations/s5_03_seed_diagnoses.sql
 *   migrations/s5_04_seed_medications.sql
 */
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Escapa apóstrofes para SQL (estándar Postgres: doble apóstrofe). */
function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  const s = String(value).trim();
  if (s.length === 0) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

/** Formatea una fila de VALUES con comentario opcional. */
function valuesRow(cols) {
  return `  (${cols.join(', ')})`;
}

// ─── 1. Diagnósticos (CSV) ────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    // Parser simple — el CSV no tiene comas dentro de campos
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? null));
    return row;
  });
}

const diagCsv = readFileSync('C:/Users/admic/lucycare/imports/20260303_Catalogo de diagnosticos.csv', 'utf8');
const diagRows = parseCsv(diagCsv);

console.log(`Diagnósticos: ${diagRows.length} filas`);

const diagValues = diagRows
  .filter((r) => r.nombre_estandar && r.nombre_estandar.trim().length > 0)
  .map((r) => {
    const name = r.nombre_estandar.trim();
    // Description: preservar el código normalizado para que el médico lo reconozca
    const description = r.id_normalizado ? `Código: ${r.id_normalizado.trim()}` : null;
    return valuesRow([sqlString(name), sqlString(description)]);
  });

const diagSql = `-- ═══════════════════════════════════════════════════════════
-- Migración S5-03: Seed de diagnósticos para todos los doctores
-- ═══════════════════════════════════════════════════════════
-- Inserta ${diagValues.length} diagnósticos como base inicial del catálogo
-- de cada doctor existente en la tabla \`doctors\`.
--
-- Características:
--   - CROSS JOIN: cada (doctor × diagnóstico) → 1 fila en \`diagnoses\`
--   - Dedupe: si un doctor ya tiene un diagnóstico con el mismo nombre
--     (case-insensitive), no se duplica.
--   - El \`id_normalizado\` original (HTA-01, DM-02, etc.) queda en
--     \`description\` con el prefijo "Código:" para que el médico lo vea.
--   - is_active=true, usage_count=0 por default.
--
-- Idempotente: se puede correr varias veces sin duplicar datos.
-- ═══════════════════════════════════════════════════════════

INSERT INTO diagnoses (doctor_id, name, description, is_active, usage_count)
SELECT d.id, x.name, x.description, true, 0
FROM doctors d
CROSS JOIN (VALUES
${diagValues.join(',\n')}
) AS x(name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM diagnoses
  WHERE doctor_id = d.id AND LOWER(name) = LOWER(x.name)
);

-- Verificación (opcional):
-- SELECT doctor_id, COUNT(*) FROM diagnoses GROUP BY doctor_id;
`;

writeFileSync('C:/Users/admic/lucycare/migrations/s5_03_seed_diagnoses.sql', diagSql);
console.log('✓ migrations/s5_03_seed_diagnoses.sql');

// ─── 2. Medicamentos (XLSX) ───────────────────────────────────────────

const PRESENTATION_MAP = {
  'Comprimidos': 'tableta',
  'Cápsulas': 'capsula',
  'Vial': 'inyectable',
  'Sobre': 'sobre',
  'Pluma': 'inyectable',
  'Ampolla': 'inyectable',
  'Aerosol': 'inhalador',
  'Jarabe': 'jarabe',
  'Gotas': 'gotas',
  'Crema': 'crema',
  'Inhalador': 'inhalador',
  'Gel': 'gel',
  'Frasco': 'otro',
};

const wb = XLSX.read(readFileSync('C:/Users/admic/lucycare/imports/Medicamentos_Depurados_ESV_FINAL.xlsx'), { type: 'buffer' });
const medRows = XLSX.utils.sheet_to_json(wb.Sheets['Base_Depurada'], { defval: null });

console.log(`Medicamentos: ${medRows.length} filas`);

// Stats de mapeo de presentaciones
const presentationCounts = new Map();
const medValues = medRows
  .filter((r) => r['Nombre Comercial'] && String(r['Nombre Comercial']).trim().length > 0)
  .map((r) => {
    const commercialName = String(r['Nombre Comercial']).trim();
    const activeIngredient = r['Principio activo'] ? String(r['Principio activo']).trim() : null;
    const concentration = r['Concentración'] ? String(r['Concentración']).trim() : null;
    const presentationRaw = r['Presentación'] ? String(r['Presentación']).trim() : null;
    const presentation = presentationRaw ? PRESENTATION_MAP[presentationRaw] ?? 'otro' : null;

    presentationCounts.set(presentation, (presentationCounts.get(presentation) ?? 0) + 1);

    return valuesRow([
      sqlString(commercialName),
      sqlString(activeIngredient),
      sqlString(concentration),
      presentation ? `'${presentation}'::medication_presentation` : 'NULL',
    ]);
  });

console.log('Mapeo presentaciones aplicado:');
[...presentationCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`  ${v.toString().padStart(4)}  → ${k ?? 'NULL'}`);
});

const medSql = `-- ═══════════════════════════════════════════════════════════
-- Migración S5-04: Seed de medicamentos para todos los doctores
-- ═══════════════════════════════════════════════════════════
-- Inserta ${medValues.length} medicamentos como base inicial del catálogo
-- de cada doctor existente en la tabla \`doctors\`.
--
-- Características:
--   - Dedupe case-insensitive por (doctor_id, commercial_name + concentration)
--     para no duplicar el mismo medicamento en distintas concentraciones.
--   - is_active=true, usage_count=0 por default.
--   - Mapeo de presentación documentado en s5_02_extend_medication_presentation.sql
--
-- IMPORTANTE: ejecutar PRIMERO s5_02_extend_medication_presentation.sql
-- para que el enum tenga 'sobre' y 'gel'.
--
-- Idempotente: se puede correr varias veces sin duplicar datos.
-- ═══════════════════════════════════════════════════════════

INSERT INTO medications (doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count)
SELECT d.id, x.commercial_name, x.active_ingredient, x.concentration, x.presentation, true, 0
FROM doctors d
CROSS JOIN (VALUES
${medValues.join(',\n')}
) AS x(commercial_name, active_ingredient, concentration, presentation)
WHERE NOT EXISTS (
  SELECT 1 FROM medications
  WHERE doctor_id = d.id
    AND LOWER(commercial_name) = LOWER(x.commercial_name)
    AND COALESCE(LOWER(concentration), '') = COALESCE(LOWER(x.concentration), '')
);

-- Verificación (opcional):
-- SELECT doctor_id, COUNT(*) FROM medications GROUP BY doctor_id;
-- SELECT presentation, COUNT(*) FROM medications GROUP BY presentation ORDER BY 2 DESC;
`;

writeFileSync('C:/Users/admic/lucycare/migrations/s5_04_seed_medications.sql', medSql);
console.log('✓ migrations/s5_04_seed_medications.sql');

console.log('\nResumen:');
console.log(`  Diagnósticos:  ${diagValues.length} items × N doctores`);
console.log(`  Medicamentos:  ${medValues.length} items × N doctores`);
