// Vercel Edge Middleware — Slugs+SEO Fase 3 / PR B.
//
// Solo intercepta /doctor/* : obtiene el médico PUBLICADO por slug o UUID e
// inyecta metadata dinámica (title/description/OG/Twitter/canonical/robots)
// en el HTML inicial, para que los crawlers sociales (WhatsApp/Facebook/…)
// —que NO ejecutan JS— vean un preview correcto. El humano recibe el mismo
// shell + meta y la SPA hidrata normal.
//
// Fuente de datos: Supabase REST con la ANON KEY (RLS: solo publicados).
// Env vars requeridas en Vercel (owner): SUPABASE_URL, SUPABASE_ANON_KEY.
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
} from './og-meta.mjs';

export const config = {
  matcher: '/doctor/:path*',
};

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
  const base = (globalThis as any).process?.env?.SUPABASE_URL;
  const key = (globalThis as any).process?.env?.SUPABASE_ANON_KEY;
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

export default async function middleware(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const shellUrl = new URL('/index.html', url.origin);

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
