import { useState } from 'react';
import { LUCYCARE_LOGO_SRC } from '@/lib/brand';
import { useParams, useNavigate } from 'react-router-dom';
import { useDoctorDetail } from '../../hooks/useDirectory';
import ImageGallery from './components/ImageGallery';
import BookingCard from './components/BookingCard';
import ClaimProfilePromptCard from './components/ClaimProfilePromptCard';
import ClaimedProfileNoticeCard from './components/ClaimedProfileNoticeCard';
import ReviewsSection from './components/ReviewsSection';
import MobileBookingSheet from './components/MobileBookingSheet';
import { DoctorDetailSkeleton } from '../../components/skeletons/DirectorySkeletons';
import DoctorAvatar from '../../components/DoctorAvatar';

export default function DoctorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showMobileBooking, setShowMobileBooking] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  // Compartir el perfil público, diferenciado por contexto:
  //  - móvil/touch (pointer: coarse) con share nativo → share sheet del sistema
  //    (el usuario elige WhatsApp/SMS/contactos/correo/…);
  //  - desktop → copiar el enlace al portapapeles (no abrir el panel nativo del
  //    sistema, que en escritorio se siente pesado), con confirmación.
  // El pointer se evalúa en el click (estable por dispositivo, fácil de validar).
  const handleShare = async () => {
    const url = window.location.href;
    const isTouch =
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches;

    if (isTouch && typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Perfil médico en Lucy',
          text: 'Mirá este perfil médico en Lucy.',
          url,
        });
      } catch {
        /* el usuario canceló el share nativo: no es un error */
      }
      return;
    }

    // Desktop (o móvil sin share nativo): copiar enlace.
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg('Enlace copiado');
    } catch {
      setShareMsg('No se pudo copiar el enlace');
    }
    setTimeout(() => setShareMsg(null), 2000);
  };

  // ─── DATOS REALES desde Supabase ───
  const { data: doctor, isLoading, error, refetch, isRefetching } = useDoctorDetail(id);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <header className="border-b border-gray-200 bg-white sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            >
              <i className="ri-arrow-left-line text-xl text-gray-700"></i>
            </button>
            <img
              src={LUCYCARE_LOGO_SRC}
              alt="Lucy Care"
              className="h-16 cursor-pointer"
              onClick={() => navigate('/')}
            />
          </div>
        </header>
        <DoctorDetailSkeleton />
      </div>
    );
  }

  // Error de carga (red/servidor): el perfil puede existir — ofrecer reintentar.
  // fetchDoctorDetail devuelve null para "no encontrado" (sin error) y LANZA
  // en fallas de red, así que acá los dos estados se distinguen limpio.
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center px-6">
          <i className="ri-wifi-off-line text-6xl text-gray-400 mb-4"></i>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No pudimos cargar el perfil</h2>
          <p className="text-gray-600 mb-6">Revisá tu conexión e intentá de nuevo</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="px-6 py-3 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {isRefetching ? 'Cargando…' : 'Reintentar'}
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No encontrado real (la consulta resolvió sin resultado)
  if (!doctor) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <i className="ri-error-warning-line text-6xl text-gray-400 mb-4"></i>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Médico no encontrado</h2>
          <p className="text-gray-600 mb-6">El médico que buscas no existe o no está disponible</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  // Mapear datos
  const canBook = doctor.bookingEnabled;
  const lucyStatus = doctor.lucyStatus?.toUpperCase() || 'LISTED_ONLY';
  // Gate explícito para la card de reclamo: un estado faltante/null NO debe
  // hacer fail-open a 'LISTED_ONLY' (a diferencia del default de `lucyStatus`,
  // que existe por compatibilidad de badges/BookingCard).
  const isListedOnly = doctor.lucyStatus?.toUpperCase() === 'LISTED_ONLY';
  const isVerified = doctor.isVerified;
  const locationDisplay = [doctor.municipality, doctor.department].filter(Boolean).join(', ') || 'Sin ubicación';
  const fullAddress = [doctor.addressLine, doctor.municipality, doctor.department, 'El Salvador'].filter(Boolean).join(', ');
  const mapUrl = `https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${encodeURIComponent(fullAddress)}`;
  // El mapa embebido depende de geocoding por texto (no hay lat/lng). Solo lo
  // mostramos si la dirección es útil; si no, evitamos el "mapa de ciudad/país"
  // con falsa precisión. Ver isUsefulAddress() abajo.
  const addressUseful = isUsefulAddress(doctor.addressLine);
  const hasArea = !!(doctor.municipality || doctor.department);
  const areaMapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [doctor.municipality, doctor.department, 'El Salvador'].filter(Boolean).join(', ')
  )}`;
  const consultationFee = doctor.consultationFee || doctor.startingPrice || 0;

  // Imágenes para la galería
  const galleryImages = doctor.images.length > 0
    ? doctor.images.map(img => img.imageUrl)
    : [];

  // Educación (JSONB → array de strings para display)
  const educationList = (doctor.education || []).map(
    (edu) => `${edu.degree || ''} - ${edu.institution || ''}${edu.year ? ` (${edu.year})` : ''}`
  ).filter(e => e.trim() !== '-');

  return (
    <div className="min-h-screen bg-white pb-20 lg:pb-0">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            >
              <i className="ri-arrow-left-line text-xl text-gray-700"></i>
            </button>
            <img
              src={LUCYCARE_LOGO_SRC}
              alt="Lucy Care"
              className="h-16 cursor-pointer"
              onClick={() => navigate('/')}
            />
          </div>
          {/* Compartir (funcional): móvil/touch → share nativo; desktop → copiar
              enlace. Discreto en móvil (solo ícono); en desktop, como la acción
              es copiar, la etiqueta dice "Copiar enlace". */}
          <button
            onClick={handleShare}
            title="Copiar enlace del perfil"
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer whitespace-nowrap text-gray-700"
          >
            <i className="ri-share-line text-lg"></i>
            <span className="hidden sm:inline">Copiar enlace</span>
          </button>
        </div>
      </header>

      {/* Confirmación transitoria del fallback de copiar enlace (el share nativo
          ya da su propio feedback). Centrada, visible en desktop y móvil. */}
      {shareMsg && (
        <div
          role="status"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] bg-gray-900 text-white text-sm px-4 py-2 rounded-full shadow-lg"
        >
          {shareMsg}
        </div>
      )}

      {/* Image Gallery */}
      {galleryImages.length > 0 && (
        <ImageGallery images={galleryImages} doctorName={doctor.fullName} />
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left Column - Doctor Info */}
          <div className="lg:col-span-2">
            {/* Title Section */}
            <div className="mb-8">
              <div className="flex items-start gap-4 sm:gap-5">
                {/* Foto del médico (o placeholder de iniciales como en la tarjeta
                    del directorio). avatarUrl ya viene en fetchDoctorDetail. */}
                <DoctorAvatar
                  name={doctor.fullName}
                  photoUrl={doctor.avatarUrl}
                  className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0"
                  textClassName="text-2xl"
                />
                <div className="flex-1 min-w-0">
                  <h1 className="text-3xl font-semibold text-gray-900 mb-3">
                    {doctor.fullName}
                  </h1>

                  {/* Status Badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                {(lucyStatus === 'VERIFIED' || isVerified) && (
                  <span
                    className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-medium"
                    title="Perfil verificado por LucyCare"
                    aria-label="Perfil verificado por LucyCare"
                  >
                    <i className="ri-verified-badge-fill"></i>
                    Verificado por LucyCare
                  </span>
                )}
                {canBook ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-medium">
                    <i className="ri-calendar-check-line"></i>
                    Agenda en línea
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-400 text-white rounded-full text-sm font-medium">
                    <i className="ri-calendar-close-line"></i>
                    Sin agenda en línea
                  </span>
                )}
              </div>

                  <div className="flex flex-wrap items-center gap-4 text-gray-600">
                    <span>{doctor.specialty || 'Medicina General'}</span>
                    {doctor.experienceYears && (
                      <>
                        <span>•</span>
                        <span>{doctor.experienceYears} años de experiencia</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* CTA: Reclamar perfil (solo cuando aún está listed_only).
                La card decide internamente la visibilidad por viewer:
                  - dueño logueado → bloque completo (variant 'full');
                  - cualquier otro autenticado / mientras resuelve → nada.
                El visitante anónimo NO ve este bloque destacado: para él hay una
                entrada discreta al final de la columna (variant 'discrete'). */}
            {isListedOnly && (
              <ClaimProfilePromptCard
                doctorId={doctor.id}
                doctorName={doctor.fullName}
                doctorProfileId={doctor.profileId}
                variant="full"
              />
            )}

            {/* Aviso: perfil reclamado pero todavía sin agenda online ni verificación.
                La card decide internamente si mostrar la variante owner (CTA panel)
                o la pública (neutra) según auth.uid() vs doctor.profileId. */}
            {lucyStatus === 'CLAIMED' && !canBook && !isVerified && doctor.profileId && (
              <div className="mb-8">
                <ClaimedProfileNoticeCard doctorProfileId={doctor.profileId} />
              </div>
            )}

            {/* Bloque de contacto móvil — SOLO para médicos NO reservables.
                Para reservables, el CTA móvil vive en la barra fija inferior
                "Reservar cita" + bottom sheet (no se duplica el formulario
                arriba para no empujar la información de confianza bajo el fold).
                Los no reservables conservan acá su única acción: "Sin agenda en
                línea" + Llamar/WhatsApp/Lista de espera. */}
            {!canBook && (
              <div className="lg:hidden mb-8">
                <BookingCard
                  doctorId={doctor.id}
                  doctorName={doctor.fullName}
                  consultationFee={consultationFee}
                  phone={doctor.clinicPhone || ''}
                  canBook={canBook}
                  lucyStatus={lucyStatus}
                  nextAvailableSlot={undefined}
                  services={doctor.services}
                  clinicId={doctor.clinicId}
                />
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-gray-200 my-8"></div>

            {/* About Section */}
            {doctor.bio && (
              <>
                <div className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">Acerca del médico</h2>
                  <p className="text-gray-700 leading-relaxed">{doctor.bio}</p>
                </div>
                <div className="border-t border-gray-200 my-8"></div>
              </>
            )}

            {/* Services Section */}
            {doctor.services.length > 0 && (
              <>
                <div className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">Servicios que ofrece</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {doctor.services.map((service) => (
                      <div key={service.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                        <i className="ri-check-line text-emerald-600 text-xl mt-0.5"></i>
                        <div className="flex-1">
                          <span className="text-gray-900 font-medium">{service.name}</span>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm text-gray-500">{service.durationMinutes} min</span>
                            {service.price && (
                              <>
                                <span className="text-sm text-gray-400">•</span>
                                <span className="text-sm font-semibold text-gray-900">${service.price}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-gray-200 my-8"></div>
              </>
            )}

            {/* Education Section */}
            {educationList.length > 0 && (
              <>
                <div className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">Formación académica</h2>
                  <div className="space-y-3">
                    {educationList.map((edu, index) => (
                      <div key={index} className="flex items-start gap-3">
                        <i className="ri-graduation-cap-line text-emerald-700 text-xl mt-0.5"></i>
                        <span className="text-gray-700">{edu}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-gray-200 my-8"></div>
              </>
            )}

            {/* Languages Section */}
            {doctor.languages.length > 0 && (
              <>
                <div className="mb-8">
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4">Idiomas</h2>
                  <div className="flex flex-wrap gap-2">
                    {doctor.languages.map((lang, index) => (
                      <span
                        key={index}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-full"
                      >
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="border-t border-gray-200 my-8"></div>
              </>
            )}

            {/* Location Section */}
            <div className="mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Ubicación</h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <i className="ri-map-pin-line text-2xl text-emerald-700 mt-1"></i>
                  <div>
                    {addressUseful && (
                      <p className="text-gray-900 font-medium">{doctor.addressLine}</p>
                    )}
                    <p className="text-gray-600">{locationDisplay}</p>
                  </div>
                </div>
                {doctor.clinicPhone && (
                  <div className="flex items-center gap-3">
                    <i className="ri-phone-line text-emerald-700 text-xl"></i>
                    <a href={`tel:${doctor.clinicPhone}`} className="text-gray-700 hover:text-emerald-700 cursor-pointer">
                      {doctor.clinicPhone}
                    </a>
                  </div>
                )}

                {/* Mapa:
                    - dirección útil → iframe embebido (pin del consultorio);
                    - sin dirección útil pero con municipio/departamento → link
                      discreto de "zona aproximada" (no simula ubicación exacta);
                    - sin nada → ni iframe ni link (el texto ya dice "Sin ubicación"). */}
                {addressUseful ? (
                  <div className="mt-4 rounded-xl overflow-hidden h-80">
                    <iframe
                      src={mapUrl}
                      width="100%"
                      height="100%"
                      style={{ border: 0 }}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      title="Ubicación del consultorio"
                    ></iframe>
                  </div>
                ) : hasArea ? (
                  <a
                    href={areaMapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                  >
                    <i className="ri-map-pin-line"></i>
                    Ver zona aproximada en Google Maps
                  </a>
                ) : null}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 my-8"></div>

            {/* Calificaciones (data real) */}
            <div className="mb-8">
              <ReviewsSection doctorId={doctor.id} />
            </div>

            {/* Entrada discreta de reclamo para el visitante anónimo (fuera del
                primer pantallazo). La card solo renderiza para 'anon'; para el
                dueño/otros autenticados devuelve null (sin gap fantasma). */}
            {isListedOnly && (
              <ClaimProfilePromptCard
                doctorId={doctor.id}
                doctorName={doctor.fullName}
                doctorProfileId={doctor.profileId}
                variant="discrete"
              />
            )}
          </div>

          {/* Right Column - Booking Card (Desktop only) */}
          <div className="hidden lg:block lg:col-span-1">
            <BookingCard
              doctorId={doctor.id}
              doctorName={doctor.fullName}
              consultationFee={consultationFee}
              phone={doctor.clinicPhone || ''}
              canBook={canBook}
              lucyStatus={lucyStatus}
              nextAvailableSlot={undefined}
              services={doctor.services}
              clinicId={doctor.clinicId}
            />
          </div>
        </div>
      </div>

      {/* Mobile Fixed Bottom Bar */}
      {canBook && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-4 z-50 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-xs text-gray-600">Desde</p>
              <p className="text-lg font-bold text-gray-900">${consultationFee} USD</p>
            </div>
            <button
              onClick={() => setShowMobileBooking(true)}
              className="flex-1 px-6 py-3 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap font-semibold"
            >
              Reservar cita
            </button>
          </div>
        </div>
      )}

      {/* Mobile Booking Bottom Sheet — flujo real de reserva (BookingCard) */}
      <MobileBookingSheet
        isOpen={showMobileBooking}
        onClose={() => setShowMobileBooking(false)}
        doctorId={doctor.id}
        doctorName={doctor.fullName}
        consultationFee={consultationFee}
        phone={doctor.clinicPhone || ''}
        canBook={canBook}
        lucyStatus={lucyStatus}
        services={doctor.services}
        clinicId={doctor.clinicId}
      />

      {/* Footer */}
      <footer className="bg-[#EDEDED] border-t border-gray-200 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center mb-4">
                <img
                  src={LUCYCARE_LOGO_SRC}
                  alt="Lucy Care"
                  className="h-16"
                />
              </div>
              <p className="text-gray-600">
                Tu directorio médico de confianza para encontrar los mejores profesionales de la salud
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Nuestro valor</h4>
              <ul className="space-y-3">
                <li className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">Red de Profesionales de Salud:</span> Acceso a una red de especialistas altamente calificados y dedicados.
                </li>
                <li className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">Información Valiosa:</span> Acceso a datos y análisis detallados para tomar decisiones informadas.
                </li>
                <li className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">Búsqueda sin costo:</span> Explorar el directorio de Lucy es gratis. El precio de la consulta lo define cada médico.
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Empresa</h4>
              <ul className="space-y-3">
                <li className="text-sm text-gray-600"><span className="font-medium text-gray-900">Acerca de</span> — Conectamos pacientes y profesionales.</li>
                <li className="text-sm text-gray-600"><span className="font-medium text-gray-900">Contacto</span> — Soporte para pacientes y médicos.</li>
                <li className="text-sm text-gray-600"><a href="/privacidad" className="text-gray-600 hover:text-gray-900 cursor-pointer"><span className="font-medium text-gray-900">Privacidad</span> — Cómo protegemos tus datos.</a></li>
                <li className="text-sm text-gray-600"><span className="font-medium text-gray-900">Términos</span> — Condiciones de uso.</li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-gray-300 text-center text-gray-600">
            <p>© {new Date().getFullYear()} Lucy Care. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Direcciones triviales que no representan una ubicación real.
const TRIVIAL_ADDRESSES = new Set([
  'sin ubicación', 'sin ubicacion', 'n/a', 'na', 'no disponible', '-', '.', '...',
]);

/**
 * ¿La dirección libre sirve para mostrar un mapa embebido? Validación simple
 * frontend (no toca la DB): mínimo 6 chars, debe contener letras/números y no
 * ser un valor trivial. Si no es útil, evitamos el mapa de ciudad/país con
 * falsa precisión y caemos al texto + link de zona aproximada.
 */
function isUsefulAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const trimmed = addr.trim();
  if (trimmed.length < 6) return false;
  if (!/[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]/.test(trimmed)) return false;
  if (TRIVIAL_ADDRESSES.has(trimmed.toLowerCase())) return false;
  return true;
}
