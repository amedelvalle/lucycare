import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getDoctorInfo,
  searchPatients,
  createWalkInPatient,
  createWalkInAppointment,
  type PatientSearchResult,
} from '@/services/walkIn.service';
import {
  getAvailableSlots,
  selectableStartSlots,
  slotLocalHHMM,
} from '@/services/slots.service';
import { calendarKeys } from '@/hooks/useCalendarAppointments';
import { appointmentKeys } from '@/hooks/appointments.hooks';

// ─── Constantes ───────────────────────────────────────────────────────
const DURATION_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1 hora', value: 60 },
  { label: '1h 30min', value: 90 },
  { label: '2 horas', value: 120 },
];

// ─── Props ────────────────────────────────────────────────────────────

interface CreateWalkInModalProps {
  isOpen: boolean;
  doctorId: string;
  defaultDate: string; // 'YYYY-MM-DD'
  onClose: () => void;
  onSuccess: () => void;
}

// ─── Componente ───────────────────────────────────────────────────────

export default function CreateWalkInModal({
  isOpen,
  doctorId,
  defaultDate,
  onClose,
  onSuccess,
}: CreateWalkInModalProps) {
  const queryClient = useQueryClient();

  // ── Estado del formulario ─────────────────────────────────────────
  const [patientQuery, setPatientQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');

  const [date, setDate] = useState(defaultDate);
  const [startTimeHHMM, setStartTimeHHMM] = useState('09:00');
  const [durationMinutes, setDurationMinutes] = useState(30);

  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState('');

  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLDivElement>(null);

  // ── Sincronizar fecha con el calendario cuando el modal abre ─────
  useEffect(() => {
    if (isOpen) {
      setDate(defaultDate);
      setError(null);
    }
  }, [isOpen, defaultDate]);

  // ── Debounce del query de búsqueda ────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(patientQuery), 300);
    return () => clearTimeout(t);
  }, [patientQuery]);

  // ── Cerrar dropdown al hacer click fuera ─────────────────────────
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Queries ───────────────────────────────────────────────────────
  const doctorInfoQuery = useQuery({
    queryKey: ['doctor-info-walkin', doctorId],
    queryFn: () => getDoctorInfo(doctorId),
    enabled: isOpen && !!doctorId,
    staleTime: 1000 * 60 * 5,
  });

  const clinicId = doctorInfoQuery.data?.clinicId;
  const services = doctorInfoQuery.data?.services ?? [];

  // Disponibilidad real del médico para la fecha (pasado / fuera de
  // disponibilidad / ocupado / bloqueos ya filtrados). El backend sigue
  // siendo la defensa final.
  const slotsQuery = useQuery({
    queryKey: ['walkin-slots', doctorId, date],
    queryFn: () => getAvailableSlots(doctorId, date),
    enabled: isOpen && !!doctorId && !!date,
  });

  const slotOptions =
    slotsQuery.data
      ? selectableStartSlots(slotsQuery.data, durationMinutes)
      : [];

  // Mantener la hora seleccionada dentro de los slots válidos
  useEffect(() => {
    if (slotOptions.length === 0) return;
    const valid = slotOptions.some(
      (s) => slotLocalHHMM(s.startTime) === startTimeHHMM
    );
    if (!valid) setStartTimeHHMM(slotLocalHHMM(slotOptions[0].startTime));
  }, [slotOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const patientSearchQuery = useQuery({
    queryKey: ['patient-search', clinicId, debouncedQuery],
    queryFn: () => searchPatients(clinicId!, debouncedQuery),
    enabled: isOpen && !!clinicId && debouncedQuery.length >= 2 && !selectedPatient,
  });

  // ── Mutation ──────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async () => {
      if (!clinicId) throw new Error('No se pudo obtener la clínica del médico.');

      // Resolver paciente
      let patientId: string;
      if (selectedPatient) {
        patientId = selectedPatient.id;
      } else if (isNewPatient && newPatientName.trim()) {
        patientId = await createWalkInPatient(clinicId, newPatientName, newPatientPhone);
      } else {
        throw new Error('Selecciona o crea un paciente.');
      }

      // Calcular endTime
      const startDt = new Date(`${date}T${startTimeHHMM}:00`);
      const endDt = new Date(startDt.getTime() + durationMinutes * 60 * 1000);

      // Precio final
      const parsedPrice = price !== '' ? parseFloat(price) : null;

      return createWalkInAppointment({
        doctorId,
        clinicId,
        patientId,
        startTime: startDt.toISOString(),
        endTime: endDt.toISOString(),
        serviceId: selectedServiceId || undefined,
        notes: notes || undefined,
        price: isNaN(parsedPrice!) ? null : parsedPrice,
      });
    },
    onSuccess: () => {
      // Invalidar queries del calendario y lista
      queryClient.invalidateQueries({ queryKey: calendarKeys.all });
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
      resetForm();
      onSuccess();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // ── Auto-rellenar duración y precio desde servicio ────────────────
  useEffect(() => {
    if (!selectedServiceId) return;
    const svc = services.find((s) => s.id === selectedServiceId);
    if (!svc) return;
    setDurationMinutes(svc.duration_minutes);
    if (svc.price != null) setPrice(String(svc.price));
  }, [selectedServiceId, services]);

  // ── Helpers ───────────────────────────────────────────────────────
  function resetForm() {
    setPatientQuery('');
    setDebouncedQuery('');
    setSelectedPatient(null);
    setIsNewPatient(false);
    setNewPatientName('');
    setNewPatientPhone('');
    setSelectedServiceId('');
    setNotes('');
    setPrice('');
    setStartHour(9);
    setStartMinute(0);
    setDurationMinutes(30);
    setError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleSelectPatient(p: PatientSearchResult) {
    setSelectedPatient(p);
    setPatientQuery(p.full_name);
    setShowResults(false);
    setIsNewPatient(false);
  }

  function handleClearPatient() {
    setSelectedPatient(null);
    setPatientQuery('');
    setIsNewPatient(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validación básica
    if (!selectedPatient && !(isNewPatient && newPatientName.trim())) {
      setError('Debes seleccionar o crear un paciente.');
      return;
    }
    if (!date) {
      setError('Selecciona una fecha.');
      return;
    }

    mutation.mutate();
  }

  const isLoading = doctorInfoQuery.isLoading;
  const isSubmitting = mutation.isPending;

  // ── Render ────────────────────────────────────────────────────────
  // Hooks siempre se ejecutan — el early return va AL FINAL
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-900">Nueva cita</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <svg className="w-6 h-6 text-emerald-500 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
            <div className="p-6 space-y-5">
              {/* ── Paciente ─────────────────────────────────── */}
              <section>
                <SectionLabel>Paciente</SectionLabel>

                {!isNewPatient ? (
                  <div ref={searchRef} className="relative">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Buscar paciente por nombre..."
                        value={patientQuery}
                        onChange={(e) => {
                          setPatientQuery(e.target.value);
                          setSelectedPatient(null);
                          setShowResults(true);
                        }}
                        onFocus={() => debouncedQuery.length >= 2 && setShowResults(true)}
                        disabled={!!selectedPatient}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 pr-8
                          focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none
                          disabled:bg-gray-50 disabled:text-gray-700"
                      />
                      {selectedPatient && (
                        <button
                          type="button"
                          onClick={handleClearPatient}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Resultados */}
                    {showResults && !selectedPatient && debouncedQuery.length >= 2 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                        {patientSearchQuery.isLoading ? (
                          <div className="p-3 text-sm text-gray-400 text-center">Buscando...</div>
                        ) : patientSearchQuery.data && patientSearchQuery.data.length > 0 ? (
                          <>
                            {patientSearchQuery.data.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => handleSelectPatient(p)}
                                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                              >
                                <p className="text-sm font-medium text-gray-800">{p.full_name}</p>
                                {p.phone && (
                                  <p className="text-xs text-gray-400 mt-0.5">{p.phone}</p>
                                )}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setIsNewPatient(true);
                                setNewPatientName(patientQuery);
                                setShowResults(false);
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 transition-colors text-sm text-emerald-700 font-medium border-t border-gray-100"
                            >
                              + Crear paciente nuevo
                            </button>
                          </>
                        ) : (
                          <div className="p-3">
                            <p className="text-sm text-gray-500 mb-2">No se encontraron resultados.</p>
                            <button
                              type="button"
                              onClick={() => {
                                setIsNewPatient(true);
                                setNewPatientName(patientQuery);
                                setShowResults(false);
                              }}
                              className="text-sm text-emerald-700 font-medium hover:text-emerald-800"
                            >
                              + Crear como nuevo paciente
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Paciente seleccionado */}
                    {selectedPatient && (
                      <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-semibold text-white flex-shrink-0">
                          {getInitials(selectedPatient.full_name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-emerald-900 truncate">{selectedPatient.full_name}</p>
                          {selectedPatient.phone && (
                            <p className="text-xs text-emerald-600">{selectedPatient.phone}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  // Nuevo paciente
                  <div className="space-y-3 bg-gray-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nuevo paciente</p>
                      <button
                        type="button"
                        onClick={() => { setIsNewPatient(false); setNewPatientName(''); setNewPatientPhone(''); }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        Buscar existente
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Nombre completo *"
                      value={newPatientName}
                      onChange={(e) => setNewPatientName(e.target.value)}
                      required
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none bg-white"
                    />
                    <input
                      type="tel"
                      placeholder="Teléfono (opcional)"
                      value={newPatientPhone}
                      onChange={(e) => setNewPatientPhone(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none bg-white"
                    />
                  </div>
                )}
              </section>

              {/* ── Fecha y hora ─────────────────────────────── */}
              <section>
                <SectionLabel>Fecha y hora</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fecha</label>
                    <input
                      type="date"
                      value={date}
                      min={new Date().toLocaleDateString('en-CA')}
                      onChange={(e) => setDate(e.target.value)}
                      required
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Hora de inicio</label>
                    {slotsQuery.isLoading ? (
                      <p className="text-xs text-gray-400 px-1 py-2">Cargando horarios…</p>
                    ) : slotOptions.length === 0 ? (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        No hay horarios disponibles para este médico en la fecha seleccionada.
                      </p>
                    ) : (
                      <select
                        value={startTimeHHMM}
                        onChange={(e) => setStartTimeHHMM(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2
                          focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
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
              </section>

              {/* ── Servicio y duración ───────────────────────── */}
              <section>
                <SectionLabel>Servicio y duración</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Servicio (opcional)</label>
                    <select
                      value={selectedServiceId}
                      onChange={(e) => setSelectedServiceId(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                    >
                      <option value="">Sin servicio</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.duration_minutes} min)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Duración</label>
                    <select
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                    >
                      {DURATION_OPTIONS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* ── Precio y notas ───────────────────────────── */}
              <section>
                <SectionLabel>Detalles opcionales</SectionLabel>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Precio ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Notas internas</label>
                    <textarea
                      rows={2}
                      placeholder="Motivo de la cita, indicaciones..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5
                        focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-none"
                    />
                  </div>
                </div>
              </section>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-100 mt-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100
                  hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting || slotOptions.length === 0}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600
                  hover:bg-emerald-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creando cita...
                  </span>
                ) : (
                  'Crear cita'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
      {children}
    </p>
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
