/**
 * Política de Privacidad de LucyCare — documento definitivo entregado por el
 * owner (LEGAL-P0 / PR 1). Reemplaza al texto provisional del MVP.
 *
 * El texto es FUENTE AUTORITATIVA: se reproduce sin resumir, parafrasear ni
 * ampliar. Cualquier cambio sustantivo requiere un documento nuevo del owner
 * y una versión nueva.
 *
 * ⚠️ ÚNICA divergencia respecto del .md original del owner: la entidad
 * operadora dice **Divalux, S.A. de C.V.**, no "Valux"
 * (LEGAL-ENTITY-RENAME-P0, autorizado por el owner). El .md fuente debe
 * actualizarse para que no queden desalineados.
 *
 * ⚠️ La versión mostrada acá es DOCUMENTAL. No es la constante
 * `CONSENT_VERSION` de `AffiliationRequestModal`, que versiona el
 * consentimiento LOPD del lead (`doctor_affiliation_requests.consent_version`,
 * s7_21) y es un concepto distinto: no se toca desde esta página.
 */

import { useNavigate } from 'react-router-dom'

const DOC_VERSION = '1.0'
const DOC_LAST_UPDATE = 'julio de 2026'
const DOC_EFFECTIVE = 'julio de 2026'

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

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          Política de Privacidad de LucyCare
        </h1>
        <p className="text-xs text-gray-500 mb-8">
          Versión {DOC_VERSION} · Última actualización: {DOC_LAST_UPDATE} · Entrada en vigor:{' '}
          {DOC_EFFECTIVE}
        </p>

        <div className="prose prose-sm sm:prose max-w-none text-gray-800 space-y-5">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. Responsable</h2>
            <p>
              LucyCare es una plataforma tecnológica operada por Divalux, S.A. de C.V., sociedad
              domiciliada en El Salvador.
            </p>
            <p>
              Esta Política explica cómo LucyCare recopila, utiliza, almacena, protege y, cuando
              corresponde, comunica datos personales relacionados con sus sitios web, aplicaciones,
              directorio de profesionales, cuentas de usuario, perfiles, agenda, reservas,
              suscripciones y demás funcionalidades habilitadas.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. Alcance</h2>
            <p>Esta Política se aplica a:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Visitantes de LucyCare;</li>
              <li>Pacientes y potenciales pacientes;</li>
              <li>Profesionales de la salud;</li>
              <li>Asistentes y personal autorizado;</li>
              <li>Clínicas y centros de atención;</li>
              <li>Personas que solicitan publicar o reclamar un perfil;</li>
              <li>Usuarios que crean una cuenta;</li>
              <li>Personas que solicitan soporte;</li>
              <li>Suscriptores y potenciales suscriptores.</li>
            </ul>
            <p>
              Al utilizar LucyCare, crear una cuenta, completar o reclamar un perfil, hacer una
              reserva o contratar una funcionalidad, la persona usuaria reconoce haber leído esta
              Política.
            </p>
            <p>
              Cuando una finalidad requiera consentimiento, LucyCare solicitará una manifestación
              específica antes de realizar el tratamiento correspondiente.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. Datos que podemos tratar</h2>
            <p>
              Según la relación de la persona con LucyCare, podremos tratar las siguientes
              categorías de datos:
            </p>

            <h3 className="text-base font-semibold text-gray-900">3.1 Datos de identificación</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Nombres y apellidos;</li>
              <li>Fecha de nacimiento;</li>
              <li>Sexo o género, cuando corresponda;</li>
              <li>Tipo y número de documento;</li>
              <li>Fotografía;</li>
              <li>Firma o constancia de aceptación electrónica;</li>
              <li>Identificadores internos de cuenta.</li>
            </ul>

            <h3 className="text-base font-semibold text-gray-900">3.2 Datos de contacto</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Número telefónico;</li>
              <li>Correo electrónico;</li>
              <li>País, departamento, municipio o localidad;</li>
              <li>Dirección profesional;</li>
              <li>Canal preferido de comunicación.</li>
            </ul>

            <h3 className="text-base font-semibold text-gray-900">3.3 Datos profesionales</h3>
            <p>En el caso de profesionales de la salud:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Profesión;</li>
              <li>Especialidad y subespecialidad;</li>
              <li>Número de autorización, registro o credencial profesional;</li>
              <li>Clínica o lugar de atención;</li>
              <li>Ubicación profesional;</li>
              <li>Servicios ofrecidos;</li>
              <li>Modalidades y horarios de atención;</li>
              <li>Idiomas;</li>
              <li>Formación académica;</li>
              <li>Experiencia;</li>
              <li>Fotografía y biografía profesional;</li>
              <li>Información pública de contacto;</li>
              <li>Documentos proporcionados para reclamar o validar un perfil;</li>
              <li>Estado de publicación, reclamación, verificación, suscripción y agenda.</li>
            </ul>

            <h3 className="text-base font-semibold text-gray-900">3.4 Datos de cuenta y seguridad</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Teléfono o correo utilizado para ingresar;</li>
              <li>Códigos y eventos de autenticación;</li>
              <li>Sesiones activas;</li>
              <li>Dispositivos;</li>
              <li>Dirección IP;</li>
              <li>Navegador y sistema operativo;</li>
              <li>Roles y permisos;</li>
              <li>Registros de acceso;</li>
              <li>Fecha de creación de cuenta;</li>
              <li>Cambios importantes efectuados en la cuenta;</li>
              <li>Aceptación de términos, políticas y versiones aplicables.</li>
            </ul>

            <h3 className="text-base font-semibold text-gray-900">3.5 Datos de agenda y reservas</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Profesional seleccionado;</li>
              <li>Fecha y hora solicitadas;</li>
              <li>Clínica o lugar de atención;</li>
              <li>Servicio solicitado;</li>
              <li>Estado de la cita;</li>
              <li>Reprogramaciones y cancelaciones;</li>
              <li>Lista de espera;</li>
              <li>Confirmaciones y recordatorios;</li>
              <li>Información administrativa necesaria para organizar la reserva.</li>
            </ul>

            <h3 className="text-base font-semibold text-gray-900">
              3.6 Datos relacionados con la salud
            </h3>
            <p>Cuando se utilicen funcionalidades clínicas, LucyCare podrá alojar o procesar:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Antecedentes;</li>
              <li>Signos vitales;</li>
              <li>Diagnósticos;</li>
              <li>Notas clínicas;</li>
              <li>Alergias;</li>
              <li>Tratamientos;</li>
              <li>Medicamentos y recetas;</li>
              <li>Resultados;</li>
              <li>Documentos clínicos;</li>
              <li>Información de consultas;</li>
              <li>Correcciones y adendas;</li>
              <li>Registros de auditoría del expediente.</li>
            </ul>
            <p>
              Los datos relacionados con la salud son sensibles y reciben una protección reforzada.
            </p>

            <h3 className="text-base font-semibold text-gray-900">
              3.7 Datos económicos y de facturación
            </h3>
            <p>Cuando se habiliten pagos o suscripciones reales:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Plan seleccionado;</li>
              <li>Periodicidad;</li>
              <li>Estado de la suscripción;</li>
              <li>Historial de transacciones;</li>
              <li>Datos necesarios para facturación;</li>
              <li>Tipo de comprobante;</li>
              <li>Razón social, NIT o NRC proporcionados para facturación;</li>
              <li>Identificadores de transacción comunicados por el procesador de pago.</li>
            </ul>
            <p>
              LucyCare no deberá almacenar números completos de tarjetas ni códigos de seguridad
              cuando el pago sea procesado por un proveedor externo.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. Origen de los datos</h2>
            <p>Los datos pueden ser obtenidos:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Directamente de la persona titular;</li>
              <li>De su representante autorizado;</li>
              <li>Del profesional o institución que presta la atención;</li>
              <li>De asistentes autorizados;</li>
              <li>De registros y fuentes profesionales públicas, cuando la ley lo permita;</li>
              <li>De proveedores tecnológicos;</li>
              <li>Del dispositivo utilizado;</li>
              <li>De la actividad realizada dentro de LucyCare;</li>
              <li>De autoridades competentes cuando exista obligación legal.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. Finalidades</h2>
            <p>LucyCare podrá tratar datos para:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Crear y administrar cuentas;</li>
              <li>Autenticar usuarios;</li>
              <li>Mantener la seguridad de la plataforma;</li>
              <li>Publicar y administrar perfiles profesionales;</li>
              <li>Permitir que un profesional reclame su perfil;</li>
              <li>Revisar información profesional;</li>
              <li>Gestionar agenda, disponibilidad y reservas;</li>
              <li>Enviar confirmaciones y recordatorios;</li>
              <li>Administrar listas de espera;</li>
              <li>Prestar soporte;</li>
              <li>Administrar suscripciones;</li>
              <li>Procesar pagos cuando esta función esté habilitada;</li>
              <li>Emitir o facilitar documentos de facturación;</li>
              <li>Prevenir fraude, suplantaciones y accesos no autorizados;</li>
              <li>Mantener registros de auditoría;</li>
              <li>Cumplir obligaciones legales;</li>
              <li>Atender solicitudes y reclamaciones;</li>
              <li>Mejorar el funcionamiento de LucyCare;</li>
              <li>Producir estadísticas agregadas o anonimizadas.</li>
            </ul>
            <p>
              Los datos clínicos identificables no serán vendidos ni utilizados para publicidad
              dirigida.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. Fundamento del tratamiento</h2>
            <p>El tratamiento podrá basarse, según corresponda, en:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Consentimiento;</li>
              <li>Ejecución de una relación contractual;</li>
              <li>Medidas solicitadas antes de contratar;</li>
              <li>Cumplimiento de obligaciones legales;</li>
              <li>Seguridad y prevención del fraude;</li>
              <li>Atención de solicitudes del titular;</li>
              <li>Intereses legítimos compatibles con los derechos de la persona;</li>
              <li>Obligaciones relacionadas con servicios de salud;</li>
              <li>
                Información profesional proveniente de fuentes legítimas, cuando la ley permita su
                utilización.
              </li>
            </ul>
            <p>
              La persona podrá retirar su consentimiento cuando el tratamiento dependa de este, sin
              afectar los tratamientos realizados anteriormente ni aquellos que deban continuar por
              obligación legal.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              7. Perfiles profesionales públicos
            </h2>
            <p>
              LucyCare podrá mostrar información profesional necesaria para que los usuarios
              conozcan y localicen a un profesional.
            </p>
            <p>Un perfil podrá encontrarse en alguno de los siguientes estados:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Publicado;</li>
              <li>No reclamado;</li>
              <li>Reclamado;</li>
              <li>Verificado;</li>
              <li>Con suscripción;</li>
              <li>Con agenda habilitada.</li>
            </ul>
            <p>La publicación de un perfil no significa necesariamente que el profesional:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Haya creado una cuenta;</li>
              <li>Haya reclamado el perfil;</li>
              <li>Esté suscrito;</li>
              <li>Esté verificado;</li>
              <li>Tenga agenda en línea;</li>
              <li>Sea empleado o representante de LucyCare;</li>
              <li>Sea recomendado o garantizado por LucyCare.</li>
            </ul>
            <p>
              Cuando un perfil se haya creado con información procedente de fuentes legítimas, el
              profesional podrá utilizar los mecanismos habilitados para reclamarlo, corregirlo,
              actualizarlo o solicitar su despublicación.
            </p>
            <p>
              LucyCare procurará no publicar domicilios particulares, documentos personales, datos
              financieros ni información ajena a la actividad profesional.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. Reclamación y verificación</h2>
            <p>
              Reclamar un perfil permite al profesional asumir su administración, pero no implica
              automáticamente:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Verificación profesional;</li>
              <li>Habilitación de agenda;</li>
              <li>Activación operativa;</li>
              <li>Publicación de datos adicionales;</li>
              <li>Contratación de una suscripción.</li>
            </ul>
            <p>
              La verificación es un proceso separado que puede requerir revisión de identidad,
              credenciales y documentos profesionales.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              9. Datos clínicos y responsabilidades
            </h2>
            <p>
              En relación con los datos de cuenta, seguridad, directorio, suscripciones y soporte,
              Divalux, S.A. de C.V. actúa normalmente como responsable del tratamiento.
            </p>
            <p>
              Cuando un profesional o una institución utiliza LucyCare para documentar la atención
              de sus pacientes:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>El profesional o institución determina la finalidad clínica;</li>
              <li>El profesional o institución decide quién puede acceder;</li>
              <li>
                El profesional o institución es responsable de cumplir sus obligaciones sanitarias;
              </li>
              <li>
                LucyCare actúa principalmente como proveedor tecnológico o encargado del
                tratamiento.
              </li>
            </ul>
            <p>
              LucyCare podrá tratar registros técnicos y de seguridad por responsabilidad propia
              para prevenir incidentes, investigar accesos y cumplir la normativa.
            </p>
            <p>LucyCare no toma decisiones médicas ni sustituye el juicio clínico del profesional.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">10. Compartición de información</h2>
            <p>Los datos podrán ser comunicados, dentro de los límites legales, a:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Profesionales elegidos por el paciente;</li>
              <li>Asistentes autorizados;</li>
              <li>Clínicas o instituciones vinculadas con la atención;</li>
              <li>Proveedores de infraestructura, alojamiento y seguridad;</li>
              <li>Proveedores de autenticación y comunicaciones;</li>
              <li>Procesadores de pago;</li>
              <li>Proveedores de facturación;</li>
              <li>Asesores sujetos a confidencialidad;</li>
              <li>Autoridades competentes;</li>
              <li>Adquirentes o sucesores de la operación, bajo obligaciones de protección.</li>
            </ul>
            <p>Los terceros recibirán únicamente la información necesaria para cumplir su función.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              11. Transferencias internacionales
            </h2>
            <p>
              LucyCare podrá utilizar infraestructura o proveedores ubicados fuera de El Salvador.
            </p>
            <p>
              Cuando corresponda, se adoptarán medidas contractuales, técnicas y organizativas para
              proteger la información y limitar su tratamiento a las finalidades establecidas.
            </p>
            <p>
              La expansión de LucyCare hacia Honduras u otros países estará sujeta a anexos y
              requisitos legales adicionales.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">12. Conservación</h2>
            <p>Los datos se conservarán durante el tiempo necesario para:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Mantener la cuenta o relación contractual;</li>
              <li>Prestar las funcionalidades solicitadas;</li>
              <li>Cumplir obligaciones sanitarias, tributarias o comerciales;</li>
              <li>Preservar registros de seguridad;</li>
              <li>Demostrar aceptaciones;</li>
              <li>Resolver reclamaciones;</li>
              <li>Ejercer o defender derechos.</li>
            </ul>
            <p>
              El cierre de una cuenta no significa necesariamente la eliminación inmediata de toda
              la información.
            </p>
            <p>
              Los datos sujetos a obligación legal de conservación podrán bloquearse o restringirse
              hasta que finalice el período aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">13. Seguridad</h2>
            <p>LucyCare aplicará medidas razonables de seguridad, incluyendo:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Autenticación;</li>
              <li>Control de accesos;</li>
              <li>Separación de roles;</li>
              <li>Mínimo privilegio;</li>
              <li>Registros de auditoría;</li>
              <li>Protección de comunicaciones;</li>
              <li>Respaldo;</li>
              <li>Monitoreo;</li>
              <li>Gestión de incidentes;</li>
              <li>Revisión de proveedores;</li>
              <li>Obligaciones de confidencialidad.</li>
            </ul>
            <p>Ningún sistema informático puede garantizar seguridad absoluta.</p>
            <p>
              Las personas usuarias también deben proteger sus dispositivos, no compartir códigos de
              acceso y reportar actividad sospechosa.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">14. Derechos de las personas</h2>
            <p>Conforme a la legislación aplicable, la persona titular podrá solicitar:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Acceso a sus datos;</li>
              <li>Información sobre su origen y finalidad;</li>
              <li>Rectificación;</li>
              <li>Actualización;</li>
              <li>Cancelación o supresión;</li>
              <li>Oposición;</li>
              <li>Limitación;</li>
              <li>Portabilidad, cuando sea aplicable;</li>
              <li>Retiro del consentimiento;</li>
              <li>Despublicación de información incorrecta o excesiva;</li>
              <li>Revisión de tratamientos automatizados relevantes;</li>
              <li>Información sobre destinatarios y transferencias.</li>
            </ul>
            <p>
              Las solicitudes podrán presentarse mediante los canales habilitados dentro de
              LucyCare.
            </p>
            <p>
              LucyCare podrá solicitar información razonable para confirmar la identidad de la
              persona solicitante.
            </p>
            <p>
              Algunos derechos podrán limitarse cuando exista obligación legal de conservar
              información, derechos de terceros, necesidad de preservar un expediente o una
              investigación, o cuando LucyCare actúe por instrucciones de otro responsable.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">15. Menores de edad</h2>
            <p>
              Cuando se traten datos de menores de edad o personas sujetas a representación, deberá
              intervenir el representante correspondiente cuando la legislación lo exija.
            </p>
            <p>
              LucyCare y los profesionales deberán aplicar medidas reforzadas de protección y
              atender el interés superior del menor.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">16. Comunicaciones</h2>
            <p>LucyCare podrá enviar comunicaciones necesarias para:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Autenticación;</li>
              <li>Seguridad;</li>
              <li>Reservas;</li>
              <li>Recordatorios;</li>
              <li>Soporte;</li>
              <li>Cambios contractuales;</li>
              <li>Funcionamiento de la cuenta.</li>
            </ul>
            <p>
              Las comunicaciones promocionales requerirán la autorización correspondiente y deberán
              permitir su revocación.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              17. Cookies y tecnologías similares
            </h2>
            <p>
              LucyCare podrá utilizar almacenamiento local, almacenamiento de sesión y tecnologías
              similares para:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Mantener la sesión;</li>
              <li>Recordar preferencias;</li>
              <li>Proteger formularios;</li>
              <li>Conservar temporalmente borradores;</li>
              <li>Medir funcionamiento;</li>
              <li>Prevenir fraude.</li>
            </ul>
            <p>
              Cuando se utilicen tecnologías no esenciales que requieran consentimiento, LucyCare
              habilitará el mecanismo correspondiente.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">18. Cambios</h2>
            <p>
              LucyCare podrá actualizar esta Política por cambios legales, operativos, tecnológicos
              o regulatorios.
            </p>
            <p>La versión vigente indicará el mes y año de actualización.</p>
            <p>
              Cuando un cambio sea sustancial, LucyCare podrá solicitar una nueva confirmación de
              lectura.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">19. Ley aplicable</h2>
            <p>
              Esta Política se rige inicialmente por las leyes de la República de El Salvador.
            </p>
            <p>
              La operación futura en otros países podrá estar sujeta a anexos territoriales y normas
              imperativas locales.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
