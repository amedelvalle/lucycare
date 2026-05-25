/**
 * Verifica s7_18: lista de espera (waitlist_entries).
 *
 * Casos:
 *  1. Tabla waitlist_entries existe.
 *  2. RPC submit_waitlist_entry invocable como anon (sin sesión).
 *  3. Dedup idempotente: 2 envíos con mismo (doctor, phone normalizado)
 *     → 1 fila final, segundo intento devuelve already_in_list=true.
 *  4. Anon NO puede leer waitlist_entries directo (RLS).
 *  5. RPC admin_list_waitlist_for_doctor rechaza no-admin.
 *  6. Validaciones del RPC: nombre vacío, phone inválido, médico no
 *     publicado → errores tipados.
 *
 * Uso: node scripts/check-s7_18.mjs
 */
import { supabaseAdmin as svc } from './_lib/supabase-admin.mjs';
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_18 (lista de espera) ═══\n');

let allOk = true;
function pass(m) { console.log('  ✅', m); }
function fail(m) { console.log('  ❌', m); allOk = false; }
function warn(m) { console.log('  ⚠️ ', m); }

// 1. Tabla existe (vía service_role debería poder hacer count)
{
  const { error } = await svc.from('waitlist_entries').select('id', { head: true, count: 'exact' });
  if (error) { fail('tabla waitlist_entries NO existe o inaccesible: ' + error.message); process.exit(1); }
  pass('tabla waitlist_entries existe');
}

// Necesitamos un doctor publicado para los tests
const { data: docs } = await svc.from('doctors').select('id').eq('is_published', true).limit(1);
const DOCTOR_ID = docs?.[0]?.id;
if (!DOCTOR_ID) {
  fail('No hay doctores publicados en DB para el smoke');
  process.exit(1);
}
console.log(`  → usando doctor publicado: ${DOCTOR_ID.slice(0, 8)}…\n`);

// Test phone único para este check (timestamp)
const TEST_PHONE = '78' + String(Date.now()).slice(-6); // 8 dígitos
const TEST_PHONE_NORM = '503' + TEST_PHONE;

// 2. RPC submit invocable como anon
{
  const { data, error } = await anon.rpc('submit_waitlist_entry', {
    p_doctor_id: DOCTOR_ID,
    p_patient_name: 'Test Smoke ' + Date.now(),
    p_patient_phone: TEST_PHONE,
    p_patient_message: 'check-s7_18 smoke test',
  });
  if (error) { fail('RPC submit como anon falló: ' + error.message); }
  else if (!data?.success || data?.already_in_list) {
    fail('RPC submit como anon devolvió respuesta inesperada: ' + JSON.stringify(data));
  } else {
    pass('RPC submit_waitlist_entry funciona como anon (alta nueva)');
  }
}

// 3. Dedup idempotente — segundo envío con mismo phone
{
  const { data, error } = await anon.rpc('submit_waitlist_entry', {
    p_doctor_id: DOCTOR_ID,
    p_patient_name: 'Test Smoke duplicate',
    p_patient_phone: TEST_PHONE,
    p_patient_message: null,
  });
  if (error) { fail('Segundo submit falló: ' + error.message); }
  else if (!data?.success || !data?.already_in_list) {
    fail('Segundo submit no detectó duplicado: ' + JSON.stringify(data));
  } else {
    pass('Dedup idempotente: segundo submit devuelve already_in_list=true');
  }
}

// Confirmar que solo hay 1 fila para esa combinación
{
  const { count } = await svc
    .from('waitlist_entries')
    .select('id', { count: 'exact', head: true })
    .eq('doctor_id', DOCTOR_ID)
    .eq('patient_phone_normalized', TEST_PHONE_NORM);
  if (count === 1) pass('Solo 1 fila final tras 2 envíos (UNIQUE constraint ok)');
  else fail(`Esperaba 1 fila, hay ${count}`);
}

// 4. Anon NO puede leer directo
{
  const { data, error } = await anon.from('waitlist_entries').select('id').limit(1);
  if (error) {
    pass('anon NO puede SELECT waitlist_entries (RLS bloquea): ' + error.message.slice(0, 60));
  } else if (data?.length === 0) {
    pass('anon SELECT devuelve 0 filas (RLS silencioso)');
  } else {
    fail('anon PUDO leer waitlist_entries — RLS abierto: ' + data?.length + ' filas');
  }
}

// 5. RPC admin rechaza no-admin (anon)
{
  const { error } = await anon.rpc('admin_list_waitlist_for_doctor', { p_doctor_id: DOCTOR_ID });
  if (error && /no autorizado/i.test(error.message)) {
    pass('admin_list_waitlist_for_doctor rechaza anon');
  } else {
    fail('admin RPC no rechaza anon como debería: ' + (error?.message ?? 'sin error'));
  }
}

// 6. Validaciones del RPC
{
  // Nombre vacío
  const { error: e1 } = await anon.rpc('submit_waitlist_entry', {
    p_doctor_id: DOCTOR_ID,
    p_patient_name: '',
    p_patient_phone: '77001234',
  });
  if (e1 && /nombre/i.test(e1.message)) pass('RPC rechaza nombre vacío (P0101)');
  else fail('RPC NO rechazó nombre vacío como debería: ' + (e1?.message ?? 'sin error'));

  // Phone inválido
  const { error: e2 } = await anon.rpc('submit_waitlist_entry', {
    p_doctor_id: DOCTOR_ID,
    p_patient_name: 'Test',
    p_patient_phone: '123',
  });
  if (e2 && /teléfono|telefono/i.test(e2.message)) pass('RPC rechaza phone inválido (P0102)');
  else fail('RPC NO rechazó phone inválido: ' + (e2?.message ?? 'sin error'));

  // Doctor no publicado (UUID fake)
  const { error: e3 } = await anon.rpc('submit_waitlist_entry', {
    p_doctor_id: '00000000-0000-0000-0000-000000000000',
    p_patient_name: 'Test',
    p_patient_phone: '77123456',
  });
  if (e3 && /médico|disponible/i.test(e3.message)) pass('RPC rechaza médico no publicado (P0104)');
  else fail('RPC NO rechazó médico inexistente: ' + (e3?.message ?? 'sin error'));
}

// Cleanup
await svc.from('waitlist_entries').delete()
  .eq('doctor_id', DOCTOR_ID)
  .eq('patient_phone_normalized', TEST_PHONE_NORM);
console.log('  → cleanup OK');

console.log(`\n${allOk ? '✅ s7_18 OK' : '❌ s7_18 con fallas — revisar'}`);
process.exit(allOk ? 0 : 1);
