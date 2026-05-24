/**
 * Verifica s6_08: RPC get_my_review_comments existe.
 * Con service_role no hay auth.uid() → la RPC debe lanzar
 * "No autenticado" (eso confirma que la función existe y corre).
 * Uso: node scripts/check-s6_08.mjs
 */

import { supabaseAdmin as a } from './_lib/supabase-admin.mjs';
console.log('═══ Verificando s6_08 (get_my_review_comments) ═══\n');

const { error } = await a.rpc('get_my_review_comments');

const missing =
  !!error &&
  (/could not find/i.test(error.message) ||
    /does not exist/i.test(error.message) ||
    /function .* does not exist/i.test(error.message));

const exists = !missing;
console.log(`1. RPC get_my_review_comments: ${exists ? '✅ existe' : '❌ NO existe'}`);
if (error) console.log(`   ↳ respuesta: ${error.message}`);
console.log(
  `\n${exists ? '✅ s6_08 aplicado.' : '❌ Falta correr migrations/s6_08_doctor_review_comments.sql.'}`
);
process.exit(exists ? 0 : 1);
