/**
 * Modal de cancelación de cita — lado PACIENTE (CANCELACIÓN-PACIENTE-P0).
 *
 * Consume EXCLUSIVAMENTE la RPC `cancel_my_appointment` (s7_70). El UPDATE
 * directo sobre `appointments` está cerrado para el paciente desde esa misma
 * migración: no hay una segunda vía ni fallback.
 *
 * Motivo y detalle son OPCIONALES: el motivo nunca impide cancelar ni obliga a
 * elegir una categoría que no corresponde.
 *
 * Modal sensible: NO cierra al click fuera. Solo por "Volver", Escape (fuera de
 * envío) o éxito.
 */

import { useEffect, useState } from 'react';
import {
  cancelMyAppointment,
  CancelAppointmentError,
  CANCEL_REASONS,
  CANCEL_NOTE_MAX,
  type CancelReasonValue,
  type PatientAppointmentEntry,
} from '@/services/patientHistory.service';

interface Props {
  appointment: PatientAppointmentEntry;
  onClose: () => void;
  /** Se dispara tras un desenlace terminal para refrescar "Mis atenciones". */
  onCancelled: () => void;
}

function formatWhen(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('es-SV', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      }),
      time: d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }),
    };
  } catch {
    return { date: iso, time: '' };
  }
}

export default function CancelAppointmentPatientModal({
  appointment,
  onClose,
  onCancelled,
}: Props) {
  const [reason, setReason] = useState<CancelReasonValue | ''>('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | { title: string; detail: string }>(null);

  // Escape cierra, salvo mientras la RPC está en vuelo. El listener se declara
  // antes de cualquier return condicional (orden de hooks estable).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onClose]);

  const { date, time } = formatWhen(appointment.startTime);
  const noteTooLong = note.trim().length > CANCEL_NOTE_MAX;

  const handleConfirm = async () => {
    // Guard de doble envío: mientras `loading` esté activo no se reenvía.
    if (loading || noteTooLong) return;
    setError('');
    setLoading(true);
    try {
      const res = await cancelMyAppointment(
        appointment.id,
        reason || null,
        note,
      );
      if (res.outcome === 'already_cancelled_by_other') {
        // Terminal, pero NO se atribuye al paciente: la canceló otro actor.
        setDone({
          title: 'Esta cita ya estaba cancelada',
          detail: 'La cancelación no fue registrada a tu nombre. Ya no aparece como activa.',
        });
      } else if (res.outcome === 'already_cancelled_by_patient') {
        setDone({
          title: 'Tu cita fue cancelada',
          detail: 'Ya habías cancelado esta cita.',
        });
      } else {
        setDone({
          title: 'Tu cita fue cancelada',
          detail: 'El horario quedó libre. La cita se conserva en tu historial.',
        });
      }
      onCancelled();
    } catch (err) {
      setError(
        err instanceof CancelAppointmentError
          ? err.message
          : 'No pudimos cancelar tu cita. Inténtalo de nuevo en un momento.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-appt-title"
      >
        {done ? (
          <>
            <div className="w-14 h-14 bg-brand-mint/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-check-line text-3xl text-brand-purple" aria-hidden="true" />
            </div>
            <h3 id="cancel-appt-title" className="text-lg font-semibold text-gray-900 text-center mb-2">
              {done.title}
            </h3>
            <p className="text-sm text-gray-600 text-center">{done.detail}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full px-4 py-2.5 bg-brand-purple text-white rounded-lg font-medium hover:bg-brand-purple-dark cursor-pointer"
            >
              Entendido
            </button>
          </>
        ) : (
          <>
            <h3 id="cancel-appt-title" className="text-lg font-semibold text-gray-900 mb-1">
              Cancelar cita
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Vas a cancelar esta cita. El horario quedará libre para otra persona.
            </p>

            <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-1 text-sm">
              <p>
                <span className="text-gray-500">Médico:</span>{' '}
                <span className="font-medium text-gray-900">{appointment.doctorName}</span>
              </p>
              <p>
                <span className="text-gray-500">Fecha:</span>{' '}
                <span className="text-gray-900 capitalize">{date}</span>
              </p>
              <p>
                <span className="text-gray-500">Hora:</span>{' '}
                <span className="text-gray-900">{time}</span>
              </p>
            </div>

            <label htmlFor="cancel-reason" className="block text-sm font-medium text-gray-700 mb-1.5">
              Motivo <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <select
              id="cancel-reason"
              value={reason}
              disabled={loading}
              onChange={(e) => setReason(e.target.value as CancelReasonValue | '')}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800
                focus:ring-2 focus:ring-brand-mint focus:border-brand-purple outline-none
                disabled:bg-gray-50 cursor-pointer mb-4"
            >
              <option value="">Prefiero no decirlo</option>
              {CANCEL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            <label htmlFor="cancel-note" className="block text-sm font-medium text-gray-700 mb-1.5">
              Detalle <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <textarea
              id="cancel-note"
              rows={3}
              value={note}
              disabled={loading}
              maxLength={CANCEL_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Si quieres, cuéntale algo al médico"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 text-gray-800
                focus:ring-2 focus:ring-brand-mint focus:border-brand-purple outline-none resize-none
                placeholder:text-gray-300 disabled:bg-gray-50"
            />
            <p className={`text-[11px] mt-1 ${noteTooLong ? 'text-red-600' : 'text-gray-400'}`}>
              {note.trim().length}/{CANCEL_NOTE_MAX}
            </p>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mt-3">
                <i className="ri-error-warning-line text-red-500 flex-shrink-0" aria-hidden="true" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-5">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
                  hover:bg-gray-200 rounded-xl disabled:opacity-50 cursor-pointer"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loading || noteTooLong}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-brand-purple
                  hover:bg-brand-purple-dark rounded-xl disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Cancelando…' : 'Sí, cancelar cita'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
