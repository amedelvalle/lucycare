import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSessionWithTimeout } from '../../lib/session';
import {
  listMergeCandidates,
  mergePatientsPreflight,
  listPatientMerges,
  mergeBlockMessage,
  type MergeCandidateGroup,
  type MergeCandidatePatient,
  type MergePreflight,
} from '../../services/patientMerge.service';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-SV', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('es-SV', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch { return iso; }
}
const GENDER_LABEL: Record<string, string> = { masculino: 'M', femenino: 'F', otro: 'Otro' };

function LinkBadge({ confirmedAt }: { confirmedAt: string | null }) {
  return confirmedAt ? (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800">Confirmada</span>
  ) : (
    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">Sin confirmar</span>
  );
}

/** Fila compacta de una ficha dentro de un grupo. */
function PatientRow({ p }: { p: MergeCandidatePatient }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-medium text-gray-900">{p.fullName || '(sin nombre)'}</span>
        <LinkBadge confirmedAt={p.linkConfirmedAt} />
      </div>
      <div className="text-xs text-gray-600 space-y-0.5">
        <div>Doc: {p.documentNumber ? `${p.documentType} ${p.documentNumber}` : '— sin documento'}</div>
        <div>Nac: {formatDate(p.dateOfBirth)} · {GENDER_LABEL[p.gender ?? ''] ?? p.gender ?? '—'} · Tel: {p.phone || '—'}</div>
        <div>Creada: {formatDateTime(p.createdAt)}</div>
        <div className="flex gap-3 mt-1 text-gray-700">
          <span><b>{p.counts.appointments}</b> citas</span>
          <span><b>{p.counts.consultations}</b> consultas</span>
          <span><b>{p.counts.vitals}</b> vitales</span>
        </div>
      </div>
    </div>
  );
}

interface Analysis {
  group: MergeCandidateGroup;
  sourceId: string;
  targetId: string;
}

