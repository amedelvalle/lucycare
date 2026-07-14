import { useEffect, useRef, useState } from 'react';
import {
  useMedicationsSearch,
  useCreateMedication,
  usePrescriptions,
  usePermanentPrescriptions,
  useAddPrescription,
  useUpdatePrescription,
  useRemovePrescription,
} from '@/hooks/useConsultation';
import {
  DURATION_UNITS,
  type Prescription,
  type DurationUnit,
} from '@/services/prescriptions.service';
import {
  PRESENTATIONS,
  type MedicationPresentation,
} from '@/services/medicationsCatalog.service';
import Combobox from '@/components/Combobox';

interface Props {
  consultationId: string;
  doctorId: string;
  patientId: string;
  readOnly: boolean;
}

export default function PrescriptionsSection({
  consultationId,
  doctorId,
  patientId,
  readOnly,
}: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState<string | null>(null);
  const [showPermanentModal, setShowPermanentModal] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: items = [], isFetching } = useMedicationsSearch(doctorId, debouncedSearch);
  const { data: prescriptions = [] } = usePrescriptions(consultationId);

  const createMedication = useCreateMedication(doctorId);
  const addPrescription = useAddPrescription(consultationId);
  const updateRx = useUpdatePrescription(consultationId);
  const removeRx = useRemovePrescription(consultationId);

  const isAlreadyPrescribed = (medicationId: string) =>
    prescriptions.some((p) => p.medication_id === medicationId);

  // Los campos de la receta autoguardan en `onBlur` con `mutate()`. Si ese
  // guardado falla (red caída, consulta ya firmada) el médico no se enteraba:
  // el cambio se perdía en silencio. El aviso se limpia solo al reintentar,
  // porque la mutación vuelve a `pending`.
  const saveFailed =
    updateRx.isError || addPrescription.isError || removeRx.isError;

  const handleSelect = async (item: { id: string }) => {
    if (isAlreadyPrescribed(item.id)) {
      setSearch('');
      return;
    }
    await addPrescription.mutateAsync({ medication_id: item.id });
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
          <p className="text-xs text-red-700">
            No se pudo guardar el último cambio de la receta. Revisá tu conexión y
            volvé a editar el campo antes de firmar.
          </p>
        </div>
      )}

      {/* Botón cargar permanentes anteriores */}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPermanentModal(true)}
            disabled={addPrescription.isPending}
            className="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Cargar medicamentos permanentes anteriores
          </button>
        </div>
      )}

      {/* Búsqueda + crear inline */}
      {!readOnly && (
        <Combobox
          items={items.filter((it) => !isAlreadyPrescribed(it.id))}
          searchValue={search}
          onSearch={setSearch}
          onSelect={handleSelect}
          onCreate={(name) => setShowCreateModal(name)}
          getKey={(it) => it.id}
          getLabel={(it) => it.commercial_name}
          getSubLabel={(it) => {
            const parts = [
              it.active_ingredient,
              it.concentration,
              it.presentation,
            ].filter(Boolean);
            return parts.length > 0 ? parts.join(' · ') : null;
          }}
          getBadge={(it) =>
            it.doctor_id === null ? { label: 'Base Lucy', tone: 'lucy' } : null
          }
          placeholder="Buscar medicamento... (nombre comercial o principio activo)"
          disabled={addPrescription.isPending || createMedication.isPending}
          isLoading={isFetching}
          createLabel={(input) => `Crear nuevo medicamento propio: "${input}"`}
        />
      )}

      {/* Lista de prescripciones */}
      {prescriptions.length === 0 ? (
        <p className="text-xs text-gray-400 italic px-1">
          {readOnly ? 'Sin medicamentos prescritos' : 'Aún no hay medicamentos en la receta'}
        </p>
      ) : (
        <ul className="space-y-2">
          {prescriptions.map((p) => (
            <PrescriptionRow
              key={p.id}
              p={p}
              readOnly={readOnly}
              onUpdate={(updates) => updateRx.mutate({ id: p.id, ...updates })}
              onRemove={() => removeRx.mutate(p.id)}
            />
          ))}
        </ul>
      )}

      {/* Modal crear medicamento */}
      {showCreateModal && (
        <CreateMedicationModal
          initialName={showCreateModal}
          isSubmitting={createMedication.isPending || addPrescription.isPending}
          onClose={() => setShowCreateModal(null)}
          onSubmit={async (input) => {
            const created = await createMedication.mutateAsync(input);
            if (!isAlreadyPrescribed(created.id)) {
              await addPrescription.mutateAsync({ medication_id: created.id });
            }
            setShowCreateModal(null);
            setSearch('');
          }}
        />
      )}

      {/* Modal cargar permanentes */}
      {showPermanentModal && (
        <PermanentMedicationsModal
          patientId={patientId}
          doctorId={doctorId}
          excludeConsultationId={consultationId}
          alreadyPrescribedIds={new Set(prescriptions.map((p) => p.medication_id))}
          onClose={() => setShowPermanentModal(false)}
          onAdd={async (selected) => {
            for (const rx of selected) {
              if (isAlreadyPrescribed(rx.medication_id)) continue;
              await addPrescription.mutateAsync({
                medication_id: rx.medication_id,
                dosage: rx.dosage ?? undefined,
                frequency: rx.frequency ?? undefined,
                duration_value: rx.duration_value ?? undefined,
                duration_unit: rx.duration_unit ?? undefined,
                instructions: rx.instructions ?? undefined,
                alternatives: rx.alternatives ?? undefined,
              });
            }
            setShowPermanentModal(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-componente: prescription row ─────────────────────────────────

function PrescriptionRow({
  p,
  readOnly,
  onUpdate,
  onRemove,
}: {
  p: Prescription;
  readOnly: boolean;
  onUpdate: (updates: {
    dosage?: string;
    frequency?: string;
    duration_value?: number | null;
    duration_unit?: DurationUnit;
    instructions?: string;
    alternatives?: string;
  }) => void;
  onRemove: () => void;
}) {
  const [form, setForm] = useState({
    dosage: p.dosage ?? '',
    frequency: p.frequency ?? '',
    duration_value: p.duration_value?.toString() ?? '',
    duration_unit: (p.duration_unit ?? 'dias') as DurationUnit,
    instructions: p.instructions ?? '',
    alternatives: p.alternatives ?? '',
  });
  const [dirty, setDirty] = useState(false);
  const boundIdRef = useRef(p.id);

  // Seed local SOLO cuando esta fila pasa a representar OTRO medicamento
  // (p.id distinto). NO re-sincronizamos desde `p` tras cada guardado: el
  // refetch async (useUpdatePrescription invalida→refetch, sin optimistic)
  // trae `p` viejo justo cuando `dirty` cae a false, y re-sembrar ahí borraría
  // lo recién escrito (race que vaciaba dosis/frecuencia/duración/unidad).
  // Como la fila va con key={p.id} normalmente hay remount; el ref es defensa
  // por si React reusa la instancia. La fila es la única que edita sus campos
  // en borrador, así que no necesita rehidratarse desde props.
  useEffect(() => {
    if (boundIdRef.current !== p.id) {
      boundIdRef.current = p.id;
      setForm({
        dosage: p.dosage ?? '',
        frequency: p.frequency ?? '',
        duration_value: p.duration_value?.toString() ?? '',
        duration_unit: (p.duration_unit ?? 'dias') as DurationUnit,
        instructions: p.instructions ?? '',
        alternatives: p.alternatives ?? '',
      });
      setDirty(false);
    }
    // Solo depende de p.id: los otros campos se leen (frescos) al re-ligar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const flush = () => {
    if (!dirty) return;
    const dvNum = parseInt(form.duration_value, 10);
    onUpdate({
      dosage: form.dosage,
      frequency: form.frequency,
      // Campo vacío = el médico borró la duración → `null` explícito para que la
      // columna quede NULL. Con `undefined` la clave se perdía en el update y la
      // DB (y la receta impresa) conservaban la duración anterior.
      duration_value: isNaN(dvNum) ? null : dvNum,
      duration_unit: form.duration_unit,
      instructions: form.instructions,
      alternatives: form.alternatives,
    });
    setDirty(false);
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };

  const subParts = [
    p.medication.active_ingredient,
    p.medication.concentration,
    p.medication.presentation,
  ].filter(Boolean);

  return (
    <li className="bg-gray-50 rounded-lg p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{p.medication.commercial_name}</p>
          {subParts.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-0.5">{subParts.join(' · ')}</p>
          )}
        </div>
        {p.duration_unit === 'permanente' && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 flex-shrink-0">
            Permanente
          </span>
        )}
        {!readOnly && (
          <button
            type="button"
            onClick={onRemove}
            className="text-gray-400 hover:text-red-600 flex-shrink-0"
            aria-label="Remover medicamento"
            title="Remover"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-0.5">Dosis</span>
          <input
            type="text"
            value={form.dosage}
            disabled={readOnly}
            onChange={(e) => set('dosage', e.target.value)}
            onBlur={flush}
            placeholder="Ej: 1 tableta"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-0.5">Frecuencia</span>
          <input
            type="text"
            value={form.frequency}
            disabled={readOnly}
            onChange={(e) => set('frequency', e.target.value)}
            onBlur={flush}
            placeholder="Ej: cada 8 horas"
            className={inputCls}
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="block col-span-1">
          <span className="block text-[11px] text-gray-500 mb-0.5">Duración</span>
          <input
            type="number"
            min={1}
            value={form.duration_value}
            disabled={readOnly || form.duration_unit === 'permanente'}
            onChange={(e) => set('duration_value', e.target.value)}
            onBlur={flush}
            placeholder="—"
            className={inputCls}
          />
        </label>
        <label className="block col-span-2">
          <span className="block text-[11px] text-gray-500 mb-0.5">Unidad</span>
          <select
            value={form.duration_unit}
            disabled={readOnly}
            onChange={(e) => {
              const next = e.target.value as DurationUnit;
              setForm({
                ...form,
                duration_unit: next,
                duration_value: next === 'permanente' ? '' : form.duration_value,
              });
              setDirty(true);
            }}
            onBlur={flush}
            className={selectCls}
          >
            {DURATION_UNITS.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="block text-[11px] text-gray-500 mb-0.5">Indicaciones y notas</span>
        <textarea
          rows={2}
          value={form.instructions}
          disabled={readOnly}
          onChange={(e) => set('instructions', e.target.value)}
          onBlur={flush}
          placeholder="Cómo tomarse el medicamento, con/sin comida, etc."
          className={`${inputCls} resize-y`}
        />
      </label>

      <label className="block">
        <span className="block text-[11px] text-gray-500 mb-0.5">Opciones alternativas (opcional)</span>
        <input
          type="text"
          value={form.alternatives}
          disabled={readOnly}
          onChange={(e) => set('alternatives', e.target.value)}
          onBlur={flush}
          placeholder="Medicamentos sustitutos si no encuentra el principal"
          className={inputCls}
        />
      </label>
    </li>
  );
}

// ─── Modal: crear medicamento ─────────────────────────────────────────

function CreateMedicationModal({
  initialName,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  initialName: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: {
    commercial_name: string;
    active_ingredient?: string;
    concentration?: string;
    presentation?: MedicationPresentation;
  }) => void;
}) {
  const [form, setForm] = useState({
    commercial_name: initialName,
    active_ingredient: '',
    concentration: '',
    presentation: '' as MedicationPresentation | '',
  });

  const handle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.commercial_name.trim()) return;
    onSubmit({
      commercial_name: form.commercial_name,
      active_ingredient: form.active_ingredient || undefined,
      concentration: form.concentration || undefined,
      presentation: form.presentation || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handle}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
      >
        <h3 className="text-base font-semibold text-gray-900">Nuevo medicamento</h3>
        <p className="text-xs text-gray-500">
          Quedará en tu catálogo y se asignará a esta consulta.
        </p>

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Nombre comercial *</span>
          <input
            type="text"
            value={form.commercial_name}
            onChange={(e) => setForm({ ...form, commercial_name: e.target.value })}
            className={inputCls}
            required
            autoFocus
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Principio activo (opcional)</span>
          <input
            type="text"
            value={form.active_ingredient}
            onChange={(e) => setForm({ ...form, active_ingredient: e.target.value })}
            className={inputCls}
            placeholder="Ej: paracetamol"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Concentración</span>
            <input
              type="text"
              value={form.concentration}
              onChange={(e) => setForm({ ...form, concentration: e.target.value })}
              className={inputCls}
              placeholder="Ej: 500mg"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Presentación</span>
            <select
              value={form.presentation}
              onChange={(e) => setForm({ ...form, presentation: e.target.value as MedicationPresentation | '' })}
              className={selectCls}
            >
              <option value="">—</option>
              {PRESENTATIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !form.commercial_name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
          >
            {isSubmitting ? 'Guardando...' : 'Crear y agregar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal: cargar permanentes ────────────────────────────────────────

function PermanentMedicationsModal({
  patientId,
  doctorId,
  excludeConsultationId,
  alreadyPrescribedIds,
  onClose,
  onAdd,
}: {
  patientId: string;
  doctorId: string;
  excludeConsultationId: string;
  alreadyPrescribedIds: Set<string>;
  onClose: () => void;
  onAdd: (selected: Prescription[]) => void;
}) {
  const { data: candidates = [], isLoading } = usePermanentPrescriptions(
    patientId,
    doctorId,
    excludeConsultationId
  );

  const available = candidates.filter((p) => !alreadyPrescribedIds.has(p.medication_id));

  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Por defecto, todos seleccionados al abrir
  useEffect(() => {
    if (!isLoading && available.length > 0 && selected.size === 0) {
      setSelected(new Set(available.map((p) => p.medication_id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, available.length]);

  const toggle = (medId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(medId)) next.delete(medId);
      else next.add(medId);
      return next;
    });
  };

  const chosen = available.filter((p) => selected.has(p.medication_id));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Medicamentos permanentes anteriores</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            De consultas firmadas anteriores con este paciente.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading ? (
            <p className="text-sm text-gray-400 text-center py-6">Buscando...</p>
          ) : available.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              {candidates.length === 0
                ? 'Este paciente no tiene medicamentos permanentes registrados.'
                : 'Todos los medicamentos permanentes ya están en la receta actual.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {available.map((p) => {
                const isChecked = selected.has(p.medication_id);
                const subParts = [
                  p.medication.active_ingredient,
                  p.medication.concentration,
                  p.medication.presentation,
                ].filter(Boolean);
                const dosageParts = [p.dosage, p.frequency].filter(Boolean);
                return (
                  <li key={p.id}>
                    <label
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                        isChecked ? 'bg-emerald-50/40 border-emerald-200' : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(p.medication_id)}
                        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-200"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {p.medication.commercial_name}
                        </p>
                        {subParts.length > 0 && (
                          <p className="text-[11px] text-gray-500 mt-0.5">{subParts.join(' · ')}</p>
                        )}
                        {dosageParts.length > 0 && (
                          <p className="text-xs text-gray-700 mt-1">{dosageParts.join(' · ')}</p>
                        )}
                        {p.instructions && (
                          <p className="text-xs text-gray-500 mt-0.5 italic">{p.instructions}</p>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onAdd(chosen)}
            disabled={chosen.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
          >
            Agregar {chosen.length > 0 ? `(${chosen.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────

const inputCls =
  'w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none ' +
  'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed';

const selectCls = inputCls + ' cursor-pointer';
