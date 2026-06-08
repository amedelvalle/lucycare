import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  adminListWaitlist,
  adminUpdateWaitlistEntry,
  adminWaitlistPendingCountByDoctor,
  type AdminWaitlistGlobalEntry,
} from '../../services/waitlist.service';
import { getAdminDoctors, getSpecialtiesForAdmin } from '../../services/admin.service';

type StatusFilter = 'all' | 'pending' | 'contacted' | 'cancelled';

const PAGE_SIZE = 25;

const STATUS_LABEL: Record<AdminWaitlistGlobalEntry['status'], string> = {
  pending: 'Pendiente',
  contacted: 'Contactado',
  cancelled: 'Cancelado',
};
const STATUS_COLOR: Record<AdminWaitlistGlobalEntry['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  contacted: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-200 text-gray-700',
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-SV', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
const onlyDigits = (phone: string) => phone.replace(/\D/g, '');

export default function AdminWaitlistPage() {
  const qc = useQueryClient();

  // ─── Filtros ─────────────────────────────────────────────
  const [status, setStatus] = useState<StatusFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(''); // debounced
  const [doctorId, setDoctorId] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(0); }, [status, doctorId, specialtyId, dateFrom, dateTo]);

  const hasFilters =
    status !== 'all' || !!search || !!doctorId || !!specialtyId || !!dateFrom || !!dateTo;

  const clearFilters = () => {
    setStatus('all'); setSearchInput(''); setSearch('');
    setDoctorId(''); setSpecialtyId(''); setDateFrom(''); setDateTo(''); setPage(0);
  };

  // ─── Datos de filtros (dropdowns) ────────────────────────
  const doctorsQ = useQuery({
    queryKey: ['admin-waitlist-doctors'],
    queryFn: () => getAdminDoctors({ published: true, limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const specialtiesQ = useQuery({
    queryKey: ['admin-specialties'],
    queryFn: getSpecialtiesForAdmin,
    staleTime: 5 * 60_000,
  });

  // Total de pendientes global (suma del bulk count por médico).
  const pendingGlobalQ = useQuery({
    queryKey: ['admin-waitlist-pending-global'],
    queryFn: adminWaitlistPendingCountByDoctor,
    staleTime: 30_000,
  });
  const pendingGlobal = useMemo(() => {
    let sum = 0;
    pendingGlobalQ.data?.forEach((n) => { sum += n; });
    return sum;
  }, [pendingGlobalQ.data]);

  // ─── Lista ───────────────────────────────────────────────
  const listQ = useQuery({
    queryKey: ['admin-waitlist-global', { status, search, doctorId, specialtyId, dateFrom, dateTo, page }],
    queryFn: () =>
      adminListWaitlist({
        status: status === 'all' ? undefined : status,
        doctorId: doctorId || undefined,
        specialtyId: specialtyId || undefined,
        search: search || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status: s, notes }: { id: string; status: AdminWaitlistGlobalEntry['status']; notes?: string | null }) =>
      adminUpdateWaitlistEntry(id, s, notes ?? null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-waitlist-global'] });
      qc.invalidateQueries({ queryKey: ['admin-waitlist-pending-global'] });
      qc.invalidateQueries({ queryKey: ['admin-waitlist-pending-count'] }); // badge de /admin/medicos
    },
  });

  const entries = listQ.data?.entries ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lista de espera</h1>
          <p className="text-sm text-gray-500 mt-1">
            Pacientes que pidieron ser avisados cuando un médico active agenda en línea, en
            todos los médicos publicados. La notificación es manual.
          </p>
        </div>
        {pendingGlobal > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
            <i className="ri-time-line" />
            {pendingGlobal} pendiente{pendingGlobal !== 1 ? 's' : ''} en total
          </span>
        )}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 space-y-3">
        {/* Estado (segmented) */}
        <div className="flex gap-2 flex-wrap">
          {(['all', 'pending', 'contacted', 'cancelled'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                status === s ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {s === 'all' ? 'Todas' : STATUS_LABEL[s as AdminWaitlistGlobalEntry['status']]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Búsqueda */}
          <div className="relative lg:col-span-2">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por paciente, teléfono o médico…"
              className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </div>

          {/* Médico */}
          <select
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white cursor-pointer focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
          >
            <option value="">Todos los médicos</option>
            {(doctorsQ.data?.rows ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.fullName ?? '—'}</option>
            ))}
          </select>

          {/* Especialidad */}
          <select
            value={specialtyId}
            onChange={(e) => setSpecialtyId(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white cursor-pointer focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
          >
            <option value="">Todas las especialidades</option>
            {(specialtiesQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          {/* Fecha desde / hasta */}
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <span className="whitespace-nowrap">Desde</span>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <span className="whitespace-nowrap">Hasta</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </label>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 underline justify-self-start self-center"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* Resultados */}
      {listQ.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : listQ.error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          No se pudo cargar la lista: {listQ.error instanceof Error ? listQ.error.message : 'error'}
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-500">
          {hasFilters
            ? 'No hay solicitudes que coincidan con los filtros.'
            : 'Todavía no hay solicitudes en ninguna lista de espera.'}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-2">
            {total} resultado{total !== 1 ? 's' : ''}
            {totalPages > 1 && <> · página {page + 1} de {totalPages}</>}
          </p>
          <div className="space-y-2">
            {entries.map((entry) => (
              <WaitlistRow
                key={entry.id}
                entry={entry}
                busy={updateMut.isPending}
                onContacted={() => {
                  const note = window.prompt('Nota interna (opcional):', entry.notes ?? '') ?? entry.notes;
                  updateMut.mutate({ id: entry.id, status: 'contacted', notes: note || null });
                }}
                onCancel={() => {
                  if (window.confirm('¿Cancelar esta solicitud?'))
                    updateMut.mutate({ id: entry.id, status: 'cancelled', notes: entry.notes });
                }}
                onReopen={() => updateMut.mutate({ id: entry.id, status: 'pending', notes: entry.notes })}
              />
            ))}
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-xs text-gray-600">
              <span>
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {updateMut.error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">
          Error al actualizar: {updateMut.error instanceof Error ? updateMut.error.message : 'error'}
        </div>
      )}
    </div>
  );
}

function WaitlistRow({
  entry,
  busy,
  onContacted,
  onCancel,
  onReopen,
}: {
  entry: AdminWaitlistGlobalEntry;
  busy: boolean;
  onContacted: () => void;
  onCancel: () => void;
  onReopen: () => void;
}) {
  const digits = onlyDigits(entry.patientPhone);
  const doctorMeta = [entry.specialtyName, entry.clinicName].filter(Boolean).join(' · ');

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex-1 min-w-0">
          {/* Paciente + estado */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{entry.patientName}</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLOR[entry.status]}`}>
              {STATUS_LABEL[entry.status]}
            </span>
          </div>

          {/* Teléfono + fecha */}
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-600 flex-wrap">
            <a href={`tel:${digits}`} className="hover:text-emerald-700 inline-flex items-center gap-1">
              <i className="ri-phone-line" /> {entry.patientPhone}
            </a>
            <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-700 inline-flex items-center gap-1">
              <i className="ri-whatsapp-line" /> WhatsApp
            </a>
            <span>· {formatDateTime(entry.createdAt)}</span>
          </div>

          {/* Médico (link a ficha admin) + especialidad/clínica */}
          <div className="mt-1.5 text-xs text-gray-600">
            <i className="ri-stethoscope-line mr-1 text-gray-400" />
            <Link to={`/admin/medicos/${entry.doctorId}`} className="font-medium text-emerald-700 hover:underline">
              {entry.doctorName ?? 'Médico'}
            </Link>
            {doctorMeta && <span className="text-gray-500"> · {doctorMeta}</span>}
          </div>

          {entry.patientMessage && (
            <p className="text-xs text-gray-700 mt-2 bg-gray-50 border border-gray-100 rounded p-2">
              {entry.patientMessage}
            </p>
          )}
          {entry.notes && (
            <p className="text-xs text-gray-500 mt-1 italic">Nota interna: {entry.notes}</p>
          )}
        </div>

        {/* Acciones */}
        <div className="flex gap-2 flex-shrink-0">
          {entry.status !== 'contacted' && (
            <button
              type="button"
              onClick={onContacted}
              disabled={busy}
              className="text-xs px-2.5 py-1 bg-emerald-700 text-white rounded hover:bg-emerald-800 disabled:opacity-50"
            >
              Marcar contactado
            </button>
          )}
          {entry.status !== 'cancelled' && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="text-xs px-2.5 py-1 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          )}
          {entry.status === 'contacted' && (
            <button
              type="button"
              onClick={onReopen}
              disabled={busy}
              className="text-xs px-2.5 py-1 border border-amber-200 text-amber-800 rounded hover:bg-amber-50 disabled:opacity-50"
            >
              Reabrir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
