#!/usr/bin/env node
/**
 * _smoke-s7_72 — RATING-URL-P0 · verificación POST-APLICACIÓN.
 *
 * ⚠️ ALCANCE REAL DE ESTE SMOKE — leer antes de usarlo.
 * El helper `_review_short_code()` queda REVOCADO para `service_role`, que es
 * la credencial con la que corre este script. Por diseño, entonces, ESTE
 * SMOKE NO PUEDE GENERAR CÓDIGOS. Y eso es exactamente lo que verifica: que
 * el helper NO esté expuesto como RPC.
 *
 * Las 10 000 generaciones, la distribución de símbolos y la unicidad viven en
 * `docs/OWNER_S7_72_SMOKE.md`, que corre el owner en el SQL Editor dentro de
 * BEGIN … ROLLBACK. La migración además prueba 100 generaciones en su POST.
 *
 * NO crea ni modifica citas, tokens ni reseñas. No escribe absolutamente nada.
 *
 *   node scripts/_smoke-s7_72.mjs
 */
import { supabaseAdmin } from './_lib/supabase-admin.mjs';

let pass = 0, fail = 0;
function check(nombre, ok, detalle = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  ok ? pass++ : fail++;
}

console.log('\n_smoke-s7_72 — URL corta de calificación (post-aplicación)\n');

// ─── 1. El helper NO debe ser invocable por service_role ────────────
// Distinguir "no existe" de "sin permiso" es esencial: si la migración no se
// aplicó, la RPC tampoco existe y un check ingenuo daría un falso PASS.
{
  const { error } = await supabaseAdmin.rpc('_review_short_code');
  const code = error?.code ?? '(sin error)';
  const msg = error?.message ?? '';

  if (!error) {
    check('helper NO invocable por service_role', false, 'la RPC respondió: el REVOKE no está aplicado');
  } else if (code === 'PGRST202' || /Could not find the function/i.test(msg)) {
    check('helper NO invocable por service_role', false,
      'la función no existe → la migración s7_72 NO está aplicada todavía');
  } else if (code === '42501' || /permission denied/i.test(msg)) {
    check('helper NO invocable por service_role', true, `bloqueado con ${code}`);
  } else {
    check('helper NO invocable por service_role', false, `error inesperado ${code}: ${msg}`);
  }
}

// ─── 2. submit_review sigue rechazando un token inexistente ─────────
// Prueba que la comparación por igualdad exacta sobre `token` sigue viva.
// Con un token inexistente la RPC lanza ANTES de escribir: cero efectos.
{
  const tokenFalso = 'S772SMOKE0000000NOEX';
  const { error } = await supabaseAdmin.rpc('submit_review', {
    p_token: tokenFalso,
    p_punctuality: 5, p_treatment: 5, p_clarity: 5,
    p_listening: 5, p_confidence: 5, p_satisfaction: 5,
    p_nps: null, p_comment: null,
  });
  check('submit_review rechaza un token inexistente',
    !!error && /Link inv[áa]lido/i.test(error.message ?? ''),
    error ? error.message : 'NO lanzó error (inesperado)');
}

// ─── 3. Sin backfill: los tokens preexistentes NO fueron convertidos ─
{
  const { data, error } = await supabaseAdmin
    .from('review_tokens')
    .select('token, expires_at, used_at, created_at, appointment_id, id');

  if (error) {
    check('lectura de review_tokens', false, error.message);
  } else {
    const largos = data.map(r => (r.token ?? '').length);
    const de64 = largos.filter(l => l === 64).length;
    const de20 = largos.filter(l => l === 20).length;
    const otros = largos.filter(l => l !== 64 && l !== 20).length;

    check('review_tokens legible y con las 6 columnas esperadas',
      data.length === 0 || Object.keys(data[0]).length === 6,
      `${data.length} filas`);
    check('sin backfill: no hay tokens con longitudes fuera de {20, 64}',
      otros === 0, `64ch=${de64} · 20ch=${de20} · otros=${otros}`);
    check('los tokens nuevos (si los hay) usan el alfabeto Crockford',
      data.filter(r => (r.token ?? '').length === 20)
          .every(r => /^[0-9A-HJKMNP-TV-Z]{20}$/.test(r.token)),
      `${de20} token(s) de 20 caracteres`);
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_72: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
