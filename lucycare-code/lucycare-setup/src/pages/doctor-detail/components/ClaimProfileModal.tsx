import { useState } from 'react';

interface ClaimProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  doctorName: string;
  doctorId: number;
  onActivated?: (payload: {
    doctorId: number;
    lucyStatus: 'BOOKING_ENABLED';
    bookingEnabled: true;
    nextAvailableSlot: string;
  }) => void;
}

export default function ClaimProfileModal({ 
  isOpen, 
  onClose, 
  doctorName, 
  doctorId,
  onActivated 
}: ClaimProfileModalProps) {
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [license, setLicense] = useState('');
  const [availability, setAvailability] = useState({
    monday: { enabled: false, start: '09:00', end: '17:00' },
    tuesday: { enabled: false, start: '09:00', end: '17:00' },
    wednesday: { enabled: false, start: '09:00', end: '17:00' },
    thursday: { enabled: false, start: '09:00', end: '17:00' },
    friday: { enabled: false, start: '09:00', end: '17:00' },
    saturday: { enabled: false, start: '09:00', end: '14:00' },
    sunday: { enabled: false, start: '09:00', end: '14:00' }
  });
  const [services, setServices] = useState([
    { name: 'Primera consulta', duration: 60, price: 80, enabled: true },
    { name: 'Consulta de control', duration: 30, price: 50, enabled: false },
    { name: 'Teleconsulta', duration: 30, price: 60, enabled: false }
  ]);
  const [lucyEnabled, setLucyEnabled] = useState(false);

  if (!isOpen) return null;

  const handleSendOTP = () => {
    // Simulación de envío de OTP
    alert(`Código enviado a ${phone}`);
    setStep(2);
  };

  const handleVerifyOTP = () => {
    // Simulación de verificación
    if (otp.length === 6) {
      setStep(3);
    } else {
      alert('Código inválido');
    }
  };

  const handleFinish = () => {
    if (lucyEnabled) {
      // Generar próximo slot disponible (mañana a las 10:00)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const nextAvailableSlot = tomorrow.toISOString();

      // Guardar en localStorage
      const activatedDoctors = JSON.parse(localStorage.getItem('lucyActivatedDoctors') || '[]');
      if (!activatedDoctors.includes(doctorId)) {
        activatedDoctors.push(doctorId);
        localStorage.setItem('lucyActivatedDoctors', JSON.stringify(activatedDoctors));
      }

      // Llamar callback
      if (onActivated) {
        onActivated({
          doctorId,
          lucyStatus: 'BOOKING_ENABLED',
          bookingEnabled: true,
          nextAvailableSlot
        });
      }

      alert('¡Perfil reclamado y agenda activada! Ahora puedes recibir reservas automáticas.');
    } else {
      alert('Perfil reclamado. Activa tu agenda cuando estés listo.');
    }
    onClose();
  };

  const dayNames: { [key: string]: string } = {
    monday: 'Lunes',
    tuesday: 'Martes',
    wednesday: 'Miércoles',
    thursday: 'Jueves',
    friday: 'Viernes',
    saturday: 'Sábado',
    sunday: 'Domingo'
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Reclamar perfil</h2>
            <p className="text-sm text-gray-600 mt-1">{doctorName}</p>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-medium ${
                  step >= s ? 'bg-emerald-700 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {s}
                </div>
                {s < 3 && (
                  <div className={`flex-1 h-1 mx-2 ${
                    step > s ? 'bg-emerald-700' : 'bg-gray-200'
                  }`}></div>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-xs text-gray-600">Verificación</span>
            <span className="text-xs text-gray-600">Licencia</span>
            <span className="text-xs text-gray-600">Agenda</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Step 1: Phone + OTP */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Verificación telefónica</h3>
                <p className="text-sm text-gray-600">
                  Ingresa tu número de teléfono para verificar tu identidad
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Número de teléfono
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+503 7777-7777"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                />
              </div>

              <button
                onClick={handleSendOTP}
                disabled={phone.length < 10}
                className="w-full px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap font-medium"
              >
                Enviar código
              </button>
            </div>
          )}

          {/* Step 2: OTP Verification + License */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Verificar código</h3>
                <p className="text-sm text-gray-600">
                  Ingresa el código de 6 dígitos enviado a {phone}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Código de verificación
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-600 focus:border-transparent text-center text-2xl tracking-widest"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cédula profesional o número de licencia
                </label>
                <input
                  type="text"
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  placeholder="Ej: 12345678"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Necesitamos verificar tu identidad profesional
                </p>
              </div>

              <button
                onClick={handleVerifyOTP}
                disabled={otp.length !== 6 || license.length < 4}
                className="w-full px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap font-medium"
              >
                Verificar y continuar
              </button>
            </div>
          )}

          {/* Step 3: Lucy Lite Setup */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Configura tu agenda Lucy</h3>
                <p className="text-sm text-gray-600">
                  Define tu disponibilidad y servicios para recibir reservas automáticas
                </p>
              </div>

              {/* Availability */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Disponibilidad semanal</h4>
                <div className="space-y-2">
                  {Object.entries(availability).map(([day, config]) => (
                    <div key={day} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <input
                        type="checkbox"
                        checked={config.enabled}
                        onChange={(e) => setAvailability({
                          ...availability,
                          [day]: { ...config, enabled: e.target.checked }
                        })}
                        className="w-4 h-4 text-emerald-700 rounded cursor-pointer"
                      />
                      <span className="w-24 text-sm font-medium text-gray-700">{dayNames[day]}</span>
                      {config.enabled && (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="time"
                            value={config.start}
                            onChange={(e) => setAvailability({
                              ...availability,
                              [day]: { ...config, start: e.target.value }
                            })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm cursor-pointer"
                          />
                          <span className="text-gray-500">a</span>
                          <input
                            type="time"
                            value={config.end}
                            onChange={(e) => setAvailability({
                              ...availability,
                              [day]: { ...config, end: e.target.value }
                            })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Services */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Servicios agendables</h4>
                <div className="space-y-3">
                  {services.map((service, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={service.enabled}
                          onChange={(e) => {
                            const newServices = [...services];
                            newServices[index].enabled = e.target.checked;
                            setServices(newServices);
                          }}
                          className="w-4 h-4 text-emerald-700 rounded cursor-pointer mt-1"
                        />
                        <div className="flex-1">
                          <input
                            type="text"
                            value={service.name}
                            onChange={(e) => {
                              const newServices = [...services];
                              newServices[index].name = e.target.value;
                              setServices(newServices);
                            }}
                            className="w-full font-medium text-gray-900 border-0 border-b border-transparent hover:border-gray-300 focus:border-emerald-600 focus:ring-0 px-0 py-1"
                          />
                          <div className="flex gap-4 mt-2">
                            <div className="flex items-center gap-2">
                              <i className="ri-time-line text-gray-400 text-sm"></i>
                              <input
                                type="number"
                                value={service.duration}
                                onChange={(e) => {
                                  const newServices = [...services];
                                  newServices[index].duration = parseInt(e.target.value);
                                  setServices(newServices);
                                }}
                                className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                              <span className="text-sm text-gray-600">min</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <i className="ri-money-dollar-circle-line text-gray-400 text-sm"></i>
                              <span className="text-sm text-gray-600">$</span>
                              <input
                                type="number"
                                value={service.price}
                                onChange={(e) => {
                                  const newServices = [...services];
                                  newServices[index].price = parseInt(e.target.value);
                                  setServices(newServices);
                                }}
                                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                              />
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
                    <p className="text-sm text-gray-600">
                      Permite que los pacientes reserven citas automáticamente según tu disponibilidad
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lucyEnabled}
                      onChange={(e) => setLucyEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-700"></div>
                  </label>
                </div>
              </div>

              <button
                onClick={handleFinish}
                className="w-full px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap font-medium"
              >
                {lucyEnabled ? 'Activar agenda y finalizar' : 'Guardar y finalizar'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
