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
  escapeHtml, isUuid, extractSlug, normalizeDoctor,
  buildMeta, buildGenericNoindex, buildHomeMeta, buildNoindexRoute, injectMeta, buildSitemapXml, escapeXml, isSitemapEligible,
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

// T6 — sin especialidad → noindex (no elegible)
{
  const raw = { ...rawCamilo, specialties: null };
  const d = normalizeDoctor(raw);
  const m = buildMeta(d, ORIGIN);
  (!m.indexable && has(m.metaHtml, 'noindex,follow') && !isSitemapEligible(d))
    ? ok('T6 sin especialidad → noindex') : no('T6 debería noindex: ' + m.metaHtml);
}

// T6b — publicado SIN ubicación pero con especialidad+clínica → index,follow
// (alineado con el sitemap: la ubicación es opcional para indexar).
{
  const raw = {
    slug: 'dr-sin-ubi', booking_enabled: false,
    profiles: { full_name: 'Dr Sin Ubi', avatar_url: null },
    specialties: { name: 'Urología' }, clinics: { name: 'Clínica Z' },
  };
  const d = normalizeDoctor(raw);
  const m = buildMeta(d, ORIGIN);
  (m.indexable && has(m.metaHtml, 'index,follow') && !has(m.metaHtml, 'noindex'))
    ? ok('T6b sin ubicación pero completo → index,follow') : no('T6b debería index: ' + m.metaHtml);
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
    (xml.match(/<url>/g) || []).length === 3; // Home + 2 perfiles incluidos
  okAll ? ok('T14 sitemap (opción B): Home + incluye sin-ubicación; excluye sin-slug/especialidad/clínica')
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

// T16 — sin filas de médicos → urlset válido con SOLO el Home (1 url)
{
  const xml = buildSitemapXml([], ORIGIN);
  (xml.startsWith('<?xml') && has(xml, '<urlset') && has(xml, '</urlset>') &&
   has(xml, '<loc>https://lucycare.app/</loc>') &&
   (xml.match(/<url>/g) || []).length === 1 && !has(xml, '/doctor/'))
    ? ok('T16 sitemap sin médicos: válido con solo el Home /') : no('T16 sitemap vacío:\n' + xml);
}

// T17 — escapeXml
{
  escapeXml(`a&b<c>"d'`) === 'a&amp;b&lt;c&gt;&quot;d&apos;'
    ? ok('T17 escapeXml correcto') : no('T17 escapeXml: ' + escapeXml(`a&b<c>"d'`));
}

// ── Home (SEO Home OG) ──

// T18 — buildHomeMeta: indexable + OG/Twitter + canonical raíz + logo + copy con "El Salvador"
{
  const m = buildHomeMeta(ORIGIN);
  const okAll = m.indexable === true &&
    m.title === 'LucyCare El Salvador — Encuentra al médico perfecto para ti' &&
    has(m.metaHtml, 'index,follow') && !has(m.metaHtml, 'noindex') &&
    has(m.metaHtml, '<meta property="og:type" content="website">') &&
    has(m.metaHtml, `<link rel="canonical" href="https://lucycare.app/">`) &&
    has(m.metaHtml, `<meta property="og:url" content="https://lucycare.app/">`) &&
    has(m.metaHtml, 'https://lucycare.app/lucycare-logo.png') &&
    has(m.metaHtml, 'twitter:card') && has(m.metaHtml, 'summary_large_image') &&
    has(m.metaHtml, 'El Salvador');
  okAll ? ok('T18 buildHomeMeta: copy "El Salvador" + index,follow + og/twitter + canonical + logo')
        : no('T18 buildHomeMeta: ' + m.title + ' | ' + m.metaHtml);
}

// T18b — injectMeta con home meta: 1 title (home nuevo), 1 canonical, meta antes de </head>
{
  const m = buildHomeMeta(ORIGIN);
  const out = injectMeta(SHELL, m);
  const titleCount = (out.match(/<title>/gi) || []).length;
  const canonicalCount = (out.match(/rel="canonical"/gi) || []).length;
  const beforeHead = out.indexOf('og:title') < out.indexOf('</head>');
  (titleCount === 1 && has(out, '<title>LucyCare El Salvador — Encuentra al médico perfecto para ti</title>') &&
   canonicalCount === 1 && beforeHead && has(out, '<div id="root">'))
    ? ok('T18b injectMeta home: 1 title home + 1 canonical + meta antes de </head> + shell intacto')
    : no(`T18b injectMeta home (titles=${titleCount}, canonical=${canonicalCount}, beforeHead=${beforeHead})`);
}

// ── JSON-LD de marca (SEO Brand) ──

// T19 — buildHomeMeta emite JSON-LD @graph con Organization + WebSite,
// name LucyCare, areaServed El Salvador; SIN sameAs, SIN SearchAction; escapado.
{
  const m = buildHomeMeta(ORIGIN);
  const scriptMatch = m.metaHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let okAll = false, why = 'sin <script ld+json>';
  if (scriptMatch) {
    const rawJson = scriptMatch[1];
    // El JSON serializado escapa '<' como < (defensivo).
    const noRawAngle = !rawJson.includes('<');
    const data = JSON.parse(rawJson.replace(/\\u003c/g, '<'));
    const g = data['@graph'] || [];
    const org = g.find((x) => x['@type'] === 'Organization');
    const site = g.find((x) => x['@type'] === 'WebSite');
    const blob = JSON.stringify(data);
    okAll = data['@context'] === 'https://schema.org' &&
      !!org && org.name === 'LucyCare' && org.url === 'https://lucycare.app' &&
      org.logo === 'https://lucycare.app/lucycare-logo.png' &&
      org.areaServed && org.areaServed.name === 'El Salvador' &&
      !!site && site['@type'] === 'WebSite' && site.name === 'LucyCare' &&
      !('address' in org) &&            // sin dirección física
      !blob.includes('sameAs') &&       // sin redes inventadas
      !blob.includes('SearchAction') && !blob.includes('potentialAction') && // sin search action
      noRawAngle;
    if (!okAll) why = blob;
  }
  okAll ? ok('T19 JSON-LD: Organization+WebSite @graph, El Salvador, sin sameAs/SearchAction/address, escapado')
        : no('T19 JSON-LD: ' + why);
}

// T19b — el @graph de MARCA (Organization+WebSite) SOLO va en el Home; buildMeta
// (/doctor/*) NO lo emite. (El perfil sí tiene su propio Physician — ver T21.)
{
  const d = normalizeDoctor(rawCamilo);
  const m = buildMeta(d, ORIGIN);
  (!has(m.metaHtml, '@graph') && !has(m.metaHtml, 'WebSite'))
    ? ok('T19b /doctor/* NO emite el @graph de marca (Organization+WebSite es solo del Home)')
    : no('T19b doctor no debería tener el @graph de marca');
}

// ── Sitemap: Home `/` incluido (SEO Brand) ──

// T20 — buildSitemapXml incluye el Home `/` (priority 1.0, sin lastmod), sin UUID/privadas
{
  const rows = [{ ...rawCamilo, updated_at: '2026-06-30T12:00:00Z' }];
  const xml = buildSitemapXml(rows, ORIGIN);
  // Bloque <url> del Home (loc exactamente la raíz).
  const homeBlock = xml.match(/<url>\s*<loc>https:\/\/lucycare\.app\/<\/loc>[\s\S]*?<\/url>/);
  const okAll =
    !!homeBlock &&
    has(homeBlock[0], '<priority>1.0</priority>') &&
    !has(homeBlock[0], '<lastmod>') &&                       // Home sin lastmod (determinista)
    has(xml, '<loc>https://lucycare.app/doctor/dr-camilo-carrillo</loc>') && // perfiles intactos
    !/<loc>[^<]*\/(panel|admin|paciente|reset-password)/.test(xml) &&        // 0 rutas privadas
    !/<loc>[^<]*[0-9a-f]{8}-[0-9a-f]{4}-/i.test(xml);        // 0 UUIDs
  okAll ? ok('T20 sitemap: Home / (priority 1.0, sin lastmod) + perfiles por slug, 0 UUIDs/privadas')
        : no('T20 sitemap:\n' + xml);
}

// ── PR-D1: Physician JSON-LD en perfiles indexables ──

// T21 — perfil indexable emite Physician con @type/name/medicalSpecialty/url=canonical
{
  const d = normalizeDoctor(rawCamilo);
  const m = buildMeta(d, ORIGIN);
  const canonical = `${ORIGIN}/doctor/${d.slug}`;
  let okAll = false, why = '';
  const block = m.metaHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!block) { why = 'no hay <script ld+json> en el perfil'; }
  else {
    const node = JSON.parse(block[1].replace(/\\u003c/g, '<'));
    okAll =
      node['@type'] === 'Physician' &&
      node['@context'] === 'https://schema.org' &&
      node.name === d.name &&
      node.medicalSpecialty === d.specialty &&
      node.url === canonical &&
      // clínica + geo presentes (Camilo los tiene), país SV, sin street
      node.worksFor?.name === d.clinicName &&
      node.address?.addressCountry === 'SV' &&
      !('streetAddress' in (node.address || {}));
    if (!okAll) why = block[1];
  }
  okAll ? ok('T21 perfil indexable → Physician (@type/name/medicalSpecialty/url=canonical, worksFor, address SV sin street)')
        : no('T21 Physician: ' + why);
}

