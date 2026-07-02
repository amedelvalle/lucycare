// Vercel Edge Middleware — Slugs+SEO Fase 3 / PR B.
//
// Solo intercepta /doctor/* : obtiene el médico PUBLICADO por slug o UUID e
// inyecta metadata dinámica (title/description/OG/Twitter/canonical/robots)
// en el HTML inicial, para que los crawlers sociales (WhatsApp/Facebook/…)
// —que NO ejecutan JS— vean un preview correcto. El humano recibe el mismo
// shell + meta y la SPA hidrata normal.
//
// Fuente de datos: Supabase REST con la ANON KEY (RLS: solo publicados).
// Env vars (Vercel): SUPABASE_URL / SUPABASE_ANON_KEY, o las que ya usa la
// app VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (todas públicas, RLS-gated).
// NUNCA service role. Sin escrituras. Solo lectura de médicos publicados.
//
// Fallback: si no hay médico / no publicado → shell + noindex genérico.
// Si Supabase falla (outage) → shell tal cual (no se noindexa un perfil real).
// Nunca 500 si se puede evitar.
//
// NOTA: el middleware SOLO corre en Vercel (no en `vite preview`). La lógica
// pura vive en ./og-meta.mjs y se testea con scripts/_smoke-og-meta.mjs.

import {
  isUuid,
  extractSlug,
  normalizeDoctor,
  buildMeta,
  buildGenericNoindex,
  injectMeta,
  buildSitemapXml,
} from './og-meta.mjs';

export const config = {
  matcher: ['/doctor/:path*', '/sitemap.xml'],
};

// Env pública (URL + anon key), aceptando el nombre dedicado o el de la app.
// NUNCA service role. RLS: solo lectura de médicos publicados.
function supabaseEnv(): { base?: string; key?: string } {
  const env: Record<string, string | undefined> =
    typeof process !== 'undefined' && process.env ? (process.env as any) : {};
  return {
    base: env.SUPABASE_URL || env.VITE_SUPABASE_URL,
    key: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
  };
}

const CACHE_OK = 'public, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_SHORT = 'public, s-maxage=300, stale-while-revalidate=3600';

function htmlResponse(html: string, cache: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cache,
    },
  });
}

// Resultado del fetch del médico: distingue "no encontrado" (query OK, vacío)
// de "error/outage" (para no noindexar un perfil real durante una caída).
type DoctorResult =
  | { status: 'found'; doctor: ReturnType<typeof normalizeDoctor> }
  | { status: 'notfound' }
  | { status: 'error' };

async function fetchDoctor(idOrSlug: string): Promise<DoctorResult> {
  const { base, key } = supabaseEnv();
  if (!base || !key) return { status: 'error' };

  const column = isUuid(idOrSlug) ? 'id' : 'slug';
  const select =
    'slug,booking_enabled,' +
    'profiles!inner(full_name,avatar_url),' +
    'specialties(name),' +
    'clinics!inner(name,municipalities(name),departments(name))';
  const url =
    `${base}/rest/v1/doctors` +
    `?${column}=eq.${encodeURIComponent(idOrSlug)}` +
    `&is_published=eq.true&select=${encodeURIComponent(select)}&limit=1`;

  try {
    const res = await fetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
    });
    if (!res.ok) return { status: 'error' };
    const rows = await res.json();
    const doctor = normalizeDoctor(Array.isArray(rows) ? rows[0] : rows);
    if (!doctor || !doctor.slug) return { status: 'notfound' };
    return { status: 'found', doctor };
  } catch {
    return { status: 'error' };
  }
}

function sitemapXmlResponse(xml: string, cache: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': cache },
  });
}

// sitemap.xml dinámico: SOLO médicos publicados con slug (la elegibilidad la
// filtra buildSitemapXml). Nunca UUIDs, nunca datos sensibles. Si Supabase
// falla o faltan env → urlset vacío válido (nunca 500) con cache CORTO
// (no cachear un fallback degradado tanto como un sitemap exitoso).
async function sitemapResponse(origin: string): Promise<Response> {
  const { base, key } = supabaseEnv();
  let rows: unknown[] = [];
  let degraded = false;
  if (!base || !key) {
    degraded = true;
  } else {
    const select =
      'slug,updated_at,booking_enabled,' +
      'profiles!inner(full_name),specialties!inner(name),' +
      'clinics!inner(name,municipalities(name),departments(name))';
    const url =
      `${base}/rest/v1/doctors` +
      `?is_published=eq.true&slug=not.is.null` +
      `&select=${encodeURIComponent(select)}&limit=1000`;
    try {
      const res = await fetch(url, {
        headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) rows = data;
        else degraded = true;
      } else {
        degraded = true;
      }
    } catch {
      degraded = true;
    }
  }
  // Éxito → cache largo; degradado (env faltante/outage) → cache corto.
  return sitemapXmlResponse(buildSitemapXml(rows, origin), degraded ? CACHE_SHORT : CACHE_OK);
}

export default async function middleware(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const shellUrl = new URL('/index.html', url.origin);

  if (url.pathname === '/sitemap.xml') {
    try {
      return await sitemapResponse(url.origin);
    } catch {
      // Nunca 500: urlset vacío válido, con cache corto (fallback degradado).
      return sitemapXmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`,
        CACHE_SHORT,
      );
    }
  }

  try {
    const idOrSlug = extractSlug(url.pathname);
    const [shellRes, result] = await Promise.all([fetch(shellUrl), fetchDoctor(idOrSlug)]);
    const shell = await shellRes.text();

    if (result.status === 'found' && result.doctor) {
      const meta = buildMeta(result.doctor, url.origin);
      return htmlResponse(injectMeta(shell, meta), meta.indexable ? CACHE_OK : CACHE_SHORT);
    }
    if (result.status === 'notfound') {
      // Slug inexistente / no publicado → genérico + noindex, sin datos.
      return htmlResponse(injectMeta(shell, buildGenericNoindex(url.origin)), CACHE_SHORT);
    }
    // Outage / env faltante → shell tal cual (no noindexar un perfil real).
    return htmlResponse(shell, CACHE_SHORT);
  } catch {
    // Fallback duro: servir el shell crudo. Nunca 500 si se puede evitar.
    try {
      return await fetch(shellUrl);
    } catch {
      return new Response('<!doctype html><title>LucyCare</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
  }
}
