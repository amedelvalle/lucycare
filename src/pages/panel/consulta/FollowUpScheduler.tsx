import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useDoctorInfo,
  useNextAppointment,
  useDayBusySlots,
  useCreateFollowUp,
} from '@/hooks/useFollowUp';
import Button from '@/components/ui/Button';

interface Props {
  patientId: string;
  doctorId: string;
  clinicId: string;
  /**
   * Fecha de la cita actual (la consulta actual). El "siguiente" se busca
   * estrictamente después de este timestamp.
   */
  currentAppointmentStart: string;
  patientName: string;
}

type Preset = 'two_weeks' | 'one_month' | 'three_months' | 'custom';

/**
 * UI inline para agendar la próxima cita del paciente sin salir de la consulta.
 *
 * Estados:
 *   1. Hay cita futura agendada → muestra confirmación + acciones
 *   2. No hay cita y no se está editando → CTA "Agendar próxima cita"
 *   3. Editando → form con presets, fecha, hora (slot picker), servicio, notas
 */
export default function FollowUpScheduler({
  patientId,
  doctorId,
  clinicId,
  currentAppointmentStart,
  patientName,
}: Props) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const { data: nextAppt } = useNextAppointment(patientId, doctorId, currentAppointmentStart);

  if (nextAppt && !editing) {
    return <ScheduledCard nextAppt={nextAppt} onEdit={() => setEditing(true)} onView={() => navigate('/panel/citas')} />;
  }

  if (editing || !nextAppt) {
    return (
      <SchedulerForm
        patientId={patientId}
        doctorId={doctorId}
        clinicId={clinicId}
        patientName={patientName}
        currentAppointmentStart={currentAppointmentStart}
        // Mostrar CTA inicial vs form expandido
        startCollapsed={!editing && !nextAppt}
        onCancel={() => setEditing(false)}
        onSuccess={() => setEditing(false)}
      />
    );
  }

  return null;
}

// ─── Card: cita ya agendada ──────────────────────────────────────────

