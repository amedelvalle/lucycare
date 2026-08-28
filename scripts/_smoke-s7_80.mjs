#!/usr/bin/env node
/**
 * _smoke-s7_80.mjs — DOCTOR-OWNER-NOTIFICATIONS-P0
 *
 * Verificador POST-APPLY, estrictamente de LECTURA. No inserta, no actualiza,
 * no borra y no envía correo.
 *
 * ── POR QUÉ ESTE SCRIPT NO CREA FIXTURES ──
 * El smoke con fixtures es SQL y lo corre el owner
 * (`docs/OWNER_S7_80_APPLY.md` §4), dentro de `BEGIN … ROLLBACK`. Tiene que
 * ser así: insertar un lead de prueba dispara también
 * `trg_audit_doctor_affiliation_requests`, y `audit_log` es INMUTABLE desde
 * s7_71b. Un script JS que commiteara dejaría filas de auditoría permanentes
 * de una fixture que ya no existe, imposibles de borrar. El ROLLBACK las
 * revierte; supabase-js no puede abrir esa transacción.
 *
 * Este script cubre lo que el SQL no ve bien: que los objetos quedaron con la
 * forma esperada y que el gate de la Edge Function rechaza un secreto inválido.
 *
 * ⚠️ Usa `service_role` en LECTURA. Requiere autorización del owner.
 *
 *   node scripts/_smoke-s7_80.mjs
 *   node scripts/_smoke-s7_80.mjs --probe-401   (además, sonda del gate)
 *
 * `--probe-401` manda UN POST con un secreto DELIBERADAMENTE INVÁLIDO y espera
 * 401. Nunca usa el secreto real: comprobar que el gate rechaza no requiere
 * conocer la credencial, y así este script nunca necesita tenerla.
 */
import { supabaseAdmin, SUPABASE_URL } from './_lib/supabase-admin.mjs';

let pass = 0, fail = 0;
const check = (label, ok, detalle) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detalle ? `\n         ${detalle}` : ''}`); }
};

console.log('\n_smoke-s7_80 — verificación post-apply (solo lectura)\n');

// ─── 1 · La outbox existe y es legible ──────────────────────
console.log('1. Outbox');
const { data: filas, error: errTabla } = await supabaseAdmin
  .from('doctor_owner_notifications')
  .select('id, event_type, dedupe_key, status, attempts, occurred_at, first_attempt_at, last_attempt_at, sent_at, last_error_code, provider_message_id, subject_request_id, subject_doctor_id, subject_profile_id')
  .order('occurred_at', { ascending: false })
  .limit(200);

// Sonda fiable: un `select` normal. Un `head:true` con `count` sobre una tabla
// INEXISTENTE devuelve 204 sin error y parecería que existe.
check('la tabla existe y responde', !errTabla, errTabla?.message);
if (errTabla) {
  console.log('\n  ⛔ s7_80 no parece aplicada. Nada más que verificar.\n');
  process.exit(1);
}

const rows = filas ?? [];
console.log(`       (${rows.length} filas leídas)`);

// ─── 2 · Sin PII en las columnas ────────────────────────────
console.log('\n2. Ausencia de PII');
const columnas = rows.length > 0 ? Object.keys(rows[0]) : [];
if (columnas.length === 0) {
  console.log('       outbox vacía — la forma se valida en el smoke SQL');
} else {
  for (const prohibida of ['full_name', 'phone', 'email', 'specialty', 'license_number', 'message']) {
    check(`sin columna ${prohibida}`, !columnas.includes(prohibida));
  }
}

// ─── 3 · Invariantes sobre lo que haya ──────────────────────
console.log('\n3. Invariantes de las filas existentes');
const afil = rows.filter((r) => r.event_type === 'affiliation_submitted');
const claims = rows.filter((r) => r.event_type === 'doctor_profile_claimed');

check('todo event_type es uno de los dos', rows.every((r) => ['affiliation_submitted', 'doctor_profile_claimed'].includes(r.event_type)));
check('todo status es uno de los cinco', rows.every((r) => ['pending', 'sending', 'sent', 'failed', 'needs_reconciliation'].includes(r.status)));
check('afiliación: dedupe_key == subject_request_id', afil.every((r) => r.dedupe_key === r.subject_request_id));
check('afiliación: sin doctor_id ni profile_id', afil.every((r) => r.subject_doctor_id === null && r.subject_profile_id === null));
check('claim: dedupe_key == id propio (evento nuevo cada vez)', claims.every((r) => r.dedupe_key === r.id));
check('claim: con doctor_id y profile_id, sin request_id', claims.every((r) => r.subject_doctor_id && r.subject_profile_id && r.subject_request_id === null));
check('sent siempre trae sent_at', rows.filter((r) => r.status === 'sent').every((r) => !!r.sent_at));
check('failed siempre trae last_error_code', rows.filter((r) => r.status === 'failed').every((r) => !!r.last_error_code));
check('sending siempre trae first_attempt_at', rows.filter((r) => r.status === 'sending').every((r) => !!r.first_attempt_at));
check('needs_reconciliation trae sello y motivo', rows.filter((r) => r.status === 'needs_reconciliation').every((r) => !!r.first_attempt_at && !!r.last_error_code));
check('first_attempt_at nunca posterior a last_attempt_at', rows.every((r) => !r.first_attempt_at || !r.last_attempt_at || new Date(r.first_attempt_at) <= new Date(r.last_attempt_at)));

// La invariante DURA del hardening: nada puede seguir reintentándose pasadas
// las 23 h del primer intento, porque Resend olvida la Idempotency-Key a las 24 h.
const H23 = 23 * 60 * 60 * 1000;
const fueraDeVentana = rows.filter((r) => r.status === 'sending' && r.first_attempt_at && Date.now() - new Date(r.first_attempt_at).getTime() > H23);
check('ninguna fila `sending` supera la ventana de 23 h', fueraDeVentana.length === 0,
  fueraDeVentana.length ? `${fueraDeVentana.length} fila(s) deberían estar en needs_reconciliation — el próximo drenado las mueve` : undefined);
check('ningún dedupe_key repetido dentro de su tipo', (() => {
  const vistos = new Set();
  for (const r of rows) {
    const k = `${r.event_type}|${r.dedupe_key}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
  }
  return true;
})());

