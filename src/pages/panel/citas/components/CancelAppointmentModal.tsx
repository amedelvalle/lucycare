import { useEffect, useMemo, useState } from 'react';
import { useCancelReasons } from '@/hooks/appointments.hooks';

export interface CancelInfo {
  cancelReasonId: string;
  internalNotes: string;
}

interface CancelAppointmentModalProps {
  isOpen: boolean;
  patientName: string;
  isSubmitting: boolean;
  onConfirm: (info: CancelInfo) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  paciente: 'Decisión del paciente',
  medico: 'Lado del médico',
  sistema: 'Sistema',
};

export default function CancelAppointmentModal({
  isOpen,
  patientName,
  isSubmitting,
  onConfirm,
  onClose,
}: CancelAppointmentModalProps) {
  const [cancelReasonId, setCancelReasonId] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const { data: reasons = [], isLoading } = useCancelReasons();

  // Reset al abrir
  useEffect(() => {
    if (isOpen) {
      setCancelReasonId('');
      setInternalNotes('');
    }
  }, [isOpen]);

  // Agrupar razones por categoría para los optgroups
  const grouped = useMemo(() => {
    const map = new Map<string, typeof reasons>();
    for (const r of reasons) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return map;
  }, [reasons]);

  if (!isOpen) return null;

  const isValid = cancelReasonId.length > 0;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm({ cancelReasonId, internalNotes: internalNotes.trim() });
  };

  const handleClose = () => {
    setCancelReasonId('');
    setInternalNotes('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Cancelar cita</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Cita de <span className="font-medium text-gray-700">{patientName}</span>
            </p>
          </div>
        </div>

        {/* Razón */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Razón de cancelación
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <select
            value={cancelReasonId}
            onChange={(e) => setCancelReasonId(e.target.value)}
            disabled={isLoading || isSubmitting}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800
              focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none
              disabled:bg-gray-50 disabled:cursor-not-allowed cursor-pointer bg-white"
          >
            <option value="">Selecciona una razón...</option>
            {Array.from(grouped.entries()).map(([category, items]) => (
              <optgroup key={category} label={CATEGORY_LABELS[category] ?? category}>
                {items.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Notas internas (opcional) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Detalle adicional <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea
            rows={3}
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="Ej: Llamó por teléfono, reprogramará la próxima semana"
            disabled={isSubmitting}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800
              focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none resize-none
              placeholder:text-gray-300 disabled:bg-gray-50"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Nota interna — no visible para el paciente
          </p>
        </div>

        {/* Acciones */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
              hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isValid || isSubmitting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600
              hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Cancelando...
              </span>
            ) : (
              'Confirmar cancelación'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
