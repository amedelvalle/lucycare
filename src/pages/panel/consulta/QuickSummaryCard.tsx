import { useState } from 'react';
import { usePatientQuickSummary } from '@/hooks/usePatientQuickSummary';

/**
 * Tarjeta "Resumen rápido del paciente" (PR-2).
 *
 * Ayuda breve para que el médico entienda en <10s su historia clínica con este
 * paciente. SOLO LECTURA — consume el read model de PR-1 (`usePatientQuickSummary`).
 *
 * Reglas de seguridad (gate visual, sobre el gate de datos de PR-1):
 *  - Se muestra SOLO si `role === 'doctor'` (nunca asistente/admin/paciente/null).
 *    `doctorId` por sí solo NO es criterio (el asistente también lo trae).
 *  - Se muestra SOLO si `data.hasHistory === true` (sin historia → nada, sin ruido).
 *  - Ante error/carga técnica → no se muestra (nunca un error técnico al médico).
 *  - El read model ya scopea por paciente + médico + RLS + consultas firmadas y
 *    excluye la consulta actual: la tarjeta no mezcla pacientes/médicos/clínicas.
 */
export default function QuickSummaryCard({
  patientId,
  doctorId,
  role,
  currentConsultationId,
  patientName,
}: {
  patientId: string;
  doctorId: string | null;
  role: 'doctor' | 'assistant' | undefined;
  currentConsultationId?: string;
  patientName?: string;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const { data, isError, isLoading } = usePatientQuickSummary(
    patientId,
    doctorId,
    role,
    currentConsultationId,
  );

  // Gate visual: solo médico, solo con historia, nunca en error/carga.
  if (role !== 'doctor') return null;
  if (isLoading || isError || !data || !data.hasHistory) return null;

  const { relevantNotes: notes, lastVitals: v } = data;
  const who = patientName?.trim() ? patientName.trim() : 'este paciente';
  const veces = data.totalSignedVisits;

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
      <header className="mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0">
          ✦
        </span>
        <h2 className="text-base font-semibold text-gray-900">Resumen del paciente</h2>
      </header>

      {/* Frase de contexto + última atención */}
      <p className="text-sm text-gray-800">
        Has atendido a <span className="font-medium">{who}</span>{' '}
        <span className="font-medium">{veces}</span> {veces === 1 ? 'vez' : 'veces'}.
      </p>
      {data.lastSeenAt && (
        <p className="text-sm text-gray-600 mt-0.5">
          Última atención: <span className="text-gray-800">{fmtDate(data.lastSeenAt)}</span>
          {data.lastVisitReason && <> · {data.lastVisitReason}</>}
        </p>
      )}

      {/* Alergias — único color de alerta (amber) */}
      {notes.allergies && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-800">⚠ Alergias</p>
          <p className="text-sm text-amber-900 mt-0.5 break-words">{notes.allergies}</p>
        </div>
      )}

      {/* Diagnósticos previos */}
      {data.previousDiagnoses.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Diagnósticos previos</p>
          <div className="flex flex-wrap gap-1.5">
            {data.previousDiagnoses.map((dx) => (
              <span
                key={dx}
                className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-2.5 py-0.5 text-xs font-medium max-w-full break-words"
              >
                {dx}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Medicamentos permanentes / vigentes */}
      {data.permanentMedications.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Medicamentos vigentes</p>
          <div className="flex flex-wrap gap-1.5">
            {data.permanentMedications.map((m) => (
              <span
                key={m}
                className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 px-2.5 py-0.5 text-xs font-medium max-w-full break-words"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Datos relevantes: tipo de sangre, antecedente familiar, últimos vitales */}
      {(notes.bloodType || notes.familyHistory || v) && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {notes.bloodType && (
            <MiniFact label="Tipo de sangre" value={notes.bloodType} />
          )}
          {v && (
            <MiniFact label="Últimos vitales" value={vitalsLine(v)} />
          )}
          {notes.familyHistory && (
            <div className="sm:col-span-2">
              <MiniFact label="Antecedente familiar" value={notes.familyHistory} />
            </div>
          )}
        </div>
      )}

      {/* Ver últimas atenciones — colapsado por defecto, discreto */}
      {data.lastConsultationsBrief.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
          >
            {showHistory ? 'Ocultar últimas atenciones' : 'Ver últimas atenciones'}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-2">
              {data.lastConsultationsBrief.map((c) => (
                <li key={c.consultationId} className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">{fmtDate(c.signedAt)}</p>
                  {c.reason && <p className="text-sm text-gray-800 mt-0.5 break-words">{c.reason}</p>}
                  {c.diagnoses.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {c.diagnoses.map((dx) => (
                        <span
                          key={dx}
                          className="inline-flex items-center rounded-full bg-white border border-gray-200 text-gray-600 px-2 py-0.5 text-xs max-w-full break-words"
                        >
                          {dx}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5 break-words">{value}</p>
    </div>
  );
}

function vitalsLine(v: {
  weightLb: number | null;
  heightCm: number | null;
  bmi: number | null;
  bloodPressure: string | null;
}): string {
  const parts: string[] = [];
  if (v.bloodPressure) parts.push(`PA ${v.bloodPressure}`);
  if (v.weightLb != null) parts.push(`${v.weightLb} lb`);
  if (v.heightCm != null) parts.push(`${v.heightCm} cm`);
  if (v.bmi != null) parts.push(`IMC ${v.bmi}`);
  return parts.length ? parts.join(' · ') : '—';
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-SV', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