// T22 — Physician NO contiene datos prohibidos (JVPM/NUE/DUI/teléfono/email/rating/etc.)
{
  const d = normalizeDoctor(rawCamilo);
  const m = buildMeta(d, ORIGIN);
  const block = (m.metaHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || '';
  const forbidden = ['jvpm', 'license', 'nue', 'dui', 'telephone', 'phone', 'email',
                     'aggregateRating', 'review', 'priceRange', 'openingHours', 'streetAddress'];
  const hit = forbidden.find((k) => block.toLowerCase().includes(k.toLowerCase()));
  hit ? no('T22 Physician contiene campo prohibido: ' + hit)
      : ok('T22 Physician sin datos prohibidos (JVPM/NUE/DUI/teléfono/email/rating/priceRange/openingHours/street)');
}

// T23 — slug no publicado / genérico NO emite Physician (ni datos de médico)
{
  const g = buildGenericNoindex(ORIGIN);
  // perfil no indexable (sin especialidad → noindex): tampoco Physician
  const dNoIdx = normalizeDoctor({ ...rawCamilo, specialties: null });
  const mNoIdx = buildMeta(dNoIdx, ORIGIN);
  const okAll =
    !has(g.metaHtml, 'Physician') && !has(g.metaHtml, 'application/ld+json') &&
    has(g.metaHtml, 'noindex,follow') &&
    !has(mNoIdx.metaHtml, 'Physician') && has(mNoIdx.metaHtml, 'noindex');
  okAll ? ok('T23 genérico/no-publicado → noindex y SIN Physician')
        : no('T23 no-indexable no debería emitir Physician:\n' + g.metaHtml + '\n---\n' + mNoIdx.metaHtml);
}

// T24 — el JSON-LD Physician escapa `<` (anti cierre de </script>)
{
  const evil = normalizeDoctor({ ...rawCamilo, profiles: { full_name: 'Dr </script><b>X', avatar_url: null } });
  const m = buildMeta(evil, ORIGIN);
  const block = (m.metaHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || '';
  (block.includes('\\u003c') && !block.includes('</script>'))
    ? ok('T24 Physician escapa `<` (no puede cerrar </script>)')
    : no('T24 escaping Physician: ' + block);
}

// T25 — buildNoindexRoute (/calificar/*): noindex,follow, sin datos, sin JSON-LD, sin title
{
  const r = buildNoindexRoute();
  const okAll =
    r.indexable === false && r.title === null &&
    has(r.metaHtml, 'noindex,follow') &&
    !has(r.metaHtml, 'application/ld+json') &&
    !has(r.metaHtml, 'og:title') && !has(r.metaHtml, 'canonical');
  okAll ? ok('T25 /calificar/* → noindex,follow (sin datos, sin JSON-LD, sin title/canonical)')
        : no('T25 buildNoindexRoute: ' + JSON.stringify(r));
}

// T25b — injectMeta con noindexRoute conserva el <title>LucyCare</title> del shell
{
  const shell = '<html><head><title>LucyCare</title></head><body></body></html>';
  const out = injectMeta(shell, buildNoindexRoute());
  (has(out, '<title>LucyCare</title>') && has(out, 'noindex,follow') && (out.match(/<title>/g) || []).length === 1)
    ? ok('T25b injectMeta noindexRoute conserva el <title> del shell')
    : no('T25b: ' + out);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} og-meta smoke: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
