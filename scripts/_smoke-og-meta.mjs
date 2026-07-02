/**
 * Smoke de la lógica pura de metadata/OG (Fase 3 PR B).
 *
 * Testea og-meta.mjs SIN red ni runtime edge: build de meta, inyección,
 * escaping, completitud/indexación, fallback genérico, UUID/slug.
 * (El middleware de Vercel solo corre en el deploy; la verificación
 *  end-to-end del crawler es en el preview de Vercel.)
 *
 * Uso: node scripts/_smoke-og-meta.mjs
 */
import {
  escapeHtml, isUuid, extractSlug, normalizeDoctor, isComplete,
  buildMeta, buildGenericNoindex, injectMeta, buildSitemapXml, escapeXml, isSitemapEligible,
} from '../og-meta.mjs';

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const no = (m) => { console.log('  ❌', m); fail++; };
const has = (h, s) => h.includes(s);

const ORIGIN = 'https://lucycare.app';
const SHELL = `<!doctype html><html lang="es"><head>
    <meta charset="UTF-8" />
    <title>LucyCare</title>
  </head><body><div id="root"></div></body></html>`;

// Fila cruda estilo PostgREST (embeds como objetos)
const rawCamilo = {
  slug: 'dr-camilo-carrillo', booking_enabled: true,
  profiles: { full_name: 'Dr. Camilo Carrillo', avatar_url: 'https://cdn.supabase.co/a/camilo.png' },
  specialties: { name: 'Medicina General' },
  clinics: { name: 'Clínica Lucy', municipalities: { name: 'San Salvador' }, departments: { name: 'San Salvador' } },
};

console.log('═══ Smoke og-meta (Fase 3 PR B) ═══\n');

// T1 — isUuid
{
  const u = isUuid('783a902a-55fd-407c-9e0a-69568135c7f5');
  const s = isUuid('dr-camilo-carrillo');
  (u && !s) ? ok('T1 isUuid distingue UUID vs slug') : no(`T1 isUuid (uuid=${u}, slug=${s})`);
}

// T2 — extractSlug
{
  const a = extractSlug('/doctor/dr-camilo-carrillo');
  const b = extractSlug('/doctor/783a902a-55fd-407c-9e0a-69568135c7f5');
  const c = extractSlug('/doctor/x/');
  (a === 'dr-camilo-carrillo' && b.startsWith('783a902a') && c === 'x')
    ? ok('T2 extractSlug OK (slug, uuid, trailing slash)') : no(`T2 extractSlug (${a}, ${b}, ${c})`);
}

// T3 — normalizeDoctor aplana bien
{
  const d = normalizeDoctor(rawCamilo);
  (d && d.name === 'Dr. Camilo Carrillo' && d.specialty === 'Medicina General' &&
   d.municipality === 'San Salvador' && d.avatarUrl && d.bookingEnabled === true && d.slug === 'dr-camilo-carrillo')
    ? ok('T3 normalizeDoctor aplana embeds') : no('T3 normalizeDoctor: ' + JSON.stringify(d));
}

// T4 — normalizeDoctor sin nombre → null
{
  const d = normalizeDoctor({ slug: 'x', profiles: { full_name: '  ' } });
  d === null ? ok('T4 sin nombre → null') : no('T4 debería ser null: ' + JSON.stringify(d));
}

// T5 — buildMeta completo → indexable + tags correctos
{
  const d = normalizeDoctor(rawCamilo);
  const m = buildMeta(d, ORIGIN);
  const okAll = m.indexable === true &&
    m.title === 'Dr. Camilo Carrillo — Medicina General | LucyCare' &&
    has(m.metaHtml, 'og:title') && has(m.metaHtml, '"og:description"'.slice(1)) &&
    has(m.metaHtml, `content="https://lucycare.app/doctor/dr-camilo-carrillo"`) &&
    has(m.metaHtml, 'https://cdn.supabase.co/a/camilo.png') &&
    has(m.metaHtml, 'twitter:card') &&
    has(m.metaHtml, 'index,follow') &&
    has(m.metaHtml, 'Reservá en línea');
  okAll ? ok('T5 buildMeta completo: index,follow + og/twitter/canonical + avatar')
        : no('T5 buildMeta: ' + m.title + ' | ' + m.metaHtml);
}

