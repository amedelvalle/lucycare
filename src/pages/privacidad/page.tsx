/**
 * Política de privacidad — MVP genérico (Q8 del análisis de afiliación).
 *
 * Texto base inicial. El owner puede iterar el contenido sin tocar
 * código; bajo el `consent_version` enviado al RPC
 * `submit_affiliation_request` queda trazable la versión que aceptó
 * cada lead.
 */

import { useNavigate } from 'react-router-dom'

const POLICY_VERSION = 'v1.0'
const POLICY_LAST_UPDATE = '26 de mayo de 2026'

export default function PrivacidadPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-gray-200 p-6 sm:p-10">
        <button
          onClick={() => navigate('/')}
          className="text-sm text-emerald-700 hover:text-emerald-800 mb-6 inline-flex items-center gap-1 cursor-pointer"
        >
          <i className="ri-arrow-left-line" /> Volver al inicio
        </button>

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Política de privacidad</h1>
        <p className="text-xs text-gray-500 mb-8">
          Versión {POLICY_VERSION} · Última actualización: {POLICY_LAST_UPDATE}
        </p>

        <div className="prose prose-sm sm:prose max-w-none text-gray-800 space-y-5">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. Quiénes somos</h2>
            <p>
              LucyCare es una plataforma de directorio médico y agenda en línea operada en
              El Salvador. Esta política describe cómo tratamos los datos personales que nos
              dejás al usar el sitio <strong>lucycare.app</strong> y servicios asociados.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. Qué datos recolectamos</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>De pacientes:</strong> nombre, teléfono, correo electrónico (opcional),
                fecha de nacimiento (opcional), información clínica que comparten con sus médicos
                durante una consulta.
              </li>
              <li>
                <strong>De médicos:</strong> nombre, teléfono, correo, número de licencia / JVPM,
                especialidad, datos de contacto del consultorio, fotos profesionales.
              </li>
              <li>
                <strong>De solicitudes de afiliación:</strong> nombre, teléfono, correo (opcional),
                licencia (opcional), especialidad y datos de contacto profesional, junto con la
                dirección IP y el navegador desde el que se envía la solicitud, con fines de
                prevención de fraude.
              </li>
              <li>
                <strong>De uso del sitio:</strong> registros técnicos mínimos (logs de servidor,
                cookies funcionales) necesarios para la operación.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. Para qué usamos tus datos</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Operar el directorio médico y permitir reservas de consulta.</li>
              <li>Mantener el historial clínico que cada médico crea sobre sus pacientes.</li>
              <li>Validar la identidad de médicos que solicitan aparecer en el directorio.</li>
              <li>Contactarte por teléfono o correo en relación a tu solicitud o consulta.</li>
              <li>Cumplir obligaciones legales que apliquen.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. Con quién compartimos tus datos</h2>
            <p>
              No vendemos tus datos. Los compartimos únicamente con:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Tu médico</strong> cuando reservás con él/ella o solicitás una consulta.
              </li>
              <li>
                <strong>Proveedores tecnológicos</strong> que operan la infraestructura del sitio
                (hosting, base de datos, envío de mensajes), bajo acuerdos de tratamiento de datos.
              </li>
              <li>
                <strong>Autoridades</strong> cuando exista una obligación legal expresa.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. Tus derechos</h2>
            <p>
              Tenés derecho a acceder, rectificar o pedir la eliminación de los datos personales
              que tenemos sobre vos. Para ejercerlos, escribinos por correo a{' '}
              <a href="mailto:lucycare.digital@gmail.com" className="text-emerald-700 underline">
                lucycare.digital@gmail.com
              </a>
              .
            </p>
            <p>
              Algunos datos clínicos pueden no ser eliminables inmediatamente si el médico que los
              guardó tiene obligaciones de conservación de historia clínica. En ese caso te lo
              informamos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. Seguridad</h2>
            <p>
              Aplicamos controles técnicos y organizativos razonables: cifrado en tránsito (HTTPS),
              cifrado en reposo a nivel de base de datos, control de acceso por roles, registros de
              auditoría sobre cambios sensibles. Ningún sistema es 100% inmune; te avisaremos si
              detectamos un incidente que afecte tus datos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">7. Cookies</h2>
            <p>
              Usamos cookies estrictamente necesarias para mantener tu sesión cuando iniciás
              sesión. No usamos cookies de publicidad de terceros.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. Cambios a esta política</h2>
            <p>
              Podemos actualizar este documento. Cada versión queda identificada por su número y
              fecha en la parte superior. Si el cambio es relevante, te avisaremos por los canales
              que correspondan.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">9. Contacto</h2>
            <p>
              Para cualquier consulta sobre privacidad, escribinos por correo a{' '}
              <a href="mailto:lucycare.digital@gmail.com" className="text-emerald-700 underline">
                lucycare.digital@gmail.com
              </a>
              .
            </p>
          </section>

          <p className="text-xs text-gray-500 italic">
            Este texto es una versión inicial. Será revisado por asesoría legal durante el período
            piloto y puede actualizarse para reflejar el marco regulatorio salvadoreño aplicable a
            datos personales y datos clínicos.
          </p>
        </div>
      </div>
    </div>
  )
}
