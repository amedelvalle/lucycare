import { useState } from 'react';

interface CancelAppointmentModalProps {
  isOpen: boolean;
  patientName: string;
  isSubmitting: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

const MIN_REASON_LENGTH = 10;

export default function CancelAppointmentModal({
  isOpen,
  patientName,
  isSubmitting,
  onConfirm,
  onClose,
}: CancelAppointmentModalProps) {
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const isValid = reason.trim().length >= MIN_REASON_LENGTH;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(reason.trim());
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        {/* Header */}
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

        {/* Motivo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Motivo de cancelación
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Paciente no puede asistir por viaje de emergencia..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800
              focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none resize-none
              placeholder:text-gray-300"
          />
          <p className={`text-xs mt-1 ${reason.trim().length > 0 && !isValid ? 'text-red-500' : 'text-gray-400'}`}>
            Mínimo {MIN_REASON_LENGTH} caracteres ({reason.trim().length}/{MIN_REASON_LENGTH})
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