// T6 — incompleto (sin especialidad) → noindex
{
  const raw = { ...rawCamilo, specialties: null };
  const d = normalizeDoctor(raw);
  const m = buildMeta(d, ORIGIN);
  (!m.indexable && has(m.metaHtml, 'noindex,follow') && !isComplete(d))
    ? ok('T6 sin especialidad → noindex') : no('T6 debería noindex: ' + m.metaHtml);
}

// T7 — avatar null → fallback branded
{
  const raw = { ...rawCamilo, profiles: { full_name: 'Dra. Ana Ruiz', avatar_url: null } };
  const d = normalizeDoctor(raw);
  const m = buildMeta(d, ORIGIN);
  has(m.metaHtml, `content="https://lucycare.app/lucycare-logo.png"`)
    ? ok('T7 avatar null → og:image fallback branded') : no('T7 fallback: ' + m.metaHtml);
}

// T8 — escaping de caracteres peligrosos en el nombre
{
  const raw = { ...rawCamilo, profiles: { full_name: 'A"B & <C>', avatar_url: null } };
  const d = normalizeDoctor(raw);
  const m = buildMeta(d, ORIGIN);
  const noRaw = !has(m.metaHtml, 'A"B') && has(m.metaHtml, '&amp;') && has(m.metaHtml, '&lt;C&gt;') && has(m.metaHtml, '&quot;');
  noRaw ? ok('T8 escaping HTML de nombre (comillas/&/<>)') : no('T8 escaping: ' + m.metaHtml);
}

// T9 — buildGenericNoindex: noindex, sin datos de médico, no toca title
{
  const g = buildGenericNoindex(ORIGIN);
  (g.title === null && has(g.metaHtml, 'noindex,follow') && !has(g.metaHtml, 'Camilo'))
    ? ok('T9 genérico noindex sin datos de médico') : no('T9 genérico: ' + g.metaHtml);
}

// T10 — injectMeta: reemplaza title, inserta antes de </head>, un solo <title>/canonical
{
  const d = normalizeDoctor(rawCamilo);
  const m = buildMeta(d, ORIGIN);
  const out = injectMeta(SHELL, m);
  const titleCount = (out.match(/<title>/gi) || []).length;
  const canonicalCount = (out.match(/rel="canonical"/gi) || []).length;
  const beforeHead = out.indexOf('og:title') < out.indexOf('</head>');
  (titleCount === 1 && has(out, '<title>Dr. Camilo Carrillo — Medicina General | LucyCare</title>') &&
   canonicalCount === 1 && beforeHead && has(out, '<div id="root">'))
    ? ok('T10 injectMeta: 1 title dinámico + meta antes de </head> + shell intacto')
    : no(`T10 injectMeta (titles=${titleCount}, canonical=${canonicalCount}, beforeHead=${beforeHead})`);
}

// T11 — injectMeta genérico NO cambia el <title> del shell
{
  const g = buildGenericNoindex(ORIGIN);
  const out = injectMeta(SHELL, g);
  (has(out, '<title>LucyCare</title>') && has(out, 'noindex,follow'))
    ? ok('T11 injectMeta genérico conserva <title>LucyCare</title>') : no('T11: ' + out);
}

// T12 — escapeHtml directo
{
  escapeHtml(`<a href="x">&'`) === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;'
    ? ok('T12 escapeHtml correcto') : no('T12 escapeHtml: ' + escapeHtml(`<a href="x">&'`));
}

// ── Sitemap (PR C) ──

