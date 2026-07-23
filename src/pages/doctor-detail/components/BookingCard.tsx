import { useState, useEffect, useRef } from 'react';
import LoginModal from './LoginModal';
import WaitlistModal from './WaitlistModal';
import { getCurrentAuthUser, signOut } from '../../../services/auth.service';
import { useAvailableSlots, useAvailableDays } from '../../../hooks/useBooking';
import { registerBookingIntent, createBookingWithIntent } from '../../../services/booking.service';
import type { BookingIntentError, BookingIntentErrorCategory } from '../../../services/booking.service';
import { localDateStr } from '../../../services/slots.service';
import { supabase } from '../../../lib/supabase';
import type { AuthUser } from '../../../services/auth.service';
import type { DoctorService } from '../../../types/directory.types';

/**
 * AUTH-P1B1B — mensajes visibles del camino de reserva por intent. TUTEO
 * obligatorio (no voseo), aunque existan constantes con voseo en otras partes.
 */
const BOOKING_INTENT_MESSAGES: Record<BookingIntentErrorCategory, string> = {
  invalid_phone: 'El número de teléfono no es válido.',
  unavailable: 'Ese horario ya no está disponible. Elige otro horario.',
  too_many_requests: 'Tienes varias reservas en curso. Espera unos minutos e inténtalo de nuevo.',
  intent_missing_or_expired: 'La reserva expiró. Elige el horario nuevamente.',
  already_consumed: 'Esta reserva ya se completó.',
  phone_mismatch: 'El teléfono de tu sesión no coincide con la reserva. Inicia sesión de nuevo.',
  availability_changed: 'El médico ya no tiene disponibilidad en ese horario. Elige otro.',
  doctor_or_service_unavailable: 'Este médico o servicio ya no está disponible para reservas en línea.',
  invalid_name: 'Necesitamos un nombre válido para la reserva.',
  invalid_notes: 'Las notas son demasiado largas.',
  unknown: 'No pudimos completar la reserva. Inténtalo de nuevo.',
};

// startLocal debe ser reloj local sin offset: YYYY-MM-DDTHH:mm:ss (ver slots.service).
const START_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

