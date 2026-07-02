import { useLocation } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';

/**
 * Analytics Fase 1A — Vercel Web Analytics + Speed Insights, cookieless,
 * SIN eventos custom, SIN PII.
 *
 * DEFENSA DOBLE:
 *  1) Render allowlist: el componente solo se monta (inyecta los scripts) en
 *     rutas públicas del directorio; en cualquier otra ruta devuelve null.
 *  2) `beforeSend` allowlist: además, ANTES de emitir cualquier evento se
 *     revalida el path contra el allowlist y se retorna `null` si no está
 *     permitido — así, aunque en una SPA el componente tarde en desmontarse
 *     al navegar de una ruta pública a `/panel`/`/admin`/`/paciente`, ningún
 *     evento privado se envía. Aplica a Web Analytics Y a Speed Insights.
 *
 * Allowlist público (único, compartido por render y beforeSend):
 *   - `/`            (Home / directorio)
 *   - `/doctor/*`    (perfil público del médico, por slug o UUID)
 *   - `/privacidad`
 * Todo lo demás (panel/admin/paciente, flujos con token como
 * `/calificar/:token` y `/reset-password`, etc.) queda BLOQUEADO.
 *
 * `beforeSend` también sanitiza la URL reportada eliminando query/hash
 * (solo origin + pathname), como defensa en profundidad contra PII.
 */

const PUBLIC_EXACT = new Set(['/', '/privacidad']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return pathname === '/doctor' || pathname.startsWith('/doctor/');
}

/**
 * Guard compartido para `beforeSend` de Analytics y Speed Insights:
 * bloquea (null) cualquier evento cuya ruta no esté en el allowlist, y para
 * las permitidas recorta query/hash. Si la URL no se puede parsear, NO se
 * envía (null), por precaución.
 */
function guardEvent<T extends { url: string }>(event: T): T | null {
  try {
    const u = new URL(event.url);
    if (!isPublicPath(u.pathname)) return null;
    return { ...event, url: `${u.origin}${u.pathname}` };
  } catch {
    return null;
  }
}

export default function PublicAnalytics() {
  const { pathname } = useLocation();
  if (!isPublicPath(pathname)) return null;

  return (
    <>
      <Analytics beforeSend={guardEvent} />
      <SpeedInsights beforeSend={guardEvent} />
    </>
  );
}
