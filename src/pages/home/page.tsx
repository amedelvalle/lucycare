import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchSection from './components/SearchSection';
import DoctorCard from './components/DoctorCard';
import DoctorRegistrationModal from './components/DoctorRegistrationModal';
import LoginModal from '../doctor-detail/components/LoginModal';
import { useDoctors } from '../../hooks/useDirectory';
import { getCurrentUser, clearCurrentUser } from '../../utils/auth';
import { DoctorGridSkeleton } from '../../components/skeletons/DirectorySkeletons';
import type { DirectoryFilters } from '../../types/directory.types';

export default function Home() {
  const navigate = useNavigate();
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSpecialty, setSelectedSpecialty] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedMunicipality, setSelectedMunicipality] = useState('');
  const [onlineBookingOnly, setOnlineBookingOnly] = useState(false);

  // ─── DATOS REALES desde Supabase ───
  const filters: DirectoryFilters = {
    search: searchTerm,
    specialtyId: selectedSpecialty || null,
    departmentId: selectedDepartment || null,
    municipalityId: selectedMunicipality || null,
  };

  const { data: doctors = [], isLoading, error } = useDoctors(filters);

  // Filtro de booking online (client-side, ya que es un toggle simple)
  const filteredDoctors = onlineBookingOnly
    ? doctors.filter((d) => d.bookingEnabled)
    : doctors;

  // Verificar autenticación al cargar
  useEffect(() => {
    const user = getCurrentUser();
    setIsAuthenticated(!!user);
  }, []);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setShowLoginModal(false);
  };

  const handleLogout = () => {
    clearCurrentUser();
    setIsAuthenticated(false);
  };

  const handleDoctorSelect = (doctorId: string) => {
    navigate(`/doctor/${doctorId}`);
  };

  const currentUser = getCurrentUser();

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <img
            src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
            alt="Lucy Care"
            className="h-14 sm:h-16 cursor-pointer"
          />
          {/* Navigation */}
          <nav className="flex items-center gap-2 sm:gap-4">
            {isAuthenticated && currentUser ? (
              <>
                <span className="text-sm text-gray-700 hidden sm:inline">
                  {currentUser.name}
                </span>
                <button
                  onClick={handleLogout}
                  className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium"
                >
                  Cerrar sesión
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-emerald-700 text-white hover:bg-emerald-800 rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium"
              >
                Iniciar sesión
              </button>
            )}
            <button
              onClick={() => setShowRegistrationModal(true)}
              className="px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-[#3C2285] text-white hover:bg-[#2d1a64] rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium"
            >
              Soy médico
            </button>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <div className="relative bg-gradient-to-br from-emerald-50 to-purple-50 py-12 sm:py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-3xl">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#3C2285] mb-3 sm:mb-4 leading-tight">
              Encuentra al médico perfecto para ti
            </h1>
            <p className="text-base sm:text-lg md:text-xl text-gray-600 mb-8 sm:mb-12">
              Busca por nombre, especialidad o ubicación. Reserva tu cita al instante con médicos verificados.
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
                  {filteredDoctors.length} médico{filteredDoctors.length !== 1 ? 's' : ''} {searchTerm ? `para "${searchTerm}"` : (onlineBookingOnly ? 'con agenda online' : 'disponibles')}
                </h2>
                {searchTerm && (
                  <p className="text-sm text-gray-600 mt-1">
                    Resultados ordenados por mejor coincidencia
                  </p>
                )}
                {!searchTerm && onlineBookingOnly && (
                  <p className="text-sm text-gray-600 mt-1">
                    Reserva tu cita al instante
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <span className="text-sm sm:text-base text-gray-600">Ordenar por:</span>
            <select className="flex-1 sm:flex-none px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg text-gray-700 cursor-pointer pr-8 focus:border-[#3C2285] focus:outline-none">
              <option>{searchTerm ? 'Mejor coincidencia' : 'Disponibilidad'}</option>
              <option>Mejor valorados</option>
              <option>Más cercanos</option>
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
              className="px-6 py-2.5 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer"
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
            {filteredDoctors.map((doctor) => (
              <DoctorCard
                key={doctor.id}
                doctor={doctor}
              />
            ))}
          </div>
        )}

        {!isLoading && !error && filteredDoctors.length === 0 && (
          <div className="text-center py-16 sm:py-20">
            <i className="ri-search-line text-5xl sm:text-6xl text-gray-300 mb-4"></i>
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">No se encontraron resultados</h3>
            <p className="text-sm sm:text-base text-gray-600 mb-4">
              {searchTerm
                ? `No encontramos médicos que coincidan con "${searchTerm}"`
                : 'Intenta ajustar tus filtros de búsqueda'
              }
            </p>
            {(searchTerm || selectedSpecialty || selectedDepartment || selectedMunicipality) && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setSelectedSpecialty('');
                  setSelectedDepartment('');
                  setSelectedMunicipality('');
                }}
                className="px-6 py-2.5 bg-emerald-700 text-white font-semibold rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer whitespace-nowrap"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-[#EDEDED] border-t border-gray-200 mt-12 sm:mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 mb-6 sm:mb-8">
            <div>
              <div className="flex items-center mb-4">
                <img
                  src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
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
                  <span className="font-medium text-gray-900">Acceso Gratuito:</span> Información y consultas con expertos médicos de calidad sin costo.
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">Empresa</h4>
              <ul className="space-y-3">
                <li className="text-sm sm:text-base text-gray-600">
                  <a href="#" className="hover:text-[#3C2285] cursor-pointer">
                    <span className="font-medium text-gray-900">Acerca de</span> — Conectamos pacientes y profesionales para una atención de calidad en una sola plataforma.
                  </a>
                </li>
                <li className="text-sm sm:text-base text-gray-600">
                  <a href="#" className="hover:text-[#3C2285] cursor-pointer">
                    <span className="font-medium text-gray-900">Contacto</span> — Soporte para pacientes y médicos; también prensa y alianzas.
                  </a>
                </li>
                <li className="text-sm sm:text-base text-gray-600">
                  <a href="#" className="hover:text-[#3C2285] cursor-pointer">
                    <span className="font-medium text-gray-900">Privacidad</span> — Cómo protegemos tus datos y tus derechos.
                  </a>
                </li>
                <li className="text-sm sm:text-base text-gray-600">
                  <a href="#" className="hover:text-[#3C2285] cursor-pointer">
                    <span className="font-medium text-gray-900">Términos</span> — Condiciones de uso del servicio.
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base">Síguenos</h4>
              <div className="flex gap-3 sm:gap-4">
                <a href="#" className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center bg-white rounded-full hover:bg-emerald-100 transition-colors cursor-pointer">
                  <i className="ri-facebook-fill text-lg sm:text-xl text-gray-700"></i>
                </a>
                <a href="#" className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center bg-white rounded-full hover:bg-emerald-100 transition-colors cursor-pointer">
                  <i className="ri-twitter-fill text-lg sm:text-xl text-gray-700"></i>
                </a>
                <a href="#" className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center bg-white rounded-full hover:bg-emerald-100 transition-colors cursor-pointer">
                  <i className="ri-instagram-fill text-lg sm:text-xl text-gray-700"></i>
                </a>
              </div>
            </div>
          </div>
          <div className="pt-6 sm:pt-8 border-t border-gray-300 text-center text-xs sm:text-sm text-gray-600">
            <p>© 2024 Lucy Care. Todos los derechos reservados. <a href="https://readdy.ai/?origin=logo" className="hover:text-[#3C2285] cursor-pointer">Website Builder</a></p>
          </div>
        </div>
      </footer>

      {/* Login Modal */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={handleLoginSuccess}
      />

      {/* Registration Modal */}
      {showRegistrationModal && (
        <DoctorRegistrationModal onClose={() => setShowRegistrationModal(false)} />
      )}
    </div>
  );
}
