import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatientsList } from '@/hooks/usePatients';
import { useClinicContext } from '@/hooks/useClinicContext';
import type { PatientListItem } from '@/services/patients.service';

export default function PacientesPage() {
  const navigate = useNavigate();

  // ─── Contexto unificado (doctor o asistente) ─────────────────────
  const { data: ctx, isLoading: loadingDoctor, error: ctxError } = useClinicContext();
  const clinicId = ctx?.clinicId ?? null;

  // ─── Búsqueda con debounce ────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ─── Datos ────────────────────────────────────────────────────────
  const {
    data: patients = [],
    isLoading,
    isFetching,
    error,
  } = usePatientsList(clinicId ?? undefined, debouncedSearch);

  // ─── Loading inicial ──────────────────────────────────────────────
  if (loadingDoctor) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-12 bg-gray-100 rounded" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!clinicId) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">
            {ctxError instanceof Error
              ? ctxError.message
              : 'No se pudo cargar el contexto de la clínica.'}
          </p>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pacientes</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isLoading
            ? 'Cargando...'
            : `${patients.length} ${patients.length === 1 ? 'paciente' : 'pacientes'}${
                debouncedSearch ? ` para "${debouncedSearch}"` : ''
              }`}
        </p>
      </div>

      {/* Search bar */}
      <div className="relative mb-5">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por nombre o teléfono..."
          className="w-full pl-10 pr-10 py-2.5 text-sm bg-white border border-gray-200 rounded-xl
            focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Limpiar"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Indicador de refetch en background */}
      {isFetching && !isLoading && (
        <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Actualizando...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-3">
          <p className="text-sm text-red-700">
            Error al cargar pacientes: {(error as Error).message}
          </p>
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : patients.length === 0 ? (
        <EmptyState hasSearch={!!debouncedSearch} />
      ) : (
        <div className="space-y-2">
          {patients.map((p) => (
            <PatientRow
              key={p.id}
              patient={p}
              onClick={() => navigate(`/panel/pacientes/${p.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function PatientRow({
  patient,
  onClick,
}: {
  patient: PatientListItem;
  onClick: () => void;
}) {
  const initials = getInitials(patient.full_name);
  const lastApt = patient.last_appointment_at
    ? formatRelativeDate(patient.last_appointment_at)
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-lg border border-gray-200 p-4
        hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors"
    >
      <div className="flex items-center gap-3">
        {patient.photo_url ? (
          <img
            src={patient.photo_url}
            alt={patient.full_name}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
            {initials}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {patient.full_name}
          </p>
          <p className="text-xs text-gray-500 truncate">
            {patient.phone || 'Sin teléfono'}
          </p>
        </div>

        <div className="text-right flex-shrink-0">
          <p className="text-xs font-medium text-gray-700">
            {patient.total_appointments}{' '}
            {patient.total_appointments === 1 ? 'cita' : 'citas'}
          </p>
          {lastApt && (
            <p className="text-[11px] text-gray-400 mt-0.5">{lastApt}</p>
          )}
        </div>

        <svg
          className="w-4 h-4 text-gray-300 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <svg
        className="w-12 h-12 text-gray-300"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1}
          d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
        />
      </svg>
      <h3 className="mt-4 text-base font-medium text-gray-900">
        {hasSearch ? 'Sin resultados' : 'Aún no tienes pacientes'}
      </h3>
      <p className="mt-1.5 text-sm text-gray-500 text-center max-w-sm">
        {hasSearch
          ? 'Intenta con otro nombre o número de teléfono.'
          : 'Los pacientes aparecerán aquí cuando agendes una cita o se reserve desde el directorio.'}
      </p>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const future = Math.abs(diffDays);
    if (future === 0) return 'Hoy';
    if (future === 1) return 'Mañana';
    return `En ${future} días`;
  }
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return `Hace ${diffDays} días`;
  if (diffDays < 30) return `Hace ${Math.floor(diffDays / 7)} sem`;
  if (diffDays < 365) return `Hace ${Math.floor(diffDays / 30)} mes`;
  return date.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
}
