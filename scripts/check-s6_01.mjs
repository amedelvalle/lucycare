/**
 * Verifica que la migración s6_01 (reputación, Fase A) esté aplicada.
 * Uso: node scripts/check-s6_01.mjs
 */

import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
console.log('═══ Verificando s6_01 (reputación · Fase A) ═══\n');

// 1. Columnas nuevas en reviews
const { error: colErr } = await admin
  .from('reviews')
  .select('rating_treatment, rating_clarity, rating_punctuality, rating_listening, rating_confidence, rating_satisfaction, nps, submitted_at')
  .limit(1);
const colsOk = !colErr || !colErr.message?.includes('column');
console.log(`1. reviews columnas nuevas:     ${colsOk ? '✅ OK' : '❌ faltan'}`);
if (!colsOk) console.log(`   ↳ ${colErr?.message}`);

// 2. Tabla review_tokens
const { error: tokErr } = await admin.from('review_tokens').select('id').limit(1);
const tokOk = !tokErr || !tokErr.message?.includes('Could not find');
console.log(`2. Tabla review_tokens:         ${tokOk ? '✅ existe' : '❌ NO existe'}`);
if (!tokOk) console.log(`   ↳ ${tokErr?.message}`);

// 3. RPC submit_review (debe existir; falla con "Link inválido" → confirma que existe)
const { error: subErr } = await admin.rpc('submit_review', {
  p_token: '__noexiste__',
  p_punctuality: 5, p_treatment: 5, p_clarity: 5,
  p_listening: 5, p_confidence: 5, p_satisfaction: 5,
  p_nps: null, p_comment: null,
});
const subExists = !subErr?.message?.includes('Could not find') && !subErr?.message?.includes('does not exist');
console.log(`3. RPC submit_review:           ${subExists ? '✅ existe' : '❌ NO existe'}`);
if (!subExists) console.log(`   ↳ ${subErr?.message}`);

// 4. RPC get_review_link (falla con "No autenticado" → confirma que existe)
const { error: linkErr } = await admin.rpc('get_review_link', {
  p_appointment_id: '00000000-0000-0000-0000-000000000000',
});
const linkExists = !linkErr?.message?.includes('Could not find') && !linkErr?.message?.includes('does not exist');
console.log(`4. RPC get_review_link:         ${linkExists ? '✅ existe' : '❌ NO existe'}`);
if (!linkExists) console.log(`   ↳ ${linkErr?.message}`);

// 5. Vista doctor_rating_stats
const { error: viewErr } = await admin
  .from('doctor_rating_stats')
  .select('doctor_id, score_adjusted, n_reviews, is_top_rated')
  .limit(1);
const viewOk = !viewErr || !viewErr.message?.includes('Could not find');
console.log(`5. Vista doctor_rating_stats:   ${viewOk ? '✅ existe' : '❌ NO existe'}`);
if (!viewOk) console.log(`   ↳ ${viewErr?.message}`);

const allOk = colsOk && tokOk && subExists && linkExists && viewOk;
console.log(`\n${allOk ? '✅ s6_01 aplicado completamente.' : '❌ Falta correr migrations/s6_01_reviews_reputation.sql en Supabase.'}`);
process.exit(allOk ? 0 : 1);
