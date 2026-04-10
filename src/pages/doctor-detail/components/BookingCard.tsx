import { useState, useEffect } from 'react';
import LoginModal from './LoginModal';
import WaitlistModal from './WaitlistModal';
import ClaimProfileModal from './ClaimProfileModal';
import { getCurrentAuthUser, signOut } from '../../../services/auth.service';
import { useAvailableSlots } from '../../../hooks/useBooking';
import { createBooking } from '../../../services/booking.service';
import { supabase } from '../../../lib/supabase';
import type { AuthUser } from '../../../services/auth.service';
import type { DoctorService } from '../../../types/directory.types';

interface BookingCardProps {
  doctorId: string;
  doctorName: string;
  consultationFee: number;
  phone: string;
  canBook: boolean;
  lucyStatus: string;
  nextAvailableSlot?: string;
  onLucyActivated?: () => void;
  // Servicios reales del doctor (desde el detalle)
  services?: DoctorService[];
  clinicId?: string;
}

export default function BookingCard({
  doctorId,
  doctorName,
  consultationFee,
  phone,
  canBook,
  lucyStatus,
  onLucyActivated,
  services: doctorServices,
  clinicId,
}: BookingCardProps) {
  const [selectedService, setSelectedService] = useState<DoctorService | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlotStart, setSelectedSlotStart] = useState('');
  const [selectedSlotEnd, setSelectedSlotEnd] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState('');

  const isAuthenticated = !!currentUser;
  const statusUpper = lucyStatus?.toUpperCase() || 'LISTED_ONLY';

  // Fecha mínima = hoy
  const today = new Date().toISOString().split('T')[0];

  // ─── Slots reales desde Supabase ───
  const { data: dayAvailability, isLoading: loadingSlots } = useAvailableSlots(
    doctorId,
    selectedDate || null
  );

  const availableSlots = (dayAvailability?.slots || []).filter(s => s.available);

  // ─── Auth ───
  useEffect(() => {
    getCurrentAuthUser().then(setCurrentUser);
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const user = await getCurrentAuthUser();
        setCurrentUser(user);
      } else {
        setCurrentUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Servicios: usar los del doctor si vienen, sino fallback
  const services: DoctorService[] = doctorServices && doctorServices.length > 0
    ? doctorServices
    : [{ id: 'default', name: 'Consulta general', durationMinutes: 30, price: consultationFee, isFirstVisit: false, sortOrder: 0 }];

  const handleSlotSelect = (startTime: string, endTime: string) => {
    setSelectedSlotStart(startTime);
    setSelectedSlotEnd(endTime);
  };

  const handleBooking = async () => {
    if (!canBook || !selectedService || !selectedSlotStart) return;

    if (!isAuthenticated) {
      setShowLoginModal(true);
      return;
    }

    setBooking(true);
    setBookingError('');

    const result = await createBooking({
      doctorId,
      clinicId: clinicId || '',
      serviceId: selectedService.id,
      startTime: selectedSlotStart,
      endTime: selectedSlotEnd,
      patientName: currentUser?.name || currentUser?.phone || '',
      patientPhone: currentUser?.phone || '',
    });

    setBooking(false);

    if (result.success) {
      setBookingSuccess(true);
      setSelectedService(null);
      setSelectedDate('');
      setSelectedSlotStart('');
      setSelectedSlotEnd('');
    } else {
      setBookingError(result.error || 'Error al reservar');
    }
  };

  const handleLoginSuccess = () => {
    setShowLoginModal(false);
    getCurrentAuthUser().then(user => {
      setCurrentUser(user);
      // Continuar con booking automáticamente si ya tenía todo seleccionado
      if (selectedService && selectedSlotStart) {
        handleBooking();
      }
    });
  };

  const handleLogout = async () => {
    await signOut();
    setCurrentUser(null);
  };

  // ═══ Render: Médicos SIN agenda activa ═══
  if (!canBook) {
    return (
      <>
        <div className="bg-white rounded-xl shadow-sm p-6 sticky top-6">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-600">Consulta desde</span>
              <span className="text-2xl font-bold text-gray-900">${consultationFee} USD</span>
            </div>

            {statusUpper === 'LISTED_ONLY' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <div className="flex gap-3">
                  <i className="ri-information-line text-amber-600 text-xl flex-shrink-0"></i>
                  <div>
                    <p className="text-sm font-medium text-amber-900 mb-1">Perfil informativo</p>
                    <p className="text-xs text-amber-700">La reserva online está disponible solo con agenda activa en Lucy. Puedes contactarlo directamente.</p>
                  </div>
                </div>
              </div>
            )}

            {statusUpper === 'CLAIMED' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex gap-3">
                  <i className="ri-calendar-line text-blue-600 text-xl flex-shrink-0"></i>
                  <div>
                    <p className="text-sm font-medium text-blue-900 mb-1">Agenda en configuración</p>
                    <p className="text-xs text-blue-700">La reserva online está disponible solo con agenda activa en Lucy. Por ahora, contacta directamente.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {phone && (
              <>
                <a href={`tel:${phone}`} className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap font-medium">
                  <i className="ri-phone-line text-lg"></i>
                  <span>Llamar para agendar</span>
                </a>
                <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors cursor-pointer whitespace-nowrap font-medium">
                  <i className="ri-whatsapp-line text-lg"></i>
                  <span>WhatsApp</span>
                </a>
              </>
            )}
            <button onClick={() => setShowWaitlistModal(true)} className="w-full flex items-center justify-center gap-2 px-6 py-3 border-2 border-emerald-700 text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer whitespace-nowrap font-medium">
              <i className="ri-notification-line text-lg"></i>
              <span>Unirme a lista de espera</span>
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <i className="ri-lightbulb-line text-sm flex-shrink-0 mt-0.5"></i>
              <p>
                ¿Eres este profesional?{' '}
                <button onClick={() => setShowClaimModal(true)} className="text-emerald-700 font-medium hover:underline cursor-pointer">
                  Reclama tu perfil
                </button>
                {' '}y activa tu agenda en Lucy para recibir más pacientes.
              </p>
            </div>
          </div>
        </div>

        <ClaimProfileModal isOpen={showClaimModal} onClose={() => setShowClaimModal(false)} doctorName={doctorName} doctorId={doctorId} onActivated={onLucyActivated} />
        <WaitlistModal isOpen={showWaitlistModal} onClose={() => setShowWaitlistModal(false)} doctorName={doctorName} />
      </>
    );
  }

  // ═══ Render: Médicos CON agenda activa ═══
  return (
    <>
      <div className="bg-white rounded-xl shadow-sm p-6 sticky top-6">
        {/* Éxito */}
        {bookingSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4">
            <div className="flex gap-3">
              <i className="ri-check-double-line text-emerald-700 text-xl flex-shrink-0"></i>
              <div>
                <p className="text-sm font-semibold text-emerald-900">¡Cita agendada!</p>
                <p className="text-xs text-emerald-700 mt-1">Recibirás un recordatorio antes de tu cita.</p>
              </div>
            </div>
            <button onClick={() => setBookingSuccess(false)} className="mt-3 text-xs text-emerald-700 font-medium hover:underline cursor-pointer">
              Agendar otra cita
            </button>
          </div>
        )}

        {/* Error */}
        {bookingError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-600">{bookingError}</p>
          </div>
        )}

        {/* User Info */}
        {currentUser && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <i className="ri-user-line text-blue-600"></i>
                  <span className="text-xs font-medium text-blue-900">Reservando como:</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{currentUser.name || currentUser.phone}</p>
              </div>
              <button onClick={handleLogout} type="button" className="text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer whitespace-nowrap">
                Cerrar sesión
              </button>
            </div>
          </div>
        )}

        {!bookingSuccess && (
          <div className="space-y-4">
            {/* Service Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de consulta</label>
              <div className="space-y-2">
                {services.map((service) => (
                  <button
                    key={service.id}
                    onClick={() => setSelectedService(service)}
                    className={`w-full p-3 rounded-lg border-2 transition-all text-left cursor-pointer ${
                      selectedService?.id === service.id ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900">{service.name}</span>
                      <span className="text-lg font-bold text-gray-900">${service.price}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span className="flex items-center gap-1">
                        <i className="ri-time-line"></i>
                        {service.durationMinutes} min
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Date Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Fecha</label>
              <input
                type="date"
                value={selectedDate}
                min={today}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedSlotStart('');
                  setSelectedSlotEnd('');
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer"
              />
            </div>

            {/* Time Selection */}
            {selectedDate && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Hora disponible</label>
                {loadingSlots ? (
                  <div className="text-center py-4">
                    <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full mx-auto mb-2"></div>
                    <p className="text-sm text-gray-500">Cargando horarios...</p>
                  </div>
                ) : dayAvailability?.isBlocked ? (
                  <div className="text-center py-6">
                    <i className="ri-calendar-close-line text-4xl text-gray-300 mb-2"></i>
                    <p className="text-sm text-gray-600">{dayAvailability.blockReason || 'Día no disponible'}</p>
                  </div>
                ) : availableSlots.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot.startTime}
                        onClick={() => handleSlotSelect(slot.startTime, slot.endTime)}
                        className={`px-3 py-2 rounded-lg border-2 transition-all text-sm font-medium cursor-pointer whitespace-nowrap ${
                          selectedSlotStart === slot.startTime
                            ? 'border-emerald-700 bg-emerald-700 text-white'
                            : 'border-gray-200 text-gray-700 hover:border-emerald-600'
                        }`}
                      >
                        {slot.displayTime}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <i className="ri-calendar-close-line text-4xl text-gray-300 mb-2"></i>
                    <p className="text-sm text-gray-600 mb-3">No hay horarios disponibles para esta fecha</p>
                    <button onClick={() => setShowWaitlistModal(true)} className="text-sm text-emerald-700 font-medium hover:underline cursor-pointer">
                      Unirme a lista de espera
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CTA Button */}
            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={handleBooking}
                disabled={!selectedService || !selectedSlotStart || booking}
                className={`w-full px-6 py-3.5 rounded-lg font-semibold transition-colors ${
                  selectedService && selectedSlotStart && !booking
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {booking ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Reservando...
                  </span>
                ) : isAuthenticated ? 'Reservar ahora' : 'Inicia sesión para reservar'}
              </button>
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
                <i className="ri-shield-check-line text-emerald-700"></i>
                <span>Pago seguro • Confirmación inmediata</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} onSuccess={handleLoginSuccess} />
      <WaitlistModal isOpen={showWaitlistModal} onClose={() => setShowWaitlistModal(false)} doctorName={doctorName} />
    </>
  );
}
