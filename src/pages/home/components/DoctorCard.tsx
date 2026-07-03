import { useNavigate } from 'react-router-dom';
import type { DoctorCard as DoctorCardData } from '../../../types/directory.types';
import DoctorAvatar from '../../../components/DoctorAvatar';

interface DoctorCardProps {
  doctor: DoctorCardData;
  rating?: number | null;
  reviewCount?: number;
  topRated?: boolean;
}

export default function DoctorCard({
  doctor,
  rating: ratingProp = null,
  reviewCount: reviewCountProp = 0,
  topRated = false,
}: DoctorCardProps) {
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
  const consultationFee = doctor.consultationFee || doctor.startingPrice || 0;
  const bookingEnabled = doctor.bookingEnabled;
  const isVerified = doctor.isVerified;

  // Mapear lucyStatus de DB a formato display
  const lucyStatus = doctor.lucyStatus?.toUpperCase() || 'LISTED_ONLY';

  // Precio: solo si existe y es > 0 (no mostrar "$0" ni vacíos).
  const hasFee = consultationFee > 0;

  // Rating y reviews — data real (Fase D)
  const rating = ratingProp ?? 0;
  const reviews = reviewCountProp;

  const handleNavigate = () => {
    if (!id) {
      console.error('ID de médico inválido:', id);
      return;
    }

    try {
      // URL amigable con slug cuando existe; fallback a UUID si es null.
      navigate(`/doctor/${doctor.slug || id}`);
    } catch (error) {
      console.error('Error al navegar:', error);
    }
  };

  const getStatusBadge = () => {
    if (lucyStatus === 'VERIFIED' || isVerified) {
      return (
        <div
          className="flex items-center gap-1 px-2.5 py-1.5 bg-brand-mint/30 text-brand-purple rounded-full text-xs font-bold shadow-sm"
          title="Perfil verificado por LucyCare"
          aria-label="Perfil verificado por LucyCare"
        >
          <i className="ri-verified-badge-fill"></i>
          <span>Verificado</span>
        </div>
      );
    }
    if (lucyStatus === 'BOOKING_ENABLED' || bookingEnabled) {
      return (
        <div className="flex items-center gap-1 px-2.5 py-1.5 bg-brand-mint/30 text-brand-purple rounded-full text-xs font-bold shadow-sm">
          <i className="ri-calendar-check-line"></i>
          <span>Agenda en línea</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-200 text-gray-600 rounded-full text-xs font-medium">
        <i className="ri-information-line"></i>
        <span>Sin agenda en línea</span>
      </div>
    );
  };

  return (
    <div
      className={`bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden border ${
        bookingEnabled ? 'border-brand-mint/50 hover:border-brand-mint' : 'border-gray-100'
      }`}
    >
      <div className="p-4 sm:p-5">
        <div className="flex gap-4">
          {/* Doctor Image */}
          <div className="flex-shrink-0">
            <DoctorAvatar
              name={name}
              photoUrl={doctor.avatarUrl}
              className="w-20 h-20 sm:w-24 sm:h-24"
              textClassName="text-2xl"
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

            {/* Rating real, o estado "sin calificaciones" (no dejar vacío) */}
            {reviews > 0 ? (
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <i className="ri-star-fill text-yellow-400 text-sm"></i>
                  <span className="text-sm font-medium text-gray-900">
                    {rating.toFixed(2)}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  ({reviews} {reviews === 1 ? 'reseña' : 'reseñas'})
                </span>
                {topRated && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-mint/30 text-brand-purple rounded-full text-[11px] font-semibold">
                    <i className="ri-award-fill"></i>
                    Mejor valorado
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 mb-2 text-xs text-gray-400">
                <i className="ri-star-line text-sm"></i>
                <span>Sin calificaciones aún</span>
              </div>
            )}

            {/* Location */}
            <div className="flex items-center gap-1.5 text-gray-600 mb-3">
              <i className="ri-map-pin-line text-base"></i>
              <span className="text-sm truncate">{locationDisplay}</span>
            </div>

            {/* Booking Status & CTA */}
            {bookingEnabled ? (
              <div className="space-y-2">
                {hasFee && (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 bg-brand-mint/20 rounded-lg">
                    <div className="flex items-center gap-2 text-xs text-brand-purple">
                      <i className="ri-calendar-check-line"></i>
                      <span>Agenda en línea</span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-600">Consulta</p>
                      <p className="text-sm font-bold text-gray-900">${consultationFee}</p>
                    </div>
                  </div>
                )}
                <button
                  onClick={handleNavigate}
                  className="w-full px-4 py-2.5 bg-brand-purple text-white font-semibold rounded-lg hover:bg-brand-purple-dark transition-colors cursor-pointer whitespace-nowrap relative z-10"
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
                  {hasFee && (
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Consulta</p>
                      <p className="text-sm font-bold text-gray-900">${consultationFee}</p>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleNavigate}
                  className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap relative z-10"
                >
                  Ver perfil
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
