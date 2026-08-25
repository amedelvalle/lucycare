/**
 * PATIENT-CRM-P0 — pestaña «Base de pacientes».
 *
 * La unidad es la IDENTIDAD GLOBAL del paciente LucyCare (`profiles`), no la
 * ficha local. Las fichas sin identidad viven en «Pendientes de identificar» y
 * su conteo NO se suma acá (D1).
 *
 * Todo el trabajo pesado ocurre server-side: búsqueda, filtro, orden,
 * paginación y agregados llegan resueltos por una sola RPC. Esta pantalla no
 * calcula métricas ni recorre citas — si algún día lo hace, se rompió el
 * diseño.
 *
 * Nada clínico aparece acá, y no por omisión de la interfaz: la RPC
 * directamente no devuelve esas columnas (D4).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listPatientsCrm,
  getPatientsCrmStats,
  fetchPatientsCrmForExport,
  buildPatientsCsv,
  exportFileName,
  CRM_PAGE_SIZE,
  CRM_PAGE_SIZE_MAX,
  CRM_STATUS_LABEL,
  CRM_STATUS_ORDER,
  type CrmStatus,
  type CrmPatientRow,
} from '../../../services/patientCrm.service';

function fecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

const TONO: Record<CrmStatus, string> = {
  bloqueado: 'bg-red-50 text-red-700 border-red-200',
  en_seguimiento: 'bg-amber-50 text-amber-700 border-amber-200',
  recurrente: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  nuevo: 'bg-blue-50 text-blue-700 border-blue-200',
  activo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactivo: 'bg-gray-100 text-gray-600 border-gray-200',
};

function EstadoPill({ status }: { status: CrmStatus }) {
  // `whitespace-nowrap`: una insignia partida en dos líneas deja de parecer una
  // insignia. Con nueve columnas la de Estado se estrecha, y «En seguimiento»
  // era justo la que se rompía.
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium border ${TONO[status] ?? TONO.inactivo}`}>
      {CRM_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Indicador({ label, valor, tono = 'gray' }: { label: string; valor: number | string; tono?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className={`text-2xl font-bold ${tono === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{valor}</div>
      <div className="text-xs text-gray-600 mt-1">{label}</div>
    </div>
  );
}

export default function PatientsCrmTab({ authReady }: { authReady: boolean }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CrmStatus | ''>('');
  const [offset, setOffset] = useState(0);
  // Tamaño de página: 25 por defecto, 50 como máximo de pantalla. El tope real
  // lo impone la RPC; acá solo se ofrecen los dos valores del diseño.
  const [limit, setLimit] = useState<number>(CRM_PAGE_SIZE);

  const statsQ = useQuery({
    queryKey: ['crm-stats'],
    queryFn: getPatientsCrmStats,
    enabled: authReady,
    // Son conteos que no cambian por segundo: no se recalculan con cada tecla.
    staleTime: 5 * 60_000,
  });

  const listQ = useQuery({
    queryKey: ['crm-patients', search, status, limit, offset],
    queryFn: () => listPatientsCrm({ search, status: status || null, limit, offset }),
    enabled: authReady,
    staleTime: 30_000,
  });

  const s = statsQ.data;
  const page = listQ.data;
  const rows: CrmPatientRow[] = page?.rows ?? [];
  const total = page?.total ?? 0;
  const desde = total === 0 ? 0 : offset + 1;
  const hasta = Math.min(offset + limit, total);

  const buscar = (v: string) => { setSearch(v); setOffset(0); };
  const filtrar = (v: CrmStatus | '') => { setStatus(v); setOffset(0); };
  const porPagina = (v: number) => { setLimit(v); setOffset(0); };

  /*
   * Exportación (P5). Descarga el conjunto FILTRADO COMPLETO —no las 25 filas
   * visibles— desde la misma RPC-núcleo que alimenta la tabla, así que hereda
   * el universo canónico y la allowlist de columnas.
   *
   * El archivo se arma en el navegador con lo que devolvió el servidor: no se
   * sube nada a Supabase ni se crea ningún bucket. La paginación de la
   * pantalla no se toca.
   */
  const [exportando, setExportando] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportar = async () => {
    if (exportando) return;
    setExportando(true);
    setExportError(null);
    try {
      const filas = await fetchPatientsCrmForExport({
        search, status: status || null, formato: 'csv',
      });
      const url = URL.createObjectURL(buildPatientsCsv(filas));
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFileName('csv');
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'No pudimos generar la exportación.');
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="max-w-6xl">
      {/* ─── Indicadores ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Indicador label="Pacientes totales" valor={s?.pacientes_totales ?? '—'} />
        <Indicador label="Nuevos (30 días)" valor={s?.nuevos_30d ?? '—'} />
        <Indicador label="Activos" valor={s?.activos ?? '—'} />
        <Indicador label="Con próxima cita" valor={s?.con_proxima_cita ?? '—'} />
        <Indicador label="Sin actividad (180 días)" valor={s?.sin_actividad_180d ?? '—'} />
        <Indicador label="Bloqueados" valor={s?.bloqueados ?? '—'} />
      </div>

      {/* ─── Buscador y filtro ─── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Busca por nombre, teléfono, correo o ID"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => filtrar(e.target.value as CrmStatus | '')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Todos los estados</option>
          {CRM_STATUS_ORDER.map((st) => (
            <option key={st} value={st}>{CRM_STATUS_LABEL[st]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportar}
          disabled={exportando || listQ.isLoading}
          title="Descarga el conjunto filtrado completo, no solo esta página. Compatible con Excel."
          className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
        >
          {exportando ? 'Preparando…' : 'Exportar CSV'}
        </button>
      </div>

      {exportError && (
        <p className="text-sm text-red-600 mb-4" role="alert">{exportError}</p>
      )}

      {/* ─── Tabla ─── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-medium px-4 py-3">Paciente</th>
                <th className="text-left font-medium px-4 py-3">Contacto</th>
                <th className="text-left font-medium px-4 py-3">Estado</th>
                <th className="text-left font-medium px-4 py-3">Canal 1.ª cita</th>
                <th className="text-left font-medium px-4 py-3">Registro</th>
                <th className="text-left font-medium px-4 py-3">Última actividad</th>
                <th className="text-left font-medium px-4 py-3">Próxima cita</th>
                <th className="text-right font-medium px-4 py-3">Citas</th>
                <th className="text-right font-medium px-4 py-3">Relaciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {listQ.isLoading && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Cargando…</td></tr>
              )}
              {listQ.isError && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-red-600">
                  {listQ.error instanceof Error ? listQ.error.message : 'No pudimos cargar los pacientes.'}
                </td></tr>
              )}
              {!listQ.isLoading && !listQ.isError && rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                  {search || status
                    ? 'Ningún paciente coincide con la búsqueda.'
                    : 'Todavía no hay pacientes con identidad LucyCare.'}
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.profile_id} className="hover:bg-gray-50">
                  {/*
                    Anchos: el nombre es la columna que importa, así que se le
                    garantiza un mínimo. El contacto se acota y se recorta —un
                    correo largo es UN token indivisible y, sin tope, se queda
                    con la mitad de la tabla y asfixia al nombre—. Las columnas
                    cortas van `nowrap` para no competir por espacio. Lo que
                    sobra lo absorbe el scroll horizontal del contenedor.
                  */}
                  <td className="px-4 py-3 min-w-[180px]">
                    <div className="font-medium text-gray-900 break-words">{r.full_name || '(sin nombre)'}</div>
                    {r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.tags.map((t) => (
                          <span key={t} className="whitespace-nowrap rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-[11px]">{t}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[220px]">
                    <div className="whitespace-nowrap">{r.phone || '—'}</div>
                    <div className="text-xs text-gray-500 truncate" title={r.email || undefined}>
                      {r.email || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3"><EstadoPill status={r.crm_status} /></td>
                  {/* Canal de la primera reserva. NO es origen de adquisición. */}
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.canal_primera_cita || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fecha(r.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fecha(r.ultima_actividad)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fecha(r.proxima_cita)}</td>
                  <td className="px-4 py-3 text-right text-gray-900 whitespace-nowrap">
                    {r.citas_total}
                    <span className="text-xs text-gray-500"> ({r.atendidas} at.)</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                    {r.medicos} méd. · {r.clinicas} clín.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ─── Paginación server-side ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-3">
            <span className="text-gray-600">
              {total === 0 ? 'Sin resultados' : `Mostrando ${desde}–${hasta} de ${total}`}
            </span>
            <label className="text-gray-600">
              <span className="sr-only">Pacientes por página</span>
              <select
                value={limit}
                onChange={(e) => porPagina(Number(e.target.value))}
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

      <p className="text-xs text-gray-500 mt-3">
        Esta vista es comercial y administrativa. No muestra información clínica: diagnósticos,
        medicamentos, recetas, antecedentes ni notas de consulta quedan fuera por diseño.
      </p>
      <p className="text-xs text-gray-500 mt-1">
        <b>Canal 1.ª cita</b> indica por dónde entró la primera reserva del paciente. No es un
        origen de adquisición: no dice cómo conoció LucyCare.
      </p>
    </div>
  );
}
