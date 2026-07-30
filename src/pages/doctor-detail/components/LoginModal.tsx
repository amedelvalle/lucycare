import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  sendOtp,
  verifyOtpForPasswordSetup,
  signInWithEmail,
  signInWithPhonePassword,
  setPasswordFromClaim,
  requestPasswordReset,
  destinationForRole,
} from '../../../services/auth.service';
import { MIN_PASSWORD_LENGTH, PASSWORD_MIN_HINT } from '../../../lib/password';
import { CAPTCHA_ENABLED, captchaRequired, captchaMisconfigured } from '../../../lib/authFlags';
import TurnstileWidget, { type TurnstileHandle } from '../../../components/TurnstileWidget';
import OtpConsentNotice from '../../../components/OtpConsentNotice';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Disparado después de completar el acceso por TELÉFONO (teléfono+contraseña,
   * o código + creación de contraseña). En 'booking' entrega el `intentId`
   * registrado en `onBeforeSendOtp` cuando el acceso fue por código (o
   * `undefined` cuando fue por teléfono+contraseña — el caller registra el
   * intent al continuar). Retrocompatible con `() => void`.
   */
  onSuccess: (intentId?: string) => void;
  /**
   * AUTH-P1B1B (solo 'booking'): registra la intención de reserva ANTES de
   * enviar el OTP, con el mismo `fullPhone` al que se enviará el código. Si
   * devuelve `{ ok: false }` se muestra el error y NO se envía OTP; si
   * `{ ok: true }` el `intentId` se guarda en un ref y se entrega a `onSuccess`
   * tras completar la contraseña. Opcional: quien no lo pasa conserva el flujo.
   */
  onBeforeSendOtp?: (fullPhone: string) => Promise<{ ok: boolean; intentId?: string; error?: string }>;
  /**
   * AUTH-P1A — contexto OBLIGATORIO del OTP (sin default: cada mount declara
   * su intención o el build falla). 'login' = ingreso genérico (header/Home);
   * 'booking' = autenticación dentro de la reserva. Es clasificación funcional,
   * no autorización server-side (ver OtpContext en auth.service). Gobierna el
   * `shouldCreateUser` del código: 'login' → false (nunca crea), 'booking' →
   * true (creación autorizada por booking_intent).
   */
  context: 'login' | 'booking';
}

type Tab = 'phone' | 'email';
// AUTH-P1C1 — tab Teléfono:
//   'credentials'  = acceso principal: teléfono + contraseña.
//   'otp'          = secundario "Usar un código": verificación por OTP.
//   'set_password' = paso OBLIGATORIO tras el OTP: crear/restablecer contraseña.
type PhoneStep = 'credentials' | 'otp' | 'set_password';
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

