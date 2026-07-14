import { useEffect, useMemo, useState } from 'react';
import {
  useAmendConsultation,
  useMedicationsSearch,
  useCreateMedication,
  useDiagnosesSearch,
  useCreateDiagnosis,
} from '@/hooks/useConsultation';
import type {
  ConsultationTextField,
  ConsultationTextChanges,
  PrescriptionOp,
  DiagnosisOp,
  FamilyHistoryOp,
  VitalsChanges,
  VitalsField,
} from '@/services/consultations.service';
import { DURATION_UNITS, type Prescription, type DurationUnit } from '@/services/prescriptions.service';
import {
  type ConsultationDiagnosis,
  type DiagnosisType,
  type DiagnosisStatus,
} from '@/services/consultationDiagnoses.service';
import type { ConsultationFamilyHistory } from '@/services/consultationFamilyHistory.service';
import { computeBmi, lbToKg, kgToLb, type Vitals } from '@/services/vitals.service';
import Combobox from '@/components/Combobox';

/**
 * Modal de corrección de una consulta FIRMADA (B2 + B1.5-b).
 * Un solo motivo obligatorio + una sola llamada atómica a amend_consultation,
 * con 5 secciones (accordion): texto clínico, signos vitales, antecedentes,
 * diagnósticos, receta. Confirmación unificada con resumen de cambios; la
 * advertencia "RECETA CORREGIDA" solo aparece si cambió la receta
 * (affects_prescriptions lo deriva la RPC de p_prescription_ops, s7_30).
 * Modal sensible: NO cierra al click-outside; X/Escape/éxito.
 */

const TEXT_FIELDS: { key: ConsultationTextField; label: string; rows: number }[] = [
  { key: 'chief_complaint', label: 'Motivo principal de consulta', rows: 2 },
  { key: 'history_present_illness', label: 'Historia de la enfermedad actual', rows: 4 },
  { key: 'physical_exam', label: 'Exploración física', rows: 3 },
  { key: 'internal_analysis', label: 'Análisis interno', rows: 2 },
  { key: 'plan', label: 'Plan', rows: 5 },
];

const VITALS_FIELDS: { key: VitalsField; label: string; unit: string; step?: string }[] = [
  { key: 'systolic_bp', label: 'PA sistólica', unit: 'mmHg' },
  { key: 'diastolic_bp', label: 'PA diastólica', unit: 'mmHg' },
  { key: 'heart_rate', label: 'Frecuencia cardíaca', unit: 'lpm' },
  { key: 'respiratory_rate', label: 'Frecuencia respiratoria', unit: 'rpm' },
  { key: 'temperature', label: 'Temperatura', unit: '°C', step: '0.1' },
  { key: 'spo2', label: 'Sat. O₂', unit: '%' },
  { key: 'weight_kg', label: 'Peso', unit: 'lb', step: '0.1' },
  { key: 'height_cm', label: 'Talla', unit: 'cm' },
];

type TextValues = Record<ConsultationTextField, string>;
type VitalsValues = Record<VitalsField, string>;

interface RxFields { dosage: string; frequency: string; durationValue: string; durationUnit: DurationUnit; instructions: string; }
interface ExistingRx extends RxFields { prescriptionId: string; medicationId: string; medicationLabel: string; removed: boolean; orig: RxFields & { medicationId: string }; }
interface NewRx extends RxFields { tempId: string; medicationId: string; medicationLabel: string; }

interface ExistingDx { id: string; diagnosisId: string; diagnosisLabel: string; type: DiagnosisType; status: DiagnosisStatus; notes: string; removed: boolean; orig: { diagnosisId: string; type: DiagnosisType; status: DiagnosisStatus; notes: string }; }
interface NewDx { tempId: string; diagnosisId: string; diagnosisLabel: string; type: DiagnosisType; status: DiagnosisStatus; notes: string; }


interface Props {
  consultationId: string;
  appointmentId: string;
  doctorId: string;
  initialText: TextValues;
  initialPrescriptions: Prescription[];
  initialDiagnoses: ConsultationDiagnosis[];
  initialFamilyHistory: ConsultationFamilyHistory[];
  initialVitals: Vitals | null;
  onClose: () => void;
}

