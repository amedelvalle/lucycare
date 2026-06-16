import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSessionWithTimeout } from '../../lib/session';
import {
  listMergeCandidates,
  mergePatientsPreflight,
  mergePatients,
  listPatientMerges,
  mergeBlockMessage,
  unmergePatientsPreflight,
  unmergePatients,
  unmergeBlockMessage,
  listLinkRejections,
  resolveLinkRejection,
  reopenLinkRejection,
  linkRejectionBlockMessage,
  type MergeCandidateGroup,
  type MergeCandidatePatient,
  type MergePreflight,
  type MergeResult,
  type MergeLogEntry,
  type UnmergePreflight,
  type UnmergeResult,
  type LinkRejection,
} from '../../services/patientMerge.service';

/** Frase exacta que el admin debe teclear para confirmar la fusión (acción destructiva). */
const CONFIRM_PHRASE = 'FUSIONAR FICHAS';
/** Frase exacta para confirmar la reversa de una fusión (con tilde en la Ó). */
const CONFIRM_PHRASE_UNMERGE = 'DESHACER FUSIÓN';

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

  const queryClient = useQueryClient();

  // Estado de análisis (modal de preflight).
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [preflight, setPreflight] = useState<MergePreflight | null>(null);
  const [preLoading, setPreLoading] = useState(false);
  const [preError, setPreError] = useState<string | null>(null);

  // Estado del merge real (acción destructiva). Los bloqueos llegan con error.code (P006x).
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);
  const [mergeError, setMergeError] = useState<{ code: string | null; message: string } | null>(null);

  const mergeMut = useMutation({
    mutationFn: (v: { sourceId: string; targetId: string; reason: string }) =>
      mergePatients(v.sourceId, v.targetId, v.reason),
    onSuccess: (res) => {
      setMergeResult(res);
      setMergeError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-merge-candidates'] });
      queryClient.invalidateQueries({ queryKey: ['admin-merge-history'] });
    },
    onError: (e: unknown) => {
      const code = (e as { code?: string })?.code ?? null;
      setMergeError({ code, message: e instanceof Error ? e.message : 'Error al fusionar fichas' });
    },
  });

  const resetMerge = () => { setMergeResult(null); setMergeError(null); mergeMut.reset(); };

  const runPreflight = async (sourceId: string, targetId: string) => {
    setPreLoading(true); setPreError(null); setPreflight(null); resetMerge();
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
    if (!analysis || mergeMut.isPending) return;
    const next = { ...analysis, sourceId: analysis.targetId, targetId: analysis.sourceId };
    setAnalysis(next);
    runPreflight(next.sourceId, next.targetId);
  };
  const confirmMerge = (reason: string) => {
    if (!analysis || mergeMut.isPending) return;
    setMergeResult(null); setMergeError(null);
    mergeMut.mutate({ sourceId: analysis.sourceId, targetId: analysis.targetId, reason });
  };
  const close = () => { setAnalysis(null); setPreflight(null); setPreError(null); resetMerge(); };

  // ── Estado de la reversa (unmerge) desde el historial ──
  const [unmergeTarget, setUnmergeTarget] = useState<MergeLogEntry | null>(null);
  const [unmergeResult, setUnmergeResult] = useState<UnmergeResult | null>(null);
  const [unmergeError, setUnmergeError] = useState<{ code: string | null; message: string } | null>(null);

  const unmergeMut = useMutation({
    mutationFn: (v: { mergeLogId: string; reason: string }) => unmergePatients(v.mergeLogId, v.reason),
    onSuccess: (res) => {
      setUnmergeResult(res);
      setUnmergeError(null);
      // La fuente restaurada reaparece como ficha viva → refrescar historial y candidatos.
      queryClient.invalidateQueries({ queryKey: ['admin-merge-history'] });
      queryClient.invalidateQueries({ queryKey: ['admin-merge-candidates'] });
    },
    onError: (e: unknown) => {
      const code = (e as { code?: string })?.code ?? null;
      setUnmergeError({ code, message: e instanceof Error ? e.message : 'Error al revertir la fusión' });
    },
  });

  const openUnmerge = (m: MergeLogEntry) => {
    setUnmergeResult(null); setUnmergeError(null); unmergeMut.reset();
    setUnmergeTarget(m);
  };
  const confirmUnmerge = (reason: string) => {
    if (!unmergeTarget || unmergeMut.isPending) return;
    setUnmergeResult(null); setUnmergeError(null);
    unmergeMut.mutate({ mergeLogId: unmergeTarget.id, reason });
  };
  const closeUnmerge = () => {
    setUnmergeTarget(null); setUnmergeResult(null); setUnmergeError(null); unmergeMut.reset();
  };

  // ── Bandeja de vínculos rechazados (F4-3b) ──
  const [rejFilter, setRejFilter] = useState<'pending_review' | 'resolved' | 'all'>('pending_review');
  const rejectionsQ = useQuery({
    queryKey: ['admin-link-rejections', rejFilter],
    queryFn: () => listLinkRejections(rejFilter === 'all' ? undefined : rejFilter),
    enabled: authReady,
    staleTime: 30_000,
  });

  const [resolveTarget, setResolveTarget] = useState<LinkRejection | null>(null);
  const [rejActionError, setRejActionError] = useState<{ code: string | null; message: string } | null>(null);

  const resolveMut = useMutation({
    mutationFn: (v: { id: string; note: string }) => resolveLinkRejection(v.id, v.note),
    onSuccess: () => {
      setResolveTarget(null);
      setRejActionError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-link-rejections'] });
    },
    onError: (e: unknown) => {
      const code = (e as { code?: string })?.code ?? null;
      setRejActionError({ code, message: e instanceof Error ? e.message : 'Error al resolver el rechazo' });
    },
  });
  const reopenMut = useMutation({
    mutationFn: (id: string) => reopenLinkRejection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-link-rejections'] }),
  });

  const openResolve = (r: LinkRejection) => { setRejActionError(null); resolveMut.reset(); setResolveTarget(r); };
  const closeResolve = () => { if (!resolveMut.isPending) { setResolveTarget(null); setRejActionError(null); } };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pacientes — Fusión de fichas</h1>
        <p className="text-sm text-gray-600 mt-1">
          Fichas duplicadas de la <b>misma persona</b> (mismo perfil Lucy) dentro de una clínica.
          Analizá el par con el dry-run y, si es elegible, fusionalas con motivo y confirmación
          explícita. La ficha fuente se desactiva y su historia pasa al destino.
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
                  <th className="text-left font-medium px-4 py-2">Acción</th>
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
                    <td className="px-4 py-2 whitespace-nowrap">
                      {m.unmergedAt ? (
                        <span
                          className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600"
                          title={`Revertida el ${formatDateTime(m.unmergedAt)}`}
                        >
                          Revertida
                        </span>
                      ) : (
                        <button
                          onClick={() => openUnmerge(m)}
                          className="text-sm font-medium text-red-700 hover:text-red-800 hover:underline"
                        >
                          <i className="ri-arrow-go-back-line mr-1" />Deshacer fusión
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Vínculos rechazados (F4-3b) ─── */}
      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Vínculos rechazados</h2>
          <div className="flex gap-1">
            {([['pending_review', 'Pendientes'], ['resolved', 'Resueltos'], ['all', 'Todos']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setRejFilter(val)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium ${rejFilter === val ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Fichas que un paciente marcó como "no son mías" (B2). <b>Resolver</b> = revisado
          administrativamente: no re-vincula la ficha, no fusiona ni cambia datos del paciente.
          La fila sigue impidiendo el re-vínculo automático de ese par.
        </p>

        {!authReady || rejectionsQ.isLoading ? (
          <div className="text-sm text-gray-500 py-4">Cargando…</div>
        ) : rejectionsQ.isError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            No se pudieron cargar los vínculos rechazados.
            <button onClick={() => rejectionsQ.refetch()} className="ml-2 underline font-medium">Reintentar</button>
          </div>
        ) : (rejectionsQ.data ?? []).length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <i className="ri-shield-check-line text-4xl text-gray-300" />
            <p className="text-sm text-gray-600 mt-2">
              {rejFilter === 'resolved' ? 'No hay rechazos resueltos.' : rejFilter === 'all' ? 'No hay vínculos rechazados.' : 'No hay rechazos pendientes de revisión.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Ficha</th>
                  <th className="text-left font-medium px-4 py-2">Clínica</th>
                  <th className="text-left font-medium px-4 py-2">Rechazó</th>
                  <th className="text-left font-medium px-4 py-2">Teléfono</th>
                  <th className="text-left font-medium px-4 py-2">Rechazado</th>
                  <th className="text-left font-medium px-4 py-2">Estado</th>
                  <th className="text-left font-medium px-4 py-2">Ficha hoy</th>
                  <th className="text-left font-medium px-4 py-2">Acción</th>
                </tr>
              </thead>
              <tbody>
                {(rejectionsQ.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-2 text-gray-900">{r.patient.fullName || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.patient.clinicName || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.rejectedBy.fullName || '(sin nombre)'}</td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{r.phoneNormalized || '—'}</td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatDateTime(r.rejectedAt)}</td>
                    <td className="px-4 py-2"><RejStatusBadge status={r.status} /></td>
                    <td className="px-4 py-2"><FichaEstado p={r.patient} /></td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.status === 'pending_review' ? (
                        <button onClick={() => openResolve(r)} className="text-sm font-medium text-emerald-700 hover:underline">
                          Resolver
                        </button>
                      ) : (
                        <div className="space-y-1">
                          {r.resolutionNote && (
                            <div className="text-xs text-gray-500 max-w-[16rem] truncate" title={r.resolutionNote}>“{r.resolutionNote}”</div>
                          )}
                          <button onClick={() => reopenMut.mutate(r.id)} disabled={reopenMut.isPending}
                            className="text-sm font-medium text-gray-600 hover:underline disabled:opacity-40">
                            <i className="ri-arrow-go-back-line mr-1" />Reabrir
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Modal de análisis (preflight) + confirmación + fusión ─── */}
      {analysis && (
        <PreflightModal
          loading={preLoading}
          error={preError}
          preflight={preflight}
          onSwap={swap}
          onClose={close}
          onConfirmMerge={confirmMerge}
          merging={mergeMut.isPending}
          mergeResult={mergeResult}
          mergeError={mergeError}
        />
      )}

      {/* ─── Modal de reversa (unmerge) desde el historial ─── */}
      {unmergeTarget && (
        <UnmergeModal
          entry={unmergeTarget}
          onClose={closeUnmerge}
          onConfirm={confirmUnmerge}
          reverting={unmergeMut.isPending}
          result={unmergeResult}
          error={unmergeError}
        />
      )}

      {/* ─── Modal de resolución de un vínculo rechazado ─── */}
      {resolveTarget && (
        <ResolveRejectionModal
          rejection={resolveTarget}
          onClose={closeResolve}
          onConfirm={(note) => resolveMut.mutate({ id: resolveTarget.id, note })}
          submitting={resolveMut.isPending}
          error={rejActionError}
        />
      )}
    </div>
  );
}

/** Badge de estado del rechazo. */
function RejStatusBadge({ status }: { status: string }) {
  return status === 'resolved' ? (
    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">Resuelto</span>
  ) : (
    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">Pendiente</span>
  );
}

/** Estado ACTUAL de la ficha (puede haber cambiado desde el rechazo). */
function FichaEstado({ p }: { p: LinkRejection['patient'] }) {
  let label: string;
  let cls: string;
  if (p.mergedIntoPatientId) { label = 'Fusionada'; cls = 'bg-purple-100 text-purple-800'; }
  else if (!p.isActive) { label = 'Inactiva'; cls = 'bg-gray-100 text-gray-600'; }
  else if (p.profileId === null) { label = 'Desvinculada'; cls = 'bg-blue-100 text-blue-800'; }
  else { label = 'Re-vinculada'; cls = 'bg-emerald-100 text-emerald-800'; }
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

/** Modal: resolver un rechazo (bookkeeping). Motivo obligatorio ≥10; no destructivo. */
function ResolveRejectionModal({
  rejection, onClose, onConfirm, submitting, error,
}: {
  rejection: LinkRejection;
  onClose: () => void;
  onConfirm: (note: string) => void;
  submitting: boolean;
  error: { code: string | null; message: string } | null;
}) {
  const [note, setNote] = useState('');

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose, submitting]);

  const noteOk = note.trim().length >= 10;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Resolver rechazo</h3>
          <button onClick={onClose} disabled={submitting} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full disabled:opacity-40 disabled:cursor-not-allowed">
            <i className="ri-close-line text-xl text-gray-700" />
          </button>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 mb-4">
          <p><b>{rejection.patient.fullName || '—'}</b> <span className="text-gray-400">· {rejection.patient.clinicName || 'clínica'}</span></p>
          <p className="text-xs text-gray-500 mt-1">Rechazada por {rejection.rejectedBy.fullName || '(sin nombre)'} · tel {rejection.phoneNormalized || '—'}</p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 mb-4">
          <i className="ri-information-line mr-1" />
          Resolver es <b>revisado administrativamente</b>: <b>no</b> re-vincula la ficha, <b>no</b> fusiona y
          <b> no</b> cambia datos del paciente. La fila sigue impidiendo el re-vínculo automático de este par.
        </div>

        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Motivo de la resolución</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            disabled={submitting}
            placeholder="Qué revisaste y por qué se cierra…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
          />
          {!noteOk && <p className="text-xs text-amber-600 mt-1">El motivo es obligatorio (mínimo 10 caracteres).</p>}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-3">
            {linkRejectionBlockMessage(error.code, error.message)}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(note.trim())}
            disabled={!noteOk || submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {submitting ? 'Resolviendo…' : 'Marcar como revisado'}
          </button>
        </div>
      </div>
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

/** Modal: preflight (read-only) → confirmación reforzada → resultado de la fusión. */
function PreflightModal({
  loading, error, preflight, onSwap, onClose, onConfirmMerge, merging, mergeResult, mergeError,
}: {
  loading: boolean;
  error: string | null;
  preflight: MergePreflight | null;
  onSwap: () => void;
  onClose: () => void;
  onConfirmMerge: (reason: string) => void;
  merging: boolean;
  mergeResult: MergeResult | null;
  mergeError: { code: string | null; message: string } | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');

  // No cerrar al click-outside ni durante el submit. Cierra solo por X / Escape / éxito.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !merging) onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose, merging]);

  const reasonOk = reason.trim().length >= 10;
  const phraseOk = phrase === CONFIRM_PHRASE;
  const canConfirm = reasonOk && phraseOk && !merging;

  const title = mergeResult
    ? 'Fusión completada'
    : confirming
      ? 'Confirmar fusión'
      : 'Análisis de fusión (vista previa)';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            disabled={merging}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <i className="ri-close-line text-xl text-gray-700" />
          </button>
        </div>

        {mergeResult ? (
          <MergeSuccess preflight={preflight} result={mergeResult} onClose={onClose} />
        ) : loading ? (
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
                <p className="text-xs text-emerald-700 mt-1">Evidencia: {preflight.evidence.type}.</p>
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

            {confirming && preflight.eligible ? (
              /* ── Paso de confirmación reforzada ── */
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                  <i className="ri-alert-line mr-1" />
                  Esta acción es <b>destructiva y no se puede deshacer desde esta herramienta</b>:
                  mueve el expediente al destino y desactiva la ficha fuente.
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Motivo de la fusión</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    disabled={merging}
                    placeholder="Por qué estas dos fichas son la misma persona…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                  />
                  {!reasonOk && (
                    <p className="text-xs text-amber-600 mt-1">El motivo es obligatorio (mínimo 10 caracteres).</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Escribí <span className="font-mono font-semibold text-gray-900">{CONFIRM_PHRASE}</span> para confirmar
                  </label>
                  <input
                    type="text"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    disabled={merging}
                    autoComplete="off"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                  />
                </div>

                {mergeError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {mergeBlockMessage(mergeError.code, mergeError.message)}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => { if (!merging) { setConfirming(false); setPhrase(''); } }}
                    disabled={merging}
                    className="text-sm text-gray-600 font-medium hover:underline disabled:opacity-40"
                  >
                    Volver
                  </button>
                  <button
                    onClick={() => onConfirmMerge(reason.trim())}
                    disabled={!canConfirm}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {merging ? 'Fusionando…' : 'Confirmar fusión'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button onClick={onSwap} className="text-sm text-emerald-700 font-medium hover:underline">
                  <i className="ri-swap-line mr-1" />Intercambiar fuente/destino
                </button>
                <div className="flex gap-2">
                  <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
                    Cerrar
                  </button>
                  {preflight.eligible && (
                    <button
                      onClick={() => setConfirming(true)}
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700"
                    >
                      Fusionar fichas
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Vista de éxito tras la fusión: source/target, merge_log_id y conteos movidos. */
function MergeSuccess({
  preflight, result, onClose,
}: {
  preflight: MergePreflight | null;
  result: MergeResult;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
        <p className="text-sm font-semibold text-emerald-900">
          <i className="ri-checkbox-circle-line mr-1" />Fichas fusionadas
        </p>
        <p className="text-xs text-emerald-700 mt-1">
          La ficha fuente quedó desactivada; el expediente está en el destino.
        </p>
      </div>

      <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 space-y-1">
        <div>
          <span className="text-gray-500">Fuente:</span>{' '}
          <b>{preflight?.source.fullName || '—'}</b>{' '}
          <span className="text-xs text-gray-400">({result.sourceId.slice(0, 8)})</span>
        </div>
        <div>
          <span className="text-gray-500">Destino:</span>{' '}
          <b>{preflight?.target.fullName || '—'}</b>{' '}
          <span className="text-xs text-gray-400">({result.targetId.slice(0, 8)})</span>
        </div>
        <div>
          <span className="text-gray-500">Registro de fusión:</span>{' '}
          <span className="font-mono text-xs text-gray-700">{result.mergeLogId}</span>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700">
        <p className="font-medium mb-1">Movido al destino:</p>
        <div className="flex gap-4">
          <span><b>{result.movedCounts.appointments}</b> citas</span>
          <span><b>{result.movedCounts.consultations}</b> consultas</span>
          <span><b>{result.movedCounts.vitals}</b> vitales</span>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800">
          Cerrar
        </button>
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

/**
 * Modal de reversa: corre el preflight de unmerge (la autoridad real, aunque la
 * fila se muestre por `unmerged_at IS NULL`) → confirmación reforzada → resultado.
 */
function UnmergeModal({
  entry, onClose, onConfirm, reverting, result, error,
}: {
  entry: MergeLogEntry;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  reverting: boolean;
  result: UnmergeResult | null;
  error: { code: string | null; message: string } | null;
}) {
  const [preflight, setPreflight] = useState<UnmergePreflight | null>(null);
  const [preLoading, setPreLoading] = useState(true);
  const [preError, setPreError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [phrase, setPhrase] = useState('');

  // Preflight al abrir. Si bloquea (P0070–P0077), no se permite confirmar.
  useEffect(() => {
    let cancelled = false;
    setPreLoading(true); setPreError(null); setPreflight(null);
    unmergePatientsPreflight(entry.id)
      .then((r) => { if (!cancelled) setPreflight(r); })
      .catch((e: unknown) => { if (!cancelled) setPreError(e instanceof Error ? e.message : 'Error al analizar la reversa'); })
      .finally(() => { if (!cancelled) setPreLoading(false); });
    return () => { cancelled = true; };
  }, [entry.id]);

  // No cerrar al click-outside ni durante el submit. Cierra solo por X / Escape / éxito.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !reverting) onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose, reverting]);

  const reasonOk = reason.trim().length >= 10;
  const phraseOk = phrase === CONFIRM_PHRASE_UNMERGE;
  const canConfirm = reasonOk && phraseOk && !reverting;

  const title = result
    ? 'Fusión revertida'
    : confirming
      ? 'Confirmar reversa'
      : 'Deshacer fusión (vista previa)';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            disabled={reverting}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <i className="ri-close-line text-xl text-gray-700" />
          </button>
        </div>

        {result ? (
          <UnmergeSuccess entry={entry} result={result} onClose={onClose} />
        ) : preLoading ? (
          <div className="py-10 text-center">
            <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-sm text-gray-500">Analizando la reversa…</p>
          </div>
        ) : preError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{preError}</div>
        ) : preflight ? (
          <>
            {/* Resumen del merge (metadatos, sin contenido clínico ni JSON crudo) */}
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 mb-4">
              <p>Fusión del <b>{formatDateTime(preflight.mergedAt)}</b></p>
              <p className="mt-1">
                {entry.sourceName || '—'} <span className="text-gray-400">(origen)</span> → {entry.targetName || '—'} <span className="text-gray-400">(destino)</span>
              </p>
              {preflight.mergeReason && <p className="text-xs text-gray-500 mt-1">Motivo del merge: {preflight.mergeReason}</p>}
            </div>

            {/* Veredicto */}
            {preflight.eligible ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-semibold text-emerald-900"><i className="ri-checkbox-circle-line mr-1" />Reversible</p>
                <p className="text-xs text-emerald-700 mt-1">
                  Se devolverían al origen: <b>{preflight.movedExpected.appointments}</b> citas ·{' '}
                  <b>{preflight.movedExpected.consultations}</b> consultas · <b>{preflight.movedExpected.vitals}</b> vitales. La ficha origen se reactiva.
                </p>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-semibold text-red-900">
                  <i className="ri-close-circle-line mr-1" />No reversible{preflight.blockCode ? ` (${preflight.blockCode})` : ''}
                </p>
                <p className="text-xs text-red-700 mt-1">{unmergeBlockMessage(preflight.blockCode, preflight.blockReason)}</p>
              </div>
            )}

            {/* Warnings (informativos, no bloquean) */}
            {preflight.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 space-y-1">
                {preflight.warnings.map((w) => (
                  <p key={w.code} className="text-xs text-amber-800"><i className="ri-error-warning-line mr-1" />{w.message}</p>
                ))}
              </div>
            )}

            {confirming && preflight.eligible ? (
              /* ── Paso de confirmación reforzada ── */
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                  <i className="ri-alert-line mr-1" />
                  Esta acción <b>devuelve el expediente a la ficha origen y la reactiva</b>. No hay re-deshacer automático.
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Motivo de la reversa</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    disabled={reverting}
                    placeholder="Por qué se revierte esta fusión…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                  />
                  {!reasonOk && (
                    <p className="text-xs text-amber-600 mt-1">El motivo es obligatorio (mínimo 10 caracteres).</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Escribí <span className="font-mono font-semibold text-gray-900">{CONFIRM_PHRASE_UNMERGE}</span> para confirmar
                  </label>
                  <input
                    type="text"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    disabled={reverting}
                    autoComplete="off"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                    {unmergeBlockMessage(error.code, error.message)}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => { if (!reverting) { setConfirming(false); setPhrase(''); } }}
                    disabled={reverting}
                    className="text-sm text-gray-600 font-medium hover:underline disabled:opacity-40"
                  >
                    Volver
                  </button>
                  <button
                    onClick={() => onConfirm(reason.trim())}
                    disabled={!canConfirm}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {reverting ? 'Revirtiendo…' : 'Confirmar reversa'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
                  Cerrar
                </button>
                {preflight.eligible && (
                  <button
                    onClick={() => setConfirming(true)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700"
                  >
                    Deshacer fusión
                  </button>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Vista de éxito tras la reversa: origen reactivado, destino, merge_log_id, devueltos. */
function UnmergeSuccess({
  entry, result, onClose,
}: {
  entry: MergeLogEntry;
  result: UnmergeResult;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
        <p className="text-sm font-semibold text-emerald-900">
          <i className="ri-checkbox-circle-line mr-1" />Fusión revertida
        </p>
        <p className="text-xs text-emerald-700 mt-1">
          El expediente volvió a la ficha origen, que quedó reactivada.
        </p>
      </div>

      <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 space-y-1">
        <div>
          <span className="text-gray-500">Origen (reactivado):</span>{' '}
          <b>{entry.sourceName || '—'}</b>{' '}
          <span className="text-xs text-gray-400">({result.sourceId.slice(0, 8)})</span>
        </div>
        <div>
          <span className="text-gray-500">Destino:</span>{' '}
          <b>{entry.targetName || '—'}</b>{' '}
          <span className="text-xs text-gray-400">({result.targetId.slice(0, 8)})</span>
        </div>
        <div>
          <span className="text-gray-500">Registro de fusión:</span>{' '}
          <span className="font-mono text-xs text-gray-700">{result.mergeLogId}</span>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700">
        <p className="font-medium mb-1">Devuelto al origen:</p>
        <div className="flex gap-4">
          <span><b>{result.movedBack.appointments}</b> citas</span>
          <span><b>{result.movedBack.consultations}</b> consultas</span>
          <span><b>{result.movedBack.vitals}</b> vitales</span>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800">
          Cerrar
        </button>
      </div>
    </div>
  );
}