// ─── 4 · service_role no puede escribir ─────────────────────
console.log('\n4. service_role no escribe en la outbox');
const { error: errIns } = await supabaseAdmin
  .from('doctor_owner_notifications')
  .insert({ event_type: 'affiliation_submitted', dedupe_key: `smoke-${Date.now()}` });
check('el INSERT directo es rechazado', !!errIns, errIns ? `(rechazado: ${errIns.code ?? ''})` : 'INSERTÓ — la tabla quedó escribible');
if (!errIns) {
  console.log('\n  ⛔ Se insertó una fila con service_role. Borrala y revisá los grants.\n');
}

// ─── 5 · Estado operativo ───────────────────────────────────
console.log('\n5. Estado operativo');
const porEstado = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {});
console.log(`       ${JSON.stringify(porEstado)}`);
const atascadas = rows.filter((r) => r.status === 'sending' && Date.now() - new Date(r.occurred_at).getTime() > 30 * 60 * 1000);
check('sin filas atascadas en sending > 30 min', atascadas.length === 0,
  atascadas.length ? `${atascadas.length} fila(s); el próximo drenado las recupera con la misma Idempotency-Key` : undefined);
const fallidas = rows.filter((r) => r.status === 'failed');
check('sin envíos fallidos', fallidas.length === 0,
  fallidas.length ? `códigos: ${[...new Set(fallidas.map((r) => r.last_error_code))].join(', ')}` : undefined);

const aReconciliar = rows.filter((r) => r.status === 'needs_reconciliation');
check('sin filas a reconciliar', aReconciliar.length === 0,
  aReconciliar.length
    ? `${aReconciliar.length} fila(s) caducaron la ventana de idempotencia. NO se reenvían solas: comprobá en los logs de Resend si el mensaje salió, y luego marcá sent o failed a mano. IDs: ${aReconciliar.map((r) => r.id).join(', ')}`
    : undefined);

// ─── 6 · Sonda del gate (opcional) ──────────────────────────
if (process.argv.includes('--probe-401')) {
  console.log('\n6. Gate de la Edge Function (secreto inválido a propósito)');
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/notify-owner-doctor-events`, {
      method: 'POST',
      headers: { 'X-Lucycare-Notify-Secret': 'valor-invalido-a-proposito' },
    });
    check('un secreto inválido recibe 401', resp.status === 401, `HTTP ${resp.status}`);
    const cuerpo = await resp.text();
    check('la respuesta no revela por qué falló', !/secret|header|expected/i.test(cuerpo), cuerpo.slice(0, 120));
  } catch (e) {
    check('la función responde', false, e instanceof Error ? e.message : 'error de red');
  }
} else {
  console.log('\n6. Gate de la Edge Function — omitido (usar --probe-401 tras desplegarla)');
}

console.log(`\n${pass}/${pass + fail} · ${fail === 0 ? 'PASS' : `${fail} FAIL`}\n`);
process.exit(fail === 0 ? 0 : 1);
