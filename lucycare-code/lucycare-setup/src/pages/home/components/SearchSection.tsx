import { useState, useEffect, useRef } from 'react';
import { departments, getMunicipalitiesByDepartment, getMunicipalityName } from '../../../data/svLocations';
import { doctors } from '../../../mocks/doctors';

interface SearchSectionProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  selectedSpecialty: string;
  setSelectedSpecialty: (value: string) => void;
  selectedDepartment: string;
  setSelectedDepartment: (value: string) => void;
  selectedMunicipality: string;
  setSelectedMunicipality: (value: string) => void;
  onlineBookingOnly: boolean;
  setOnlineBookingOnly: (value: boolean) => void;
  onDoctorSelect?: (doctorId: number) => void;
}

const specialties = [
  'Todas las especialidades',
  'Cardiología',
  'Pediatría',
  'Dermatología',
  'Neurología',
  'Oftalmología',
  'Traumatología',
  'Ginecología',
  'Psiquiatría',
  'Medicina General',
  'Endocrinología'
];

// Función para normalizar texto (eliminar tildes y convertir a minúsculas)
const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
};

export default function SearchSection({
  searchTerm,
  setSearchTerm,
  selectedSpecialty,
  setSelectedSpecialty,
  selectedDepartment,
  setSelectedDepartment,
  selectedMunicipality,
  setSelectedMunicipality,
  onlineBookingOnly,
  setOnlineBookingOnly,
  onDoctorSelect
}: SearchSectionProps) {
  const [showSpecialtyDropdown, setShowSpecialtyDropdown] = useState(false);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showMunicipalityDropdown, setShowMunicipalityDropdown] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState<typeof doctors>([]);
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  const municipalities = selectedDepartment 
    ? getMunicipalitiesByDepartment(selectedDepartment)
    : [];

  // Autocompletado inteligente
  useEffect(() => {
    if (searchTerm.trim().length >= 2) {
      const normalizedSearch = normalizeText(searchTerm);
      
      // Filtrar y ordenar resultados
      const filtered = doctors
        .filter(doctor => {
          const normalizedName = normalizeText(doctor.name);
          return normalizedName.includes(normalizedSearch);
        })
        .sort((a, b) => {
          const normalizedA = normalizeText(a.name);
          const normalizedB = normalizeText(b.name);
          const normalizedSearch = normalizeText(searchTerm);
          
          // Priorizar coincidencias que empiezan con el término de búsqueda
          const aStarts = normalizedA.startsWith(normalizedSearch);
          const bStarts = normalizedB.startsWith(normalizedSearch);
          
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          
          // Luego por bookingEnabled
          if (a.bookingEnabled && !b.bookingEnabled) return -1;
          if (!a.bookingEnabled && b.bookingEnabled) return 1;
          
          // Finalmente por rating
          return b.rating - a.rating;
        })
        .slice(0, 8); // Máximo 8 sugerencias
      
      setAutocompleteResults(filtered);
      setShowAutocomplete(filtered.length > 0);
    } else {
      setShowAutocomplete(false);
      setAutocompleteResults([]);
    }
  }, [searchTerm]);

  // Cerrar autocomplete al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        autocompleteRef.current &&
        !autocompleteRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowAutocomplete(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSpecialtySelect = (specialty: string) => {
    setSelectedSpecialty(specialty === 'Todas las especialidades' ? '' : specialty);
    setShowSpecialtyDropdown(false);
  };

  const handleDepartmentSelect = (departmentId: string) => {
    if (departmentId === '') {
      setSelectedDepartment('');
      setSelectedMunicipality('');
    } else {
      setSelectedDepartment(departmentId);
      setSelectedMunicipality('');
    }
    setShowDepartmentDropdown(false);
  };

  const handleMunicipalitySelect = (municipalityId: string) => {
    setSelectedMunicipality(municipalityId === '' ? '' : municipalityId);
    setShowMunicipalityDropdown(false);
  };

  const handleDoctorClick = (doctorId: number) => {
    setShowAutocomplete(false);
    if (onDoctorSelect) {
      onDoctorSelect(doctorId);
    }
  };

  const getSelectedDepartmentName = () => {
    if (!selectedDepartment) return 'Todos los departamentos';
    const dept = departments.find(d => d.id === selectedDepartment);
    return dept?.name || 'Todos los departamentos';
  };

  const getSelectedMunicipalityName = () => {
    if (!selectedMunicipality) return 'Todos los municipios';
    const muni = municipalities.find(m => m.id === selectedMunicipality);
    return muni?.name || 'Todos los municipios';
  };

  const highlightMatch = (text: string, search: string) => {
    if (!search.trim()) return text;
    
    const normalizedText = normalizeText(text);
    const normalizedSearch = normalizeText(search);
    const index = normalizedText.indexOf(normalizedSearch);
    
    if (index === -1) return text;
    
    const before = text.slice(0, index);
    const match = text.slice(index, index + search.length);
    const after = text.slice(index + search.length);
    
    return (
      <>
        {before}
        <strong className="font-bold text-[#3C2285]">{match}</strong>
        {after}
      </>
    );
  };

  return (
    <div className="space-y-4">
      {/* Toggle de Agenda Online - MUY VISIBLE */}
      <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-5 border-2 border-emerald-600">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-white rounded-full">
              <i className="ri-calendar-check-line text-xl sm:text-2xl text-emerald-600"></i>
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                Solo médicos con agenda online
              </h3>
              <p className="text-xs sm:text-sm text-white">
                Reserva tu cita al instante
              </p>
            </div>
          </div>
          <button
            onClick={() => setOnlineBookingOnly(!onlineBookingOnly)}
            className={`relative w-14 h-8 sm:w-16 sm:h-9 rounded-full transition-all duration-300 cursor-pointer flex-shrink-0 ${
              onlineBookingOnly ? 'bg-white' : 'bg-white/30'
            }`}
          >
            <div
              className={`absolute top-1 left-1 w-6 h-6 sm:w-7 sm:h-7 rounded-full transition-all duration-300 ${
                onlineBookingOnly ? 'translate-x-6 sm:translate-x-7 bg-emerald-600' : 'translate-x-0 bg-gray-400'
              }`}
            >
              {onlineBookingOnly && (
                <i className="ri-check-line text-white text-sm sm:text-base absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></i>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Buscador principal con autocompletado */}
      <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-1.5 sm:p-2 border border-gray-100">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-1.5 sm:gap-2">
          {/* Search by Name - PRIORIZADO */}
          <div className="relative">
            <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b md:border-b-0 md:border-r border-gray-200">
              <i className="ri-search-line text-xl sm:text-2xl text-emerald-600"></i>
              <div className="flex-1 min-w-0">
                <label className="block text-sm sm:text-base font-semibold text-gray-900 mb-1 sm:mb-1.5">
                  Buscar médico
                </label>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Nombre o apellido..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onFocus={() => {
                    if (searchTerm.trim().length >= 2 && autocompleteResults.length > 0) {
                      setShowAutocomplete(true);
                    }
                  }}
                  className="w-full text-sm sm:text-base text-gray-700 placeholder-gray-400 outline-none focus:outline-none"
                />
              </div>
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setShowAutocomplete(false);
                  }}
                  className="w-6 h-6 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer flex-shrink-0"
                >
                  <i className="ri-close-line text-lg text-gray-400"></i>
                </button>
              )}
            </div>
            
            {/* Autocompletado */}
            {showAutocomplete && (
              <div 
                ref={autocompleteRef}
                className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 max-h-96 overflow-y-auto z-50"
              >
                <div className="p-2">
                  <div className="text-xs text-gray-500 px-3 py-2 font-medium">
                    {autocompleteResults.length} resultado{autocompleteResults.length !== 1 ? 's' : ''}
                  </div>
                  {autocompleteResults.map((doctor) => {
                    const municipalityName = getMunicipalityName(doctor.location.municipalityId);
                    
                    return (
                      <button
                        key={doctor.id}
                        onClick={() => handleDoctorClick(doctor.id)}
                        className="w-full px-3 py-3 text-left hover:bg-gray-50 rounded-lg cursor-pointer transition-colors flex items-center gap-3"
                      >
                        <img
                          src={doctor.image}
                          alt={doctor.name}
                          className="w-12 h-12 rounded-lg object-cover object-top flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {highlightMatch(doctor.name, searchTerm)}
                            </p>
                            {doctor.bookingEnabled ? (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold flex-shrink-0">
                                <i className="ri-calendar-check-line text-xs"></i>
                                Agenda
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-gray-200 text-gray-600 rounded-full text-xs font-medium flex-shrink-0">
                                Sin agenda
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 truncate">{doctor.specialty}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex items-center gap-1">
                              <i className="ri-star-fill text-yellow-400 text-xs"></i>
                              <span className="text-xs text-gray-600">{doctor.rating}</span>
                            </div>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-600 truncate">
                              {municipalityName}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Specialty Filter */}
          <div className="relative">
            <button
              onClick={() => {
                setShowSpecialtyDropdown(!showSpecialtyDropdown);
                setShowDepartmentDropdown(false);
                setShowMunicipalityDropdown(false);
              }}
              className="w-full flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b md:border-b-0 md:border-r border-gray-200 cursor-pointer text-left hover:bg-gray-50 transition-colors"
            >
              <i className="ri-stethoscope-line text-xl sm:text-2xl text-emerald-600"></i>
              <div className="flex-1 min-w-0">
                <label className="block text-sm sm:text-base font-semibold text-gray-900 mb-1 sm:mb-1.5">
                  Especialidad
                </label>
                <span className="text-sm sm:text-base text-gray-700 truncate block">
                  {selectedSpecialty || 'Todas las especialidades'}
                </span>
              </div>
              <i className={`ri-arrow-down-s-line text-xl sm:text-2xl text-gray-400 transition-transform flex-shrink-0 ${showSpecialtyDropdown ? 'rotate-180' : ''}`}></i>
            </button>
            
            {showSpecialtyDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 max-h-60 sm:max-h-80 overflow-y-auto z-50">
                {specialties.map((specialty) => (
                  <button
                    key={specialty}
                    onClick={() => handleSpecialtySelect(specialty)}
                    className="w-full px-4 sm:px-6 py-2.5 sm:py-3 text-left text-sm sm:text-base text-gray-700 hover:bg-emerald-50 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    {specialty}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Department Filter */}
          <div className="relative">
            <button
              onClick={() => {
                setShowDepartmentDropdown(!showDepartmentDropdown);
                setShowSpecialtyDropdown(false);
                setShowMunicipalityDropdown(false);
              }}
              className="w-full flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b md:border-b-0 md:border-r border-gray-200 cursor-pointer text-left hover:bg-gray-50 transition-colors"
            >
              <i className="ri-map-pin-line text-xl sm:text-2xl text-emerald-600"></i>
              <div className="flex-1 min-w-0">
                <label className="block text-sm sm:text-base font-semibold text-gray-900 mb-1 sm:mb-1.5">
                  Departamento
                </label>
                <span className="text-sm sm:text-base text-gray-700 truncate block">
                  {getSelectedDepartmentName()}
                </span>
              </div>
              <i className={`ri-arrow-down-s-line text-xl sm:text-2xl text-gray-400 transition-transform flex-shrink-0 ${showDepartmentDropdown ? 'rotate-180' : ''}`}></i>
            </button>
            
            {showDepartmentDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 max-h-60 sm:max-h-80 overflow-y-auto z-50">
                <button
                  onClick={() => handleDepartmentSelect('')}
                  className="w-full px-4 sm:px-6 py-2.5 sm:py-3 text-left text-sm sm:text-base text-gray-700 hover:bg-emerald-50 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Todos los departamentos
                </button>
                {departments.map((dept) => (
                  <button
                    key={dept.id}
                    onClick={() => handleDepartmentSelect(dept.id)}
                    className="w-full px-4 sm:px-6 py-2.5 sm:py-3 text-left text-sm sm:text-base text-gray-700 hover:bg-emerald-50 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    {dept.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Municipality Filter */}
          <div className="relative">
            <button
              onClick={() => {
                if (selectedDepartment) {
                  setShowMunicipalityDropdown(!showMunicipalityDropdown);
                  setShowSpecialtyDropdown(false);
                  setShowDepartmentDropdown(false);
                }
              }}
              disabled={!selectedDepartment}
              className={`w-full flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 cursor-pointer text-left transition-colors ${
                selectedDepartment 
                  ? 'hover:bg-gray-50' 
                  : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <i className="ri-building-line text-xl sm:text-2xl text-emerald-600"></i>
              <div className="flex-1 min-w-0">
                <label className="block text-sm sm:text-base font-semibold text-gray-900 mb-1 sm:mb-1.5">
                  Municipio
                </label>
                <span className="text-sm sm:text-base text-gray-700 truncate block">
                  {selectedDepartment ? getSelectedMunicipalityName() : 'Selecciona departamento'}
                </span>
              </div>
              <i className={`ri-arrow-down-s-line text-xl sm:text-2xl text-gray-400 transition-transform flex-shrink-0 ${showMunicipalityDropdown ? 'rotate-180' : ''}`}></i>
            </button>
            
            {showMunicipalityDropdown && selectedDepartment && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 max-h-60 sm:max-h-80 overflow-y-auto z-50">
                <button
                  onClick={() => handleMunicipalitySelect('')}
                  className="w-full px-4 sm:px-6 py-2.5 sm:py-3 text-left text-sm sm:text-base text-gray-700 hover:bg-emerald-50 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Todos los municipios
                </button>
                {municipalities.map((muni) => (
                  <button
                    key={muni.id}
                    onClick={() => handleMunicipalitySelect(muni.id)}
                    className="w-full px-4 sm:px-6 py-2.5 sm:py-3 text-left text-sm sm:text-base text-gray-700 hover:bg-emerald-50 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    {muni.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
