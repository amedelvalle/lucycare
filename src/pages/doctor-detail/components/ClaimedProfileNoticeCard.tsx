import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSessionWithTimeout } from '../../../lib/session';

/** Canal público de soporte (temporal). NO usar un teléfono: el número
 *  anterior era además credencial de una cuenta administrativa. */
const SUPPORT_EMAIL = 'lucycare.digital@gmail.com';

interface ClaimedProfileNoticeCardProps {
  /** profile_id del médico dueño del perfil. Se compara con auth.uid() para decidir variant. */
  doctorProfileId: string;
}

/**
 * Card informativa que aparece en /doctor/:id cuando el médico ya
 * reclamó su perfil (`lucy_status='claimed'`) pero todavía no tiene
 * agenda en línea ni verificación oficial.
 *
 * Dos variantes según el viewer:
 *   - owner: el usuario logueado es el dueño (auth.uid() === profileId).
 *     Card azul con CTA al panel + WhatsApp Lucy.
 *   - public: cualquier otro viewer (anónimo, paciente, otro médico, admin).
 *     Card neutral en gris suave. Sin mencionar "onboarding" ni "en proceso";
 *     solo deja en claro que la reserva en línea aún no está activa.
 *
 * Mientras se resuelve la sesión renderiza la variante pública como fallback
 * fail-safe (nunca exponemos texto interno por error).
 */
export default function ClaimedProfileNoticeCard({ doctorProfileId }: ClaimedProfileNoticeCardProps) {
  const navigate = useNavigate();
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await getSessionWithTimeout(3000);
      if (cancelled) return;
      setIsOwner(!!session && session.userId === doctorProfileId);
    })();
    return () => {
      cancelled = true;
    };
  }, [doctorProfileId]);

  if (isOwner) {
    return (
      <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-full flex items-center justify-center flex-shrink-0 border border-blue-200">
            <i className="ri-checkbox-circle-line text-2xl sm:text-3xl text-blue-700"></i>
          </div>
          <div className="flex-1">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900">Tu perfil quedó reclamado</h3>
            <p className="text-sm text-gray-700 mt-1">
              Lucy está coordinando el onboarding para activar tu agenda en línea. Si necesitás continuar, escribinos.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <button
                type="button"
                onClick={() => navigate('/panel')}
                className="px-4 py-2 bg-blue-700 text-white rounded-lg font-medium hover:bg-blue-800 transition-colors cursor-pointer text-sm"
              >
                Ir al panel
              </button>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Necesito ayuda con mi perfil')}`}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-blue-300 text-blue-800 rounded-lg font-medium hover:bg-blue-100 transition-colors cursor-pointer text-sm"
              >
                <i className="ri-mail-line"></i>
                Escribir a Lucy
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Variante pública: neutra, una línea, sin jerga interna.
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <i className="ri-information-line text-gray-500 text-xl flex-shrink-0 mt-0.5"></i>
        <div>
          <p className="text-sm font-medium text-gray-900">Perfil informativo</p>
          <p className="text-sm text-gray-600 mt-0.5">
            Este profesional acepta consultas, pero la reserva en línea aún no está activa. Contactalo directamente desde
            los datos del perfil.
          </p>
        </div>
      </div>
    </div>
  );
}
