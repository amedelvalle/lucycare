import { useState, useEffect } from 'react';
import { LUCYCARE_LOGO_SRC } from '@/lib/brand';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAllDoctorRatingStats } from '../../services/reviews.service';
import SearchSection from './components/SearchSection';
import DoctorCard from './components/DoctorCard';
import AffiliationRequestModal from './components/AffiliationRequestModal';
import LoginModal from '../doctor-detail/components/LoginModal';
import PatientAccountMenu from '../../components/PatientAccountMenu';
import { useDoctors } from '../../hooks/useDirectory';
import { getCurrentAuthUser, signOut, onAuthStateChange } from '../../services/auth.service';
import type { AuthUser } from '../../services/auth.service';
import { DoctorGridSkeleton } from '../../components/skeletons/DirectorySkeletons';
import type { DirectoryFilters } from '../../types/directory.types';

// Render incremental del directorio (paginación frontend-only): cuántos médicos
// se muestran por tanda. NO es paginación server-side — búsqueda, completitud,
// toggle y orden por rating operan sobre el set completo ya cargado en cliente.
const PAGE_SIZE = 12;

export default function Home() {
  const navigate = useNavigate();
  const [showAffiliationModal, setShowAffiliationModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedMunicipality, setSelectedMunicipality] = useState('');
  const [onlineBookingOnly, setOnlineBookingOnly] = useState(false);
  // "Más cercanos" se removió: no hay lat/lng de clínicas ni geolocalización
  // del usuario, así que no había con qué ordenar (caía a orden default).
  // Backlog: reintroducir cuando exista geo + UX de permisos de ubicación.
  const [sortBy, setSortBy] = useState<'default' | 'mejor_valorados'>('default');

  // Render incremental: cuántos médicos del set filtrado se muestran.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const isAuthenticated = !!currentUser;

  // ─── DATOS REALES desde Supabase ───
  const filters: DirectoryFilters = {
    search: searchTerm,
    specialtyId: selectedSpecialty || null,
    departmentId: selectedDepartment || null,
    municipalityId: selectedMunicipality || null,
  };

  const { data: doctors = [], isLoading, error } = useDoctors(filters);

  // Stats de calificación de todos los médicos (estrellas + ranking)
  const { data: ratingStats = {} } = useQuery({
    queryKey: ['all-doctor-rating-stats'],
    queryFn: getAllDoctorRatingStats,
    staleTime: 1000 * 60 * 5,
  });

  // Filtro de booking online (client-side, ya que es un toggle simple)
  const baseDoctors = onlineBookingOnly
    ? doctors.filter((d) => d.bookingEnabled)
    : doctors;

  // Orden "Mejor valorados": ordena TODOS los médicos por score real
  // (desc). No filtra: un médico con 4.30 y 1 reseña sigue apareciendo,
  // solo que sin badge. Los médicos sin reseñas quedan al final.
  const filteredDoctors =
    sortBy === 'mejor_valorados'
      ? [...baseDoctors].sort((a, b) => {
          const sa = ratingStats[a.id]?.scoreAdjusted;
          const sb = ratingStats[b.id]?.scoreAdjusted;
          if (sa == null && sb == null) return 0;
          if (sa == null) return 1; // sin reseñas → al final
          if (sb == null) return -1;
          return sb - sa;
        })
      : baseDoctors;

  // Render incremental: solo se montan las primeras `visibleCount` cards.
  const visibleDoctors = filteredDoctors.slice(0, visibleCount);

  // ── Contadores honestos del directorio ──
  // total de resultados del set actual (ya filtrado server-side por
  // búsqueda/especialidad/ubicación, y client-side por el toggle).
  const totalResults = filteredDoctors.length;
  const isFiltered =
    !!searchTerm || !!selectedSpecialty || !!selectedDepartment || !!selectedMunicipality || onlineBookingOnly;
  // Médicos con agenda en línea dentro del set de búsqueda/ubicación (sin
  // depender del toggle): dato real para diferenciar "publicados" de "reservables".
  const bookableCount = doctors.filter((d) => d.bookingEnabled).length;
  // Sustantivo correcto (sin claims): "resultado(s)" si hay filtros,
  // "médico(s) publicado(s)" si no.
  const resultNoun = isFiltered
    ? (totalResults === 1 ? 'resultado' : 'resultados')
    : (totalResults === 1 ? 'médico publicado' : 'médicos publicados');

  // Título neutro/comercial + conteo como línea secundaria discreta (sin claims
  // inflados, pero sin convertir "N médicos publicados" en el mensaje principal).
  const directoryTitle = searchTerm
    ? 'Resultados para tu búsqueda'
    : onlineBookingOnly
      ? 'Médicos con agenda en línea'
      : isFiltered
        ? 'Resultados'
        : 'Médicos en Lucy';
  let directoryCount = `Mostrando ${visibleDoctors.length} de ${totalResults} ${resultNoun}`;
  if (searchTerm) directoryCount += ` para "${searchTerm}"`;
  else if (!isFiltered && bookableCount > 0) directoryCount += ` · ${bookableCount} con agenda en línea`;

  // Al cambiar búsqueda / filtros / toggle / orden, volver a la primera tanda.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchTerm, selectedSpecialty, selectedDepartment, selectedMunicipality, onlineBookingOnly, sortBy]);

  // ─── AUTH REAL con Supabase ───
  useEffect(() => {
    // Verificar sesión actual al cargar
    getCurrentAuthUser().then(setCurrentUser);

    // Escuchar cambios de sesión (login, logout)
    const { data: { subscription } } = onAuthStateChange(setCurrentUser);
    return () => subscription.unsubscribe();
  }, []);

  const handleLoginSuccess = () => {
    setShowLoginModal(false);
    // El usuario se actualiza automáticamente via onAuthStateChange
  };

  const handleLogout = async () => {
    await signOut();
    setCurrentUser(null);
  };

  const handleDoctorSelect = (doctorId: string) => {
    navigate(`/doctor/${doctorId}`);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <img
            src={LUCYCARE_LOGO_SRC}
            alt="Lucy Care"
            className="h-10 sm:h-16 cursor-pointer shrink-0"
          />
          {/* Navigation. flex-wrap + min-w-0 evita que las pills (whitespace-nowrap)
              desborden el viewport en móvil: si no caben, envuelven en vez de
              forzar scroll horizontal. justify-end las mantiene alineadas a la derecha. */}
          <nav className="flex flex-wrap items-center justify-end gap-2 sm:gap-4 min-w-0">
            {isAuthenticated && currentUser ? (
              <>
                {currentUser.role === 'patient' ? (
                  // Dropdown "Mi cuenta" para pacientes. Engloba mostrar nombre,
                  // link a Mis atenciones y cerrar sesión.
                  <PatientAccountMenu displayName={currentUser.name || currentUser.phone} />
                ) : (
                  <>
                    <span className="text-sm text-gray-700 hidden sm:inline">
                      {currentUser.name || currentUser.phone}
                    </span>
                    {(currentUser.role === 'doctor' || currentUser.role === 'assistant') && (
                      <button
                        onClick={() => navigate('/panel')}
                        className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-brand-purple text-white hover:bg-brand-purple-dark rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium"
                      >
                        Mi panel
                      </button>
                    )}
                    {currentUser.role === 'admin' && (
                      <button
                        onClick={() => navigate('/admin')}
                        className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-brand-purple text-white hover:bg-brand-purple-dark rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium"
                      >
                        Panel Admin
                      </button>
                    )}
                    <button
                      onClick={handleLogout}
                      className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium"
                    >
                      Cerrar sesión
                    </button>
                  </>
                )}
              </>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium"
              >
                Iniciar sesión
              </button>
            )}
            <button
              onClick={() => setShowAffiliationModal(true)}
              title="Soy médico y quiero aparecer en Lucy"
              className={`${isAuthenticated ? 'hidden sm:inline-flex' : 'inline-flex'} items-center px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-white text-brand-purple border border-brand-purple hover:bg-brand-mint/20 rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium`}
            >
              {/* Etiqueta corta en mobile, completa en desktop.
                  El modal mantiene la copy completa "Soy médico,
                  quiero aparecer en Lucy". */}
              <span className="md:hidden">Soy médico</span>
              <span className="hidden md:inline">Soy médico, quiero aparecer</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <div className="relative bg-gradient-to-br from-brand-mint/25 to-white py-12 sm:py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-brand-purple mb-3 sm:mb-4 leading-tight">
              Encuentra al médico perfecto para ti
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-gray-600 mb-8 sm:mb-12">
              Busca por nombre, especialidad o ubicación. Reserva en línea con los médicos que tienen agenda activa.
            </p>
          </div>

          {/* Search Section */}
          <SearchSection
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedSpecialty={selectedSpecialty}
            setSelectedSpecialty={setSelectedSpecialty}
            selectedDepartment={selectedDepartment}
            setSelectedDepartment={setSelectedDepartment}
            selectedMunicipality={selectedMunicipality}
            setSelectedMunicipality={setSelectedMunicipality}
            onlineBookingOnly={onlineBookingOnly}
            setOnlineBookingOnly={setOnlineBookingOnly}
            onDoctorSelect={handleDoctorSelect}
          />
        </div>
      </div>

      {/* Results Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 sm:mb-8 gap-4">
          <div>
            {isLoading ? (
              <h2 className="text-xl sm:text-2xl font-semibold text-gray-400">
                Buscando médicos...
              </h2>
            ) : (
              <>
                <h2 className="text-xl sm:text-2xl font-semibold text-gray-900">
                  {directoryTitle}
                </h2>
                <p className="text-sm text-gray-600 mt-1">{directoryCount}</p>
                {onlineBookingOnly && (
                  <p className="text-sm text-gray-500 mt-0.5">
                    Reservá directamente con médicos que tienen agenda en línea.
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <span className="text-sm sm:text-base text-gray-600">Ordenar por:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg text-gray-700 cursor-pointer pr-8 focus:border-brand-purple focus:outline-none"
            >
              <option value="default">{searchTerm ? 'Mejor coincidencia' : 'Disponibilidad'}</option>
              <option value="mejor_valorados">Mejor valorados</option>
            </select>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Error al cargar médicos</h3>
            <p className="text-sm text-gray-600 mb-4">
              Hubo un problema al conectar con el servidor. Intenta de nuevo.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-brand-purple text-white font-semibold rounded-lg hover:bg-brand-purple-dark transition-colors cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Loading State */}
        {isLoading && !error && <DoctorGridSkeleton count={8} />}

        {/* Doctors Grid */}
        {!isLoading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {visibleDoctors.map((doctor) => {
              const st = ratingStats[doctor.id];
              return (
                <DoctorCard
                  key={doctor.id}
                  doctor={doctor}
                  rating={st?.scoreAdjusted ?? null}
                  reviewCount={st?.nReviews ?? 0}
                  topRated={st?.isTopRated ?? false}
                />
              );
            })}
          </div>
        )}

        {/* Render incremental: "Mostrar más médicos" (el conteo "Mostrando N de M"
            vive ahora en la línea bajo el título de la sección). */}
        {!isLoading && !error && visibleCount < filteredDoctors.length && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="px-6 py-2.5 bg-brand-purple text-white font-semibold rounded-lg hover:bg-brand-purple-dark transition-colors cursor-pointer whitespace-nowrap"
            >
              Mostrar más médicos
            </button>
          </div>
        )}

        {!isLoading && !error && filteredDoctors.length === 0 && (
          <div className="text-center py-16 sm:py-20">
            <i className="ri-search-line text-5xl sm:text-6xl text-gray-300 mb-4"></i>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">No se encontraron resultados</h3>
            <p className="text-sm sm:text-base text-gray-600 mb-4">
              {searchTerm
                ? `No encontramos médicos que coincidan con "${searchTerm}"`
                : 'Intenta ajustar tus filtros de búsqueda'}
            </p>
            {(searchTerm || selectedSpecialty || selectedDepartment || selectedMunicipality) && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setSelectedSpecialty('');
                  setSelectedDepartment('');
                  setSelectedMunicipality('');
                }}
                className="px-6 py-2.5 bg-brand-purple text-white font-semibold rounded-lg hover:bg-brand-purple-dark transition-colors cursor-pointer whitespace-nowrap"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-brand-gray border-t border-gray-200 mt-12 sm:mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8 mb-6 sm:mb-8">
            <div>
              <div className="flex items-center mb-4">
                <img
                  src={LUCYCARE_LOGO_SRC}
                  alt="Lucy Care"
                  className="h-14 sm:h-16"
                />
              </div>
              <p className="text-sm sm:text-base text-gray-600">
                Tu directorio médico de confianza para encontrar los mejores profesionales de la salud
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">Nuestro valor</h4>
              <ul className="space-y-3">
                <li className="text-sm sm:text-base text-gray-600">
                  <span className="font-medium text-gray-900">Red de Profesionales de Salud:</span> Acceso a una red de especialistas altamente calificados y dedicados.
                </li>
                <li className="text-sm sm:text-base text-gray-600">
                  <span className="font-medium text-gray-900">Información Valiosa:</span> Acceso a datos y análisis detallados para tomar decisiones informadas.
                </li>
                <li className="text-sm sm:text-base text-gray-600">
                  <span className="font-medium text-gray-900">Búsqueda sin costo:</span> Explorar el directorio de Lucy es gratis. El precio de la consulta lo define cada médico.
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">Empresa</h4>
              <ul className="space-y-3">
                <li className="text-sm sm:text-base text-gray-600">
                  <span className="font-medium text-gray-900">Acerca de</span> — Conectamos pacientes y profesionales para una atención de calidad en una sola plataforma.
                </li>
                <li className="text-sm sm:text-base text-gray-600">
                  <span className="font-medium text-gray-900">Contacto</span> — Soporte para pacientes y médicos.
                </li>
                <li className="text-sm sm:text-base text-gray-600">
                  <a href="/privacidad" className="text-gray-600 hover:text-gray-900 cursor-pointer">
                    <span className="font-medium text-gray-900">Privacidad</span> — Cómo protegemos tus datos y tus derechos.
                  </a>
                </li>
                <li className="text-sm sm:text-base text-gray-600">
                  <span className="font-medium text-gray-900">Términos</span> — Condiciones de uso del servicio.
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-6 sm:pt-8 border-t border-gray-300 text-center text-xs sm:text-sm text-gray-600">
            <p>© {new Date().getFullYear()} Lucy Care. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>

      {/* Login Modal (AUTH-P1A: contexto obligatorio — header/Home = ingreso genérico) */}
      <LoginModal
        context="login"
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={handleLoginSuccess}
      />

      {/* Registration Modal */}
      {showAffiliationModal && (
        <AffiliationRequestModal onClose={() => setShowAffiliationModal(false)} />
      )}
    </div>
  );
}