export default function AdminPacientesPage() {
  // Gate de auth-ready (mismo patrón que AdminLayout): el primer fetch con sesión.
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tok = await getSessionWithTimeout(3000);
      if (!cancelled && tok) setAuthReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const candidatesQ = useQuery({
    queryKey: ['admin-merge-candidates'],
    queryFn: listMergeCandidates,
    enabled: authReady,
    staleTime: 30_000,
  });
  const historyQ = useQuery({
    queryKey: ['admin-merge-history'],
    queryFn: listPatientMerges,
    enabled: authReady,
    staleTime: 30_000,
  });

  const groups = candidatesQ.data ?? [];

  // Estado de análisis (modal de preflight). Read-only en PR A.
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [preflight, setPreflight] = useState<MergePreflight | null>(null);
  const [preLoading, setPreLoading] = useState(false);
  const [preError, setPreError] = useState<string | null>(null);

  const runPreflight = async (sourceId: string, targetId: string) => {
    setPreLoading(true); setPreError(null); setPreflight(null);
    try {
      const r = await mergePatientsPreflight(sourceId, targetId);
      setPreflight(r);
    } catch (e: unknown) {
      setPreError(e instanceof Error ? e.message : 'Error al analizar el par');
    } finally {
      setPreLoading(false);
    }
  };

  const openAnalysis = (group: MergeCandidateGroup, sourceId: string, targetId: string) => {
    setAnalysis({ group, sourceId, targetId });
    runPreflight(sourceId, targetId);
  };
  const swap = () => {
    if (!analysis) return;
    const next = { ...analysis, sourceId: analysis.targetId, targetId: analysis.sourceId };
    setAnalysis(next);
    runPreflight(next.sourceId, next.targetId);
  };
  const close = () => { setAnalysis(null); setPreflight(null); setPreError(null); };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pacientes — Fusión de fichas</h1>
        <p className="text-sm text-gray-600 mt-1">
          Fichas duplicadas de la <b>misma persona</b> (mismo perfil Lucy) dentro de una clínica.
          Esta es una <b>vista previa</b>: podés analizar pares con el dry-run, pero la fusión
          todavía no se ejecuta desde aquí.
        </p>
      </div>

      {/* ─── Grupos candidatos ─── */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Grupos candidatos</h2>

        {!authReady || candidatesQ.isLoading ? (
          <div className="text-sm text-gray-500 py-8 text-center">Cargando…</div>
        ) : candidatesQ.isError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            No se pudieron cargar los candidatos.
            <button onClick={() => candidatesQ.refetch()} className="ml-2 underline font-medium">Reintentar</button>
          </div>
        ) : groups.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <i className="ri-checkbox-multiple-line text-4xl text-gray-300" />
            <p className="text-sm text-gray-600 mt-2">No hay grupos de fichas duplicadas para fusionar.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <GroupCard key={`${g.clinicId}:${g.profileId}`} group={g} onAnalyze={openAnalysis} />
            ))}
          </div>
        )}
      </section>

      {/* ─── Historial ─── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Historial de fusiones</h2>
        {historyQ.isLoading ? (
          <div className="text-sm text-gray-500 py-4">Cargando…</div>
        ) : (historyQ.data ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">Todavía no se registraron fusiones.</p>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Fecha</th>
                  <th className="text-left font-medium px-4 py-2">Fuente → Destino</th>
                  <th className="text-left font-medium px-4 py-2">Evidencia</th>
                  <th className="text-left font-medium px-4 py-2">Movido</th>
                  <th className="text-left font-medium px-4 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {(historyQ.data ?? []).map((m) => (
                  <tr key={m.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                    <td className="px-4 py-2 text-gray-900">{m.sourceName || '—'} → {m.targetName || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{m.evidenceType ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                      {m.movedCounts.appointments}c · {m.movedCounts.consultations}co · {m.movedCounts.vitals}v
                    </td>
                    <td className="px-4 py-2 text-gray-600">{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Modal de análisis (preflight, read-only) ─── */}
      {analysis && (
        <PreflightModal
          loading={preLoading}
          error={preError}
          preflight={preflight}
          onSwap={swap}
          onClose={close}
        />
      )}
    </div>
  );
}

/** Tarjeta de un grupo: fichas + selección fuente/destino + "Analizar". */
function GroupCard({
  group,
  onAnalyze,
}: {
  group: MergeCandidateGroup;
  onAnalyze: (g: MergeCandidateGroup, sourceId: string, targetId: string) => void;
}) {
  // Sugerencia de destino: la de más historial (luego más antigua).
  const suggestedTarget = useMemo(() => {
    const sorted = [...group.patients].sort((a, b) => {
      const ha = a.counts.appointments + a.counts.consultations + a.counts.vitals;
      const hb = b.counts.appointments + b.counts.consultations + b.counts.vitals;
      if (hb !== ha) return hb - ha;
      return a.createdAt.localeCompare(b.createdAt);
    });
    return sorted[0]?.id ?? '';
  }, [group.patients]);

  const [targetId, setTargetId] = useState(suggestedTarget);
  const [sourceId, setSourceId] = useState(
    group.patients.find((p) => p.id !== suggestedTarget)?.id ?? '',
  );

  const canAnalyze = sourceId && targetId && sourceId !== targetId;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-semibold text-gray-900">{group.profileFullName || '(perfil sin nombre)'}</span>
        <span className="text-sm text-gray-500">· {group.clinicName || 'clínica'}</span>
        <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
          {group.patientCount} fichas
        </span>
        {group.hasUnconfirmedLinks && (
          <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
            <i className="ri-error-warning-line mr-1" />
            {group.unconfirmedLinksCount} sin confirmar
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {group.patients.map((p) => <PatientRow key={p.id} p={p} />)}
      </div>

      <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-gray-100">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Fuente (se desactiva)</label>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {group.patients.map((p) => (
              <option key={p.id} value={p.id}>{p.fullName || p.id.slice(0, 8)}</option>
            ))}
          </select>
        </div>
        <div className="text-gray-400 pb-2">→</div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Destino (conserva historia)</label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {group.patients.map((p) => (
              <option key={p.id} value={p.id}>{p.fullName || p.id.slice(0, 8)}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => onAnalyze(group, sourceId, targetId)}
          disabled={!canAnalyze}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Analizar fusión
        </button>
      </div>
    </div>
  );
}

