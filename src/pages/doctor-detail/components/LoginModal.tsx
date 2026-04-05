import { useState } from 'react';
import { sendOtp, verifyOtp } from '../../../services/auth.service';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Función para formatear teléfono de El Salvador (####-####)
const formatSvPhone = (value: string): { rawDigits: string; displayValue: string } => {
  const digits = value.replace(/\D/g, '');
  const limited = digits.slice(0, 8);

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
  // Paso 1: teléfono, Paso 2: código OTP
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [countryCode, setCountryCode] = useState('+503');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  if (!isOpen) return null;

  const countries = [
    { code: '+503', name: 'El Salvador', flag: '🇸🇻' },
    { code: '+52', name: 'México', flag: '🇲🇽' },
    { code: '+1', name: 'Estados Unidos', flag: '🇺🇸' },
    { code: '+502', name: 'Guatemala', flag: '🇬🇹' },
    { code: '+504', name: 'Honduras', flag: '🇭🇳' },
  ];

  const fullPhone = `${countryCode}${phoneRaw}`;
  const isPhoneValid = phoneRaw.length === 8;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const { rawDigits, displayValue } = formatSvPhone(value);
    setPhoneRaw(rawDigits);
    setPhoneDisplay(displayValue);
    setPhoneError(rawDigits.length > 0 && rawDigits.length < 8 ? 'El teléfono debe tener 8 dígitos' : '');
  };

  const handlePhonePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const { rawDigits, displayValue } = formatSvPhone(pastedText);
    setPhoneRaw(rawDigits);
    setPhoneDisplay(displayValue);
    setPhoneError(rawDigits.length > 0 && rawDigits.length < 8 ? 'El teléfono debe tener 8 dígitos' : '');
  };

  // Paso 1: Enviar OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isPhoneValid) {
      setPhoneError('El teléfono debe tener 8 dígitos');
      return;
    }

    setLoading(true);
    try {
      const result = await sendOtp(fullPhone);
      if (result.success) {
        setStep('otp');
        startResendCountdown();
      } else {
        setError(result.error || 'Error al enviar el código');
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // Paso 2: Verificar OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (otpCode.length !== 6) {
      setError('El código debe tener 6 dígitos');
      return;
    }

    setLoading(true);
    try {
      const result = await verifyOtp(fullPhone, otpCode);
      if (result.success) {
        onSuccess();
        // Resetear estado al cerrar
        resetState();
      } else {
        setError(result.error || 'Código incorrecto');
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // Reenviar código
  const handleResendOtp = async () => {
    if (resendCountdown > 0) return;
    setError('');
    setLoading(true);

    try {
      const result = await sendOtp(fullPhone);
      if (result.success) {
        startResendCountdown();
        setError('');
      } else {
        setError(result.error || 'Error al reenviar');
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const startResendCountdown = () => {
    setResendCountdown(60);
    const interval = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const resetState = () => {
    setStep('phone');
    setPhoneRaw('');
    setPhoneDisplay('');
    setOtpCode('');
    setError('');
    setPhoneError('');
    setResendCountdown(0);
  };

  const handleBack = () => {
    setStep('phone');
    setOtpCode('');
    setError('');
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
      resetState();
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
            onClick={step === 'otp' ? handleBack : () => { onClose(); resetState(); }}
            type="button"
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <i className={`${step === 'otp' ? 'ri-arrow-left-line' : 'ri-close-line'} text-xl text-gray-700`}></i>
          </button>
          <h2 className="text-base font-semibold text-gray-900">
            {step === 'phone' ? 'Inicia sesión o regístrate' : 'Confirma tu número'}
          </h2>
          <div className="w-8"></div>
        </div>

        {/* Content */}
        <div className="p-8">
          {/* ───── PASO 1: TELÉFONO ───── */}
          {step === 'phone' && (
            <>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                ¡Te damos la bienvenida a Lucy Care!
              </h3>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <form onSubmit={handleSendOtp} className="space-y-4 mt-6">
                {/* Country Selector */}
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

                {/* Phone Number */}
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
                  {!phoneError && phoneRaw.length === 8 && (
                    <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1">
                      <i className="ri-check-line"></i>
                      Teléfono válido
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    Te enviaremos un código de verificación por SMS.{' '}
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
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Enviando código...
                    </span>
                  ) : 'Continuar'}
                </button>
              </form>
            </>
          )}

          {/* ───── PASO 2: CÓDIGO OTP ───── */}
          {step === 'otp' && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-message-2-line text-3xl text-emerald-700"></i>
                </div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                  Ingresa el código
                </h3>
                <p className="text-sm text-gray-600">
                  Enviamos un código de 6 dígitos a{' '}
                  <span className="font-semibold text-gray-900">
                    {countryCode} {phoneDisplay}
                  </span>
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {/* OTP Input */}
                <div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:outline-none focus:border-[#3C2285] transition-colors text-center text-2xl font-bold tracking-[0.5em] text-gray-900"
                    placeholder="000000"
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || otpCode.length !== 6
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-[#3C2285] text-white hover:bg-[#2d1a64] cursor-pointer'
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Verificando...
                    </span>
                  ) : 'Verificar código'}
                </button>

                {/* Reenviar código */}
                <div className="text-center">
                  {resendCountdown > 0 ? (
                    <p className="text-sm text-gray-500">
                      Reenviar código en <span className="font-semibold">{resendCountdown}s</span>
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={loading}
                      className="text-sm text-[#3C2285] font-semibold hover:underline cursor-pointer disabled:text-gray-400"
                    >
                      Reenviar código
                    </button>
                  )}
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
