import { Link } from 'react-router-dom';
import { useDoctorActivation } from '@/hooks/useDoctorActivation';

/**
 * Tarjeta "Primeros pasos para activar tu perfil" (Onboarding PR-2).
 *
 * Guía al médico para quedar visible y reservable. Consume el read model de
 * PR-1 (`useDoctorActivation`) — SOLO LECTURA, los pasos se marcan por señal
 * real (no checkbox manual).
 *
 * Reglas (gate visual, sobre el gate de datos de PR-1):
 *  - Se muestra SOLO si `role === 'doctor'` (nunca asistente/admin/paciente/null).
 *    `doctorId` por sí solo NO es criterio.
 *  - Solo cuenta el progreso de los 5 pasos self-service. `clinicStatus` es info
 *    NO bloqueante (datos que edita LucyAdmin) → se muestra discreto, aparte.
 *  - Se OCULTA cuando `allDone` (V1: no saturar), o ante payload vacío/error/carga.
 *  - Reemplaza el banner de "Completá tu perfil con una foto" (la foto es parte
 *    del paso "Completá tu perfil") para no duplicar mensajes.
 */
export default function DoctorActivationCard({
  doctorId,
  clinicId,
  role,
}: {
  doctorId?: string | null;
  clinicId?: string | null;
  role?: 'doctor' | 'assistant' | undefined;
}) {
  const { data, isLoading, isError } = useDoctorActivation(doctorId, clinicId, role);

  // Gate visual: solo médico, nunca error técnico, oculta si todo listo/vacío.
  if (role !== 'doctor') return null;
  if (isLoading || isError || !data) return null;
  if (data.total === 0) return null; // payload vacío / no-médico
  if (data.allDone) return null; // perfil ya activo → no mostrar

  const { steps, completedCount, total, clinicStatus } = data;
  const pct = Math.round((completedCount / total) * 100);

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5">
      <header className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
          <i className="ri-rocket-2-line text-xl text-emerald-700" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-900">Primeros pasos para activar tu perfil</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Completá estos pasos para quedar visible y reservable para tus pacientes.
          </p>
        </div>
      </header>

      {/* Progreso */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="font-medium text-gray-700">
            {completedCount} de {total} pasos listos
          </span>
          <span className="text-gray-400">{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-2 bg-emerald-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Pasos self-service */}
      <ul className="space-y-2">
        {steps.map((s) => (
          <li
            key={s.key}
            className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5"
          >
            {s.done ? (
              <i className="ri-checkbox-circle-fill text-lg text-emerald-600 flex-shrink-0" />
            ) : (
              <i className="ri-checkbox-blank-circle-line text-lg text-gray-300 flex-shrink-0" />
            )}
            <span
              className={`flex-1 min-w-0 text-sm ${
                s.done ? 'text-gray-500' : 'text-gray-800 font-medium'
              }`}
            >
              {s.label}
            </span>
            {s.done ? (
              <span className="text-xs text-emerald-600 font-medium flex-shrink-0">Listo</span>
            ) : (
              <Link
                to={s.href}
                className="text-xs font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap flex-shrink-0"
              >
                Ir <i className="ri-arrow-right-line align-middle" />
              </Link>
            )}
          </li>
        ))}
      </ul>

      {/* clinicStatus: info NO bloqueante, discreta. Solo si está incompleta. */}
      {!clinicStatus.complete && clinicStatus.message && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
          <i className="ri-information-line text-gray-400 mt-0.5 flex-shrink-0" />
          <span>{clinicStatus.message}</span>
        </p>
      )}
    </section>
  );
}
