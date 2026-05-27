import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminListAffiliationRequests,
  type AffiliationRequestRow,
  type AffiliationStatus,
} from '../../services/affiliation.service'
import { getSessionWithTimeout } from '../../lib/session'
import AdminAffiliationDetailModal from './components/AdminAffiliationDetailModal'

const PAGE_SIZE = 25

const STATUS_OPTIONS: Array<{ value: '' | AffiliationStatus; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'in_review', label: 'En revisión' },
  { value: 'approved', label: 'Aprobado' },
  { value: 'rejected', label: 'Rechazado' },
  { value: 'expired', label: 'Expirado' },
]

const STATUS_LABEL: Record<AffiliationStatus, string> = {
  pending: 'Pendiente',
  in_review: 'En revisión',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  expired: 'Expirado',
}

const STATUS_COLOR: Record<AffiliationStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  in_review: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-600',
}

type TriState = 'all' | 'yes' | 'no'
const triToBool = (v: TriState): boolean | null => (v === 'all' ? null : v === 'yes')

export default function AdminAffiliationsPage() {
  const qc = useQueryClient()

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | AffiliationStatus>('pending')
  const [incompleteFilter, setIncompleteFilter] = useState<TriState>('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Gate de auth-ready: el cliente supabase-js a veces no tiene el
  // access token hidratado en el primer tick post-mount. Si la query
  // corre antes, el RPC sale sin Authorization → is_admin() devuelve
  // false → "No autorizado" → React Query queda con error sin retry
  // inmediato. Esperamos a `getSessionWithTimeout` (mismo patrón que
  // claim) antes de habilitar la query.
  const [authReady, setAuthReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const tok = await getSessionWithTimeout(3000)
      if (cancelled) return
      if (tok) setAuthReady(true)
    })()
    return () => { cancelled = true }
  }, [])

  // Debounce search
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [statusFilter, incompleteFilter])

  const hasFilters = !!search || statusFilter !== '' || incompleteFilter !== 'all'
  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setStatusFilter('')
    setIncompleteFilter('all')
    setPage(1)
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-affiliations', { search, statusFilter, incompleteFilter, page }],
    queryFn: () =>
      adminListAffiliationRequests({
        search: search || null,
        status: statusFilter || null,
        incomplete: triToBool(incompleteFilter),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    enabled: authReady,
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    retry: 1,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const onActionComplete = () => {
    setSelectedId(null)
    qc.invalidateQueries({ queryKey: ['admin-affiliations'] })
    qc.invalidateQueries({ queryKey: ['admin-affiliation-pending-count'] })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Solicitudes de afiliación</h1>
        <p className="text-sm text-gray-600 mt-1">
          Leads de médicos que quieren aparecer en Lucy. Revisá, validá identidad y contactá
          manualmente al médico. <strong>Esta vista no crea doctores</strong> — eso se hace
          después con `import-doctors.mjs` o la herramienta admin (Fase 2 pendiente).
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Buscar</label>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Nombre, email, teléfono o licencia"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter((e.target.value || '') as '' | AffiliationStatus)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Incompleto</label>
          <select
            value={incompleteFilter}
            onChange={(e) => setIncompleteFilter(e.target.value as TriState)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white"
          >
            <option value="all">Todos</option>
            <option value="yes">Solo incompletos</option>
            <option value="no">Solo completos</option>
          </select>
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {!authReady || isLoading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Cargando…</div>
        ) : error ? (
          <div className="p-8 text-center text-red-700 text-sm">
            Error: {(error as Error).message}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No hay solicitudes con esos filtros.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Fecha</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Nombre</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Contacto</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Especialidad</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Licencia</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Estado</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">Acción</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: AffiliationRequestRow) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleDateString('es-SV', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-900 font-medium">{r.fullName}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <div>{r.phone}</div>
                      {r.email && <div className="text-xs text-gray-500">{r.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.specialtyName || r.specialtyOther || (
                        <span className="text-xs text-amber-700 italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.licenseNumber || (
                        <span className="text-xs text-amber-700 italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex w-fit px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLOR[r.status]}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                        {r.incomplete && !r.doctorId && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                            <i className="ri-error-warning-line" /> Datos por completar
                          </span>
                        )}
                        {r.doctorId && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                            <i className="ri-stethoscope-line" /> Médico creado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedId(r.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg"
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginación */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              ←
            </button>
            <span className="px-3 py-1.5">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              →
            </button>
          </div>
        </div>
      )}

      {selectedId && (
        <AdminAffiliationDetailModal
          requestId={selectedId}
          onClose={() => setSelectedId(null)}
          onActionComplete={onActionComplete}
          row={rows.find((r) => r.id === selectedId) ?? null}
        />
      )}
    </div>
  )
}
