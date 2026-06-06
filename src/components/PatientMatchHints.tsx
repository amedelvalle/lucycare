import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  findPatientMatchCandidates,
  type IntraMatchCandidate,
} from '@/services/patients.service';
import type { DocumentType } from '@/lib/document';

interface PatientMatchHintsProps {
  clinicId: string;
  /** Teléfono crudo del formulario (cualquier formato). */
  phone?: string;
  /** Tipo + número de documento del formulario (opcional; walk-in no los tiene). */
  documentType?: DocumentType;
  documentNumber?: string;
  /**
   * Acción para coincidencias INTRA-clínica ("Usar este paciente"). Si no se
   * pasa, las coincidencias intra se muestran sin botón de acción.
   */
  onUseExisting?: (c: { id: string; full_name: string; phone: string | null }) => void;
  className?: string;
}

/**
 * Panel de dedup preventivo (Paciente Global Fase 5). Mientras el médico
 * teclea teléfono y/o documento al crear un paciente, consulta
 * `find_patient_match_candidates` (debounced) y avisa si la persona quizá ya
 * existe — SIN revelar PII de otras clínicas.
 *
 * Reglas (firmadas en docs/ANALISIS_PACIENTE_GLOBAL.md §Fase 5):
 * - Intra-clínica → detalle (nombre, teléfono, activo) + "Usar este paciente".
 * - Cross-clínica fuerte (documento) → aviso sin PII.
 * - Cross-clínica débil (teléfono) → aviso sin PII.
 * - Nunca bloquea: es solo advisory.
 */
export default function PatientMatchHints({
  clinicId,
  phone = '',
  documentType,
  documentNumber = '',
  onUseExisting,
  className = '',
}: PatientMatchHintsProps) {
  // Normalización local para decidir si vale la pena consultar.
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneReady = phoneDigits.length >= 8;

  const docDigits = (documentNumber ?? '').replace(/[^A-Za-z0-9]/g, '');
  const docReady =
    !!documentType &&
    docDigits.length > 0 &&
    (documentType !== 'dui' ? docDigits.length >= 3 : docDigits.length === 9);

  const shouldQuery = phoneReady || docReady;

  // Debounce de la clave de búsqueda.
  const rawKey = `${phoneReady ? phoneDigits : ''}|${docReady ? `${documentType}:${docDigits}` : ''}`;
  const [debKey, setDebKey] = useState(rawKey);
  useEffect(() => {
    const t = setTimeout(() => setDebKey(rawKey), 350);
    return () => clearTimeout(t);
  }, [rawKey]);

  const enabled = shouldQuery && debKey === rawKey && debKey !== '|';

  const { data, isFetching } = useQuery({
    queryKey: ['patient-match', clinicId, debKey],
    queryFn: () =>
      findPatientMatchCandidates({
        clinicId,
        phone: phoneReady ? phone : undefined,
        documentType: docReady ? documentType : undefined,
        documentNumber: docReady ? documentNumber : undefined,
      }),
    enabled,
    staleTime: 30_000,
  });

  if (!shouldQuery) return null;

  // Buscando (sin datos aún para la clave actual)
  if (isFetching && !data) {
    return (
      <p className={`text-xs text-gray-400 ${className}`}>Buscando coincidencias…</p>
    );
  }
  if (!data) return null;

  const intra = data.intra_clinic ?? [];
  const cross = data.cross_clinic?.match ?? 'none';

  // Precedencia: intra (accionable) > strong > weak > none.
  if (intra.length > 0) {
    return (
      <div
        className={`bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 space-y-2 ${className}`}
      >
        <p className="text-sm text-amber-900">
          {intra.length > 1
            ? 'Ya existen pacientes con estos datos en esta clínica:'
            : 'Ya existe un paciente con estos datos en esta clínica:'}
        </p>
        <ul className="space-y-1.5">
          {intra.map((c) => (
            <IntraRow key={c.id} candidate={c} onUse={onUseExisting} />
          ))}
        </ul>
      </div>
    );
  }

  if (cross === 'strong') {
    return (
      <CrossNotice className={className}>
        Este documento ya está asociado a una identidad en LucyCare. Podés crear
        la ficha igualmente si es otra persona.
      </CrossNotice>
    );
  }

  if (cross === 'weak') {
    return (
      <CrossNotice className={className}>
        Existe una posible coincidencia en LucyCare. Verificá si corresponde a la
        misma persona.
      </CrossNotice>
    );
  }

  // none → feedback sutil de que se buscó.
  return (
    <p className={`text-xs text-gray-400 ${className}`}>Sin coincidencias en LucyCare.</p>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function IntraRow({
  candidate,
  onUse,
}: {
  candidate: IntraMatchCandidate;
  onUse?: (c: { id: string; full_name: string; phone: string | null }) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 bg-white border border-amber-100 rounded-md px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">
          {candidate.full_name}
          {!candidate.is_active && (
            <span className="ml-1.5 text-[11px] font-normal text-gray-400">(inactivo)</span>
          )}
        </p>
        {candidate.phone && (
          <p className="text-xs text-gray-500">{candidate.phone}</p>
        )}
      </div>
      {onUse && (
        <button
          type="button"
          onClick={() =>
            onUse({ id: candidate.id, full_name: candidate.full_name, phone: candidate.phone })
          }
          className="flex-shrink-0 px-2.5 py-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg"
        >
          Usar este paciente
        </button>
      )}
    </li>
  );
}

function CrossNotice({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 ${className}`}
    >
      <svg
        className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <p className="text-sm text-amber-900">{children}</p>
    </div>
  );
}
