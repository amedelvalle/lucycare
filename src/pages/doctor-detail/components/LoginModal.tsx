import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  sendOtp,
  verifyOtp,
  signInWithEmail,
  requestPasswordReset,
  destinationForRole,
} from '../../../services/auth.service';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Disparado después de OTP teléfono exitoso (continúa flujo del caller). */
  onSuccess: () => void;
}

type Tab = 'phone' | 'email';
type PhoneStep = 'phone' | 'otp';
type EmailStep = 'login' | 'forgot' | 'forgot_sent';

const formatSvPhone = (value: string): { rawDigits: string; displayValue: string } => {
  const digits = value.replace(/\D/g, '');
  const limited = digits.slice(0, 8);
  let formatted = limited;
  if (limited.length > 4) {
    formatted = `${limited.slice(0, 4)}-${limited.slice(4)}`;
  }
  return { rawDigits: limited, displayValue: formatted };
};

export default function LoginModal({ isOpen, onClose, onSuccess }: LoginModalProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('phone');

  // ─── Phone tab ───
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('phone');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [countryCode, setCountryCode] = useState('+503');
  const [otpCode, setOtpCode] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // ─── Email tab ───
  const [emailStep, setEmailStep] = useState<EmailStep>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailForReset, setEmailForReset] = useState('');

  // ─── Shared ───
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Cerrar con Escape (excepto durante loading). Cierre por click
  // fuera del modal está DESHABILITADO a propósito para no perder
  // contexto cuando el usuario tipea en mobile/desktop. El modal
  // solo se cierra por X, Escape, o éxito.
  //
  // IMPORTANTE: este hook debe declararse ANTES del early return
  // `if (!isOpen) return null` — si va después, React detecta orden
  // de hooks variable entre renders y rompe el árbol (pantalla
  // blanca). El listener internamente chequea isOpen y loading.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, loading, onClose]);

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
  const isEmailValid = email.includes('@') && email.length >= 5;
  const isPasswordValid = password.length >= 6;

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
        setPhoneStep('otp');
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

  const handleResendOtp = async () => {
    if (resendCountdown > 0) return;
    setError('');
    setLoading(true);
    try {
      const result = await sendOtp(fullPhone);
      if (result.success) startResendCountdown();
      else setError(result.error || 'Error al reenviar');
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isEmailValid || !isPasswordValid) return;
    setLoading(true);
    try {
      const result = await signInWithEmail(email, password);
      if (result.success && result.user) {
        // Redirect según rol: médico/asistente → /panel, admin → /admin.
        // Diferencia clave vs OTP teléfono: el email es flujo del médico,
        // no del paciente reservando una cita.
        onClose();
        resetState();
        navigate(destinationForRole(result.user.role));
      } else {
        setError(result.error || 'No pudimos iniciar sesión.');
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await requestPasswordReset(emailForReset);
      // Siempre mostramos el mismo mensaje, sea o no real el email.
      setEmailStep('forgot_sent');
    } catch {
      // Aun en error de red mostramos el mensaje genérico para no filtrar.
      setEmailStep('forgot_sent');
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setTab('phone');
    setPhoneStep('phone');
    setPhoneRaw('');
    setPhoneDisplay('');
    setOtpCode('');
    setEmailStep('login');
    setEmail('');
    setPassword('');
    setEmailForReset('');
    setError('');
    setPhoneError('');
    setResendCountdown(0);
  };

  const handleClose = () => {
    // Bloquea el cierre durante una operación en curso: evita que el
    // usuario pierda contexto si toca X o Esc mientras se procesa el
    // login. La X queda visible pero deshabilitada (gris) mientras
    // loading=true.
    if (loading) return;
    onClose();
    resetState();
  };

  const selectedCountry = countries.find((c) => c.code === countryCode) || countries[0];

  // Botón "atrás" muestra OTP → phone, forgot → email login, etc.
  const showBackButton =
    (tab === 'phone' && phoneStep === 'otp') ||
    (tab === 'email' && emailStep !== 'login');

  const handleBack = () => {
    if (loading) return;          // mismo guard que handleClose
    setError('');
    if (tab === 'phone' && phoneStep === 'otp') {
      setPhoneStep('phone');
      setOtpCode('');
    } else if (tab === 'email' && emailStep === 'forgot') {
      setEmailStep('login');
    } else if (tab === 'email' && emailStep === 'forgot_sent') {
      setEmailStep('login');
      setEmailForReset('');
    }
  };

  // Header dynamic title
  let headerTitle = 'Inicia sesión o regístrate';
  if (tab === 'phone' && phoneStep === 'otp') headerTitle = 'Confirma tu número';
  if (tab === 'email' && emailStep === 'forgot') headerTitle = 'Restablecer contraseña';
  if (tab === 'email' && emailStep === 'forgot_sent') headerTitle = 'Revisá tu correo';

  return (
    // El overlay NO cierra al click. El modal solo se cierra por X,
    // Escape o éxito de auth — evita pérdida de contexto al tocar
    // fuera mientras el usuario escribe (especialmente en mobile).
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <div
        className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between rounded-t-3xl z-10">
          <button
            onClick={showBackButton ? handleBack : handleClose}
            type="button"
            disabled={loading}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
              loading ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-100 cursor-pointer'
            }`}
            aria-label={showBackButton ? 'Atrás' : 'Cerrar'}
          >
            <i className={`${showBackButton ? 'ri-arrow-left-line' : 'ri-close-line'} text-xl text-gray-700`}></i>
          </button>
          <h2 className="text-base font-semibold text-gray-900">{headerTitle}</h2>
          <div className="w-8"></div>
        </div>

        {/* Tabs — solo visibles cuando el usuario aún no eligió OTP enviado o forgot flow */}
        {!showBackButton && (
          <div className="flex border-b border-gray-200 px-6 pt-4">
            <button
              type="button"
              onClick={() => {
                setTab('phone');
                setError('');
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                tab === 'phone'
                  ? 'border-emerald-700 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <i className="ri-phone-line mr-1"></i> Teléfono
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('email');
                setError('');
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                tab === 'email'
                  ? 'border-emerald-700 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <i className="ri-mail-line mr-1"></i> Email
            </button>
          </div>
        )}

        <div className="p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* ═══════════════════════ TAB PHONE ═══════════════════════ */}
          {tab === 'phone' && phoneStep === 'phone' && (
            <>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">¡Te damos la bienvenida a Lucy Care!</h3>
              <p className="text-sm text-gray-600 mb-6">Ingresá con tu teléfono para reservar citas.</p>

              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">País/Región</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors cursor-pointer text-left flex items-center justify-between"
                    >
                      <span className="text-gray-900">
                        {selectedCountry.flag} {selectedCountry.name} ({selectedCountry.code})
                      </span>
                      <i
                        className={`ri-arrow-down-s-line text-xl text-gray-400 transition-transform ${
                          showCountryDropdown ? 'rotate-180' : ''
                        }`}
                      ></i>
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
                            <span>
                              {country.name} ({country.code})
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Número telefónico</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={phoneDisplay}
                    onChange={handlePhoneChange}
                    onPaste={handlePhonePaste}
                    required
                    className={`w-full px-4 py-3 border rounded-lg focus:outline-none transition-colors text-gray-900 ${
                      phoneError ? 'border-red-500 focus:border-red-500' : 'border-gray-300 focus:border-gray-900'
                    }`}
                    placeholder="7777-7777"
                  />
                  {phoneError && (
                    <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                      <i className="ri-error-warning-line"></i> {phoneError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !isPhoneValid}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || !isPhoneValid
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                  }`}
                >
                  {loading ? 'Enviando código…' : 'Continuar'}
                </button>
              </form>
            </>
          )}

          {tab === 'phone' && phoneStep === 'otp' && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-message-2-line text-3xl text-emerald-700"></i>
                </div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-2">Ingresa el código</h3>
                <p className="text-sm text-gray-600">
                  Enviamos un código de 6 dígitos a{' '}
                  <span className="font-semibold text-gray-900">
                    {countryCode} {phoneDisplay}
                  </span>
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-600 transition-colors text-center text-2xl font-bold tracking-[0.5em] text-gray-900"
                  placeholder="000000"
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || otpCode.length !== 6
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                  }`}
                >
                  {loading ? 'Verificando…' : 'Verificar código'}
                </button>

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
                      className="text-sm text-emerald-700 font-semibold hover:underline cursor-pointer disabled:text-gray-400"
                    >
                      Reenviar código
                    </button>
                  )}
                </div>
              </form>
            </>
          )}

          {/* ═══════════════════════ TAB EMAIL ═══════════════════════ */}
          {tab === 'email' && emailStep === 'login' && (
            <>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Ingresá con tu email</h3>
              <p className="text-sm text-gray-600 mb-6">Para profesionales con cuenta en LucyCare.</p>

              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900"
                    placeholder="medico@ejemplo.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Contraseña</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900"
                    placeholder="••••••••"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !isEmailValid || !isPasswordValid}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || !isEmailValid || !isPasswordValid
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                  }`}
                >
                  {loading ? 'Ingresando…' : 'Ingresar'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEmailForReset(email);
                    setEmailStep('forgot');
                    setError('');
                  }}
                  className="block w-full text-center text-sm text-emerald-700 hover:underline cursor-pointer mt-2"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </form>
            </>
          )}

          {tab === 'email' && emailStep === 'forgot' && (
            <>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Restablecer contraseña</h3>
              <p className="text-sm text-gray-600 mb-6">
                Ingresá tu email y, si está registrado, te enviaremos un link para crear una nueva contraseña.
              </p>

              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={emailForReset}
                    onChange={(e) => setEmailForReset(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900"
                    placeholder="medico@ejemplo.com"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !emailForReset.includes('@')}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || !emailForReset.includes('@')
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                  }`}
                >
                  {loading ? 'Enviando…' : 'Enviar link de recuperación'}
                </button>
              </form>
            </>
          )}

          {tab === 'email' && emailStep === 'forgot_sent' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="ri-mail-check-line text-3xl text-emerald-700"></i>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Revisá tu correo</h3>
              <p className="text-sm text-gray-600 mb-6">
                Si el correo está registrado, vas a recibir instrucciones en los próximos minutos.
                <br />
                Si no aparece, revisá la carpeta de spam.
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
    </div>
  );
}
