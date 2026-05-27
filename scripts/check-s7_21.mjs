/**
 * Verifica s7_21: doctor_affiliation_requests (Afiliación Fase 1).
 *
 * Casos:
 *  1. Tabla doctor_affiliation_requests existe.
 *  2. RPC submit_affiliation_request invocable como anon (sin sesión).
 *  3. Lead mínimo (name + phone + consent) se crea con incomplete=true.
 *  4. Lead completo (todos los campos) se crea con incomplete=false.
 *  5. Validaciones: nombre vacío, phone vacío, phone inválido, consent
 *     vacío → errores tipados.
 *  6. UNIQUE por phone normalizado: segundo submit con mismo phone
 *     responde success genérico pero NO crea duplicado.
 *  7. Anon NO puede leer la tabla directo (RLS bloquea).
 *  8. RPCs admin rechazan no-admin.
 *  9. audit_log registra el INSERT.
 *
 * Uso: node scripts/check-s7_21.mjs
 *
 * Nota sobre rate limit: la RPC limita a 1 solicitud por IP/24h. El
 * check script corre múltiples submits desde la misma IP en segundos,
 * lo cual dispararía el límite. Para eludirlo legítimamente, después
 * de cada submit exitoso el check setea `ip_address=NULL` via
 * service_role en la fila recién creada, sacándola del conteo de
 * rate limit (el WHERE chequea `ip_address = v_ip`). La RPC sigue
 * intacta; el rate limit funciona en producción real.
 *
 * Cleanup: borra al final las filas creadas durante el smoke
 *          (filtradas por full_name LIKE '[check-s7_21]%').
 */
import { supabaseAdmin as svc } from './_lib/supabase-admin.mjs';
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_21 (doctor_affiliation_requests) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const CONSENT_VERSION = 'check-s7_21-v1';
const TEST_NAME_PREFIX = '[check-s7_21]';

// Phones únicos por ejecución (timestamp) para no chocar con UNIQUE
const baseTs = String(Date.now()).slice(-6);
const PHONE_INCOMPLETE = '5037' + baseTs;        // lead mínimo
const PHONE_COMPLETE   = '5037' + (parseInt(baseTs) + 1).toString().slice(-6);

// Helper: limpiar el ip_address de filas previas para eludir el rate
// limit (1 solicitud/IP/24h). El rate limit cuenta filas con ip = v_ip
// en últimas 24h; poniéndolo a NULL las saca del conteo sin borrarlas
// (preserva el test de UNIQUE por phone).
async function clearIpFromCheckRows() {
  await svc
    .from('doctor_affiliation_requests')
    .update({ ip_address: null })
    .like('full_name', `${TEST_NAME_PREFIX}%`);
}

// 1. Tabla existe (vía service_role)
{
  const { error } = await svc.from('doctor_affiliation_requests').select('id', { head: true, count: 'exact' });
  if (error) { fail('tabla doctor_affiliation_requests NO existe o inaccesible: ' + error.message); process.exit(1); }
  pass('tabla doctor_affiliation_requests existe');
}

// 2 + 3. Lead mínimo (incomplete=true)
let minLeadId = null;
{
  const { data, error } = await anon.rpc('submit_affiliation_request', {
    p_full_name: `${TEST_NAME_PREFIX} Lead minimo`,
    p_phone: PHONE_INCOMPLETE,
    p_consent_version: CONSENT_VERSION,
  });
  if (error) { fail('RPC submit (mínimo) falló: ' + error.message); }
  else if (!data?.success) { fail('RPC submit (mínimo) sin success: ' + JSON.stringify(data)); }
  else {
    pass('RPC submit_affiliation_request acepta lead mínimo (name + phone + consent)');
    const { data: row } = await svc
      .from('doctor_affiliation_requests')
      .select('id, incomplete, status, full_name, phone_normalized, email, license_number')
      .eq('phone_normalized', PHONE_INCOMPLETE)
      .maybeSingle();
    if (!row) { fail('lead mínimo no se persistió'); }
    else {
      minLeadId = row.id;
      if (row.incomplete === true) pass('lead mínimo tiene incomplete=true (sin email/license/specialty)');
      else fail(`lead mínimo NO marcó incomplete=true; valor=${row.incomplete}`);
      if (row.status === 'pending') pass('lead mínimo arranca en status=pending');
      else fail(`lead mínimo no está en pending; status=${row.status}`);
    }
  }
}

