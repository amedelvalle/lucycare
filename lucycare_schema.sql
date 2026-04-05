-- ============================================================
-- LUCYCARE — Schema completo de base de datos
-- PostgreSQL (Supabase) • Versión 1.0 • Abril 2026
-- 24 tablas, ~242 campos
-- ============================================================
-- IMPORTANTE: Ejecutar este archivo COMPLETO en el SQL Editor
-- de Supabase en una sola ejecución.
-- ============================================================

-- ============================================================
-- 0. EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. TIPOS ENUM
-- ============================================================
CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'assistant', 'admin');
CREATE TYPE clinic_member_role AS ENUM ('owner', 'doctor', 'assistant');
CREATE TYPE lucy_status AS ENUM ('listed_only', 'claimed', 'booking_enabled', 'verified');
CREATE TYPE document_type AS ENUM ('dui', 'partida_nacimiento', 'pasaporte', 'carnet_residente');
CREATE TYPE gender_type AS ENUM ('masculino', 'femenino', 'otro');
CREATE TYPE patient_type AS ENUM ('privado', 'asegurado');
CREATE TYPE blood_type AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'desconocido');
CREATE TYPE appointment_source AS ENUM ('manual', 'lucy_directorio', 'lucy_seguimiento');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'refunded');
CREATE TYPE consultation_status AS ENUM ('draft', 'signed');
CREATE TYPE diagnosis_type AS ENUM ('presuntivo', 'definitivo', 'diferencial');
CREATE TYPE diagnosis_status AS ENUM ('activo', 'resuelto', 'en_tratamiento', 'cronico', 'en_observacion');
CREATE TYPE duration_unit AS ENUM ('dias', 'semanas', 'meses', 'permanente');
CREATE TYPE medication_presentation AS ENUM ('tableta', 'capsula', 'jarabe', 'inyectable', 'crema', 'gotas', 'suspension', 'parche', 'inhalador', 'supositorio', 'otro');
CREATE TYPE notification_channel AS ENUM ('sms', 'whatsapp', 'email');
CREATE TYPE notification_type AS ENUM ('reminder_24h', 'confirmation', 'cancellation', 'new_booking');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE audit_action AS ENUM ('select', 'insert', 'update', 'delete');
CREATE TYPE cancel_reason_category AS ENUM ('paciente', 'medico', 'sistema');

-- ============================================================
-- 2. TABLAS CORE DE AUTENTICACIÓN Y ORGANIZACIÓN
-- ============================================================

-- profiles: Extiende auth.users de Supabase. Un registro por usuario.
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'patient',
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- clinics: Tenant principal. Cada médico tiene al menos 1 clínica/consultorio.
CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  phone TEXT,
  address_line TEXT,
  department_id TEXT, -- FK se agrega después de crear departments
  municipality_id TEXT, -- FK se agrega después de crear municipalities
  logo_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/El_Salvador',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- clinic_members: Relación N:N entre clínicas y usuarios.
CREATE TABLE clinic_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role clinic_member_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, profile_id)
);

-- ============================================================
-- 3. CATÁLOGOS DEL SISTEMA (globales, precargados)
-- ============================================================

-- specialties: Catálogo de especialidades médicas.
CREATE TABLE specialties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- appointment_statuses: Los 6 estados del ciclo de vida de una cita.
CREATE TABLE appointment_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  color TEXT NOT NULL,
  funnel_order INT NOT NULL,
  is_final BOOLEAN NOT NULL,
  affects_revenue BOOLEAN NOT NULL
);

-- cancel_reasons: Motivos de cancelación precargados.
CREATE TABLE cancel_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category cancel_reason_category NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- block_types: Tipos de bloqueo de agenda.
CREATE TABLE block_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- departments: 14 departamentos de El Salvador.
CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- municipalities: 262 municipios de El Salvador.
CREATE TABLE municipalities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT
);

-- Agregar FKs de clinics a departments/municipalities
ALTER TABLE clinics
  ADD CONSTRAINT fk_clinics_department FOREIGN KEY (department_id) REFERENCES departments(id),
  ADD CONSTRAINT fk_clinics_municipality FOREIGN KEY (municipality_id) REFERENCES municipalities(id);

-- ============================================================
-- 4. TABLAS DEL MÉDICO Y PERFIL PÚBLICO
-- ============================================================

