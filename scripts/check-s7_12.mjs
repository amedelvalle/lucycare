/**
 * Verifica s7_12: las 5 RPCs admin de servicios existen y están
 * gateadas por is_admin() (rechazan llamadas no-admin con
 * "No autorizado").
 *
 * El comportamiento end-to-end (crear/editar/desactivar/eliminar
 * realmente como admin logueado) se confirma con el smoke-test
 * manual desde /admin/medicos/:id.
 *
 * Uso: node scripts/check-s7_12.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_12 (admin de servicios) ═══\n');

const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

const rpcs = [
  ['admin_list_doctor_services', { p_doctor_id: FAKE_UUID }],
  [
    'admin_create_service',
    {
      p_doctor_id: FAKE_UUID,
      p_name: 'x',
      p_duration_minutes: 30,
      p_price: null,
      p_is_first_visit: false,
    },
  ],
  [
    'admin_update_service',
    {
      p_service_id: FAKE_UUID,
      p_name: 'x',
      p_duration_minutes: 30,
      p_price: null,
      p_is_first_visit: false,
    },
  ],
  ['admin_set_service_active', { p_service_id: FAKE_UUID, p_is_active: true }],
  ['admin_delete_service', { p_service_id: FAKE_UUID }],
];

let allOk = true;
for (const [name, params] of rpcs) {
  const { error } = await a.rpc(name, params);
  const missing = !!error && (/could not find/i.test(error.message) || /does not exist/i.test(error.message));
  const gated = !!error && /no autorizado/i.test(error.message);
  console.log(
    `  ${name.padEnd(28)} ${missing ? '❌ NO existe' : gated ? '✅ existe y gateada' : '⚠️  existe sin gate (' + (error?.message ?? 'sin error') + ')'}`
  );
  if (missing || !gated) allOk = false;
}

console.log(
  `\n${allOk
    ? '✅ s7_12 aplicado. Las 5 RPCs admin existen y rechazan a no-admin.\n   Confirmá el flujo end-to-end con el smoke-test en /admin/medicos/:id.'
    : '❌ Falta correr migrations/s7_12_admin_services.sql en el SQL Editor de Supabase.'}`
);
process.exit(allOk ? 0 : 1);