const inputCls = 'w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-800 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';
const textareaCls = inputCls + ' resize-y';
const selectCls = inputCls + ' cursor-pointer';
const norm = (s: string | null | undefined) => (s ?? '').trim();
const vStr = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export default function CorrectConsultationModal({
  consultationId, appointmentId, doctorId,
  initialText, initialPrescriptions, initialDiagnoses, initialFamilyHistory, initialVitals,
  onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const [text, setText] = useState<TextValues>(initialText);

  // Receta
  const [existing, setExisting] = useState<ExistingRx[]>(() =>
    initialPrescriptions.map((p) => {
      const f: RxFields = { dosage: p.dosage ?? '', frequency: p.frequency ?? '', durationValue: vStr(p.duration_value), durationUnit: (p.duration_unit ?? 'dias') as DurationUnit, instructions: p.instructions ?? '' };
      return { prescriptionId: p.id, medicationId: p.medication_id, medicationLabel: p.medication.commercial_name, removed: false, ...f, orig: { ...f, medicationId: p.medication_id } };
    })
  );
  const [added, setAdded] = useState<NewRx[]>([]);
  const [rxPicker, setRxPicker] = useState<{ mode: 'add' } | { mode: 'sub'; id: string } | null>(null);

  // Diagnósticos
  const [dx, setDx] = useState<ExistingDx[]>(() =>
    initialDiagnoses.map((d) => ({
      id: d.id, diagnosisId: d.diagnosis_id, diagnosisLabel: d.diagnosis.name,
      type: d.diagnosis_type, status: d.diagnosis_status, notes: d.notes ?? '', removed: false,
      orig: { diagnosisId: d.diagnosis_id, type: d.diagnosis_type, status: d.diagnosis_status, notes: d.notes ?? '' },
    }))
  );
  const [dxAdded, setDxAdded] = useState<NewDx[]>([]);
  const [dxPicker, setDxPicker] = useState<{ mode: 'add' } | { mode: 'sub'; id: string } | null>(null);

  // Antecedentes: solo texto libre (family_history_notes vía `text`). Los
  // estructurados previos se muestran read-only desde initialFamilyHistory.

  // Vitales
  const origVitals = useMemo<VitalsValues>(() => ({
    systolic_bp: vStr(initialVitals?.systolic_bp), diastolic_bp: vStr(initialVitals?.diastolic_bp),
    heart_rate: vStr(initialVitals?.heart_rate), respiratory_rate: vStr(initialVitals?.respiratory_rate),
    temperature: vStr(initialVitals?.temperature), spo2: vStr(initialVitals?.spo2),
    // weight_kg vive en kg en DB pero se muestra/edita en libras (la clave del
    // form sigue siendo weight_kg = VitalsField; el valor es lb).
    weight_kg: initialVitals?.weight_kg != null ? String(kgToLb(initialVitals.weight_kg)) : '',
    height_cm: vStr(initialVitals?.height_cm),
  }), [initialVitals]);
  const [vForm, setVForm] = useState<VitalsValues>(origVitals);

  // Accordion: texto abierto por defecto, resto colapsado.
  const [open, setOpen] = useState<Set<string>>(() => new Set(['texto']));
  const toggle = (k: string) => setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const [showSummary, setShowSummary] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const amend = useAmendConsultation(consultationId, appointmentId);
  const isSubmitting = amend.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isSubmitting) return;
      if (showSummary) setShowSummary(false);
      else if (rxPicker || dxPicker) { setRxPicker(null); setDxPicker(null); }
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSubmitting, showSummary, rxPicker, dxPicker, onClose]);

  // ─── Diffs → payload ───
  const textChanges = useMemo<ConsultationTextChanges>(() => {
    const out: ConsultationTextChanges = {};
    for (const { key } of TEXT_FIELDS) if (text[key].trim() !== initialText[key].trim()) out[key] = text[key].trim() === '' ? null : text[key];
    // Antecedentes familiares (texto libre) — se corrige por p_consultation_changes
    // (family_history_notes ya está en el whitelist de amend_consultation, s7_31).
    if (text.family_history_notes.trim() !== initialText.family_history_notes.trim())
      out.family_history_notes = text.family_history_notes.trim() === '' ? null : text.family_history_notes;
    return out;
  }, [text, initialText]);

  // El payload expresa la INTENCIÓN del médico (s7_58):
  //   clave ausente            → no tocar el campo
  //   clave presente con null  → limpiarlo (queda NULL en la DB)
  //   clave presente con valor → actualizarlo
  // Antes se OMITÍA `duration_value` al vaciarlo (o al pasar a 'permanente') y el
  // COALESCE del backend restauraba el valor viejo: la receta se marcaba como
  // corregida pero conservaba la duración anterior. Ahora la clave viaja siempre.
  const durationValueOf = (unit: DurationUnit, raw: string): number | null => {
    if (unit === 'permanente') return null; // 'permanente' no lleva duración numérica
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;             // vacío/inválido = el médico la borró
  };

  const prescriptionOps = useMemo<PrescriptionOp[]>(() => {
    const ops: PrescriptionOp[] = [];
    for (const r of existing) {
      if (r.removed) { ops.push({ op: 'remove', prescription_id: r.prescriptionId }); continue; }
      const changed = r.medicationId !== r.orig.medicationId || norm(r.dosage) !== norm(r.orig.dosage) || norm(r.frequency) !== norm(r.orig.frequency) || norm(r.durationValue) !== norm(r.orig.durationValue) || r.durationUnit !== r.orig.durationUnit || norm(r.instructions) !== norm(r.orig.instructions);
      if (!changed) continue;
      ops.push({
        op: 'replace',
        prescription_id: r.prescriptionId,
        ...(r.medicationId !== r.orig.medicationId ? { medication_id: r.medicationId } : {}),
        dosage: r.dosage.trim() || null,
        frequency: r.frequency.trim() || null,
        instructions: r.instructions.trim() || null,
        duration_unit: r.durationUnit,
        duration_value: durationValueOf(r.durationUnit, r.durationValue),
      });
    }
    for (const n of added) {
      ops.push({
        op: 'add',
        medication_id: n.medicationId,
        dosage: n.dosage.trim() || null,
        frequency: n.frequency.trim() || null,
        instructions: n.instructions.trim() || null,
        duration_unit: n.durationUnit,
        duration_value: durationValueOf(n.durationUnit, n.durationValue),
      });
    }
    return ops;
  }, [existing, added]);

  const diagnosisOps = useMemo<DiagnosisOp[]>(() => {
    const ops: DiagnosisOp[] = [];
    for (const d of dx) {
      if (d.removed) { ops.push({ op: 'remove', id: d.id }); continue; }
      const changed = d.diagnosisId !== d.orig.diagnosisId || d.type !== d.orig.type || d.status !== d.orig.status || norm(d.notes) !== norm(d.orig.notes);
      if (!changed) continue;
      ops.push({ op: 'replace', id: d.id, ...(d.diagnosisId !== d.orig.diagnosisId ? { diagnosis_id: d.diagnosisId } : {}), diagnosis_type: d.type, diagnosis_status: d.status, notes: d.notes.trim() });
    }
    for (const n of dxAdded) ops.push({ op: 'add', diagnosis_id: n.diagnosisId, diagnosis_type: n.type, diagnosis_status: n.status, notes: n.notes.trim() || null });
    return ops;
  }, [dx, dxAdded]);

  // PR-E2: los antecedentes estructurados quedan histórico/solo lectura — NO se
  // generan ops de antecedentes. La corrección de antecedentes va por el texto
  // libre (family_history_notes) en textChanges/p_consultation_changes.
  const familyHistoryOps: FamilyHistoryOp[] = [];

  const vitalsChanges = useMemo<VitalsChanges>(() => {
    const vc: VitalsChanges = {};
    let touched = false;
    for (const { key } of VITALS_FIELDS) {
      if (vForm[key].trim() === origVitals[key].trim()) continue;
      const t = vForm[key].trim();
      if (t !== '' && Number.isNaN(Number(t))) continue; // inválido → no incluir
      // weight_kg se digita en libras → se persiste en kg.
      vc[key] = t === '' ? null : (key === 'weight_kg' ? lbToKg(Number(t)) : Number(t));
      touched = true;
    }
    if (touched) {
      const wLb = parseFloat(vForm.weight_kg), h = parseFloat(vForm.height_cm);
      const b = computeBmi(isNaN(wLb) ? null : lbToKg(wLb), isNaN(h) ? null : h);
      vc.bmi = b ? b.bmi : null;
    }
    return vc;
  }, [vForm, origVitals]);

  const hasClinicalText = TEXT_FIELDS.some(({ key }) => text[key].trim() !== initialText[key].trim());
  const hasFhNotes = text.family_history_notes.trim() !== initialText.family_history_notes.trim();
  const hasReceta = prescriptionOps.length > 0;
  const hasDx = diagnosisOps.length > 0;
  const hasVitals = Object.keys(vitalsChanges).length > 0;
  const hasChanges = hasClinicalText || hasFhNotes || hasReceta || hasDx || hasVitals;
  const reasonOk = reason.trim().length > 0;

  const bmiPreview = useMemo(() => {
    const wLb = parseFloat(vForm.weight_kg); // el valor del form está en libras
    const h = parseFloat(vForm.height_cm);
    return computeBmi(isNaN(wLb) ? null : lbToKg(wLb), isNaN(h) ? null : h);
  }, [vForm.weight_kg, vForm.height_cm]);
  const paWarn = (() => { const s = parseFloat(vForm.systolic_bp), d = parseFloat(vForm.diastolic_bp); return !isNaN(s) && !isNaN(d) && s <= d; })();

  // Ids ya usados (no duplicar)
  const usedMedIds = useMemo(() => new Set<string>([...existing.filter((r) => !r.removed).map((r) => r.medicationId), ...added.map((n) => n.medicationId)]), [existing, added]);
  const usedDxIds = useMemo(() => new Set<string>([...dx.filter((d) => !d.removed).map((d) => d.diagnosisId), ...dxAdded.map((n) => n.diagnosisId)]), [dx, dxAdded]);

  // ─── Pickers ───
  const pickMedication = (med: { id: string; label: string }) => {
    if (rxPicker?.mode === 'sub') setExisting((p) => p.map((r) => r.prescriptionId === rxPicker.id ? { ...r, medicationId: med.id, medicationLabel: med.label } : r));
    else setAdded((p) => [...p, { tempId: `rx-${Date.now()}-${p.length}`, medicationId: med.id, medicationLabel: med.label, dosage: '', frequency: '', durationValue: '', durationUnit: 'dias', instructions: '' }]);
    setRxPicker(null);
  };
  const pickDiagnosis = (d: { id: string; label: string }) => {
    if (dxPicker?.mode === 'sub') setDx((p) => p.map((r) => r.id === dxPicker.id ? { ...r, diagnosisId: d.id, diagnosisLabel: d.label } : r));
    else setDxAdded((p) => [...p, { tempId: `dx-${Date.now()}-${p.length}`, diagnosisId: d.id, diagnosisLabel: d.label, type: 'presuntivo', status: 'activo', notes: '' }]);
    setDxPicker(null);
  };
  const doSubmit = async () => {
    setErrorMsg(null);
    try {
      await amend.mutateAsync({ reason: reason.trim(), changes: textChanges, prescriptionOps, diagnosisOps, familyHistoryOps, vitalsChanges });
      onClose();
    } catch (err) { setShowSummary(false); setErrorMsg(friendlyAmendError(err)); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Corregir consulta firmada</h3>
            <p className="text-sm text-gray-600 mt-1">
              Corregí lo que necesites. Los cambios quedan registrados como una corrección
              <span className="font-semibold"> visible y auditada</span>; la versión anterior se conserva. No es una edición silenciosa.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600 disabled:opacity-40 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Motivo */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">Motivo de la corrección <span className="text-red-500">*</span></label>
          <textarea rows={2} value={reason} disabled={isSubmitting} onChange={(e) => setReason(e.target.value)} placeholder="Ej: medicamento no disponible, se sustituye por equivalente…" className={textareaCls} autoFocus />
          {!reasonOk && <p className="text-xs text-amber-600 mt-1">El motivo es obligatorio.</p>}
        </div>

        {/* ─── Texto clínico ─── */}
        <Accordion title="Texto clínico" modified={hasClinicalText} isOpen={open.has('texto')} onToggle={() => toggle('texto')}>
          <div className="space-y-3">
            {TEXT_FIELDS.map(({ key, label, rows }) => {
              const changed = text[key].trim() !== initialText[key].trim();
              return (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}{changed && <ModBadge />}</label>
                  <textarea rows={rows} value={text[key]} disabled={isSubmitting} onChange={(e) => setText({ ...text, [key]: e.target.value })} className={textareaCls} />
                </div>
              );
            })}
          </div>
        </Accordion>

        {/* ─── Signos vitales ─── */}
        <Accordion title="Signos vitales" modified={hasVitals} isOpen={open.has('vitales')} onToggle={() => toggle('vitales')}>
          {!initialVitals && <p className="text-xs text-gray-500 mb-2">Sin signos vitales registrados — podés cargarlos.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {VITALS_FIELDS.map(({ key, label, unit, step }) => {
              const changed = vForm[key].trim() !== origVitals[key].trim();
              return (
                <label key={key} className="block">
                  <span className="block text-[11px] text-gray-500 mb-0.5">{label} <span className="text-gray-400">{unit}</span>{changed && <span className="ml-1 text-amber-600">•</span>}</span>
                  <input type="number" step={step} value={vForm[key]} disabled={isSubmitting} onChange={(e) => setVForm({ ...vForm, [key]: e.target.value })} className={inputCls} />
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-xs text-gray-600">IMC: <span className="font-semibold text-gray-900">{bmiPreview ? `${bmiPreview.bmi} · ${bmiPreview.label}` : '—'}</span></span>
            {bmiPreview && (bmiPreview.bmi < 10 || bmiPreview.bmi > 60) && <span className="text-[11px] text-amber-700">IMC fuera de rango — verificá peso/talla.</span>}
            {paWarn && <span className="text-[11px] text-amber-700">PA sistólica debe ser mayor que la diastólica.</span>}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Dejá un campo vacío para borrar ese signo.</p>
        </Accordion>

        {/* ─── Antecedentes familiares (texto libre, corregible) ─── */}
        <Accordion title="Antecedentes familiares" modified={hasFhNotes} isOpen={open.has('antecedentes')} onToggle={() => toggle('antecedentes')}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Antecedentes familiares{hasFhNotes && <ModBadge />}
            </label>
            <textarea
              rows={4}
              value={text.family_history_notes}
              disabled={isSubmitting}
              onChange={(e) => setText({ ...text, family_history_notes: e.target.value })}
              placeholder="Ej: Padre con hipertensión arterial; madre con diabetes tipo 2 (dx a los 50)..."
              className={textareaCls}
            />
          </div>

          {/* Histórico: antecedentes estructurados de versiones anteriores
              (solo lectura). No editables en corrección; se conservan tal cual. */}
          {initialFamilyHistory.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-1.5">Antecedentes registrados anteriormente (solo lectura)</p>
              <div className="space-y-2">
                {initialFamilyHistory.map((f) => (
                  <div key={f.id} className="rounded-lg p-3 bg-gray-50 border border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{f.family_history.name}</p>
                    {f.notes && <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{f.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Accordion>

        {/* ─── Diagnósticos ─── */}
        <Accordion title="Diagnósticos" modified={hasDx} isOpen={open.has('diagnosticos')} onToggle={() => toggle('diagnosticos')}>
          <div className="space-y-2">
            {dx.length === 0 && dxAdded.length === 0 && <p className="text-xs text-gray-400 italic">Sin diagnósticos registrados.</p>}
            {dx.map((d) => {
              const swapped = d.diagnosisId !== d.orig.diagnosisId;
              const changed = swapped || d.type !== d.orig.type || d.status !== d.orig.status || norm(d.notes) !== norm(d.orig.notes);
              return (
                <div key={d.id} className={`rounded-lg p-3 border ${d.removed ? 'bg-red-50/50 border-red-200' : 'bg-gray-50 border-transparent'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-medium ${d.removed ? 'text-red-700 line-through' : 'text-gray-900'}`}>{d.diagnosisLabel}{swapped && !d.removed && <span className="ml-2 text-[11px] font-semibold text-emerald-700 uppercase">· cambiado</span>}{!swapped && changed && !d.removed && <ModBadge />}</p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!d.removed && <button type="button" disabled={isSubmitting} onClick={() => setDxPicker({ mode: 'sub', id: d.id })} className="text-xs text-emerald-700 hover:text-emerald-800 disabled:opacity-50">Cambiar diagnóstico</button>}
                      <button type="button" disabled={isSubmitting} onClick={() => setDx((p) => p.map((x) => x.id === d.id ? { ...x, removed: !x.removed } : x))} className={`text-xs disabled:opacity-50 ${d.removed ? 'text-gray-600 hover:text-gray-800' : 'text-red-600 hover:text-red-700'}`}>{d.removed ? 'Deshacer' : 'Quitar'}</button>
                    </div>
                  </div>
                  {!d.removed && (
                    <DxFieldsEditor notes={d.notes} disabled={isSubmitting}
                      onChange={(patch) => setDx((p) => p.map((x) => x.id === d.id ? { ...x, ...patch } : x))} />
                  )}
                </div>
              );
            })}
            {dxAdded.map((n) => (
              <div key={n.tempId} className="rounded-lg p-3 border border-emerald-200 bg-emerald-50/40">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{n.diagnosisLabel}<span className="ml-2 text-[11px] font-semibold text-emerald-700 uppercase">· nuevo</span></p>
                  <button type="button" disabled={isSubmitting} onClick={() => setDxAdded((p) => p.filter((x) => x.tempId !== n.tempId))} className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50">Quitar</button>
                </div>
                <DxFieldsEditor notes={n.notes} disabled={isSubmitting}
                  onChange={(patch) => setDxAdded((p) => p.map((x) => x.tempId === n.tempId ? { ...x, ...patch } : x))} />
              </div>
            ))}
          </div>
          {dxPicker?.mode !== 'add' ? (
            <AddButton label="Agregar diagnóstico" onClick={() => setDxPicker({ mode: 'add' })} disabled={isSubmitting} />
          ) : (
            <div className="bg-gray-50 rounded-lg p-3 mt-2">
              <DiagnosisPicker doctorId={doctorId} excludeIds={usedDxIds} onPick={pickDiagnosis} />
              <CancelLink onClick={() => setDxPicker(null)} />
            </div>
          )}
        </Accordion>

        {/* ─── Receta ─── */}
        <Accordion title="Receta / Medicamentos" modified={hasReceta} isOpen={open.has('receta')} onToggle={() => toggle('receta')}>
          {/* Bloque para agregar — ARRIBA de la lista (UX: ver primero lo que se agrega). */}
          {rxPicker?.mode !== 'add' ? (
            <AddButton label="Agregar medicamento" onClick={() => setRxPicker({ mode: 'add' })} disabled={isSubmitting} />
          ) : (
            <div className="bg-gray-50 rounded-lg p-3 mb-2">
              <MedicationPicker doctorId={doctorId} excludeIds={usedMedIds} onPick={pickMedication} />
              <CancelLink onClick={() => setRxPicker(null)} />
            </div>
          )}
          {/* Nuevos arriba (más reciente primero), existentes debajo. Esto es SOLO la
              vista del modal: el orden persistido y el del PDF NO cambian (prescriptionOps
              se sigue armando en orden cronológico; [...added].reverse() copia para no
              mutar el estado). */}
          <div className="space-y-2 mt-2">
            {existing.length === 0 && added.length === 0 && <p className="text-xs text-gray-400 italic">Esta consulta no tiene medicamentos.</p>}
            {[...added].reverse().map((n) => (
              <NewRxCard key={n.tempId} rx={n} disabled={isSubmitting}
                onField={(patch) => setAdded((p) => p.map((x) => x.tempId === n.tempId ? { ...x, ...patch } : x))}
                onDrop={() => setAdded((p) => p.filter((x) => x.tempId !== n.tempId))} />
            ))}
            {existing.map((r) => (
              <ExistingRxCard key={r.prescriptionId} rx={r} disabled={isSubmitting}
                onField={(patch) => setExisting((p) => p.map((x) => x.prescriptionId === r.prescriptionId ? { ...x, ...patch } : x))}
                onToggleRemove={() => setExisting((p) => p.map((x) => x.prescriptionId === r.prescriptionId ? { ...x, removed: !x.removed } : x))}
                onSubstitute={() => setRxPicker({ mode: 'sub', id: r.prescriptionId })} />
            ))}
          </div>
        </Accordion>

        {/* Substitución de receta (overlay) */}
        {rxPicker?.mode === 'sub' && (
          <PickerOverlay title="Sustituir medicamento" onCancel={() => setRxPicker(null)}>
            <MedicationPicker doctorId={doctorId} excludeIds={usedMedIds} onPick={pickMedication} />
          </PickerOverlay>
        )}
        {/* Cambiar diagnóstico (overlay) */}
        {dxPicker?.mode === 'sub' && (
          <PickerOverlay title="Cambiar diagnóstico" onCancel={() => setDxPicker(null)}>
            <DiagnosisPicker doctorId={doctorId} excludeIds={usedDxIds} onPick={pickDiagnosis} />
          </PickerOverlay>
        )}

        {errorMsg && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mt-4">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            <p className="text-xs text-red-700">{errorMsg}</p>
          </div>
        )}
        {reasonOk && !hasChanges && <p className="text-xs text-amber-600 mt-4">No hay cambios para guardar. Modificá alguna sección para poder corregir.</p>}

        <div className="flex gap-3 justify-end pt-5">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => setShowSummary(true)} disabled={!reasonOk || !hasChanges || isSubmitting} className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50">Confirmar corrección</button>
        </div>
      </div>

      {/* ─── Resumen unificado ─── */}
      {showSummary && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-900">Revisar corrección</h3>
            <p className="text-xs text-gray-600">Esta corrección queda registrada (motivo + versión + auditoría). No es una edición silenciosa.</p>

            <SummaryBlock title="Texto clínico" lines={textSummary(text, initialText)} />
            <SummaryBlock title="Signos vitales" lines={vitalsSummary(vForm, origVitals)} />
            <SummaryBlock title="Antecedentes" lines={hasFhNotes ? ['Modificar: Antecedentes familiares'] : []} />
            <SummaryBlock title="Diagnósticos" lines={dxSummary(dx, dxAdded)} />
            <SummaryBlock title="Receta" lines={recetaSummary(existing, added)} />

            {hasReceta && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                <p className="text-xs text-amber-700">Cambiás la receta: la receta impresa quedará marcada como <span className="font-semibold">RECETA CORREGIDA</span>. La versión anterior se conserva.</p>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button type="button" onClick={() => setShowSummary(false)} disabled={isSubmitting} className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50">Volver</button>
              <button type="button" onClick={doSubmit} disabled={isSubmitting} className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50">{isSubmitting ? 'Guardando…' : 'Aplicar corrección'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes UI ───────────────────────────────────────────────

function Accordion({ title, modified, isOpen, onToggle, children }: { title: string; modified: boolean; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-xl mb-3 overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left">
        <span className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          {title}
          {modified && <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[11px] font-medium">modificado</span>}
        </span>
        <svg className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {isOpen && <div className="p-4">{children}</div>}
    </div>
  );
}

const ModBadge = () => <span className="ml-2 text-[11px] font-semibold text-amber-600 uppercase">· modificado</span>;
const AddButton = ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="mt-2 text-sm font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5 disabled:opacity-50">
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>{label}
  </button>
);
const CancelLink = ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick} className="mt-2 text-xs text-gray-500 hover:text-gray-700">Cancelar</button>;

function PickerOverlay({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">{title}</h4>
        {children}
        <div className="flex justify-end mt-3"><button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">Cancelar</button></div>
      </div>
    </div>
  );
}

function SummaryBlock({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700">{title}</p>
      <ul className="text-xs text-gray-600 mt-0.5 space-y-0.5">{lines.map((l, i) => <li key={i}>• {l}</li>)}</ul>
    </div>
  );
}

function DxFieldsEditor({ notes, disabled, onChange }: { notes: string; disabled: boolean; onChange: (patch: { notes?: string }) => void }) {
  return (
    <div className="space-y-2 mt-2">
      <label className="block"><span className="block text-[11px] text-gray-500 mb-0.5">Notas (opcional)</span>
        <textarea rows={2} value={notes} disabled={disabled} onChange={(e) => onChange({ notes: e.target.value })} className={textareaCls} />
      </label>
    </div>
  );
}

function RxFieldsEditor({ rx, disabled, onField }: { rx: RxFields; disabled: boolean; onField: (patch: Partial<RxFields>) => void }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block"><span className="block text-[11px] text-gray-500 mb-0.5">Dosis</span><input type="text" value={rx.dosage} disabled={disabled} onChange={(e) => onField({ dosage: e.target.value })} placeholder="Ej: 1 tableta" className={inputCls} /></label>
        <label className="block"><span className="block text-[11px] text-gray-500 mb-0.5">Frecuencia</span><input type="text" value={rx.frequency} disabled={disabled} onChange={(e) => onField({ frequency: e.target.value })} placeholder="Ej: cada 8 horas" className={inputCls} /></label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block col-span-1"><span className="block text-[11px] text-gray-500 mb-0.5">Duración</span><input type="number" min={1} value={rx.durationValue} disabled={disabled || rx.durationUnit === 'permanente'} onChange={(e) => onField({ durationValue: e.target.value })} placeholder="—" className={inputCls} /></label>
        <label className="block col-span-2"><span className="block text-[11px] text-gray-500 mb-0.5">Unidad</span>
          <select value={rx.durationUnit} disabled={disabled} onChange={(e) => { const next = e.target.value as DurationUnit; onField({ durationUnit: next, ...(next === 'permanente' ? { durationValue: '' } : {}) }); }} className={selectCls}>{DURATION_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select>
        </label>
      </div>
      <label className="block"><span className="block text-[11px] text-gray-500 mb-0.5">Indicaciones y notas</span><textarea rows={2} value={rx.instructions} disabled={disabled} onChange={(e) => onField({ instructions: e.target.value })} placeholder="Cómo tomarse el medicamento, con/sin comida, etc." className={textareaCls} /></label>
    </>
  );
}

function ExistingRxCard({ rx, disabled, onField, onToggleRemove, onSubstitute }: { rx: ExistingRx; disabled: boolean; onField: (patch: Partial<ExistingRx>) => void; onToggleRemove: () => void; onSubstitute: () => void }) {
  const swapped = rx.medicationId !== rx.orig.medicationId;
  return (
    <div className={`rounded-lg p-3 space-y-2.5 border ${rx.removed ? 'bg-red-50/50 border-red-200' : 'bg-gray-50 border-transparent'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className={`text-sm font-medium ${rx.removed ? 'text-red-700 line-through' : 'text-gray-900'}`}>{rx.medicationLabel}</p>{swapped && !rx.removed && <span className="text-[11px] font-semibold text-emerald-700 uppercase">· sustituido</span>}</div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!rx.removed && <button type="button" onClick={onSubstitute} disabled={disabled} className="text-xs text-emerald-700 hover:text-emerald-800 disabled:opacity-50">Sustituir</button>}
          <button type="button" onClick={onToggleRemove} disabled={disabled} className={`text-xs disabled:opacity-50 ${rx.removed ? 'text-gray-600 hover:text-gray-800' : 'text-red-600 hover:text-red-700'}`}>{rx.removed ? 'Deshacer' : 'Quitar'}</button>
        </div>
      </div>
      {!rx.removed && <RxFieldsEditor rx={rx} disabled={disabled} onField={onField} />}
    </div>
  );
}

function NewRxCard({ rx, disabled, onField, onDrop }: { rx: NewRx; disabled: boolean; onField: (patch: Partial<NewRx>) => void; onDrop: () => void }) {
  return (
    <div className="rounded-lg p-3 space-y-2.5 border border-emerald-200 bg-emerald-50/40">
      <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-gray-900">{rx.medicationLabel}<span className="ml-2 text-[11px] font-semibold text-emerald-700 uppercase">· nuevo</span></p><button type="button" onClick={onDrop} disabled={disabled} className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50">Quitar</button></div>
      <RxFieldsEditor rx={rx} disabled={disabled} onField={onField} />
    </div>
  );
}

function MedicationPicker({ doctorId, excludeIds, onPick }: { doctorId: string; excludeIds: Set<string>; onPick: (med: { id: string; label: string }) => void }) {
  const [search, setSearch] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const t = setTimeout(() => setDeb(search), 250); return () => clearTimeout(t); }, [search]);
  const { data: items = [], isFetching } = useMedicationsSearch(doctorId, deb);
  const create = useCreateMedication(doctorId);
  return (
    <Combobox items={items.filter((it) => !excludeIds.has(it.id))} searchValue={search} onSearch={setSearch}
      onSelect={(it) => onPick({ id: it.id, label: it.commercial_name })}
      onCreate={async (name) => { const c = await create.mutateAsync({ commercial_name: name }); onPick({ id: c.id, label: c.commercial_name }); }}
      getKey={(it) => it.id} getLabel={(it) => it.commercial_name} getSubLabel={(it) => [it.active_ingredient, it.concentration, it.presentation].filter(Boolean).join(' · ') || null}
      getBadge={(it) => (it.doctor_id === null ? { label: 'Base Lucy', tone: 'lucy' } : null)}
      placeholder="Buscar medicamento… (nombre comercial o principio activo)" disabled={create.isPending} isLoading={isFetching} createLabel={(i) => `Crear nuevo medicamento propio: "${i}"`} />
  );
}

function DiagnosisPicker({ doctorId, excludeIds, onPick }: { doctorId: string; excludeIds: Set<string>; onPick: (d: { id: string; label: string }) => void }) {
  const [search, setSearch] = useState(''); const [deb, setDeb] = useState('');
  useEffect(() => { const t = setTimeout(() => setDeb(search), 250); return () => clearTimeout(t); }, [search]);
  const { data: items = [], isFetching } = useDiagnosesSearch(doctorId, deb);
  const create = useCreateDiagnosis(doctorId);
  return (
    <Combobox items={items.filter((it) => !excludeIds.has(it.id))} searchValue={search} onSearch={setSearch}
      onSelect={(it) => onPick({ id: it.id, label: it.name })}
      onCreate={async (name) => { const c = await create.mutateAsync({ name }); onPick({ id: c.id, label: c.name }); }}
      getKey={(it) => it.id} getLabel={(it) => it.name} getSubLabel={(it) => it.description || null}
      getBadge={(it) => (it.doctor_id === null ? { label: 'Base Lucy', tone: 'lucy' } : null)}
      placeholder="Buscar diagnóstico…" disabled={create.isPending} isLoading={isFetching} createLabel={(i) => `Crear nuevo diagnóstico propio: "${i}"`} />
  );
}

// ─── Resúmenes ────────────────────────────────────────────────────────

function textSummary(t: TextValues, init: TextValues): string[] {
  return TEXT_FIELDS.filter(({ key }) => t[key].trim() !== init[key].trim()).map(({ label }) => `Modificar: ${label}`);
}
function vitalsSummary(v: VitalsValues, orig: VitalsValues): string[] {
  return VITALS_FIELDS.filter(({ key }) => v[key].trim() !== orig[key].trim()).map(({ key, label }) => {
    const to = v[key].trim() === '' ? '—' : v[key].trim();
    return `${label}: ${orig[key].trim() === '' ? '—' : orig[key].trim()} → ${to}`;
  });
}
function dxSummary(rows: ExistingDx[], addedRows: NewDx[]): string[] {
  const out: string[] = [];
  for (const d of rows) {
    if (d.removed) { out.push(`Quitar: ${d.diagnosisLabel}`); continue; }
    if (d.diagnosisId !== d.orig.diagnosisId) out.push(`Cambiar diagnóstico → ${d.diagnosisLabel}`);
    else if (d.type !== d.orig.type || d.status !== d.orig.status || norm(d.notes) !== norm(d.orig.notes)) out.push(`Modificar: ${d.diagnosisLabel}`);
  }
  for (const n of addedRows) out.push(`Agregar: ${n.diagnosisLabel}`);
  return out;
}
function recetaSummary(existing: ExistingRx[], added: NewRx[]): string[] {
  const out: string[] = [];
  for (const r of existing) {
    if (r.removed) { out.push(`Quitar: ${r.medicationLabel}`); continue; }
    const swapped = r.medicationId !== r.orig.medicationId;
    const fieldChanged = norm(r.dosage) !== norm(r.orig.dosage) || norm(r.frequency) !== norm(r.orig.frequency) || norm(r.durationValue) !== norm(r.orig.durationValue) || r.durationUnit !== r.orig.durationUnit || norm(r.instructions) !== norm(r.orig.instructions);
    if (swapped) out.push(`Sustituir por: ${r.medicationLabel}`);
    else if (fieldChanged) out.push(`Modificar: ${r.medicationLabel}`);
  }
  for (const n of added) out.push(`Agregar: ${n.medicationLabel}`);
  return out;
}

function friendlyAmendError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e?.code) {
    case 'P0012': return 'El motivo de la corrección es obligatorio.';
    case 'P0013': return 'Hay un campo que no se puede corregir (paciente, médico, fechas o estado).';
    case 'P0011': return 'La consulta no está firmada.';
    case 'P0014': return 'Una receta a corregir ya no está vigente. Recargá la consulta e intentá de nuevo.';
    case 'P0016': return 'Para agregar un medicamento hay que seleccionarlo del catálogo.';
    case 'P0017': return 'No se pudo aplicar la corrección de un diagnóstico.';
    case 'P0018': return 'Un diagnóstico a corregir no se encontró. Recargá la consulta.';
    case 'P0020': return 'No se pudo aplicar la corrección de un antecedente.';
    case 'P0021': return 'Un antecedente a corregir no se encontró. Recargá la consulta.';
    case 'P0023': return 'No se pueden corregir signos vitales: la consulta no tiene cita asociada.';
    case '42501': return 'Solo el médico tratante puede corregir esta consulta.';
    default: return e?.message || 'No se pudo guardar la corrección. Intentá de nuevo.';
  }
}
