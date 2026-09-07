/**
 * Insignias y checklist de onboarding (DOCTOR-ONBOARDING-READINESS-P0).
 *
 * Todo lo que se muestra acá es DERIVADO por `admin_doctors_onboarding`. No
 * hay ninguna acción para "marcar" onboarding: no existe estado que marcar.
 *
 * `stage` y `bookingReady` son conceptos SEPARADOS y se muestran por separado
 * a propósito: un médico puede estar en `profile_incomplete` y ser reservable.
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
    <li className="flex items-center gap-2 text-sm">
      <span className={done ? 'text-emerald-600' : 'text-gray-300'}>
        <i className={done ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} />
      </span>
      <span className={done ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
    </li>
  );
}

/** Checklist completo para la ficha del médico. */
export function OnboardingChecklist({ o }: { o: DoctorOnboarding | undefined }) {
  if (!o) {
    return <p className="text-sm text-gray-500">Cargando onboarding…</p>;
  }
  const c = o.checks;
  const accion = ONBOARDING_NEXT_ACTION_LABEL[o.nextAction];
  const faltan = o.profileMissing.map((k) => PROFILE_FIELD_LABEL[k] ?? k);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <OnboardingChip o={o} />
        <BookingReadyBadge ready={o.bookingReady} />
      </div>

      <ul className="space-y-1.5">
        <Step done={c.published} label="Publicado" />
        <Step done={c.claimed} label="Reclamado" />
        <Step done={c.activated} label="Habilitado" />
        <Step done={c.profileMin} label="Perfil mínimo" />
        <Step done={c.hasServices} label="Servicios" />
        <Step done={c.hasAvailability} label="Horarios" />
        <Step done={c.bookingEnabled} label="Agenda" />
      </ul>

      {faltan.length > 0 && (
        <p className="text-xs text-gray-500">
          Falta del perfil mínimo: {faltan.join(', ')}.
        </p>
      )}

      {accion && (
        <p className="text-sm text-gray-700">
          <span className="font-medium">Próxima acción:</span> {accion}
        </p>
      )}
    </div>
  );
}
