import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  adminMarkInReview,
  adminRejectAffiliationRequest,
  adminMarkApprovedPendingCreation,
  adminApproveAndCreateDoctor,
  type AffiliationRequestRow,
  type AffiliationStatus,
  type ApproveAndCreateResult,
} from '../../../services/affiliation.service'
import { useSpecialties, useDepartments, useMunicipalities } from '../../../hooks/useDirectory'

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

const SPECIALTY_OTHER_SENTINEL = '__other__'

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

  // ─── Fase 2: sub-modo "Crear médico" ─────────────────────────
  const [createMode, setCreateMode] = useState(false)
  const [createConfirmed, setCreateConfirmed] = useState(false)
  const [createdResult, setCreatedResult] = useState<ApproveAndCreateResult | null>(null)

  // Overrides para la RPC (pre-rellenados desde el lead cuando entra
  // al sub-modo). Phone y email NUNCA se sobreescriben — son identidad.
  const [ovFullName, setOvFullName] = useState('')
  const [ovSpecialtyId, setOvSpecialtyId] = useState('')
  const [ovClinicName, setOvClinicName] = useState('')
  const [ovAddressLine, setOvAddressLine] = useState('')
  const [ovDepartmentId, setOvDepartmentId] = useState('')
  const [ovMunicipalityId, setOvMunicipalityId] = useState('')

  const { data: specialties = [] } = useSpecialties()
  const { data: departments = [] } = useDepartments()
  const { data: municipalities = [] } = useMunicipalities(ovDepartmentId || undefined)

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

  const createMut = useMutation({
    mutationFn: () =>
      adminApproveAndCreateDoctor(requestId, {
        fullName: ovFullName,
        specialtyId: ovSpecialtyId && ovSpecialtyId !== SPECIALTY_OTHER_SENTINEL ? ovSpecialtyId : null,
        clinicName: ovClinicName,
        addressLine: ovAddressLine,
        departmentId: ovDepartmentId,
        municipalityId: ovMunicipalityId,
      }),
    onSuccess: (result) => {
      setCreatedResult(result)
      setCreateMode(false)
      // NO llamamos a onActionComplete acá inmediatamente porque
      // queremos mostrar la pantalla de éxito con el doctor_id.
      // El usuario ve el resultado y cierra manualmente, lo cual
      // disparará el refetch de la lista via onClose flow.
    },
    onError: (e: Error) => setActionError(e.message),
  })

  if (!row) return null

  const canMarkInReview = row.status === 'pending'
  const canApprove = row.status === 'pending' || row.status === 'in_review'
  const canReject = row.status === 'pending' || row.status === 'in_review'
  const canCreateDoctor = row.status === 'approved' && !row.doctorId && !createdResult

  // Pre-rellenar overrides al abrir el sub-modo
  const enterCreateMode = () => {
    setActionError(null)
    setOvFullName(row.fullName)
    setOvSpecialtyId(
      row.specialtyId ?? (row.specialtyOther ? SPECIALTY_OTHER_SENTINEL : ''),
    )
    setOvClinicName(row.clinicName ?? '')
    setOvAddressLine(row.addressLine ?? '')
    // Department/municipality IDs no están en el row tipo — quedan vacíos
    // a menos que admin los elija acá explícitamente.
    setOvDepartmentId('')
    setOvMunicipalityId('')
    setCreateConfirmed(false)
    setCreateMode(true)
  }

  const handleCloseAfterCreate = () => {
    setCreatedResult(null)
    onActionComplete() // refresca lista
  }

  const loading =
    inReviewMut.isPending ||
    approveMut.isPending ||
    rejectMut.isPending ||
    createMut.isPending

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

          {/* ───── Pantalla de éxito post-creación ───── */}
          {createdResult && (
            <section className="border-t border-gray-200 pt-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <i className="ri-check-line text-2xl text-emerald-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-emerald-900">Médico creado en estado listed_only</p>
                    <p className="text-sm text-emerald-800 mt-1">
                      Se creó el perfil en <code className="text-xs bg-white px-1 rounded">doctors</code> con todos
                      los flags conservadores: <strong>no publicado</strong>, <strong>no operativo</strong>,
                      <strong>sin agenda</strong>. El médico debe reclamarlo via OTP+licencia para activarlo.
                    </p>
                    <div className="mt-3 text-xs text-emerald-900 space-y-1 break-all">
                      <div>doctor_id: <code className="bg-white px-1 rounded">{createdResult.doctorId}</code></div>
                      <div>clinic_id: <code className="bg-white px-1 rounded">{createdResult.clinicId}</code></div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to={`/admin/medicos/${createdResult.doctorId}`}
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800"
                      >
                        Editar en admin
                      </Link>
                      <a
                        href={`/doctor/${createdResult.doctorId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs font-medium bg-white text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-50"
                      >
                        Ver perfil público
                      </a>
                      <button
                        onClick={handleCloseAfterCreate}
                        className="px-3 py-1.5 text-xs text-emerald-900 underline hover:text-emerald-700"
                      >
                        Cerrar
                      </button>
                    </div>
                    <p className="text-xs text-emerald-700 mt-2 italic">
                      No se notificó automáticamente al médico. Contactalo por WhatsApp/email con el link a
                      <code className="bg-white px-1 rounded mx-1">{`/doctor/${createdResult.doctorId}`}</code>
                      para que reclame su perfil.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ───── Sub-modo "Crear médico" (form de overrides) ───── */}
          {createMode && !createdResult && (
            <section className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Crear médico en <code className="text-xs bg-gray-100 px-1 rounded">listed_only</code>
              </h3>
              <p className="text-xs text-gray-600 mb-3">
                Esto crea <code className="bg-gray-100 px-1 rounded">auth.users</code> (dormant, sin
                password), <code className="bg-gray-100 px-1 rounded">profiles</code>,
                <code className="bg-gray-100 px-1 rounded">clinics</code> y
                <code className="bg-gray-100 px-1 rounded">doctors</code> en una sola transacción.
                <strong> El médico queda no publicado, no operativo, sin agenda.</strong> Después
                debe reclamarlo via el flujo público de OTP+licencia.
                Phone y email del lead NO se editan acá.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Nombre público del médico <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={ovFullName}
                    onChange={(e) => setOvFullName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Especialidad</label>
                  <select
                    value={ovSpecialtyId}
                    onChange={(e) => setOvSpecialtyId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white"
                  >
                    <option value="">— Sin asignar —</option>
                    {(specialties as Array<{ id: string; name: string }>).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {row.specialtyOther && (
                    <p className="text-xs text-amber-700 mt-1">
                      El médico declaró “{row.specialtyOther}” en su solicitud. Asigná la mejor coincidencia
                      del catálogo o dejá sin asignar para configurar después.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la clínica</label>
                  <input
                    type="text"
                    value={ovClinicName}
                    onChange={(e) => setOvClinicName(e.target.value)}
                    placeholder="Si lo dejás vacío, se crea como “Consultorio Dr. …”"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
                  <input
                    type="text"
                    value={ovAddressLine}
                    onChange={(e) => setOvAddressLine(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Departamento</label>
                    <select
                      value={ovDepartmentId}
                      onChange={(e) => { setOvDepartmentId(e.target.value); setOvMunicipalityId('') }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white"
                    >
                      <option value="">—</option>
                      {(departments as Array<{ id: string; name: string }>).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Municipio</label>
                    <select
                      value={ovMunicipalityId}
                      onChange={(e) => setOvMunicipalityId(e.target.value)}
                      disabled={!ovDepartmentId}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white disabled:bg-gray-50 disabled:cursor-not-allowed"
                    >
                      <option value="">—</option>
                      {(municipalities as Array<{ id: string; name: string }>).map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Checkbox de confirmación obligatorio antes de submit */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <label className="flex items-start gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={createConfirmed}
                      onChange={(e) => setCreateConfirmed(e.target.checked)}
                      className="mt-1 w-4 h-4 text-emerald-700 rounded cursor-pointer flex-shrink-0"
                    />
                    <span className="text-amber-900">
                      Confirmo que validé la identidad del médico. Se creará un auth.users dormant + profile
                      + clinic + doctor en listed_only (sin publicar, sin agenda, sin verified).
                    </span>
                  </label>
                </div>

                {actionError && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">{actionError}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { setActionError(null); createMut.mutate() }}
                    disabled={
                      loading ||
                      !createConfirmed ||
                      ovFullName.trim().length === 0
                    }
                    className="px-4 py-2 text-sm font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {createMut.isPending ? 'Creando…' : 'Crear médico'}
                  </button>
                  <button
                    onClick={() => {
                      setCreateMode(false)
                      setCreateConfirmed(false)
                      setActionError(null)
                    }}
                    disabled={loading}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ───── Acciones estándar ───── */}
          {!rejectMode && !createMode && !createdResult &&
            (canMarkInReview || canApprove || canReject || canCreateDoctor) && (
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
                          'Marcar como aprobado validará el lead pero NO crea el médico todavía. Después podrás usar "Crear médico" para generar el doctor en listed_only. ¿Continuar?',
                        )
                      ) return
                      setActionError(null)
                      approveMut.mutate()
                    }}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {approveMut.isPending ? 'Guardando…' : 'Marcar aprobado'}
                  </button>
                )}
                {canCreateDoctor && (
                  <button
                    onClick={enterCreateMode}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium bg-purple-700 text-white rounded-lg hover:bg-purple-800 disabled:opacity-50"
                  >
                    Crear médico
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

          {/* ───── Mensaje cuando el lead ya tiene doctor vinculado ───── */}
          {row.status === 'approved' && row.doctorId && !createdResult && (
            <section className="border-t border-gray-200 pt-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
                <p className="font-medium text-gray-900 flex items-center gap-2">
                  <i className="ri-information-line text-gray-600" />
                  Esta solicitud ya tiene un médico vinculado.
                </p>
                <p className="text-xs text-gray-600 mt-1 break-all">
                  doctor_id: <code className="bg-white px-1 rounded">{row.doctorId}</code>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    to={`/admin/medicos/${row.doctorId}`}
                    className="px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800"
                  >
                    Editar en admin
                  </Link>
                  <a
                    href={`/doctor/${row.doctorId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-medium bg-white text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-50"
                  >
                    Ver perfil público
                  </a>
                </div>
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

          {!canMarkInReview &&
            !canApprove &&
            !canReject &&
            !canCreateDoctor &&
            !createMode &&
            !rejectMode &&
            !createdResult &&
            !(row.status === 'approved' && row.doctorId) && (
            <div className="text-sm text-gray-500 italic text-center py-2">
              No hay acciones disponibles para una solicitud en estado &laquo;{STATUS_LABEL[row.status]}&raquo;.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
