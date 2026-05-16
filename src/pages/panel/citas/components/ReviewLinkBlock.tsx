import { useState, useEffect } from 'react';
import { getReviewToken, buildReviewUrl } from '@/services/reviews.service';

/**
 * Acciones de encuesta de satisfacción para una cita ATENDIDA.
 * Trae el token (RPC get_review_link), arma el link público /calificar/<token>
 * y permite copiarlo o enviarlo por WhatsApp (envío manual — decisión Sprint 6).
 *
 * El caller decide cuándo renderizarlo (solo en citas atendidas).
 * `compact` reduce paddings para usarlo dentro de una tarjeta de lista.
 */
export default function ReviewLinkBlock({
  appointmentId,
  patientName,
  patientPhone,
  compact = false,
}: {
  appointmentId: string;
  patientName: string | null;
  patientPhone: string | null;
  compact?: boolean;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setState('loading');
    getReviewToken(appointmentId)
      .then((token) => {
        if (!alive) return;
        if (!token) {
          setState('none');
          return;
        }
        setUrl(buildReviewUrl(token));
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [appointmentId]);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // navegador sin clipboard API — el usuario puede copiar manual del input
    }
  };

  const whatsappHref = (() => {
    if (!url) return null;
    const digits = (patientPhone ?? '').replace(/\D/g, '');
    const firstName = (patientName ?? '').split(' ')[0] || '';
    const msg = `Hola ${firstName}, gracias por tu visita. Cuéntanos cómo te fue calificando tu atención (toma 1 minuto): ${url}`;
    const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
    return `${base}?text=${encodeURIComponent(msg)}`;
  })();

  if (state === 'loading') {
    return (
      <div className="text-xs text-gray-400">Cargando encuesta…</div>
    );
  }

  if (state === 'none') {
    return (
      <div className="flex items-start gap-2 text-gray-500">
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        <p className="text-xs">Encuesta no disponible para esta cita (sin token generado).</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <p className="text-xs text-amber-700">No se pudo obtener el link de encuesta.</p>
    );
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
        Encuesta de satisfacción
      </p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url ?? ''}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 text-[11px] bg-white border border-emerald-200 rounded-lg px-2 py-1.5 text-gray-600"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
        >
          {copied ? 'Copiado ✓' : 'Copiar link'}
        </button>
        {whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-[#25D366] hover:bg-[#1ebe5b] text-white whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.523 5.26l-.999 3.648 3.965-1.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.078 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
            </svg>
            WhatsApp
          </a>
        )}
      </div>
      <p className="text-[10px] text-gray-400 leading-tight">
        Vence en 7 días · un solo uso
      </p>
    </div>
  );
}
