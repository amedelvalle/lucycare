import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useConsultationByAppointment,
  useSaveConsultationDraft,
  useSignConsultation,
  useIsConsultationEmpty,
  useDiscardConsultation,
  useVitals,
  useUpsertVitals,
  useConsultationAmendments,
} from '@/hooks/useConsultation';
import { computeBmi, type VitalsInput } from '@/services/vitals.service';
import type { ConsultationUpdate } from '@/services/consultations.service';
import DiagnosesSection from './DiagnosesSection';
import PrescriptionsSection from './PrescriptionsSection';
import AntecedentesSection from './AntecedentesSection';
import FollowUpScheduler from './FollowUpScheduler';
import RecetaPrint from './RecetaPrint';
import CorrectConsultationModal from './CorrectConsultationModal';
import { usePrescriptions } from '@/hooks/useConsultation';

interface FormState {
  chief_complaint: string;
  history_present_illness: string;
  physical_exam: string;
  internal_analysis: string;
  plan: string;
}

interface VitalsFormState {
  systolic_bp: string;
  diastolic_bp: string;
  heart_rate: string;
  respiratory_rate: string;
  temperature: string;
  spo2: string;
  weight_kg: string;
  height_cm: string;
}

const EMPTY_FORM: FormState = {
  chief_complaint: '',
  history_present_illness: '',
  physical_exam: '',
  internal_analysis: '',
  plan: '',
};

const EMPTY_VITALS: VitalsFormState = {
  systolic_bp: '',
  diastolic_bp: '',
  heart_rate: '',
  respiratory_rate: '',
  temperature: '',
  spo2: '',
  weight_kg: '',
  height_cm: '',
};

