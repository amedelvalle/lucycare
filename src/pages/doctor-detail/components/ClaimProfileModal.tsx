import { useState, useEffect } from 'react';
import { sendOtp, verifyOtp } from '../../../services/auth.service';
import { claimDoctorProfile, type ClaimErrorCode } from '../../../services/claimProfile.service';
import { supabase } from '../../../lib/supabase';

interface ClaimProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  doctorName: string;
  doctorId: string;
  onActivated?: () => void;
}

const TOS_VERSION = 'v1.0';

const ERROR_COPY: Record<ClaimErrorCode, { title: string; detail: string; manual?: boolean }> = {
  NOT_AUTHENTICATED: {
    title: 'Iniciá sesión primero',
    detail: 'Necesitamos verificar tu teléfono por SMS antes de continuar.',
  },
  DOCTOR_NOT_FOUND: {
    title: 'Perfil no encontrado',
    detail: 'No pudimos encontrar este perfil de médico. Refrescá la página y volvé a intentar.',
  },
  ALREADY_CLAIMED: {
    title: 'Este perfil ya fue reclamado',
    detail: 'Si creés que es un error, contactanos para revisión manual.',
    manual: true,
  },
  DOCTOR_NO_PHONE: {
    title: 'No podemos validarlo automáticamente',
    detail: 'El perfil no tiene teléfono registrado. Necesitamos hacerlo manualmente.',
    manual: true,
  },
  PHONE_MISMATCH: {
    title: 'El teléfono no coincide',
    detail:
      'El teléfono con el que iniciaste sesión no coincide con el registrado para este perfil. Si sos el profesional, contactanos para revisión manual.',
    manual: true,
  },
  DOCTOR_NO_LICENSE: {
    title: 'No podemos validarlo automáticamente',
    detail: 'El perfil no tiene licencia registrada. Necesitamos hacerlo manualmente.',
    manual: true,
  },
  LICENSE_MISMATCH: {
    title: 'La licencia no coincide',
    detail:
      'La licencia/JVPM que ingresaste no coincide con la registrada para este perfil. Verificala y volvé a intentar — si seguís sin poder, contactanos para revisión manual.',
  },
  UNKNOWN: {
    title: 'No pudimos reclamar el perfil',
    detail: 'Ocurrió un error inesperado. Intentá de nuevo en un momento.',
  },
};

type Step = 'otp' | 'license' | 'success';

