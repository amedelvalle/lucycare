/**
 * Diagnóstico READ-ONLY de identidad de pacientes (no modifica nada).
 *
 * Herramienta reutilizable: correr ANTES de cualquier cambio de identidad
 * global (Paciente Global F2+: agregar DUI/identidad a `profiles`, UNIQUE de
 * documento, merge de duplicados) para detectar sorpresas. Solo SELECT.
 *
 * Reporta, sobre `patients`:
 *  - completitud de datos personales (document, DOB, gender, email, profile_id);
 *  - documentos duplicados (mismo type+canónico en >1 ficha);
 *  - mismo DUI con nombres distintos;
 *  - teléfonos compartidos (mismo phone en >1 ficha) y con nombres muy distintos;
 *  - implicancia para el UNIQUE(document_type, document_number) de profiles.
 *
 * Nombres y documentos se MUESTRAN ENMASCARADOS (privacidad en el transcript).
 *
 * Uso: node scripts/_diagnose-patient-global.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

// ─── Helpers de normalización (réplica de validateDocument) ───
function canonDoc(type, raw) {
  const num = (raw ?? '').trim();
  if (!num) return null;
  if (type === 'dui') {
    const d = num.replace(/[^0-9]/g, '');
    return d.length === 9 ? d.slice(0, 8) + '-' + d[8] : d; // inválido → solo dígitos
  }
  return num.replace(/\s+/g, ' ').slice(0, 40);
}
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
function nameTokens(name) {
  return stripAccents((name ?? '').toLowerCase()).split(/\s+/).filter((t) => t.length >= 2);
}
function veryDifferentNames(a, b) {
  const ta = new Set(nameTokens(a)), tb = nameTokens(b);
  if (ta.size === 0 || tb.length === 0) return false;
  return !tb.some((t) => ta.has(t)); // sin ningún token en común
}
const maskName = (n) => { const t = (n ?? '').trim().split(/\s+/); return t.length ? t[0] + ' ' + t.slice(1).map((x) => (x[0] || '') + '.').join(' ') : '—'; };
const maskDoc = (d) => (d ? d.replace(/[0-9A-Za-z](?=.{2})/g, '*') : '—');
const maskPhone = (p) => (p ? '…' + String(p).slice(-4) : '—');

console.log('═══ Diagnóstico Paciente Global F2 (READ-ONLY) ═══\n');

const { data: pts, error } = await admin
  .from('patients')
  .select('id, full_name, phone, document_type, document_number, date_of_birth, gender, email, profile_id, clinic_id, is_active');
if (error) { console.error('ERR', error.message); process.exit(1); }

const N = pts.length;
console.log(`Total filas en patients: ${N}\n`);

// ─── 1. Completitud ───
const pct = (n) => `${n}/${N} (${Math.round((n / N) * 100)}%)`;
const withDoc = pts.filter((p) => canonDoc(p.document_type, p.document_number));
console.log('— Completitud de datos personales —');
console.log('  con documento     :', pct(withDoc.length));
console.log('    · tipo dui      :', withDoc.filter((p) => p.document_type === 'dui').length);
console.log('    · otros tipos   :', withDoc.filter((p) => p.document_type !== 'dui').length);
console.log('    · type nulo+num :', withDoc.filter((p) => !p.document_type).length, '(documento sin type → viola la regla "si hay number hay type")');
console.log('  con fecha nac.    :', pct(pts.filter((p) => p.date_of_birth).length));
console.log('  con género        :', pct(pts.filter((p) => p.gender).length));
console.log('  con email         :', pct(pts.filter((p) => p.email).length));
console.log('  con profile_id    :', pct(pts.filter((p) => p.profile_id).length), '(ya reclamados)');

// ─── 2. Documentos duplicados (mismo type+canónico) ───
const byDoc = new Map();
for (const p of pts) {
  const c = canonDoc(p.document_type, p.document_number);
  if (!c) continue;
  const key = (p.document_type || 'sin_type') + '|' + c;
  if (!byDoc.has(key)) byDoc.set(key, []);
  byDoc.get(key).push(p);
}
const dupDocs = [...byDoc.entries()].filter(([, rows]) => rows.length > 1);
console.log('\n— Documentos duplicados (mismo tipo + número canónico) —');
console.log('  grupos de documento repetido:', dupDocs.length);
let docDiffName = 0;
for (const [key, rows] of dupDocs) {
  const names = rows.map((r) => r.full_name);
  const differ = names.some((n, i) => i > 0 && veryDifferentNames(names[0], n));
  if (differ) docDiffName++;
  const [type, num] = key.split('|');
  console.log(`   · ${type} ${maskDoc(num)} → ${rows.length} fichas | nombres: ${[...new Set(names.map(maskName))].join(' / ')}${differ ? '  ⚠ NOMBRES DISTINTOS' : ''}`);
}
console.log('  → mismo documento con nombres MUY distintos:', docDiffName, '(posible identidad compartida/errónea)');

// ─── 3. Teléfonos compartidos ───
const byPhone = new Map();
for (const p of pts) {
  if (!p.phone) continue;
  if (!byPhone.has(p.phone)) byPhone.set(p.phone, []);
  byPhone.get(p.phone).push(p);
}
const sharedPhones = [...byPhone.entries()].filter(([, rows]) => rows.length > 1);
const sharedDistinctName = sharedPhones.filter(([, rows]) => new Set(rows.map((r) => stripAccents((r.full_name || '').toLowerCase().trim()))).size > 1);
const sharedVeryDiff = sharedPhones.filter(([, rows]) => rows.some((r, i) => i > 0 && veryDifferentNames(rows[0].full_name, r.full_name)));
console.log('\n— Teléfonos compartidos (mismo phone en >1 ficha) —');
console.log('  phones en >1 ficha           :', sharedPhones.length);
console.log('  · con >1 nombre distinto     :', sharedDistinctName.length);
console.log('  · con nombres MUY diferentes :', sharedVeryDiff.length, '(riesgo claim-by-phone vincule a otra persona)');
for (const [phone, rows] of sharedVeryDiff) {
  console.log(`   · ${maskPhone(phone)} → ${[...new Set(rows.map((r) => maskName(r.full_name)))].join(' / ')} (${rows.length} fichas, ${new Set(rows.map((r) => r.clinic_id)).size} clínicas)`);
}

// ─── 4. Implicancia para el UNIQUE de profiles ───
console.log('\n— Implicancia para UNIQUE(document_type, document_number) en profiles —');
console.log('  profiles hoy NO tiene columnas de documento → 0 conflictos al crear el índice.');
console.log('  Al poblar profiles vía reclamo, los', dupDocs.length, 'documentos repetidos en patients');
console.log('  podrían generar choque SI dos personas distintas reclaman el mismo DUI → se rechaza y');
console.log('  queda como caso de merge (Fase 4).', docDiffName, 'grupo(s) con nombres distintos a vigilar.');

console.log('\n✅ Diagnóstico completo (no se modificó ningún dato).');