export default function ConsultaPage() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();

  const { data: ctx, isLoading, error } = useConsultationByAppointment(appointmentId);
  const { data: vitals } = useVitals(appointmentId);
  const { data: prescriptions = [] } = usePrescriptions(ctx?.id);

  const saveDraft = useSaveConsultationDraft(ctx?.id ?? '', appointmentId ?? '');
  const sign = useSignConsultation(ctx?.id ?? '', appointmentId ?? '');
  const upsertVitals = useUpsertVitals(appointmentId ?? '', ctx?.patient_id ?? '');
  const { data: isEmpty } = useIsConsultationEmpty(ctx?.id);
  const discard = useDiscardConsultation(ctx?.id ?? '', appointmentId ?? '');
  const { data: amendments = [] } = useConsultationAmendments(
    ctx?.status === 'signed' ? ctx?.id : undefined
  );

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [vitalsForm, setVitalsForm] = useState<VitalsFormState>(EMPTY_VITALS);
  const [confirmSign, setConfirmSign] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [showCorrect, setShowCorrect] = useState(false);

  const isSigned = ctx?.status === 'signed';
  const readOnly = isSigned;

  // Hidratar formularios cuando llega el contexto
  useEffect(() => {
    if (ctx) {
      setForm({
        chief_complaint: ctx.chief_complaint ?? '',
        history_present_illness: ctx.history_present_illness ?? '',
        physical_exam: ctx.physical_exam ?? '',
        internal_analysis: ctx.internal_analysis ?? '',
        plan: ctx.plan ?? '',
      });
    }
    // updated_at en la dep: tras una corrección (amend) el ctx se refetcha con
    // texto nuevo pero el mismo id → re-hidratar para que el modo lectura
    // muestre el texto corregido. En borrador, updated_at solo cambia al
    // guardar (no mientras se tipea), así que no pisa ediciones en curso.
  }, [ctx?.id, ctx?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (vitals) {
      setVitalsForm({
        systolic_bp: vitals.systolic_bp?.toString() ?? '',
        diastolic_bp: vitals.diastolic_bp?.toString() ?? '',
        heart_rate: vitals.heart_rate?.toString() ?? '',
        respiratory_rate: vitals.respiratory_rate?.toString() ?? '',
        temperature: vitals.temperature?.toString() ?? '',
        spo2: vitals.spo2?.toString() ?? '',
        weight_kg: vitals.weight_kg?.toString() ?? '',
        height_cm: vitals.height_cm?.toString() ?? '',
      });
    }
  }, [vitals?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // IMC calculado en vivo desde el formulario (no de la query)
  const bmiPreview = useMemo(() => {
    const w = parseFloat(vitalsForm.weight_kg);
    const h = parseFloat(vitalsForm.height_cm);
    return computeBmi(isNaN(w) ? null : w, isNaN(h) ? null : h);
  }, [vitalsForm.weight_kg, vitalsForm.height_cm]);

  // ─── Handlers ────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    if (!ctx) return;
    const updates: ConsultationUpdate = {
      chief_complaint: form.chief_complaint || null,
      history_present_illness: form.history_present_illness || null,
      physical_exam: form.physical_exam || null,
      internal_analysis: form.internal_analysis || null,
      plan: form.plan || null,
    };
    const vitalsInput = parseVitalsForm(vitalsForm);

    try {
      await Promise.all([
        saveDraft.mutateAsync(updates),
        upsertVitals.mutateAsync(vitalsInput),
      ]);
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Error guardando consulta:', err);
    }
  };

  const handleSign = async () => {
    if (!ctx) return;
    setSignError(null);
    try {
      // Guardar último estado antes de firmar
      await handleSaveDraft();
      await sign.mutateAsync();
      setConfirmSign(false);
    } catch (err) {
      // Mostrar el error real (antes fallaba en silencio)
      setSignError(
        err instanceof Error ? err.message : 'No se pudo firmar la consulta.'
      );
    }
  };

  const handleDiscard = async () => {
    if (!ctx) return;
    try {
      await discard.mutateAsync();
      setConfirmDiscard(false);
      navigate(-1);
    } catch (err) {
      console.error('Error descartando borrador:', err);
      setConfirmDiscard(false);
    }
  };

  // ─── Loading / Error ─────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-1/2" />
          <div className="h-32 bg-gray-100 rounded" />
          <div className="h-64 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (error || !ctx) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">
            {error instanceof Error
              ? error.message
              : 'No se pudo cargar la consulta.'}
          </p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="mt-3 text-sm text-emerald-700 hover:underline"
        >
          ← Volver
        </button>
      </div>
    );
  }

  const isSaving = saveDraft.isPending || upsertVitals.isPending;
  const isSigning = sign.isPending;

  return (
    <>
      {/* ─── Layout pantalla (oculto en impresión) ──────────── */}
      <div className="max-w-4xl mx-auto pb-32 print:hidden">
      {/* ─── Header ─────────────────────────────────────────── */}
      <ConsultaHeader
        ctx={ctx}
        savedAt={savedAt}
        onBack={() => navigate(-1)}
        readOnly={readOnly}
      />

      {/* ─── Historial de correcciones (consulta firmada con adendas) ─── */}
      {isSigned && amendments.length > 0 && (
        <Section
          title="Historial de correcciones"
          subtitle="Cada corrección queda registrada con su motivo. La versión anterior se conserva."
        >
          <ul className="space-y-2">
            {amendments.map((a) => (
              <li key={a.id} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center rounded-full bg-gray-200 text-gray-700 px-2.5 py-0.5 text-xs font-medium">
                    v{a.version}
                  </span>
                  <span className="text-xs text-gray-500">{formatTimestamp(a.corrected_at)}</span>
                  {a.affects_prescriptions && (
                    <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-medium">
                      Receta corregida
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-800 mt-1.5 whitespace-pre-wrap">{a.reason}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ─── Sección: Evaluación clínica ────────────────────── */}
      <Section title="Evaluación clínica" subtitle="Anamnesis y exploración del paciente">
        <Field label="Motivo principal de consulta">
          <textarea
            rows={2}
            value={form.chief_complaint}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, chief_complaint: e.target.value })}
            placeholder="Ej: dolor de cabeza intermitente desde hace 3 días..."
            className={textareaCls}
          />
        </Field>

        <Field label="Historia de la enfermedad actual">
          <textarea
            rows={4}
            value={form.history_present_illness}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, history_present_illness: e.target.value })}
            placeholder="Inicio, evolución, factores desencadenantes, síntomas asociados..."
            className={textareaCls}
          />
        </Field>

        <Field label="Exploración física">
          <textarea
            rows={3}
            value={form.physical_exam}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, physical_exam: e.target.value })}
            placeholder="Hallazgos relevantes a la exploración..."
            className={textareaCls}
          />
        </Field>

        <Field
          label="Análisis interno"
          hint="Observaciones derivadas de la atención que no son diagnóstico de catálogo"
        >
          <textarea
            rows={2}
            value={form.internal_analysis}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, internal_analysis: e.target.value })}
            className={textareaCls}
          />
        </Field>
      </Section>

      {/* ─── Sección: Signos vitales ────────────────────────── */}
      <Section title="Signos vitales" subtitle="Medidas tomadas en consulta — última captura prevalece">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NumberField
            label="PA sistólica"
            unit="mmHg"
            min={40} max={300}
            value={vitalsForm.systolic_bp}
            disabled={readOnly}
            onChange={(v) => setVitalsForm({ ...vitalsForm, systolic_bp: v })}
            warningCheck={validators.systolic}
          />
          <NumberField
            label="PA diastólica"
            unit="mmHg"
            min={20} max={200}
            value={vitalsForm.diastolic_bp}
            disabled={readOnly}
            onChange={(v) => setVitalsForm({ ...vitalsForm, diastolic_bp: v })}
            warningCheck={validators.diastolic}
          />
          <NumberField
            label="Frecuencia cardíaca"
            unit="lpm"
            min={20} max={250}
            value={vitalsForm.heart_rate}
            disabled={readOnly}
            onChange={(v) => setVitalsForm({ ...vitalsForm, heart_rate: v })}
            warningCheck={validators.heartRate}
          />
          <NumberField
            label="Frecuencia respiratoria"
            unit="rpm"
            min={3} max={80}
            value={vitalsForm.respiratory_rate}
            disabled={readOnly}
            onChange={(v) => setVitalsForm({ ...vitalsForm, respiratory_rate: v })}
            warningCheck={validators.respiratoryRate}
          />
        </div>

        {/* Cross-check PA: sistólica > diastólica */}
        {(() => {
          const sys = parseFloat(vitalsForm.systolic_bp);
          const dia = parseFloat(vitalsForm.diastolic_bp);
          if (!isNaN(sys) && !isNaN(dia) && sys <= dia) {
            return (
              <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <svg className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
                <p className="text-xs text-amber-700">
                  PA sistólica debe ser mayor que la diastólica. Verificá los valores.
                </p>
              </div>
            );
          }
          return null;
        })()}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <NumberField
            label="Temperatura"
            unit="°C"
            step="0.1"
            min={25} max={50}
            value={vitalsForm.temperature}
            disabled={readOnly}
            onChange={(v) => setVitalsForm({ ...vitalsForm, temperature: v })}
            warningCheck={validators.temperature}
          />
          <NumberField
            label="Sat. O₂"
            unit="%"
            min={30} max={100}
            value={vitalsForm.spo2}
            disabled={readOnly}
            onChange={(v) => setVitalsForm({ ...vitalsForm, spo2: v })}
            warningCheck={validators.spo2}
          />
          <NumberField
            label="Peso"
            unit="kg"
            step="0.1"
            min={0.5} max={400}
            value={vitalsForm.weight_kg}
            disabled={readOnly}
            onChange={(v) => setVitalsForm({ ...vitalsForm, weight_kg: v })}
            warningCheck={validators.weightKg}
          />
          <NumberField
            label="Talla"
            unit="cm"
            min={20} max={260}
            value={vitalsForm.height_cm}
            disabled={readOnly}
            onChange={(v) => setVitalsForm({ ...vitalsForm, height_cm: v })}
            warningCheck={validators.heightCm}
          />
        </div>

        {/* IMC calculado + sanity check */}
        {(() => {
          const bmiOutOfRange = bmiPreview && (bmiPreview.bmi < 10 || bmiPreview.bmi > 60);
          return (
            <div
              className={`mt-4 p-3 rounded-lg flex items-center justify-between ${
                bmiOutOfRange ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'
              }`}
            >
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">IMC</p>
                {bmiPreview ? (
                  <>
                    <p className="text-lg font-semibold text-gray-900 mt-0.5">
                      {bmiPreview.bmi}{' '}
                      <span className={`text-sm font-medium ${bmiCategoryColor(bmiPreview.category)}`}>
                        · {bmiPreview.label}
                      </span>
                    </p>
                    {bmiOutOfRange && (
                      <p className="text-[11px] text-amber-700 mt-1 flex items-start gap-1">
                        <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                        </svg>
                        IMC fuera de rango razonable. Verificá unidades de peso (kg) y talla (cm).
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-400 mt-0.5 italic">
                    Ingresa peso y talla para calcular
                  </p>
                )}
              </div>
              {vitals?.recorded_at && (
                <div className="text-right">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Última captura</p>
                  <p className="text-xs text-gray-600">{formatTimestamp(vitals.recorded_at)}</p>
                </div>
              )}
            </div>
          );
        })()}
      </Section>

      {/* ─── Sección: Antecedentes familiares ─────────────────── */}
      <Section
        title="Antecedentes familiares"
        subtitle="Busca en tu catálogo o agrega uno nuevo. Por cada antecedente podés escribir detalles específicos (parentesco, edad de aparición, etc.)"
      >
        <AntecedentesSection
          consultationId={ctx.id}
          doctorId={ctx.doctor_id}
          readOnly={readOnly}
        />
      </Section>

      {/* ─── Sección: Diagnósticos ──────────────────────────── */}
      <Section
        title="Diagnósticos"
        subtitle="Busca en tu catálogo o crea uno nuevo si no existe"
      >
        <DiagnosesSection
          consultationId={ctx.id}
          doctorId={ctx.doctor_id}
          readOnly={readOnly}
        />
      </Section>

      {/* ─── Sección: Receta ─────────────────────────────────── */}
      <Section
        title="Receta"
        subtitle="Medicamentos prescritos en esta consulta"
      >
        <PrescriptionsSection
          consultationId={ctx.id}
          doctorId={ctx.doctor_id}
          patientId={ctx.patient_id}
          readOnly={readOnly}
        />
      </Section>

      {/* ─── Sección: Plan de seguimiento ────────────────────── */}
      <Section
        title="Plan de seguimiento"
        subtitle="Indicaciones, órdenes médicas y próximo control"
      >
        <Field
          label="Plan"
          hint="Texto libre. La estructura de órdenes de laboratorio/imagen llega en S6"
        >
          <textarea
            rows={5}
            value={form.plan}
            disabled={readOnly}
            onChange={(e) => setForm({ ...form, plan: e.target.value })}
            placeholder="Indicaciones generales: ...&#10;Órdenes: hemograma, glucemia&#10;Próximo control: en 2 semanas"
            className={textareaCls}
          />
        </Field>

        {/* Agendar próxima cita inline — sin salir de la consulta */}
        {ctx.appointment && (
          <FollowUpScheduler
            patientId={ctx.patient_id}
            doctorId={ctx.doctor_id}
            clinicId={ctx.clinic_id}
            currentAppointmentStart={ctx.appointment.start_time}
            patientName={ctx.patient.full_name}
          />
        )}
      </Section>

      {/* ─── Sticky bottom bar con acciones ──────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 md:left-16 lg:left-64 bg-white border-t border-gray-200 px-4 py-3 z-30 shadow-lg md:shadow-none">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SaveStatus savedAt={savedAt} isSaving={isSaving} isSigned={isSigned} />
            {/* Descartar borrador — solo visible si la consulta está vacía y en draft */}
            {!isSigned && isEmpty && (
              <button
                type="button"
                onClick={() => setConfirmDiscard(true)}
                disabled={isSaving || isSigning || discard.isPending}
                className="text-xs text-gray-500 hover:text-red-600 underline decoration-dotted disabled:opacity-50"
                title="Solo disponible si no hay contenido escrito"
              >
                Descartar borrador
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isSigned ? (
              <>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={isSaving || isSigning}
                  className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
                >
                  {isSaving ? 'Guardando...' : 'Guardar borrador'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmSign(true)}
                  disabled={isSaving || isSigning}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
                >
                  Firmar consulta
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowCorrect(true)}
                  className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Corregir consulta
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Imprimir receta
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Modal confirmación de firma ─────────────────────── */}
      {confirmSign && (
        <ConfirmSignModal
          onConfirm={handleSign}
          onCancel={() => { setConfirmSign(false); setSignError(null); }}
          isSubmitting={isSigning || isSaving}
          errorMessage={signError}
        />
      )}

      {/* ─── Modal confirmación de descarte ──────────────────── */}
      {confirmDiscard && (
        <ConfirmDiscardModal
          onConfirm={handleDiscard}
          onCancel={() => setConfirmDiscard(false)}
          isSubmitting={discard.isPending}
        />
      )}

      {/* ─── Modal de corrección de consulta firmada (B2 — texto + receta) ──── */}
      {showCorrect && ctx && (
        <CorrectConsultationModal
          consultationId={ctx.id}
          appointmentId={appointmentId ?? ''}
          doctorId={ctx.doctor_id}
          initialText={{
            chief_complaint: ctx.chief_complaint ?? '',
            history_present_illness: ctx.history_present_illness ?? '',
            physical_exam: ctx.physical_exam ?? '',
            internal_analysis: ctx.internal_analysis ?? '',
            plan: ctx.plan ?? '',
          }}
          initialPrescriptions={prescriptions}
          onClose={() => setShowCorrect(false)}
        />
      )}
      </div>

      {/* ─── Layout impresión (solo visible al imprimir) ─────── */}
      <RecetaPrint ctx={ctx} prescriptions={prescriptions} />
    </>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none ' +
  'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed';

const textareaCls = inputCls + ' resize-y';

function ConsultaHeader({
  ctx,
  savedAt: _savedAt,
  onBack,
  readOnly,
}: {
  ctx: NonNullable<ReturnType<typeof useConsultationByAppointment>['data']>;
  savedAt: number | null;
  onBack: () => void;
  readOnly: boolean;
}) {
  const { patient, appointment } = ctx;
  const age = calculateAge(patient.date_of_birth);

  // Sticky para mantener identidad del paciente siempre visible (UX clínica crítica):
  //   - top-16 en mobile (debajo del header fijo del PanelLayout)
  //   - top-0 en md+ (no hay header fijo, sidebar a la izquierda)
  //   - bg-gray-50/95 + backdrop-blur para que el contenido detrás se vea difuminado
  //   - -mx-* extiende horizontalmente a los bordes de <main>
  //   - border-b sutil separa visualmente cuando está pegado
  return (
    <div className="sticky top-16 md:top-0 z-20 -mx-4 px-4 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 py-3 mb-4 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200/60">
      <button
        onClick={onBack}
        className="mb-2 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Volver
      </button>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg font-semibold flex-shrink-0">
            {getInitials(patient.full_name)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-gray-900 truncate">{patient.full_name}</h1>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-1">
              {age !== null && <span>{age} años</span>}
              <span className="capitalize">{patient.gender}</span>
              {patient.phone && (
                <a href={`tel:${patient.phone}`} className="text-emerald-700 hover:text-emerald-800">
                  {patient.phone}
                </a>
              )}
            </div>
            {appointment && (
              <p className="text-xs text-gray-400 mt-1">
                Cita: {formatTimestamp(appointment.start_time)}
              </p>
            )}
          </div>
        </div>

        <div className="flex-shrink-0">
          {readOnly ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
              Consulta firmada
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Borrador
            </span>
          )}
          {ctx.signed_at && (
            <p className="text-[10px] text-gray-400 mt-1 text-right">
              {formatTimestamp(ctx.signed_at)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {hint && <span className="text-gray-400 font-normal ml-1.5">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  unit,
  value,
  disabled,
  onChange,
  step,
  min,
  max,
  warningCheck,
}: {
  label: string;
  unit: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  step?: string;
  min?: number;
  max?: number;
  warningCheck?: (v: number) => string | null;
}) {
  const numValue = parseFloat(value);
  const warning = !isNaN(numValue) && warningCheck ? warningCheck(numValue) : null;
  const isOutOfHardRange =
    !isNaN(numValue) &&
    ((min !== undefined && numValue < min) || (max !== undefined && numValue > max));

  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-600 mb-1">
        {label} <span className="text-gray-400">({unit})</span>
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step ?? '1'}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} ${
          isOutOfHardRange || warning ? 'border-amber-300 focus:ring-amber-200 focus:border-amber-400' : ''
        }`}
      />
      {warning && (
        <p className="text-[11px] text-amber-700 mt-1 leading-tight flex items-start gap-1">
          <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
          </svg>
          {warning}
        </p>
      )}
    </label>
  );
}

// ─── Validadores fisiológicos ─────────────────────────────────────────
// Cubren rango pediátrico + adulto. No bloquean guardado, solo orientan.
const validators = {
  systolic: (v: number) => {
    if (v < 60) return 'PA sistólica muy baja — verificá';
    if (v > 250) return 'PA sistólica fuera de rango fisiológico';
    return null;
  },
  diastolic: (v: number) => {
    if (v < 30) return 'PA diastólica muy baja — verificá';
    if (v > 150) return 'PA diastólica fuera de rango fisiológico';
    return null;
  },
  heartRate: (v: number) => {
    if (v < 30) return 'FC muy baja — verificá';
    if (v > 220) return 'FC fuera de rango fisiológico';
    return null;
  },
  respiratoryRate: (v: number) => {
    if (v < 5) return 'FR muy baja — verificá';
    if (v > 60) return 'FR fuera de rango fisiológico';
    return null;
  },
  temperature: (v: number) => {
    if (v < 30) return 'Temperatura muy baja — verificá';
    if (v > 45) return 'Temperatura fuera de rango fisiológico';
    if (v > 60) return '¿Tal vez Fahrenheit? Esperamos °C';
    return null;
  },
  spo2: (v: number) => {
    if (v < 50) return 'SpO₂ muy baja — verificá';
    if (v > 100) return 'SpO₂ no puede exceder 100%';
    return null;
  },
  weightKg: (v: number) => {
    if (v < 1) return 'Peso muy bajo — verificá';
    if (v > 250) {
      // 250 kg ≈ 550 lb. Si está entre 100-250 podría ser libras.
      return '¿Tal vez ingresaste libras? Esperamos kg (1 lb ≈ 0.45 kg)';
    }
    return null;
  },
  heightCm: (v: number) => {
    if (v < 30) {
      // < 30 cm es imposible — probablemente metros
      return '¿Tal vez ingresaste metros? Esperamos cm (ej: 170)';
    }
    if (v > 230) return 'Talla muy alta — verificá';
    return null;
  },
};

function SaveStatus({
  savedAt,
  isSaving,
  isSigned,
}: {
  savedAt: number | null;
  isSaving: boolean;
  isSigned: boolean;
}) {
  if (isSigned) {
    return (
      <p className="text-xs text-emerald-700 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
        Consulta firmada — solo lectura
      </p>
    );
  }
  if (isSaving) {
    return (
      <p className="text-xs text-gray-500 flex items-center gap-1.5">
        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Guardando...
      </p>
    );
  }
  if (savedAt && Date.now() - savedAt < 5000) {
    return (
      <p className="text-xs text-emerald-700 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Guardado
      </p>
    );
  }
  return <p className="text-xs text-gray-400">Cambios sin guardar</p>;
}

function ConfirmDiscardModal({
  onConfirm,
  onCancel,
  isSubmitting,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Descartar borrador</h3>
            <p className="text-sm text-gray-600 mt-1">
              Vas a eliminar el borrador de esta consulta. Como está vacío,
              no se pierde información clínica. La acción quedará registrada
              en el log de auditoría.
            </p>
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50"
          >
            {isSubmitting ? 'Descartando...' : 'Sí, descartar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmSignModal({
  onConfirm,
  onCancel,
  isSubmitting,
  errorMessage,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  errorMessage?: string | null;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Firmar consulta</h3>
            <p className="text-sm text-gray-600 mt-1">
              Una vez firmada, la consulta queda <span className="font-semibold">inmutable</span>.
              No podrás modificar ningún campo. ¿Confirmas que la información está completa?
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs text-red-700">{errorMessage}</p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
          >
            {isSubmitting ? 'Firmando...' : 'Sí, firmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseVitalsForm(f: VitalsFormState): VitalsInput {
  const num = (s: string): number | null => {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };
  return {
    systolic_bp: num(f.systolic_bp),
    diastolic_bp: num(f.diastolic_bp),
    heart_rate: num(f.heart_rate),
    respiratory_rate: num(f.respiratory_rate),
    temperature: num(f.temperature),
    spo2: num(f.spo2),
    weight_kg: num(f.weight_kg),
    height_cm: num(f.height_cm),
  };
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('es-SV', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function bmiCategoryColor(cat: string): string {
  const map: Record<string, string> = {
    bajo_peso: 'text-blue-600',
    normal: 'text-emerald-700',
    sobrepeso: 'text-amber-600',
    obesidad_1: 'text-orange-600',
    obesidad_2: 'text-red-600',
    obesidad_3: 'text-red-700',
  };
  return map[cat] ?? 'text-gray-600';
}
