// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/lista-espera/ListaEsperaPage.tsx
// ═══════════════════════════════════════════════════════════
// "Mi lista de espera" para el panel (médico dueño o asistente de su clínica).
// Vía RPCs scoped clinic_list_waitlist / clinic_update_waitlist_entry (s7_51).
// NO usa las RPCs admin. El gate de autorización es server-side.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useClinicContext } from '@/hooks/useClinicContext';
import {
  clinicListWaitlist,
  clinicUpdateWaitlistEntry,
  type WaitlistStatus,
  type AdminWaitlistEntry,
} from '@/services/waitlist.service';

type FilterValue = WaitlistStatus | 'all';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'contacted', label: 'Contactados' },
  { value: 'cancelled', label: 'Cancelados' },
  { value: 'all', label: 'Todas' },
];

const STATUS_META: Record<WaitlistStatus, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
  contacted: { label: 'Contactado', cls: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'Cancelado', cls: 'bg-gray-200 text-gray-600' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Dígitos con código de país para tel:/WhatsApp (8 díg. → +503; 503XXXXXXXX tal cual).
function phoneDigits(phone: string): string {
  const d = (phone || '').replace(/\D/g, '');
  if (d.length === 8) return '503' + d;
  return d;
}

export default function ListaEsperaPage() {
  const { data: ctx, isLoading: loadingCtx, error: ctxError } = useClinicContext();
  const doctorId = ctx?.doctorId ?? null;

  const [filter, setFilter] = useState<FilterValue>('pending');

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['clinic-waitlist', doctorId, filter],
    queryFn: () =>
      clinicListWaitlist(doctorId!, { status: filter === 'all' ? undefined : filter }),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
  });

  if (loadingCtx) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-24 bg-gray-100 rounded" />
          <div className="h-24 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!doctorId) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">
            {ctxError instanceof Error ? ctxError.message : 'No se pudo cargar el contexto de la clínica.'}
          </p>
        </div>
      </div>
    );
  }

  const entries = data?.entries ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Lista de espera</h1>
        <p className="text-sm text-gray-500 mt-1">
          Pacientes que dejaron su interés en agendar con vos. Contactalos manualmente y marcá el estado.
        </p>
      </div>

      {/* Filtros por estado */}
      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.value
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isFetching && !isLoading && (
        <p className="mb-3 text-xs text-gray-400">Actualizando…</p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-red-700">
            {error instanceof Error ? error.message : 'Error al cargar la lista de espera.'}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <i className="ri-time-line text-5xl text-gray-300"></i>
          <h3 className="mt-4 text-base font-medium text-gray-900">Sin pacientes en esta vista</h3>
          <p className="mt-1.5 text-sm text-gray-500 max-w-sm">
            Cuando alguien deje su interés desde tu perfil público, aparecerá acá.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <WaitlistRow key={entry.id} entry={entry} doctorId={doctorId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Fila/card de una entrada ────────────────────────────────
function WaitlistRow({
  entry,
  doctorId,
}: {
  entry: AdminWaitlistEntry;
  doctorId: string;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState(entry.notes ?? '');
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: (vars: { status: WaitlistStatus; notes: string | null }) =>
      clinicUpdateWaitlistEntry(entry.id, vars.status, vars.notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic-waitlist', doctorId] });
    },
  });

  const meta = STATUS_META[entry.status];
  const digits = phoneDigits(entry.patientPhone);

  const setStatus = (status: WaitlistStatus) =>
    mutation.mutate({ status, notes: note.trim() || null });
  const saveNote = () => mutation.mutate({ status: entry.status, notes: note.trim() || null });

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(entry.patientPhone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin clipboard */
    }
  };

  const noteChanged = (note.trim() || '') !== (entry.notes ?? '').trim();

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      {/* Nombre + estado */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="font-semibold text-gray-900 min-w-0 break-words">{entry.patientName}</p>
        <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
          {meta.label}
        </span>
      </div>

      {/* Teléfono + acciones de contacto manual */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm text-gray-700">{entry.patientPhone}</span>
        <a
          href={`tel:+${digits}`}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
        >
          <i className="ri-phone-line"></i> Llamar
        </a>
        <a
          href={`https://wa.me/${digits}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
        >
          <i className="ri-whatsapp-line"></i> WhatsApp
        </a>
        <button
          onClick={copyPhone}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
        >
          <i className="ri-file-copy-line"></i> {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>

      {/* Mensaje del paciente */}
      {entry.patientMessage && (
        <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 mb-2 break-words">
          “{entry.patientMessage}”
        </p>
      )}

      {/* Fechas */}
      <p className="text-xs text-gray-400 mb-3">
        Solicitó: {formatDate(entry.createdAt)}
        {entry.contactedAt ? ` · Contactado: ${formatDate(entry.contactedAt)}` : ''}
      </p>

      {/* Nota interna */}
      <div className="mb-3">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota interna (opcional)"
          rows={2}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-y"
        />
        {noteChanged && (
          <button
            onClick={saveNote}
            disabled={mutation.isPending}
            className="mt-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
          >
            Guardar nota
          </button>
        )}
      </div>

      {/* Acciones de estado */}
      <div className="flex flex-wrap gap-2">
        {entry.status !== 'contacted' && (
          <button
            onClick={() => setStatus('contacted')}
            disabled={mutation.isPending}
            className="px-3 py-1.5 text-sm font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors disabled:opacity-50"
          >
            Marcar contactado
          </button>
        )}
        {entry.status !== 'pending' && (
          <button
            onClick={() => setStatus('pending')}
            disabled={mutation.isPending}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            Volver a pendiente
          </button>
        )}
        {entry.status !== 'cancelled' && (
          <button
            onClick={() => setStatus('cancelled')}
            disabled={mutation.isPending}
            className="px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            Descartar
          </button>
        )}
      </div>

      {mutation.isError && (
        <p className="mt-2 text-xs text-red-600">
          {mutation.error instanceof Error ? mutation.error.message : 'No se pudo actualizar.'}
        </p>
      )}
    </div>
  );
}
