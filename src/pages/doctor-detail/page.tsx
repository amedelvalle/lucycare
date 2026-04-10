import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDoctorDetail } from '../../hooks/useDirectory';
import ImageGallery from './components/ImageGallery';
import BookingCard from './components/BookingCard';
import ReviewsSection from './components/ReviewsSection';
import MobileBookingSheet from './components/MobileBookingSheet';
import { DoctorDetailSkeleton } from '../../components/skeletons/DirectorySkeletons';

export default function DoctorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showMobileBooking, setShowMobileBooking] = useState(false);

  // ─── DATOS REALES desde Supabase ───
  const { data: doctor, isLoading, error } = useDoctorDetail(id);

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
              src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
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

  // Error o no encontrado
  if (error || !doctor) {
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
  const isVerified = doctor.isVerified;
  const locationDisplay = [doctor.municipality, doctor.department].filter(Boolean).join(', ') || 'Sin ubicación';
  const fullAddress = [doctor.addressLine, doctor.municipality, doctor.department, 'El Salvador'].filter(Boolean).join(', ');
  const mapUrl = `https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q=${encodeURIComponent(fullAddress)}`;
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
              src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
              alt="Lucy Care"
              className="h-16 cursor-pointer"
              onClick={() => navigate('/')}
            />
          </div>
          <div className="flex items-center gap-4">
            <button className="hidden md:flex items-center gap-2 px-4 py-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-share-line text-lg"></i>
              <span>Compartir</span>
            </button>
            <button className="hidden md:flex items-center gap-2 px-4 py-2 hover:bg-gray-100 rounded-full transition-colors cursor-pointer whitespace-nowrap">
              <i className="ri-heart-line text-lg"></i>
              <span>Guardar</span>
            </button>
          </div>
        </div>
      </header>

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
              <h1 className="text-3xl font-semibold text-gray-900 mb-3">
                {doctor.fullName}
              </h1>

              {/* Status Badges */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {(lucyStatus === 'VERIFIED' || isVerified) && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-medium">
                    <i className="ri-verified-badge-fill"></i>
                    Verificado
                  </span>
                )}
                {canBook ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-medium">
                    <i className="ri-calendar-check-line"></i>
                    Agenda online
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-400 text-white rounded-full text-sm font-medium">
                    <i className="ri-calendar-close-line"></i>
                    Sin agenda online
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

            {/* Mobile Booking Card */}
            <div className="lg:hidden mb-8">
              <BookingCard
                doctorId={doctor.id}
                doctorName={doctor.fullName}
                consultationFee={consultationFee}
                phone={doctor.clinicPhone || ''}
                canBook={canBook}
                lucyStatus={lucyStatus}
                nextAvailableSlot={undefined}
                onLucyActivated={() => {}}
                services={doctor.services}
                clinicId={doctor.clinicId}
              />
            </div>

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
                        <i className="ri-graduation-cap-line text-[#3C2285] text-xl mt-0.5"></i>
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
                    {doctor.addressLine && (
                      <p className="text-gray-900 font-medium">{doctor.addressLine}</p>
                    )}
                    <p className="text-gray-600">{locationDisplay}</p>
                  </div>
                </div>
                {doctor.clinicPhone && (
                  <div className="flex items-center gap-3">
                    <i className="ri-phone-line text-[#3C2285] text-xl"></i>
                    <a href={`tel:${doctor.clinicPhone}`} className="text-gray-700 hover:text-[#3C2285] cursor-pointer">
                      {doctor.clinicPhone}
                    </a>
                  </div>
                )}

                {/* Map */}
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
              </div>
            </div>
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
              onLucyActivated={() => {}}
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

      {/* Mobile Booking Bottom Sheet */}
      <MobileBookingSheet
        isOpen={showMobileBooking}
        onClose={() => setShowMobileBooking(false)}
        doctorId={doctor.id}
        doctorName={doctor.fullName}
        consultationFee={consultationFee}
        phone={doctor.clinicPhone || ''}
        canBook={canBook}
        lucyStatus={lucyStatus}
        nextAvailableSlot={undefined}
        onLucyActivated={() => {}}
      />

      {/* Footer */}
      <footer className="bg-[#EDEDED] border-t border-gray-200 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center mb-4">
                <img
                  src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
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
                  <span className="font-medium text-gray-900">Acceso Gratuito:</span> Información y consultas con expertos médicos de calidad sin costo.
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Empresa</h4>
              <ul className="space-y-3">
                <li className="text-sm text-gray-600"><a href="#" className="hover:text-[#3C2285] cursor-pointer"><span className="font-medium text-gray-900">Acerca de</span> — Conectamos pacientes y profesionales.</a></li>
                <li className="text-sm text-gray-600"><a href="#" className="hover:text-[#3C2285] cursor-pointer"><span className="font-medium text-gray-900">Contacto</span> — Soporte para pacientes y médicos.</a></li>
                <li className="text-sm text-gray-600"><a href="#" className="hover:text-[#3C2285] cursor-pointer"><span className="font-medium text-gray-900">Privacidad</span> — Cómo protegemos tus datos.</a></li>
                <li className="text-sm text-gray-600"><a href="#" className="hover:text-[#3C2285] cursor-pointer"><span className="font-medium text-gray-900">Términos</span> — Condiciones de uso.</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Síguenos</h4>
              <div className="flex gap-4">
                <a href="#" className="w-10 h-10 flex items-center justify-center bg-white rounded-full hover:bg-emerald-100 transition-colors cursor-pointer">
                  <i className="ri-facebook-fill text-xl text-gray-700"></i>
                </a>
                <a href="#" className="w-10 h-10 flex items-center justify-center bg-white rounded-full hover:bg-emerald-100 transition-colors cursor-pointer">
                  <i className="ri-twitter-fill text-xl text-gray-700"></i>
                </a>
                <a href="#" className="w-10 h-10 flex items-center justify-center bg-white rounded-full hover:bg-emerald-100 transition-colors cursor-pointer">
                  <i className="ri-instagram-fill text-xl text-gray-700"></i>
                </a>
              </div>
            </div>
          </div>
          <div className="pt-8 border-t border-gray-300 text-center text-gray-600">
            <p>© 2024 Lucy Care. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
