import { useNavigate } from 'react-router-dom';
import type { DoctorCard as DoctorCardData } from '../../../types/directory.types';
import { formatNextSlot } from '../../../utils/date';

interface DoctorCardProps {
  doctor: DoctorCardData;
}

export default function DoctorCard({ doctor }: DoctorCardProps) {
  // Defensa: si no hay doctor, no renderizar nada
  if (!doctor) {
    if (import.meta.env.DEV) {
      console.warn('DoctorCard: doctor prop is undefined');
    }
    return null;
  }

  const navigate = useNavigate();

  // Mapear datos de Supabase a variables locales
  const id = doctor.id;
  const name = doctor.fullName;
  const specialty = doctor.specialty || 'Medicina General';
  const locationDisplay = [doctor.municipality, doctor.department]
    .filter(Boolean)
    .join(', ') || 'Sin ubicación';
  const image = doctor.avatarUrl || 'https://readdy.ai/api/search-image?query=Professional%20doctor%20silhouette%20placeholder%20avatar%20medical%20professional%20neutral%20gray%20background%20clean%20minimal&width=400&height=400&seq=placeholder&orientation=squarish';
  const consultationFee = doctor.consultationFee || doctor.startingPrice || 0;
  const bookingEnabled = doctor.bookingEnabled;
  const isVerified = doctor.isVerified;

  // Mapear lucyStatus de DB a formato display
  const lucyStatus = doctor.lucyStatus?.toUpperCase() || 'LISTED_ONLY';

  // TODO Sprint 2: nextAvailableSlot vendrá del motor de agenda
  const nextAvailableSlot: string | undefined = undefined;
  const nextSlot = nextAvailableSlot ? formatNextSlot(nextAvailableSlot) : null;

  // Rating y reviews — Fase 2
  const rating = 0;
  const reviews = 0;

  const handleNavigate = () => {
    if (!id) {
      console.error('ID de médico inválido:', id);
      return;
    }

    try {
      navigate(`/doctor/${id}`);
    } catch (error) {
      console.error('Error al navegar:', error);
    }
  };

  const getStatusBadge = () => {
    if (lucyStatus === 'VERIFIED' || isVerified) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold shadow-sm">
          <i className="ri-verified-badge-fill"></i>
          <span>Verificado</span>
        </div>
      );
    }
    if (lucyStatus === 'BOOKING_ENABLED' || bookingEnabled) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold shadow-sm">
          <i className="ri-calendar-check-line"></i>
          <span>Agenda online</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-200 text-gray-600 rounded-full text-xs font-medium">
        <i className="ri-information-line"></i>
        <span>Sin agenda online</span>
      </div>
    );
  };

  return (
    <div
      className={`bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden border ${
        bookingEnabled ? 'border-emerald-200 hover:border-emerald-400' : 'border-gray-100'
      }`}
    >
      <div className="p-4 sm:p-5">
        <div className="flex gap-4">
          {/* Doctor Image */}
          <div className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0">
            <img
              src={image}
              alt={name}
              className="w-full h-full object-cover object-top rounded-lg"
            />
          </div>

          {/* Doctor Info */}
          <div className="flex-1 min-w-0">
            {/* Nombre y Badge - Layout responsive */}
            <div className="mb-2">
              {/* En móvil: nombre completo arriba, badge abajo */}
              <div className="md:hidden">
                <h3 className="text-base font-semibold text-gray-900 leading-snug line-clamp-2 mb-2">
                  {name}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {getStatusBadge()}
                </div>
              </div>

              {/* En desktop: nombre y badge en la misma línea */}
              <div className="hidden md:flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">
                    {name}
                  </h3>
                </div>
                {getStatusBadge()}
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-2">{specialty}</p>

            {/* Rating - Solo mostrar si hay reviews reales */}
            {reviews > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1">
                  <i className="ri-star-fill text-yellow-400 text-sm"></i>
                  <span className="text-sm font-medium text-gray-900">{rating}</span>
                </div>
                <span className="text-xs text-gray-500">({reviews} reseñas)</span>
              </div>
            )}

            {/* Location */}
            <div className="flex items-center gap-1.5 text-gray-600 mb-3">
              <i className="ri-map-pin-line text-base"></i>
              <span className="text-sm truncate">{locationDisplay}</span>
            </div>

            {/* Booking Status & CTA */}
            {bookingEnabled && nextSlot ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-lg">
                  <i className="ri-time-line text-emerald-700"></i>
                  <div className="flex-1">
                    <p className="text-xs text-slate-700">Próximo disponible</p>
                    <p className="text-sm font-bold text-emerald-700">{nextSlot}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-600">Consulta</p>
                    <p className="text-sm font-bold text-gray-900">${consultationFee}</p>
                  </div>
                </div>
                <button
                  onClick={handleNavigate}
                  className="w-full px-4 py-2.5 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap relative z-10"
                >
                  <i className="ri-calendar-line mr-2"></i>
                  Reservar cita
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <i className="ri-information-line"></i>
                    <span>Perfil informativo</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Consulta</p>
                    <p className="text-sm font-bold text-gray-900">${consultationFee}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleNavigate}
                    className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap relative z-10"
                  >
                    Ver perfil
                  </button>
                </div>
                <p className="text-xs text-gray-500 text-center">
                  Reserva online disponible solo con agenda activa en Lucy
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
