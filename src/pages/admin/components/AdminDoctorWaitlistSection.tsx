import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  adminListWaitlistForDoctor,
  adminCountWaitlistForDoctor,
  adminUpdateWaitlistEntry,
  type AdminWaitlistEntry,
} from '@/services/waitlist.service';

interface Props {
  doctorId: string;
}

type StatusFilter = 'all' | 'pending' | 'contacted' | 'cancelled';

const PAGE_SIZE = 25;

const STATUS_LABEL: Record<AdminWaitlistEntry['status'], string> = {
  pending: 'Pendiente',
  contacted: 'Contactado',
  cancelled: 'Cancelado',
};

const STATUS_COLOR: Record<AdminWaitlistEntry['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  contacted: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-200 text-gray-700',
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-SV', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatPhoneForWa(phone: string): string {
  // RPC guarda phone original como vino (puede tener formato display).
  // Para WhatsApp link queremos solo dígitos.
  return phone.replace(/\D/g, '');
}

export default function AdminDoctorWaitlistSection({ doctorId }: Props) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(0);

  const filterArg = statusFilter === 'all' ? undefined : statusFilter;

  const listKey = ['admin-waitlist', doctorId, statusFilter, page] as const;
  const countKey = ['admin-waitlist-count', doctorId, statusFilter] as const;
  const pendingCountKey = ['admin-waitlist-count', doctorId, 'pending'] as const;

  const listQ = useQuery({
    queryKey: listKey,
    queryFn: () =>
      adminListWaitlistForDoctor(doctorId, {
        status: filterArg,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    enabled: !!doctorId,
  });

  const countQ = useQuery({
    queryKey: countKey,
    queryFn: () => adminCountWaitlistForDoctor(doctorId, filterArg),
    enabled: !!doctorId,
  });

  // Conteo de pendientes (siempre visible en el header — independiente del filtro).
  const pendingCountQ = useQuery({
    queryKey: pendingCountKey,
    queryFn: () => adminCountWaitlistForDoctor(doctorId, 'pending'),
    enabled: !!doctorId,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: AdminWaitlistEntry['status']; notes?: string | null }) =>
      adminUpdateWaitlistEntry(id, status, notes ?? null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-waitlist', doctorId] });
      qc.invalidateQueries({ queryKey: ['admin-waitlist-count', doctorId] });
    },
  });

  const entries = listQ.data ?? [];
  const total = countQ.data ?? 0;
  const pendingCount = pendingCountQ.data ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
      <header className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Lista de espera</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pacientes que pidieron ser avisados cuando este médico active agenda en línea. La notificación es manual.
            </p>
          </div>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
              <i className="ri-time-line"></i>
              {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      {/* Filtro por estado */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'pending', 'contacted', 'cancelled'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatusFilter(s);
              setPage(0);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors cursor-pointer ${
              statusFilter === s
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {s === 'all' ? 'Todas' : STATUS_LABEL[s as AdminWaitlistEntry['status']]}
          </button>
        ))}
      </div>

      {listQ.isLoading && (
        <div className="h-24 bg-gray-50 rounded-lg animate-pulse" />
      )}

      {listQ.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          No se pudo cargar la lista: {listQ.error instanceof Error ? listQ.error.message : 'error'}
        </div>
      )}

      {!listQ.isLoading && entries.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          {statusFilter === 'all'
            ? 'Todavía no hay solicitudes en la lista de espera.'
            : `No hay solicitudes en estado "${STATUS_LABEL[statusFilter as AdminWaitlistEntry['status']]}".`}
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry) => {
            const waLink = `https://wa.me/${formatPhoneForWa(entry.patientPhone)}`;
            return (
              <div key={entry.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{entry.patientName}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLOR[entry.status]}`}>
                        {STATUS_LABEL[entry.status]}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-600 flex-wrap">
                      <a
                        href={`tel:${formatPhoneForWa(entry.patientPhone)}`}
                        className="hover:text-emerald-700 inline-flex items-center gap-1"
                      >
                        <i className="ri-phone-line"></i> {entry.patientPhone}
                      </a>
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-emerald-700 inline-flex items-center gap-1"
                      >
                        <i className="ri-whatsapp-line"></i> WhatsApp
                      </a>
                      <span>· {formatDateTime(entry.createdAt)}</span>
                    </div>
                    {entry.patientMessage && (
                      <p className="text-xs text-gray-700 mt-2 bg-white border border-gray-100 rounded p-2">
                        {entry.patientMessage}
                      </p>
                    )}
                    {entry.notes && (
                      <p className="text-xs text-gray-500 mt-1 italic">
                        Nota interna: {entry.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    {entry.status !== 'contacted' && (
                      <button
                        type="button"
                        onClick={() => {
                          const note = window.prompt('Nota interna (opcional):', entry.notes ?? '') ?? entry.notes;
                          updateMut.mutate({ id: entry.id, status: 'contacted', notes: note || null });
                        }}
                        disabled={updateMut.isPending}
                        className="text-xs px-2.5 py-1 bg-emerald-700 text-white rounded hover:bg-emerald-800 cursor-pointer disabled:opacity-50"
                      >
                        Marcar contactado
                      </button>
                    )}
                    {entry.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('¿Cancelar esta solicitud?')) {
                            updateMut.mutate({ id: entry.id, status: 'cancelled', notes: entry.notes });
                          }
                        }}
                        disabled={updateMut.isPending}
                        className="text-xs px-2.5 py-1 border border-gray-300 text-gray-700 rounded hover:bg-white cursor-pointer disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}
                    {entry.status === 'contacted' && (
                      <button
                        type="button"
                        onClick={() => updateMut.mutate({ id: entry.id, status: 'pending', notes: entry.notes })}
                        disabled={updateMut.isPending}
                        className="text-xs px-2.5 py-1 border border-amber-200 text-amber-800 rounded hover:bg-amber-50 cursor-pointer disabled:opacity-50"
                      >
                        Reabrir
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

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
                  className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 cursor-pointer disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 cursor-pointer disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {updateMut.error && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">
          Error al actualizar: {updateMut.error instanceof Error ? updateMut.error.message : 'error'}
        </div>
      )}
    </section>
  );
}
