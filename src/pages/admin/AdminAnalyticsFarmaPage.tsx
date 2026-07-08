import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getPharmaSummary,
  getPharmaMedicationRanking,
  getPharmaDoctorRanking,
  type PharmaSummary,
  type PharmaMedicationRow,
  type PharmaDoctorRow,
} from '../../services/adminPharma.service';

/**
 * Analytics Farma — inteligencia de prescripción por médico (LucyAdmin, PR-B).
 * READ-ONLY sobre las RPCs agregadas de s7_54 (admin_pharma_*). Capa estratégica
 * INTERNA: NO muestra pacientes, recetas individuales ni datos clínicos —
 * solo agregados (garantía server-side: las RPCs no devuelven PII).
 *
 * V1: rango de fechas + umbral min_count + KPI cards + 2 rankings (medicamento,
 * médico). Sin export ni gráficos.
 */

const RANKING_LIMIT = 20;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
// Default: últimos 12 meses (la prescripción es histórica y de bajo volumen).
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);
  return { from: isoDate(from), to: isoDate(to) };
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function SummaryView({ s }: { s: PharmaSummary }) {
  return (
    <SectionCard title="Resumen de prescripción" subtitle="Recetas firmadas (is_current) en el rango. Solo agregados — sin pacientes.">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Medicamentos prescritos" value={s.total_prescriptions} />
        <Stat label="Medicamentos únicos" value={s.unique_medications} />
        <Stat label="Médicos prescriptores" value={s.prescribing_doctors} />
        <Stat label="Consultas con receta" value={s.signed_consultations_with_meds} />
        <Stat label="Desde Base Lucy (global)" value={s.by_source.global} />
        <Stat label="Desde catálogo personal" value={s.by_source.personal} />
        <Stat label="Permanentes / crónicos" value={s.permanent} />
      </div>
    </SectionCard>
  );
}

