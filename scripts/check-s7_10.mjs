/**
 * Verifica s7_10: patients.document_number nullable + backfill de 'PENDIENTE'.
 * Uso: node scripts/check-s7_10.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_10 (patients.document_number nullable) ═══\n');

const pend = await a
  .from('patients')
  .select('id', { count: 'exact', head: true })
  .eq('document_number', 'PENDIENTE');
const nul = await a
  .from('patients')
  .select('id', { count: 'exact', head: true })
  .is('document_number', null);

const backfillOk = !pend.error && pend.count === 0;
console.log(
  `  pacientes con document_number='PENDIENTE': ${pend.count ?? '?'} ${backfillOk ? '✅ (backfill OK)' : '❌ (falta backfill)'}`
);
console.log(`  pacientes con document_number NULL:        ${nul.error ? 'error: ' + nul.error.message : nul.count ?? 0}`);

const ok = backfillOk && !nul.error;
console.log(
  `\n${ok
    ? '✅ s7_10 aplicado.\n   Confirmá con el smoke-test: crear 2 pacientes walk-in distintos en la misma clínica → ambos deben guardarse.'
    : '❌ Falta correr migrations/s7_10_patient_document_nullable.sql en el SQL Editor de Supabase.'}`
);
process.exit(ok ? 0 : 1);
