import { useState, useEffect } from 'react';
import type { PatientDetail, PatientUpdateInput } from '@/services/patients.service';

interface EditPatientModalProps {
  isOpen: boolean;
  patient: PatientDetail;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (updates: PatientUpdateInput) => void;
}

const DOCUMENT_TYPES: Array<{ value: 'dui' | 'partida_nacimiento' | 'pasaporte' | 'carnet_residente'; label: string }> = [
  { value: 'dui', label: 'DUI' },
  { value: 'partida_nacimiento', label: 'Partida de nacimiento' },
  { value: 'pasaporte', label: 'Pasaporte' },
  { value: 'carnet_residente', label: 'Carnet de residente' },
];

const GENDERS: Array<{ value: 'masculino' | 'femenino' | 'otro'; label: string }> = [
  { value: 'masculino', label: 'Masculino' },
  { value: 'femenino', label: 'Femenino' },
  { value: 'otro', label: 'Otro' },
];

const PATIENT_TYPES: Array<{ value: 'privado' | 'asegurado'; label: string }> = [
  { value: 'privado', label: 'Privado' },
  { value: 'asegurado', label: 'Asegurado' },
];

const BLOOD_TYPES: Array<'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'desconocido'> = [
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'desconocido',
];

export default function EditPatientModal({
  isOpen,
  patient,
  isSubmitting,
  onClose,
  onSubmit,
}: EditPatientModalProps) {
  const [form, setForm] = useState<PatientUpdateInput>({});

  // Reset cuando se abre el modal o cambia el paciente
  useEffect(() => {
    if (isOpen) {
      setForm({
        full_name: patient.full_name,
        phone: patient.phone,
        email: patient.email,
        document_type: patient.document_type,
        document_number: patient.document_number,
        date_of_birth: patient.date_of_birth,
        gender: patient.gender,
        patient_type: patient.patient_type,
        blood_type: patient.blood_type,
        allergies: patient.allergies,
        notes: patient.notes,
        emergency_contact_name: patient.emergency_contact_name,
        emergency_contact_phone: patient.emergency_contact_phone,
        emergency_contact_relation: patient.emergency_contact_relation,
      });
    }
  }, [isOpen, patient]);

  if (!isOpen) return null;

  const update = <K extends keyof PatientUpdateInput>(key: K, value: PatientUpdateInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name?.trim()) return;
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <form
        onSubmit={handleSubmit}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Editar paciente</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Datos básicos */}
          <Section title="Datos básicos">
            <Field label="Nombre completo" required>
              <input
                type="text"
                value={form.full_name ?? ''}
                onChange={(e) => update('full_name', e.target.value)}
                className={inputCls}
                required
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Teléfono">
                <input
                  type="tel"
                  value={form.phone ?? ''}
                  onChange={(e) => update('phone', e.target.value || null)}
                  className={inputCls}
                  placeholder="+503 ..."
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={form.email ?? ''}
                  onChange={(e) => update('email', e.target.value || null)}
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>

          {/* Identificación */}
          <Section title="Identificación">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Tipo de documento">
                <select
                  value={form.document_type ?? 'dui'}
                  onChange={(e) => update('document_type', e.target.value as typeof form.document_type)}
                  className={inputCls}
                >
                  {DOCUMENT_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Número">
                <input
                  type="text"
                  value={form.document_number ?? ''}
                  onChange={(e) => update('document_number', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Fecha de nacimiento">
                <input
                  type="date"
                  value={form.date_of_birth ?? ''}
                  onChange={(e) => update('date_of_birth', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Género">
                <select
                  value={form.gender ?? 'otro'}
                  onChange={(e) => update('gender', e.target.value as typeof form.gender)}
                  className={inputCls}
                >
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo">
                <select
                  value={form.patient_type ?? 'privado'}
                  onChange={(e) => update('patient_type', e.target.value as typeof form.patient_type)}
                  className={inputCls}
                >
                  {PATIENT_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          {/* Datos médicos básicos */}
          <Section title="Datos médicos">
            <Field label="Tipo de sangre">
              <select
                value={form.blood_type ?? ''}
                onChange={(e) => update('blood_type', (e.target.value || null) as typeof form.blood_type)}
                className={inputCls}
              >
                <option value="">No especificado</option>
                {BLOOD_TYPES.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </Field>
            <Field label="Alergias">
              <textarea
                rows={2}
                value={form.allergies ?? ''}
                onChange={(e) => update('allergies', e.target.value || null)}
                className={inputCls}
                placeholder="Ej: penicilina, mariscos..."
              />
            </Field>
          </Section>

          {/* Contacto de emergencia */}
          <Section title="Contacto de emergencia">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nombre">
                <input
                  type="text"
                  value={form.emergency_contact_name ?? ''}
                  onChange={(e) => update('emergency_contact_name', e.target.value || null)}
                  className={inputCls}
                />
              </Field>
              <Field label="Teléfono">
                <input
                  type="tel"
                  value={form.emergency_contact_phone ?? ''}
                  onChange={(e) => update('emergency_contact_phone', e.target.value || null)}
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Relación">
              <input
                type="text"
                value={form.emergency_contact_relation ?? ''}
                onChange={(e) => update('emergency_contact_relation', e.target.value || null)}
                className={inputCls}
                placeholder="Ej: madre, hermano, esposa..."
              />
            </Field>
          </Section>

          {/* Notas */}
          <Section title="Notas privadas">
            <textarea
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) => update('notes', e.target.value || null)}
              className={inputCls}
              placeholder="Anotaciones internas sobre el paciente..."
            />
          </Section>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !form.full_name?.trim()}
            className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
          >
            {isSubmitting ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
