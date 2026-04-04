import { useState, useEffect } from 'react';
import LoginModal from './LoginModal';
import PaymentModal from './PaymentModal';
import WaitlistModal from './WaitlistModal';
import ClaimProfileModal from './ClaimProfileModal';
import { getCurrentUser, clearCurrentUser } from '../../../utils/auth';
import { formatNextSlot, extractDateOnly, getMinDate } from '../../../utils/date';

interface BookingCardProps {
  doctorId: number;
  doctorName: string;
  consultationFee: number;
  phone: string;
  canBook: boolean;
  lucyStatus: 'LISTED_ONLY' | 'CLAIMED' | 'BOOKING_ENABLED' | 'VERIFIED';
  nextAvailableSlot?: string;
  onLucyActivated?: (payload: {
    doctorId: number;
    lucyStatus: 'BOOKING_ENABLED';
    bookingEnabled: true;
    nextAvailableSlot: string;
  }) => void;
}

interface Service {
  id: string;
  name: string;
  duration: number;
  price: number;
}

export default function BookingCard({ 
  doctorId, 
  doctorName, 
  consultationFee, 
  phone,
  canBook,
  lucyStatus,
  nextAvailableSlot,
  onLucyActivated
}: BookingCardProps) {
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState(getCurrentUser());

  // ---- Helper variables (declarados una sola vez) ----
  const nextSlot = formatNextSlot(nextAvailableSlot);
  const minDate = getMinDate();

  const services: Service[] = [
    { id: 'first', name: 'Primera consulta', duration: 60, price: consultationFee },
    { id: 'control', name: 'Consulta de control', duration: 30, price: Math.round(consultationFee * 0.7) },
    { id: 'tele', name: 'Teleconsulta', duration: 30, price: Math.round(consultationFee * 0.8) }
  ];

  // Generar slots dinámicamente basado en la fecha seleccionada
  useEffect(() => {
    if (!selectedDate) {
      setAvailableSlots([]);
      setSelectedTime('');
      return;
    }

    const selected = new Date(selectedDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Calcular días desde hoy
    const diffTime = selected.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Simular agenda llena para ciertos casos:
    // 1. Si no hay nextAvailableSlot, no hay slots
    if (!nextAvailableSlot) {
      setAvailableSlots([]);
      setSelectedTime('');
      return;
    }

    // 2. Si la fecha está muy lejos (>14 días), no hay slots
    if (diffDays > 14) {
      setAvailableSlots([]);
      setSelectedTime('');
      return;
    }

    // 3. Simular días completos (sin slots) para algunos doctores
    // Doctores con ID par tienen menos disponibilidad
    if (doctorId % 2 === 0) {
      // Días de semana completos (lunes, miércoles, viernes)
      const dayOfWeek = selected.getDay();
      if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
        setAvailableSlots([]);
        setSelectedTime('');
        return;
      }
    }

    // 4. Para fechas muy próximas (hoy o mañana), slots limitados
    if (diffDays <= 1) {
      setAvailableSlots(['14:00', '15:00', '16:00']);
      setSelectedTime('');
      return;
    }

    // 5. Slots normales para otros días
    const normalSlots = [
      '09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'
    ];
    
    setAvailableSlots(normalSlots);
    setSelectedTime('');
  }, [selectedDate, nextAvailableSlot, doctorId]);

  const hasAvailableSlots = availableSlots.length > 0;

  // Verificar autenticación al montar el componente
  useEffect(() => {
    const checkAuth = () => {
      const user = getCurrentUser();
      setIsAuthenticated(!!user);
      setCurrentUser(user);
    };
    checkAuth();
  }, []);

  const handleBooking = () => {
    if (!canBook) return;
    
    // Validar que se hayan seleccionado todos los campos requeridos
    if (!selectedService || !selectedDate || !selectedTime) {
      return;
    }

    // Si el usuario NO está autenticado, abrir modal de login
    if (!isAuthenticated) {
      setShowLoginModal(true);
      return;
    }

    // Si el usuario SÍ está autenticado, ir directo a pago
    setShowPaymentModal(true);
  };

  const handleLoginSuccess = () => {
    setShowLoginModal(false);
    const user = getCurrentUser();
    setIsAuthenticated(true);
    setCurrentUser(user);
    // Continuar automáticamente con el flujo de pago
    setShowPaymentModal(true);
  };

  const handleLogout = () => {
    clearCurrentUser();
    setIsAuthenticated(false);
    setCurrentUser(null);
  };

  const handlePaymentSuccess = () => {
    setShowPaymentModal(false);
    // Mostrar confirmación
    alert('¡Cita agendada exitosamente! Recibirás un correo de confirmación.');
    // Limpiar selección
    setSelectedService(null);
    setSelectedDate('');
    setSelectedTime('');
  };

  // Render para médicos sin Lucy activo
  if (!canBook) {
    return (
      <>
        <div className="bg-white rounded-xl shadow-sm p-6 sticky top-6">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-600">Consulta desde</span>
              <span className="text-2xl font-bold text-gray-900">${consultationFee} USD</span>
            </div>
            
            {lucyStatus === 'LISTED_ONLY' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <div className="flex gap-3">
                  <i className="ri-information-line text-amber-600 text-xl flex-shrink-0"></i>
                  <div>
                    <p className="text-sm font-medium text-amber-900 mb-1">
                      Perfil informativo
                    </p>
                    <p className="text-xs text-amber-700">
                      La reserva online está disponible solo con agenda activa en Lucy. Puedes contactarlo directamente.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {lucyStatus === 'CLAIMED' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex gap-3">
                  <i className="ri-calendar-line text-blue-600 text-xl flex-shrink-0"></i>
                  <div>
                    <p className="text-sm font-medium text-blue-900 mb-1">
                      Agenda en configuración
                    </p>
                    <p className="text-xs text-blue-700">
                      La reserva online está disponible solo con agenda activa en Lucy. Por ahora, contacta directamente.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <a
              href={`tel:${phone}`}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap font-medium"
            >
              <i className="ri-phone-line text-lg"></i>
              <span>Llamar para agendar</span>
            </a>
            
            <a
              href={`https://wa.me/${phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors cursor-pointer whitespace-nowrap font-medium"
            >
              <i className="ri-whatsapp-line text-lg"></i>
              <span>WhatsApp</span>
            </a>

            <button
              onClick={() => setShowWaitlistModal(true)}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 border-2 border-emerald-700 text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer whitespace-nowrap font-medium"
            >
              <i className="ri-notification-line text-lg"></i>
              <span>Unirme a lista de espera</span>
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <i className="ri-lightbulb-line text-sm flex-shrink-0 mt-0.5"></i>
              <p>
                ¿Eres este profesional?{' '}
                <button
                  onClick={() => setShowClaimModal(true)}
                  className="text-emerald-700 font-medium hover:underline cursor-pointer"
                >
                  Reclama tu perfil
                </button>
                {' '}y activa tu agenda en Lucy para recibir más pacientes.
              </p>
            </div>
          </div>
        </div>

        <ClaimProfileModal
          isOpen={showClaimModal}
          onClose={() => setShowClaimModal(false)}
          doctorName={doctorName}
          doctorId={doctorId}
          onActivated={onLucyActivated}
        />

        <WaitlistModal
          isOpen={showWaitlistModal}
          onClose={() => setShowWaitlistModal(false)}
          doctorName={doctorName}
        />
      </>
    );
  }

  // Render para médicos con Lucy activo (se reutilizan nextSlot y minDate definidos arriba)
  return (
    <>
      <div className="bg-white rounded-xl shadow-sm p-6 sticky top-6">
        <div className="mb-6">
          {nextSlot && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <i className="ri-time-line text-emerald-700"></i>
                <span className="text-xs font-medium text-slate-900">Próximo disponible</span>
              </div>
              <p className="text-sm font-semibold text-slate-900">{nextSlot}</p>
            </div>
          )}

          {/* User Info Section */}
          {currentUser && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="ri-user-line text-blue-600"></i>
                    <span className="text-xs font-medium text-blue-900">Reservando como:</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{currentUser.name}</p>
                  <p className="text-xs text-gray-600">{currentUser.phone}</p>
                </div>
                <button
                  onClick={handleLogout}
                  type="button"
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer whitespace-nowrap"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {/* Service Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo de consulta
              </label>
              <div className="space-y-2">
                {services.map((service) => (
                  <button
                    key={service.id}
                    onClick={() => setSelectedService(service)}
                    className={`w-full p-3 rounded-lg border-2 transition-all text-left cursor-pointer ${
                      selectedService?.id === service.id
                        ? 'border-emerald-600 bg-emerald-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900">{service.name}</span>
                      <span className="text-lg font-bold text-gray-900">${service.price}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span className="flex items-center gap-1">
                        <i className="ri-time-line"></i>
                        {service.duration} min
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Date Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fecha
              </label>
              <input
                type="date"
                value={selectedDate}
                min={minDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedTime('');
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer"
              />
            </div>

            {/* Time Selection */}
            {selectedDate && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Hora disponible
                </label>
                {hasAvailableSlots ? (
                  <div className="grid grid-cols-3 gap-2">
                    {availableSlots.map((time) => (
                      <button
                        key={time}
                        onClick={() => setSelectedTime(time)}
                        className={`px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium cursor-pointer whitespace-nowrap ${
                          selectedTime === time
                            ? 'border-emerald-700 bg-emerald-700 text-white'
                            : 'border-gray-200 text-gray-700 hover:border-emerald-600'
                        }`}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <i className="ri-calendar-close-line text-4xl text-gray-300 mb-2"></i>
                    <p className="text-sm text-gray-600 mb-3">No hay horarios disponibles para esta fecha</p>
                    <button
                      onClick={() => setShowWaitlistModal(true)}
                      className="text-sm text-emerald-700 font-medium hover:underline cursor-pointer"
                    >
                      Unirme a lista de espera
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CTA Button */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={handleBooking}
              disabled={!selectedService || !selectedDate || !selectedTime}
              className="w-full px-6 py-3.5 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap font-semibold"
            >
              {isAuthenticated ? 'Reservar ahora' : 'Inicia sesión para reservar'}
            </button>

            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
              <i className="ri-shield-check-line text-emerald-700"></i>
              <span>Pago seguro • Confirmación inmediata</span>
            </div>
          </div>
        </div>
      </div>

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={handleLoginSuccess}
      />

      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        doctorName={doctorName}
        consultationFee={selectedService?.price || consultationFee}
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        onSuccess={handlePaymentSuccess}
      />

      <WaitlistModal
        isOpen={showWaitlistModal}
        onClose={() => setShowWaitlistModal(false)}
        doctorName={doctorName}
      />
    </>
  );
}