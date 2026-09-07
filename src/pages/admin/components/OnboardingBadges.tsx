/**
 * Insignias y tarjeta de onboarding (DOCTOR-ONBOARDING-READINESS-P0).
 *
 * Todo lo que se muestra acá es DERIVADO por `admin_doctors_onboarding`. No
 * hay ninguna acción para "marcar" onboarding: no existe estado que marcar.
 *
 * `stage` y `bookingReady` son conceptos SEPARADOS y se muestran por separado
 * a propósito: un médico puede estar en `profile_incomplete` y ser reservable,
 * y uno `complete` puede NO estar listo para reservas. Nunca se combinan en un
 * solo indicador.
 */
import type { DoctorOnboarding, OnboardingStage } from '../../../services/admin.service';
import {
  ONBOARDING_STAGE_LABEL,
  ONBOARDING_NEXT_ACTION_LABEL,
  PROFILE_FIELD_LABEL,
} from '../../../services/admin.service';

const STAGE_COLOR: Record<OnboardingStage, string> = {
  not_published: 'bg-gray-100 text-gray-700',
  pending_claim: 'bg-amber-100 text-amber-800',
  pending_activation: 'bg-amber-100 text-amber-800',
  profile_incomplete: 'bg-blue-100 text-blue-800',
  services_missing: 'bg-blue-100 text-blue-800',
  availability_missing: 'bg-blue-100 text-blue-800',
  booking_disabled: 'bg-blue-100 text-blue-800',
  complete: 'bg-emerald-100 text-emerald-800',
};

/** Chip compacto para el listado. */
export function OnboardingChip({ o }: { o: DoctorOnboarding | undefined }) {
  if (!o) return <span className="text-[11px] text-gray-400">—</span>;
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_COLOR[o.stage]}`}
      title={ONBOARDING_NEXT_ACTION_LABEL[o.nextAction] || undefined}
    >
      {ONBOARDING_STAGE_LABEL[o.stage]}
    </span>
  );
}

/** Indicador de reservabilidad. Separado de la etapa, nunca mezclado. */
export function BookingReadyBadge({ ready }: { ready: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ready ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      <i className={ready ? 'ri-calendar-check-line' : 'ri-calendar-close-line'} />
      {ready ? 'Listo para reservas' : 'No listo para reservas'}
    </span>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-[13px] leading-6">
      <span className={done ? 'text-emerald-600' : 'text-gray-300'}>
        <i className={done ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} />
      </span>
      <span className={done ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
    </li>
  );
}

/** Rótulo de sección de la columna derecha. Sin tarjeta anidada. */
function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
      {children}
    </p>
  );
}

/**
 * Tarjeta de onboarding de la ficha del médico.
 *
 * Trae su propio encabezado para que los dos chips vivan en la misma línea que
 * el título: es lo que evita una tarjeta anidada y una fila entera solo para
 * las insignias.
 *
 * Layout: en escritorio, checklist a la izquierda (dos columnas) y detalle a la
 * derecha. En móvil todo cae a una sola columna, en el orden en que se lee.
 *
 * Cuando no falta nada —típicamente `complete`— la columna derecha NO se
 * renderiza y el checklist ocupa el ancho completo, en vez de dejar la mitad
 * de la tarjeta vacía.
 *
 * NO recibe props nuevas ni dispara consultas: consume EXACTAMENTE el mismo
 * payload de `admin_doctors_onboarding` que la ficha ya tenía cargado.
 */
export function OnboardingCard({ o }: { o: DoctorOnboarding | undefined }) {
  const accion = o ? ONBOARDING_NEXT_ACTION_LABEL[o.nextAction] : '';
  const faltan = o ? o.profileMissing.map((k) => PROFILE_FIELD_LABEL[k] ?? k) : [];
  const hayDetalle = faltan.length > 0 || !!accion;

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Onboarding</h2>
        {o && (
          <div className="flex flex-wrap items-center gap-2">
            <OnboardingChip o={o} />
            <BookingReadyBadge ready={o.bookingReady} />
          </div>
        )}
      </div>

      {!o ? (
        <p className="mt-3 text-sm text-gray-500">Cargando onboarding…</p>
      ) : (
        <div
          className={`mt-4 grid gap-x-6 gap-y-4 ${
            hayDetalle ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]' : 'grid-cols-1'
          }`}
        >
          {/*
            Checklist · 1 columna en móvil, 2 desde `sm`.

            `grid-flow-col` con `grid-rows-4` es deliberado: el flujo por filas
            habría intercalado los pasos (Publicado | Perfil mínimo) y roto el
            orden de precedencia con el que la base evalúa las etapas. Así se
            lee hacia abajo la primera columna y luego la segunda, y en móvil
            —una sola columna— queda exactamente la misma secuencia.
          */}
          <ul className="grid grid-cols-1 sm:grid-cols-2 sm:grid-rows-4 sm:grid-flow-col gap-x-6">
            <Step done={o.checks.published} label="Publicado" />
            <Step done={o.checks.claimed} label="Reclamado" />
            <Step done={o.checks.activated} label="Habilitado" />
            <Step done={o.checks.profileMin} label="Perfil mínimo" />
            <Step done={o.checks.hasServices} label="Servicios" />
            <Step done={o.checks.hasAvailability} label="Horarios" />
            <Step done={o.checks.bookingEnabled} label="Agenda" />
          </ul>

          {hayDetalle && (
            <div className="space-y-3 md:border-l md:border-gray-100 md:pl-6">
              {faltan.length > 0 && (
                <div>
                  <Rotulo>Falta del perfil mínimo</Rotulo>
                  <p className="text-[13px] text-gray-700">{faltan.join(', ')}</p>
                </div>
              )}
              {accion && (
                <div>
                  <Rotulo>Próxima acción</Rotulo>
                  <p className="text-[13px] text-gray-700">{accion}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
