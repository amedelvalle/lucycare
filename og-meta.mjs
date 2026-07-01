// Lógica pura (sin red, sin runtime edge) para la metadata dinámica de
// perfiles públicos de médicos. La usa `middleware.ts` (Vercel Edge) y se
// testea en node con `scripts/_smoke-og-meta.mjs`.
//
// NO accede a DB/red. Solo transforma datos ya obtenidos + el shell HTML.
// Reglas de privacidad (vinculantes): nunca license/JVPM/NUE, DUI, teléfono
// ni email. Sin copy de verificación (no se emite "Verificado por LucyCare").

const SITE = 'LucyCare';
const DEFAULT_OG_IMAGE_PATH = '/lucycare-logo.png'; // fallback branded temporal (deuda: OG 1200x630)

/** Escapa texto para insertarlo en HTML (contexto de atributo y de texto). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ¿El parámetro de la URL es un UUID (doctors.id) o un slug? */
export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
}

/** Último segmento no vacío del pathname (decodificado). '/doctor/x/' → 'x'. */
export function extractSlug(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  const last = parts[parts.length - 1] || '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// PostgREST embebe to-one como objeto, pero por robustez aceptamos array también.
function one(v) {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Aplana una fila de doctors (con embeds) a un objeto plano y seguro.
 * Solo campos públicos. Devuelve null si falta lo esencial (nombre).
 */
export function normalizeDoctor(raw) {
  if (!raw) return null;
  const profile = one(raw.profiles);
  const specialty = one(raw.specialties);
  const clinic = one(raw.clinics);
  const muni = clinic ? one(clinic.municipalities) : null;
  const dept = clinic ? one(clinic.departments) : null;

  const name = (profile?.full_name || '').trim();
  if (!name) return null;

  return {
    slug: raw.slug || null,
    name,
    specialty: (specialty?.name || '').trim() || null,
    clinicName: (clinic?.name || '').trim() || null,
    municipality: (muni?.name || '').trim() || null,
    department: (dept?.name || '').trim() || null,
    avatarUrl: profile?.avatar_url || null,
    bookingEnabled: raw.booking_enabled === true,
    updatedAt: raw.updated_at || null,
  };
}

/** Escapa para contenido/atributos XML. */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Construye el sitemap.xml a partir de filas crudas de doctors publicados.
 * Incluye SOLO perfiles con slug + completitud mínima (isComplete). Nunca
 * UUIDs, nunca datos clínicos/sensibles: solo la URL canónica por slug +
 * lastmod (fecha de updated_at si existe). Determinista (orden por slug).
 */
export function buildSitemapXml(rows, origin) {
  const seen = new Set();
  const entries = (Array.isArray(rows) ? rows : [])
    .map(normalizeDoctor)
    .filter((d) => d && d.slug && isComplete(d))
    .filter((d) => (seen.has(d.slug) ? false : (seen.add(d.slug), true)))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const urls = entries
    .map((d) => {
      const loc = escapeXml(`${origin}/doctor/${d.slug}`);
      // lastmod: fecha (YYYY-MM-DD) del updated_at si es parseable.
      let lastmod = '';
      if (d.updatedAt) {
        const iso = String(d.updatedAt);
        const m = iso.match(/^\d{4}-\d{2}-\d{2}/);
        if (m) lastmod = `\n    <lastmod>${m[0]}</lastmod>`;
      }
      return `  <url>\n    <loc>${loc}</loc>${lastmod}\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    (urls ? urls + '\n' : '') +
    `</urlset>\n`
  );
}

/**
 * Completitud mínima para indexar (Q3): nombre + especialidad + clínica +
 * ubicación (municipio o departamento). Sin esto → noindex.
 */
export function isComplete(d) {
  return !!(d && d.name && d.specialty && d.clinicName && (d.municipality || d.department));
}

function locationText(d) {
  return [d.municipality, d.department].filter(Boolean).join(', ');
}

/**
 * Construye la metadata de un médico. Devuelve { title, metaHtml, indexable }.
 * `origin` = https://lucycare.app (o el preview). Todos los valores escapados.
 */
export function buildMeta(d, origin) {
  const specialty = d.specialty || 'Médico';
  const loc = locationText(d);
  const indexable = isComplete(d);
  const canonical = `${origin}/doctor/${d.slug}`;
  const ogImage = d.avatarUrl || `${origin}${DEFAULT_OG_IMAGE_PATH}`;

  const title = `${d.name} — ${specialty} | ${SITE}`;
  const description =
    `Perfil de ${d.name}, ${specialty}` +
    (loc ? ` en ${loc}` : '') +
    `. ${d.bookingEnabled ? 'Reservá en línea' : 'Contactá'} en ${SITE}.`;
  const ogTitle = `${d.name} — ${specialty}`;

  const t = escapeHtml(title);
  const desc = escapeHtml(description);
  const ogT = escapeHtml(ogTitle);
  const url = escapeHtml(canonical);
  const img = escapeHtml(ogImage);

  const metaHtml = [
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta name="robots" content="${indexable ? 'index,follow' : 'noindex,follow'}">`,
    `<meta property="og:type" content="profile">`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta property="og:title" content="${ogT}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${ogT}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${img}">`,
  ].join('\n    ');

  return { title, metaHtml, indexable };
}

/**
 * Metadata genérica + noindex para slug inexistente / no publicado.
 * Nunca incluye datos de un médico. No cambia el <title>.
 */
export function buildGenericNoindex(origin) {
  const img = escapeHtml(`${origin}${DEFAULT_OG_IMAGE_PATH}`);
  const metaHtml = [
    `<meta name="robots" content="noindex,follow">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta property="og:title" content="${SITE}">`,
    `<meta property="og:image" content="${img}">`,
  ].join('\n    ');
  return { title: null, metaHtml, indexable: false };
}

/**
 * Inyecta la metadata en el shell HTML:
 *  - si viene `title`, reemplaza el <title> existente (evita 2 títulos);
 *  - inserta `metaHtml` justo antes de </head>.
 * Si no encuentra </head>, devuelve el shell intacto (fallback seguro).
 */
export function injectMeta(shellHtml, meta) {
  let html = String(shellHtml || '');
  if (meta.title) {
    const t = escapeHtml(meta.title);
    if (/<title>[\s\S]*?<\/title>/i.test(html)) {
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${t}</title>`);
    } else {
      html = html.replace(/<head>/i, `<head>\n    <title>${t}</title>`);
    }
  }
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `    ${meta.metaHtml}\n  </head>`);
  }
  return html;
}
