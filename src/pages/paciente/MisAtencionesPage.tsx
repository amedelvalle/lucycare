/**
 * /paciente/mis-atenciones — Paciente Global Fase 1.
 *
 * Lista cross-clinic de las atenciones del paciente logueado.
 * Solo metadatos operativos. NO contenido clínico.
 *
 * Reglas:
 *  - Solo accesible para role=patient. El router fuerza esto via
 *    PatientOnlyRoute. Si llega otro rol, se redirige a /.
 *  - Paginada 20 por página.
 *  - Columnas: Fecha · Médico · Clínica · Especialidad · Servicio · Estado.
 *  - Fallbacks: "Consulta médica" / "No especificada".
 *  - Empty state claro si no hay atenciones.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listMyAppointments } from '@/services/patientHistory.service';
import PatientHeader from '@/components/PatientHeader';

const PAGE_SIZE = 20;

function formatStartDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-SV', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function statusBadge(statusKey: string, statusLabel: string, isFinal: boolean) {
  const lower = statusKey.toLowerCase();
  let className = 'bg-gray-100 text-gray-700';
  if (lower === 'atendida') className = 'bg-emerald-100 text-emerald-800';
  else if (lower === 'confirmada' || lower === 'programada') className = 'bg-blue-100 text-blue-800';
  else if (lower === 'cancelada' || lower === 'no_asistio') className = 'bg-red-100 text-red-800';
  else if (lower === 'en_sala') className = 'bg-amber-100 text-amber-800';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {statusLabel}
      {isFinal && lower !== 'cancelada' && lower !== 'no_asistio' ? '' : ''}
    </span>
  );
}

export default function MisAtencionesPage() {
  const [page, setPage] = useState(0);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['my-appointments', page],
    queryFn: () => listMyAppointments({ page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-gray-50">
      <PatientHeader />

      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Mis atenciones</h1>
          <p className="text-sm text-gray-600 mt-1">
            Historial de citas y atenciones con tus médicos en LucyCare.
          </p>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
                <div className="h-4 w-32 bg-gray-200 rounded mb-3" />
                <div className="h-3 w-48 bg-gray-100 rounded mb-2" />
                <div className="h-3 w-36 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm font-medium text-red-900">No pudimos cargar tus atenciones</p>
            <p className="text-xs text-red-700 mt-1">
              {error instanceof Error ? error.message : 'Error inesperado'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 text-sm text-red-700 underline hover:text-red-900"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && rows.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
            <div className="w-16 h-16 mx-auto bg-emerald-50 rounded-full flex items-center justify-center mb-4">
              <i className="ri-calendar-line text-3xl text-emerald-700"></i>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Todavía no tenés atenciones registradas</h2>
            <p className="text-sm text-gray-600 mb-4">
              Cuando reserves o asistas a una cita con un médico de LucyCare, aparecerá acá.
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-medium hover:bg-emerald-800"
            >
              <i className="ri-search-line"></i>
              Buscar médicos
            </Link>
          </div>
        )}

        {/* Lista */}
        {!isLoading && !error && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((row) => (
              <article
                key={row.id}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h2 className="text-sm font-medium text-gray-900">
                    {formatStartDate(row.startTime)}
                  </h2>
                  {statusBadge(row.statusKey, row.status, row.isFinal)}
                </div>
                <div className="space-y-1 text-sm text-gray-700">
                  <p>
                    <span className="text-gray-500">Médico:</span>{' '}
                    <span className="font-medium text-gray-900">{row.doctorName}</span>
                    {row.specialty && <span className="text-gray-500"> · {row.specialty}</span>}
                  </p>
                  <p>
                    <span className="text-gray-500">Clínica:</span> {row.clinicName}
                  </p>
                  <p>
                    <span className="text-gray-500">Servicio:</span> {row.serviceName}
                  </p>
                </div>
              </article>
            ))}

            {/* Paginación */}
            {totalPages > 1 && (
              <nav className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0 || isRefetching}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Anterior
                  </button>
                  <span className="text-xs text-gray-500">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1 || isRefetching}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Siguiente
                  </button>
                </div>
              </nav>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
