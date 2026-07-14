import { useEffect, useRef, useState } from 'react';
import {
  useFamilyHistorySearch,
  useCreateFamilyHistory,
  useConsultationFamilyHistory,
  useAddConsultationFamilyHistory,
  useUpdateConsultationFamilyHistory,
  useRemoveConsultationFamilyHistory,
} from '@/hooks/useConsultation';
import type { ConsultationFamilyHistory } from '@/services/consultationFamilyHistory.service';
import Combobox from '@/components/Combobox';

interface Props {
  consultationId: string;
  doctorId: string;
  readOnly: boolean;
}

export default function AntecedentesSection({ consultationId, doctorId, readOnly }: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: items = [], isFetching } = useFamilyHistorySearch(doctorId, debouncedSearch);
  const { data: assigned = [] } = useConsultationFamilyHistory(consultationId);

  const createFh = useCreateFamilyHistory(doctorId);
  const addFh = useAddConsultationFamilyHistory(consultationId);
  const updateFh = useUpdateConsultationFamilyHistory(consultationId);
  const removeFh = useRemoveConsultationFamilyHistory(consultationId);

  const isAlreadyAssigned = (id: string) => assigned.some((a) => a.family_history_id === id);

  const handleSelect = async (item: { id: string }) => {
    if (isAlreadyAssigned(item.id)) {
      setSearch('');
      return;
    }
    await addFh.mutateAsync({ familyHistoryId: item.id });
    setSearch('');
  };

  const handleCreate = async (name: string) => {
    const created = await createFh.mutateAsync({ name });
    if (!isAlreadyAssigned(created.id)) {
      await addFh.mutateAsync({ familyHistoryId: created.id });
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
          placeholder="Buscar antecedente... (ej: hipertensión, diabetes tipo 2)"
          disabled={addFh.isPending || createFh.isPending}
          isLoading={isFetching}
          createLabel={(input) => `Crear nuevo antecedente: "${input}"`}
        />
      )}

      {assigned.length === 0 ? (
        <p className="text-xs text-gray-400 italic px-1">
          {readOnly ? 'Sin antecedentes registrados' : 'Aún no hay antecedentes familiares asignados'}
        </p>
      ) : (
        <ul className="space-y-2">
          {assigned.map((cfh) => (
            <AntecedenteRow
              key={cfh.id}
              cfh={cfh}
              readOnly={readOnly}
              onUpdateNotes={(notes) => updateFh.mutate({ id: cfh.id, notes })}
              onRemove={() => removeFh.mutate(cfh.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AntecedenteRow({
  cfh,
  readOnly,
  onUpdateNotes,
  onRemove,
}: {
  cfh: ConsultationFamilyHistory;
  readOnly: boolean;
  onUpdateNotes: (notes: string | null) => void;
  onRemove: () => void;
}) {
  const [notes, setNotes] = useState(cfh.notes ?? '');
  const [dirty, setDirty] = useState(false);
  const boundIdRef = useRef(cfh.id);

  // Mismo patrón que receta (#269) y diagnósticos: sembrar el estado local SOLO
  // cuando la fila pasa a representar OTRO antecedente (cfh.id distinto). Si se
  // re-sincronizara desde `cfh` tras cada guardado, el onBlur baja `dirty` a
  // false mientras el refetch aún no volvió (`cfh.notes` viejo) y la nota se
  // vaciaba en pantalla pese a haberse guardado bien.
  // Nota: hoy ConsultaPage monta esta sección siempre con `readOnly` (los
  // antecedentes nuevos son texto libre desde el #171), así que este camino de
  // edición está inerte. El fix queda aplicado para que el race no reaparezca si
  // la edición estructurada se rehabilita.
  useEffect(() => {
    if (boundIdRef.current !== cfh.id) {
      boundIdRef.current = cfh.id;
      setNotes(cfh.notes ?? '');
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfh.id]);

  return (
    <li className="bg-gray-50 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 flex-1 min-w-0">
          {cfh.family_history.name}
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            className="text-gray-400 hover:text-red-600 flex-shrink-0"
            aria-label="Remover antecedente"
            title="Remover"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <textarea
        rows={2}
        value={notes}
        disabled={readOnly}
        onChange={(e) => {
          setNotes(e.target.value);
          setDirty(true);
        }}
        onBlur={() => {
          if (dirty) {
            onUpdateNotes(notes || null);
            setDirty(false);
          }
        }}
        placeholder="Detalles relevantes (parentesco, edad de aparición, complicaciones, etc.)"
        className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-800 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed resize-y"
      />
    </li>
  );
}
