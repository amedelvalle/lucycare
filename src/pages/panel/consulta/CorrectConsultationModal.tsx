import { useEffect, useMemo, useState } from 'react';
import { useAmendConsultation, useMedicationsSearch, useCreateMedication } from '@/hooks/useConsultation';
import type {
  ConsultationTextField,
  ConsultationTextChanges,
  PrescriptionOp,
} from '@/services/consultations.service';
import {
  DURATION_UNITS,
  type Prescription,
  type DurationUnit,
} from '@/services/prescriptions.service';
import Combobox from '@/components/Combobox';

/**
 * Modal de corrección de una consulta FIRMADA (B2 — texto + receta).
 * Un solo motivo obligatorio + una sola llamada atómica a amend_consultation:
 *  - texto clínico (chief_complaint, history_present_illness, physical_exam,
 *    internal_analysis, plan) → p_consultation_changes.
 *  - receta (sustituir/agregar/retirar medicamento, dosis, frecuencia,
 *    duración, indicaciones) → p_prescription_ops (replace/add/remove).
 * affects_prescriptions lo deriva la RPC (s7_30): solo true si hubo ops de
 * receta → impresión "RECETA CORREGIDA" solo en ese caso.
 * Patrón de modal sensible: NO cierra al click-outside; X/Escape/éxito.
 * Confirmación reforzada cuando hay cambios de receta.
 */

const TEXT_FIELDS: { key: ConsultationTextField; label: string; rows: number }[] = [
  { key: 'chief_complaint', label: 'Motivo principal de consulta', rows: 2 },
  { key: 'history_present_illness', label: 'Historia de la enfermedad actual', rows: 4 },
  { key: 'physical_exam', label: 'Exploración física', rows: 3 },
  { key: 'internal_analysis', label: 'Análisis interno', rows: 2 },
  { key: 'plan', label: 'Plan', rows: 5 },
];

type TextValues = Record<ConsultationTextField, string>;

interface RxFields {
  dosage: string;
  frequency: string;
  durationValue: string;
  durationUnit: DurationUnit;
  instructions: string;
}

interface ExistingRx extends RxFields {
  prescriptionId: string;
  medicationId: string;
  medicationLabel: string;
  removed: boolean;
  orig: RxFields & { medicationId: string };
}

interface NewRx extends RxFields {
  tempId: string;
  medicationId: string;
  medicationLabel: string;
}

interface Props {
  consultationId: string;
  appointmentId: string;
  doctorId: string;
  initialText: TextValues;
  initialPrescriptions: Prescription[];
  onClose: () => void;
}

const inputCls =
  'w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';
const textareaCls = inputCls + ' resize-y';
const selectCls = inputCls + ' cursor-pointer';

const norm = (s: string | null | undefined) => (s ?? '').trim();

function rxFieldsFrom(p: Prescription): RxFields {
  return {
    dosage: p.dosage ?? '',
    frequency: p.frequency ?? '',
    durationValue: p.duration_value?.toString() ?? '',
    durationUnit: (p.duration_unit ?? 'dias') as DurationUnit,
    instructions: p.instructions ?? '',
  };
}

