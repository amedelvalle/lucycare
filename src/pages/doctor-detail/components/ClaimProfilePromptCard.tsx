import { useState } from 'react';
import ClaimProfileModal from './ClaimProfileModal';

interface ClaimProfilePromptCardProps {
  doctorId: string;
  doctorName: string;
  onClaimed?: () => void;
}

/**
 * CTA destacada para que el médico (o quien diga serlo) inicie el
 * flujo de "Reclamar perfil". Se monta SOLO cuando lucy_status='listed_only'.
 *
 * No promete agenda online ni publicación — sólo "confirmar que este
 * perfil es mío". El onboarding posterior lo hace LucyAdmin.
 */
export default function ClaimProfilePromptCard({
  doctorId,
  doctorName,
  onClaimed,
}: ClaimProfilePromptCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/60 border-2 border-emerald-200 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-full flex items-center justify-center flex-shrink-0 border border-emerald-200">
            <i className="ri-user-star-line text-2xl sm:text-3xl text-emerald-700"></i>
          </div>
          <div className="flex-1">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900">¿Eres este profesional?</h3>
            <p className="text-sm text-gray-700 mt-1">
              Reclamá tu perfil para confirmar que es tuyo. Después, junto con Lucy, lo dejamos listo para recibir
              pacientes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-full sm:w-auto px-5 py-2.5 bg-emerald-700 text-white rounded-lg font-medium hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            Reclamar mi perfil
          </button>
        </div>
      </div>

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
