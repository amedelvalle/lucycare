/**
 * Verifica s6_07: reviews.rating con precisión decimal.
 * Lee reviews con los 6 criterios y compara rating guardado vs el
 * promedio ponderado esperado (debe coincidir con 2 decimales).
 * Uso: node scripts/check-s6_07.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s6_07 (precisión rating) ═══\n');

const { data: revs } = await a
  .from('reviews')
  .select('id, rating, rating_treatment, rating_clarity, rating_confidence, rating_listening, rating_satisfaction, rating_punctuality')
  .not('rating_treatment', 'is', null)
  .limit(20);

if (!revs || revs.length === 0) {
  console.log('⚠️  No hay reviews con criterios para verificar.');
  process.exit(0);
}

let allOk = true;
let sawDecimal = false;
for (const r of revs) {
  const expected = Math.round(
    (r.rating_treatment * 0.20 +
      r.rating_clarity * 0.20 +
      r.rating_confidence * 0.20 +
      r.rating_listening * 0.15 +
      r.rating_satisfaction * 0.15 +
      r.rating_punctuality * 0.10) * 100
  ) / 100;
  const got = Number(r.rating);
  const ok = Math.abs(got - expected) < 0.005;
  if (!ok) allOk = false;
  if (!Number.isInteger(got)) sawDecimal = true;
  console.log(`  review ${r.id.slice(0, 8)}  guardado=${got}  esperado=${expected}  ${ok ? '✅' : '❌'}`);
}

console.log(`\n1. rating coincide con ponderado: ${allOk ? '✅ OK' : '❌ desajuste'}`);
console.log(`2. guarda decimales (no entero):  ${sawDecimal ? '✅ OK (ej. 4.30)' : '⚠️ todas enteras (¿valores 5.00? revisar manual)'}`);
console.log(`\n${allOk ? '✅ s6_07 aplicado.' : '❌ Falta correr migrations/s6_07_rating_precision.sql.'}`);
process.exit(allOk ? 0 : 1);
