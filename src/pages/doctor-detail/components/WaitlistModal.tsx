import { useState } from 'react';

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  doctorName: string;
}

// Función para formatear teléfono de El Salvador (####-####)
const formatSvPhone = (value: string): { rawDigits: string; displayValue: string } => {
  // Remover todo excepto dígitos
  const digits = value.replace(/\D/g, '');
  
  // Limitar a 8 dígitos
  const limited = digits.slice(0, 8);
  
  // Aplicar formato ####-####
  let formatted = limited;
  if (limited.length > 4) {
    formatted = `${limited.slice(0, 4)}-${limited.slice(4)}`;
  }
  
  return {
    rawDigits: limited,
    displayValue: formatted
  };
};

export default function WaitlistModal({ isOpen, onClose, doctorName }: WaitlistModalProps) {
  const [name, setName] = useState('');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen) return null;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const { rawDigits, displayValue } = formatSvPhone(value);
    
    setPhoneRaw(rawDigits);
    setPhoneDisplay(displayValue);
    
    // Validar en tiempo real
    if (rawDigits.length > 0 && rawDigits.length < 8) {
      setPhoneError('El teléfono debe tener 8 dígitos');
    } else {
      setPhoneError('');
    }
  };

  const handlePhonePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const { rawDigits, displayValue } = formatSvPhone(pastedText);
    
    setPhoneRaw(rawDigits);
    setPhoneDisplay(displayValue);
    
    // Validar
    if (rawDigits.length > 0 && rawDigits.length < 8) {
      setPhoneError('El teléfono debe tener 8 dígitos');
    } else {
      setPhoneError('');
    }
  };

  const isPhoneValid = phoneRaw.length === 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      return;
    }

    if (!isPhoneValid) {
      setPhoneError('El teléfono debe tener 8 dígitos');
      return;
    }

    setLoading(true);

    try {
      // Aquí se integrará con Supabase cuando esté conectado
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Guardar en lista de espera con teléfono completo
      const fullPhone = `+503${phoneRaw}`;
      console.log('Waitlist submission:', { name, phone: fullPhone, doctor: doctorName });
      
      setSubmitted(true);
      
      // Cerrar después de 2 segundos
      setTimeout(() => {
        onClose();
        setSubmitted(false);
        setName('');
        setPhoneRaw('');
        setPhoneDisplay('');
        setPhoneError('');
      }, 2000);
    } catch (err) {
      console.error('Error submitting to waitlist:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <div 
        className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!submitted ? (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1">
                  Lista de espera
                </h3>
                <p className="text-sm text-gray-600">
                  Te notificaremos cuando {doctorName} tenga disponibilidad
                </p>
              </div>
              <button
                onClick={onClose}
                type="button"
                className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer flex-shrink-0"
              >
                <i className="ri-close-line text-xl text-gray-700"></i>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nombre completo
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-600 focus:border-transparent text-sm"
                  placeholder="Tu nombre"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Teléfono (El Salvador)
                </label>
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
                    <i className="ri-error-warning-line"></i>
                    {phoneError}
                  </p>
                )}
                {!phoneError && phoneRaw.length > 0 && (
                  <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1">
                    <i className="ri-check-line"></i>
                    Teléfono válido
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !name.trim() || !isPhoneValid}
                className="w-full px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap font-medium"
              >
                {loading ? 'Enviando...' : 'Unirme a la lista'}
              </button>
            </form>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-start gap-2 text-xs text-gray-500">
                <i className="ri-information-line text-sm flex-shrink-0 mt-0.5"></i>
                <p>
                  Te contactaremos por WhatsApp cuando haya nuevos horarios disponibles
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-check-line text-3xl text-emerald-700"></i>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              ¡Listo!
            </h3>
            <p className="text-sm text-gray-600">
              Te notificaremos cuando haya disponibilidad
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
