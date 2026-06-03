import { useState } from 'react';
import { useClinicContext } from '@/hooks/useClinicContext';
import {
  useTeamMembers,
  usePendingInvitations,
  useInviteMember,
  useCancelInvitation,
  useSetMemberActive,
} from '@/hooks/useTeam';
import { normalizePhone, isValidPhone } from '@/services/team.service';
import type { TeamMember, PendingInvitation } from '@/services/team.service';
import Button from '@/components/ui/Button';

export default function EquipoPage() {
  const { data: ctx, isLoading: loadingCtx } = useClinicContext();
  const [showInvite, setShowInvite] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  if (loadingCtx) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!ctx || ctx.role !== 'doctor') {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-700">
            Solo el médico de la clínica puede gestionar el equipo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header con contador de cupos */}
      <TeamHeader clinicId={ctx.clinicId} onInvite={() => setShowInvite(true)} />

      <PendingInvitationsList clinicId={ctx.clinicId} />

      <ActiveMembersList clinicId={ctx.clinicId} />

      <InactiveMembersToggle
        clinicId={ctx.clinicId}
        showInactive={showInactive}
        onToggle={() => setShowInactive(!showInactive)}
      />

      {showInvite && (
        <InviteModal clinicId={ctx.clinicId} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}

// ─── Sub-secciones ────────────────────────────────────────────────────

// Límite de asistentes incluidos en el plan base. Refleja
// team_seat_limit() del backend (Fase 1 = fijo en 2). El servidor es la
// fuente de verdad (trigger trg_enforce_team_seat_limit en s7_27); este
// número solo alimenta el contador y el disable de la UI.
const INCLUDED_ASSISTANTS = 2;

function TeamHeader({ clinicId, onInvite }: { clinicId: string; onInvite: () => void }) {
  const { data: members = [] } = useTeamMembers(clinicId);
  const { data: pending = [] } = usePendingInvitations(clinicId);

  // Conteo (D2): asistentes activos + invitaciones pendientes.
  const activeAssistants = members.filter((m) => m.role === 'assistant' && m.is_active).length;
  const used = activeAssistants + pending.length;
  const atLimit = used >= INCLUDED_ASSISTANTS;

  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mi equipo</h1>
          <p className="text-sm text-gray-500 mt-1">
            Personas con acceso a tu clínica. Las asistentes pueden gestionar
            citas y pacientes pero no firman consultas.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button
            variant="primary"
            leftIcon={<PlusIcon />}
            onClick={onInvite}
            disabled={atLimit}
          >
            Invitar asistente
          </Button>
          <span className="text-xs font-medium text-gray-600">
            {used}/{INCLUDED_ASSISTANTS} asistentes usados
          </span>
        </div>
      </div>

      {atLimit && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          Tu plan incluye hasta {INCLUDED_ASSISTANTS} asistentes. Para sumar más vas a poder
          contratar usuarios adicionales cuando habilitemos los planes.
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-1.5">
        El conteo incluye asistentes activos e invitaciones pendientes.
      </p>
    </div>
  );
}

function PendingInvitationsList({ clinicId }: { clinicId: string }) {
  const { data: pending = [] } = usePendingInvitations(clinicId);
  const cancelMutation = useCancelInvitation(clinicId);

  if (pending.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
        Invitaciones pendientes ({pending.length})
      </h2>
      <ul className="space-y-2">
        {pending.map((inv) => (
          <li
            key={inv.id}
            className="bg-amber-50/50 border border-amber-200 rounded-lg p-3 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {inv.display_name || inv.phone}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {inv.display_name ? `${inv.phone} · ` : ''}
                Esperando que ingrese con OTP · {formatRelative(inv.invited_at)}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => cancelMutation.mutate(inv.id)}
              disabled={cancelMutation.isPending}
            >
              Cancelar
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActiveMembersList({ clinicId }: { clinicId: string }) {
  const { data: members = [], isLoading } = useTeamMembers(clinicId);
  const setActiveMutation = useSetMemberActive(clinicId);
  const active = members.filter((m) => m.is_active);

  if (isLoading) {
    return <div className="h-24 bg-gray-100 rounded animate-pulse mb-6" />;
  }

  if (active.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
        <p className="text-sm text-gray-500">Aún no tenés equipo activo.</p>
      </div>
    );
  }

  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
        Activos ({active.length})
      </h2>
      <ul className="space-y-2">
        {active.map((m) => (
          <MemberRow
            key={m.member_id}
            member={m}
            onToggleActive={(isActive) =>
              setActiveMutation.mutate({ memberId: m.member_id, isActive })
            }
            isPending={setActiveMutation.isPending}
          />
        ))}
      </ul>
    </section>
  );
}

function InactiveMembersToggle({
  clinicId,
  showInactive,
  onToggle,
}: {
  clinicId: string;
  showInactive: boolean;
  onToggle: () => void;
}) {
  const { data: members = [] } = useTeamMembers(clinicId);
  const setActiveMutation = useSetMemberActive(clinicId);
  const inactive = members.filter((m) => !m.is_active);

  if (inactive.length === 0) return null;

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
      >
        <svg
          className={`w-4 h-4 transition-transform ${showInactive ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {showInactive ? 'Ocultar' : 'Mostrar'} inactivos ({inactive.length})
      </button>

      {showInactive && (
        <ul className="space-y-2 mt-3">
          {inactive.map((m) => (
            <MemberRow
              key={m.member_id}
              member={m}
              onToggleActive={(isActive) =>
                setActiveMutation.mutate({ memberId: m.member_id, isActive })
              }
              isPending={setActiveMutation.isPending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MemberRow({
  member,
  onToggleActive,
  isPending,
}: {
  member: TeamMember;
  onToggleActive: (isActive: boolean) => void;
  isPending: boolean;
}) {
  const initials = getInitials(member.full_name);
  const roleLabel =
    member.role === 'owner' ? 'Dueño' : member.role === 'doctor' ? 'Doctor' : 'Asistente';
  const canDeactivate = member.role !== 'owner' && member.role !== 'doctor';

  return (
    <li
      className={`bg-white rounded-lg border p-3 flex items-center gap-3 ${
        member.is_active ? 'border-gray-200' : 'border-gray-200 opacity-60'
      }`}
    >
      <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{member.full_name}</p>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              member.role === 'doctor' || member.role === 'owner'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-blue-50 text-blue-700'
            }`}
          >
            {roleLabel}
          </span>
          {!member.is_active && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
              Inactivo
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {member.phone || 'Sin teléfono'}
          {member.email ? ` · ${member.email}` : ''}
        </p>
      </div>

      {canDeactivate && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onToggleActive(!member.is_active)}
          disabled={isPending}
        >
          {member.is_active ? 'Inactivar' : 'Reactivar'}
        </Button>
      )}
    </li>
  );
}

// ─── Modal de invitación ──────────────────────────────────────────────

function InviteModal({ clinicId, onClose }: { clinicId: string; onClose: () => void }) {
  const [phone, setPhone] = useState('+503 ');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inviteMutation = useInviteMember(clinicId);

  const normalized = normalizePhone(phone);
  const valid = isValidPhone(normalized);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!valid) {
      setError('Teléfono inválido. Formato: +503 seguido de 8 dígitos');
      return;
    }
    try {
      await inviteMutation.mutateAsync({ phone: normalized, displayName: name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo invitar');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
      >
        <h3 className="text-base font-semibold text-gray-900">Invitar asistente</h3>
        <p className="text-sm text-gray-600">
          La asistente recibe acceso al panel ingresando con su teléfono vía OTP.
          Va a poder gestionar citas y pacientes pero no firmar consultas.
        </p>

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">
            Teléfono <span className="text-red-500">*</span>
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+503 7777 8888"
            className={`w-full text-sm border rounded-lg px-3 py-2 bg-white text-gray-800 outline-none focus:ring-2 ${
              valid || phone.trim() === '+503' || phone.trim() === '' || phone.trim() === '+503 '
                ? 'border-gray-200 focus:ring-emerald-200 focus:border-emerald-400'
                : 'border-amber-300 focus:ring-amber-200 focus:border-amber-400'
            }`}
            required
          />
          <p className="text-[11px] text-gray-400 mt-1">
            {valid ? `Se enviará a ${normalized}` : 'Formato: +503 7777 8888'}
          </p>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">
            Nombre (opcional)
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: María García"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            Para identificar la invitación mientras está pendiente
          </p>
        </label>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 flex items-start gap-2">
          <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-blue-800">
            Avisale a tu asistente que entre a Lucy con este teléfono. Apenas
            inicie sesión con OTP, queda activa en tu equipo automáticamente.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={inviteMutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={inviteMutation.isPending} disabled={!valid}>
            Enviar invitación
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}
