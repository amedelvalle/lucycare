import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreatePatient } from '@/hooks/usePatients';
import { DuplicatePhoneError } from '@/services/patients.service';
import { friendlyErrorMessage } from '@/lib/errors';

interface NewPatientModalProps {
  isOpen: boolean;
  clinicId: string;
  onClose: () => void;
  /** Llamado tras crear con éxito, con el id del paciente nuevo. */
  onCreated?: (patientId: string) => void;
}

/**
 * Modal de creación rápida de paciente desde /panel/pacientes.
 * Campos mínimos: nombre y teléfono (obligatorios), documento y fecha
 * de nacimiento opcionales. La dedup por teléfono la maneja
 * createBasicPatient (lanza DuplicatePhoneError si ya existe).
 */
export default function NewPatientModal({
  isOpen,
  clinicId,
  onClose,
  onCreated,
}: NewPatientModalProps) {
  const navigate = useNavigate();
  const createMutation = useCreatePatient();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dupExisting, setDupExisting] = useState<{ id: string; full_name: string } | null>(null);

  function reset() {
    setFullName('');
    setPhone('');
    setDocumentNumber('');
    setDateOfBirth('');
    setError(null);
    setDupExisting(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDupExisting(null);
    if (!fullName.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    if (!phone.trim()) {
      setError('El teléfono es obligatorio (se usa para evitar duplicados).');
      return;
    }
    createMutation.mutate(
      {
        clinicId,
        fullName,
        phone,
        documentNumber: documentNumber || null,
        dateOfBirth: dateOfBirth || undefined,
      },
      {
        onSuccess: (patient) => {
          reset();
          onClose();
          if (onCreated) onCreated(patient.id);
          else navigate(`/panel/pacientes/${patient.id}`);
        },
        onError: (err) => {
          if (err instanceof DuplicatePhoneError) {
            setDupExisting(err.existing);
            setError(null);
          } else {
            setDupExisting(null);
            setError(friendlyErrorMessage(err));
          }
        },
      }
    );
  }

  function clearMessages() {
    setError(null);
    setDupExisting(null);
  }

  if (!isOpen) return null;

  const isSubmitting = createMutation.isPending;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={isSubmitting ? () => {} : handleClose} />
      <form
        onSubmit={handleSubmit}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Nuevo paciente</h3>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            aria-label="Cerrar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            Para evitar duplicados, el teléfono es obligatorio. Otros datos
            (documento, fecha de nacimiento, género, etc.) se pueden completar
            después desde el perfil del paciente.
          </p>

          <Field label="Nombre completo" required>
            <input
              type="text"
              value={fullName}
              onChange={(e) => { clearMessages(); setFullName(e.target.value); }}
              className={inputCls}
              placeholder="Ej: María Pérez"
              required
              autoFocus
            />
          </Field>

          <Field label="Teléfono" required>
            <input
              type="tel"
              value={phone}
              onChange={(e) => { clearMessages(); setPhone(e.target.value); }}
              className={inputCls}
              placeholder="+503 ..."
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Documento" hint="opcional">
              <input
                type="text"
                value={documentNumber}
                onChange={(e) => { clearMessages(); setDocumentNumber(e.target.value); }}
                className={inputCls}
                placeholder="Sin documento"
              />
            </Field>
            <Field label="Fecha de nacimiento" hint="opcional">
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => { clearMessages(); setDateOfBirth(e.target.value); }}
                className={inputCls}
                max={new Date().toLocaleDateString('en-CA')}
              />
            </Field>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 space-y-3">
          {dupExisting && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 space-y-2">
              <p className="text-sm text-amber-900">
                Ya existe un paciente con este teléfono:{' '}
                <span className="font-medium">{dupExisting.full_name}</span>.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleClose();
                    navigate(`/panel/pacientes/${dupExisting.id}`);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg"
                >
                  Ver este paciente
                </button>
                <button
                  type="button"
                  onClick={() => setDupExisting(null)}
                  className="px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg"
                >
                  Cerrar aviso
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !fullName.trim() || !phone.trim()}
              className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
            >
              {isSubmitting ? 'Creando...' : 'Crear paciente'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="text-gray-400 font-normal ml-1.5">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}
