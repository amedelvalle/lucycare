/**
 * PATIENT-CRM-P0 — pestaña «Pendientes de identificar» (D5).
 *
 * Fichas locales (`patients.profile_id IS NULL`) que todavía NO tienen
 * identidad global LucyCare. Se muestran APARTE y su conteo **nunca** se suma
 * al de pacientes: no son pacientes comerciales hasta quedar vinculadas.
 *
 * P0 es de lectura y operación: sin campañas, sin SMS/WhatsApp/correo, y sin
 * crear usuarios de Auth automáticamente. Para vincular se usan las
 * herramientas que ya existen —el reclamo del paciente y la consola de fusión
 * de fichas—, no una segunda implementación.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listUnlinkedPatients,
  CRM_PAGE_SIZE,
  CRM_PAGE_SIZE_MAX,
  type UnlinkedPatientRow,
} from '../../../services/patientCrm.service';

function fecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function UnlinkedPatientsTab({ authReady }: { authReady: boolean }) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  // Mismo criterio que la Base de pacientes: 25 por defecto, 50 como máximo.
  const [limit, setLimit] = useState<number>(CRM_PAGE_SIZE);

  const listQ = useQuery({
    queryKey: ['crm-unlinked', search, limit, offset],
    queryFn: () => listUnlinkedPatients({ search, limit, offset }),
    enabled: authReady,
    staleTime: 30_000,
  });

  const page = listQ.data;
  const rows: UnlinkedPatientRow[] = page?.rows ?? [];
  const total = page?.total ?? 0;
  const desde = total === 0 ? 0 : offset + 1;
  const hasta = Math.min(offset + limit, total);

  return (
    <div className="max-w-6xl">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5">
        <h2 className="text-sm font-semibold text-amber-900">Qué es esta bandeja</h2>
        <p className="text-sm text-amber-800 mt-1">
          Fichas creadas por un médico que todavía <b>no están vinculadas</b> a una identidad
          LucyCare. No cuentan como pacientes del CRM y no se les envía nada. Se vinculan cuando
          la persona reclama sus atenciones con su teléfono verificado, o desde la pestaña de
          fusión de fichas si se trata de un duplicado.
        </p>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
        placeholder="Busca por nombre, teléfono, correo o ID de ficha"
        className="w-full sm:max-w-md border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4"
      />

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-4 py-3">Ficha</th>
                <th className="text-left font-medium px-4 py-3">Contacto</th>
                <th className="text-left font-medium px-4 py-3">Clínica</th>
                <th className="text-left font-medium px-4 py-3">Creada</th>
                <th className="text-left font-medium px-4 py-3">Última actividad</th>
                <th className="text-right font-medium px-4 py-3">Citas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {listQ.isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Cargando…</td></tr>
              )}
              {listQ.isError && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-red-600">
                  {listQ.error instanceof Error ? listQ.error.message : 'No pudimos cargar las fichas.'}
                </td></tr>
              )}
              {!listQ.isLoading && !listQ.isError && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  {search ? 'Ninguna ficha coincide con la búsqueda.' : 'No hay fichas pendientes de identificar.'}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.patient_id} className="hover:bg-gray-50">
                  {/* Mismo criterio de anchos que la Base de pacientes. */}
                  <td className="px-4 py-3 font-medium text-gray-900 min-w-[180px] break-words">
                    {r.full_name || '(sin nombre)'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[220px]">
                    <div className="whitespace-nowrap">{r.phone || '—'}</div>
                    <div className="text-xs text-gray-500 truncate" title={r.email || undefined}>
                      {r.email || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[220px] truncate" title={r.clinic_name || undefined}>
                    {r.clinic_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fecha(r.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fecha(r.ultima_actividad)}</td>
                  <td className="px-4 py-3 text-right text-gray-900 whitespace-nowrap">{r.citas_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-gray-600">
              {total === 0 ? 'Sin resultados' : `Mostrando ${desde}–${hasta} de ${total}`}
            </span>
            <label className="text-gray-600">
              <span className="sr-only">Fichas por página</span>
              <select
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm cursor-pointer"
              >
                <option value={CRM_PAGE_SIZE}>{CRM_PAGE_SIZE} por página</option>
                <option value={CRM_PAGE_SIZE_MAX}>{CRM_PAGE_SIZE_MAX} por página</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset(Math.max(offset - limit, 0))}
              disabled={offset === 0 || listQ.isLoading}
              className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 cursor-pointer"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + limit)}
              disabled={hasta >= total || listQ.isLoading}
              className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40 cursor-pointer"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
