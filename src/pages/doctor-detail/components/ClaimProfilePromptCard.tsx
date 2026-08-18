import { useEffect, useState } from 'react';
import { getSessionWithTimeout } from '../../../lib/session';
import ClaimProfileModal from './ClaimProfileModal';

type ClaimViewerKind = 'loading' | 'owner' | 'anon' | 'other';

interface ClaimProfilePromptCardProps {
  doctorId: string;
  doctorName: string;
  /** profile_id del dueño del perfil. Se compara con auth.uid() para decidir el viewer. */
  doctorProfileId?: string | null;
  /**
   * 'full'     → bloque emerald destacado. SOLO para el médico dueño logueado.
   * 'discrete' → entrada secundaria (link). SOLO para visitante anónimo.
   */
  variant: 'full' | 'discrete';
  onClaimed?: () => void;
}

/**
 * CTA para iniciar el flujo de "Reclamar perfil". El padre la monta SOLO
 * cuando lucy_status === 'listed_only' (gate explícito, sin fail-open).
 *
 * La visibilidad depende del viewer para no mostrarle al paciente un llamado
 * de captación de médicos:
 *   - dueño logueado (auth.uid() === doctorProfileId) → card completa (variant 'full').
 *   - visitante anónimo (sin sesión) → entrada discreta abajo (variant 'discrete').
 *   - cualquier otro autenticado que no es dueño → nada.
 *
 * Mientras la sesión resuelve no se muestra nada (sin flash de contenido).
 * Cada variante lleva su propio margen para no dejar un gap fantasma cuando
 * el componente devuelve null.
 */
export default function ClaimProfilePromptCard({
  doctorId,
  doctorName,
  doctorProfileId,
  variant,
  onClaimed,
}: ClaimProfilePromptCardProps) {
  const [open, setOpen] = useState(false);
  const [viewer, setViewer] = useState<ClaimViewerKind>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSessionWithTimeout(3000);
      if (cancelled) return;
      if (!session) {
        setViewer('anon');
      } else if (doctorProfileId && session.userId === doctorProfileId) {
        setViewer('owner');
      } else {
        setViewer('other');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doctorProfileId]);

  const showFull = variant === 'full' && viewer === 'owner';
  const showDiscrete = variant === 'discrete' && viewer === 'anon';

  if (!showFull && !showDiscrete) return null;

  return (
    <>
      {showFull && (
        <div className="mb-8 bg-gradient-to-br from-brand-mint/20 to-brand-mint/10 border-2 border-brand-mint/40 rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-full flex items-center justify-center flex-shrink-0 border border-brand-mint/40">
              <i className="ri-user-star-line text-2xl sm:text-3xl text-brand-purple"></i>
            </div>
            <div className="flex-1">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900">¿Eres este profesional?</h3>
              <p className="text-sm text-gray-700 mt-1">
                Reclama tu perfil para confirmar que es tuyo. Después, junto con Lucy, lo dejamos listo para recibir
                pacientes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="w-full sm:w-auto px-5 py-2.5 bg-brand-purple text-white rounded-lg font-medium hover:bg-brand-purple-dark transition-colors cursor-pointer whitespace-nowrap"
            >
              Reclamar mi perfil
            </button>
          </div>
        </div>
      )}

      {showDiscrete && (
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
            <i className="ri-user-star-line text-gray-400"></i>
            <span>¿Eres este profesional?</span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="font-medium text-brand-purple hover:text-brand-purple-dark hover:underline cursor-pointer"
            >
              Reclama tu perfil
            </button>
          </div>
        </div>
      )}

      <ClaimProfileModal
        isOpen={open}
        onClose={() => setOpen(false)}
        doctorName={doctorName}
        doctorId={doctorId}
        onActivated={onClaimed}
      />
    </>
  );
}
