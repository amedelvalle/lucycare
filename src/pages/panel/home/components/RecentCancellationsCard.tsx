/**
 * Tarjeta "Cancelaciones recientes" — dashboard del médico.
 *
 * Muestra las últimas cancelaciones hechas por PACIENTES desde LucyCare, para
 * que el médico se entere dentro de su flujo habitual y sin un reporte aparte.
 *
 * - Consume `list_recent_patient_cancellations` (s7_70), que NO acepta
 *   doctorId: lo deriva de auth.uid(). Máximo 5 filas y ventana de 7 días,
 *   ambos fijos server-side.
 * - Se OCULTA por completo si no hay cancelaciones: el panel no crece para
 *   quien no las tiene.
 * - Sin leído/no leído, sin badges, sin contadores. La nota libre del paciente
 *   NO se muestra acá (vive en el detalle de la cita): el dashboard no es un
 *   muro de texto.
 */

import { Link } from 'react-router-dom'
import type { RecentPatientCancellation } from '../../../../services/dashboard.service'

const REASON_LABEL: Record<string, string> = {
  no_puedo_asistir: 'No puede asistir',
  otro_horario: 'Necesita otro horario',
  ya_no_necesito: 'Ya no necesita la consulta',
  otro: 'Otro motivo',
}

/** 'YYYY-MM-DD' en hora LOCAL — nunca toISOString(), que salta de día. */
function localDateStr(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function formatAppointmentWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-SV', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** "hace 2 horas" / "ayer" / fecha corta. */
function formatRelative(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'recién'
    if (mins < 60) return `hace ${mins} min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `hace ${hours} h`
    const days = Math.floor(hours / 24)
    if (days === 1) return 'ayer'
    return `hace ${days} días`
  } catch {
    return ''
  }
}

interface Props {
  cancellations: RecentPatientCancellation[]
  isLoading: boolean
}

export default function RecentCancellationsCard({ cancellations, isLoading }: Props) {
  // Oculta durante la carga y cuando no hay nada que mostrar.
  if (isLoading || cancellations.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h2 className="text-base font-semibold text-gray-900">Cancelaciones recientes</h2>
      <p className="text-sm text-gray-500 mt-0.5 mb-4">
        Últimas cancelaciones hechas por pacientes desde LucyCare.
      </p>

      {/* En móvil la lista se acota y hace scroll interno: con 5 registros y
          nombres largos la tarjeta llegaba al 75% del alto en 360 px y
          empujaba las citas de hoy fuera del primer pantallazo. El límite va
          SOLO en la lista — título y descripción quedan siempre visibles — y
          desaparece desde `sm`, así que escritorio no cambia. Los 5 registros
          siguen accesibles con scroll. */}
      <ul className="divide-y divide-gray-100 max-h-[320px] overflow-y-auto sm:max-h-none sm:overflow-visible">
        {cancellations.map((c) => (
          <li key={c.appointmentId} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{c.patientName}</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  Cita: <span className="capitalize">{formatAppointmentWhen(c.appointmentStart)}</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Cancelada {formatRelative(c.cancelledAt)}
                  {c.reason ? ` · ${REASON_LABEL[c.reason] ?? c.reason}` : ''}
                </p>
              </div>
              {/* Objetivo táctil de 44 px de alto: el enlace medía 63×20 y
                  exigía puntería en móvil. El padding negativo compensa el
                  px-2 para que el área crezca sin mover el texto ni pisar el
                  nombre o la fecha. */}
              <Link
                to={`/panel/citas?date=${localDateStr(c.appointmentStart)}`}
                className="inline-flex min-h-[44px] items-center px-2 -mx-2 text-sm font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap"
              >
                Ver cita →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