interface BookingCardProps {
  doctorId: string;
  doctorName: string;
  consultationFee: number;
  phone: string;
  canBook: boolean;
  lucyStatus: string;
  nextAvailableSlot?: string;
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
  services: doctorServices,
  clinicId,
}: BookingCardProps) {
  const [selectedService, setSelectedService] = useState<DoctorService | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlotStart, setSelectedSlotStart] = useState('');
  const [selectedSlotEnd, setSelectedSlotEnd] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingError, setBookingError] = useState('');
  // AUTH-P1B1B: intentId vigente, SOLO en memoria. Se limpia al cambiar
  // servicio/fecha/slot y ante categorías de error que lo invalidan.
  const intentIdRef = useRef<string | null>(null);

  const isAuthenticated = !!currentUser;
  const statusUpper = lucyStatus?.toUpperCase() || 'LISTED_ONLY';

  // Fecha mínima = hoy en hora LOCAL (toISOString es UTC: después de las
  // 6 pm en El Salvador devolvía la fecha de mañana).
  const today = localDateStr();

  // ─── Slots reales desde Supabase ───
  const { data: dayAvailability, isLoading: loadingSlots } = useAvailableSlots(
    doctorId,
    selectedDate || null
  );

  const availableSlots = (dayAvailability?.slots || []).filter(s => s.available);

  // ─── Fecha por defecto: hoy si tiene agenda, o la próxima con agenda ───
  // useAvailableDays da una vista rápida (día laboral + no bloqueado); el
  // fetch real de slots decide. Si la candidata auto-elegida resulta sin
  // slots reales (p. ej. hoy de noche, todos pasados), se avanza a la
  // siguiente. El usuario puede cambiar la fecha cuando quiera (dateTouched
  // apaga el modo automático).
  const { data: availableDays, isLoading: loadingDays } = useAvailableDays(
    canBook ? doctorId : undefined,
    30
  );
  const [dateTouched, setDateTouched] = useState(false);
  // Lista de fechas candidatas mientras se resuelve la fecha por defecto;
  // null = modo automático terminado (resuelto o agotado).
  const [autoCandidates, setAutoCandidates] = useState<string[] | null>(null);

  useEffect(() => {
    if (!canBook || dateTouched || selectedDate || !availableDays) return;
    const candidates = availableDays.filter(d => d.hasSlots).map(d => d.date).slice(0, 7);
    if (candidates.length > 0) {
      setAutoCandidates(candidates);
      setSelectedDate(candidates[0]);
    }
  }, [availableDays, canBook, dateTouched, selectedDate]);

  useEffect(() => {
    if (dateTouched || !selectedDate || loadingSlots || !autoCandidates) return;
    if (!dayAvailability || dayAvailability.date !== selectedDate) return;
    const hasReal = (dayAvailability.slots || []).some(s => s.available);
    if (hasReal) {
      setAutoCandidates(null); // fecha por defecto resuelta
      return;
    }
    const next = autoCandidates[autoCandidates.indexOf(selectedDate) + 1];
    if (next) {
      setSelectedDate(next);
    } else {
      setAutoCandidates(null); // sin más candidatas: queda el estado vacío normal
    }
  }, [dayAvailability, loadingSlots, selectedDate, dateTouched, autoCandidates]);

  // Modo automático activo: mientras dura, la sección de horarios muestra
  // loading (nunca "No hay horarios" a medio buscar).
  const autoSearching = canBook && !dateTouched && autoCandidates !== null;
  const searchingDefaultDate = canBook && !dateTouched && !selectedDate && loadingDays;
  const noUpcomingDays =
    canBook && !dateTouched && !selectedDate && !loadingDays &&
    !!availableDays && availableDays.filter(d => d.hasSlots).length === 0;

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
    intentIdRef.current = null; // nuevo slot ⇒ intent anterior obsoleto
  };

  // Mapea el error de la RPC a mensaje visible y limpia el intent en memoria
  // ante las categorías que lo invalidan.
  const handleIntentError = (error: BookingIntentError) => {
    setBookingError(BOOKING_INTENT_MESSAGES[error.category] ?? BOOKING_INTENT_MESSAGES.unknown);
    if (
      error.category === 'intent_missing_or_expired' ||
      error.category === 'already_consumed' ||
      error.category === 'phone_mismatch' ||
      error.category === 'availability_changed'
    ) {
      intentIdRef.current = null;
    }
  };

  // Completa la reserva a partir de un intent ya emitido, usando el objeto de
  // usuario LOCAL (no el estado currentUser, que puede no haber propagado).
  const completeBooking = async (intentId: string, user: AuthUser) => {
    const patientName = (user.name?.trim() || user.phone || '').trim();
    if (!patientName) {
      setBookingError(BOOKING_INTENT_MESSAGES.invalid_name);
      return;
    }
    const res = await createBookingWithIntent({ intentId, patientName });
    if (res.ok) {
      intentIdRef.current = null;
      setBookingSuccess(true);
      setSelectedService(null);
      setSelectedDate('');
      setSelectedSlotStart('');
      setSelectedSlotEnd('');
    } else {
      handleIntentError(res.error);
    }
  };

  // Callback pre-OTP del LoginModal (context='booking'): registra el intent con
  // el MISMO fullPhone al que se enviará el OTP. Devuelve el intentId.
  const registerIntentBeforeOtp = async (
    fullPhone: string,
  ): Promise<{ ok: boolean; intentId?: string; error?: string }> => {
    if (!selectedService || !selectedSlotStart || !START_LOCAL_RE.test(selectedSlotStart)) {
      return { ok: false, error: BOOKING_INTENT_MESSAGES.unknown };
    }
    const reg = await registerBookingIntent({
      doctorId,
      serviceId: selectedService.id,
      startLocal: selectedSlotStart,
      phone: fullPhone,
    });
    if (!reg.ok) {
      return { ok: false, error: BOOKING_INTENT_MESSAGES[reg.error.category] ?? BOOKING_INTENT_MESSAGES.unknown };
    }
    intentIdRef.current = reg.data.intentId;
    return { ok: true, intentId: reg.data.intentId };
  };

  const handleBooking = async () => {
    if (!canBook || !selectedService || !selectedSlotStart || booking) return;

    // startLocal debe ser reloj local sin offset (YYYY-MM-DDTHH:mm:ss).
    if (!START_LOCAL_RE.test(selectedSlotStart)) {
      setBookingError(BOOKING_INTENT_MESSAGES.unknown);
      return;
    }

    // Sin sesión: abrir LoginModal. onBeforeSendOtp registrará el intent.
    if (!isAuthenticated) {
      setBookingError('');
      setShowLoginModal(true);
      return;
    }

    // Autenticado: el teléfono debe estar en la sesión (la RPC lo toma del JWT).
    if (!currentUser?.phone) {
      setBookingError('Para reservar como paciente, inicia sesión con tu número de teléfono.');
      return;
    }

    setBooking(true);
    setBookingError('');
    try {
      const reg = await registerBookingIntent({
        doctorId,
        serviceId: selectedService.id,
        startLocal: selectedSlotStart,
        phone: currentUser.phone,
      });
      if (!reg.ok) {
        handleIntentError(reg.error);
        return;
      }
      intentIdRef.current = reg.data.intentId;
      await completeBooking(reg.data.intentId, currentUser);
    } finally {
      setBooking(false);
    }
  };

  const handleLoginSuccess = async (intentId?: string) => {
    setShowLoginModal(false);
    // Usuario autenticado FRESCO (no esperar a que setCurrentUser propague).
    const user = await getCurrentAuthUser();
    setCurrentUser(user);
    if (!intentId || !user) {
      setBookingError(BOOKING_INTENT_MESSAGES.unknown);
      return;
    }
    setBooking(true);
    setBookingError('');
    try {
      intentIdRef.current = intentId;
      await completeBooking(intentId, user);
    } finally {
      setBooking(false);
    }
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
                    <p className="text-sm font-medium text-amber-900 mb-1">Sin agenda en línea</p>
                    <p className="text-xs text-amber-700">Este médico aún no tiene agenda activa en Lucy. Podés contactarlo por llamada o WhatsApp, o unirte a la lista de espera.</p>
                  </div>
                </div>
              </div>
            )}

            {statusUpper === 'CLAIMED' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <div className="flex gap-3">
                  <i className="ri-calendar-line text-blue-600 text-xl flex-shrink-0"></i>
                  <div>
                    <p className="text-sm font-medium text-blue-900 mb-1">Sin agenda en línea</p>
                    <p className="text-xs text-blue-700">Este médico aún no tiene agenda activa en Lucy. Podés contactarlo por llamada o WhatsApp, o unirte a la lista de espera.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {phone && (
              <>
                <a href={`tel:${phone}`} className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-brand-purple text-white rounded-lg hover:bg-brand-purple-dark transition-colors cursor-pointer whitespace-nowrap font-medium">
                  <i className="ri-phone-line text-lg"></i>
                  <span>Llamar para agendar</span>
                </a>
                <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors cursor-pointer whitespace-nowrap font-medium">
                  <i className="ri-whatsapp-line text-lg"></i>
                  <span>WhatsApp</span>
                </a>
              </>
            )}
            <button onClick={() => setShowWaitlistModal(true)} className="w-full flex items-center justify-center gap-2 px-6 py-3 border-2 border-brand-purple text-brand-purple rounded-lg hover:bg-brand-mint/20 transition-colors cursor-pointer whitespace-nowrap font-medium">
              <i className="ri-notification-line text-lg"></i>
              <span>Unirme a lista de espera</span>
            </button>
          </div>

        </div>

        <WaitlistModal isOpen={showWaitlistModal} onClose={() => setShowWaitlistModal(false)} doctorId={doctorId} doctorName={doctorName} />
      </>
    );
  }

  // ═══ Render: Médicos CON agenda activa ═══
  return (
    <>
      <div className="bg-white rounded-xl shadow-sm p-6 sticky top-6">
        {/* Éxito */}
        {bookingSuccess && (
          <div className="bg-brand-mint/20 border border-brand-mint/40 rounded-lg p-4 mb-4">
            <div className="flex gap-3">
              <i className="ri-check-double-line text-brand-purple text-xl flex-shrink-0"></i>
              <div>
                <p className="text-sm font-semibold text-brand-purple">¡Cita agendada!</p>
                <p className="text-xs text-brand-purple mt-1">Recibirás un recordatorio antes de tu cita.</p>
              </div>
            </div>
            <button onClick={() => setBookingSuccess(false)} className="mt-3 text-xs text-brand-purple font-medium hover:underline cursor-pointer">
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
                    onClick={() => { setSelectedService(service); intentIdRef.current = null; }}
                    className={`w-full p-3 rounded-lg border-2 transition-all text-left cursor-pointer ${
                      selectedService?.id === service.id ? 'border-brand-purple bg-brand-mint/20' : 'border-gray-200 hover:border-gray-300'
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
                  setDateTouched(true);
                  setSelectedDate(e.target.value);
                  setSelectedSlotStart('');
                  setSelectedSlotEnd('');
                  intentIdRef.current = null; // nueva fecha ⇒ intent obsoleto
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-purple focus:border-transparent cursor-pointer"
              />
              {searchingDefaultDate && (
                <p className="mt-2 text-xs text-gray-500 flex items-center gap-2">
                  <span className="inline-block animate-spin h-3 w-3 border-2 border-brand-purple border-t-transparent rounded-full"></span>
                  Buscando la próxima fecha disponible…
                </p>
              )}
              {noUpcomingDays && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800 mb-2">
                    Este médico no tiene fechas con agenda en los próximos 30 días.
                  </p>
                  <button
                    onClick={() => setShowWaitlistModal(true)}
                    type="button"
                    className="text-xs text-brand-purple font-medium hover:underline cursor-pointer"
                  >
                    Unirme a lista de espera
                  </button>
                </div>
              )}
            </div>

            {/* Time Selection */}
            {selectedDate && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Hora disponible</label>
                {loadingSlots || autoSearching ? (
                  <div className="text-center py-4">
                    <div className="animate-spin h-6 w-6 border-2 border-brand-purple border-t-transparent rounded-full mx-auto mb-2"></div>
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
                            ? 'border-brand-purple bg-brand-purple text-white'
                            : 'border-gray-200 text-gray-700 hover:border-brand-purple'
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
                    <button onClick={() => setShowWaitlistModal(true)} className="text-sm text-brand-purple font-medium hover:underline cursor-pointer">
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
                    ? 'bg-brand-purple text-white hover:bg-brand-purple-dark cursor-pointer'
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
                <i className="ri-calendar-check-line text-brand-purple"></i>
                <span>Reserva en línea · el pago se coordina con el médico</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <LoginModal context="booking" isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} onSuccess={handleLoginSuccess} onBeforeSendOtp={registerIntentBeforeOtp} />
      <WaitlistModal isOpen={showWaitlistModal} onClose={() => setShowWaitlistModal(false)} doctorId={doctorId} doctorName={doctorName} />
    </>
  );
}
