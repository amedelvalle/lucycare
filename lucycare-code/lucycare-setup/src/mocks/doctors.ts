import { makeFutureSlot } from '../utils/date';

export interface DoctorLocation {
  departmentId: string;
  municipalityId: string;
  addressLine: string;
}

export interface Doctor {
  id: number;
  name: string;
  specialty: string;
  phone: string;
  address: string;
  location: DoctorLocation;
  image: string;
  rating: number;
  reviews: number;
  experience: string;
  about: string;
  education: string[];
  languages: string[];
  consultationFee: number;
  lucyStatus: 'LISTED_ONLY' | 'CLAIMED' | 'BOOKING_ENABLED' | 'VERIFIED';
  bookingEnabled: boolean;
  nextAvailableSlot?: string;
  images: string[];
  services: string[];
}

export const doctors: Doctor[] = [
  {
    id: 1,
    name: 'Dr. Carlos Mendoza García',
    specialty: 'Cardiología',
    phone: '+503 2234 5678',
    address: 'Av. La Revolución 1234, Col. San Benito, San Salvador',
    location: {
      departmentId: 'SS',
      municipalityId: 'SS-01',
      addressLine: 'Av. La Revolución 1234, Col. San Benito'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20male%20cardiologist%20doctor%20in%20white%20medical%20coat%20with%20stethoscope%2C%20friendly%20smile%2C%20modern%20medical%20office%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20confident%20pose%2C%20middle-aged%20Hispanic%20doctor&width=400&height=400&seq=1&orientation=squarish',
    rating: 4.9,
    reviews: 127,
    experience: '15 años',
    about: 'Especialista en cardiología con más de 15 años de experiencia en el diagnóstico y tratamiento de enfermedades cardiovasculares. Certificado por el Consejo Salvadoreño de Cardiología.',
    education: [
      'Medicina - Universidad de El Salvador',
      'Especialidad en Cardiología - Hospital Rosales',
      'Fellowship en Cardiología Intervencionista - Cleveland Clinic'
    ],
    languages: ['Español', 'Inglés'],
    consultationFee: 80,
    lucyStatus: 'BOOKING_ENABLED' as const,
    bookingEnabled: true,
    nextAvailableSlot: makeFutureSlot(2, 10, 0), // 2 días adelante, 10:00 AM
    images: [
      'https://readdy.ai/api/search-image?query=Modern%20cardiology%20medical%20office%20interior%20with%20examination%20table%2C%20medical%20equipment%2C%20ECG%20machine%2C%20clean%20professional%20environment%2C%20bright%20natural%20lighting%2C%20contemporary%20medical%20furniture%2C%20white%20walls%2C%20organized%20medical%20space&width=800&height=600&seq=101&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Cardiology%20clinic%20waiting%20room%20with%20comfortable%20seating%2C%20modern%20decor%2C%20medical%20certificates%20on%20walls%2C%20reception%20desk%2C%20professional%20healthcare%20environment%2C%20clean%20bright%20space%2C%20contemporary%20design&width=800&height=600&seq=102&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Medical%20consultation%20room%20with%20desk%2C%20computer%2C%20medical%20charts%2C%20stethoscope%2C%20blood%20pressure%20monitor%2C%20professional%20cardiology%20office%20setup%2C%20organized%20workspace%2C%20natural%20lighting&width=800&height=600&seq=103&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Advanced%20cardiology%20diagnostic%20equipment%20room%2C%20ECG%20machines%2C%20ultrasound%20equipment%2C%20modern%20medical%20technology%2C%20professional%20healthcare%20facility%2C%20clean%20sterile%20environment&width=800&height=600&seq=104&orientation=landscape'
    ],
    services: [
      'Consulta general de cardiología',
      'Electrocardiograma',
      'Ecocardiograma',
      'Prueba de esfuerzo',
      'Monitoreo Holter 24hrs',
      'Control de hipertensión'
    ]
  },
  {
    id: 2,
    name: 'Dra. María Fernanda López',
    specialty: 'Pediatría',
    phone: '+503 2345 6789',
    address: 'Calle Arce 567, Col. Centro, Santa Ana',
    location: {
      departmentId: 'SA',
      municipalityId: 'SA-01',
      addressLine: 'Calle Arce 567, Col. Centro'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20female%20pediatrician%20doctor%20in%20white%20medical%20coat%20with%20stethoscope%2C%20warm%20friendly%20smile%2C%20modern%20pediatric%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20caring%20expression%2C%20young%20Hispanic%20female%20doctor&width=400&height=400&seq=2&orientation=squarish',
    rating: 5.0,
    reviews: 203,
    experience: '12 años',
    about: 'Pediatra dedicada al cuidado integral de niños y adolescentes. Especializada en desarrollo infantil, vacunación y prevención de enfermedades.',
    education: [
      'Medicina - Universidad de El Salvador',
      'Especialidad en Pediatría - Hospital Nacional de Niños Benjamín Bloom',
      'Diplomado en Nutrición Pediátrica'
    ],
    languages: ['Español'],
    consultationFee: 60,
    lucyStatus: 'LISTED_ONLY' as const,
    bookingEnabled: false,
    nextAvailableSlot: undefined,
    images: [
      'https://readdy.ai/api/search-image?query=Colorful%20pediatric%20clinic%20examination%20room%20with%20child-friendly%20decorations%2C%20toys%2C%20cartoon%20characters%20on%20walls%2C%20medical%20examination%20table%2C%20bright%20cheerful%20environment%2C%20modern%20pediatric%20office&width=800&height=600&seq=201&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Pediatric%20waiting%20room%20with%20play%20area%2C%20colorful%20furniture%2C%20toys%2C%20books%2C%20child-friendly%20decor%2C%20comfortable%20seating%20for%20parents%2C%20bright%20welcoming%20space&width=800&height=600&seq=202&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Pediatric%20consultation%20room%20with%20growth%20charts%2C%20vaccination%20posters%2C%20child-sized%20furniture%2C%20medical%20equipment%2C%20friendly%20colorful%20environment&width=800&height=600&seq=203&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Modern%20pediatric%20clinic%20reception%20area%2C%20colorful%20design%2C%20child-friendly%20atmosphere%2C%20professional%20healthcare%20setting%2C%20bright%20natural%20lighting&width=800&height=600&seq=204&orientation=landscape'
    ],
    services: [
      'Consulta pediátrica general',
      'Control de niño sano',
      'Vacunación',
      'Valoración de crecimiento',
      'Orientación nutricional',
      'Atención de enfermedades comunes'
    ]
  },
  {
    id: 3,
    name: 'Dr. Roberto Sánchez Ruiz',
    specialty: 'Dermatología',
    phone: '+503 2456 7890',
    address: 'Blvd. del Hipódromo 890, Col. San Benito, San Salvador',
    location: {
      departmentId: 'SS',
      municipalityId: 'SS-01',
      addressLine: 'Blvd. del Hipódromo 890, Col. San Benito'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20male%20dermatologist%20doctor%20in%20white%20medical%20coat%2C%20professional%20smile%2C%20modern%20dermatology%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20confident%20demeanor%2C%20Hispanic%20doctor%20in%20his%20forties&width=400&height=400&seq=3&orientation=squarish',
    rating: 4.8,
    reviews: 156,
    experience: '18 años',
    about: 'Dermatólogo certificado con amplia experiencia en el tratamiento de enfermedades de la piel, procedimientos estéticos y dermatología cosmética.',
    education: [
      'Medicina - Universidad Dr. José Matías Delgado',
      'Especialidad en Dermatología - Hospital Rosales',
      'Certificación en Dermatología Cosmética'
    ],
    languages: ['Español', 'Inglés'],
    consultationFee: 75,
    lucyStatus: 'CLAIMED' as const,
    bookingEnabled: false,
    nextAvailableSlot: undefined,
    images: [
      'https://readdy.ai/api/search-image?query=Modern%20dermatology%20clinic%20treatment%20room%20with%20examination%20chair%2C%20dermatoscope%2C%20laser%20equipment%2C%20clean%20white%20environment%2C%20professional%20medical%20setting%2C%20bright%20lighting&width=800&height=600&seq=301&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Dermatology%20consultation%20room%20with%20skin%20analysis%20equipment%2C%20computer%20with%20imaging%20software%2C%20professional%20medical%20office%2C%20clean%20contemporary%20design&width=800&height=600&seq=302&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Aesthetic%20dermatology%20treatment%20room%20with%20modern%20equipment%2C%20comfortable%20treatment%20bed%2C%20skincare%20products%20display%2C%20professional%20spa-like%20environment&width=800&height=600&seq=303&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Dermatology%20clinic%20waiting%20area%20with%20elegant%20modern%20design%2C%20comfortable%20seating%2C%20skincare%20magazines%2C%20professional%20healthcare%20atmosphere&width=800&height=600&seq=304&orientation=landscape'
    ],
    services: [
      'Consulta dermatológica',
      'Tratamiento de acné',
      'Eliminación de lunares',
      'Tratamientos láser',
      'Peeling químico',
      'Botox y rellenos'
    ]
  },
  {
    id: 4,
    name: 'Dra. Ana Patricia Morales',
    specialty: 'Neurología',
    phone: '+503 2567 8901',
    address: 'Av. Independencia 234, Col. Escalón, San Salvador',
    location: {
      departmentId: 'SS',
      municipalityId: 'SS-01',
      addressLine: 'Av. Independencia 234, Col. Escalón'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20female%20neurologist%20doctor%20in%20white%20medical%20coat%20with%20stethoscope%2C%20intelligent%20expression%2C%20modern%20neurology%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20serious%20professional%20demeanor%2C%20Hispanic%20female%20doctor&width=400&height=400&seq=4&orientation=squarish',
    rating: 4.9,
    reviews: 189,
    experience: '20 años',
    about: 'Neuróloga con vasta experiencia en el diagnóstico y tratamiento de enfermedades del sistema nervioso. Especializada en cefaleas, epilepsia y trastornos del movimiento.',
    education: [
      'Medicina - Universidad de El Salvador',
      'Especialidad en Neurología - Hospital Rosales',
      'Maestría en Neurociencias'
    ],
    languages: ['Español', 'Inglés', 'Francés'],
    consultationFee: 85,
    lucyStatus: 'VERIFIED' as const,
    bookingEnabled: true,
    nextAvailableSlot: makeFutureSlot(1, 14, 30), // Mañana, 2:30 PM
    images: [
      'https://readdy.ai/api/search-image?query=Neurology%20clinic%20examination%20room%20with%20neurological%20testing%20equipment%2C%20reflex%20hammers%2C%20brain%20models%2C%20modern%20medical%20office%2C%20professional%20healthcare%20environment&width=800&height=600&seq=401&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Modern%20neurology%20consultation%20office%20with%20desk%2C%20computer%20showing%20brain%20scans%2C%20medical%20books%2C%20professional%20workspace%2C%20clean%20organized%20environment&width=800&height=600&seq=402&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Neurology%20diagnostic%20room%20with%20EEG%20equipment%2C%20monitoring%20screens%2C%20comfortable%20patient%20chair%2C%20advanced%20medical%20technology%2C%20professional%20setting&width=800&height=600&seq=403&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Neurology%20clinic%20waiting%20room%20with%20calming%20decor%2C%20comfortable%20seating%2C%20medical%20certificates%2C%20professional%20healthcare%20atmosphere%2C%20natural%20lighting&width=800&height=600&seq=404&orientation=landscape'
    ],
    services: [
      'Consulta neurológica',
      'Electroencefalograma',
      'Tratamiento de migraña',
      'Manejo de epilepsia',
      'Evaluación de mareos',
      'Trastornos del sueño'
    ]
  },
  {
    id: 5,
    name: 'Dr. Luis Alberto Ramírez',
    specialty: 'Oftalmología',
    phone: '+503 2678 9012',
    address: 'Calle Rubén Darío 456, Col. Centro, San Miguel',
    location: {
      departmentId: 'SM',
      municipalityId: 'SM-01',
      addressLine: 'Calle Rubén Darío 456, Col. Centro'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20male%20ophthalmologist%20doctor%20in%20white%20medical%20coat%2C%20friendly%20professional%20smile%2C%20modern%20eye%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20trustworthy%20appearance%2C%20Hispanic%20doctor%20wearing%20glasses&width=400&height=400&seq=5&orientation=squarish',
    rating: 4.7,
    reviews: 142,
    experience: '14 años',
    about: 'Oftalmólogo especializado en cirugía refractiva, cataratas y enfermedades de la retina. Comprometido con la salud visual de sus pacientes.',
    education: [
      'Medicina - Universidad Evangélica de El Salvador',
      'Especialidad en Oftalmología - Hospital Rosales',
      'Fellowship en Cirugía Refractiva'
    ],
    languages: ['Español', 'Inglés'],
    consultationFee: 70,
    lucyStatus: 'BOOKING_ENABLED' as const,
    bookingEnabled: true,
    nextAvailableSlot: makeFutureSlot(3, 9, 0), // 3 días adelante, 9:00 AM
    images: [
      'https://readdy.ai/api/search-image?query=Modern%20ophthalmology%20clinic%20examination%20room%20with%20phoropter%2C%20slit%20lamp%2C%20eye%20chart%2C%20professional%20eye%20care%20equipment%2C%20clean%20medical%20environment&width=800&height=600&seq=501&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Eye%20clinic%20consultation%20room%20with%20optical%20equipment%2C%20vision%20testing%20devices%2C%20comfortable%20patient%20chair%2C%20professional%20ophthalmology%20office&width=800&height=600&seq=502&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Ophthalmology%20clinic%20optical%20shop%20with%20eyeglasses%20display%2C%20modern%20frames%2C%20professional%20optometry%20setting%2C%20bright%20clean%20environment&width=800&height=600&seq=503&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Eye%20surgery%20preparation%20room%20with%20advanced%20ophthalmic%20equipment%2C%20sterile%20environment%2C%20modern%20medical%20technology%2C%20professional%20healthcare%20facility&width=800&height=600&seq=504&orientation=landscape'
    ],
    services: [
      'Consulta oftalmológica',
      'Examen de la vista',
      'Cirugía de cataratas',
      'Cirugía refractiva LASIK',
      'Tratamiento de glaucoma',
      'Fondo de ojo'
    ]
  },
  {
    id: 6,
    name: 'Dra. Carmen Beatriz Torres',
    specialty: 'Ginecología',
    phone: '+503 2789 0123',
    address: 'Av. Olimpica 789, Col. Flor Blanca, San Salvador',
    location: {
      departmentId: 'SS',
      municipalityId: 'SS-01',
      addressLine: 'Av. Olimpica 789, Col. Flor Blanca'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20female%20gynecologist%20doctor%20in%20white%20medical%20coat%20with%20stethoscope%2C%20warm%20caring%20smile%2C%20modern%20gynecology%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20compassionate%20expression%2C%20Hispanic%20female%20doctor&width=400&height=400&seq=6&orientation=squarish',
    rating: 5.0,
    reviews: 234,
    experience: '16 años',
    about: 'Ginecóloga y obstetra dedicada a la salud integral de la mujer. Especializada en embarazo de alto riesgo y cirugía ginecológica mínimamente invasiva.',
    education: [
      'Medicina - Universidad de El Salvador',
      'Especialidad en Ginecología y Obstetricia - Hospital de Maternidad',
      'Certificación en Ultrasonido Obstétrico'
    ],
    languages: ['Español', 'Inglés'],
    consultationFee: 65,
    lucyStatus: 'LISTED_ONLY' as const,
    bookingEnabled: false,
    nextAvailableSlot: undefined,
    images: [
      'https://readdy.ai/api/search-image?query=Modern%20gynecology%20examination%20room%20with%20examination%20table%2C%20ultrasound%20machine%2C%20medical%20equipment%2C%20comfortable%20private%20setting%2C%20professional%20healthcare%20environment&width=800&height=600&seq=601&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Gynecology%20consultation%20office%20with%20desk%2C%20educational%20posters%2C%20comfortable%20seating%2C%20professional%20medical%20setting%2C%20calming%20atmosphere&width=800&height=600&seq=602&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Obstetric%20ultrasound%20room%20with%204D%20ultrasound%20equipment%2C%20comfortable%20examination%20bed%2C%20dim%20lighting%2C%20professional%20prenatal%20care%20facility&width=800&height=600&seq=603&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Women%20health%20clinic%20waiting%20room%20with%20comfortable%20seating%2C%20magazines%2C%20calming%20decor%2C%20professional%20healthcare%20atmosphere%2C%20natural%20lighting&width=800&height=600&seq=604&orientation=landscape'
    ],
    services: [
      'Consulta ginecológica',
      'Control prenatal',
      'Ultrasonido obstétrico',
      'Papanicolaou',
      'Planificación familiar',
      'Cirugía laparoscópica'
    ]
  },
  {
    id: 7,
    name: 'Dr. Jorge Eduardo Castillo',
    specialty: 'Traumatología',
    phone: '+503 2890 1234',
    address: 'Blvd. Los Próceres 321, Col. San Francisco, San Salvador',
    location: {
      departmentId: 'SS',
      municipalityId: 'SS-01',
      addressLine: 'Blvd. Los Próceres 321, Col. San Francisco'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20male%20orthopedic%20traumatologist%20doctor%20in%20white%20medical%20coat%2C%20confident%20smile%2C%20modern%20orthopedic%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20strong%20professional%20presence%2C%20Hispanic%20doctor&width=400&height=400&seq=7&orientation=squarish',
    rating: 4.8,
    reviews: 167,
    experience: '22 años',
    about: 'Traumatólogo y cirujano ortopedista con más de dos décadas de experiencia. Especializado en cirugía de columna, reemplazo articular y medicina deportiva.',
    education: [
      'Medicina - Universidad de El Salvador',
      'Especialidad en Traumatología y Ortopedia - Hospital Rosales',
      'Fellowship en Cirugía de Columna - Hospital for Special Surgery, NY'
    ],
    languages: ['Español', 'Inglés'],
    consultationFee: 90,
    lucyStatus: 'CLAIMED' as const,
    bookingEnabled: false,
    nextAvailableSlot: undefined,
    images: [
      'https://readdy.ai/api/search-image?query=Orthopedic%20clinic%20examination%20room%20with%20X-ray%20viewer%2C%20skeletal%20models%2C%20examination%20table%2C%20medical%20equipment%2C%20professional%20traumatology%20office&width=800&height=600&seq=701&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Sports%20medicine%20and%20orthopedic%20consultation%20room%20with%20anatomical%20models%2C%20rehabilitation%20equipment%2C%20professional%20medical%20office%2C%20modern%20design&width=800&height=600&seq=702&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Orthopedic%20surgery%20consultation%20office%20with%20computer%20showing%20X-rays%20and%20MRI%20scans%2C%20medical%20books%2C%20professional%20workspace&width=800&height=600&seq=703&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Physical%20therapy%20and%20rehabilitation%20area%20with%20exercise%20equipment%2C%20treatment%20tables%2C%20orthopedic%20clinic%20setting%2C%20professional%20healthcare%20facility&width=800&height=600&seq=704&orientation=landscape'
    ],
    services: [
      'Consulta traumatológica',
      'Cirugía de fracturas',
      'Reemplazo de rodilla',
      'Cirugía de columna',
      'Artroscopia',
      'Medicina deportiva'
    ]
  },
  {
    id: 8,
    name: 'Dra. Sofía Gabriela Herrera',
    specialty: 'Psiquiatría',
    phone: '+503 2901 2345',
    address: 'Calle Los Sisimiles 456, Col. Miramonte, Santa Tecla',
    location: {
      departmentId: 'LI',
      municipalityId: 'LI-01',
      addressLine: 'Calle Los Sisimiles 456, Col. Miramonte'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20female%20psychiatrist%20doctor%20in%20white%20medical%20coat%2C%20gentle%20understanding%20smile%2C%20modern%20psychiatric%20office%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20empathetic%20expression%2C%20Hispanic%20female%20doctor&width=400&height=400&seq=8&orientation=squarish',
    rating: 4.9,
    reviews: 198,
    experience: '13 años',
    about: 'Psiquiatra especializada en trastornos del estado de ánimo, ansiedad y psicoterapia. Enfoque integral combinando tratamiento farmacológico y psicoterapéutico.',
    education: [
      'Medicina - Universidad Centroamericana José Simeón Cañas',
      'Especialidad en Psiquiatría - Hospital Rosales',
      'Certificación en Terapia Cognitivo-Conductual'
    ],
    languages: ['Español', 'Inglés'],
    consultationFee: 75,
    lucyStatus: 'BOOKING_ENABLED' as const,
    bookingEnabled: true,
    nextAvailableSlot: makeFutureSlot(5, 11, 0), // 5 días adelante, 11:00 AM
    images: [
      'https://readdy.ai/api/search-image?query=Comfortable%20psychiatric%20consultation%20office%20with%20couch%2C%20armchairs%2C%20calming%20colors%2C%20plants%2C%20professional%20therapy%20room%2C%20warm%20inviting%20atmosphere&width=800&height=600&seq=801&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Modern%20psychiatry%20office%20with%20desk%2C%20comfortable%20seating%2C%20bookshelves%2C%20calming%20artwork%2C%20professional%20mental%20health%20setting%2C%20natural%20lighting&width=800&height=600&seq=802&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Therapy%20consultation%20room%20with%20comfortable%20furniture%2C%20soft%20lighting%2C%20calming%20decor%2C%20private%20confidential%20setting%2C%20professional%20mental%20health%20office&width=800&height=600&seq=803&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Mental%20health%20clinic%20waiting%20room%20with%20comfortable%20seating%2C%20calming%20colors%2C%20plants%2C%20peaceful%20atmosphere%2C%20professional%20healthcare%20environment&width=800&height=600&seq=804&orientation=landscape'
    ],
    services: [
      'Consulta psiquiátrica',
      'Tratamiento de depresión',
      'Manejo de ansiedad',
      'Trastorno bipolar',
      'Psicoterapia',
      'Evaluación psiquiátrica'
    ]
  },
  {
    id: 9,
    name: 'Dr. Miguel Ángel Flores',
    specialty: 'Medicina General',
    phone: '+503 2012 3456',
    address: 'Av. Manuel Enrique Araujo 678, Col. Escalón, San Salvador',
    location: {
      departmentId: 'SS',
      municipalityId: 'SS-01',
      addressLine: 'Av. Manuel Enrique Araujo 678, Col. Escalón'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20male%20general%20practitioner%20doctor%20in%20white%20medical%20coat%20with%20stethoscope%2C%20friendly%20approachable%20smile%2C%20modern%20medical%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20welcoming%20demeanor%2C%20Hispanic%20doctor&width=400&height=400&seq=9&orientation=squarish',
    rating: 4.7,
    reviews: 211,
    experience: '10 años',
    about: 'Médico general dedicado a la atención primaria de salud. Enfoque preventivo y manejo integral de enfermedades crónicas.',
    education: [
      'Medicina - Universidad de El Salvador',
      'Diplomado en Medicina Familiar',
      'Certificación en Urgencias Médicas'
    ],
    languages: ['Español'],
    consultationFee: 50,
    lucyStatus: 'LISTED_ONLY' as const,
    bookingEnabled: false,
    nextAvailableSlot: undefined,
    images: [
      'https://readdy.ai/api/search-image?query=General%20practice%20medical%20office%20with%20examination%20table%2C%20basic%20medical%20equipment%2C%20stethoscope%2C%20blood%20pressure%20monitor%2C%20clean%20professional%20environment&width=800&height=600&seq=901&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Family%20medicine%20consultation%20room%20with%20desk%2C%20computer%2C%20medical%20charts%2C%20comfortable%20patient%20seating%2C%20professional%20primary%20care%20office&width=800&height=600&seq=902&orientation=landscape',
      'https://readdy.ai/api/search-image?query=General%20medical%20clinic%20examination%20room%20with%20basic%20diagnostic%20equipment%2C%20clean%20organized%20space%2C%20professional%20healthcare%20setting&width=800&height=600&seq=903&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Primary%20care%20clinic%20waiting%20room%20with%20comfortable%20seating%2C%20health%20education%20posters%2C%20reception%20desk%2C%20welcoming%20atmosphere&width=800&height=600&seq=904&orientation=landscape'
    ],
    services: [
      'Consulta general',
      'Chequeo médico',
      'Control de diabetes',
      'Manejo de hipertensión',
      'Certificados médicos',
      'Atención de urgencias menores'
    ]
  },
  {
    id: 10,
    name: 'Dra. Daniela Alejandra Vega',
    specialty: 'Endocrinología',
    phone: '+503 2123 4567',
    address: 'Av. La Capilla 901, Col. San Benito, San Salvador',
    location: {
      departmentId: 'SS',
      municipalityId: 'SS-01',
      addressLine: 'Av. La Capilla 901, Col. San Benito'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20female%20endocrinologist%20doctor%20in%20white%20medical%20coat%2C%20professional%20confident%20smile%2C%20modern%20endocrinology%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20expert%20appearance%2C%20Hispanic%20female%20doctor&width=400&height=400&seq=10&orientation=squarish',
    rating: 5.0,
    reviews: 176,
    experience: '17 años',
    about: 'Endocrinóloga especializada en diabetes, tiroides y trastornos hormonales. Enfoque personalizado en el manejo de enfermedades metabólicas.',
    education: [
      'Medicina - Universidad Dr. José Matías Delgado',
      'Especialidad en Endocrinología - Hospital Rosales',
      'Maestría en Nutrición Clínica'
    ],
    languages: ['Español', 'Inglés'],
    consultationFee: 80,
    lucyStatus: 'VERIFIED' as const,
    bookingEnabled: true,
    nextAvailableSlot: makeFutureSlot(1, 14, 30), // Mañana, 2:30 PM
    images: [
      'https://readdy.ai/api/search-image?query=Endocrinology%20clinic%20consultation%20room%20with%20metabolic%20testing%20equipment%2C%20body%20composition%20analyzer%2C%20professional%20medical%20office%2C%20modern%20healthcare%20setting&width=800&height=600&seq=1001&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Modern%20endocrinology%20office%20with%20desk%2C%20computer%2C%20educational%20materials%20about%20diabetes%20and%20thyroid%2C%20professional%20consultation%20space&width=800&height=600&seq=1002&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Diabetes%20care%20clinic%20with%20glucose%20monitoring%20equipment%2C%20nutritional%20counseling%20area%2C%20professional%20endocrinology%20setting&width=800&height=600&seq=1003&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Endocrinology%20clinic%20waiting%20room%20with%20comfortable%20seating%2C%20health%20education%20materials%2C%20professional%20healthcare%20atmosphere&width=800&height=600&seq=1004&orientation=landscape'
    ],
    services: [
      'Consulta endocrinológica',
      'Manejo de diabetes',
      'Trastornos de tiroides',
      'Control de obesidad',
      'Trastornos hormonales',
      'Osteoporosis'
    ]
  },
  {
    id: 11,
    name: 'Dr. Fernando Javier Ortiz',
    specialty: 'Cardiología',
    phone: '+503 2234 5679',
    address: 'Calle Loma Linda 1122, Col. Lomas de San Francisco, Antiguo Cuscatlán',
    location: {
      departmentId: 'LI',
      municipalityId: 'LI-02',
      addressLine: 'Calle Loma Linda 1122, Col. Lomas de San Francisco'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20male%20cardiologist%20doctor%20in%20white%20medical%20coat%20with%20stethoscope%2C%20experienced%20confident%20smile%2C%20modern%20cardiology%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20distinguished%20appearance%2C%20senior%20Hispanic%20doctor&width=400&height=400&seq=11&orientation=squarish',
    rating: 4.8,
    reviews: 145,
    experience: '25 años',
    about: 'Cardiólogo intervencionista con vasta experiencia en procedimientos cardiovasculares complejos. Pionero en técnicas de cateterismo cardíaco en El Salvador.',
    education: [
      'Medicina - Universidad de El Salvador',
      'Especialidad en Cardiología - Hospital Rosales',
      'Fellowship en Cardiología Intervencionista - Mayo Clinic'
    ],
    languages: ['Español', 'Inglés'],
    consultationFee: 95,
    lucyStatus: 'CLAIMED' as const,
    bookingEnabled: false,
    nextAvailableSlot: undefined,
    images: [
      'https://readdy.ai/api/search-image?query=Advanced%20cardiology%20clinic%20with%20state-of-the-art%20equipment%2C%20catheterization%20lab%2C%20modern%20medical%20technology%2C%20professional%20cardiovascular%20center&width=800&height=600&seq=1101&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Interventional%20cardiology%20consultation%20office%20with%20heart%20models%2C%20angiography%20images%2C%20professional%20medical%20workspace%2C%20modern%20design&width=800&height=600&seq=1102&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Cardiology%20diagnostic%20center%20with%20echocardiography%20equipment%2C%20stress%20test%20machines%2C%20professional%20cardiovascular%20clinic&width=800&height=600&seq=1103&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Premium%20cardiology%20clinic%20waiting%20area%20with%20elegant%20design%2C%20comfortable%20seating%2C%20cardiovascular%20health%20information%2C%20professional%20atmosphere&width=800&height=600&seq=1104&orientation=landscape'
    ],
    services: [
      'Consulta cardiológica avanzada',
      'Cateterismo cardíaco',
      'Angioplastia coronaria',
      'Ecocardiograma transesofágico',
      'Prueba de esfuerzo nuclear',
      'Implante de stents'
    ]
  },
  {
    id: 12,
    name: 'Dra. Valentina Isabel Cruz',
    specialty: 'Pediatría',
    phone: '+503 2345 6780',
    address: 'Av. Roosevelt 345, Col. Flor Blanca, San Salvador',
    location: {
      departmentId: 'SS',
      municipalityId: 'SS-01',
      addressLine: 'Av. Roosevelt 345, Col. Flor Blanca'
    },
    image: 'https://readdy.ai/api/search-image?query=Professional%20female%20pediatrician%20doctor%20in%20white%20medical%20coat%2C%20cheerful%20warm%20smile%2C%20modern%20pediatric%20clinic%20background%2C%20professional%20portrait%20photography%2C%20clean%20white%20background%2C%20natural%20lighting%2C%20friendly%20caring%20expression%2C%20young%20Hispanic%20female%20doctor&width=400&height=400&seq=12&orientation=squarish',
    rating: 4.9,
    reviews: 187,
    experience: '11 años',
    about: 'Pediatra apasionada por el cuidado de los niños. Especializada en lactancia materna, desarrollo infantil temprano y enfermedades respiratorias pediátricas.',
    education: [
      'Medicina - Universidad Evangélica de El Salvador',
      'Especialidad en Pediatría - Hospital Nacional de Niños Benjamín Bloom',
      'Certificación en Lactancia Materna IBCLC'
    ],
    languages: ['Español'],
    consultationFee: 55,
    lucyStatus: 'BOOKING_ENABLED' as const,
    bookingEnabled: true,
    nextAvailableSlot: makeFutureSlot(1, 14, 30), // Mañana, 2:30 PM
    images: [
      'https://readdy.ai/api/search-image?query=Bright%20colorful%20pediatric%20examination%20room%20with%20cartoon%20decorations%2C%20child-friendly%20medical%20equipment%2C%20toys%2C%20cheerful%20environment&width=800&height=600&seq=1201&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Pediatric%20consultation%20office%20with%20growth%20and%20development%20charts%2C%20vaccination%20information%2C%20child-friendly%20decor%2C%20professional%20setting&width=800&height=600&seq=1202&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Pediatric%20clinic%20play%20area%20with%20educational%20toys%2C%20books%2C%20colorful%20furniture%2C%20safe%20child-friendly%20environment&width=800&height=600&seq=1203&orientation=landscape',
      'https://readdy.ai/api/search-image?query=Modern%20pediatric%20clinic%20reception%20with%20colorful%20design%2C%20comfortable%20family%20seating%2C%20welcoming%20atmosphere%20for%20children&width=800&height=600&seq=1204&orientation=landscape'
    ],
    services: [
      'Consulta pediátrica',
      'Asesoría de lactancia',
      'Valoración del desarrollo',
      'Vacunación completa',
      'Enfermedades respiratorias',
      'Orientación a padres'
    ]
  }
];
