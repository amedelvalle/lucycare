import { useState, useEffect } from 'react';
import { getMyAvailabilityRules, saveAvailabilityRules } from '../../../services/availability.service';

const dayLabels = [
  { dayOfWeek: 1, label: 'Lunes' },
  { dayOfWeek: 2, label: 'Martes' },
  { dayOfWeek: 3, label: 'Miércoles' },
  { dayOfWeek: 4, label: 'Jueves' },
  { dayOfWeek: 5, label: 'Viernes' },
  { dayOfWeek: 6, label: 'Sábado' },
  { dayOfWeek: 0, label: 'Domingo' },
];

interface DayConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
  slotDuration: number;
}

type WeekConfig = Record<number, DayConfig>;

const defaultDay: DayConfig = { enabled: false, startTime: '09:00', endTime: '17:00', slotDuration: 30 };

export default function DisponibilidadPage() {
  const [week, setWeek] = useState<WeekConfig>(() => {
    const w: WeekConfig = {};
    dayLabels.forEach(d => { w[d.dayOfWeek] = { ...defaultDay }; });
    return w;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Cargar reglas existentes
  useEffect(() => {
    getMyAvailabilityRules().then(rules => {
      if (rules.length > 0) {
        const w: WeekConfig = {};
        dayLabels.forEach(d => { w[d.dayOfWeek] = { ...defaultDay }; });

        rules.forEach(r => {
          w[r.dayOfWeek] = {
            enabled: r.isActive,
            startTime: r.startTime?.slice(0, 5) || '09:00',
            endTime: r.endTime?.slice(0, 5) || '17:00',
            slotDuration: r.slotDurationMin || 30,
          };
        });

        setWeek(w);
      }
      setLoading(false);
    });
  }, []);

  const toggleDay = (dayOfWeek: number) => {
    setWeek(prev => ({
      ...prev,
      [dayOfWeek]: { ...prev[dayOfWeek], enabled: !prev[dayOfWeek].enabled },
    }));
    setSaved(false);
  };

  const updateDay = (dayOfWeek: number, field: keyof DayConfig, value: string | number) => {
    setWeek(prev => ({
      ...prev,
      [dayOfWeek]: { ...prev[dayOfWeek], [field]: value },
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    setSaved(false);

    const rules = dayLabels
      .filter(d => week[d.dayOfWeek].enabled)
      .map(d => ({
        dayOfWeek: d.dayOfWeek,
        startTime: week[d.dayOfWeek].startTime,
        endTime: week[d.dayOfWeek].endTime,
        slotDuration: week[d.dayOfWeek].slotDuration,
      }));

    const result = await saveAvailabilityRules(rules);

    setSaving(false);
    if (result.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError(result.error || 'Error al guardar');
    }
  };

  // Copiar horario del lunes a todos los días habilitados
  const copyMondayToAll = () => {
    const monday = week[1];
    if (!monday.enabled) return;

    setWeek(prev => {
      const newWeek = { ...prev };
      dayLabels.forEach(d => {
        if (d.dayOfWeek !== 1 && newWeek[d.dayOfWeek].enabled) {
          newWeek[d.dayOfWeek] = { ...newWeek[d.dayOfWeek], startTime: monday.startTime, endTime: monday.endTime, slotDuration: monday.slotDuration };
        }
      });
      return newWeek;
    });
    setSaved(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-2 border-emerald-700 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  const enabledCount = dayLabels.filter(d => week[d.dayOfWeek].enabled).length;

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Disponibilidad semanal</h1>
        <p className="text-gray-600">Configura los días y horarios en los que atiendes pacientes. Los pacientes verán estos horarios al reservar desde el directorio.</p>
      </div>

      {/* Mensajes */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {saved && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
          <i className="ri-check-line text-emerald-700"></i>
          <p className="text-sm text-emerald-700 font-medium">Disponibilidad guardada correctamente</p>
        </div>
      )}

      {/* Acción rápida */}
      {enabledCount > 1 && week[1].enabled && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <i className="ri-flashlight-line text-blue-700"></i>
            <span className="text-sm text-blue-900">Copiar horario del lunes a todos los días activos</span>
          </div>
          <button onClick={copyMondayToAll} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 cursor-pointer font-medium">
            Aplicar
          </button>
        </div>
      )}

      {/* Días */}
      <div className="space-y-3">
        {dayLabels.map(day => {
          const config = week[day.dayOfWeek];
          return (
            <div key={day.dayOfWeek} className={`border rounded-xl p-5 transition-colors ${config.enabled ? 'border-emerald-200 bg-white' : 'border-gray-200 bg-gray-50'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleDay(day.dayOfWeek)}
                    className={`relative w-12 h-7 rounded-full transition-all cursor-pointer ${config.enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${config.enabled ? 'translate-x-5' : ''}`}></div>
                  </button>
                  <span className={`font-semibold ${config.enabled ? 'text-gray-900' : 'text-gray-400'}`}>{day.label}</span>
                </div>
                {config.enabled && (
                  <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full font-medium">
                    {config.startTime} - {config.endTime}
                  </span>
                )}
              </div>

              {config.enabled && (
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Hora inicio</label>
                    <input
                      type="time"
                      value={config.startTime}
                      onChange={e => updateDay(day.dayOfWeek, 'startTime', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Hora fin</label>
                    <input
                      type="time"
                      value={config.endTime}
                      onChange={e => updateDay(day.dayOfWeek, 'endTime', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Duración slot</label>
                    <select
                      value={config.slotDuration}
                      onChange={e => updateDay(day.dayOfWeek, 'slotDuration', parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-600 cursor-pointer"
                    >
                      <option value={15}>15 min</option>
                      <option value={20}>20 min</option>
                      <option value={30}>30 min</option>
                      <option value={45}>45 min</option>
                      <option value={60}>60 min</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Save button */}
      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
            saving ? 'bg-gray-300 cursor-not-allowed' : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
          }`}
        >
          {saving ? 'Guardando...' : 'Guardar disponibilidad'}
        </button>
        <p className="text-sm text-gray-500">{enabledCount} día{enabledCount !== 1 ? 's' : ''} activo{enabledCount !== 1 ? 's' : ''}</p>
      </div>
    </div>
  );
}
