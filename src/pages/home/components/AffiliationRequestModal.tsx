/**
 * Modal de "Soy médico, quiero aparecer en Lucy" — captura de lead
 * para afiliación médica (Fase 1).
 *
 * Reemplaza al `DoctorInterestModal` (que solo era WhatsApp) y, antes,
 * al `DoctorRegistrationModal` legacy (que auto-creaba doctor sin
 * validar identidad — neutralizado en PR #53).
 *
 * Lectura A:
 *  - Mínimo absoluto para enviar: nombre + teléfono + consentimiento LOPD.
 *  - Licencia/JVPM y email son **recomendados** pero NO bloquean el submit.
 *  - Si vienen vacíos, el lead entra con `incomplete=true` (calculado
 *    server-side via columna GENERATED).
 *
 * Sin auto-creación de doctor, sin emails al lead, sin tracking portal.
 * Pantalla post-submit es genérica: "Recibimos tu solicitud, te
 * contactaremos."
 */

import { useState, useEffect } from 'react'
import { useSpecialties, useDepartments, useMunicipalities } from '../../../hooks/useDirectory'
import { submitAffiliationRequest } from '../../../services/affiliation.service'

interface AffiliationRequestModalProps {
  onClose: () => void
}

const CONSENT_VERSION = 'v1.0'
const WHATSAPP_NUMBER = '50378056365'
const WHATSAPP_FALLBACK_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
  'Hola, soy médico y quiero afiliarme a Lucy.',
)}`

const SPECIALTY_OTHER_SENTINEL = '__other__'

const COUNTRY_CODE = '+503'

export default function AffiliationRequestModal({ onClose }: AffiliationRequestModalProps) {
  // Form fields
  const [fullName, setFullName] = useState('')
  const [phoneRaw, setPhoneRaw] = useState('')
  const [phoneDisplay, setPhoneDisplay] = useState('')
  const [email, setEmail] = useState('')
  const [specialtyId, setSpecialtyId] = useState('') // '' | <uuid> | SPECIALTY_OTHER_SENTINEL
  const [specialtyOther, setSpecialtyOther] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [municipalityId, setMunicipalityId] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [clinicName, setClinicName] = useState('')
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)

  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ title: string; detail: string; isRateLimit?: boolean } | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // Catalogs
  const { data: specialties = [] } = useSpecialties()
  const { data: departments = [] } = useDepartments()
  const { data: municipalities = [] } = useMunicipalities(departmentId || undefined)

  // Esc para cerrar (modal puede cerrarse libremente — es informativo,
  // sin "trabajo en progreso" persistido server-side hasta submit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, onClose])

  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8)
    setPhoneRaw(digits)
    setPhoneDisplay(digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits)
  }

  // Validaciones mínimas para habilitar submit (Lectura A)
  const isNameValid = fullName.trim().length >= 2
  const isPhoneValid = phoneRaw.length === 8
  const canSubmit = isNameValid && isPhoneValid && consent && !loading

  const handleSubmit = async () => {
    if (!canSubmit) return
    setError(null)
    setLoading(true)
    try {
      const result = await submitAffiliationRequest({
        fullName: fullName.trim(),
        phone: `${COUNTRY_CODE}${phoneRaw}`,
        consentVersion: CONSENT_VERSION,
        email: email.trim() || null,
        specialtyId: specialtyId && specialtyId !== SPECIALTY_OTHER_SENTINEL ? specialtyId : null,
        specialtyOther:
          specialtyId === SPECIALTY_OTHER_SENTINEL ? specialtyOther.trim() || null : null,
        licenseNumber: licenseNumber.trim() || null,
        departmentId: departmentId || null,
        municipalityId: municipalityId || null,
        addressLine: addressLine.trim() || null,
        clinicName: clinicName.trim() || null,
        message: message.trim() || null,
      })
      if (result.success) {
        setSubmitted(true)
      } else if (result.errorCode === 'RATE_LIMITED') {
        setError({
          title: 'Ya recibimos una solicitud reciente',
          detail:
            result.errorMessage ||
            'Si necesitás contactarnos, escribinos por WhatsApp y el equipo de Lucy te responderá.',
          isRateLimit: true,
        })
      } else {
        setError({
          title: 'No pudimos enviar tu solicitud',
          detail: result.errorMessage || 'Intentá de nuevo en un momento.',
        })
      }
    } catch {
      setError({
        title: 'Error de conexión',
        detail: 'Revisá tu internet y volvé a intentar.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={() => { if (!loading) onClose() }}
    >
      <div
        className="bg-white rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="pr-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {submitted ? 'Recibimos tu solicitud' : 'Soy médico, quiero aparecer en Lucy'}
            </h2>
            {!submitted && (
              <p className="text-xs text-gray-500 mt-1">
                Dejanos tus datos. El equipo de Lucy te contactará.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            type="button"
            disabled={loading}
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full cursor-pointer flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Cerrar"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {submitted ? (
            // ───── Estado post-submit (genérico, Q6: sin tracking portal) ─────
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                <i className="ri-check-line text-3xl text-emerald-700" />
              </div>
              <p className="text-base font-medium text-gray-900 mb-2">
                Gracias. El equipo de Lucy te contactará en los próximos días.
              </p>
              <p className="text-sm text-gray-600 mb-6">
                Te escribiremos al teléfono o correo que dejaste para confirmar tu información y los próximos pasos.
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-emerald-700 text-white rounded-lg font-medium hover:bg-emerald-800 cursor-pointer"
              >
                Volver al inicio
              </button>
            </div>
          ) : (
            // ───── Form ─────
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-medium text-red-900">{error.title}</p>
                  <p className="text-sm text-red-700 mt-1">{error.detail}</p>
                  {error.isRateLimit && (
                    <a
                      href={WHATSAPP_FALLBACK_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-2 text-sm font-medium text-red-800 hover:text-red-900 underline"
                    >
                      <i className="ri-whatsapp-line" />
                      Escribir por WhatsApp
                    </a>
                  )}
                </div>
              )}

              {/* Nombre — obligatorio */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre completo <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Dr. María González"
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Teléfono — obligatorio */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Teléfono <span className="text-red-600">*</span>
                </label>
                <div className="flex gap-2">
                  <span className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-700">
                    {COUNTRY_CODE}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={phoneDisplay}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="7777-7777"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              {/* Email — opcional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Correo electrónico <span className="text-xs text-gray-500 font-normal">(recomendado)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Especialidad — opcional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Especialidad <span className="text-xs text-gray-500 font-normal">(recomendado)</span>
                </label>
                <select
                  value={specialtyId}
                  onChange={(e) => setSpecialtyId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white"
                >
                  <option value="">Elegí una opción…</option>
                  {(specialties as Array<{ id: string; name: string }>).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value={SPECIALTY_OTHER_SENTINEL}>Otra (especificá abajo)</option>
                </select>
                {specialtyId === SPECIALTY_OTHER_SENTINEL && (
                  <input
                    type="text"
                    value={specialtyOther}
                    onChange={(e) => setSpecialtyOther(e.target.value)}
                    placeholder="Ej: Medicina del deporte"
                    className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                  />
                )}
              </div>

              {/* Licencia / JVPM — opcional pero prominente */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Licencia profesional / JVPM{' '}
                  <span className="text-xs text-gray-500 font-normal">(recomendado)</span>
                </label>
                <input
                  type="text"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="Ej: JVPM-1234"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 uppercase"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Si no la tenés a mano ahora, podés enviarla después cuando te contactemos.
                </p>
              </div>

              {/* Departamento + Municipio — opcional */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Departamento</label>
                  <select
                    value={departmentId}
                    onChange={(e) => {
                      setDepartmentId(e.target.value)
                      setMunicipalityId('')
                    }}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white"
                  >
                    <option value="">—</option>
                    {(departments as Array<{ id: string; name: string }>).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Municipio</label>
                  <select
                    value={municipalityId}
                    onChange={(e) => setMunicipalityId(e.target.value)}
                    disabled={!departmentId}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 bg-white disabled:bg-gray-50 disabled:cursor-not-allowed"
                  >
                    <option value="">—</option>
                    {(municipalities as Array<{ id: string; name: string }>).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Clínica + dirección — opcional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de tu clínica</label>
                <input
                  type="text"
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder="Ej: Consultorio Dr. González"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dirección del consultorio</label>
                <input
                  type="text"
                  value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)}
                  placeholder="Calle, número, referencia"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Mensaje libre */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mensaje (opcional)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, 500))}
                  placeholder="Contanos algo de tu práctica o lo que te interesa de Lucy."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-emerald-600 resize-none"
                />
                <p className="text-xs text-gray-500 mt-1 text-right">{message.length}/500</p>
              </div>

              {/* LOPD — obligatorio */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-1 w-4 h-4 text-emerald-700 rounded cursor-pointer flex-shrink-0"
                  />
                  <span className="text-sm text-gray-700">
                    Acepto que LucyCare use mis datos para contactarme y validar mi solicitud, según la{' '}
                    <a
                      href="/privacidad"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 underline"
                    >
                      política de privacidad
                    </a>
                    .
                  </span>
                </label>
              </div>

              {/* CTAs */}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`w-full px-6 py-3 rounded-lg font-medium transition-colors ${
                  canSubmit
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {loading ? 'Enviando…' : 'Enviar solicitud'}
              </button>

              <a
                href={WHATSAPP_FALLBACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
              >
                <i className="ri-whatsapp-line mr-1" />
                Prefiero contactar por WhatsApp
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
