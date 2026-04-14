// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/bloqueos/BlockList.tsx
// ACCIÓN: NUEVO — crear archivo en carpeta bloqueos
// ═══════════════════════════════════════════════════════════

import type { AvailabilityOverride } from '@/services/overrides.service';

// ─── Iconos ──────────────────────────────────────────────────────────
const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const PencilIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
  </svg>
);

const CalendarXIcon = () => (
  <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
);

// ─── Props ───────────────────────────────────────────────────────────
interface BlockListProps {
  overrides: AvailabilityOverride[];
  isLoading: boolean;
  onEdit: (override: AvailabilityOverride) => void;
  onDelete: (override: AvailabilityOverride) => void;
  deletingId?: string | null;
}

export default function BlockList({
  overrides,
  isLoading,
  onEdit,
  onDelete,
  deletingId,
}: BlockListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (overrides.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <CalendarXIcon />
        <h3 className="mt-4 text-base font-medium text-gray-900">Sin bloqueos programados</h3>
        <p className="mt-1.5 text-sm text-gray-500 text-center max-w-sm">
          No tienes días bloqueados próximamente. Usa el botón de arriba para bloquear vacaciones, congresos u otros días no disponibles.
        </p>
      </div>
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const active = overrides.filter((o) => o.date_start <= today && o.date_end >= today);
  const upcoming = overrides.filter((o) => o.date_start > today);
  const past = overrides.filter((o) => o.date_end < today);

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <Section title="En curso" badge={active.length} badgeColor="red">
          {active.map((override) => (
            <BlockCard key={override.id} override={override} status="active" onEdit={onEdit} onDelete={onDelete} isDeleting={deletingId === override.id} />
          ))}
        </Section>
      )}
      {upcoming.length > 0 && (
        <Section title="Próximos" badge={upcoming.length} badgeColor="blue">
          {upcoming.map((override) => (
            <BlockCard key={override.id} override={override} status="upcoming" onEdit={onEdit} onDelete={onDelete} isDeleting={deletingId === override.id} />
          ))}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Pasados" badge={past.length} badgeColor="gray">
          {past.map((override) => (
            <BlockCard key={override.id} override={override} status="past" onEdit={onEdit} onDelete={onDelete} isDeleting={deletingId === override.id} />
          ))}
        </Section>
      )}
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────

function Section({ title, badge, badgeColor, children }: {
  title: string; badge: number; badgeColor: 'red' | 'blue' | 'gray'; children: React.ReactNode;
}) {
  const colors = { red: 'bg-red-100 text-red-700', blue: 'bg-blue-100 text-blue-700', gray: 'bg-gray-100 text-gray-600' };
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h4>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[badgeColor]}`}>{badge}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function BlockCard({ override, status, onEdit, onDelete, isDeleting }: {
  override: AvailabilityOverride; status: 'active' | 'upcoming' | 'past';
  onEdit: (o: AvailabilityOverride) => void; onDelete: (o: AvailabilityOverride) => void; isDeleting: boolean;
}) {
  const isSingleDay = override.date_start === override.date_end;
  const isAllDay = !override.time_start;
  const isPast = status === 'past';
  const typeName = override.block_type?.name ?? 'Bloqueo';
  const days = isSingleDay ? 1 : Math.ceil((new Date(override.date_end).getTime() - new Date(override.date_start).getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const accentColor = getTypeAccentColor(typeName);

  return (
    <div className={`group bg-white rounded-lg border transition-all ${
      isPast ? 'border-gray-150 opacity-60' : status === 'active' ? 'border-red-200 bg-red-50/30' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
    }`}>
      <div className="flex items-start gap-3 p-4">
        <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg ${accentColor}`}>
          {getBlockTypeEmoji(typeName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{typeName}</p>
            {status === 'active' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700">Activo</span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-0.5">
            {isSingleDay ? formatDateFull(override.date_start) : (
              <>{formatDateShort(override.date_start)} → {formatDateShort(override.date_end)} <span className="text-gray-400 ml-1.5">({days} días)</span></>
            )}
          </p>
          {!isAllDay && <p className="text-xs text-gray-500 mt-0.5">{override.time_start?.slice(0, 5)} - {override.time_end?.slice(0, 5)}</p>}
          {override.description && <p className="text-xs text-gray-400 mt-1 italic truncate">{override.description}</p>}
        </div>
        {!isPast && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(override)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar"><PencilIcon /></button>
            <button onClick={() => onDelete(override)} disabled={isDeleting} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50" title="Eliminar">
              {isDeleting ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : <TrashIcon />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getBlockTypeEmoji(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('vacacion')) return '🏖️';
  if (lower.includes('congreso') || lower.includes('capacitación')) return '📚';
  if (lower.includes('almuerzo')) return '🍽️';
  if (lower.includes('emergencia')) return '🚨';
  if (lower.includes('personal')) return '👤';
  if (lower.includes('feriado')) return '🎉';
  return '📌';
}

function getTypeAccentColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('vacacion')) return 'bg-emerald-100';
  if (lower.includes('congreso') || lower.includes('capacitación')) return 'bg-purple-100';
  if (lower.includes('almuerzo')) return 'bg-amber-100';
  if (lower.includes('emergencia')) return 'bg-red-100';
  return 'bg-gray-100';
}

function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
}
