import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  updateAppointment,
  isAppointmentEditable,
  type AppointmentListItem,
} from '@/services/appointments.service';
import { getDoctorInfo } from '@/services/walkIn.service';
import {
  getAvailableSlots,
  selectableStartSlots,
  slotLocalHHMM,
} from '@/services/slots.service';
import { calendarKeys } from '@/hooks/useCalendarAppointments';
import { appointmentKeys } from '@/hooks/appointments.hooks';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  appointment: AppointmentListItem;
}

export default function EditAppointmentModal({ isOpen, onClose, appointment }: Props) {
  const queryClient = useQueryClient();
  const { minorOnly } = isAppointmentEditable(appointment.status?.name);

  const startDate = new Date(appointment.start_time);
  const initialDuration = Math.max(
    15,
    Math.round(
      (new Date(appointment.end_time).getTime() - startDate.getTime()) / 60000
    )
  );

  const [date, setDate] = useState(appointment.start_time.slice(0, 10));
  const [startTimeHHMM, setStartTimeHHMM] = useState(
    appointment.start_time.slice(11, 16)
  );
  const [serviceId, setServiceId] = useState(appointment.service?.id ?? '');
  const [durationMinutes, setDurationMinutes] = useState(initialDuration);
  const [notes, setNotes] = useState(appointment.notes ?? '');
  const [price, setPrice] = useState(
    appointment.price != null ? String(appointment.price) : ''
  );
  const [error, setError] = useState<string | null>(null);

  const { data: doctorInfo } = useQuery({
    queryKey: ['doctor-info-edit', appointment.doctor_id],
    queryFn: () => getDoctorInfo(appointment.doctor_id),
    enabled: isOpen && !!appointment.doctor_id,
    staleTime: 1000 * 60 * 5,
  });
  const services = doctorInfo?.services ?? [];

  // Al cambiar de servicio, ajustar duración a la del servicio
  useEffect(() => {
    const s = services.find((x) => x.id === serviceId);
    if (s) setDurationMinutes(s.duration_minutes);
  }, [serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: dayAvail } = useQuery({
    queryKey: ['edit-slots', appointment.doctor_id, date],
    queryFn: () => getAvailableSlots(appointment.doctor_id, date),
    enabled: isOpen && !minorOnly && !!date,
  });

  // El propio horario de esta cita no debe contar como "ocupado"
  const slotOptions = (() => {
    if (!dayAvail) return [];
    const apptStart = new Date(appointment.start_time).getTime();
    const apptEnd = new Date(appointment.end_time).getTime();
    const adjusted = {
      ...dayAvail,
      slots: dayAvail.slots.map((sl) => {
        const s = new Date(sl.startTime).getTime();
        const e = new Date(sl.endTime).getTime();
        const overlapsSelf = s < apptEnd && e > apptStart;
        return overlapsSelf ? { ...sl, available: true } : sl;
      }),
    };
    return selectableStartSlots(adjusted, durationMinutes);
  })();

  // Mantener la hora seleccionada válida
  useEffect(() => {
    if (minorOnly || slotOptions.length === 0) return;
    const valid = slotOptions.some((s) => slotLocalHHMM(s.startTime) === startTimeHHMM);
    if (!valid) setStartTimeHHMM(slotLocalHHMM(slotOptions[0].startTime));
  }, [slotOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: async () => {
      const parsedPrice = price !== '' ? parseFloat(price) : null;
      if (minorOnly) {
        return updateAppointment(appointment.id, {
          notes,
          price: parsedPrice != null && isNaN(parsedPrice) ? null : parsedPrice,
        });
      }
      const startDt = new Date(`${date}T${startTimeHHMM}:00`);
      const endDt = new Date(startDt.getTime() + durationMinutes * 60 * 1000);
      return updateAppointment(appointment.id, {
        startTime: startDt.toISOString(),
        endTime: endDt.toISOString(),
        serviceId: serviceId || null,
        notes,
        price: parsedPrice != null && isNaN(parsedPrice) ? null : parsedPrice,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.all });
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
      onClose();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la cita.');
    },
  });

  if (!isOpen) return null;

  const noSlots = !minorOnly && slotOptions.length === 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Editar cita</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-gray-500">
          {appointment.patient?.full_name}
          {minorOnly && ' · En sala: solo notas y precio'}
        </p>

        {!minorOnly && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fecha</label>
                <input
                  type="date"
                  value={date}
                  min={new Date().toLocaleDateString('en-CA')}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hora</label>
                {noSlots ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    No hay horarios disponibles para este médico en la fecha seleccionada.
                  </p>
                ) : (
                  <select
                    value={startTimeHHMM}
                    onChange={(e) => setStartTimeHHMM(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                  >
                    {slotOptions.map((s) => (
                      <option key={s.startTime} value={slotLocalHHMM(s.startTime)}>
                        {s.displayTime}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Servicio</label>
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
              >
                <option value="">Sin servicio ({durationMinutes} min)</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.duration_minutes} min)
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">Motivo / notas</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-y"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Precio ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => { setError(null); mutation.mutate(); }}
            disabled={mutation.isPending || noSlots}
            className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
          >
            {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
