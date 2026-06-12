/**
 * SMOKE s7_45 — F4-1: claim tolerante fila por fila.
 *
 * Corre con la sesión del test phone QA LIBRE (50375000099 / OTP 123456) y
 * service_role para fixtures/cleanup. Crea TODO aislado y limpia en finally
 * (incluida la identidad del profile QA, que se restaura a su estado previo).
 *
 * Reproduce el hallazgo F4 y valida la tolerancia:
 *  F1. Sin colisión: el claim vincula normal (linked=1, skipped=0) y copia
 *      la identidad global→local (DUI) como siempre (s7_33).
 *  F2. Mixto (repro F4): ficha B cuya copia de DUI choca con UNIQUE(clinic,
 *      doc) + ficha A2 vinculable + ficha D marcada merged + ficha E con par
 *      rechazado → el claim NO aborta: linked=1 (A2), skipped=1 (B);
 *      D y E ignoradas.
 *  F3. La ficha conflictiva queda INTACTA (sin media-copia de identidad).
 *  F4. El skip queda auditado: fila por ficha (claim_skipped_unique,
 *      record_id=B) + resumen con skipped[].
 *  F5. No-merge: nada se movió/desactivó/fusionó; las 6 fichas siguen.
 *  F6. profiles del caller intacto (el claim nunca escribe profiles).
 *  F7. Respuesta al cliente = solo conteos (sin patient_id ni detalle).
 *  F8. Idempotencia: re-claim → linked=0, skipped=1 (B re-reportada).
 *
 * Uso (SOLO después de aplicar s7_45): node scripts/_smoke-s7_45.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const QA_PHONE = '50375000099';
const OTP = '123456';
const SMOKE_DUI = 'S745-SMOKE-DUI';

const mk = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const login = async (cli, phone) => {
  await cli.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await cli.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error('OTP ' + phone + ': ' + (error?.message || 'sin sesión'));
  return data.user.id;
};

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

const qa = mk();
let uid = null;
let profileSnapshot = null;
let fichaA1 = null, fichaA2 = null, fichaB = null, fichaC = null, fichaD = null, fichaE = null;

console.log('═══ SMOKE s7_45 (claim tolerante fila por fila) ═══\n');

try {
  uid = await login(qa, QA_PHONE);

  // ── Guardas previas: el QA phone debe estar libre (sin fichas vinculadas
  // ni sueltas con su teléfono) para no contaminar datos via sync s7_33.
  {
    const { data: leftovers } = await admin.from('patients')
      .select('id, clinic_id, profile_id')
      .or(`profile_id.eq.${uid},phone.eq.${QA_PHONE}`);
    if ((leftovers ?? []).length > 0)
      throw new Error('El QA phone tiene fichas previas — limpiar antes de correr: ' + JSON.stringify(leftovers));
    const { data: dupDui } = await admin.from('patients')
      .select('id').eq('document_number', SMOKE_DUI);
    if ((dupDui ?? []).length > 0)
      throw new Error('Residuos de smoke previo (DUI ' + SMOKE_DUI + ') — limpiar antes: ' + JSON.stringify(dupDui));
  }

  // ── Profile QA: snapshot + setear DUI de prueba (el claim lo copiará).
  {
    const { data: prof, error } = await admin.from('profiles')
      .select('full_name, email, document_type, document_number, date_of_birth, gender')
      .eq('id', uid).single();
    if (error || !prof) throw new Error('profile QA inexistente: ' + (error?.message || ''));
    profileSnapshot = prof;
    const { error: upErr } = await admin.from('profiles')
      .update({ document_type: 'dui', document_number: SMOKE_DUI }).eq('id', uid);
    if (upErr) throw new Error('No se pudo setear DUI de prueba: ' + upErr.message);
  }

  // ── 3 clínicas sin fichas del QA ni con el DUI de prueba.
  const { data: clinicRows } = await admin.from('clinics').select('id').limit(10);
  if ((clinicRows ?? []).length < 3) throw new Error('Se necesitan 3 clínicas en DB');
  const [clinicX, clinicY, clinicW] = clinicRows.map((c) => c.id);

  const mkFicha = async (clinicId, name, { phone = QA_PHONE, doc = null } = {}) => {
    const { data, error } = await admin.from('patients').insert({
      clinic_id: clinicId, profile_id: null, full_name: name,
      document_type: 'dui', document_number: doc, date_of_birth: '1990-01-01',
      gender: 'otro', patient_type: 'privado', phone, is_active: true,
    }).select('id').single();
    if (error) throw new Error('fixture ' + name + ': ' + error.message);
    return data.id;
  };

  // ════ F1. Caso sin colisión ════
  fichaA1 = await mkFicha(clinicY, 'S745 Ficha A1');
  {
    const { data, error } = await qa.rpc('claim_patient_records');
    if (error) ko('F1 claim error: ' + error.message);
    else if (data?.linked_count === 1 && data?.skipped_count === 0)
      ok('F1 sin colisión: linked=1, skipped=0');
    else ko('F1 resultado inesperado: ' + JSON.stringify(data));

    const { data: row } = await admin.from('patients')
      .select('profile_id, document_number, link_confirmed_at').eq('id', fichaA1).single();
    if (row?.profile_id === uid && row?.document_number === SMOKE_DUI && row?.link_confirmed_at === null)
      ok('F1 A1 vinculada + identidad copiada (DUI) + sin confirmar (B2 intacto)');
    else ko('F1 estado A1 inesperado: ' + JSON.stringify(row));
  }

  // ════ F2. Caso mixto (repro hallazgo F4) ════
  // C ya "ocupa" el DUI en clínica X (otro teléfono) → al claimear B (mismo
  // phone QA, clínica X) la copia de identidad choca con UNIQUE(clinic, doc).
  fichaC = await mkFicha(clinicX, 'S745 Ficha C (ocupa DUI)', { phone: null, doc: SMOKE_DUI });
  fichaB = await mkFicha(clinicX, 'S745 Ficha B (conflictiva)');
  fichaA2 = await mkFicha(clinicW, 'S745 Ficha A2 (vinculable)');
  fichaD = await mkFicha(clinicW, 'S745 Ficha D (merged)');
  fichaE = await mkFicha(clinicX, 'S745 Ficha E (rechazada)');

  // D marcada como fusionada (columna pasiva — simulamos lo que hará F4-2).
  {
    const { error } = await admin.from('patients')
      .update({ merged_into_patient_id: fichaC, merged_at: new Date().toISOString() })
      .eq('id', fichaD);
    if (error) throw new Error('fixture D merged: ' + error.message);
  }
  // E con par rechazado (regresión s7_43).
  {
    const { error } = await admin.from('patient_link_rejections')
      .insert({ patient_id: fichaE, profile_id: uid, phone_normalized: QA_PHONE });
    if (error) throw new Error('fixture E rejection: ' + error.message);
  }
  ok('Fixtures F2: C ocupa DUI en X · B conflictiva en X · A2 vinculable en W · D merged · E rechazada');

  const profBefore = JSON.stringify(
    (await admin.from('profiles').select('full_name, email, document_type, document_number, date_of_birth, gender').eq('id', uid).single()).data
  );

  {
    const { data, error } = await qa.rpc('claim_patient_records');
    if (error) ko('F2 ¡el claim abortó! (esto es exactamente el bug F4): ' + error.message);
    else if (data?.linked_count === 1 && data?.skipped_count === 1)
      ok('F2 mixto: el claim NO abortó — linked=1 (A2), skipped=1 (B)');
    else ko('F2 resultado inesperado: ' + JSON.stringify(data));

    // F7. Respuesta solo-conteos (sin PII ni detalle por ficha).
    const extras = Object.keys(data ?? {}).filter((k) => !['success', 'linked_count', 'skipped_count', 'reason'].includes(k));
    if (extras.length === 0) ok('F7 respuesta al cliente = solo conteos (sin patient_id/clínica/detalle)');
    else ko('F7 la respuesta expone campos extra: ' + JSON.stringify(extras));
  }

  // F2b. A2 vinculada pese al conflicto de B.
  {
    const { data: row } = await admin.from('patients')
      .select('profile_id, document_number').eq('id', fichaA2).single();
    if (row?.profile_id === uid && row?.document_number === SMOKE_DUI)
      ok('F2b A2 vinculada + DUI copiado (las vinculables se vinculan)');
    else ko('F2b estado A2: ' + JSON.stringify(row));
  }

  // F3. B intacta: sin vincular y SIN media-copia (subtransacción revirtió todo).
  {
    const { data: row } = await admin.from('patients')
      .select('profile_id, document_number, full_name, merged_into_patient_id').eq('id', fichaB).single();
    if (row?.profile_id === null && row?.document_number === null && row?.full_name === 'S745 Ficha B (conflictiva)')
      ok('F3 B intacta: sin vincular, sin media-copia de identidad');
    else ko('F3 B contaminada: ' + JSON.stringify(row));
  }

  // F4. Audit del skip: fila por ficha + resumen con skipped[].
  {
    const { data: audB } = await admin.from('audit_log').select('new_data')
      .eq('table_name', 'patients').eq('record_id', fichaB)
      .order('created_at', { ascending: false }).limit(5);
    const skipRow = (audB ?? []).find((r) => r.new_data?.edited_via === 'claim_skipped_unique');
    if (skipRow?.new_data?.reason === 'unique_conflict' && skipRow?.new_data?.sqlstate === '23505')
      ok('F4 audit por ficha: claim_skipped_unique (23505) con record_id=B');
    else ko('F4 audit por ficha ausente/incompleto: ' + JSON.stringify((audB ?? []).map((r) => r.new_data?.edited_via)));

    const { data: audSum } = await admin.from('audit_log').select('new_data')
      .eq('table_name', 'patients').eq('record_id', uid)
      .order('created_at', { ascending: false }).limit(3);
    const sum = (audSum ?? []).find((r) => r.new_data?.edited_via === 'claim_patient_records');
    const skippedArr = sum?.new_data?.skipped ?? [];
    if (sum?.new_data?.skipped_count === 1 && skippedArr.some((s) => s.patient_id === fichaB))
      ok('F4 audit resumen: skipped_count=1 + detalle de B en skipped[]');
    else ko('F4 audit resumen incompleto: ' + JSON.stringify(sum?.new_data));
  }

  // F2c. D (merged) y E (rechazada) ignoradas; C intacta.
  {
    const { data: rows } = await admin.from('patients')
      .select('id, profile_id, document_number').in('id', [fichaD, fichaE, fichaC]);
    const byId = Object.fromEntries((rows ?? []).map((r) => [r.id, r]));
    if (byId[fichaD]?.profile_id === null) ok('F2c D (merged) NO se re-vinculó');
    else ko('F2c ¡D merged se vinculó!: ' + JSON.stringify(byId[fichaD]));
    if (byId[fichaE]?.profile_id === null) ok('F2c E (par rechazado) sigue excluida (regresión s7_43)');
    else ko('F2c ¡E rechazada se vinculó!: ' + JSON.stringify(byId[fichaE]));
    if (byId[fichaC]?.profile_id === null && byId[fichaC]?.document_number === SMOKE_DUI)
      ok('F2c C intacta (sigue ocupando el DUI, sin tocar)');
    else ko('F2c C cambió: ' + JSON.stringify(byId[fichaC]));
  }

  // F5. No-merge: las 6 fichas existen, ninguna desactivada ni fusionada nueva.
  {
    const ids = [fichaA1, fichaA2, fichaB, fichaC, fichaD, fichaE];
    const { data: rows } = await admin.from('patients')
      .select('id, is_active, merged_into_patient_id').in('id', ids);
    const allThere = (rows ?? []).length === 6;
    const noNewMerge = (rows ?? []).every((r) => r.id === fichaD ? true : r.merged_into_patient_id === null);
    const noneDeactivated = (rows ?? []).every((r) => r.is_active === true);
    if (allThere && noNewMerge && noneDeactivated) ok('F5 no-merge: 6/6 fichas existen, activas, sin fusiones nuevas');
    else ko('F5 estado inesperado: ' + JSON.stringify(rows));
  }

  // F6. profiles del caller intacto (el claim no escribe profiles).
  {
    const profAfter = JSON.stringify(
      (await admin.from('profiles').select('full_name, email, document_type, document_number, date_of_birth, gender').eq('id', uid).single()).data
    );
    if (profAfter === profBefore) ok('F6 profile del caller intacto (el claim no toca identidad global)');
    else ko('F6 ¡el profile cambió!: ' + profAfter);
  }

  // ════ F8. Idempotencia ════
  {
    const { data, error } = await qa.rpc('claim_patient_records');
    if (error) ko('F8 re-claim error: ' + error.message);
    else if (data?.linked_count === 0 && data?.skipped_count === 1)
      ok('F8 idempotente: re-claim → linked=0, skipped=1 (B re-reportada, no silenciada)');
    else ko('F8 re-claim inesperado: ' + JSON.stringify(data));

    const { data: rowA1 } = await admin.from('patients').select('profile_id').eq('id', fichaA1).single();
    if (rowA1?.profile_id === uid) ok('F8 fichas ya vinculadas intactas');
    else ko('F8 A1 cambió: ' + JSON.stringify(rowA1));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    if (fichaE) await admin.from('patient_link_rejections').delete().eq('patient_id', fichaE);
    // D referencia a C vía FK merged_into → borrar D antes que C.
    for (const id of [fichaD, fichaB, fichaA1, fichaA2, fichaE, fichaC].filter(Boolean)) {
      await admin.from('patients').delete().eq('id', id);
    }
    if (uid && profileSnapshot) {
      // Restaurar identidad del profile QA (las fichas del smoke ya no existen
      // → el sync s7_33 no propaga a nada).
      await admin.from('profiles').update({
        document_type: profileSnapshot.document_type,
        document_number: profileSnapshot.document_number,
      }).eq('id', uid);
    }
    await qa.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK (fixtures fuera + profile QA restaurado)');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_45 OK' : '❌ SMOKE s7_45 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
