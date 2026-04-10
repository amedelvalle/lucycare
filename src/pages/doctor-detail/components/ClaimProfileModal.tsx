import { useState, useEffect } from 'react';
import { sendOtp, verifyOtp } from '../../../services/auth.service';
import { claimDoctorProfile } from '../../../services/claimProfile.service';
import { supabase } from '../../../lib/supabase';

interface ClaimProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  doctorName: string;
  doctorId: string;
  onActivated?: () => void;
}

const dayConfig = [
  { key: 'monday', label: 'Lunes', dayOfWeek: 1 },
  { key: 'tuesday', label: 'Martes', dayOfWeek: 2 },
  { key: 'wednesday', label: 'Miércoles', dayOfWeek: 3 },
  { key: 'thursday', label: 'Jueves', dayOfWeek: 4 },
  { key: 'friday', label: 'Viernes', dayOfWeek: 5 },
  { key: 'saturday', label: 'Sábado', dayOfWeek: 6 },
  { key: 'sunday', label: 'Domingo', dayOfWeek: 0 },
];

export default function ClaimProfileModal({
  isOpen,
  onClose,
  doctorName,
  doctorId,
  onActivated
}: ClaimProfileModalProps) {
  const [step, setStep] = useState(1);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // OTP
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [countryCode] = useState('+503');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // License
  const [license, setLicense] = useState('');

  // Availability
  const [availability, setAvailability] = useState<Record<string, { enabled: boolean; start: string; end: string }>>({
    monday: { enabled: false, start: '09:00', end: '17:00' },
    tuesday: { enabled: false, start: '09:00', end: '17:00' },
    wednesday: { enabled: false, start: '09:00', end: '17:00' },
    thursday: { enabled: false, start: '09:00', end: '17:00' },
    friday: { enabled: false, start: '09:00', end: '17:00' },
    saturday: { enabled: false, start: '09:00', end: '14:00' },
    sunday: { enabled: false, start: '09:00', end: '14:00' },
  });

  // Services
  const [services, setServices] = useState([
    { name: 'Primera consulta', duration: 60, price: 80, enabled: true },
    { name: 'Consulta de control', duration: 30, price: 50, enabled: false },
    { name: 'Teleconsulta', duration: 30, price: 60, enabled: false },
  ]);

  const [lucyEnabled, setLucyEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Verificar sesión al abrir
  useEffect(() => {
    if (isOpen) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          setIsAuthenticated(true);
          setStep(2); // Saltar OTP, ir a licencia
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const fullPhone = `${countryCode}${phoneRaw}`;
  const isPhoneValid = phoneRaw.length === 8;

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) formatted = `${digits.slice(0, 4)}-${digits.slice(4)}`;
    setPhoneRaw(digits);
    setPhoneDisplay(formatted);
  };

  // ─── Step 1: OTP ───
  const handleSendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await sendOtp(fullPhone);
      if (result.success) {
        setOtpSent(true);
      } else {
        setError(result.error || 'Error enviando código');
      }
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await verifyOtp(fullPhone, otpCode);
      if (result.success) {
        setIsAuthenticated(true);
        setStep(2);
      } else {
        setError(result.error || 'Código incorrecto');
      }
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  // ─── Step 3: Finish ───
  const handleFinish = async () => {
    setError('');
    setLoading(true);
    try {
      const availabilityRules = dayConfig
        .filter(d => availability[d.key]?.enabled)
        .map(d => ({
          dayOfWeek: d.dayOfWeek,
          startTime: availability[d.key].start,
          endTime: availability[d.key].end,
          slotDuration: 30,
        }));

      const result = await claimDoctorProfile({
        doctorId,
        licenseNumber: license,
        services: services.map(s => ({
          name: s.name,
          durationMinutes: s.duration,
          price: s.price,
          enabled: s.enabled,
        })),
        availability: availabilityRules,
        enableBooking: lucyEnabled,
      });

      if (result.success) {
        setStep(4); // Éxito
        if (onActivated) onActivated();
      } else {
        setError(result.error || 'Error al reclamar perfil');
      }
    } catch { setError('Error inesperado'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Reclamar perfil</h2>
            <p className="text-sm text-gray-600 mt-1">{doctorName}</p>
          </div>
          <button onClick={onClose} type="button" className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full cursor-pointer">
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
        </div>

        {/* Progress */}
        {step <= 3 && (
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              {[1, 2, 3].map(s => (
                <div key={s} className="flex items-center flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-medium ${step >= s ? 'bg-emerald-700 text-white' : 'bg-gray-200 text-gray-500'}`}>{s}</div>
                  {s < 3 && <div className={`flex-1 h-1 mx-2 ${step > s ? 'bg-emerald-700' : 'bg-gray-200'}`}></div>}
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-gray-600">Verificación</span>
              <span className="text-xs text-gray-600">Licencia</span>
              <span className="text-xs text-gray-600">Agenda</span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* ═══ STEP 1: OTP ═══ */}
          {step === 1 && !isAuthenticated && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Verificación telefónica</h3>
                <p className="text-sm text-gray-600">Ingresa tu número de teléfono para verificar tu identidad</p>
              </div>

              {!otpSent ? (
                <>
                  <input type="text" inputMode="numeric" value={phoneDisplay} onChange={e => formatPhone(e.target.value)} placeholder="7777-7777" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900" />
                  <button onClick={handleSendOtp} disabled={!isPhoneValid || loading} className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${isPhoneValid && !loading ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer' : 'bg-gray-300 cursor-not-allowed'}`}>
                    {loading ? 'Enviando...' : 'Enviar código'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600">Código enviado a <span className="font-semibold">{countryCode} {phoneDisplay}</span></p>
                  <input type="text" inputMode="numeric" maxLength={6} value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl font-bold tracking-[0.5em] focus:outline-none focus:border-emerald-700 text-gray-900" autoFocus />
                  <button onClick={handleVerifyOtp} disabled={otpCode.length !== 6 || loading} className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${otpCode.length === 6 && !loading ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer' : 'bg-gray-300 cursor-not-allowed'}`}>
                    {loading ? 'Verificando...' : 'Verificar y continuar'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ═══ STEP 2: Licencia ═══ */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Verificación profesional</h3>
                <p className="text-sm text-gray-600">Ingresa tu número de licencia médica</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cédula profesional o número de licencia</label>
                <input type="text" value={license} onChange={e => setLicense(e.target.value)} placeholder="Ej: 12345678" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900" />
                <p className="text-xs text-gray-500 mt-1">Necesitamos verificar tu identidad profesional</p>
              </div>
              <button onClick={() => setStep(3)} disabled={license.length < 4} className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${license.length >= 4 ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer' : 'bg-gray-300 cursor-not-allowed'}`}>
                Continuar
              </button>
            </div>
          )}

          {/* ═══ STEP 3: Agenda ═══ */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Configura tu agenda</h3>
                <p className="text-sm text-gray-600">Define tu disponibilidad y servicios</p>
              </div>

              {/* Availability */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Disponibilidad semanal</h4>
                <div className="space-y-2">
                  {dayConfig.map(day => {
                    const config = availability[day.key];
                    return (
                      <div key={day.key} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                        <input type="checkbox" checked={config.enabled} onChange={e => setAvailability({ ...availability, [day.key]: { ...config, enabled: e.target.checked } })} className="w-4 h-4 text-emerald-700 rounded cursor-pointer" />
                        <span className="w-24 text-sm font-medium text-gray-700">{day.label}</span>
                        {config.enabled && (
                          <div className="flex items-center gap-2 flex-1">
                            <input type="time" value={config.start} onChange={e => setAvailability({ ...availability, [day.key]: { ...config, start: e.target.value } })} className="px-2 py-1 border border-gray-300 rounded text-sm" />
                            <span className="text-gray-500">a</span>
                            <input type="time" value={config.end} onChange={e => setAvailability({ ...availability, [day.key]: { ...config, end: e.target.value } })} className="px-2 py-1 border border-gray-300 rounded text-sm" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Services */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Servicios agendables</h4>
                <div className="space-y-3">
                  {services.map((service, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-start gap-3">
                        <input type="checkbox" checked={service.enabled} onChange={e => { const n = [...services]; n[index].enabled = e.target.checked; setServices(n); }} className="w-4 h-4 text-emerald-700 rounded cursor-pointer mt-1" />
                        <div className="flex-1">
                          <input type="text" value={service.name} onChange={e => { const n = [...services]; n[index].name = e.target.value; setServices(n); }} className="w-full font-medium text-gray-900 border-0 border-b border-transparent hover:border-gray-300 focus:border-emerald-600 focus:outline-none px-0 py-1" />
                          <div className="flex gap-4 mt-2">
                            <div className="flex items-center gap-2">
                              <i className="ri-time-line text-gray-400 text-sm"></i>
                              <input type="number" value={service.duration} onChange={e => { const n = [...services]; n[index].duration = parseInt(e.target.value) || 0; setServices(n); }} className="w-16 px-2 py-1 border border-gray-300 rounded text-sm" />
                              <span className="text-sm text-gray-600">min</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600">$</span>
                              <input type="number" value={service.price} onChange={e => { const n = [...services]; n[index].price = parseInt(e.target.value) || 0; setServices(n); }} className="w-20 px-2 py-1 border border-gray-300 rounded text-sm" />
                              <span className="text-sm text-gray-600">USD</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lucy Toggle */}
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-2 border-emerald-200 rounded-xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <i className="ri-calendar-check-line text-emerald-700 text-xl"></i>
                      <h4 className="font-semibold text-gray-900">Activar agenda online</h4>
                    </div>
                    <p className="text-sm text-gray-600">Permite que los pacientes reserven citas automáticamente</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={lucyEnabled} onChange={e => setLucyEnabled(e.target.checked)} className="sr-only peer" />
                    <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-700"></div>
                  </label>
                </div>
              </div>

              <button onClick={handleFinish} disabled={loading} className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${!loading ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer' : 'bg-gray-300 cursor-not-allowed'}`}>
                {loading ? 'Guardando...' : lucyEnabled ? 'Activar agenda y finalizar' : 'Guardar y finalizar'}
              </button>
            </div>
          )}

          {/* ═══ STEP 4: Éxito ═══ */}
          {step === 4 && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <i className="ri-check-line text-4xl text-emerald-700"></i>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">
                {lucyEnabled ? '¡Perfil reclamado y agenda activada!' : '¡Perfil reclamado!'}
              </h3>
              <p className="text-gray-600 mb-6">
                {lucyEnabled
                  ? 'Ahora los pacientes pueden reservar citas contigo desde el directorio.'
                  : 'Tu perfil ha sido vinculado. Activa tu agenda cuando estés listo.'
                }
              </p>
              <button onClick={onClose} className="px-8 py-3 bg-[#3C2285] text-white rounded-lg font-semibold hover:bg-[#2d1a64] cursor-pointer">
                Entendido
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
