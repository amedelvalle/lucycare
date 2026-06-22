import { useEffect, useState } from 'react';
import {
  useDiagnosesSearch,
  useCreateDiagnosis,
  useConsultationDiagnoses,
  useAddConsultationDiagnosis,
  useUpdateConsultationDiagnosis,
  useRemoveConsultationDiagnosis,
} from '@/hooks/useConsultation';
import {
  type ConsultationDiagnosis,
} from '@/services/consultationDiagnoses.service';
import Combobox from '@/components/Combobox';

interface Props {
  consultationId: string;
  doctorId: string;
  readOnly: boolean;
}

export default function DiagnosesSection({ consultationId, doctorId, readOnly }: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: items = [], isFetching } = useDiagnosesSearch(doctorId, debouncedSearch);
  const { data: assigned = [] } = useConsultationDiagnoses(consultationId);

  const createDiagnosis = useCreateDiagnosis(doctorId);
  const addAssignment = useAddConsultationDiagnosis(consultationId);
  const updateAssignment = useUpdateConsultationDiagnosis(consultationId);
  const removeAssignment = useRemoveConsultationDiagnosis(consultationId);

  const isAlreadyAssigned = (diagnosisId: string) =>
    assigned.some((cd) => cd.diagnosis_id === diagnosisId);

  const handleSelect = async (item: { id: string }) => {
    if (isAlreadyAssigned(item.id)) {
      setSearch('');
      return;
    }
    await addAssignment.mutateAsync({ diagnosisId: item.id });
    setSearch('');
  };

  const handleCreate = async (name: string) => {
    const created = await createDiagnosis.mutateAsync({ name });
    if (!isAlreadyAssigned(created.id)) {
      await addAssignment.mutateAsync({ diagnosisId: created.id });
    }
    setSearch('');
  };

  return (
    <div className="space-y-3">
      {!readOnly && (
        <Combobox
          items={items.filter((it) => !isAlreadyAssigned(it.id))}
          searchValue={search}
          onSearch={setSearch}
          onSelect={handleSelect}
          onCreate={handleCreate}
          getKey={(it) => it.id}
          getLabel={(it) => it.name}
          getSubLabel={(it) =>
            it.usage_count > 0 ? `Usado ${it.usage_count} ${it.usage_count === 1 ? 'vez' : 'veces'}` : null
          }
          getBadge={(it) =>
            it.doctor_id === null ? { label: 'Base Lucy', tone: 'lucy' } : null
          }
          placeholder="Buscar diagnóstico... (ej: hipertensión arterial)"
          disabled={addAssignment.isPending || createDiagnosis.isPending}
          isLoading={isFetching}
          createLabel={(input) => `Crear nuevo diagnóstico propio: "${input}"`}
        />
      )}

      {assigned.length === 0 ? (
        <p className="text-xs text-gray-400 italic px-1">
          {readOnly ? 'Sin diagnósticos registrados' : 'Aún no hay diagnósticos asignados a esta consulta'}
        </p>
      ) : (
        <ul className="space-y-2">
          {assigned.map((cd) => (
            <DiagnosisRow
              key={cd.id}
              cd={cd}
              readOnly={readOnly}
              onUpdate={(updates) =>
                updateAssignment.mutate({ id: cd.id, ...updates })
              }
              onRemove={() => removeAssignment.mutate(cd.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DiagnosisRow({
  cd,
  readOnly,
  onUpdate,
  onRemove,
}: {
  cd: ConsultationDiagnosis;
  readOnly: boolean;
  onUpdate: (updates: { notes?: string | null }) => void;
  onRemove: () => void;
}) {
  const [notes, setNotes] = useState(cd.notes ?? '');
  const [notesDirty, setNotesDirty] = useState(false);

  // Re-sync si cambia el remoto y no estamos editando
  useEffect(() => {
    if (!notesDirty) setNotes(cd.notes ?? '');
  }, [cd.notes, notesDirty]);

  return (
    <li className="bg-gray-50 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 flex-1 min-w-0">
          {cd.diagnosis.name}
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            className="text-gray-400 hover:text-red-600 flex-shrink-0"
            aria-label="Remover diagnóstico"
            title="Remover"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <label className="block">
        <span className="block text-[11px] text-gray-500 mb-0.5">Notas (opcional)</span>
        <input
          type="text"
          value={notes}
          disabled={readOnly}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
          onBlur={() => {
            if (notesDirty) {
              onUpdate({ notes: notes || null });
              setNotesDirty(false);
            }
          }}
          placeholder="Observación específica de este diagnóstico..."
          className={inputCls}
        />
      </label>
    </li>
  );
}

const inputCls =
  'w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none ' +
  'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed';
