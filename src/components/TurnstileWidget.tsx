import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { CAPTCHA_ENABLED, TURNSTILE_SITE_KEY } from '../lib/authFlags';

/**
 * Cloudflare Turnstile (modo Managed) — componente reutilizable (AUTH-P1D2).
 *
 * - Solo se monta cuando CAPTCHA_ENABLED. El "modo" (Managed) lo define la
 *   configuración del widget en Cloudflare para esa Site Key; el cliente solo
 *   renderiza.
 * - Entrega el `captchaToken` vía onToken. onExpire/onError limpian el token
 *   (el caller debe bloquear el envío hasta tener uno nuevo).
 * - Expone reset() imperativo para pedir un token FRESCO tras cada envío/reenvío
 *   (los tokens de Turnstile son de un solo uso).
 * - El token NUNCA se registra en logs ni se persiste.
 */

type TurnstileRenderOptions = {
  sitekey: string;
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  theme?: 'auto' | 'light' | 'dark';
  appearance?: 'always' | 'execute' | 'interaction-only';
};

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileRenderOptions) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
    __turnstileScriptLoading?: Promise<void>;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileScriptLoading) return window.__turnstileScriptLoading;
  window.__turnstileScriptLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile-load-failed'));
    document.head.appendChild(s);
  });
  return window.__turnstileScriptLoading;
}

export interface TurnstileHandle {
  reset: () => void;
}

interface TurnstileWidgetProps {
  onToken: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  className?: string;
}

const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  ({ onToken, onExpire, onError, className }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      reset: () => {
        try {
          if (window.turnstile && widgetIdRef.current) {
            window.turnstile.reset(widgetIdRef.current);
          }
        } catch {
          /* noop */
        }
      },
    }));

    useEffect(() => {
      if (!CAPTCHA_ENABLED || !TURNSTILE_SITE_KEY) return;
      let cancelled = false;
      loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'auto',
            callback: (token: string) => onToken(token),
            'expired-callback': () => onExpire?.(),
            'timeout-callback': () => onExpire?.(),
            'error-callback': () => onError?.(),
          });
        })
        .catch(() => onError?.());
      return () => {
        cancelled = true;
        try {
          if (window.turnstile && widgetIdRef.current) window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* noop */
        }
        widgetIdRef.current = null;
      };
      // Montaje único por instancia; los callbacks se capturan por closure.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!CAPTCHA_ENABLED) return null;
    return <div ref={containerRef} className={className} />;
  },
);

TurnstileWidget.displayName = 'TurnstileWidget';
export default TurnstileWidget;