export default function LoginModal({ isOpen, onClose, onSuccess, onBeforeSendOtp, context }: LoginModalProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('phone');
  // AUTH-P1B1B: intentId devuelto por onBeforeSendOtp. Ref SÍNCRONO (no setState
  // async) para entregarlo a onSuccess tras completar la contraseña. Sin persistencia.
  const intentIdRef = useRef<string | null>(null);
  // AUTH-P1C1: token de la sesión OTP capturado tras verificar, para setear la
  // contraseña vía fetch (patrón de ClaimProfileModal). Solo en memoria.
  const sessionTokenRef = useRef<{ accessToken: string; userId: string } | null>(null);
  // AUTH-P1D2: token de Turnstile (solo en memoria). El widget solo se monta si
  // CAPTCHA_ENABLED; con el flag apagado, captchaToken queda null y las llamadas
  // pasan sin token (comportamiento actual).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle | null>(null);

  // ─── Phone tab ───
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('credentials');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [countryCode, setCountryCode] = useState('+503');
  const [loginPassword, setLoginPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
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

  // Cerrar con Escape (excepto durante loading y durante el paso OBLIGATORIO de
  // contraseña). El cierre por click fuera del modal está DESHABILITADO a
  // propósito. El modal solo se cierra por X, Escape, o éxito.
  //
  // IMPORTANTE: este hook debe declararse ANTES del early return
  // `if (!isOpen) return null` — si va después, React detecta orden de hooks
  // variable entre renders y rompe el árbol (pantalla blanca).
  const isMandatoryStep = tab === 'phone' && phoneStep === 'set_password';
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading && !isMandatoryStep) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, loading, isMandatoryStep, onClose]);

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
  const isLoginPasswordValid = loginPassword.length > 0;
  const isEmailValid = email.includes('@') && email.length >= 5;
  const isPasswordValid = password.length >= 6;
  const newPasswordMismatch =
    newPassword.length > 0 && newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm;
  const canSetNewPassword =
    newPassword.length >= MIN_PASSWORD_LENGTH && newPassword === newPasswordConfirm && !loading;

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

  // AUTH-P1D2: reset del captcha tras CADA intento (token de un solo uso) y
  // guard que BLOQUEA el envío si el captcha es requerido y no hay token, o si
  // está habilitado pero mal configurado (FAIL-CLOSED).
  const resetCaptcha = () => {
    setCaptchaToken(null);
    turnstileRef.current?.reset();
  };
  const captchaBlock = (): string | null => {
    if (!captchaRequired()) return null;
    if (captchaMisconfigured()) return 'La verificación de seguridad no está disponible ahora. Intenta más tarde.';
    if (!captchaToken) return 'Completa la verificación de seguridad para continuar.';
    return null;
  };
  const captchaWidget = CAPTCHA_ENABLED ? (
    <div className="pt-1">
      <TurnstileWidget
        ref={turnstileRef}
        onToken={setCaptchaToken}
        onExpire={() => setCaptchaToken(null)}
        onError={() => setCaptchaToken(null)}
      />
    </div>
  ) : null;

  // ─── Acceso PRINCIPAL: teléfono + contraseña ───
  const handlePhonePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isPhoneValid) {
      setPhoneError('El teléfono debe tener 8 dígitos');
      return;
    }
    if (!isLoginPasswordValid || loading) return;
    const cb = captchaBlock();
    if (cb) { setError(cb); return; }
    setLoading(true);
    try {
      const result = await signInWithPhonePassword(fullPhone, loginPassword, captchaToken ?? undefined);
      if (result.success && result.user) {
        if (context === 'booking') {
          // El BookingCard continúa la reserva (registra el intent y reserva).
          onSuccess(undefined);
        } else {
          onClose();
          navigate(destinationForRole(result.user.role));
        }
        resetState();
      } else {
        // Mensaje GENÉRICO (no revela si el teléfono existe).
        setError(result.error || 'El teléfono o la contraseña no son correctos.');
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  // ─── Acción SECUNDARIA "Usar un código": envía OTP ───
  // 'login'  → shouldCreateUser=false (nunca crea; un teléfono sin cuenta recibe
  //            el mensaje guía y no se revela explícitamente que no existe).
  // 'booking'→ registra el intent (onBeforeSendOtp) y luego shouldCreateUser=true.
  const handleUseCode = async () => {
    setError('');
    if (!isPhoneValid) {
      setPhoneError('El teléfono debe tener 8 dígitos');
      return;
    }
    if (loading) return;
    // AUTH-P1D2: Turnstile válido ANTES de registrar el intent y enviar.
    const cb = captchaBlock();
    if (cb) { setError(cb); return; }
    setLoading(true);
    try {
      if (onBeforeSendOtp) {
        const pre = await onBeforeSendOtp(fullPhone);
        if (!pre.ok) {
          setError(pre.error || 'No pudimos preparar la reserva. Inténtalo de nuevo.');
          return;
        }
        intentIdRef.current = pre.intentId ?? null;
      }
      const result = await sendOtp(fullPhone, context, { captchaToken: captchaToken ?? undefined });
      if (result.success) {
        setOtpCode('');
        setPhoneStep('otp');
        startResendCountdown();
      } else {
        setError(result.error || 'Error al enviar el código');
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (otpCode.length !== 6 || loading) {
      if (otpCode.length !== 6) setError('El código debe tener 6 dígitos');
      return;
    }
    setLoading(true);
    try {
      // AUTH-P1C1: verificación con cliente TRANSITORIO (no persiste sesión en
      // el cliente principal, no corre side-effects). El token queda SOLO en
      // memoria para setear la contraseña; el acceso real se hace después con
      // signInWithPhonePassword.
      const result = await verifyOtpForPasswordSetup(fullPhone, otpCode);
      if (result.success && result.accessToken && result.userId) {
        sessionTokenRef.current = { accessToken: result.accessToken, userId: result.userId };
        setNewPassword('');
        setNewPasswordConfirm('');
        setPhoneStep('set_password');
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
    if (resendCountdown > 0 || loading) return;
    setError('');
    // AUTH-P1D2: el reenvío es un envío NUEVO → exige token fresco de Turnstile.
    const cb = captchaBlock();
    if (cb) { setError(cb); return; }
    setLoading(true);
    try {
      const result = await sendOtp(fullPhone, context, { captchaToken: captchaToken ?? undefined });
      if (result.success) startResendCountdown();
      else setError(result.error || 'Error al reenviar');
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  // ─── Paso OBLIGATORIO: crear/restablecer contraseña tras el OTP ───
  // Secuencia (AUTH-P1C1): (1) guardar la contraseña con el token TRANSITORIO;
  // (2) login REAL en el cliente principal con signInWithPhonePassword (recién
  // aquí se crea la sesión persistente + corren los side-effects); (3) completar
  // login/booking. Si falla el guardado o el login, NO se completa el acceso ni
  // la reserva y el cliente principal no queda con sesión de este flujo.
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!canSetNewPassword) return;
    const tok = sessionTokenRef.current;
    if (!tok) {
      setError('No pudimos confirmar tu sesión. Refresca la página y vuelve a intentar.');
      return;
    }
    setLoading(true);
    try {
      // 1. Guardar la contraseña usando el token transitorio (fetch directo).
      const saved = await setPasswordFromClaim(newPassword, tok.accessToken);
      if (!saved.success) {
        setError(saved.error || 'No pudimos guardar tu contraseña. Prueba de nuevo.');
        return;
      }
      // 2. Login REAL en el cliente principal (sesión persistente + side-effects).
      const login = await signInWithPhonePassword(fullPhone, newPassword);
      if (!login.success || !login.user) {
        setError(
          login.error ||
            'Guardamos tu contraseña, pero no pudimos iniciar sesión. Ingresa con tu teléfono y contraseña.',
        );
        return;
      }
      // 3. Recién ahora se completa el acceso.
      if (context === 'booking') {
        onSuccess(intentIdRef.current ?? undefined);
      } else {
        onClose();
        navigate(destinationForRole(login.user.role));
      }
      resetState();
    } catch {
      setError('Error de conexión al guardar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isEmailValid || !isPasswordValid || loading) return;
    const cb = captchaBlock();
    if (cb) { setError(cb); return; }
    setLoading(true);
    try {
      const result = await signInWithEmail(email, password, captchaToken ?? undefined);
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
      resetCaptcha();
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cb = captchaBlock();
    if (cb) { setError(cb); return; }
    setLoading(true);
    try {
      await requestPasswordReset(emailForReset, captchaToken ?? undefined);
      // Siempre mostramos el mismo mensaje, sea o no real el email.
      setEmailStep('forgot_sent');
    } catch {
      // Aun en error de red mostramos el mensaje genérico para no filtrar.
      setEmailStep('forgot_sent');
    } finally {
      setLoading(false);
      resetCaptcha();
    }
  };

  const resetState = () => {
    setTab('phone');
    setPhoneStep('credentials');
    setPhoneRaw('');
    setPhoneDisplay('');
    setLoginPassword('');
    setOtpCode('');
    setNewPassword('');
    setNewPasswordConfirm('');
    setEmailStep('login');
    setEmail('');
    setPassword('');
    setEmailForReset('');
    setError('');
    setPhoneError('');
    setResendCountdown(0);
    intentIdRef.current = null;
    sessionTokenRef.current = null;
    setCaptchaToken(null);
  };

  const handleClose = () => {
    // Bloquea el cierre durante una operación en curso y durante el paso
    // OBLIGATORIO de contraseña (no hay X en ese paso; guard defensivo).
    if (loading || isMandatoryStep) return;
    onClose();
    resetState();
  };

  const selectedCountry = countries.find((c) => c.code === countryCode) || countries[0];

  // Botón "atrás": OTP → credentials, forgot → email login. En set_password NO
  // hay atrás (paso obligatorio).
  const showBackButton =
    (tab === 'phone' && phoneStep === 'otp') ||
    (tab === 'email' && emailStep !== 'login');

  const handleBack = () => {
    if (loading) return;
    setError('');
    if (tab === 'phone' && phoneStep === 'otp') {
      setPhoneStep('credentials');
      setOtpCode('');
      intentIdRef.current = null; // volver: cambiar el teléfono registra otro intent
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
  if (tab === 'phone' && phoneStep === 'set_password') headerTitle = 'Crea tu contraseña';
  if (tab === 'email' && emailStep === 'forgot') headerTitle = 'Restablecer contraseña';
  if (tab === 'email' && emailStep === 'forgot_sent') headerTitle = 'Revisá tu correo';

  // En el paso obligatorio de contraseña se oculta el control de cierre.
  const showCloseControl = !isMandatoryStep;

  return (
    // El overlay NO cierra al click. El modal solo se cierra por X, Escape o
    // éxito de auth — evita pérdida de contexto al tocar fuera mientras escribe.
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
          {showCloseControl ? (
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
          ) : (
            <div className="w-8"></div>
          )}
          <h2 className="text-base font-semibold text-gray-900">{headerTitle}</h2>
          <div className="w-8"></div>
        </div>

        {/* Tabs — solo cuando el usuario aún no eligió OTP/forgot/set_password */}
        {!showBackButton && !isMandatoryStep && (
          <div className="flex border-b border-gray-200 px-6 pt-4">
            <button
              type="button"
              onClick={() => {
                setTab('phone');
                setError('');
              }}
              className={`flex-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                tab === 'phone'
                  ? 'border-brand-purple text-brand-purple'
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
                  ? 'border-brand-purple text-brand-purple'
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

          {/* ═══════════ TAB PHONE — credenciales (teléfono + contraseña) ═══════════ */}
          {tab === 'phone' && phoneStep === 'credentials' && (
            <>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">¡Te damos la bienvenida a Lucy Care!</h3>
              <p className="text-sm text-gray-600 mb-6">Ingresa con tu teléfono y contraseña.</p>

              <form onSubmit={handlePhonePasswordLogin} className="space-y-4">
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
                    autoComplete="username"
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

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Contraseña</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900"
                    placeholder="••••••••"
                  />
                </div>

                {captchaWidget}

                <button
                  type="submit"
                  disabled={loading || !isPhoneValid || !isLoginPasswordValid}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || !isPhoneValid || !isLoginPasswordValid
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-brand-purple text-white hover:bg-brand-purple-dark cursor-pointer'
                  }`}
                >
                  {loading ? 'Ingresando…' : 'Ingresar'}
                </button>

                <div className="text-center pt-1 space-y-2">
                  <p className="text-xs text-gray-500">¿Primera vez o no tienes contraseña?</p>
                  {/* Consentimiento visible ANTES de solicitar el código (la
                      acción de solicitarlo constituye el consentimiento). */}
                  <OtpConsentNotice className="text-left" />
                  <button
                    type="button"
                    onClick={handleUseCode}
                    disabled={loading || !isPhoneValid}
                    className="text-sm text-brand-purple font-semibold hover:underline cursor-pointer disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                  >
                    Usar un código
                  </button>
                </div>
              </form>
            </>
          )}

          {/* ═══════════ TAB PHONE — OTP ═══════════ */}
          {tab === 'phone' && phoneStep === 'otp' && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-brand-mint/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-message-2-line text-3xl text-brand-purple"></i>
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
                  className="w-full px-4 py-4 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-purple transition-colors text-center text-2xl font-bold tracking-[0.5em] text-gray-900"
                  placeholder="000000"
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || otpCode.length !== 6
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-brand-purple text-white hover:bg-brand-purple-dark cursor-pointer'
                  }`}
                >
                  {loading ? 'Verificando…' : 'Verificar código'}
                </button>

                {/* Reenvío = envío NUEVO: aviso de consentimiento + Turnstile. */}
                {resendCountdown === 0 && <OtpConsentNotice className="text-center" />}
                {resendCountdown === 0 && captchaWidget}

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
                      className="text-sm text-brand-purple font-semibold hover:underline cursor-pointer disabled:text-gray-400"
                    >
                      Reenviar código
                    </button>
                  )}
                </div>
              </form>
            </>
          )}

          {/* ═══════════ TAB PHONE — crear contraseña (OBLIGATORIO) ═══════════ */}
          {tab === 'phone' && phoneStep === 'set_password' && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-brand-mint/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <i className="ri-lock-2-line text-3xl text-brand-purple"></i>
                </div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-2">Crea tu contraseña</h3>
                <p className="text-sm text-gray-600">
                  La usarás para ingresar con tu teléfono la próxima vez.
                </p>
              </div>

              <form onSubmit={handleSetPassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Nueva contraseña</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-purple text-gray-900"
                    placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
                    autoFocus
                  />
                  {newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH && (
                    <p className="text-xs text-amber-700 mt-1">{PASSWORD_MIN_HINT}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Confirmar contraseña</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={newPasswordConfirm}
                    onChange={(e) => setNewPasswordConfirm(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-purple text-gray-900"
                    placeholder="Repite la contraseña"
                  />
                  {newPasswordMismatch && (
                    <p className="text-xs text-red-600 mt-1">Las contraseñas no coinciden.</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!canSetNewPassword}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    !canSetNewPassword
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-brand-purple text-white hover:bg-brand-purple-dark cursor-pointer'
                  }`}
                >
                  {loading ? 'Guardando…' : 'Guardar y continuar'}
                </button>
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

                {captchaWidget}

                <button
                  type="submit"
                  disabled={loading || !isEmailValid || !isPasswordValid}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || !isEmailValid || !isPasswordValid
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-brand-purple text-white hover:bg-brand-purple-dark cursor-pointer'
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
                  className="block w-full text-center text-sm text-brand-purple hover:underline cursor-pointer mt-2"
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
                {captchaWidget}
                <button
                  type="submit"
                  disabled={loading || !emailForReset.includes('@')}
                  className={`w-full py-3.5 rounded-lg transition-all font-semibold whitespace-nowrap text-base ${
                    loading || !emailForReset.includes('@')
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-brand-purple text-white hover:bg-brand-purple-dark cursor-pointer'
                  }`}
                >
                  {loading ? 'Enviando…' : 'Enviar link de recuperación'}
                </button>
              </form>
            </>
          )}

          {tab === 'email' && emailStep === 'forgot_sent' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-brand-mint/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="ri-mail-check-line text-3xl text-brand-purple"></i>
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
                className="px-6 py-2.5 bg-brand-purple text-white rounded-lg font-medium hover:bg-brand-purple-dark cursor-pointer"
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