-- doctors: Perfil público del médico para el directorio.
CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  specialty_id UUID REFERENCES specialties(id),
  license_number TEXT,
  experience_years INT,
  bio TEXT,
  consultation_fee DECIMAL(10,2),
  languages TEXT[] DEFAULT '{Español}',
  education JSONB DEFAULT '[]'::jsonb,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT false,
  lucy_status lucy_status NOT NULL DEFAULT 'listed_only',
  booking_enabled BOOLEAN NOT NULL DEFAULT false,
  tos_accepted_at TIMESTAMPTZ,
  tos_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- doctor_images: Galería de fotos del consultorio.
CREATE TABLE doctor_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. AGENDA, DISPONIBILIDAD Y CITAS
-- ============================================================

-- availability_rules: Disponibilidad semanal recurrente.
CREATE TABLE availability_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_min INT NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT chk_availability_times CHECK (start_time < end_time)
);

-- availability_overrides: Bloqueos y excepciones.
CREATE TABLE availability_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  time_start TIME,
  time_end TIME,
  is_blocked BOOLEAN NOT NULL DEFAULT true,
  block_type_id UUID REFERENCES block_types(id),
  description TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_override_dates CHECK (date_start <= date_end)
);

-- ============================================================
-- 6. PACIENTES
-- ============================================================

-- patients: Registro de pacientes por clínica.
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id),
  full_name TEXT NOT NULL,
  document_type document_type NOT NULL DEFAULT 'dui',
  document_number TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender gender_type NOT NULL,
  phone TEXT,
  patient_type patient_type NOT NULL DEFAULT 'privado',
  email TEXT,
  blood_type blood_type,
  allergies TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relation TEXT,
  photo_url TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, document_type, document_number)
);

-- ============================================================
-- 7. CATÁLOGOS CONFIGURABLES POR MÉDICO
-- ============================================================

-- services: Tipos de consulta/servicio por médico.
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  price DECIMAL(10,2),
  is_first_visit BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- diagnoses: Catálogo de diagnósticos propios del médico.
CREATE TABLE diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  usage_count INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- medications: Catálogo de medicamentos del médico.
CREATE TABLE medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  commercial_name TEXT NOT NULL,
  active_ingredient TEXT,
  concentration TEXT,
  presentation medication_presentation,
  usage_count INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- appointment_reasons: Motivos de consulta por médico.
CREATE TABLE appointment_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- ============================================================
-- 8. TABLA CENTRAL: APPOINTMENTS (CITAS)
-- ============================================================

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  service_id UUID REFERENCES services(id),
  status_id UUID NOT NULL REFERENCES appointment_statuses(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  source appointment_source NOT NULL DEFAULT 'manual',
  reason_id UUID REFERENCES appointment_reasons(id),
  cancel_reason_id UUID REFERENCES cancel_reasons(id),
  notes TEXT,
  internal_notes TEXT,
  price DECIMAL(10,2),
  payment_status payment_status NOT NULL DEFAULT 'pending',
  stripe_payment_id TEXT,
  consultation_started_at TIMESTAMPTZ,
  consultation_ended_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_appointment_times CHECK (start_time < end_time)
);

-- Índices para búsqueda rápida
CREATE INDEX idx_appointments_doctor_time ON appointments(doctor_id, start_time);
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_appointments_clinic ON appointments(clinic_id);
CREATE INDEX idx_appointments_status ON appointments(status_id);

-- ============================================================
-- 9. FICHA CLÍNICA Y CONSULTA
-- ============================================================

-- consultations: Consulta clínica SOAP con borrador/firma.
CREATE TABLE consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  appointment_id UUID REFERENCES appointments(id),
  status consultation_status NOT NULL DEFAULT 'draft',
  chief_complaint TEXT,
  history_present_illness TEXT,
  family_history_notes TEXT,
  physical_exam TEXT,
  internal_analysis TEXT,
  plan TEXT,
  started_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- vitals: Signos vitales vinculados a la cita (pre-consulta).