// T13 — buildSitemapXml: incluye publicados+completos con slug, ordenado
{
  const rows = [
    { ...rawCamilo, updated_at: '2026-06-30T12:00:00Z' },
    { slug: 'ana-ruiz', booking_enabled: false, updated_at: '2026-05-01T00:00:00Z',
      profiles: { full_name: 'Ana Ruiz' }, specialties: { name: 'Pediatría' },
      clinics: { name: 'Clínica X', municipalities: { name: 'Santa Ana' }, departments: { name: 'Santa Ana' } } },
  ];
  const xml = buildSitemapXml(rows, ORIGIN);
  const okAll =
    xml.startsWith('<?xml') && has(xml, '<urlset') && has(xml, '</urlset>') &&
    has(xml, '<loc>https://lucycare.app/doctor/ana-ruiz</loc>') &&
    has(xml, '<loc>https://lucycare.app/doctor/dr-camilo-carrillo</loc>') &&
    has(xml, '<lastmod>2026-06-30</lastmod>') &&
    xml.indexOf('ana-ruiz') < xml.indexOf('dr-camilo-carrillo'); // orden por slug
  okAll ? ok('T13 sitemap: publicados+completos con slug, lastmod fecha, ordenado')
        : no('T13 sitemap:\n' + xml);
}

// T14 — opción B: INCLUYE con especialidad+clínica aunque NO tenga ubicación;
// excluye sin slug y sin especialidad.
{
  const rows = [
    { ...rawCamilo }, // completo con slug → incluido
    { slug: 'sin-ubicacion', booking_enabled: false, profiles: { full_name: 'Dr Sin Ubi' },
      specialties: { name: 'Dermatología' }, clinics: { name: 'Clínica Y' } }, // sin muni/dept → INCLUIDO (opción B)
    { slug: null, profiles: { full_name: 'Sin Slug' }, specialties: { name: 'X' }, clinics: { name: 'C' } }, // sin slug → excluido
    { slug: 'sin-especialidad', profiles: { full_name: 'No Spec' }, specialties: null, clinics: { name: 'C' } }, // sin especialidad → excluido
    { slug: 'sin-clinica', profiles: { full_name: 'No Clinic' }, specialties: { name: 'X' }, clinics: null }, // sin clínica → excluido
  ];
  const xml = buildSitemapXml(rows, ORIGIN);
  const okAll =
    has(xml, 'dr-camilo-carrillo') && has(xml, '/doctor/sin-ubicacion') &&
    !has(xml, 'sin-especialidad') && !has(xml, 'sin-clinica') && !has(xml, 'Sin Slug') &&
    (xml.match(/<url>/g) || []).length === 2;
  okAll ? ok('T14 sitemap (opción B): incluye sin-ubicación; excluye sin-slug/especialidad/clínica')
        : no('T14 sitemap:\n' + xml);
}

// T14b — isSitemapEligible: no exige ubicación; sí nombre+especialidad+clínica
{
  const base = { name: 'X', specialty: 'Y', clinicName: 'Z', municipality: null, department: null };
  const okAll =
    isSitemapEligible(base) === true &&
    isSitemapEligible({ ...base, specialty: null }) === false &&
    isSitemapEligible({ ...base, clinicName: null }) === false &&
    isSitemapEligible({ ...base, name: '' }) === false;
  okAll ? ok('T14b isSitemapEligible: ubicación opcional, requiere nombre+especialidad+clínica')
        : no('T14b isSitemapEligible mal');
}

// T15 — nunca UUIDs; loc siempre por slug
{
  const xml = buildSitemapXml([{ ...rawCamilo }], ORIGIN);
  const uuidInLoc = /<loc>[^<]*[0-9a-f]{8}-[0-9a-f]{4}-/i.test(xml);
  (!uuidInLoc && has(xml, '/doctor/dr-camilo-carrillo'))
    ? ok('T15 sitemap sin UUIDs (loc por slug)') : no('T15 sitemap:\n' + xml);
}

// T16 — sin datos → urlset vacío válido
{
  const xml = buildSitemapXml([], ORIGIN);
  (xml.startsWith('<?xml') && has(xml, '<urlset') && has(xml, '</urlset>') && !has(xml, '<url>'))
    ? ok('T16 sitemap vacío válido sin filas') : no('T16 sitemap vacío:\n' + xml);
}

// T17 — escapeXml
{
  escapeXml(`a&b<c>"d'`) === 'a&amp;b&lt;c&gt;&quot;d&apos;'
    ? ok('T17 escapeXml correcto') : no('T17 escapeXml: ' + escapeXml(`a&b<c>"d'`));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} og-meta smoke: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
