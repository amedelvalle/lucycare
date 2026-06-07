/**
 * SMOKE s7_38 — catálogo global + personal (RLS / ocultos / auditoría).
 *
 * Sesiones: Camilo (médico) + paciente (proxy de "no-médico": get_user_doctor_id
 * NULL, igual que un asistente). Fixtures globales/propias creadas con admin.
 * Limpia todo en finally.
 *
 * Cubre:
 *  1. Médico ve globales + propios (RLS).
 *  2. Médico no "ve" un global oculto (lista efectiva = globales no ocultos ∪ propios).
 *  3. Médico crea propio (RLS insert own).
 *  4. Médico NO puede editar un global (RLS update no aplica → 0 filas, global intacto).
 *  5. No-médico (paciente/asistente) NO puede crear (RLS).
 *  6. Auditoría: crear propio deja fila insert en audit_log.
 *  7. Medicamentos: global legible + insert propio OK + editar global bloqueado.
 *
 * Uso: node scripts/_smoke-s7_38.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const CAMILO_PHONE = '50378627694';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5';
const PATIENT_PHONE = '50375000001';
const OTP = '123456';

const camilo = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const patient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

let gDx = null, oDx = null, newDx = null, gMed = null, newMed = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
}

async function cleanup() {
  try {
    if (newDx) await admin.from('diagnoses').delete().eq('id', newDx);
    if (oDx) await admin.from('diagnoses').delete().eq('id', oDx);
    if (gDx) { await admin.from('doctor_catalog_hidden').delete().eq('item_id', gDx); await admin.from('diagnoses').delete().eq('id', gDx); }
    if (newMed) await admin.from('medications').delete().eq('id', newMed);
    if (gMed) await admin.from('medications').delete().eq('id', gMed);
  } catch { /* best-effort */ }
}

console.log('═══ SMOKE s7_38 (catálogo global + personal) ═══\n');

try {
  await login(camilo, CAMILO_PHONE);
  await login(patient, PATIENT_PHONE);

  // Fixtures
  const { data: g, error: gErr } = await admin.from('diagnoses')
    .insert({ name: 'S38 Global Dx', description: 'g', is_active: true, usage_count: 0 })
    .select('id').single();
  if (gErr) throw new Error('insert global dx: ' + gErr.message);
  gDx = g.id;
  const { data: o, error: oErr } = await admin.from('diagnoses')
    .insert({ doctor_id: CAMILO_DOCTOR, name: 'S38 Own Dx', is_active: true, usage_count: 0 })
    .select('id').single();
  if (oErr) throw new Error('insert own dx: ' + oErr.message);
  oDx = o.id;
  ok('Fixtures: diagnóstico global + diagnóstico propio de Camilo');

  // 1. Médico ve globales + propios
  {
    const { data } = await camilo.from('diagnoses').select('id, doctor_id').in('id', [gDx, oDx]);
    const ids = new Set((data ?? []).map((r) => r.id));
    if (ids.has(gDx) && ids.has(oDx)) ok('1 médico ve global + propio (RLS)');
    else ko('1 médico no ve ambos: ' + JSON.stringify(data));
  }

  // 2. Ocultar global → lista efectiva lo excluye
  {
    const { error: hErr } = await camilo.from('doctor_catalog_hidden')
      .insert({ doctor_id: CAMILO_DOCTOR, item_type: 'diagnosis', item_id: gDx });
    if (hErr) { ko('2 ocultar global (insert hidden): ' + hErr.message); }
    else {
      const { data: hidden } = await camilo.from('doctor_catalog_hidden')
        .select('item_id').eq('item_type', 'diagnosis');
      const hiddenIds = new Set((hidden ?? []).map((h) => h.item_id));
      const { data: vis } = await camilo.from('diagnoses').select('id, doctor_id').in('id', [gDx, oDx]);
      const effective = (vis ?? []).filter((r) => !(r.doctor_id === null && hiddenIds.has(r.id)));
      const effIds = new Set(effective.map((r) => r.id));
      if (!effIds.has(gDx) && effIds.has(oDx)) ok('2 global oculto excluido de la lista efectiva; propio sigue');
      else ko('2 oculto no excluido: ' + JSON.stringify({ hiddenIds: [...hiddenIds], effIds: [...effIds] }));
    }
  }

  // 3. Médico crea propio
  {
    const { data, error } = await camilo.from('diagnoses')
      .insert({ doctor_id: CAMILO_DOCTOR, name: 'S38 New Own', is_active: true, usage_count: 0 })
      .select('id').single();
    if (error) ko('3 médico no pudo crear propio: ' + error.message);
    else { newDx = data.id; ok('3 médico crea diagnóstico propio'); }
  }

  // 4. Médico NO edita global (RLS update no aplica → global intacto)
  {
    await camilo.from('diagnoses').update({ name: 'HACK GLOBAL' }).eq('id', gDx);
    const { data } = await admin.from('diagnoses').select('name').eq('id', gDx).single();
    if (data.name === 'S38 Global Dx') ok('4 médico NO pudo editar el global (intacto)');
    else ko('4 el global fue editado por el médico: ' + data.name);
  }

  // 5. No-médico (paciente/asistente) NO crea
  {
    const { error } = await patient.from('diagnoses')
      .insert({ doctor_id: CAMILO_DOCTOR, name: 'S38 Patient Hack', is_active: true, usage_count: 0 });
    if (error) ok('5 no-médico NO puede crear (RLS): ' + (error.code || error.message.slice(0, 40)));
    else ko('5 no-médico PUDO crear (RLS no bloqueó)');
  }

  // 6. Auditoría del insert propio
  if (newDx) {
    const { data } = await admin.from('audit_log')
      .select('id, action').eq('table_name', 'diagnoses').eq('record_id', newDx).eq('action', 'insert').limit(1);
    if ((data ?? []).length === 1) ok('6 auditoría: insert de diagnóstico propio registrado');
    else ko('6 sin fila de auditoría para el diagnóstico nuevo');
  }

  // 7. Medicamentos (condensado)
  {
    const { data: gm, error: gmErr } = await admin.from('medications')
      .insert({ commercial_name: 'S38 Global Med', is_active: true, usage_count: 0 }).select('id').single();
    if (gmErr) throw new Error('insert global med: ' + gmErr.message);
    gMed = gm.id;

    const { data: read } = await camilo.from('medications').select('id').eq('id', gMed);
    const readsGlobal = (read ?? []).length === 1;

    const { data: nm, error: nmErr } = await camilo.from('medications')
      .insert({ doctor_id: CAMILO_DOCTOR, commercial_name: 'S38 Own Med', is_active: true, usage_count: 0 })
      .select('id').single();
    const ownOk = !nmErr && !!nm;
    if (nm) newMed = nm.id;

    await camilo.from('medications').update({ commercial_name: 'HACK MED' }).eq('id', gMed);
    const { data: gmAfter } = await admin.from('medications').select('commercial_name').eq('id', gMed).single();
    const globalIntact = gmAfter.commercial_name === 'S38 Global Med';

    if (readsGlobal && ownOk && globalIntact) ok('7 medicamentos: global legible + insert propio OK + global no editable');
    else ko(`7 medicamentos falló: readsGlobal=${readsGlobal} ownOk=${ownOk} globalIntact=${globalIntact}`);
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  await cleanup();
  await camilo.auth.signOut().catch(() => {});
  await patient.auth.signOut().catch(() => {});
  console.log('  ✅ cleanup OK');
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_38 OK' : '❌ SMOKE s7_38 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
