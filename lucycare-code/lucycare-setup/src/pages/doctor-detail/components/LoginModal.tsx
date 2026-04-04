import { useState } from 'react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
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

export default function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phoneRaw, setPhoneRaw] = useState(''); // Solo dígitos
  const [phoneDisplay, setPhoneDisplay] = useState(''); // Con formato
  const [countryCode, setCountryCode] = useState('+503');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);

  // Gating obligatorio
  if (!isOpen) return null;

  const countries = [
    { code: '+503', name: 'El Salvador', flag: '🇸🇻' },
    { code: '+52', name: 'México', flag: '🇲🇽' },
    { code: '+1', name: 'Estados Unidos', flag: '🇺🇸' },
    { code: '+502', name: 'Guatemala', flag: '🇬🇹' },
    { code: '+504', name: 'Honduras', flag: '🇭🇳' },
  ];

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
    setError('');
    
    // Validación final
    if (!isPhoneValid) {
      setPhoneError('El teléfono debe tener 8 dígitos');
      return;
    }

    setLoading(true);

    try {
      // Aquí se integrará con Supabase cuando esté conectado
      // Por ahora, simulamos el login
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Guardar usuario en localStorage con teléfono completo
      const fullPhone = `${countryCode}${phoneRaw}`; // Ejemplo: +50377777777
      localStorage.setItem('user', JSON.stringify({ 
        email, 
        name: name || email, 
        phone: fullPhone,
        phoneDisplay: `${countryCode} ${phoneDisplay}` // Para mostrar: +503 7777-7777
      }));
      
      onSuccess();
    } catch (err) {
      setError('Error al iniciar sesión. Por favor, intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    // Solo cerrar si se hace click en el overlay, no en el contenido
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const selectedCountry = countries.find(c => c.code === countryCode) || countries[0];

  return (
    <div 
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <div 
        className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between rounded-t-3xl">
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
          <h2 className="text-base font-semibold text-gray-900">
            Inicia sesión o regístrate
          </h2>
          <div className="w-8"></div>
        </div>

        {/* Content */}
        <div className="p-8">
          <h3 className="text-2xl font-semibold text-gray-900 mb-2">
            ¡Te damos la bienvenida a Lucy Care! 
          </h3>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            {/* Country/Region Selector */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                País/Región
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors cursor-pointer text-left flex items-center justify-between"
                >
                  <span className="text-gray-900">
                    {selectedCountry.flag} {selectedCountry.name} ({selectedCountry.code})
                  </span>
                  <i className={`ri-arrow-down-s-line text-xl text-gray-400 transition-transform ${showCountryDropdown ? 'rotate-180' : ''}`}></i>
                </button>
                
                {showCountryDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 max-h-60 overflow-y-auto z-50">
                    {countries.map((country) => (
                      <button
                        key={country.code}
                        type="button"
                        onClick={() => {
                          setCountryCode(country.code);
                          setShowCountryDropdown(false);
                        }}
                        className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors flex items-center gap-2"
                      >
                        <span>{country.flag}</span>
                        <span>{country.name} ({country.code})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Phone Number con máscara */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">
                Número telefónico
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={phoneDisplay}
                onChange={handlePhoneChange}
                onPaste={handlePhonePaste}
                required
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none transition-colors text-gray-900 ${
                  phoneError 
                    ? 'border-red-500 focus:border-red-500' 
                    : 'border-gray-300 focus:border-gray-900'
                }`}
                placeholder="7777-7777"
              />
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
              <p className="text-xs text-gray-500 mt-2">
                Te vamos a confirmar el número por teléfono o mensaje de texto. Sujeto a tarifas estándar para mensajes y datos.{' '}
                <a href="#" className="underline cursor-pointer hover:text-gray-900">
                  Política de privacidad
                </a>
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !isPhoneValid}
              className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                loading || !isPhoneValid
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-[#3C2285] text-white hover:bg-[#2d1a64] cursor-pointer'
              }`}
            >
              {loading ? 'Procesando...' : 'Continuar'}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-gray-500">o</span>
            </div>
          </div>

          {/* Social Login */}
          <div className="space-y-3">
            <button 
              type="button"
              className="w-full py-3.5 border border-gray-900 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-3 font-medium"
            >
              <i className="ri-google-fill text-xl"></i>
              <span>Continuar con Google</span>
            </button>
            <button 
              type="button"
              className="w-full py-3.5 border border-gray-900 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-3 font-medium"
            >
              <i className="ri-apple-fill text-xl"></i>
              <span>Continuar con Apple</span>
            </button>
            <button 
              type="button"
              className="w-full py-3.5 border border-gray-900 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-3 font-medium"
            >
              <i className="ri-mail-line text-xl"></i>
              <span>Continuar con un correo electrónico</span>
            </button>
            <button 
              type="button"
              className="w-full py-3.5 border border-gray-900 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-3 font-medium"
            >
              <i className="ri-facebook-fill text-xl"></i>
              <span>Continuar con Facebook</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