/** Modal read-only: corre el preflight y muestra comparación + veredicto. */
function PreflightModal({
  loading, error, preflight, onSwap, onClose,
}: {
  loading: boolean;
  error: string | null;
  preflight: MergePreflight | null;
  onSwap: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Análisis de fusión (vista previa)</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full">
            <i className="ri-close-line text-xl text-gray-700" />
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center">
            <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-sm text-gray-500">Analizando par…</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        ) : preflight ? (
          <>
            {/* Veredicto */}
            {preflight.eligible ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-semibold text-emerald-900">
                  <i className="ri-checkbox-circle-line mr-1" />Elegible para fusión
                </p>
                <p className="text-xs text-emerald-700 mt-1">
                  Evidencia: {preflight.evidence.type}. La fusión real se habilitará en una versión próxima.
                </p>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-semibold text-red-900">
                  <i className="ri-close-circle-line mr-1" />No elegible
                  {preflight.blockCode ? ` (${preflight.blockCode})` : ''}
                </p>
                <p className="text-xs text-red-700 mt-1">{mergeBlockMessage(preflight.blockCode, preflight.blockReason)}</p>
              </div>
            )}

            {/* Warnings */}
            {preflight.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 space-y-1">
                {preflight.warnings.map((w) => (
                  <p key={w.code} className="text-xs text-amber-800"><i className="ri-error-warning-line mr-1" />{w.message}</p>
                ))}
              </div>
            )}

            {/* Comparación fuente → destino */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <SideCard title="Fuente · se desactiva" tone="red" side={preflight.source} />
              <SideCard title="Destino · conserva historia" tone="emerald" side={preflight.target} />
            </div>

            {/* Conteos a mover */}
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 mb-4">
              <p className="font-medium mb-1">Se moverían de la fuente al destino:</p>
              <div className="flex gap-4 text-gray-700">
                <span><b>{preflight.counts.appointments}</b> citas</span>
                <span><b>{preflight.counts.consultationsSigned}</b> consultas firmadas</span>
                <span><b>{preflight.counts.consultationsDraft}</b> borradores</span>
                <span><b>{preflight.counts.vitals}</b> vitales</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button onClick={onSwap} className="text-sm text-emerald-700 font-medium hover:underline">
                <i className="ri-swap-line mr-1" />Intercambiar fuente/destino
              </button>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
                Cerrar
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SideCard({ title, tone, side }: { title: string; tone: 'red' | 'emerald'; side: MergePreflight['source'] }) {
  const border = tone === 'red' ? 'border-red-200' : 'border-emerald-200';
  const head = tone === 'red' ? 'text-red-800' : 'text-emerald-800';
  return (
    <div className={`rounded-lg border ${border} p-3`}>
      <p className={`text-xs font-semibold ${head} mb-2`}>{title}</p>
      <p className="text-sm font-medium text-gray-900">{side.fullName || '(sin nombre)'}</p>
      <div className="text-xs text-gray-600 mt-1 space-y-0.5">
        <div>{side.documentNumber ? `${side.documentType} ${side.documentNumber}` : 'sin documento'}</div>
        <div>Nac: {formatDate(side.dateOfBirth)} · {GENDER_LABEL[side.gender ?? ''] ?? side.gender ?? '—'}</div>
        <div>Tel: {side.phone || '—'}</div>
        <div className="flex items-center gap-2 mt-1">
          <span>{side.linked ? 'Vinculada' : 'Sin vincular'}</span>
          {side.linked && <LinkBadge confirmedAt={side.linkConfirmedAt} />}
        </div>
      </div>
    </div>
  );
}
