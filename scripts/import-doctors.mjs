/**
 * Importador idempotente de médicos desde Excel.
 *
 * Uso:
 *   node scripts/import-doctors.mjs --file <ruta.xlsx> --sheet Importar_100 --dry-run
 *   node scripts/import-doctors.mjs --file <ruta.xlsx> --sheet Importar_100 --apply
 *
 * Reglas (acordadas con owner):
 * - Defaults seguros: lucy_status='listed_only', is_published=false,
 *   is_operational=false; is_verified queda automático en false.
 * - NO sobreescribe médicos existentes en esta primera importación.
 * - Dedup por: license_number → phone → email → name+specialty.
 *   Cualquier coincidencia → SALTAR (no actualizar).
 * - Ambiguo (name+spec matchea ≥2 médicos) → SALTAR.
 * - Especialidades: match por nombre normalizado (lowercase + sin tildes);
 *   si no existe, se crea en --apply.
 * - Crea auth.users via Admin API (sin SMS/OTP) + profiles + clinics + doctors.
 * - Si el teléfono fijo viene inválido, se deja clinics.phone=null y se reporta.
 */
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

// ─── Args ──────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) {
      const key = cur.replace(/^--/, '');
      const next = arr[i + 1];
      const val = !next || next.startsWith('--') ? true : next;
      acc.push([key, val]);
    }
    return acc;
  }, [])
);
const FILE = args.file;
const SHEET = args.sheet || 'Importar_100';
const DRY = args['dry-run'] === true || !args.apply;
const APPLY = args.apply === true && !args['dry-run'];
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
if (!FILE) { console.error('Falta --file <ruta.xlsx>'); process.exit(1); }
if (!fs.existsSync(FILE)) { console.error(`No existe: ${FILE}`); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ─── Helpers de normalización ─────────────────────────────────
function normName(s) { return (s || '').toString().trim().replace(/\s+/g, ' '); }
function normEmail(s) {
  const v = (s || '').toString().trim().toLowerCase();
  return v.includes('@') ? v : null;
}
function stripAccents(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normSpec(s) {
  return stripAccents((s || '').toString().trim().toLowerCase()).replace(/\s+/g, ' ');
}
function normPhone(input) {
  if (input == null) return null;
  const digits = String(input).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 8 && /^[267]/.test(digits)) return '503' + digits;
  if (digits.length === 11 && digits.startsWith('503')) return digits;
  return null;
}
function nameSpecKey(name, spec) {
  return `${stripAccents(name).toLowerCase().trim()}|${normSpec(spec)}`;
}

// ─── 1. Cargar Excel ──────────────────────────────────────────
console.log(`Leyendo ${FILE} · hoja "${SHEET}"…`);
const wb = XLSX.read(fs.readFileSync(FILE));
if (!wb.SheetNames.includes(SHEET)) {
  console.error(`Hoja "${SHEET}" no encontrada. Hojas: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}
const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { defval: null, raw: false });
const rows = rawRows.slice(0, LIMIT);
console.log(`Filas a procesar: ${rows.length}\n`);

// ─── 2. Cargar estado actual de DB (una sola query por entidad) ─
console.log('Cargando estado actual de la DB…');
const { data: existingDoctors, error: e1 } = await sb
  .from('doctors')
  .select('id, license_number, profile_id, specialty_id, profiles(full_name, phone, email), specialties(name)');
if (e1) { console.error('Error leyendo doctors:', e1.message); process.exit(1); }

const { data: existingSpecs } = await sb.from('specialties').select('id, name');
const specByNorm = new Map(); // normName → { id, originalName }
for (const s of existingSpecs ?? []) specByNorm.set(normSpec(s.name), { id: s.id, originalName: s.name });

// Indexes de dedup
const byLicense = new Map(); // license_norm → doctorId
const byPhone = new Map();
const byEmail = new Map();
const byNameSpec = new Map(); // key → [doctorId,…]
for (const d of existingDoctors ?? []) {
  const lic = (d.license_number || '').toString().trim().toLowerCase();
  if (lic) byLicense.set(lic, d.id);
  const ph = d.profiles?.phone || null;
  if (ph) byPhone.set(ph, d.id);
  const em = (d.profiles?.email || '').toLowerCase().trim();
  if (em) byEmail.set(em, d.id);
  const key = nameSpecKey(d.profiles?.full_name, d.specialties?.name);
  if (!byNameSpec.has(key)) byNameSpec.set(key, []);
  byNameSpec.get(key).push(d.id);
}
console.log(`  doctores en DB: ${existingDoctors?.length ?? 0}`);
console.log(`  especialidades en DB: ${existingSpecs?.length ?? 0}\n`);

// ─── 3. Procesar filas ────────────────────────────────────────
const planCreate = [];
const planSpecsToCreate = new Map(); // normName → originalName
const skippedDup = [];
const skippedAmbig = [];
const errors = [];
const notes = []; // problemas no bloqueantes

// dedup en batch (rows previas)
const seenLic = new Set();
const seenPhone = new Set();
const seenEmail = new Set();
const seenNameSpec = new Set();

for (const r of rows) {
  const fullName = normName(r.nombre);
  const specOrig = (r.especialidad_normalizada || r.especialidad_original || '').toString().trim();
  const specN = normSpec(specOrig);
  const license = (r.colegiacion ?? '').toString().trim();
  const licenseLc = license.toLowerCase();
  const email = normEmail(r.email_principal);
  const phone = normPhone(r.celular);
  const clinicPhone = normPhone(r.telefono_fijo);
  const clinicName = normName(r.clinica) || null;
  const address = normName(r.direccion) || null;
  const sourceRow = r.source_row;

  // Validaciones mínimas
  const issues = [];
  if (!fullName) issues.push('nombre vacío');
  if (!specOrig) issues.push('especialidad vacía');
  if (!license) issues.push('colegiación vacía');
  if (!email && !phone) issues.push('sin email ni celular');
  if (r.telefono_fijo && !clinicPhone) {
    notes.push({ sourceRow, name: fullName, note: `telefono_fijo inválido "${r.telefono_fijo}" → clinics.phone=null` });
  }
  if (issues.length > 0) {
    errors.push({ sourceRow, name: fullName, issues: issues.join(' / ') });
    continue;
  }

  // Dedup contra DB
  let dupReason = null;
  let dupAgainst = null;
  if (licenseLc && byLicense.has(licenseLc)) { dupReason = 'license_number'; dupAgainst = byLicense.get(licenseLc); }
  else if (phone && byPhone.has(phone)) { dupReason = 'phone'; dupAgainst = byPhone.get(phone); }
  else if (email && byEmail.has(email)) { dupReason = 'email'; dupAgainst = byEmail.get(email); }
  if (!dupReason) {
    const nsKey = nameSpecKey(fullName, specOrig);
    const matches = byNameSpec.get(nsKey) ?? [];
    if (matches.length === 1) { dupReason = 'name+specialty'; dupAgainst = matches[0]; }
    else if (matches.length >= 2) {
      skippedAmbig.push({ sourceRow, name: fullName, specialty: specOrig, against: matches });
      continue;
    }
  }
  // Dedup intra-batch
  if (!dupReason) {
    if (licenseLc && seenLic.has(licenseLc)) { dupReason = 'license_number (en batch)'; }
    else if (phone && seenPhone.has(phone)) { dupReason = 'phone (en batch)'; }
    else if (email && seenEmail.has(email)) { dupReason = 'email (en batch)'; }
    else if (seenNameSpec.has(nameSpecKey(fullName, specOrig))) { dupReason = 'name+specialty (en batch)'; }
  }
  if (dupReason) {
    skippedDup.push({ sourceRow, name: fullName, reason: dupReason, against: dupAgainst });
    continue;
  }

  // Especialidad: existir o marcar para crear
  if (specN && !specByNorm.has(specN) && !planSpecsToCreate.has(specN)) {
    planSpecsToCreate.set(specN, specOrig);
  }

  // Marcar como "a crear"
  planCreate.push({
    sourceRow, fullName, specOrig, specN, license, email, phone,
    clinicName, address, clinicPhone,
  });
  if (licenseLc) seenLic.add(licenseLc);
  if (phone) seenPhone.add(phone);
  if (email) seenEmail.add(email);
  seenNameSpec.add(nameSpecKey(fullName, specOrig));
}

// ─── 4. Reporte ───────────────────────────────────────────────
console.log('═══ REPORTE ═══');
console.log(`Modo: ${APPLY ? 'APPLY (escribirá DB)' : 'DRY-RUN (no escribe)'}`);
console.log(`Filas leídas:                ${rows.length}`);
console.log(`A crear:                     ${planCreate.length}`);
console.log(`Omitidos por duplicado:      ${skippedDup.length}`);
console.log(`Omitidos ambiguos:           ${skippedAmbig.length}`);
console.log(`Errores de validación:       ${errors.length}`);
console.log(`Notas no bloqueantes:        ${notes.length}`);
console.log(`Especialidades nuevas a crear: ${planSpecsToCreate.size}`);

if (planSpecsToCreate.size > 0) {
  console.log('\n── Especialidades NUEVAS que se crearían ──');
  [...planSpecsToCreate.values()].sort().forEach((s) => console.log(`  • ${s}`));
}

if (skippedDup.length > 0) {
  console.log('\n── Omitidos por duplicado (primeros 20) ──');
  skippedDup.slice(0, 20).forEach((x) =>
    console.log(`  fila ${x.sourceRow}  ${x.name}  → dup por ${x.reason} (doc=${x.against ?? '-'})`)
  );
  if (skippedDup.length > 20) console.log(`  …y ${skippedDup.length - 20} más`);
}

if (skippedAmbig.length > 0) {
  console.log('\n── Omitidos ambiguos (matchea ≥2 médicos por nombre+especialidad) ──');
  skippedAmbig.forEach((x) =>
    console.log(`  fila ${x.sourceRow}  ${x.name} · ${x.specialty}  → ids: ${x.against.join(', ')}`)
  );
}

if (errors.length > 0) {
  console.log('\n── Errores de validación ──');
  errors.forEach((e) => console.log(`  fila ${e.sourceRow}  ${e.name || '(sin nombre)'}  → ${e.issues}`));
}

if (notes.length > 0) {
  console.log('\n── Notas (no bloquean) ──');
  notes.forEach((n) => console.log(`  fila ${n.sourceRow}  ${n.name}  · ${n.note}`));
}

if (planCreate.length > 0) {
  console.log('\n── Muestra (primeros 5 a crear) ──');
  planCreate.slice(0, 5).forEach((p) =>
    console.log(`  fila ${p.sourceRow}  ${p.fullName} · ${p.specOrig} · license=${p.license} · phone=${p.phone ?? '-'} · email=${p.email ?? '-'}`)
  );
}

if (DRY) {
  console.log('\n[DRY-RUN] No se escribió nada en DB.');
  process.exit(0);
}

// ─── 5. APPLY ─────────────────────────────────────────────────
console.log('\n═══ APPLY — escribiendo a DB ═══');

// 5a. Crear especialidades nuevas
const specIdByNorm = new Map(specByNorm); // copy existing
for (const [normKey, originalName] of planSpecsToCreate) {
  const { data, error } = await sb
    .from('specialties')
    .insert({ name: originalName, is_active: true })
    .select('id, name')
    .single();
  if (error) {
    console.error(`  ❌ specialty "${originalName}":`, error.message);
    continue;
  }
  specIdByNorm.set(normKey, { id: data.id, originalName: data.name });
  console.log(`  ✓ specialty creada: ${data.name}`);
}

// 5b. Crear cada médico
let created = 0;
let failed = 0;
for (const p of planCreate) {
  try {
    const specId = specIdByNorm.get(p.specN)?.id ?? null;

    // Crear auth.users via Admin API (sin SMS/OTP)
    const phoneE164 = p.phone ? `+${p.phone}` : undefined;
    const { data: au, error: auErr } = await sb.auth.admin.createUser({
      email: p.email ?? undefined,
      phone: phoneE164,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: p.fullName, imported: true, source_row: p.sourceRow },
    });
    if (auErr) throw new Error(`auth.admin.createUser: ${auErr.message}`);
    const userId = au.user.id;

    // Upsert profile (por si un trigger lo creó)
    const { error: pErr } = await sb.from('profiles').upsert({
      id: userId,
      full_name: p.fullName,
      email: p.email,
      phone: p.phone,
      role: 'doctor',
    }, { onConflict: 'id' });
    if (pErr) throw new Error(`profiles upsert: ${pErr.message}`);

    // Crear clínica
    const { data: clinic, error: cErr } = await sb.from('clinics').insert({
      name: p.clinicName ?? 'Pendiente de completar',
      address_line: p.address,
      phone: p.clinicPhone,
      owner_id: userId,
      is_active: true,
    }).select('id').single();
    if (cErr) throw new Error(`clinics: ${cErr.message}`);

    // Crear doctor (defaults seguros)
    const { data: doc, error: dErr } = await sb.from('doctors').insert({
      profile_id: userId,
      clinic_id: clinic.id,
      specialty_id: specId,
      license_number: p.license,
      lucy_status: 'listed_only',
      is_published: false,
      is_operational: false,
      booking_enabled: false,
    }).select('id').single();
    if (dErr) throw new Error(`doctors: ${dErr.message}`);

    // Audit
    await sb.from('audit_log').insert({
      user_id: null,
      action: 'insert',
      table_name: 'doctors',
      record_id: doc.id,
      new_data: {
        imported: true,
        source_row: p.sourceRow,
        license: p.license,
        specialty: p.specOrig,
      },
    });

    created++;
    if (created % 10 === 0) console.log(`  … ${created} creados`);
  } catch (err) {
    failed++;
    console.error(`  ❌ fila ${p.sourceRow}  ${p.fullName}: ${err.message}`);
  }
}

console.log(`\n═══ APPLY FINAL ═══`);
console.log(`Creados: ${created}`);
console.log(`Fallidos: ${failed}`);
console.log(`Omitidos por duplicado: ${skippedDup.length}`);
console.log(`Omitidos ambiguos: ${skippedAmbig.length}`);
console.log(`Errores de validación: ${errors.length}`);
process.exit(failed > 0 ? 1 : 0);
