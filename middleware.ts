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

function htmlResponse(html: string, cache: string, dbg?: string): Response {
  const headers: Record<string, string> = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': cache,
  };
  if (dbg) headers['x-og-debug'] = dbg; // TEMPORAL: diagnóstico, se remueve antes de merge
  return new Response(html, { status: 200, headers });
}

// Resultado del fetch del médico: distingue "no encontrado" (query OK, vacío)
// de "error/outage" (para no noindexar un perfil real durante una caída).
type DoctorResult =
  | { status: 'found'; doctor: ReturnType<typeof normalizeDoctor>; dbg: string }
  | { status: 'notfound'; dbg: string }
  | { status: 'error'; dbg: string };

async function fetchDoctor(idOrSlug: string): Promise<DoctorResult> {
  // En el runtime Edge de Vercel, `process.env.X` es un binding directo;
  // `globalThis.process` puede ser undefined. Leer `process.env` con guard
  // `typeof` (sin ReferenceError si no existiera).
  const hasProc = typeof process !== 'undefined' && !!process.env;
  const env: Record<string, string | undefined> = hasProc ? (process.env as any) : {};
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;
  // Diagnóstico: cuántas env vars ve el runtime (para distinguir "process
  // ausente" de "vars no seteadas en Vercel").
  const nkeys = hasProc ? Object.keys(env).length : -1;
  if (!base || !key) {
    return { status: 'error', dbg: `env:p=${hasProc ? 1 : 0},n=${nkeys},url=${base ? 1 : 0},key=${key ? 1 : 0}` };
  }

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
    if (!res.ok) return { status: 'error', dbg: `http=${res.status}` };
    const rows = await res.json();
    const doctor = normalizeDoctor(Array.isArray(rows) ? rows[0] : rows);
    if (!doctor || !doctor.slug) {
      return { status: 'notfound', dbg: `http=200,rows=${Array.isArray(rows) ? rows.length : 'nonarr'}` };
    }
    return { status: 'found', doctor, dbg: `http=200,ok` };
  } catch (e) {
    return { status: 'error', dbg: `throw:${(e as Error)?.message?.slice(0, 60) || 'x'}` };
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
      return htmlResponse(injectMeta(shell, meta), meta.indexable ? CACHE_OK : CACHE_SHORT, `found;${result.dbg}`);
    }
    if (result.status === 'notfound') {
      // Slug inexistente / no publicado → genérico + noindex, sin datos.
      return htmlResponse(injectMeta(shell, buildGenericNoindex(url.origin)), CACHE_SHORT, `notfound;${result.dbg}`);
    }
    // Outage / env faltante → shell tal cual (no noindexar un perfil real).
    return htmlResponse(shell, CACHE_SHORT, `error;${result.dbg}`);
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