// 4. Lead completo (incomplete=false)
{
  // Necesitamos una specialty real para la prueba completa
  const { data: specs } = await svc.from('specialties').select('id').limit(1);
  const SPEC_ID = specs?.[0]?.id;
  if (!SPEC_ID) {
    fail('no hay specialties en DB para probar lead completo');
  } else {
    // Eludir rate limit: ip_address=NULL en filas de check previas.
    await clearIpFromCheckRows();
    const { data, error } = await anon.rpc('submit_affiliation_request', {
      p_full_name: `${TEST_NAME_PREFIX} Lead completo`,
      p_phone: PHONE_COMPLETE,
      p_consent_version: CONSENT_VERSION,
      p_email: `check-s7-21-${baseTs}@lucycare.test`,
      p_specialty_id: SPEC_ID,
      p_license_number: 'CHECK-S7-21-' + baseTs,
      p_clinic_name: 'Consultorio de prueba',
      p_message: 'Mensaje del check',
    });
    if (error) { fail('RPC submit (completo) falló: ' + error.message); }
    else if (!data?.success) { fail('RPC submit (completo) sin success: ' + JSON.stringify(data)); }
    else {
      const { data: row } = await svc
        .from('doctor_affiliation_requests')
        .select('id, incomplete')
        .eq('phone_normalized', PHONE_COMPLETE)
        .maybeSingle();
      if (row?.incomplete === false) pass('lead completo tiene incomplete=false');
      else fail(`lead completo debería tener incomplete=false; valor=${row?.incomplete}`);
    }
  }
}

// 5. Validaciones del RPC
{
  // Nombre vacío
  const { error: e1 } = await anon.rpc('submit_affiliation_request', {
    p_full_name: '',
    p_phone: '50375990001',
    p_consent_version: CONSENT_VERSION,
  });
  if (e1 && /nombre/i.test(e1.message)) pass('RPC rechaza nombre vacío (P0001)');
  else fail('RPC NO rechazó nombre vacío: ' + (e1?.message ?? 'sin error'));

  // Phone vacío
  const { error: e2 } = await anon.rpc('submit_affiliation_request', {
    p_full_name: 'X',
    p_phone: '',
    p_consent_version: CONSENT_VERSION,
  });
  if (e2 && /tel/i.test(e2.message)) pass('RPC rechaza phone vacío (P0002)');
  else fail('RPC NO rechazó phone vacío: ' + (e2?.message ?? 'sin error'));

  // Phone inválido (muy corto)
  const { error: e3 } = await anon.rpc('submit_affiliation_request', {
    p_full_name: 'X',
    p_phone: '12',
    p_consent_version: CONSENT_VERSION,
  });
  if (e3 && /tel/i.test(e3.message)) pass('RPC rechaza phone < 7 dígitos (P0002)');
  else fail('RPC NO rechazó phone corto: ' + (e3?.message ?? 'sin error'));

  // Consent vacío
  const { error: e4 } = await anon.rpc('submit_affiliation_request', {
    p_full_name: 'X',
    p_phone: '50375990002',
    p_consent_version: '',
  });
  if (e4 && /privacidad|consent/i.test(e4.message)) pass('RPC rechaza consent vacío (P0003)');
  else fail('RPC NO rechazó consent vacío: ' + (e4?.message ?? 'sin error'));
}

