import { useLocation } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

/**
 * Analytics Fase 1A — Vercel Web Analytics + Speed Insights, cookieless,
 * SIN eventos custom, SIN PII.
 *
 * Se monta SOLO en rutas públicas del directorio (allowlist). Con un
 * allowlist (no denylist) garantizamos que nunca cargue en el panel médico,
 * admin ni área de paciente, y además excluimos los flujos con token en la
 * URL (`/calificar/:token`, `/reset-password`) por privacidad, aunque sean
 * técnicamente públicos. Solo se mide el directorio orientado al visitante:
 *   - `/`            (Home / directorio)
 *   - `/doctor/:slug`|`/doctor/:uuid` (perfil público del médico)
 *   - `/privacidad`
 *
 * `beforeSend` elimina query/hash de la URL reportada (defensa en
 * profundidad: aunque el proyecto no pone PII en query strings, no enviamos
 * nada más allá del path).
 */

const PUBLIC_EXACT = new Set(['/', '/privacidad']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return pathname === '/doctor' || pathname.startsWith('/doctor/');
}

export default function PublicAnalytics() {
  const { pathname } = useLocation();
  if (!isPublicPath(pathname)) return null;

  return (
    <>
      <Analytics
        beforeSend={(event) => {
          try {
            const u = new URL(event.url);
            return { ...event, url: `${u.origin}${u.pathname}` };
          } catch {
            return event;
          }
        }}
      />
      <SpeedInsights />
    </>
  );
}
