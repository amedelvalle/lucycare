import { useState, useEffect } from 'react';
import type { PatientDetail, PatientUpdateInput } from '@/services/patients.service';
import {
  validateDocument,
  sanitizeDuiInput,
  formatDuiDisplay,
} from '@/lib/document';

interface EditPatientModalProps {
  isOpen: boolean;
  patient: PatientDetail;
  isSubmitting: boolean;
  errorMessage?: string | null;
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
  errorMessage,
  onClose,
  onSubmit,
}: EditPatientModalProps) {
  const [form, setForm] = useState<PatientUpdateInput>({});
  const [docError, setDocError] = useState<string | null>(null);

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

  // Paciente vinculado a un perfil Lucy → identidad global read-only (la
  // gestiona el paciente; el guard server-side de s7_33 la protege). Solo los
  // campos clínicos/administrativos locales quedan editables.
  const isLinked = !!patient.profile_id;

  const update = <K extends keyof PatientUpdateInput>(key: K, value: PatientUpdateInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /** Cambia el tipo de documento. Si pasa a DUI, re-sanitiza el valor
   *  actual descartando letras y excedente para que la máscara aplique. */
  const handleTypeChange = (newType: PatientUpdateInput['document_type']) => {
    setDocError(null);
    if (newType === 'dui') {
      const digits = sanitizeDuiInput(form.document_number ?? '');
      setForm((prev) => ({
        ...prev,
        document_type: newType,
        document_number: formatDuiDisplay(digits) || null,
      }));
    } else {
      update('document_type', newType);
    }
  };

  /** Cambio del input de número de documento — aplica máscara DUI si corresponde. */
  const handleNumberChange = (raw: string) => {
    setDocError(null);
    if (form.document_type === 'dui') {
      const digits = sanitizeDuiInput(raw);
      update('document_number', formatDuiDisplay(digits) || null);
    } else {
      update('document_number', raw || null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLinked) {
      // La identidad es canónica del perfil del paciente → no se envía (el
      // guard server-side la bloquea igual). Solo campos locales.
      setDocError(null);
      const {
        full_name: _fn, phone: _ph, email: _em, document_type: _dt,
        document_number: _dn, date_of_birth: _dob, gender: _g, ...local
      } = form;
      void _fn; void _ph; void _em; void _dt; void _dn; void _dob; void _g;
      onSubmit(local);
      return;
    }
    if (!form.full_name?.trim()) return;
    // Validación local del documento antes de enviar — evita round-trip
    // al backend para errores triviales y muestra el mensaje al lado del campo.
    const docValidation = validateDocument(form.document_type, form.document_number);
    if (!docValidation.valid) {
      setDocError(docValidation.error ?? 'Documento inválido.');
      return;
    }
    setDocError(null);
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
          {/* Aviso de identidad gestionada por el paciente */}
          {isLinked && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 flex items-start gap-2">
              <svg className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="text-xs text-blue-800">Datos gestionados por el paciente en su perfil Lucy.</p>
            </div>
          )}

          {/* Datos básicos */}
          <Section title="Datos básicos">
            <Field label="Nombre completo" required>
              {isLinked ? (
                <ReadOnlyValue value={patient.full_name} />
              ) : (
                <input
                  type="text"
                  value={form.full_name ?? ''}
                  onChange={(e) => update('full_name', e.target.value)}
                  className={inputCls}
                  required
                />
              )}
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Teléfono">
                {isLinked ? (
                  <ReadOnlyValue value={patient.phone} />
                ) : (
                  <input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={(e) => update('phone', e.target.value || null)}
                    className={inputCls}
                    placeholder="+503 ..."
                  />
                )}
              </Field>
              <Field label="Email">
                {isLinked ? (
                  <ReadOnlyValue value={patient.email} />
                ) : (
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={(e) => update('email', e.target.value || null)}
                    className={inputCls}
                  />
                )}
              </Field>
            </div>
          </Section>

          {/* Identificación */}
          <Section title="Identificación">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Tipo de documento">
                {isLinked ? (
                  <ReadOnlyValue value={patient.document_number ? docTypeLabel(patient.document_type) : null} />
                ) : (
                  <select
                    value={form.document_type ?? 'dui'}
                    onChange={(e) => handleTypeChange(e.target.value as typeof form.document_type)}
                    className={inputCls}
                  >
                    {DOCUMENT_TYPES.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Número">
                {isLinked ? (
                  <ReadOnlyValue value={patient.document_number} />
                ) : (
                  <>
                    <input
                      type="text"
                      inputMode={form.document_type === 'dui' ? 'numeric' : 'text'}
                      maxLength={form.document_type === 'dui' ? 10 : 40}
                      value={form.document_number ?? ''}
                      onChange={(e) => handleNumberChange(e.target.value)}
                      className={inputCls}
                      placeholder={form.document_type === 'dui' ? '00000000-0' : 'Opcional'}
                    />
                    {form.document_type === 'dui' && (
                      <p className="text-[11px] text-gray-500 mt-1">9 dígitos, se formatea como 00000000-0.</p>
                    )}
                    {docError && (
                      <p className="text-[11px] text-red-600 mt-1">{docError}</p>
                    )}
                  </>
                )}
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Fecha de nacimiento">
                {isLinked ? (
                  <ReadOnlyValue value={patient.date_of_birth} />
                ) : (
                  <input
                    type="date"
                    value={form.date_of_birth ?? ''}
                    onChange={(e) => update('date_of_birth', e.target.value)}
                    className={inputCls}
                  />
                )}
              </Field>
              <Field label="Género">
                {isLinked ? (
                  <ReadOnlyValue value={genderLabel(patient.gender)} />
                ) : (
                  <select
                    value={form.gender ?? 'otro'}
                    onChange={(e) => update('gender', e.target.value as typeof form.gender)}
                    className={inputCls}
                  >
                    {GENDERS.map((g) => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                )}
              </Field>
              {/* Tipo (privado/asegurado) es LOCAL → siempre editable */}
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

        <div className="px-6 py-4 border-t border-gray-200 space-y-3">
          {errorMessage && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-700">{errorMessage}</p>
            </div>
          )}
          <div className="flex gap-3 justify-end">
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

/** Valor de identidad read-only (paciente vinculado). Vacío → mensaje claro. */
function ReadOnlyValue({ value }: { value?: string | null }) {
  const v = (value ?? '').toString().trim();
  return v ? (
    <p className="text-sm text-gray-800 py-1.5">{v}</p>
  ) : (
    <p className="text-sm text-gray-400 italic py-1.5">No cargado por el paciente</p>
  );
}

function docTypeLabel(type: string | null | undefined): string {
  return DOCUMENT_TYPES.find((d) => d.value === type)?.label ?? (type ?? '');
}
function genderLabel(g: string | null | undefined): string {
  return GENDERS.find((x) => x.value === g)?.label ?? (g ?? '');
}