function ScheduledCard({
  nextAppt,
  onEdit,
  onView,
}: {
  nextAppt: { id: string; start_time: string; end_time: string; service_name: string | null };
  onEdit: () => void;
  onView: () => void;
}) {
  const date = new Date(nextAppt.start_time);
  const dateStr = date.toLocaleDateString('es-SV', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('es-SV', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
        <svg className="w-5 h-5 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-emerald-900">Próxima cita agendada</p>
        <p className="text-sm text-emerald-800 capitalize mt-0.5">{dateStr}</p>
        <p className="text-sm text-emerald-700">
          {timeStr}
          {nextAppt.service_name ? ` · ${nextAppt.service_name}` : ''}
        </p>
        <div className="flex gap-3 mt-2 text-xs">
          <button type="button" onClick={onEdit} className="text-emerald-700 hover:text-emerald-900 font-medium underline">
            Cambiar fecha/hora
          </button>
          <button type="button" onClick={onView} className="text-emerald-700 hover:text-emerald-900 font-medium underline">
            Ver en agenda
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────

function SchedulerForm({
  patientId,
  doctorId,
  clinicId,
  patientName,
  currentAppointmentStart,
  startCollapsed,
  onCancel,
  onSuccess,
}: {
  patientId: string;
  doctorId: string;
  clinicId: string;
  patientName: string;
  currentAppointmentStart: string;
  startCollapsed: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [expanded, setExpanded] = useState(!startCollapsed);
  const [preset, setPreset] = useState<Preset>('one_month');
  const [date, setDate] = useState(() => addDaysFromIso(currentAppointmentStart, 30));
  const [time, setTime] = useState('10:00');
  const [serviceId, setServiceId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: doctorInfo } = useDoctorInfo(doctorId);
  const { data: busySlots = [] } = useDayBusySlots(doctorId, date);
  const createMutation = useCreateFollowUp(patientId, doctorId);

  // Auto-seleccionar primer servicio cuando se cargan
  useEffect(() => {
    if (doctorInfo?.services && doctorInfo.services.length > 0 && !serviceId) {
      const followUp = doctorInfo.services.find((s) => /seguimiento/i.test(s.name));
      setServiceId(followUp?.id ?? doctorInfo.services[0].id);
    }
  }, [doctorInfo?.services, serviceId]);

  const handlePreset = (p: Preset) => {
    setPreset(p);
    if (p === 'two_weeks') setDate(addDaysFromIso(currentAppointmentStart, 14));
    else if (p === 'one_month') setDate(addDaysFromIso(currentAppointmentStart, 30));
    else if (p === 'three_months') setDate(addDaysFromIso(currentAppointmentStart, 90));
  };

  // Slots de 30 min entre 8AM-6PM, marcando los ocupados
  const slots = useMemo(() => generateDaySlots(date, busySlots), [date, busySlots]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const service = doctorInfo?.services.find((s) => s.id === serviceId);
    const duration = service?.duration_minutes ?? 30;

    const startDt = combineDateTime(date, time);
    const endDt = new Date(startDt.getTime() + duration * 60 * 1000);

    try {
      await createMutation.mutateAsync({
        doctorId,
        clinicId,
        patientId,
        startTime: startDt.toISOString(),
        endTime: endDt.toISOString(),
        serviceId: serviceId || undefined,
        notes: notes || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agendar');
    }
  };

  if (!expanded) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">Próxima cita</p>
          <p className="text-xs text-gray-500 mt-0.5">
            ¿Querés agendar el seguimiento de {patientName} ahora?
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setExpanded(true)}>
          Agendar
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-sm font-semibold text-gray-900">Agendar próxima cita</p>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        <PresetChip active={preset === 'two_weeks'} onClick={() => handlePreset('two_weeks')}>
          En 2 semanas
        </PresetChip>
        <PresetChip active={preset === 'one_month'} onClick={() => handlePreset('one_month')}>
          En 1 mes
        </PresetChip>
        <PresetChip active={preset === 'three_months'} onClick={() => handlePreset('three_months')}>
          En 3 meses
        </PresetChip>
        <PresetChip active={preset === 'custom'} onClick={() => setPreset('custom')}>
          Personalizada
        </PresetChip>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Fecha">
            <input
              type="date"
              value={date}
              min={dateOnly(new Date())}
              onChange={(e) => {
                setDate(e.target.value);
                setPreset('custom');
              }}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Hora">
            <select value={time} onChange={(e) => setTime(e.target.value)} className={inputCls}>
              {slots.map((s) => (
                <option key={s.time} value={s.time} disabled={!s.available}>
                  {s.label}
                  {!s.available ? ' — ocupado' : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Servicio">
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className={inputCls}
          >
            {(doctorInfo?.services ?? []).length === 0 && <option value="">Sin servicios configurados</option>}
            {(doctorInfo?.services ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.duration_minutes} min)
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notas para el paciente (opcional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Traer resultados de laboratorio"
            className={inputCls}
          />
        </Field>

        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="secondary"
            onClick={() => {
              if (!startCollapsed) onCancel();
              else setExpanded(false);
            }}
            disabled={createMutation.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" loading={createMutation.isPending} disabled={!serviceId}>
            Agendar cita
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function PresetChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
        active
          ? 'bg-emerald-600 text-white'
          : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';

// ─── Helpers ──────────────────────────────────────────────────────────

function dateOnly(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysFromIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return dateOnly(d);
}

function combineDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00`);
}

interface SlotOption {
  time: string; // 'HH:mm'
  label: string;
  available: boolean;
}

function generateDaySlots(
  dateStr: string,
  busy: Array<{ start: string; end: string }>
): SlotOption[] {
  const slots: SlotOption[] = [];
  const busyRanges = busy.map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));

  for (let h = 8; h < 18; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const time = `${hh}:${mm}`;
      const startDt = new Date(`${dateStr}T${time}:00`);
      const endDt = new Date(startDt.getTime() + 30 * 60 * 1000);
      const startTs = startDt.getTime();
      const endTs = endDt.getTime();
      const conflict = busyRanges.some((b) => startTs < b.end && endTs > b.start);

      const labelHour = h % 12 === 0 ? 12 : h % 12;
      const labelAmPm = h < 12 ? 'AM' : 'PM';
      const label = `${labelHour}:${mm} ${labelAmPm}`;

      slots.push({ time, label, available: !conflict });
    }
  }
  return slots;
}
