import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminDoctors,
  setDoctorPublished,
  setDoctorOperational,
  setDoctorLucyStatus,
  type AdminDoctorRow,
  type LucyStatus,
} from '../../services/admin.service';
import { adminWaitlistPendingCountByDoctor } from '../../services/waitlist.service';

const LUCY_OPTIONS: Array<{ value: LucyStatus; label: string }> = [
  { value: 'listed_only', label: 'Solo listado' },
  { value: 'claimed', label: 'Perfil reclamado' },
  { value: 'booking_enabled', label: 'Agenda habilitada' },
  { value: 'verified', label: 'Verificado' },
];
const LUCY_LABEL: Record<LucyStatus, string> = Object.fromEntries(
  LUCY_OPTIONS.map((o) => [o.value, o.label])
) as Record<LucyStatus, string>;

const PAGE_SIZE = 25;

type TriState = 'all' | 'yes' | 'no';
const triToBool = (v: TriState): boolean | null =>
  v === 'all' ? null : v === 'yes';

function Badge({ on, labelOn, labelOff }: { on: boolean; labelOn: string; labelOff: string }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
        on ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {on ? labelOn : labelOff}
    </span>
  );
}

export default function AdminDoctorsPage() {
  const qc = useQueryClient();

  // ─── Filtros + paginación ────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(''); // debounced
  const [published, setPublished] = useState<TriState>('all');
  const [operational, setOperational] = useState<TriState>('all');
  const [lucy, setLucy] = useState<'' | LucyStatus>('');
  const [page, setPage] = useState(1);

  // Debounce del search
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Reset page al cambiar filtros
  useEffect(() => {
    setPage(1);
  }, [published, operational, lucy]);

  const hasFilters =
    !!search || published !== 'all' || operational !== 'all' || lucy !== '';

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setPublished('all');
    setOperational('all');
    setLucy('');
    setPage(1);
  };

  // ─── Query con server-side filter+paginate ───────────────
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-doctors', { search, published, operational, lucy, page }],
    queryFn: () =>
      getAdminDoctors({
        search: search || undefined,
        published: triToBool(published),
        operational: triToBool(operational),
        lucyStatus: lucy || null,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  // Bulk count de pendientes en lista de espera (1 query para todos los médicos).
  // Independiente del listado: refresca cada 60s o al invalidar.
  const waitlistCountsQ = useQuery({
    queryKey: ['admin-waitlist-pending-counts'],
    queryFn: adminWaitlistPendingCountByDoctor,
    staleTime: 60_000,
  });
  const waitlistCounts = waitlistCountsQ.data ?? new Map<string, number>();

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-doctors'] });

  const mPublished = useMutation({
    mutationFn: ({ id, v }: { id: string; v: boolean }) => setDoctorPublished(id, v),
    onSuccess: invalidate,
  });
  const mOperational = useMutation({
    mutationFn: ({ id, v }: { id: string; v: boolean }) => setDoctorOperational(id, v),
    onSuccess: invalidate,
  });
  const mLucy = useMutation({
    mutationFn: ({ id, v }: { id: string; v: LucyStatus }) => setDoctorLucyStatus(id, v),
    onSuccess: invalidate,
  });

  const anyError =
    error ?? mPublished.error ?? mOperational.error ?? mLucy.error;
  const errMsg =
    anyError instanceof Error ? anyError.message : anyError ? String(anyError) : null;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Médicos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ejes independientes — <strong>publicar</strong> (visible en directorio),
          <strong> operar</strong> (puede usar panel/agenda/atender),
          y <strong> lucy_status</strong> (etapa comercial; "Verificado" se deriva
          automáticamente de <code>lucy_status='verified'</code>).
        </p>
      </header>

      {/* ─── Buscador + filtros ─────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Buscar</label>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nombre, especialidad o teléfono…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Publicado</label>
            <select
              value={published}
              onChange={(e) => setPublished(e.target.value as TriState)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            >
              <option value="all">Todos</option>
              <option value="yes">Publicado</option>
              <option value="no">No publicado</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Operativo</label>
            <select
              value={operational}
              onChange={(e) => setOperational(e.target.value as TriState)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            >
              <option value="all">Todos</option>
              <option value="yes">Operativo</option>
              <option value="no">Suspendido</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Lucy status</label>
            <select
              value={lucy}
              onChange={(e) => setLucy(e.target.value as '' | LucyStatus)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            >
              <option value="">Todos</option>
              {LUCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2 flex items-end justify-end gap-2">
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
              >
                Limpiar filtros
              </button>
            )}
            <span className="text-xs text-gray-500 self-center">
              {total} {total === 1 ? 'resultado' : 'resultados'}
            </span>
          </div>
        </div>
      </div>

      {errMsg && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 mb-4">
          {errMsg}
        </div>
      )}

      {/* ─── Tabla ──────────────────────────────────────── */}
      {isLoading && rows.length === 0 ? (
        <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-600">No se encontraron médicos con esos filtros.</p>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="mt-3 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-2xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Médico</th>
                <th className="px-3 py-3 text-left">Estado</th>
                <th className="px-3 py-3 text-left">Lucy status</th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((d: AdminDoctorRow) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900">{d.fullName ?? '—'}</p>
                      {(() => {
                        const pendingCount = waitlistCounts.get(d.id) ?? 0;
                        return pendingCount > 0 ? (
                          <Link
                            to={`/admin/medicos/${d.id}`}
                            title="Ver lista de espera"
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[11px] font-medium hover:bg-amber-200 transition-colors"
                          >
                            <i className="ri-time-line"></i>
                            Lista de espera: {pendingCount}
                          </Link>
                        ) : null;
                      })()}
                    </div>
                    <p className="text-xs text-gray-500">{d.specialty ?? 'Sin especialidad'}</p>
                    <p className="text-[11px] text-gray-400">{d.clinicName ?? ''}</p>
                  </td>
                  <td className="px-3 py-3 align-top space-y-1">
                    <Badge on={d.isOperational} labelOn="Operativo" labelOff="Suspendido" />{' '}
                    <Badge on={d.isPublished} labelOn="Publicado" labelOff="No publicado" />{' '}
                    <Badge on={d.isVerified} labelOn="Verificado" labelOff="No verificado" />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <select
                      value={d.lucyStatus}
                      disabled={mLucy.isPending}
                      onChange={(e) => mLucy.mutate({ id: d.id, v: e.target.value as LucyStatus })}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                      title={LUCY_LABEL[d.lucyStatus]}
                    >
                      {LUCY_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3 align-top text-right space-x-1.5 whitespace-nowrap">
                    <Link
                      to={`/admin/medicos/${d.id}`}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center"
                    >
                      Editar
                    </Link>
                    <button
                      onClick={() => mPublished.mutate({ id: d.id, v: !d.isPublished })}
                      disabled={mPublished.isPending}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
                    >
                      {d.isPublished ? 'Despublicar' : 'Publicar'}
                    </button>
                    <button
                      onClick={() => mOperational.mutate({ id: d.id, v: !d.isOperational })}
                      disabled={mOperational.isPending}
                      className={`text-xs px-2.5 py-1.5 rounded-lg text-white ${
                        d.isOperational ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      {d.isOperational ? 'Suspender' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Paginación ─────────────────────────────────── */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>
            Página {page} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
