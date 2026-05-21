/**
 * Verifica s7_04: admin_list_doctors con filtros + paginación + total.
 * Uso: node scripts/check-s7_04.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_04 (admin_list_doctors paginable) ═══\n');

// 1. RPC sin args (todos los params default) — gateada por is_admin
const { error: e1 } = await a.rpc('admin_list_doctors');
const gated = !!e1 && /no autorizado|no autenticado/i.test(e1.message);
const exists = !(e1 && /could not find|does not exist/i.test(e1.message));
console.log(`1. admin_list_doctors(): ${exists ? '✅ existe' : '❌ NO existe'}`);
console.log(`   Gateada por is_admin: ${gated ? '✅ OK (rechaza sin auth)' : '⚠️ revisar'}`);

// 2. Con params: paginación funciona (limit=2 sobre data real;
// service_role rechaza igual, pero comprobamos que la firma acepta args)
const { error: e2 } = await a.rpc('admin_list_doctors', {
  p_search: null,
  p_published: null,
  p_operational: null,
  p_lucy_status: null,
  p_limit: 2,
  p_offset: 0,
});
const sigOk = !!e2 && /no autorizado/i.test(e2.message);
console.log(`2. Acepta params (search/filters/paginación): ${sigOk ? '✅ OK' : '⚠️ ' + (e2?.message ?? 'sin error')}`);

const ok = exists && gated && sigOk;
console.log(`\n${ok ? '✅ s7_04 aplicado.' : '❌ Falta correr migrations/s7_04_admin_doctors_search_paginate.sql.'}`);
process.exit(ok ? 0 : 1);
