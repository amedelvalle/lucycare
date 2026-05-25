import { useEffect, useState } from 'react';
import { submitWaitlistEntry, type WaitlistErrorCode } from '../../../services/waitlist.service';

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  doctorId: string;
  doctorName: string;
}

const ERROR_COPY: Record<WaitlistErrorCode, string> = {
  INVALID_NAME: 'Ingresá un nombre válido (entre 2 y 200 caracteres).',
  INVALID_PHONE: 'El teléfono debe tener 8 dígitos.',
  MESSAGE_TOO_LONG: 'El comentario no puede superar 500 caracteres.',
  DOCTOR_NOT_AVAILABLE: 'Este médico no está disponible para lista de espera.',
  UNKNOWN: 'No pudimos enviar tu solicitud. Intentá de nuevo en un momento.',
};

const MAX_MESSAGE_LEN = 500;

const formatSvPhone = (value: string): { rawDigits: string; displayValue: string } => {
  const digits = value.replace(/\D/g, '');
  const limited = digits.slice(0, 8);
  let formatted = limited;
  if (limited.length > 4) formatted = `${limited.slice(0, 4)}-${limited.slice(4)}`;
  return { rawDigits: limited, displayValue: formatted };
};

export default function WaitlistModal({ isOpen, onClose, doctorId, doctorName }: WaitlistModalProps) {
  const [name, setName] = useState('');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [message, setMessage] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Cerrar con Escape (excepto durante loading). Click outside está
  // DESHABILITADO a propósito para no perder contexto. Hook declarado
  // antes del early return para mantener orden estable de hooks.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const isPhoneValid = phoneRaw.length === 8;
  const isNameValid = name.trim().length >= 2;
  const isMessageValid = message.length <= MAX_MESSAGE_LEN;
  const canSubmit = isPhoneValid && isNameValid && isMessageValid && !loading;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { rawDigits, displayValue } = formatSvPhone(e.target.value);
    setPhoneRaw(rawDigits);
    setPhoneDisplay(displayValue);
    setPhoneError(rawDigits.length > 0 && rawDigits.length < 8 ? 'El teléfono debe tener 8 dígitos' : '');
  };

  const handlePhonePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const { rawDigits, displayValue } = formatSvPhone(e.clipboardData.getData('text'));
    setPhoneRaw(rawDigits);
    setPhoneDisplay(displayValue);
    setPhoneError(rawDigits.length > 0 && rawDigits.length < 8 ? 'El teléfono debe tener 8 dígitos' : '');
  };

  const resetForm = () => {
    setName('');
    setPhoneRaw('');
    setPhoneDisplay('');
    setMessage('');
    setPhoneError('');
    setError('');
    setSubmitted(false);
  };

  const handleClose = () => {
    if (loading) return;
    onClose();
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      const result = await submitWaitlistEntry({
        doctorId,
        patientName: name,
        patientPhone: phoneRaw, // 8 dígitos, el RPC prefija 503
        patientMessage: message.trim() || undefined,
      });
      if (result.success) {
        // Mensaje genérico tanto si fue alta nueva como si ya estaba
        setSubmitted(true);
      } else {
        const code = result.errorCode ?? 'UNKNOWN';
        setError(ERROR_COPY[code]);
      }
    } catch {
      setError(ERROR_COPY.UNKNOWN);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {!submitted ? (
          <>
            <div className="flex items-start justify-between mb-4">
              <div className="pr-4">
                <h3 className="text-xl font-semibold text-gray-900 mb-1">Lista de espera</h3>
                <p className="text-sm text-gray-600">
                  Avisaremos a {doctorName} de tu interés y te contactaremos cuando habilite agenda en línea.
                </p>
              </div>
              <button
                onClick={handleClose}
                type="button"
                disabled={loading}
                className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
                  loading ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100 cursor-pointer'
                }`}
                aria-label="Cerrar"
              >
                <i className="ri-close-line text-xl text-gray-700"></i>
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre completo</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={200}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-600 focus:border-transparent text-sm"
                  placeholder="Tu nombre"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono (El Salvador)</label>
                <div className="flex gap-2">
                  <div className="flex items-center px-3 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 text-sm font-medium">
                    🇸🇻 +503
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={phoneDisplay}
                    onChange={handlePhoneChange}
                    onPaste={handlePhonePaste}
                    required
                    className={`flex-1 px-4 py-3 border rounded-lg focus:outline-none transition-colors text-gray-900 text-sm ${
                      phoneError
                        ? 'border-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:border-emerald-600'
                    }`}
                    placeholder="7777-7777"
                  />
                </div>
                {phoneError && (
                  <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                    <i className="ri-error-warning-line"></i> {phoneError}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Comentario o preferencia <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LEN))}
                  rows={3}
                  maxLength={MAX_MESSAGE_LEN}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-600 focus:border-transparent text-sm resize-none"
                  placeholder="Preferencia de horario, motivo de consulta, etc."
                />
                <p className="text-xs text-gray-400 mt-1 text-right">
                  {message.length}/{MAX_MESSAGE_LEN}
                </p>
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap font-medium"
              >
                {loading ? 'Enviando…' : 'Avisarme cuando tenga agenda disponible'}
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-start gap-2 text-xs text-gray-500">
                <i className="ri-information-line text-sm flex-shrink-0 mt-0.5"></i>
                <p>Te contactaremos por teléfono o WhatsApp cuando este médico habilite agenda en línea.</p>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-check-line text-3xl text-emerald-700"></i>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">¡Listo!</h3>
            <p className="text-sm text-gray-600 mb-6">
              Te avisaremos cuando este médico habilite su agenda en línea.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-2.5 bg-emerald-700 text-white rounded-lg font-medium hover:bg-emerald-800 cursor-pointer"
            >
              Entendido
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
