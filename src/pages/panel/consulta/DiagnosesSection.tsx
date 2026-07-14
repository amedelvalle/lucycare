import { useEffect, useRef, useState } from 'react';
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

  // Las notas del diagnóstico autoguardan en `onBlur` con `mutate()`. Si ese
  // guardado falla, el cambio se perdía en silencio. Ahora se avisa Y se bloquea
  // la firma hasta resolverlo (el gate vive en ConsultaPage). Salida: reintentar,
  // o volver a editar el campo.
  const saveFailed =
    updateAssignment.isError || addAssignment.isError || removeAssignment.isError;

  const retryFailedSave = () => {
    if (updateAssignment.isError && updateAssignment.variables)
      updateAssignment.mutate(updateAssignment.variables);
    else if (addAssignment.isError && addAssignment.variables)
      addAssignment.mutate(addAssignment.variables);
    else if (removeAssignment.isError && removeAssignment.variables)
      removeAssignment.mutate(removeAssignment.variables);
  };

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
      {saveFailed && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div className="min-w-0">
            <p className="text-xs text-red-700">
              No se pudo guardar el último cambio del diagnóstico. No vas a poder
              firmar hasta resolverlo: reintentá o corregí el campo y volvé a salir de él.
            </p>
            <button
              type="button"
              onClick={retryFailedSave}
              disabled={
                updateAssignment.isPending || addAssignment.isPending || removeAssignment.isPending
              }
              className="mt-1.5 text-xs font-medium text-red-700 underline hover:text-red-800 disabled:opacity-50"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

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
  const boundIdRef = useRef(cd.id);

  // Seed local SOLO cuando esta fila pasa a representar OTRO diagnóstico
  // (cd.id distinto). NO re-sincronizamos desde `cd` tras cada guardado: el
  // onBlur baja `notesDirty` a false y el refetch (invalidate→refetch, sin
  // optimistic) todavía no volvió, así que `cd.notes` sigue viejo — re-sembrar
  // ahí vaciaba la nota en pantalla aunque el guardado hubiera salido bien
  // (mismo race que se corrigió en receta, PR #269).
  // Como la fila va con key={cd.id} normalmente hay remount; el ref es defensa
  // por si React reusa la instancia. La fila es la única que edita su nota en
  // borrador, así que no necesita rehidratarse desde props.
  useEffect(() => {
    if (boundIdRef.current !== cd.id) {
      boundIdRef.current = cd.id;
      setNotes(cd.notes ?? '');
      setNotesDirty(false);
    }
    // Solo depende de cd.id: la nota se lee (fresca) al re-ligar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cd.id]);

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