export default function CorrectConsultationModal({
  consultationId,
  appointmentId,
  doctorId,
  initialText,
  initialPrescriptions,
  onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const [text, setText] = useState<TextValues>(initialText);
  const [existing, setExisting] = useState<ExistingRx[]>(() =>
    initialPrescriptions.map((p) => {
      const f = rxFieldsFrom(p);
      return {
        prescriptionId: p.id,
        medicationId: p.medication_id,
        medicationLabel: p.medication.commercial_name,
        removed: false,
        ...f,
        orig: { ...f, medicationId: p.medication_id },
      };
    })
  );
  const [added, setAdded] = useState<NewRx[]>([]);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [substituteFor, setSubstituteFor] = useState<string | null>(null); // prescriptionId
  const [confirmReceta, setConfirmReceta] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const amend = useAmendConsultation(consultationId, appointmentId);
  const isSubmitting = amend.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isSubmitting) return;
      if (confirmReceta) setConfirmReceta(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSubmitting, confirmReceta, onClose]);

  // ─── Diff de texto ───
  const textChanges = useMemo<ConsultationTextChanges>(() => {
    const out: ConsultationTextChanges = {};
    for (const { key } of TEXT_FIELDS) {
      if (text[key].trim() !== initialText[key].trim()) {
        out[key] = text[key].trim() === '' ? null : text[key];
      }
    }
    return out;
  }, [text, initialText]);

  // ─── Diff de receta → prescription_ops ───
  const prescriptionOps = useMemo<PrescriptionOp[]>(() => {
    const ops: PrescriptionOp[] = [];
    for (const r of existing) {
      if (r.removed) {
        ops.push({ op: 'remove', prescription_id: r.prescriptionId });
        continue;
      }
      const changed =
        r.medicationId !== r.orig.medicationId ||
        norm(r.dosage) !== norm(r.orig.dosage) ||
        norm(r.frequency) !== norm(r.orig.frequency) ||
        norm(r.durationValue) !== norm(r.orig.durationValue) ||
        r.durationUnit !== r.orig.durationUnit ||
        norm(r.instructions) !== norm(r.orig.instructions);
      if (!changed) continue;
      const dv = parseInt(r.durationValue, 10);
      ops.push({
        op: 'replace',
        prescription_id: r.prescriptionId,
        ...(r.medicationId !== r.orig.medicationId ? { medication_id: r.medicationId } : {}),
        dosage: r.dosage.trim(),
        frequency: r.frequency.trim(),
        instructions: r.instructions.trim(),
        duration_unit: r.durationUnit,
        ...(r.durationUnit !== 'permanente' && !isNaN(dv) ? { duration_value: dv } : {}),
      });
    }
    for (const n of added) {
      const dv = parseInt(n.durationValue, 10);
      ops.push({
        op: 'add',
        medication_id: n.medicationId,
        dosage: n.dosage.trim() || null,
        frequency: n.frequency.trim() || null,
        instructions: n.instructions.trim() || null,
        duration_unit: n.durationUnit,
        ...(n.durationUnit !== 'permanente' && !isNaN(dv) ? { duration_value: dv } : {}),
      });
    }
    return ops;
  }, [existing, added]);

  const hasTextChanges = Object.keys(textChanges).length > 0;
  const hasRecetaChanges = prescriptionOps.length > 0;
  const hasChanges = hasTextChanges || hasRecetaChanges;
  const reasonOk = reason.trim().length > 0;

  // Ids ya en la receta (para no duplicar al agregar)
  const usedMedIds = useMemo(
    () =>
      new Set<string>([
        ...existing.filter((r) => !r.removed).map((r) => r.medicationId),
        ...added.map((n) => n.medicationId),
      ]),
    [existing, added]
  );

  // ─── Acciones de receta ───
  const setExistingField = (id: string, patch: Partial<ExistingRx>) =>
    setExisting((prev) => prev.map((r) => (r.prescriptionId === id ? { ...r, ...patch } : r)));
  const setAddedField = (id: string, patch: Partial<NewRx>) =>
    setAdded((prev) => prev.map((n) => (n.tempId === id ? { ...n, ...patch } : n)));

  const handlePickMedication = (med: { id: string; label: string }) => {
    if (substituteFor) {
      setExistingField(substituteFor, { medicationId: med.id, medicationLabel: med.label });
      setSubstituteFor(null);
    } else {
      setAdded((prev) => [
        ...prev,
        {
          tempId: `new-${Date.now()}-${prev.length}`,
          medicationId: med.id,
          medicationLabel: med.label,
          dosage: '',
          frequency: '',
          durationValue: '',
          durationUnit: 'dias',
          instructions: '',
        },
      ]);
      setShowAddPicker(false);
    }
  };

  // ─── Submit ───
  const doSubmit = async () => {
    setErrorMsg(null);
    try {
      await amend.mutateAsync({ reason: reason.trim(), changes: textChanges, prescriptionOps });
      onClose();
    } catch (err) {
      setConfirmReceta(false);
      setErrorMsg(friendlyAmendError(err));
    }
  };

  const handleConfirmClick = () => {
    if (!reasonOk || !hasChanges || isSubmitting) return;
    if (hasRecetaChanges) setConfirmReceta(true); // confirmación reforzada
    else doSubmit();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Overlay SIN onClick: no cerrar al click-outside (form sensible) */}
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Corregir consulta firmada</h3>
            <p className="text-sm text-gray-600 mt-1">
              Podés corregir el <span className="font-semibold">texto clínico</span> y la{' '}
              <span className="font-semibold">receta</span>. Los cambios quedan registrados como una
              corrección visible y auditada; la versión anterior se conserva.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Motivo obligatorio */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Motivo de la corrección <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={2}
            value={reason}
            disabled={isSubmitting}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: medicamento no disponible, se sustituye por equivalente…"
            className={textareaCls}
            autoFocus
          />
          {!reasonOk && <p className="text-xs text-amber-600 mt-1">El motivo es obligatorio.</p>}
        </div>

        {/* ─── Sección: Texto clínico ─── */}
        <h4 className="text-sm font-semibold text-gray-900 mb-2">Texto clínico</h4>
        <div className="space-y-3 mb-6">
          {TEXT_FIELDS.map(({ key, label, rows }) => {
            const changed = text[key].trim() !== initialText[key].trim();
            return (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {label}
                  {changed && (
                    <span className="ml-2 text-[11px] font-semibold text-amber-600 uppercase">· modificado</span>
                  )}
                </label>
                <textarea
                  rows={rows}
                  value={text[key]}
                  disabled={isSubmitting}
                  onChange={(e) => setText({ ...text, [key]: e.target.value })}
                  className={textareaCls}
                />
              </div>
            );
          })}
        </div>

        {/* ─── Sección: Receta / Medicamentos ─── */}
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-900">Receta / Medicamentos</h4>
          {hasRecetaChanges && (
            <span className="text-[11px] font-semibold text-emerald-700 uppercase">· receta modificada</span>
          )}
        </div>
        <div className="space-y-2 mb-3">
          {existing.length === 0 && added.length === 0 && (
            <p className="text-xs text-gray-400 italic">Esta consulta no tiene medicamentos.</p>
          )}

          {existing.map((r) => (
            <ExistingRxCard
              key={r.prescriptionId}
              rx={r}
              disabled={isSubmitting}
              onField={(patch) => setExistingField(r.prescriptionId, patch)}
              onToggleRemove={() => setExistingField(r.prescriptionId, { removed: !r.removed })}
              onSubstitute={() => setSubstituteFor(r.prescriptionId)}
            />
          ))}

          {added.map((n) => (
            <NewRxCard
              key={n.tempId}
              rx={n}
              disabled={isSubmitting}
              onField={(patch) => setAddedField(n.tempId, patch)}
              onDrop={() => setAdded((prev) => prev.filter((x) => x.tempId !== n.tempId))}
            />
          ))}
        </div>

        {/* Agregar medicamento */}
        {!showAddPicker ? (
          <button
            type="button"
            onClick={() => setShowAddPicker(true)}
            disabled={isSubmitting}
            className="text-sm font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Agregar medicamento
          </button>
        ) : (
          <div className="bg-gray-50 rounded-lg p-3">
            <MedicationPicker
              doctorId={doctorId}
              excludeIds={usedMedIds}
              onPick={handlePickMedication}
            />
            <button
              type="button"
              onClick={() => setShowAddPicker(false)}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancelar
            </button>
          </div>
        )}

        {/* Picker de sustitución (overlay simple) */}
        {substituteFor && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/30" onClick={() => setSubstituteFor(null)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Sustituir medicamento</h4>
              <MedicationPicker doctorId={doctorId} excludeIds={usedMedIds} onPick={handlePickMedication} />
              <div className="flex justify-end mt-3">
                <button
                  type="button"
                  onClick={() => setSubstituteFor(null)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mt-4">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs text-red-700">{errorMsg}</p>
          </div>
        )}

        {/* Aviso visible cuando no hay cambios */}
        {reasonOk && !hasChanges && (
          <p className="text-xs text-amber-600 mt-4">
            No hay cambios para guardar. Modificá texto o receta para poder corregir.
          </p>
        )}

        {/* Acciones */}
        <div className="flex gap-3 justify-end pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmClick}
            disabled={!reasonOk || !hasChanges || isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
          >
            {isSubmitting ? 'Guardando…' : 'Confirmar corrección'}
          </button>
        </div>
      </div>

      {/* ─── Confirmación reforzada para cambios de receta ─── */}
      {confirmReceta && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Confirmar corrección de receta</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Vas a modificar la receta. Se generará una versión nueva y la receta impresa quedará
                  marcada como <span className="font-semibold">corregida</span>. La versión anterior se conserva.
                </p>
              </div>
            </div>

            <ul className="text-xs text-gray-700 bg-gray-50 rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
              {recetaSummary(existing, added).map((line, i) => (
                <li key={i}>• {line}</li>
              ))}
            </ul>

            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={() => setConfirmReceta(false)}
                disabled={isSubmitting}
                className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={doSubmit}
                disabled={isSubmitting}
                className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
              >
                {isSubmitting ? 'Guardando…' : 'Sí, corregir receta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function RxFieldsEditor({
  rx,
  disabled,
  onField,
}: {
  rx: RxFields;
  disabled: boolean;
  onField: (patch: Partial<RxFields>) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-0.5">Dosis</span>
          <input type="text" value={rx.dosage} disabled={disabled}
            onChange={(e) => onField({ dosage: e.target.value })} placeholder="Ej: 1 tableta" className={inputCls} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-gray-500 mb-0.5">Frecuencia</span>
          <input type="text" value={rx.frequency} disabled={disabled}
            onChange={(e) => onField({ frequency: e.target.value })} placeholder="Ej: cada 8 horas" className={inputCls} />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block col-span-1">
          <span className="block text-[11px] text-gray-500 mb-0.5">Duración</span>
          <input type="number" min={1} value={rx.durationValue}
            disabled={disabled || rx.durationUnit === 'permanente'}
            onChange={(e) => onField({ durationValue: e.target.value })} placeholder="—" className={inputCls} />
        </label>
        <label className="block col-span-2">
          <span className="block text-[11px] text-gray-500 mb-0.5">Unidad</span>
          <select value={rx.durationUnit} disabled={disabled}
            onChange={(e) => {
              const next = e.target.value as DurationUnit;
              onField({ durationUnit: next, ...(next === 'permanente' ? { durationValue: '' } : {}) });
            }}
            className={selectCls}>
            {DURATION_UNITS.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="block text-[11px] text-gray-500 mb-0.5">Indicaciones y notas</span>
        <textarea rows={2} value={rx.instructions} disabled={disabled}
          onChange={(e) => onField({ instructions: e.target.value })}
          placeholder="Cómo tomarse el medicamento, con/sin comida, etc." className={textareaCls} />
      </label>
    </>
  );
}

function ExistingRxCard({
  rx,
  disabled,
  onField,
  onToggleRemove,
  onSubstitute,
}: {
  rx: ExistingRx;
  disabled: boolean;
  onField: (patch: Partial<ExistingRx>) => void;
  onToggleRemove: () => void;
  onSubstitute: () => void;
}) {
  const swapped = rx.medicationId !== rx.orig.medicationId;
  return (
    <div className={`rounded-lg p-3 space-y-2.5 border ${rx.removed ? 'bg-red-50/50 border-red-200' : 'bg-gray-50 border-transparent'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${rx.removed ? 'text-red-700 line-through' : 'text-gray-900'}`}>
            {rx.medicationLabel}
          </p>
          {swapped && !rx.removed && (
            <span className="text-[11px] font-semibold text-emerald-700 uppercase">· sustituido</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!rx.removed && (
            <button type="button" onClick={onSubstitute} disabled={disabled}
              className="text-xs text-emerald-700 hover:text-emerald-800 disabled:opacity-50">
              Sustituir
            </button>
          )}
          <button type="button" onClick={onToggleRemove} disabled={disabled}
            className={`text-xs disabled:opacity-50 ${rx.removed ? 'text-gray-600 hover:text-gray-800' : 'text-red-600 hover:text-red-700'}`}>
            {rx.removed ? 'Deshacer' : 'Quitar'}
          </button>
        </div>
      </div>
      {!rx.removed && <RxFieldsEditor rx={rx} disabled={disabled} onField={onField} />}
    </div>
  );
}

function NewRxCard({
  rx,
  disabled,
  onField,
  onDrop,
}: {
  rx: NewRx;
  disabled: boolean;
  onField: (patch: Partial<NewRx>) => void;
  onDrop: () => void;
}) {
  return (
    <div className="rounded-lg p-3 space-y-2.5 border border-emerald-200 bg-emerald-50/40">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900">
          {rx.medicationLabel}
          <span className="ml-2 text-[11px] font-semibold text-emerald-700 uppercase">· nuevo</span>
        </p>
        <button type="button" onClick={onDrop} disabled={disabled}
          className="text-xs text-red-600 hover:text-red-700 flex-shrink-0 disabled:opacity-50">
          Quitar
        </button>
      </div>
      <RxFieldsEditor rx={rx} disabled={disabled} onField={onField} />
    </div>
  );
}

function MedicationPicker({
  doctorId,
  excludeIds,
  onPick,
}: {
  doctorId: string;
  excludeIds: Set<string>;
  onPick: (med: { id: string; label: string }) => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: items = [], isFetching } = useMedicationsSearch(doctorId, debounced);
  const createMed = useCreateMedication(doctorId);

  const sub = (it: { active_ingredient: string | null; concentration: string | null; presentation: string | null }) =>
    [it.active_ingredient, it.concentration, it.presentation].filter(Boolean).join(' · ');

  return (
    <Combobox
      items={items.filter((it) => !excludeIds.has(it.id))}
      searchValue={search}
      onSearch={setSearch}
      onSelect={(it) => onPick({ id: it.id, label: it.commercial_name })}
      onCreate={async (name) => {
        const created = await createMed.mutateAsync({ commercial_name: name });
        onPick({ id: created.id, label: created.commercial_name });
      }}
      getKey={(it) => it.id}
      getLabel={(it) => it.commercial_name}
      getSubLabel={(it) => sub(it) || null}
      placeholder="Buscar medicamento… (nombre comercial o principio activo)"
      disabled={createMed.isPending}
      isLoading={isFetching}
      createLabel={(input) => `Crear nuevo medicamento: "${input}"`}
    />
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function recetaSummary(existing: ExistingRx[], added: NewRx[]): string[] {
  const lines: string[] = [];
  for (const r of existing) {
    if (r.removed) {
      lines.push(`Quitar: ${r.medicationLabel}`);
      continue;
    }
    const swapped = r.medicationId !== r.orig.medicationId;
    const fieldChanged =
      norm(r.dosage) !== norm(r.orig.dosage) ||
      norm(r.frequency) !== norm(r.orig.frequency) ||
      norm(r.durationValue) !== norm(r.orig.durationValue) ||
      r.durationUnit !== r.orig.durationUnit ||
      norm(r.instructions) !== norm(r.orig.instructions);
    if (swapped) lines.push(`Sustituir por: ${r.medicationLabel}`);
    else if (fieldChanged) lines.push(`Modificar: ${r.medicationLabel}`);
  }
  for (const n of added) lines.push(`Agregar: ${n.medicationLabel}`);
  return lines;
}

function friendlyAmendError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e?.code) {
    case 'P0012':
      return 'El motivo de la corrección es obligatorio.';
    case 'P0013':
      return 'Hay un campo que no se puede corregir (paciente, médico, fechas o estado).';
    case 'P0011':
      return 'La consulta no está firmada.';
    case 'P0014':
      return 'Una receta a corregir ya no está vigente. Recargá la consulta e intentá de nuevo.';
    case 'P0016':
      return 'Para agregar un medicamento hay que seleccionarlo del catálogo.';
    case '42501':
      return 'Solo el médico tratante puede corregir esta consulta.';
    default:
      return e?.message || 'No se pudo guardar la corrección. Intentá de nuevo.';
  }
}
