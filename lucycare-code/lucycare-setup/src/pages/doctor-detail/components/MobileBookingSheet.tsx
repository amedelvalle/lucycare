import { useState, useEffect } from 'react';
import LoginModal from './LoginModal';
import PaymentModal from './PaymentModal';
import WaitlistModal from './WaitlistModal';
import { getCurrentUser, clearCurrentUser } from '../../../utils/auth';
import { formatNextSlot, extractDateOnly, getMinDate } from '../../../utils/date';

interface MobileBookingSheetProps {
  isOpen: boolean;
  onClose: () => void;
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

export default function MobileBookingSheet({
  isOpen,
  onClose,
  doctorId,
  doctorName,
  consultationFee,
  phone,
  canBook,
  lucyStatus,
  nextAvailableSlot,
  onLucyActivated
}: MobileBookingSheetProps) {
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState(getCurrentUser());

  const services: Service[] = [
    { id: 'first', name: 'Primera consulta', duration: 60, price: consultationFee },
    { id: 'control', name: 'Consulta de control', duration: 30, price: Math.round(consultationFee * 0.7) },
    { id: 'tele', name: 'Teleconsulta', duration: 30, price: Math.round(consultationFee * 0.8) }
  ];

  // Cerrar con ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Prevenir scroll del body cuando está abierto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Generar slots dinámicamente
  useEffect(() => {
    if (!selectedDate) {
      setAvailableSlots([]);
      setSelectedTime('');
      return;
    }

    const selected = new Date(selectedDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffTime = selected.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (!nextAvailableSlot) {
      setAvailableSlots([]);
      setSelectedTime('');
      return;
    }

    if (diffDays > 14) {
      setAvailableSlots([]);
      setSelectedTime('');
      return;
    }

    if (doctorId % 2 === 0) {
      const dayOfWeek = selected.getDay();
      if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
        setAvailableSlots([]);
        setSelectedTime('');
        return;
      }
    }

    if (diffDays <= 1) {
      setAvailableSlots(['14:00', '15:00', '16:00']);
      setSelectedTime('');
      return;
    }

    const normalSlots = [
      '09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00'
    ];
    
    setAvailableSlots(normalSlots);
    setSelectedTime('');
  }, [selectedDate, nextAvailableSlot, doctorId]);

  const hasAvailableSlots = availableSlots.length > 0;

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
    
    if (!selectedService || !selectedDate || !selectedTime) {
      return;
    }

    if (!isAuthenticated) {
      setShowLoginModal(true);
      return;
    }

    setShowPaymentModal(true);
  };

  const handleLoginSuccess = () => {
    setShowLoginModal(false);
    const user = getCurrentUser();
    setIsAuthenticated(true);
    setCurrentUser(user);
    setShowPaymentModal(true);
  };

  const handleLogout = () => {
    clearCurrentUser();
    setIsAuthenticated(false);
    setCurrentUser(null);
  };

  const handlePaymentSuccess = () => {
    setShowPaymentModal(false);
    alert('¡Cita agendada exitosamente! Recibirás un correo de confirmación.');
    setSelectedService(null);
    setSelectedDate('');
    setSelectedTime('');
    onClose();
  };

  const handleConfirmReservation = () => {
    if (!canBook) return;
    
    if (!selectedService || !selectedDate || !selectedTime) {
      return;
    }

    if (!isAuthenticated) {
      setShowLoginModal(true);
      return;
    }

    setShowPaymentModal(true);
  };

  if (!isOpen) return null;

  const nextSlot = formatNextSlot(nextAvailableSlot);
  const minDate = getMinDate();

  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 bg-black/50 z-50 lg:hidden"
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div
        className={`fixed inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl transform transition-transform duration-300 ease-out z-50 ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <h2 className="text-lg font-semibold text-gray-900">Reservar cita</h2>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
        </div>

        {/* Contenido con scroll */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 60px)' }}>
          {/* Content */}
          <div className="p-6">
            <div className="mb-4">
              <h3 className="font-semibold text-gray-900 mb-1">{doctorName}</h3>
              {nextSlot && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-3">
                  <div className="flex items-center gap-2 mb-1">
                    <i className="ri-time-line text-emerald-700"></i>
                    <span className="text-xs font-medium text-slate-900">Próximo disponible</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{nextSlot}</p>
                </div>
              )}
            </div>

            {/* User Info */}
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

            <div className="space-y-5">
              {/* Service Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Tipo de consulta
                </label>
                <div className="space-y-2">
                  {services.map((service) => (
                    <button
                      key={service.id}
                      onClick={() => setSelectedService(service)}
                      type="button"
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
              <div className="mb-4">
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>

              {/* Time Selection */}
              {selectedDate && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Hora disponible
                  </label>
                  {hasAvailableSlots ? (
                    <div className="grid grid-cols-3 gap-2">
                      {availableSlots.map((time) => (
                        <button
                          key={time}
                          onClick={() => setSelectedTime(time)}
                          type="button"
                          className={`px-3 py-2.5 rounded-lg border-2 transition-all text-sm font-medium cursor-pointer whitespace-nowrap ${
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
                        type="button"
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
                onClick={handleConfirmReservation}
                disabled={!selectedService || !selectedDate || !selectedTime}
                className="w-full px-6 py-3.5 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap font-semibold"
              >
                Confirmar reserva
              </button>

              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
                <i className="ri-shield-check-line text-emerald-700"></i>
                <span>Pago seguro • Confirmación inmediata</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
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