// 6. UNIQUE por phone normalizado — segundo submit con mismo phone
{
  // Eludir rate limit antes del intento (preservando el lead anterior
  // para que UNIQUE dispare).
  await clearIpFromCheckRows();
  const { data, error } = await anon.rpc('submit_affiliation_request', {
    p_full_name: `${TEST_NAME_PREFIX} Duplicado`,
    p_phone: PHONE_INCOMPLETE, // mismo phone del lead mínimo
    p_consent_version: CONSENT_VERSION,
  });
  if (error) { fail('Segundo submit con mismo phone arrojó error (debería ser silencioso): ' + error.message); }
  else if (!data?.success) { fail('Segundo submit no devolvió success genérico: ' + JSON.stringify(data)); }
  else {
    pass('Segundo submit con mismo phone responde success genérico (no filtra)');
    // Verificar que NO se creó duplicado
    const { count } = await svc
      .from('doctor_affiliation_requests')
      .select('id', { count: 'exact', head: true })
      .eq('phone_normalized', PHONE_INCOMPLETE);
    if (count === 1) pass('Solo 1 fila final para el phone duplicado (UNIQUE OK)');
    else fail(`Esperaba 1 fila para ${PHONE_INCOMPLETE}, hay ${count}`);
  }
}

// 7. Anon NO puede leer la tabla directo
{
  const { data, error } = await anon.from('doctor_affiliation_requests').select('id').limit(1);
  if (error) pass('anon NO puede SELECT doctor_affiliation_requests (RLS bloquea): ' + error.message.slice(0, 60));
  else if (data?.length === 0) pass('anon SELECT devuelve 0 filas (RLS silencioso)');
  else fail('anon PUDO leer doctor_affiliation_requests — RLS abierto');
}

// 8. RPCs admin rechazan no-admin
{
  const { error: e1 } = await anon.rpc('admin_list_affiliation_requests', { });
  if (e1 && /no autorizado/i.test(e1.message)) pass('admin_list_affiliation_requests rechaza anon');
  else fail('admin_list_affiliation_requests no rechaza anon: ' + (e1?.message ?? 'sin error'));

  const { error: e2 } = await anon.rpc('admin_reject_affiliation_request', {
    p_id: '00000000-0000-0000-0000-000000000000',
    p_notes: 'test',
  });
  if (e2 && /no autorizado/i.test(e2.message)) pass('admin_reject_affiliation_request rechaza anon');
  else fail('admin_reject_affiliation_request no rechaza anon: ' + (e2?.message ?? 'sin error'));

  const { data: c, error: e3 } = await anon.rpc('admin_count_affiliation_pending');
  // Esta RPC devuelve 0 silenciosamente para no-admin (no error)
  if (!e3 && c === 0) pass('admin_count_affiliation_pending devuelve 0 a no-admin (silencioso)');
  else fail(`admin_count_affiliation_pending comportamiento inesperado: data=${c} err=${e3?.message}`);
}

// 9. audit_log registra el INSERT
if (minLeadId) {
  const { data: audit } = await svc
    .from('audit_log')
    .select('id, action, table_name, record_id, new_data')
    .eq('table_name', 'doctor_affiliation_requests')
    .eq('record_id', minLeadId)
    .eq('action', 'insert')
    .limit(1);
  if (audit && audit.length > 0) {
    pass('audit_log registra el INSERT con edited_via=submit_affiliation_request');
    const newData = audit[0].new_data;
    if (newData?.edited_via === 'submit_affiliation_request') pass('  → edited_via correcto');
    else fail(`  → edited_via inesperado: ${newData?.edited_via}`);
  } else {
    fail('audit_log NO registró el INSERT del lead mínimo');
  }
}

// ─── Cleanup ───
console.log('\nCleanup…');
const { error: cErr, count: cCount } = await svc
  .from('doctor_affiliation_requests')
  .delete({ count: 'exact' })
  .like('full_name', `${TEST_NAME_PREFIX}%`);
if (cErr) console.log('  ⚠️  cleanup error:', cErr.message);
else console.log(`  → eliminados ${cCount} leads de prueba`);

console.log(`\n${allOk ? '✅ s7_21 OK' : '❌ s7_21 con fallas — revisar'}`);
process.exit(allOk ? 0 : 1);