export default function ClaimProfileModal({
  isOpen,
  onClose,
  doctorName,
  doctorId,
  onActivated,
}: ClaimProfileModalProps) {
  const [step, setStep] = useState<Step>('otp');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // ─── OTP ───
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [countryCode] = useState('+503');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // ─── Licencia + Términos ───
  const [license, setLicense] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);

  // ─── Estado UI ───
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: ClaimErrorCode; title: string; detail: string; manual?: boolean } | null>(
    null,
  );
  const [genericError, setGenericError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    // Reset por si lo cerraron y reabren
    setError(null);
    setGenericError('');
    setLoading(false);
    setOtpCode('');
    setOtpSent(false);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setIsAuthenticated(true);
        setStep('license');
      } else {
        setIsAuthenticated(false);
        setStep('otp');
      }
    });
  }, [isOpen]);

  if (!isOpen) return null;

  const fullPhone = `${countryCode}${phoneRaw}`;
  const isPhoneValid = phoneRaw.length === 8;
  const canClaim = license.trim().length >= 3 && tosAccepted && !loading;

  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    setPhoneRaw(digits);
    setPhoneDisplay(digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits);
  };

  const handleSendOtp = async () => {
    setGenericError('');
    setLoading(true);
    try {
      const result = await sendOtp(fullPhone);
      if (result.success) {
        setOtpSent(true);
      } else {
        setGenericError(result.error || 'Error enviando el código');
      }
    } catch {
      setGenericError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setGenericError('');
    setLoading(true);
    try {
      const result = await verifyOtp(fullPhone, otpCode);
      if (result.success) {
        setIsAuthenticated(true);
        setStep('license');
      } else {
        setGenericError(result.error || 'Código incorrecto');
      }
    } catch {
      setGenericError('Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!canClaim) return;
    setError(null);
    setGenericError('');
    setLoading(true);
    try {
      const result = await claimDoctorProfile({
        doctorId,
        licenseNumber: license,
        tosVersion: TOS_VERSION,
      });

      if (result.success) {
        setStep('success');
        if (onActivated) onActivated();
      } else {
        const code = result.errorCode ?? 'UNKNOWN';
        const copy = ERROR_COPY[code];
        setError({ code, ...copy });
      }
    } catch {
      setError({ code: 'UNKNOWN', ...ERROR_COPY.UNKNOWN });
    } finally {
      setLoading(false);
    }
  };

  const stepIndex = step === 'otp' ? 1 : step === 'license' ? 2 : 3;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Reclamar perfil</h2>
            <p className="text-sm text-gray-600 mt-1">{doctorName}</p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full cursor-pointer"
            aria-label="Cerrar"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
        </div>

        {/* Progress */}
        {step !== 'success' && (
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              {[1, 2].map((s) => (
                <div key={s} className="flex items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-medium ${
                      stepIndex >= s ? 'bg-emerald-700 text-white' : 'bg-gray-200 text-gray-500'
                    }`}
                  >
                    {s}
                  </div>
                  {s < 2 && (
                    <div className={`flex-1 h-1 mx-2 ${stepIndex > s ? 'bg-emerald-700' : 'bg-gray-200'}`}></div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-gray-600">Verificación</span>
              <span className="text-xs text-gray-600">Licencia y términos</span>
            </div>
          </div>
        )}

        <div className="p-6">
          {genericError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{genericError}</p>
            </div>
          )}

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-medium text-red-900">{error.title}</p>
              <p className="text-sm text-red-700 mt-1">{error.detail}</p>
              {error.manual && (
                <a
                  href="https://wa.me/50378056365"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-3 text-sm font-medium text-red-800 hover:text-red-900 underline"
                >
                  <i className="ri-whatsapp-line"></i>
                  Escribinos por WhatsApp
                </a>
              )}
            </div>
          )}

          {/* ═══ STEP 1: OTP ═══ */}
          {step === 'otp' && !isAuthenticated && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Verificá tu identidad</h3>
                <p className="text-sm text-gray-600">
                  Tu cuenta debe estar verificada con el mismo teléfono registrado para este perfil. Si no lo conocés,
                  no vas a poder reclamarlo automáticamente.
                </p>
              </div>

              {!otpSent ? (
                <>
                  <label className="block text-sm font-medium text-gray-700">Teléfono (El Salvador)</label>
                  <div className="flex gap-2">
                    <span className="px-3 py-3 bg-gray-100 border border-gray-300 rounded-lg text-gray-700">+503</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={phoneDisplay}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      placeholder="7777-7777"
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-600 text-gray-900"
                    />
                  </div>
                  <button
                    onClick={handleSendOtp}
                    disabled={!isPhoneValid || loading}
                    className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                      isPhoneValid && !loading
                        ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {loading ? 'Enviando…' : 'Enviar código por SMS'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600">
                    Código enviado a{' '}
                    <span className="font-semibold">
                      {countryCode} {phoneDisplay}
                    </span>
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl font-bold tracking-[0.5em] focus:outline-none focus:border-emerald-600 text-gray-900"
                    autoFocus
                  />
                  <button
                    onClick={handleVerifyOtp}
                    disabled={otpCode.length !== 6 || loading}
                    className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                      otpCode.length === 6 && !loading
                        ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {loading ? 'Verificando…' : 'Verificar y continuar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOtpSent(false);
                      setOtpCode('');
                    }}
                    className="w-full text-sm text-gray-600 hover:text-gray-900 underline"
                  >
                    Cambiar teléfono
                  </button>
                </>
              )}
            </div>
          )}

          {/* ═══ STEP 2: Licencia + Términos ═══ */}
          {step === 'license' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Verificación profesional</h3>
                <p className="text-sm text-gray-600">
                  Ingresá el número exacto de tu licencia profesional / JVPM tal como figura en tu credencial. Lo
                  comparamos con el dato que tenemos registrado para este perfil.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Licencia profesional / JVPM</label>
                <input
                  type="text"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  placeholder="Ej: JVPM-1234"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-600 text-gray-900 uppercase"
                />
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-sm text-gray-700">
                  Al reclamar este perfil confirmás que <strong>sos el profesional</strong> y aceptás nuestros{' '}
                  <a
                    href="/terminos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 underline"
                  >
                    Términos de Uso
                  </a>{' '}
                  ({TOS_VERSION}).
                </p>
                <p className="text-xs text-gray-500">
                  Reclamar no publica tu perfil ni activa agenda online. Esos pasos los hacemos junto con vos después
                  de un breve onboarding.
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tosAccepted}
                    onChange={(e) => setTosAccepted(e.target.checked)}
                    className="mt-1 w-4 h-4 text-emerald-700 rounded cursor-pointer"
                  />
                  <span className="text-sm text-gray-700">Sí, soy el profesional y acepto los términos.</span>
                </label>
              </div>

              <button
                onClick={handleClaim}
                disabled={!canClaim}
                className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                  canClaim
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {loading ? 'Reclamando…' : 'Reclamar mi perfil'}
              </button>
            </div>
          )}

          {/* ═══ STEP 3: Éxito ═══ */}
          {step === 'success' && (
            <div className="text-center py-6">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <i className="ri-check-line text-4xl text-emerald-700"></i>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">¡Perfil reclamado!</h3>
              <p className="text-gray-600 mb-2">
                Tu perfil quedó vinculado a tu cuenta. Aparece igual que antes en el directorio.
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Para activar agenda online o publicarlo oficialmente, escribinos: hacemos un onboarding corto y lo
                dejamos listo.
              </p>
              <a
                href="https://wa.me/50378056365"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 text-white rounded-lg font-medium hover:bg-emerald-800 cursor-pointer mb-3"
              >
                <i className="ri-whatsapp-line text-lg"></i>
                Contactar a Lucy
              </a>
              <button
                onClick={onClose}
                className="block w-full px-6 py-2 text-sm text-gray-600 hover:text-gray-900 underline cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