CREATE TABLE vitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  systolic_bp DECIMAL(5,1),
  diastolic_bp DECIMAL(5,1),
  heart_rate DECIMAL(5,1),
  respiratory_rate DECIMAL(5,1),
  temperature DECIMAL(4,1),
  spo2 DECIMAL(4,1),
  weight_lb DECIMAL(6,2),
  height_cm DECIMAL(5,1),
  bmi DECIMAL(4,1),
  recorded_by UUID REFERENCES profiles(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- consultation_diagnoses: N diagnósticos por consulta.
CREATE TABLE consultation_diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  diagnosis_id UUID NOT NULL REFERENCES diagnoses(id) ON DELETE RESTRICT,
  diagnosis_type diagnosis_type NOT NULL DEFAULT 'presuntivo',
  diagnosis_status diagnosis_status NOT NULL DEFAULT 'activo',
  notes TEXT
);

-- prescriptions: N medicamentos por consulta.
CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  medication_id UUID NOT NULL REFERENCES medications(id) ON DELETE RESTRICT,
  dosage TEXT,
  frequency TEXT,
  duration_value INT,
  duration_unit duration_unit,
  instructions TEXT,
  alternatives TEXT
);

-- ============================================================
-- 10. TABLAS DE SOPORTE
-- ============================================================

-- notifications: Cola de notificaciones SMS/WhatsApp/email.
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES clinics(id),
  recipient_id UUID NOT NULL REFERENCES profiles(id),
  appointment_id UUID REFERENCES appointments(id),
  channel notification_channel NOT NULL,
  type notification_type NOT NULL,
  content TEXT NOT NULL,
  recipient_phone TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status notification_status NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit_log: Registro inmutable de acceso a datos sensibles.
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  action audit_action NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- reviews: Reseñas de pacientes (Fase 2, tabla creada desde ahora).
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_profile_id UUID NOT NULL REFERENCES profiles(id),
  appointment_id UUID REFERENCES appointments(id),
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 11. ÍNDICES ADICIONALES
-- ============================================================
CREATE INDEX idx_doctors_specialty ON doctors(specialty_id);
CREATE INDEX idx_doctors_clinic ON doctors(clinic_id);
CREATE INDEX idx_doctors_lucy_status ON doctors(lucy_status);
CREATE INDEX idx_patients_clinic ON patients(clinic_id);
CREATE INDEX idx_consultations_patient ON consultations(patient_id);
CREATE INDEX idx_consultations_doctor ON consultations(doctor_id);
CREATE INDEX idx_consultations_appointment ON consultations(appointment_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_at);
CREATE INDEX idx_availability_rules_doctor ON availability_rules(doctor_id);
CREATE INDEX idx_availability_overrides_doctor_dates ON availability_overrides(doctor_id, date_start, date_end);

-- ============================================================
-- 12. FUNCIONES Y TRIGGERS
-- ============================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_clinics_updated_at
  BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_doctors_updated_at
  BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_patients_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_consultations_updated_at
  BEFORE UPDATE ON consultations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger para bloquear edición de consultas firmadas
CREATE OR REPLACE FUNCTION prevent_signed_consultation_edit()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede editar una consulta firmada. La consulta fue firmada el %', OLD.signed_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consultation_signed_lock
  BEFORE UPDATE ON consultations
  FOR EACH ROW EXECUTE FUNCTION prevent_signed_consultation_edit();

-- Trigger para audit_log en consultations
CREATE OR REPLACE FUNCTION audit_consultations()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    TG_OP::audit_action,
    'consultations',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_consultations
  AFTER INSERT OR UPDATE OR DELETE ON consultations
  FOR EACH ROW EXECUTE FUNCTION audit_consultations();

-- Trigger para audit_log en patients
CREATE OR REPLACE FUNCTION audit_patients()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    TG_OP::audit_action,
    'patients',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_patients
  AFTER INSERT OR UPDATE OR DELETE ON patients
  FOR EACH ROW EXECUTE FUNCTION audit_patients();

-- Trigger para audit_log en prescriptions
CREATE OR REPLACE FUNCTION audit_prescriptions()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    TG_OP::audit_action,
    'prescriptions',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_prescriptions
  AFTER INSERT OR UPDATE OR DELETE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION audit_prescriptions();

-- Función para crear profile automáticamente al registrar usuario
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, phone, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.phone,
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'patient')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 13. HABILITAR RLS EN TODAS LAS TABLAS
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialties ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancel_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE block_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
-- audit_log: NO tiene RLS — solo escritura por triggers

-- ============================================================
-- FIN DEL SCHEMA
-- ============================================================
-- Siguiente paso: ejecutar RLS policies (archivo separado)
-- Siguiente paso: ejecutar seed data (archivo separado)
-- ============================================================