function MedicationTable({ rows }: { rows: PharmaMedicationRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">Sin medicamentos que superen el umbral en el rango.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-3 font-medium">Medicamento</th>
            <th className="py-2 px-3 font-medium">Presentación</th>
            <th className="py-2 px-3 font-medium">Fuente</th>
            <th className="py-2 px-3 font-medium text-right">Veces</th>
            <th className="py-2 px-3 font-medium text-right">Consultas</th>
            <th className="py-2 pl-3 font-medium text-right">Médicos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.medicationId} className="border-b border-gray-100 last:border-0">
              <td className="py-2 pr-3">
                <div className="font-medium text-gray-900">{m.medicationName ?? '—'}</div>
                <div className="text-[11px] text-gray-400">
                  {[m.activeIngredient, m.concentration].filter(Boolean).join(' · ') || '—'}
                </div>
              </td>
              <td className="py-2 px-3 text-gray-600 capitalize">{m.presentation ?? '—'}</td>
              <td className="py-2 px-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${m.isGlobal ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                  {m.isGlobal ? 'Base Lucy' : 'Personal'}
                </span>
              </td>
              <td className="py-2 px-3 text-right font-semibold text-gray-900">{m.timesPrescribed}</td>
              <td className="py-2 px-3 text-right text-gray-700">{m.consultationsCount}</td>
              <td className="py-2 pl-3 text-right text-gray-700">{m.distinctDoctors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DoctorTable({ rows }: { rows: PharmaDoctorRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">Sin médicos que superen el umbral en el rango.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-3 font-medium">Médico</th>
            <th className="py-2 px-3 font-medium">Especialidad</th>
            <th className="py-2 px-3 font-medium text-right">Recetas</th>
            <th className="py-2 px-3 font-medium text-right">Únicos</th>
            <th className="py-2 px-3 font-medium text-right">Global</th>
            <th className="py-2 px-3 font-medium text-right">Personal</th>
            <th className="py-2 pl-3 font-medium text-right">Perman.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.doctorId} className="border-b border-gray-100 last:border-0">
              <td className="py-2 pr-3 font-medium text-gray-900">{d.doctorName ?? '—'}</td>
              <td className="py-2 px-3 text-gray-600">{d.specialtyName ?? '—'}</td>
              <td className="py-2 px-3 text-right font-semibold text-gray-900">{d.totalPrescriptions}</td>
              <td className="py-2 px-3 text-right text-gray-700">{d.uniqueMedications}</td>
              <td className="py-2 px-3 text-right text-gray-700">{d.globalCount}</td>
              <td className="py-2 px-3 text-right text-gray-700">{d.personalCount}</td>
              <td className="py-2 pl-3 text-right text-gray-700">{d.permanentCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminAnalyticsFarmaPage() {
  const initial = defaultRange();
  const [draftFrom, setDraftFrom] = useState(initial.from);
  const [draftTo, setDraftTo] = useState(initial.to);
  const [draftMinCount, setDraftMinCount] = useState(3);
  const [applied, setApplied] = useState<{ from: string; to: string; minCount: number }>({ ...initial, minCount: 3 });

  const filters = { dateFrom: applied.from, dateTo: applied.to, minCount: applied.minCount };

  const summaryQ = useQuery({
    queryKey: ['admin-pharma-summary', applied.from, applied.to],
    queryFn: () => getPharmaSummary({ dateFrom: applied.from, dateTo: applied.to }),
  });
  const medRankQ = useQuery({
    queryKey: ['admin-pharma-med-ranking', applied.from, applied.to, applied.minCount],
    queryFn: () => getPharmaMedicationRanking({ ...filters, limit: RANKING_LIMIT }),
  });
  const docRankQ = useQuery({
    queryKey: ['admin-pharma-doc-ranking', applied.from, applied.to, applied.minCount],
    queryFn: () => getPharmaDoctorRanking({ ...filters, limit: RANKING_LIMIT }),
  });

  const apply = () => {
    const swap = draftFrom && draftTo && draftFrom > draftTo;
    setApplied({
      from: swap ? draftTo : draftFrom,
      to: swap ? draftFrom : draftTo,
      minCount: Math.max(1, Number(draftMinCount) || 1),
    });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analítica de prescripción</h1>
          <p className="text-sm text-gray-500 mt-1">
            Inteligencia agregada de prescripción por médico (uso interno). Solo totales — sin pacientes
            ni recetas individuales.
          </p>
        </div>
        <Link to="/admin/analytics" className="text-sm text-emerald-700 hover:text-emerald-800 whitespace-nowrap">
          ← Analítica de conversión
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">Desde</span>
            <input
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(e) => setDraftFrom(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">Hasta</span>
            <input
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(e) => setDraftTo(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">Umbral mínimo (celda)</span>
            <input
              type="number"
              min={1}
              value={draftMinCount}
              onChange={(e) => setDraftMinCount(Number(e.target.value))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </label>
          <button
            type="button"
            onClick={apply}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
          >
            Aplicar
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Rango: {applied.from} → {applied.to} (inclusivo) · umbral ≥ {applied.minCount} en rankings.
          Por defecto, últimos 12 meses.
        </p>
      </div>

      {summaryQ.isLoading ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-500">Cargando métricas…</div>
      ) : summaryQ.error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          No se pudieron cargar las métricas: {summaryQ.error instanceof Error ? summaryQ.error.message : 'error'}
        </div>
      ) : summaryQ.data ? (
        <SummaryView s={summaryQ.data} />
      ) : null}

      <div className="mt-5">
        <SectionCard title="Ranking de medicamentos" subtitle={`Top ${RANKING_LIMIT} por veces prescrito (solo con volumen ≥ ${applied.minCount}).`}>
          {medRankQ.isLoading ? (
            <p className="text-sm text-gray-500 py-6 text-center">Cargando ranking…</p>
          ) : medRankQ.error ? (
            <p className="text-sm text-red-700 py-4">No se pudo cargar: {medRankQ.error instanceof Error ? medRankQ.error.message : 'error'}</p>
          ) : (
            <MedicationTable rows={medRankQ.data ?? []} />
          )}
        </SectionCard>
      </div>

      <div className="mt-5">
        <SectionCard title="Ranking por médico" subtitle={`Top ${RANKING_LIMIT} por volumen de prescripción (solo con volumen ≥ ${applied.minCount}).`}>
          {docRankQ.isLoading ? (
            <p className="text-sm text-gray-500 py-6 text-center">Cargando ranking…</p>
          ) : docRankQ.error ? (
            <p className="text-sm text-red-700 py-4">No se pudo cargar: {docRankQ.error instanceof Error ? docRankQ.error.message : 'error'}</p>
          ) : (
            <DoctorTable rows={docRankQ.data ?? []} />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
