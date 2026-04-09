import { useState, useEffect } from 'react';
import { useSpecialties, useDepartments, useMunicipalities } from '../../../hooks/useDirectory';
import { sendOtp, verifyOtp } from '../../../services/auth.service';
import { registerDoctor } from '../../../services/doctorRegistration.service';
import { supabase } from '../../../lib/supabase';

interface DoctorRegistrationModalProps {
  onClose: () => void;
}

const dayLabels = [
  { key: 'monday', label: 'Lunes', dayOfWeek: 1 },
  { key: 'tuesday', label: 'Martes', dayOfWeek: 2 },
  { key: 'wednesday', label: 'Miércoles', dayOfWeek: 3 },
  { key: 'thursday', label: 'Jueves', dayOfWeek: 4 },
  { key: 'friday', label: 'Viernes', dayOfWeek: 5 },
  { key: 'saturday', label: 'Sábado', dayOfWeek: 6 },
  { key: 'sunday', label: 'Domingo', dayOfWeek: 0 },
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

const countries = [
  { code: '+503', name: 'El Salvador', flag: '🇸🇻' },
  { code: '+52', name: 'México', flag: '🇲🇽' },
  { code: '+1', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: '+502', name: 'Guatemala', flag: '🇬🇹' },
  { code: '+504', name: 'Honduras', flag: '🇭🇳' },
];

type AvailabilityMap = Record<string, { enabled: boolean; startTime: string; endTime: string }>;

export default function DoctorRegistrationModal({ onClose }: DoctorRegistrationModalProps) {
  // Step 0: OTP auth, Steps 1-5: registro
  const [step, setStep] = useState(0);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // OTP state
  const [phoneRaw, setPhoneRaw] = useState('');
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [countryCode, setCountryCode] = useState('+503');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Form data
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    photo: null as File | null,
    photoPreview: '',
    specialtyId: '',
    licenseNumber: '',
    experience: '',
    departmentId: '',
    municipalityId: '',
    addressLine: '',
    clinicName: '',
    services: [] as { name: string; price: number }[],
    availability: {
      monday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      tuesday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      wednesday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      thursday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      friday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      saturday: { enabled: false, startTime: '09:00', endTime: '17:00' },
      sunday: { enabled: false, startTime: '09:00', endTime: '17:00' },
    } as AvailabilityMap,
  });

  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [basePriceInput, setBasePriceInput] = useState('');
  const [servicePriceErrors, setServicePriceErrors] = useState<Record<string, string>>({});

  // Datos reales de Supabase
  const { data: specialties = [] } = useSpecialties();
  const { data: departments = [] } = useDepartments();
  const { data: municipalities = [] } = useMunicipalities(formData.departmentId || null);

  // Verificar si ya hay sesión
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setIsAuthenticated(true);
        setStep(1);
      }
    });
  }, []);

  const selectedCountry = countries.find(c => c.code === countryCode) || countries[0];
  const fullPhone = `${countryCode}${phoneRaw}`;
  const isPhoneValid = phoneRaw.length === 8;

  // ─── OTP Handlers ───
  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) formatted = `${digits.slice(0, 4)}-${digits.slice(4)}`;
    setPhoneRaw(digits);
    setPhoneDisplay(formatted);
  };

  const handleSendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await sendOtp(fullPhone);
      if (result.success) {
        setOtpSent(true);
      } else {
        setError(result.error || 'Error enviando código');
      }
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await verifyOtp(fullPhone, otpCode);
      if (result.success) {
        setIsAuthenticated(true);
        setStep(1);
      } else {
        setError(result.error || 'Código incorrecto');
      }
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  // ─── Photo Handlers ───
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) { setError('Selecciona una imagen válida'); return; }
      if (file.size > 5 * 1024 * 1024) { setError('La imagen no debe superar 5MB'); return; }
      setFormData(prev => ({ ...prev, photo: file, photoPreview: URL.createObjectURL(file) }));
    }
  };

  const removePhoto = () => {
    if (formData.photoPreview) URL.revokeObjectURL(formData.photoPreview);
    setFormData(prev => ({ ...prev, photo: null, photoPreview: '' }));
  };

  // ─── Service Handlers ───
  const toggleService = (name: string) => {
    setFormData(prev => {
      const exists = prev.services.find(s => s.name === name);
      if (exists) {
        return { ...prev, services: prev.services.filter(s => s.name !== name) };
      }
      return { ...prev, services: [...prev.services, { name, price: 0 }] };
    });
  };

  const updateServicePrice = (name: string, price: string) => {
    const num = parseFloat(price) || 0;
    setFormData(prev => ({
      ...prev,
      services: prev.services.map(s => s.name === name ? { ...s, price: num } : s),
    }));
    if (num <= 0) {
      setServicePriceErrors(prev => ({ ...prev, [name]: 'Precio debe ser mayor a 0' }));
    } else {
      setServicePriceErrors(prev => { const n = { ...prev }; delete n[name]; return n; });
    }
  };

  const applyBasePriceToAll = () => {
    const p = parseFloat(basePriceInput) || 0;
    if (p <= 0) return;
    setFormData(prev => ({ ...prev, services: prev.services.map(s => ({ ...s, price: p })) }));
    setServicePriceErrors({});
    setBasePriceInput('');
  };

  // ─── Availability Handlers ───
  const toggleDay = (key: string) => {
    setFormData(prev => ({
      ...prev,
      availability: {
        ...prev.availability,
        [key]: { ...prev.availability[key], enabled: !prev.availability[key].enabled },
      },
    }));
  };

  const updateDayTime = (key: string, field: 'startTime' | 'endTime', value: string) => {
    setFormData(prev => ({
      ...prev,
      availability: {
        ...prev.availability,
        [key]: { ...prev.availability[key], [field]: value },
      },
    }));
  };

  // ─── Validation ───
  const isStepValid = () => {
    switch (step) {
      case 1: return formData.fullName.trim().length >= 3 && formData.email.includes('@');
      case 2: return formData.specialtyId && formData.licenseNumber;
      case 3: return formData.departmentId && formData.addressLine;
      case 4: return formData.services.length > 0 && formData.services.every(s => s.price > 0);
      case 5: return Object.values(formData.availability).some(v => v.enabled);
      default: return false;
    }
  };

  // ─── Submit ───
  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const availabilityRules = dayLabels
        .filter(d => formData.availability[d.key]?.enabled)
        .map(d => ({
          dayOfWeek: d.dayOfWeek,
          startTime: formData.availability[d.key].startTime,
          endTime: formData.availability[d.key].endTime,
          slotDuration: 30,
        }));

      const result = await registerDoctor({
        fullName: formData.fullName,
        email: formData.email,
        phone: phoneRaw,
        countryCode,
        photo: formData.photo,
        specialtyId: formData.specialtyId,
        licenseNumber: formData.licenseNumber,
        experienceYears: parseInt(formData.experience) || 0,
        departmentId: formData.departmentId,
        municipalityId: formData.municipalityId,
        addressLine: formData.addressLine,
        clinicName: formData.clinicName,
        services: formData.services.map(s => ({ ...s, durationMinutes: 30 })),
        availability: availabilityRules,
      });

      if (result.success) {
        setStep(6); // Paso de éxito
      } else {
        setError(result.error || 'Error al registrar');
      }
    } catch { setError('Error inesperado'); }
    finally { setLoading(false); }
  };

  // ─── Navigation ───
  const handleNext = () => { if (step < 5) setStep(step + 1); };
  const handleBack = () => { if (step > 1) setStep(step - 1); };
  const totalSteps = 5;

  // ─── RENDER ───
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between rounded-t-3xl z-10">
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full transition-colors cursor-pointer">
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
          {step >= 1 && step <= 5 && (
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map(s => (
                <div key={s} className={`h-1 rounded-full transition-all ${s === step ? 'w-8 bg-[#3C2285]' : s < step ? 'w-6 bg-emerald-700' : 'w-6 bg-gray-200'}`}></div>
              ))}
            </div>
          )}
          <div className="w-8"></div>
        </div>

        {/* Content */}
        <div className="p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* ═══ STEP 0: OTP Auth ═══ */}
          {step === 0 && !isAuthenticated && (
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Regístrate como médico</h3>
              <p className="text-gray-600">Primero verifica tu número de teléfono</p>

              {!otpSent ? (
                <>
                  <div className="relative">
                    <button type="button" onClick={() => setShowCountryDropdown(!showCountryDropdown)} className="w-full px-4 py-3 border border-gray-300 rounded-lg text-left flex items-center justify-between cursor-pointer">
                      <span>{selectedCountry.flag} {selectedCountry.name} ({selectedCountry.code})</span>
                      <i className={`ri-arrow-down-s-line text-xl text-gray-400 ${showCountryDropdown ? 'rotate-180' : ''}`}></i>
                    </button>
                    {showCountryDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border max-h-60 overflow-y-auto z-50">
                        {countries.map(c => (
                          <button key={c.code} type="button" onClick={() => { setCountryCode(c.code); setShowCountryDropdown(false); }} className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 cursor-pointer flex items-center gap-2">
                            <span>{c.flag}</span><span>{c.name} ({c.code})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input type="text" inputMode="numeric" value={phoneDisplay} onChange={e => formatPhone(e.target.value)} placeholder="7777-7777" className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900" />
                  <button onClick={handleSendOtp} disabled={!isPhoneValid || loading} className={`w-full py-3.5 rounded-lg font-semibold ${isPhoneValid && !loading ? 'bg-[#3C2285] text-white hover:bg-[#2d1a64] cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                    {loading ? 'Enviando...' : 'Enviar código'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-600">Código enviado a <span className="font-semibold">{countryCode} {phoneDisplay}</span></p>
                  <input type="text" inputMode="numeric" maxLength={6} value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="w-full px-4 py-4 border border-gray-300 rounded-lg text-center text-2xl font-bold tracking-[0.5em] focus:outline-none focus:border-[#3C2285] text-gray-900" autoFocus />
                  <button onClick={handleVerifyOtp} disabled={otpCode.length !== 6 || loading} className={`w-full py-3.5 rounded-lg font-semibold ${otpCode.length === 6 && !loading ? 'bg-[#3C2285] text-white hover:bg-[#2d1a64] cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                    {loading ? 'Verificando...' : 'Verificar'}
                  </button>
                  <button type="button" onClick={() => { setOtpSent(false); setOtpCode(''); setError(''); }} className="w-full text-sm text-[#3C2285] font-semibold hover:underline cursor-pointer">
                    Cambiar número
                  </button>
                </>
              )}
            </div>
          )}

          {/* ═══ STEP 1: Info Personal ═══ */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Información personal</h3>
              <p className="text-gray-600">Comencemos con tu información básica</p>

              {/* Photo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fotografía de perfil</label>
                <div className="flex items-start gap-4">
                  {formData.photoPreview ? (
                    <div className="relative">
                      <img src={formData.photoPreview} alt="Vista previa" className="w-32 h-40 rounded-xl object-cover object-top border-2 border-gray-200" />
                      <button type="button" onClick={removePhoto} className="absolute -top-2 -right-2 w-8 h-8 flex items-center justify-center bg-red-500 text-white rounded-full hover:bg-red-600 cursor-pointer"><i className="ri-close-line text-lg"></i></button>
                    </div>
                  ) : (
                    <div className="w-32 h-40 rounded-xl bg-gray-100 flex flex-col items-center justify-center border-2 border-dashed border-gray-300">
                      <i className="ri-user-line text-4xl text-gray-400 mb-2"></i>
                    </div>
                  )}
                  <div>
                    <label className="inline-block px-4 py-2.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <i className="ri-upload-2-line mr-2"></i>{formData.photoPreview ? 'Cambiar' : 'Subir foto'}
                      <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                    </label>
                    <p className="text-xs text-gray-500 mt-2">JPG, PNG. Máximo 5MB</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre completo *</label>
                <input type="text" value={formData.fullName} onChange={e => setFormData({ ...formData, fullName: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900" placeholder="Dr. Juan Pérez" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Correo electrónico *</label>
                <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900" placeholder="correo@ejemplo.com" />
              </div>
            </div>
          )}

          {/* ═══ STEP 2: Info Profesional ═══ */}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Información profesional</h3>
              <p className="text-gray-600">Cuéntanos sobre tu experiencia médica</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Especialidad *</label>
                <select value={formData.specialtyId} onChange={e => setFormData({ ...formData, specialtyId: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900 cursor-pointer">
                  <option value="">Selecciona una especialidad</option>
                  {specialties.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Número de licencia médica *</label>
                <input type="text" value={formData.licenseNumber} onChange={e => setFormData({ ...formData, licenseNumber: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900" placeholder="Ej: 12345" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Años de experiencia</label>
                <input type="text" value={formData.experience} onChange={e => setFormData({ ...formData, experience: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900" placeholder="Ej: 10" />
              </div>
            </div>
          )}

          {/* ═══ STEP 3: Ubicación ═══ */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Ubicación del consultorio</h3>
              <p className="text-gray-600">¿Dónde atiendes a tus pacientes?</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Departamento *</label>
                <select value={formData.departmentId} onChange={e => setFormData({ ...formData, departmentId: e.target.value, municipalityId: '' })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900 cursor-pointer">
                  <option value="">Selecciona departamento</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Municipio</label>
                <select value={formData.municipalityId} onChange={e => setFormData({ ...formData, municipalityId: e.target.value })} disabled={!formData.departmentId} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900 cursor-pointer disabled:opacity-50">
                  <option value="">Selecciona municipio</option>
                  {municipalities.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del consultorio</label>
                <input type="text" value={formData.clinicName} onChange={e => setFormData({ ...formData, clinicName: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900" placeholder="Consultorio Dr. Pérez" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Dirección completa *</label>
                <textarea value={formData.addressLine} onChange={e => setFormData({ ...formData, addressLine: e.target.value })} rows={3} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900 resize-none" placeholder="Calle, número, colonia, referencias..." />
              </div>
            </div>
          )}

          {/* ═══ STEP 4: Servicios ═══ */}
          {step === 4 && (
            <div className="space-y-6">
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Servicios y tarifas</h3>
              <p className="text-gray-600">¿Qué servicios ofreces?</p>

              <div className="grid grid-cols-2 gap-2">
                {commonServices.map(name => {
                  const selected = formData.services.some(s => s.name === name);
                  return (
                    <button key={name} type="button" onClick={() => toggleService(name)} className={`px-4 py-3 text-sm rounded-lg border transition-colors cursor-pointer text-left ${selected ? 'bg-[#3C2285] text-white border-[#3C2285]' : 'bg-white text-gray-700 border-gray-300 hover:border-[#3C2285]'}`}>
                      {name}
                    </button>
                  );
                })}
              </div>

              {formData.services.length > 0 && (
                <>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-slate-900 mb-2">Aplicar mismo precio a todos</p>
                    <div className="flex gap-2">
                      <div className="relative flex-1 max-w-xs">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-700 font-medium">$</span>
                        <input type="number" value={basePriceInput} onChange={e => setBasePriceInput(e.target.value)} className="w-full pl-7 pr-3 py-2 border border-emerald-300 rounded-lg focus:outline-none text-slate-900 text-sm" placeholder="50" min="0" />
                      </div>
                      <button type="button" onClick={applyBasePriceToAll} className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-medium text-sm hover:bg-emerald-800 cursor-pointer">Aplicar</button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {formData.services.map(service => (
                      <div key={service.name} className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
                        <div className="flex-1">
                          <p className="font-medium text-slate-900 mb-2">{service.name}</p>
                          <div className="relative max-w-xs">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-700">$</span>
                            <input type="number" value={service.price || ''} onChange={e => updateServicePrice(service.name, e.target.value)} className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none text-slate-900" placeholder="0.00" min="0" />
                          </div>
                          {servicePriceErrors[service.name] && <p className="text-xs text-red-600 mt-1">{servicePriceErrors[service.name]}</p>}
                        </div>
                        <button type="button" onClick={() => toggleService(service.name)} className="w-8 h-8 flex items-center justify-center hover:bg-red-50 rounded-lg cursor-pointer">
                          <i className="ri-delete-bin-line text-gray-400 hover:text-red-600"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ STEP 5: Disponibilidad ═══ */}
          {step === 5 && (
            <div className="space-y-4">
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">Disponibilidad</h3>
              <p className="text-gray-600">¿Qué días y horarios atiendes?</p>

              <div className="space-y-3">
                {dayLabels.map(day => {
                  const dayData = formData.availability[day.key];
                  return (
                    <div key={day.key} className="border border-gray-200 rounded-lg p-4">
                      <button type="button" onClick={() => toggleDay(day.key)} className={`flex items-center gap-3 px-4 py-2 rounded-lg border transition-colors cursor-pointer ${dayData.enabled ? 'bg-[#3C2285] text-white border-[#3C2285]' : 'bg-white text-gray-700 border-gray-300 hover:border-[#3C2285]'}`}>
                        <span className="font-medium">{day.label}</span>
                        {dayData.enabled && <i className="ri-check-line text-lg"></i>}
                      </button>
                      {dayData.enabled && (
                        <div className="grid grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Inicio</label>
                            <input type="time" value={dayData.startTime} onChange={e => updateDayTime(day.key, 'startTime', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Fin</label>
                            <input type="time" value={dayData.endTime} onChange={e => updateDayTime(day.key, 'endTime', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none text-sm" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <div className="flex items-start gap-3">
                  <i className="ri-information-line text-[#3C2285] text-xl mt-0.5"></i>
                  <p className="text-sm text-gray-700">Después de enviar tu registro, nuestro equipo revisará tu información y te contactará en 48 horas.</p>
                </div>
              </div>
            </div>
          )}

          {/* ═══ STEP 6: Éxito ═══ */}
          {step === 6 && (
            <div className="text-center py-8">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <i className="ri-check-line text-4xl text-emerald-700"></i>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">¡Registro enviado!</h3>
              <p className="text-gray-600 mb-6">Tu información ha sido guardada. Nuestro equipo revisará tus datos y te contactará en un plazo de 48 horas para completar la verificación.</p>
              <button onClick={onClose} className="px-8 py-3 bg-[#3C2285] text-white rounded-lg font-semibold hover:bg-[#2d1a64] cursor-pointer">
                Entendido
              </button>
            </div>
          )}

          {/* ═══ Navigation Buttons ═══ */}
          {step >= 1 && step <= 5 && (
            <div className="flex gap-3 mt-8">
              {step > 1 && (
                <button onClick={handleBack} className="flex-1 py-3.5 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer font-semibold">
                  Atrás
                </button>
              )}
              {step < 5 ? (
                <button onClick={handleNext} disabled={!isStepValid()} className={`flex-1 py-3.5 rounded-lg font-semibold cursor-pointer ${isStepValid() ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                  Siguiente
                </button>
              ) : (
                <button onClick={handleSubmit} disabled={!isStepValid() || loading} className={`flex-1 py-3.5 rounded-lg font-semibold cursor-pointer ${isStepValid() && !loading ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                  {loading ? 'Enviando...' : 'Enviar registro'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
