import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getConversionSummary,
  getDoctorConversionRanking,
  type ConversionSummary,
  type DoctorConversionRow,
} from '../../services/adminConversion.service';

/**
 * Dashboard interno de conversiones (LucyAdmin) — Analytics Fase 3 PR-B.
 * READ-ONLY sobre las RPCs agregadas de s7_53 (admin_conversion_summary +
 * admin_doctor_conversion_ranking). Solo agregados: NO muestra pacientes,
 * teléfonos, emails, documentos, mensajes, comentarios ni datos clínicos —
 * la garantía es server-side (las RPCs no los devuelven).
 *
 * V1: rango de fechas + KPI cards + tabla de ranking. Sin gráficos ni export.
 */

const RANKING_LIMIT = 20;

// Rango por defecto: últimos 30 días (hoy inclusive).
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: isoDate(from), to: isoDate(to) };
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div>}
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

function SummaryView({ s }: { s: ConversionSummary }) {
  const b = s.bookings;
  const w = s.waitlist;
  const a = s.affiliations;
  const sup = s.supply;
  const r = s.reviews;
  return (
    <div className="space-y-5">
      <SectionCard title="Reservas" subtitle="Citas creadas en el rango, por origen y por estado.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total" value={b.total} />
          <Stat label="Desde directorio" value={b.by_source.lucy_directorio} />
          <Stat label="Manuales" value={b.by_source.manual} />
          <Stat label="Seguimiento" value={b.by_source.lucy_seguimiento} />
          <Stat label="Completadas" value={b.by_status.completadas} />
          <Stat label="Canceladas" value={b.by_status.canceladas} />
          <Stat label="No-show" value={b.by_status.no_show} />
          <Stat label="Pendientes / en curso" value={b.by_status.pendientes} />
        </div>
      </SectionCard>

      <SectionCard title="Conversión / actividad" subtitle="Lista de espera, afiliaciones, reclamos y reseñas en el rango.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Lista de espera" value={w.total} hint={`Pend. ${w.by_status.pending} · Cont. ${w.by_status.contacted} · Canc. ${w.by_status.cancelled}`} />
          <Stat label="Afiliaciones" value={a.total} hint={`Pend. ${a.by_status.pending} · Rev. ${a.by_status.in_review} · Aprob. ${a.by_status.approved} · Rech. ${a.by_status.rejected}`} />
          <Stat label="Reclamos de perfil" value={s.claims.total} />
          <Stat label="Reseñas" value={r.total} hint={`${r.visibles} visibles · promedio ${r.avg_rating ?? '—'}`} />
        </div>
      </SectionCard>

      <SectionCard title="Oferta médica" subtitle="Estado actual del directorio (no depende del rango de fechas).">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Médicos" value={sup.total_doctors} />
          <Stat label="Publicados" value={sup.published} />
          <Stat label="Con agenda" value={sup.with_agenda} />
          <Stat label="Verificados" value={sup.verified} />
          <Stat label="Listed only" value={sup.by_lucy_status.listed_only} />
          <Stat label="Reclamados" value={sup.by_lucy_status.claimed} />
        </div>
      </SectionCard>
    </div>
  );
}

function RankingTable({ rows }: { rows: DoctorConversionRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 py-6 text-center">Sin actividad de médicos en el rango seleccionado.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th className="py-2 pr-3 font-medium">Médico</th>
            <th className="py-2 px-3 font-medium">Especialidad</th>
            <th className="py-2 px-3 font-medium text-right">Reservas</th>
            <th className="py-2 px-3 font-medium text-right">Directorio</th>
            <th className="py-2 px-3 font-medium text-right">Lista de espera</th>
            <th className="py-2 px-3 font-medium text-right">Reseñas</th>
            <th className="py-2 pl-3 font-medium text-right">Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.doctorId} className="border-b border-gray-100 last:border-0">
              <td className="py-2 pr-3">
                <div className="font-medium text-gray-900">{d.doctorName ?? '—'}</div>
                {d.doctorSlug && <div className="text-[11px] text-gray-400">/{d.doctorSlug}</div>}
              </td>
              <td className="py-2 px-3 text-gray-600">{d.specialtyName ?? '—'}</td>
              <td className="py-2 px-3 text-right font-semibold text-gray-900">{d.bookingsTotal}</td>
              <td className="py-2 px-3 text-right text-gray-700">{d.bookingsDirectorio}</td>
              <td className="py-2 px-3 text-right text-gray-700">{d.waitlistTotal}</td>
              <td className="py-2 px-3 text-right text-gray-700">{d.reviewsTotal}</td>
              <td className="py-2 pl-3 text-right text-gray-700">{d.avgRating ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const initial = defaultRange();
  // Draft = lo que el usuario edita; applied = lo que dispara las queries.
  const [draftFrom, setDraftFrom] = useState(initial.from);
  const [draftTo, setDraftTo] = useState(initial.to);
  const [applied, setApplied] = useState<{ from: string; to: string }>(initial);

  const filters = { dateFrom: applied.from, dateTo: applied.to };

  const summaryQ = useQuery({
    queryKey: ['admin-conversion-summary', applied.from, applied.to],
    queryFn: () => getConversionSummary(filters),
  });
  const rankingQ = useQuery({
    queryKey: ['admin-conversion-ranking', applied.from, applied.to],
    queryFn: () => getDoctorConversionRanking({ ...filters, limit: RANKING_LIMIT }),
  });

  const apply = () => {
    if (draftFrom && draftTo && draftFrom > draftTo) {
      setApplied({ from: draftTo, to: draftFrom }); // tolerante: intercambia si están al revés
    } else {
      setApplied({ from: draftFrom, to: draftTo });
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Analítica de conversión</h1>
        <p className="text-sm text-gray-500 mt-1">
          Métricas agregadas del directorio (reservas, lista de espera, afiliaciones, reclamos y
          reseñas). Solo totales — sin datos de pacientes.
        </p>
      </div>

      {/* Filtro de rango */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
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
          <button
            type="button"
            onClick={apply}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
          >
            Aplicar
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Rango: {applied.from} → {applied.to} (inclusivo). Por defecto, últimos 30 días.
        </p>
      </div>

      {/* KPIs */}
      {summaryQ.isLoading ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-sm text-gray-500">Cargando métricas…</div>
      ) : summaryQ.error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          No se pudieron cargar las métricas: {summaryQ.error instanceof Error ? summaryQ.error.message : 'error'}
        </div>
      ) : summaryQ.data ? (
        <SummaryView s={summaryQ.data} />
      ) : null}

      {/* Ranking */}
      <div className="mt-5">
        <SectionCard title="Ranking de médicos" subtitle={`Top ${RANKING_LIMIT} por reservas en el rango. Solo médicos con actividad.`}>
          {rankingQ.isLoading ? (
            <p className="text-sm text-gray-500 py-6 text-center">Cargando ranking…</p>
          ) : rankingQ.error ? (
            <p className="text-sm text-red-700 py-4">
              No se pudo cargar el ranking: {rankingQ.error instanceof Error ? rankingQ.error.message : 'error'}
            </p>
          ) : (
            <RankingTable rows={rankingQ.data ?? []} />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
