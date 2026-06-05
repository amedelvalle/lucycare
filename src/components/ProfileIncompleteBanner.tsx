/**
 * Banner no bloqueante "Completá tu perfil" — Paciente Global F2.2.
 * Se muestra en /paciente/mis-atenciones si falta documento/DUI, fecha de
 * nacimiento, departamento, municipio, o el nombre está vacío. El género NO
 * cuenta (para no presionar a completar todo). Dismissable por sesión.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMyProfile } from '@/hooks/usePatientProfile';

const DISMISS_KEY = 'lucy_profile_banner_dismissed';

export default function ProfileIncompleteBanner() {
  const { data: profile } = useMyProfile();
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  if (dismissed || !profile) return null;

  const incomplete =
    !profile.full_name?.trim() ||
    !profile.document_number ||
    !profile.date_of_birth ||
    !profile.department_id ||
    !profile.municipality_id;

  if (!incomplete) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <i className="ri-user-settings-line text-amber-600 text-lg mt-0.5" aria-hidden="true"></i>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">Completá tu perfil</p>
        <p className="text-xs text-amber-800 mt-0.5">
          Completá tu perfil para vincular bien tus atenciones y agilizar tus próximas citas.
        </p>
        <Link
          to="/paciente/perfil"
          className="inline-flex items-center gap-1.5 mt-2 text-sm font-medium text-amber-900 underline hover:text-amber-950"
        >
          Completar perfil
          <i className="ri-arrow-right-line" aria-hidden="true"></i>
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Cerrar"
        className="text-amber-500 hover:text-amber-700 flex-shrink-0"
      >
        <i className="ri-close-line text-lg" aria-hidden="true"></i>
      </button>
    </div>
  );
}
