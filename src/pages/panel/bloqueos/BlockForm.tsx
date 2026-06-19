// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/bloqueos/BlockForm.tsx
// ACCIÓN: NUEVO — crear archivo en carpeta bloqueos
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useBlockTypes } from '@/hooks/overrides.hooks';
import type { AvailabilityOverride, CreateOverrideInput } from '@/services/overrides.service';

// ─── Iconos inline ───────────────────────────────────────────────────
const CalendarIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const XIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ─── Props ───────────────────────────────────────────────────────────
interface BlockFormProps {
  doctorId: string;
  clinicId: string;
  editingBlock?: AvailabilityOverride | null;
  onSubmit: (input: CreateOverrideInput) => void;
  onCancel: () => void;
  isLoading?: boolean;
  appointmentsWarning?: number;
}

export default function BlockForm({
  doctorId,
  clinicId,
  editingBlock,
  onSubmit,
  onCancel,
  isLoading = false,
  appointmentsWarning = 0,
}: BlockFormProps) {
  const { data: blockTypes = [], isLoading: loadingTypes } = useBlockTypes();

  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [timeStart, setTimeStart] = useState('09:00');
  const [timeEnd, setTimeEnd] = useState('12:00');
  const [blockTypeId, setBlockTypeId] = useState('');
  const [description, setDescription] = useState('');

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (editingBlock) {
      setDateStart(editingBlock.date_start);
      setDateEnd(editingBlock.date_end);
      setAllDay(!editingBlock.time_start);
      setTimeStart(editingBlock.time_start?.slice(0, 5) ?? '09:00');
      setTimeEnd(editingBlock.time_end?.slice(0, 5) ?? '12:00');
      setBlockTypeId(editingBlock.block_type_id ?? '');
      setDescription(editingBlock.description ?? '');
    }
  }, [editingBlock]);

  useEffect(() => {
    if (dateStart && (!dateEnd || dateEnd < dateStart)) {
      setDateEnd(dateStart);
    }
  }, [dateStart]);

  const isValid =
    dateStart &&
    dateEnd &&
    dateStart <= dateEnd &&
    blockTypeId &&
    (allDay || (timeStart && timeEnd && timeStart < timeEnd));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;

    onSubmit({
      doctor_id: doctorId,
      clinic_id: clinicId,
      date_start: dateStart,
      date_end: dateEnd,
      time_start: allDay ? null : `${timeStart}:00`,
      time_end: allDay ? null : `${timeEnd}:00`,
      is_blocked: true,
      block_type_id: blockTypeId || null,
      description: description.trim() || null,
    });
  }

  const daysDiff = dateStart && dateEnd
    ? Math.ceil(
        (new Date(dateEnd).getTime() - new Date(dateStart).getTime()) / (1000 * 60 * 60 * 24)
      ) + 1
    : 0;

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900">
          {editingBlock ? 'Editar bloqueo' : 'Nuevo bloqueo de agenda'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <XIcon />
        </button>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Tipo de bloqueo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tipo de bloqueo *
          </label>
          {loadingTypes ? (
            <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {blockTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setBlockTypeId(type.id)}
                  className={`min-h-[2.75rem] px-3 sm:px-4 py-2.5 rounded-lg text-sm font-medium border transition-all flex items-center justify-center text-center leading-tight break-words ${
                    blockTypeId === type.id
                      ? 'bg-blue-50 border-blue-300 text-blue-700 ring-1 ring-blue-200'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  <span>{getBlockTypeEmoji(type.name)} {type.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fechas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <span className="flex items-center gap-1.5">
                <CalendarIcon /> Fecha inicio *
              </span>
            </label>
            <input
              type="date"
              value={dateStart}
              min={today}
              onChange={(e) => setDateStart(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm
                focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <span className="flex items-center gap-1.5">
                <CalendarIcon /> Fecha fin *
              </span>
            </label>
            <input
              type="date"
              value={dateEnd}
              min={dateStart || today}
              onChange={(e) => setDateEnd(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm
                focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              required
            />
          </div>
        </div>

        {/* Badge resumen */}
        {daysDiff > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
              {daysDiff} {daysDiff === 1 ? 'día' : 'días'}
            </span>
            <span className="text-gray-400">
              {dateStart === dateEnd
                ? formatDateHuman(dateStart)
                : `${formatDateHuman(dateStart)} → ${formatDateHuman(dateEnd)}`}
            </span>
          </div>
        )}

        {/* Todo el día */}
        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Todo el día</span>
          </label>
        </div>

        {/* Horas */}
        {!allDay && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:pl-7">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="flex items-center gap-1.5"><ClockIcon /> Hora inicio</span>
              </label>
              <input
                type="time"
                value={timeStart}
                onChange={(e) => setTimeStart(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm
                  focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                <span className="flex items-center gap-1.5"><ClockIcon /> Hora fin</span>
              </label>
              <input
                type="time"
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm
                  focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              />
            </div>
          </div>
        )}

        {/* Descripción */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Nota (opcional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Congreso de cardiología en Guatemala"
            maxLength={200}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm placeholder:text-gray-400
              focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
          />
        </div>

        {/* Warning citas existentes */}
        {appointmentsWarning > 0 && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-amber-500 text-xl leading-none mt-0.5">⚠️</span>
            <div>
              <p className="text-sm font-medium text-amber-800">
                Hay {appointmentsWarning} cita{appointmentsWarning > 1 ? 's' : ''} agendada{appointmentsWarning > 1 ? 's' : ''} en este rango
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Al bloquear estos días, las citas existentes no se cancelan automáticamente. Deberás gestionarlas manualmente.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-xl">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          disabled={isLoading}
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!isValid || isLoading}
          className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {isLoading && (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {editingBlock ? 'Guardar cambios' : 'Crear bloqueo'}
        </button>
      </div>
    </form>
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

function formatDateHuman(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' });
}
