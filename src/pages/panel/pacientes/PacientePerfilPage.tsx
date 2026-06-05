import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  usePatient,
  usePatientAppointments,
  useUpdatePatient,
  useSetPatientActive,
} from '@/hooks/usePatients';
import type {
  PatientAppointment,
  PatientUpdateInput,
} from '@/services/patients.service';
import { friendlyErrorMessage } from '@/lib/errors';
import EditPatientModal from './EditPatientModal';

export default function PacientePerfilPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  const { data: patient, isLoading: loadingPatient } = usePatient(id);
  const { data: appointments = [], isLoading: loadingApts } = usePatientAppointments(id);
  const updateMutation = useUpdatePatient(id ?? '');
  const setActiveMutation = useSetPatientActive(id ?? '');
  const [confirmInactivate, setConfirmInactivate] = useState(false);

  const stats = useMemo(() => computeStats(appointments), [appointments]);

  // ─── Loading ─────────────────────────────────────────────────────
  if (loadingPatient) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-100 rounded" />
          <div className="h-24 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-700">Paciente no encontrado.</p>
        </div>
        <button
          onClick={() => navigate('/panel/pacientes')}
          className="mt-3 text-sm text-emerald-700 hover:underline"
        >
          ← Volver a pacientes
        </button>
      </div>
    );
  }

  const initials = getInitials(patient.full_name);
  const age = calculateAge(patient.date_of_birth);

  const handleSubmitEdit = (updates: PatientUpdateInput) => {
    updateMutation.mutate(updates, {
      onSuccess: () => setEditOpen(false),
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/panel/pacientes')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg flex-shrink-0"
            aria-label="Volver"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-gray-900 truncate">{patient.full_name}</h1>
          {!patient.is_active && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 flex-shrink-0">
              Inactivo
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {patient.is_active ? (
            <button
              onClick={() => setConfirmInactivate(true)}
              disabled={setActiveMutation.isPending}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18 18m-12.364.364L5.636 5.636" />
              </svg>
              Inactivar
            </button>
          ) : (
            <button
              onClick={() => setActiveMutation.mutate(true)}
              disabled={setActiveMutation.isPending}
              className="px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Reactivar
            </button>
          )}
          <button
            onClick={() => { updateMutation.reset(); setEditOpen(true); }}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Editar
          </button>
        </div>
      </div>

      {/* Card de identidad + stats */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
        <div className="flex items-start gap-4">
          {patient.photo_url ? (
            <img src={patient.photo_url} alt={patient.full_name} className="w-16 h-16 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-semibold flex-shrink-0">
              {initials}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {patient.phone && (
                <a href={`tel:${patient.phone}`} className="text-emerald-700 hover:text-emerald-800 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  {patient.phone}
                </a>
              )}
              {patient.email && <span className="text-gray-600">{patient.email}</span>}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
              {age !== null && <span>{age} años</span>}
              <span className="capitalize">{patient.gender}</span>
              <span className="capitalize">
                {patient.patient_type === 'asegurado' ? 'Asegurado' : 'Privado'}
              </span>
              <span>
                {patient.document_number
                  ? `${documentLabel(patient.document_type)}: ${patient.document_number}`
                  : 'Sin documento'}
              </span>
            </div>

            {patient.profile_id && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[11px] font-medium text-blue-800">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Identidad gestionada por el paciente en su perfil Lucy
              </div>
            )}
          </div>
        </div>

        {/* Alertas médicas */}
        {(patient.allergies || patient.blood_type) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {patient.blood_type && patient.blood_type !== 'desconocido' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs font-medium border border-red-200">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />
                </svg>
                {patient.blood_type}
              </span>
            )}
            {patient.allergies && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Alergias: {patient.allergies}
              </span>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mt-5 pt-5 border-t border-gray-100">
          <Stat label="Total" value={stats.total} color="text-gray-900" />
          <Stat label="Atendidas" value={stats.atendidas} color="text-emerald-700" />
          <Stat label="Canceladas" value={stats.canceladas} color="text-red-700" />
          <Stat label="No asistió" value={stats.no_asistio} color="text-amber-700" />
        </div>
      </div>

      {/* Contacto de emergencia + notas */}
      {(patient.emergency_contact_name || patient.emergency_contact_phone || patient.notes) && (
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          {(patient.emergency_contact_name || patient.emergency_contact_phone) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Contacto de emergencia
              </p>
              <p className="text-sm text-gray-900 font-medium">
                {patient.emergency_contact_name || '—'}
              </p>
              {patient.emergency_contact_phone && (
                <p className="text-sm text-emerald-700 mt-0.5">{patient.emergency_contact_phone}</p>
              )}
              {patient.emergency_contact_relation && (
                <p className="text-xs text-gray-500 mt-0.5 capitalize">
                  {patient.emergency_contact_relation}
                </p>
              )}
            </div>
          )}
          {patient.notes && (
            <div className="bg-amber-50/40 rounded-xl border border-amber-100 p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Notas privadas
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{patient.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Historial de citas */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Historial de citas</h2>
        <span className="text-xs text-gray-400">{appointments.length} en total</span>
      </div>

      {loadingApts ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">Este paciente aún no tiene citas registradas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.map((apt) => (
            <AppointmentRow
              key={apt.id}
              apt={apt}
              onClick={() => {
                const name = apt.status?.name;
                if (name === 'cancelada' || name === 'no_asistio') return;
                navigate(`/panel/consulta/${apt.id}`);
              }}
            />
          ))}
        </div>
      )}

      {/* Modal de edición */}
      <EditPatientModal
        isOpen={editOpen}
        patient={patient}
        isSubmitting={updateMutation.isPending}
        errorMessage={updateMutation.error ? friendlyErrorMessage(updateMutation.error) : null}
        onClose={() => setEditOpen(false)}
        onSubmit={handleSubmitEdit}
      />

      {/* Modal de confirmación de inactivación */}
      {confirmInactivate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmInactivate(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Inactivar paciente</h3>
                <p className="text-sm text-gray-600 mt-1">
                  El paciente quedará oculto en búsquedas y listas, pero su historial
                  clínico y citas se preservan completos. Podrás reactivarlo después
                  desde la lista marcando "Mostrar inactivos".
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={() => setConfirmInactivate(false)}
                disabled={setActiveMutation.isPending}
                className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveMutation.mutate(false, {
                    onSuccess: () => setConfirmInactivate(false),
                  });
                }}
                disabled={setActiveMutation.isPending}
                className="px-4 py-2.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-xl disabled:opacity-50"
              >
                {setActiveMutation.isPending ? 'Inactivando...' : 'Sí, inactivar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function AppointmentRow({
  apt,
  onClick,
}: {
  apt: PatientAppointment;
  onClick: () => void;
}) {
  const date = new Date(apt.start_time);
  const dateStr = date.toLocaleDateString('es-SV', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('es-SV', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const color = apt.status?.color ?? '#94a3b8';
  const name = apt.status?.name;
  const isClickable = name !== 'cancelada' && name !== 'no_asistio';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      title={isClickable ? 'Abrir consulta' : 'Sin consulta (cita no atendida)'}
      className={`w-full text-left bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3 transition-colors ${
        isClickable ? 'hover:border-emerald-300 hover:bg-emerald-50/30 cursor-pointer' : 'opacity-70 cursor-not-allowed'
      }`}
    >
      <div
        className="w-1 h-10 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium text-gray-900">{dateStr}</p>
          <p className="text-xs text-gray-500">{timeStr}</p>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          {apt.service?.name ?? 'Sin servicio'}
          {apt.notes ? ` · ${apt.notes}` : ''}
        </p>
      </div>
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white flex-shrink-0"
        style={{ backgroundColor: color }}
      >
        {apt.status?.display_name ?? '—'}
      </span>
      {isClickable && (
        <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
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

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function documentLabel(type: string): string {
  const map: Record<string, string> = {
    dui: 'DUI',
    pasaporte: 'Pasaporte',
    partida_nacimiento: 'Partida',
    carnet_residente: 'Carnet residente',
  };
  return map[type] ?? type;
}

function computeStats(appointments: PatientAppointment[]) {
  const stats = {
    total: appointments.length,
    atendidas: 0,
    canceladas: 0,
    no_asistio: 0,
  };
  for (const apt of appointments) {
    const name = apt.status?.name;
    if (name === 'atendida') stats.atendidas++;
    else if (name === 'cancelada') stats.canceladas++;
    else if (name === 'no_asistio') stats.no_asistio++;
  }
  return stats;
}
