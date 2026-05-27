import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  adminMarkInReview,
  adminRejectAffiliationRequest,
  adminMarkApprovedPendingCreation,
  type AffiliationRequestRow,
  type AffiliationStatus,
} from '../../../services/affiliation.service'

interface Props {
  requestId: string
  row: AffiliationRequestRow | null
  onClose: () => void
  onActionComplete: () => void
}

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

export default function AdminAffiliationDetailModal({
  requestId,
  row,
  onClose,
  onActionComplete,
}: Props) {
  const [notes, setNotes] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejectMode, setRejectMode] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')

  const inReviewMut = useMutation({
    mutationFn: () => adminMarkInReview(requestId, notes.trim() || null),
    onSuccess: onActionComplete,
    onError: (e: Error) => setActionError(e.message),
  })

  const approveMut = useMutation({
    mutationFn: () => adminMarkApprovedPendingCreation(requestId, notes.trim() || null),
    onSuccess: onActionComplete,
    onError: (e: Error) => setActionError(e.message),
  })

  const rejectMut = useMutation({
    mutationFn: () => adminRejectAffiliationRequest(requestId, rejectNotes.trim()),
    onSuccess: onActionComplete,
    onError: (e: Error) => setActionError(e.message),
  })

  if (!row) return null

  const canMarkInReview = row.status === 'pending'
  const canApprove = row.status === 'pending' || row.status === 'in_review'
  const canReject = row.status === 'pending' || row.status === 'in_review'

  const loading = inReviewMut.isPending || approveMut.isPending || rejectMut.isPending

  return (
    <div
      // Backdrop NO cierra: este modal tiene acciones sensibles
      // (in_review / approved / rejected) que disparan RPCs admin.
      // Mismo patrón que LoginModal / ClaimProfileModal / WaitlistModal.
      // Solo se cierra con X o botón explícito.
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="pr-4">
            <h2 className="text-xl font-semibold text-gray-900">{row.fullName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLOR[row.status]}`}>
                {STATUS_LABEL[row.status]}
              </span>
              {row.incomplete && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                  <i className="ri-error-warning-line" /> faltan datos
                </span>
              )}
              <span className="text-xs text-gray-500">
                creado {new Date(row.createdAt).toLocaleDateString('es-SV')}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full cursor-pointer flex-shrink-0 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <i className="ri-close-line text-xl text-gray-700" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Datos del lead */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Contacto</h3>
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div><span className="text-gray-500">Teléfono:</span> <span className="font-medium">{row.phone}</span></div>
              {row.email && <div><span className="text-gray-500">Email:</span> <span className="font-medium">{row.email}</span></div>}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Profesional</h3>
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div>
                <span className="text-gray-500">Especialidad:</span>{' '}
                <span className="font-medium">
                  {row.specialtyName || row.specialtyOther || (
                    <span className="text-amber-700 italic">no informada</span>
                  )}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Licencia/JVPM:</span>{' '}
                <span className="font-medium">
                  {row.licenseNumber || <span className="text-amber-700 italic">no informada</span>}
                </span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Consultorio / clínica</h3>
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              {row.clinicName && <div><span className="text-gray-500">Nombre:</span> {row.clinicName}</div>}
              {row.addressLine && <div><span className="text-gray-500">Dirección:</span> {row.addressLine}</div>}
              {(row.departmentName || row.municipalityName) && (
                <div>
                  <span className="text-gray-500">Ubicación:</span>{' '}
                  {[row.municipalityName, row.departmentName].filter(Boolean).join(', ')}
                </div>
              )}
              {!row.clinicName && !row.addressLine && !row.departmentName && !row.municipalityName && (
                <div className="text-gray-500 italic">sin datos</div>
              )}
            </div>
          </section>

          {row.message && (
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Mensaje del médico</h3>
              <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">{row.message}</div>
            </section>
          )}

          {row.adminNotes && (
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Notas internas previas</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm whitespace-pre-wrap">
                {row.adminNotes}
              </div>
              {row.reviewedByName && (
                <p className="text-xs text-gray-500 mt-1">
                  Última revisión por {row.reviewedByName}
                  {row.reviewedAt && ` el ${new Date(row.reviewedAt).toLocaleString('es-SV')}`}
                </p>
              )}
            </section>
          )}

          {/* Acciones */}
          {!rejectMode && (canMarkInReview || canApprove || canReject) && (
            <section className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Acción</h3>

              {(canMarkInReview || canApprove) && (
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Nota interna (opcional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Para tu equipo (no se muestra al médico)"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 resize-none"
                  />
                </div>
              )}

              {actionError && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{actionError}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {canMarkInReview && (
                  <button
                    onClick={() => { setActionError(null); inReviewMut.mutate() }}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {inReviewMut.isPending ? 'Guardando…' : 'Marcar en revisión'}
                  </button>
                )}
                {canApprove && (
                  <button
                    onClick={() => {
                      if (
                        !confirm(
                          'Marcar como aprobado. Esto NO crea el médico todavía — solo señala que validaste el lead. Tenés que crear el doctor en doctors manualmente (Fase 2 pendiente) y avisar al médico por WhatsApp/email. ¿Continuar?',
                        )
                      ) return
                      setActionError(null)
                      approveMut.mutate()
                    }}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {approveMut.isPending ? 'Guardando…' : 'Marcar aprobado (sin crear doctor)'}
                  </button>
                )}
                {canReject && (
                  <button
                    onClick={() => { setActionError(null); setRejectMode(true) }}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium bg-white text-red-700 border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                )}
              </div>
            </section>
          )}

          {rejectMode && (
            <section className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Rechazar solicitud</h3>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Nota interna <span className="text-red-600">*</span>
              </label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Motivo del rechazo (queda en audit; no se muestra al médico)"
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-red-500 resize-none"
                autoFocus
              />
              {actionError && (
                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{actionError}</p>
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { setActionError(null); rejectMut.mutate() }}
                  disabled={loading || rejectNotes.trim().length === 0}
                  className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {rejectMut.isPending ? 'Rechazando…' : 'Confirmar rechazo'}
                </button>
                <button
                  onClick={() => { setRejectMode(false); setRejectNotes(''); setActionError(null) }}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                >
                  Cancelar
                </button>
              </div>
            </section>
          )}

          {!canMarkInReview && !canApprove && !canReject && (
            <div className="text-sm text-gray-500 italic text-center py-2">
              No hay acciones disponibles para una solicitud en estado &laquo;{STATUS_LABEL[row.status]}&raquo;.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
