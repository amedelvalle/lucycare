import { useEffect, useMemo, useState } from 'react';
import { useAmendConsultationText } from '@/hooks/useConsultation';
import type {
  ConsultationTextField,
  ConsultationTextChanges,
} from '@/services/consultations.service';

/**
 * Modal de corrección de una consulta FIRMADA (B2.1).
 * Solo campos de TEXTO. Motivo obligatorio. Envía a amend_consultation
 * únicamente los campos modificados. No toca recetas/diagnósticos/antecedentes/
 * vitales (B2.2 / B1.5). Patrón de modal sensible: NO cierra al click-outside;
 * se cierra por X, Escape o éxito (X/Escape deshabilitados mientras envía).
 */

const FIELDS: { key: ConsultationTextField; label: string; rows: number }[] = [
  { key: 'chief_complaint', label: 'Motivo principal de consulta', rows: 2 },
  { key: 'history_present_illness', label: 'Historia de la enfermedad actual', rows: 4 },
  { key: 'physical_exam', label: 'Exploración física', rows: 3 },
  { key: 'internal_analysis', label: 'Análisis interno', rows: 2 },
  { key: 'plan', label: 'Plan', rows: 5 },
];

type Values = Record<ConsultationTextField, string>;

interface Props {
  consultationId: string;
  appointmentId: string;
  initial: Values;
  onClose: () => void;
}

const textareaCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-y';

export default function CorrectConsultationModal({
  consultationId,
  appointmentId,
  initial,
  onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const [values, setValues] = useState<Values>(initial);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const amend = useAmendConsultationText(consultationId, appointmentId);
  const isSubmitting = amend.isPending;

  // Cerrar con Escape (salvo mientras envía). Listener antes de cualquier return.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSubmitting, onClose]);

  // Solo los campos modificados (vacío → null, para limpiar el campo).
  const changes = useMemo<ConsultationTextChanges>(() => {
    const out: ConsultationTextChanges = {};
    for (const { key } of FIELDS) {
      if (values[key].trim() !== initial[key].trim()) {
        out[key] = values[key].trim() === '' ? null : values[key];
      }
    }
    return out;
  }, [values, initial]);

  const hasChanges = Object.keys(changes).length > 0;
  const reasonOk = reason.trim().length > 0;
  const canSubmit = reasonOk && hasChanges && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setErrorMsg(null);
    try {
      await amend.mutateAsync({ reason: reason.trim(), changes });
      onClose(); // éxito → cierra; el parent ya quedó invalidado/refrescado
    } catch (err) {
      setErrorMsg(friendlyAmendError(err));
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Overlay SIN onClick: no cerrar al click-outside (form sensible) */}
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Corregir consulta firmada</h3>
            <p className="text-sm text-gray-600 mt-1">
              Los cambios quedan registrados como una <span className="font-semibold">corrección
              visible y auditada</span>. La versión anterior se conserva. Esta corrección solo
              edita texto clínico — no toca recetas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Motivo obligatorio */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Motivo de la corrección <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={2}
            value={reason}
            disabled={isSubmitting}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: corregir hallazgo de exploración mal redactado…"
            className={textareaCls}
            autoFocus
          />
          {!reasonOk && (
            <p className="text-xs text-amber-600 mt-1">El motivo es obligatorio.</p>
          )}
        </div>

        {/* Campos de texto */}
        <div className="space-y-3">
          {FIELDS.map(({ key, label, rows }) => {
            const changed = values[key].trim() !== initial[key].trim();
            return (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {label}
                  {changed && (
                    <span className="ml-2 text-[11px] font-semibold text-amber-600 uppercase">
                      · modificado
                    </span>
                  )}
                </label>
                <textarea
                  rows={rows}
                  value={values[key]}
                  disabled={isSubmitting}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  className={textareaCls}
                />
              </div>
            );
          })}
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mt-4">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs text-red-700">{errorMsg}</p>
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-3 justify-end pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
            title={!hasChanges ? 'No hay cambios para guardar' : !reasonOk ? 'Falta el motivo' : undefined}
          >
            {isSubmitting ? 'Guardando…' : 'Confirmar corrección'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function friendlyAmendError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e?.code) {
    case 'P0012':
      return 'El motivo de la corrección es obligatorio.';
    case 'P0013':
      return 'Hay un campo que no se puede corregir (paciente, médico, fechas o estado).';
    case 'P0011':
      return 'La consulta no está firmada.';
    case '42501':
      return 'Solo el médico tratante puede corregir esta consulta.';
    default:
      return e?.message || 'No se pudo guardar la corrección. Intentá de nuevo.';
  }
}
