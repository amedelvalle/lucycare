/**
 * Verifica s7_27: límite de asistentes (Mi equipo Fase 1).
 *
 * Los triggers de DB SÍ se disparan para service_role (a diferencia del
 * RLS), así que el límite se puede testear empíricamente con una clínica
 * temporal: insertar 2 invitaciones de asistente (OK) y la 3ª (bloqueada
 * por trg_enforce_team_seat_limit). Cleanup al final.
 *
 * Uso: node scripts/check-s7_27.mjs
 */
import { supabaseAdmin as svc } from './_lib/supabase-admin.mjs';

const OWNER = 'db1fba98-a299-4f25-82f1-7feff01e58fa'; // profile de Camilo (owner válido)
let clinicId = null;
let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };
const ts = Date.now().toString().slice(-7);

try {
  // Clínica temporal
  const { data: clinic, error: cErr } = await svc.from('clinics')
    .insert({ name: `CHK-S7-27 ${ts}`, owner_id: OWNER, is_active: true })
    .select('id').single();
  if (cErr) throw new Error('no pude crear clínica temp: ' + cErr.message);
  clinicId = clinic.id;
  console.log('clínica temporal:', clinicId);

  // team_seat_limit == 2
  {
    const { data, error } = await svc.rpc('team_seat_limit', { p_clinic_id: clinicId });
    (!error && Number(data) === 2) ? pass('team_seat_limit() = 2') : fail('team_seat_limit inesperado: ' + (error?.message || data));
  }

  const invite = (phone) => svc.from('clinic_invitations').insert({
    clinic_id: clinicId, phone, role: 'assistant', invited_by: OWNER,
  });

  // 2 invitaciones de asistente → OK
  { const { error } = await invite('+5037000' + ts.slice(0,4)); error ? fail('invitación 1 falló: ' + error.message) : pass('invitación 1 (pendiente) OK'); }
  { const { error } = await invite('+5037100' + ts.slice(0,4)); error ? fail('invitación 2 falló: ' + error.message) : pass('invitación 2 (pendiente) OK'); }

  // team_seats_used == 2
  {
    const { data } = await svc.rpc('team_seats_used', { p_clinic_id: clinicId });
    Number(data) === 2 ? pass('team_seats_used() = 2 (activos + pendientes)') : fail('team_seats_used inesperado: ' + data);
  }

  // 3ª invitación → bloqueada por el trigger
  {
    const { error } = await invite('+5037200' + ts.slice(0,4));
    if (error && (error.code === 'P0001' || /incluye hasta 2|límite/i.test(error.message))) pass('3ª invitación BLOQUEADA por trigger ✅ → ' + error.message);
    else fail('3ª invitación NO bloqueada: ' + (error?.message || '(insertó!)'));
  }

  // Cancelar una pendiente libera cupo → permite invitar de nuevo
  {
    const { data: pend } = await svc.from('clinic_invitations')
      .select('id').eq('clinic_id', clinicId).is('accepted_at', null).is('cancelled_at', null).limit(1);
    await svc.from('clinic_invitations').update({ cancelled_at: new Date().toISOString() }).eq('id', pend[0].id);
    const { error } = await invite('+5037300' + ts.slice(0,4));
    error ? fail('tras cancelar, invitar debía permitirse: ' + error.message) : pass('cancelar libera cupo → nueva invitación OK');
  }
} catch (e) {
  fail('excepción: ' + e.message);
} finally {
  if (clinicId) {
    await svc.from('clinic_invitations').delete().eq('clinic_id', clinicId);
    await svc.from('clinics').delete().eq('id', clinicId);
    console.log('  → cleanup: clínica temporal + invitaciones eliminadas');
  }
  console.log(`\n${allOk ? '✅ s7_27 OK' : '❌ s7_27 con fallas'}`);
  process.exit(allOk ? 0 : 1);
}
