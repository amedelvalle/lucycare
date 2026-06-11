/**
 * /paciente/mis-atenciones — Paciente Global Fase 1.
 *
 * Lista cross-clinic de las atenciones del paciente logueado.
 * Solo metadatos operativos. NO contenido clínico.
 *
 * Reglas:
 *  - Accesible para patient/doctor/assistant (identidad múltiple, Fase 1):
 *    el lado paciente es la "cuenta personal" de la persona. PatientOnlyRoute
 *    excluye admin/anon. Los datos siguen filtrados por RLS (cada quien ve solo
 *    lo suyo, por auth.uid()/profile_id).
 *  - Paginada 20 por página.
 *  - Columnas: Fecha · Médico · Clínica · Especialidad · Servicio · Estado.
 *  - Fallbacks: "Consulta médica" / "No especificada".
 *  - Empty state claro si no hay atenciones.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listMyAppointments,
  listUnconfirmedLinks,
  confirmPatientLink,
  rejectPatientLink,
  type UnconfirmedLink,
} from '@/services/patientHistory.service';
import PatientHeader from '@/components/PatientHeader';
import ProfileIncompleteBanner from '@/components/ProfileIncompleteBanner';
import PersonalAccountNote from '@/components/PersonalAccountNote';

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
            Historial de citas y atenciones con tus médicos en LucyCare. Es tu cuenta personal.
          </p>
        </div>

        <PersonalAccountNote />
        <ProfileIncompleteBanner />
        <UnconfirmedLinksSection />

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

// ─── B2 (s7_43): Atenciones por confirmar ─────────────────────────────
// Fichas vinculadas por teléfono (claim) que el paciente todavía no confirmó
// como suyas. NO se mezclan con las atenciones normales: viven en esta
// sección con metadatos mínimos (clínica, médico, cantidad, última fecha)
// hasta que la persona decida. Acción por ficha (no "confirmar todo").
function UnconfirmedLinksSection() {
  const qc = useQueryClient();
  const { data: links = [] } = useQuery({
    queryKey: ['my-unconfirmed-links'],
    queryFn: listUnconfirmedLinks,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-unconfirmed-links'] });
    qc.invalidateQueries({ queryKey: ['my-appointments'] });
  };

  const confirmMut = useMutation({
    mutationFn: (patientId: string) => confirmPatientLink(patientId),
    onSuccess: invalidate,
  });
  const rejectMut = useMutation({
    mutationFn: (patientId: string) => rejectPatientLink(patientId),
    onSuccess: invalidate,
  });

  if (links.length === 0) return null;

  const busy = confirmMut.isPending || rejectMut.isPending;

  return (
    <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-start gap-2 mb-3">
        <i className="ri-question-line text-amber-600 text-lg flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-900">
            Encontramos atenciones asociadas a tu número
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            Confirmá si son tuyas. Si no lo son (por ejemplo, un número mal
            registrado o compartido), marcalas y dejarán de aparecer.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {links.map((l) => (
          <UnconfirmedLinkRow
            key={l.patientId}
            link={l}
            busy={busy}
            onConfirm={() => confirmMut.mutate(l.patientId)}
            onReject={() => {
              if (
                window.confirm(
                  'Vas a marcar estas atenciones como "no son mías". Dejarán de aparecer en tu cuenta y quedarán en revisión. ¿Continuar?',
                )
              ) {
                rejectMut.mutate(l.patientId);
              }
            }}
          />
        ))}
      </ul>

      {(confirmMut.error || rejectMut.error) && (
        <p className="text-xs text-red-700 mt-2">
          No pudimos guardar tu respuesta. Intentá de nuevo.
        </p>
      )}
    </div>
  );
}

function UnconfirmedLinkRow({
  link,
  busy,
  onConfirm,
  onReject,
}: {
  link: UnconfirmedLink;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const meta: string[] = [];
  if (link.doctorName) meta.push(link.doctorName);
  meta.push(
    `${link.appointmentCount} atencion${link.appointmentCount === 1 ? '' : 'es'}`,
  );
  if (link.lastAppointmentAt) {
    try {
      meta.push(
        'última: ' +
          new Date(link.lastAppointmentAt).toLocaleDateString('es-SV', {
            day: '2-digit', month: 'short', year: 'numeric',
          }),
      );
    } catch { /* fecha cruda no mostrable — se omite */ }
  }

  return (
    <li className="bg-white border border-amber-100 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{link.clinicName}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{meta.join(' · ')}</p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50"
        >
          Sí, son mías
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          No son mías
        </button>
      </div>
    </li>
  );
}
