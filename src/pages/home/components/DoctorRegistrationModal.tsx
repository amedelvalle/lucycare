import { useState } from 'react';

interface DoctorRegistrationModalProps {
  onClose: () => void;
}

export default function DoctorRegistrationModal({ onClose }: DoctorRegistrationModalProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    // Step 1: Información personal
    fullName: '',
    email: '',
    phone: '',
    countryCode: '+503',
    photo: null as File | null,
    photoPreview: '',
    
    // Step 2: Información profesional
    specialty: '',
    licenseNumber: '',
    experience: '',
    
    // Step 3: Ubicación
    country: 'El Salvador',
    city: '',
    address: '',
    
    // Step 4: Servicios
    services: [] as { name: string; price: number }[],
    
    // Step 5: Disponibilidad
    availability: {
      monday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      tuesday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      wednesday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      thursday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      friday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      saturday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      sunday: { enabled: false, startTime: '09:00', endTime: '17:00' },
    }
  });

  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState({
    fullName: '',
    email: '',
    phone: '',
  });
  const [basePriceInput, setBasePriceInput] = useState('');
  const [servicePriceErrors, setServicePriceErrors] = useState<Record<string, string>>({});

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validar que sea una imagen
      if (!file.type.startsWith('image/')) {
        alert('Por favor selecciona un archivo de imagen válido');
        return;
      }
      
      // Validar tamaño (máximo 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('La imagen no debe superar los 5MB');
        return;
      }

      setFormData(prev => ({
        ...prev,
        photo: file,
        photoPreview: URL.createObjectURL(file)
      }));
    }
  };

  const removePhoto = () => {
    if (formData.photoPreview) {
      URL.revokeObjectURL(formData.photoPreview);
    }
    setFormData(prev => ({
      ...prev,
      photo: null,
      photoPreview: ''
    }));
  };

  const countries = [
    { code: '+503', name: 'El Salvador', flag: '🇸🇻' },
    { code: '+52', name: 'México', flag: '🇲🇽' },
    { code: '+1', name: 'Estados Unidos', flag: '🇺🇸' },
    { code: '+502', name: 'Guatemala', flag: '🇬🇹' },
    { code: '+504', name: 'Honduras', flag: '🇭🇳' },
  ];

  const specialties = [
    'Cardiología',
    'Pediatría',
    'Dermatología',
    'Neurología',
    'Ginecología',
    'Oftalmología',
    'Traumatología',
    'Psiquiatría',
    'Medicina General',
    'Endocrinología',
    'Gastroenterología',
    'Urología',
  ];

  const commonServices = [
    'Consulta general',
    'Consulta de seguimiento',
    'Diagnóstico',
    'Tratamiento',
    'Cirugía menor',
    'Exámenes de laboratorio',
    'Recetas médicas',
    'Certificados médicos',
  ];

  const selectedCountry = countries.find(c => c.code === formData.countryCode) || countries[0];

  const handleNext = () => {
    if (step < 5) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      // Aquí se integrará con Supabase cuando esté conectado
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log('Registro de médico:', formData);
      
      // Mostrar mensaje de éxito
      alert('¡Registro exitoso! Nos pondremos en contacto contigo pronto para verificar tu información.');
      onClose();
    } catch (err) {
      setError('Error al registrar. Por favor, intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const toggleService = (serviceName: string) => {
    setFormData(prev => {
      const existingService = prev.services.find(s => s.name === serviceName);
      
      if (existingService) {
        // Remover servicio
        return {
          ...prev,
          services: prev.services.filter(s => s.name !== serviceName)
        };
      } else {
        // Agregar servicio con precio 0
        return {
          ...prev,
          services: [...prev.services, { name: serviceName, price: 0 }]
        };
      }
    });
    
    // Limpiar error de precio al deseleccionar
    if (formData.services.find(s => s.name === serviceName)) {
      setServicePriceErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[serviceName];
        return newErrors;
      });
    }
  };

  const updateServicePrice = (serviceName: string, price: string) => {
    const numPrice = parseFloat(price) || 0;
    
    setFormData(prev => ({
      ...prev,
      services: prev.services.map(s => 
        s.name === serviceName ? { ...s, price: numPrice } : s
      )
    }));

    // Validar precio
    if (numPrice <= 0) {
      setServicePriceErrors(prev => ({
        ...prev,
        [serviceName]: 'El precio debe ser mayor a 0'
      }));
    } else {
      setServicePriceErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[serviceName];
        return newErrors;
      });
    }
  };

  const removeService = (serviceName: string) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.filter(s => s.name !== serviceName)
    }));
    
    setServicePriceErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[serviceName];
      return newErrors;
    });
  };

  const applyBasePriceToAll = () => {
    const basePrice = parseFloat(basePriceInput) || 0;
    
    if (basePrice <= 0) {
      alert('Por favor ingresa un precio válido mayor a 0');
      return;
    }

    setFormData(prev => ({
      ...prev,
      services: prev.services.map(s => ({ ...s, price: basePrice }))
    }));

    // Limpiar errores
    setServicePriceErrors({});
    setBasePriceInput('');
  };

  const toggleDay = (day: keyof typeof formData.availability) => {
    setFormData(prev => ({
      ...prev,
      availability: {
        ...prev.availability,
        [day]: {
          ...prev.availability[day],
          enabled: !prev.availability[day].enabled
        }
      }
    }));
  };

  const updateDayTime = (day: keyof typeof formData.availability, timeType: 'startTime' | 'endTime', value: string) => {
    setFormData(prev => ({
      ...prev,
      availability: {
        ...prev.availability,
        [day]: {
          ...prev.availability[day],
          [timeType]: value
        }
      }
    }));
  };

  const validateFullName = (name: string) => {
    // Solo letras, espacios y acentos
    const nameRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/;
    if (!name.trim()) {
      return 'El nombre es requerido';
    }
    if (!nameRegex.test(name)) {
      return 'El nombre solo puede contener letras';
    }
    if (name.trim().length < 3) {
      return 'El nombre debe tener al menos 3 caracteres';
    }
    return '';
  };

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) {
      return 'El correo electrónico es requerido';
    }
    if (!emailRegex.test(email)) {
      return 'Ingresa un correo electrónico válido';
    }
    return '';
  };

  const validatePhone = (phone: string) => {
    // Solo números y guiones
    const phoneRegex = /^[0-9-]+$/;
    if (!phone.trim()) {
      return 'El número telefónico es requerido';
    }
    if (!phoneRegex.test(phone)) {
      return 'El teléfono solo puede contener números y guiones';
    }
    if (phone.replace(/-/g, '').length < 8) {
      return 'El teléfono debe tener al menos 8 dígitos';
    }
    return '';
  };

  const handleFullNameChange = (value: string) => {
    // Permitir solo letras, espacios y acentos
    const filtered = value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '');
    setFormData({ ...formData, fullName: filtered });
    setValidationErrors({ ...validationErrors, fullName: validateFullName(filtered) });
  };

  const handleEmailChange = (value: string) => {
    setFormData({ ...formData, email: value });
    setValidationErrors({ ...validationErrors, email: validateEmail(value) });
  };

  const handlePhoneChange = (value: string) => {
    // Permitir solo números y guiones
    const filtered = value.replace(/[^0-9-]/g, '');
    setFormData({ ...formData, phone: filtered });
    setValidationErrors({ ...validationErrors, phone: validatePhone(filtered) });
  };

  const isStepValid = () => {
    switch (step) {
      case 1:
        return (
          formData.fullName &&
          formData.email &&
          formData.phone &&
          !validationErrors.fullName &&
          !validationErrors.email &&
          !validationErrors.phone
        );
      case 2:
        return formData.specialty && formData.licenseNumber && formData.experience;
      case 3:
        return formData.country && formData.city && formData.address;
      case 4:
        // Validar que haya servicios y todos tengan precio > 0
        return (
          formData.services.length > 0 &&
          formData.services.every(s => s.price > 0) &&
          Object.keys(servicePriceErrors).length === 0
        );
      case 5:
        return Object.values(formData.availability).some(v => v.enabled);
      default:
        return false;
    }
  };

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                Información personal
              </h3>
              <p className="text-gray-600">Comencemos con tu información básica</p>
            </div>

            {/* Photo Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fotografía de perfil
              </label>
              <div className="flex items-start gap-4">
                {formData.photoPreview ? (
                  <div className="relative">
                    <img
                      src={formData.photoPreview}
                      alt="Vista previa"
                      className="w-32 h-40 rounded-xl object-cover object-top border-2 border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={removePhoto}
                      className="absolute -top-2 -right-2 w-8 h-8 flex items-center justify-center bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors cursor-pointer"
                    >
                      <i className="ri-close-line text-lg"></i>
                    </button>
                  </div>
                ) : (
                  <div className="w-32 h-40 rounded-xl bg-gray-100 flex flex-col items-center justify-center border-2 border-dashed border-gray-300">
                    <i className="ri-user-line text-4xl text-gray-400 mb-2"></i>
                    <span className="text-xs text-gray-500 text-center px-2">Formato vertical</span>
                  </div>
                )}
                <div className="flex-1">
                  <label className="inline-block px-4 py-2.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap">
                    <i className="ri-upload-2-line mr-2"></i>
                    {formData.photoPreview ? 'Cambiar foto' : 'Subir foto'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoChange}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    JPG, PNG o GIF. Máximo 5MB
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Recomendado: Foto vertical tipo retrato
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nombre completo *
              </label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => handleFullNameChange(e.target.value)}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none transition-colors text-gray-900 ${
                  validationErrors.fullName
                    ? 'border-red-500 focus:border-red-5'
                    : 'border-gray-300 focus:border-gray-900'
                }`}
                placeholder="Dr. Juan Pérez"
              />
              {validationErrors.fullName && (
                <p className="text-xs text-red-600 mt-1">{validationErrors.fullName}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Correo electrónico *
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => handleEmailChange(e.target.value)}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none transition-colors text-gray-900 ${
                  validationErrors.email
                    ? 'border-red-500 focus:border-red-5'
                    : 'border-gray-300 focus:border-gray-900'
                }`}
                placeholder="correo@ejemplo.com"
              />
              {validationErrors.email && (
                <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                País/Región *
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors cursor-pointer text-left flex items-center justify-between"
                >
                  <span className="text-gray-900">
                    {selectedCountry.flag} {selectedCountry.name} ({selectedCountry.code})
                  </span>
                  <i className={`ri-arrow-down-s-line text-xl text-gray-400 transition-transform ${showCountryDropdown ? 'rotate-180' : ''}`}></i>
                </button>
                
                {showCountryDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 max-h-60 overflow-y-auto z-50">
                    {countries.map((country) => (
                      <button
                        key={country.code}
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, countryCode: country.code });
                          setShowCountryDropdown(false);
                        }}
                        className="w-full px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors flex items-center gap-2"
                      >
                        <span>{country.flag}</span>
                        <span>{country.name} ({country.code})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Número telefónico *
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                className={`w-full px-4 py-3 border rounded-lg focus:outline-none transition-colors text-gray-900 ${
                  validationErrors.phone
                    ? 'border-red-500 focus:border-red-5'
                    : 'border-gray-300 focus:border-gray-900'
                }`}
                placeholder="1234-5678"
              />
              {validationErrors.phone && (
                <p className="text-xs text-red-600 mt-1">{validationErrors.phone}</p>
              )}
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                Información profesional
              </h3>
              <p className="text-gray-600">Cuéntanos sobre tu experiencia médica</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Especialidad *
              </label>
              <select
                value={formData.specialty}
                onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
                className="w-full px-4 py-3 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors text-gray-900 cursor-pointer"
              >
                <option value="">Selecciona una especialidad</option>
                {specialties.map((specialty) => (
                  <option key={specialty} value={specialty}>
                    {specialty}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Número de licencia médica *
              </label>
              <input
                type="text"
                value={formData.licenseNumber}
                onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors text-gray-900"
                placeholder="Ej: 12345"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Años de experiencia *
              </label>
              <input
                type="text"
                value={formData.experience}
                onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors text-gray-900"
                placeholder="Ej: 10 años"
              />
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                Ubicación de tu consultorio
              </h3>
              <p className="text-gray-600">¿Dónde atiendes a tus pacientes?</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                País *
              </label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors text-gray-900"
                placeholder="El Salvador"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ciudad *
              </label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors text-gray-900"
                placeholder="San Salvador"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Dirección completa *
              </label>
              <textarea
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                rows={3}
                maxLength={500}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 transition-colors text-gray-900 resize-none"
                placeholder="Calle, número, colonia, referencias..."
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.address.length}/500 caracteres
              </p>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                Servicios y tarifas
              </h3>
              <p className="text-gray-600">¿Qué servicios ofreces y cuánto cobras por cada uno?</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Selecciona los servicios que ofreces *
              </label>
              <div className="grid grid-cols-2 gap-2">
                {commonServices.map((service) => {
                  const isSelected = formData.services.some(s => s.name === service);
                  
                  return (
                    <button
                      key={service}
                      type="button"
                      onClick={() => toggleService(service)}
                      className={`px-4 py-3 text-sm rounded-lg border transition-colors cursor-pointer text-left ${
                        isSelected
                          ? 'bg-[#3C2285] text-white border-[#3C2285]'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-[#3C2285]'
                      }`}
                    >
                      {service}
                    </button>
                  );
                })}
              </div>
            </div>

            {formData.services.length > 0 && (
              <>
                {/* Acción rápida: Aplicar precio a todos */}
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 flex items-center justify-center bg-emerald-100 rounded-lg">
                      <i className="ri-flashlight-line text-emerald-700 text-xl"></i>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900 mb-2">
                        Acción rápida: Aplicar el mismo precio a todos
                      </p>
                      <div className="flex gap-2">
                        <div className="relative flex-1 max-w-xs">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-700 font-medium">$</span>
                          <input
                            type="number"
                            value={basePriceInput}
                            onChange={(e) => setBasePriceInput(e.target.value)}
                            className="w-full pl-7 pr-3 py-2 border border-emerald-300 rounded-lg focus:outline-none focus:border-emerald-600 transition-colors text-slate-900 text-sm"
                            placeholder="50"
                            min="0"
                            step="0.01"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={applyBasePriceToAll}
                          disabled={!basePriceInput || parseFloat(basePriceInput) <= 0}
                          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors whitespace-nowrap ${
                            basePriceInput && parseFloat(basePriceInput) > 0
                              ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          Aplicar a todos
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Servicios seleccionados con precios */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Servicios seleccionados ({formData.services.length})
                  </label>
                  <div className="space-y-3">
                    {formData.services.map((service) => (
                      <div
                        key={service.name}
                        className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 bg-[#3C2285] rounded-full"></div>
                              <span className="font-medium text-slate-900">{service.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 max-w-xs">
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  Precio (USD) *
                                </label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-700 font-medium">$</span>
                                  <input
                                    type="number"
                                    value={service.price || ''}
                                    onChange={(e) => updateServicePrice(service.name, e.target.value)}
                                    className={`w-full pl-7 pr-3 py-2.5 border rounded-lg focus:outline-none transition-colors text-slate-900 ${
                                      servicePriceErrors[service.name]
                                        ? 'border-red-500 focus:border-red-500'
                                        : 'border-gray-300 focus:border-[#3C2285]'
                                    }`}
                                    placeholder="0.00"
                                    min="0"
                                    step="0.01"
                                  />
                                </div>
                                {servicePriceErrors[service.name] && (
                                  <p className="text-xs text-red-600 mt-1">
                                    {servicePriceErrors[service.name]}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeService(service.name)}
                            className="w-8 h-8 flex items-center justify-center hover:bg-red-50 rounded-lg transition-colors cursor-pointer group"
                            title="Quitar servicio"
                          >
                            <i className="ri-delete-bin-line text-gray-400 group-hover:text-red-600 text-lg"></i>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Mensaje de validación general */}
                {formData.services.length > 0 && formData.services.some(s => s.price <= 0) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                    <i className="ri-error-warning-line text-amber-600 text-lg mt-0.5"></i>
                    <p className="text-sm text-amber-800">
                      Asigna un precio mayor a 0 para cada servicio seleccionado
                    </p>
                  </div>
                )}
              </>
            )}

            {formData.services.length === 0 && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                <i className="ri-service-line text-4xl text-gray-300 mb-2"></i>
                <p className="text-sm text-gray-500">
                  Selecciona al menos un servicio para continuar
                </p>
              </div>
            )}
          </div>
        );
      case 5:
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                Disponibilidad
              </h3>
              <p className="text-gray-600">¿Qué días y horarios atiendes pacientes?</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Días y horarios disponibles *
              </label>
              <div className="space-y-3">
                {[
                  { key: 'monday', label: 'Lunes' },
                  { key: 'tuesday', label: 'Martes' },
                  { key: 'wednesday', label: 'Miércoles' },
                  { key: 'thursday', label: 'Jueves' },
                  { key: 'friday', label: 'Viernes' },
                  { key: 'saturday', label: 'Sábado' },
                  { key: 'sunday', label: 'Domingo' },
                ].map((day) => {
                  const dayKey = day.key as keyof typeof formData.availability;
                  const dayData = formData.availability[dayKey];
                  
                  return (
                    <div key={day.key} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <button
                          type="button"
                          onClick={() => toggleDay(dayKey)}
                          className={`flex items-center gap-3 px-4 py-2 rounded-lg border transition-colors cursor-pointer ${
                            dayData.enabled
                              ? 'bg-[#3C2285] text-white border-[#3C2285]'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-[#3C2285]'
                          }`}
                        >
                          <span className="font-medium">{day.label}</span>
                          {dayData.enabled && (
                            <i className="ri-check-line text-lg"></i>
                          )}
                        </button>
                      </div>
                      
                      {dayData.enabled && (
                        <div className="grid grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Hora de inicio
                            </label>
                            <input
                              type="time"
                              value={dayData.startTime}
                              onChange={(e) => updateDayTime(dayKey, 'startTime', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-[#3C2285] transition-colors text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Hora de fin
                            </label>
                            <input
                              type="time"
                              value={dayData.endTime}
                              onChange={(e) => updateDayTime(dayKey, 'endTime', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-[#3C2285] transition-colors text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <div className="flex items-start gap-3">
                <i className="ri-information-line text-[#3C2285] text-xl mt-0.5"></i>
                <div className="text-sm text-gray-700">
                  <p className="font-semibold mb-1">Próximos pasos</p>
                  <p>Después de enviar tu registro, nuestro equipo revisará tu información y se pondrá en contacto contigo en un plazo de 48 horas para completar el proceso de verificación.</p>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between rounded-t-3xl z-10">
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <div
                key={s}
                className={`h-1 rounded-full transition-all ${
                  s === step ? 'w-8 bg-[#3C2285]' : s < step ? 'w-6 bg-emerald-700' : 'w-6 bg-gray-200'
                }`}
              ></div>
            ))}
          </div>
          <div className="w-8"></div>
        </div>

        {/* Content */}
        <div className="p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {renderStepContent()}

          {/* Navigation Buttons */}
          <div className="flex gap-3 mt-8">
            {step > 1 && (
              <button
                onClick={handleBack}
                className="flex-1 py-3.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap font-semibold"
              >
                Atrás
              </button>
            )}
            {step < 5 ? (
              <button
                onClick={handleNext}
                disabled={!isStepValid()}
                className={`flex-1 py-3.5 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  isStepValid()
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                Siguiente
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!isStepValid() || loading}
                className={`flex-1 py-3.5 rounded-lg font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  isStepValid() && !loading
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {loading ? 'Enviando...' : 'Enviar registro'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
