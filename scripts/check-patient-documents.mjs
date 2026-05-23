/**
 * Diagnóstico (read-only) de documentos de pacientes.
 *
 * Reporta:
 *   1. Documentos inválidos según su tipo (ej: DUI que no tiene 9 dígitos).
 *   2. DUIs válidos pero NO canónicos (ej: '025265384' sin guion) — el
 *      próximo edit los normalizará al formato '00000000-0'.
 *
 * NO modifica ningún paciente. La limpieza se hace abriendo y guardando
 * cada perfil desde la UI, o con un script aparte si son muchos.
 *
 * Uso: node scripts/check-patient-documents.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

// Réplica de src/lib/document.ts → validateDocument (idéntica lógica).
function validateDocument(type, rawNumber) {
  const num = (rawNumber ?? '').trim();
  if (!num) return { valid: true, canonical: null };
  if (type === 'dui') {
    const digits = num.replace(/[^0-9]/g, '');
    if (digits.length !== 9) {
      return { valid: false, error: 'DUI debe tener 9 dígitos', canonical: null };
    }
    return { valid: true, canonical: digits.slice(0, 8) + '-' + digits[8] };
  }
  const generic = num.replace(/\s+/g, ' ').slice(0, 40);
  if (!generic) return { valid: true, canonical: null };
  if (generic.length > 40) {
    return { valid: false, error: 'Demasiado largo (máx 40)', canonical: null };
  }
  return { valid: true, canonical: generic };
}

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Diagnóstico de documentos de pacientes ═══\n');

const { data: patients, error } = await a
  .from('patients')
  .select('id, clinic_id, full_name, document_type, document_number, is_active')
  .eq('is_active', true)
  .not('document_number', 'is', null);

if (error) {
  console.log('❌ Error consultando:', error.message);
  process.exit(1);
}

console.log(`Pacientes activos con documento: ${patients.length}\n`);

const invalid = [];
const nonCanonicalDui = [];

for (const p of patients) {
  const v = validateDocument(p.document_type, p.document_number);
  if (!v.valid) {
    invalid.push({ ...p, error: v.error });
  } else if (p.document_type === 'dui' && p.document_number !== v.canonical) {
    nonCanonicalDui.push({ ...p, canonical: v.canonical });
  }
}

if (invalid.length === 0 && nonCanonicalDui.length === 0) {
  console.log('✅ Todos los documentos son válidos y canónicos.');
  process.exit(0);
}

if (invalid.length > 0) {
  console.log(`⚠️  ${invalid.length} paciente(s) con documento INVÁLIDO (limpieza manual):\n`);
  for (const p of invalid) {
    console.log(`   [${p.document_type}] "${p.document_number}"  → ${p.error}`);
    console.log(`     ${p.id}  ${p.full_name}\n`);
  }
}

if (nonCanonicalDui.length > 0) {
  console.log(`ℹ️  ${nonCanonicalDui.length} paciente(s) con DUI válido pero NO canónico (se normaliza al próximo edit):\n`);
  for (const p of nonCanonicalDui) {
    console.log(`   "${p.document_number}"  → canónico: "${p.canonical}"`);
    console.log(`     ${p.id}  ${p.full_name}\n`);
  }
}

console.log('Los inválidos requieren intervención manual (abrir el perfil y corregir).');
console.log('Los no-canónicos se arreglan solos al guardar cualquier cambio del paciente.');

process.exit(0);
