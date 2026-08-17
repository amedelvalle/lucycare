/**
 * Términos y Condiciones de LucyCare — documento definitivo entregado por el
 * owner (LEGAL-P0 / PR 1).
 *
 * El texto es FUENTE AUTORITATIVA: se reproduce sin resumir, parafrasear ni
 * ampliar. Cualquier cambio sustantivo requiere un documento nuevo del owner
 * y una versión nueva.
 *
 * ⚠️ ÚNICA divergencia respecto del .md original del owner: la entidad
 * operadora dice **Divalux** / **Divalux, S.A. de C.V.**, no "Valux"
 * (LEGAL-ENTITY-RENAME-P0, autorizado por el owner). El .md fuente debe
 * actualizarse para que no queden desalineados.
 *
 * Mismo patrón visual que `/privacidad` (página autocontenida, sin layout
 * legal compartido).
 */

import { useNavigate } from 'react-router-dom'

const DOC_VERSION = '1.0'
const DOC_LAST_UPDATE = 'julio de 2026'
const DOC_EFFECTIVE = 'julio de 2026'

export default function TerminosPage() {
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
          Términos y Condiciones de LucyCare
        </h1>
        <p className="text-xs text-gray-500 mb-8">
          Versión {DOC_VERSION} · Última actualización: {DOC_LAST_UPDATE} · Entrada en vigor:{' '}
          {DOC_EFFECTIVE}
        </p>

        <div className="prose prose-sm sm:prose max-w-none text-gray-800 space-y-5">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. Operador</h2>
            <p>
              LucyCare es una plataforma tecnológica operada por Divalux, S.A. de C.V., sociedad
              domiciliada en El Salvador.
            </p>
            <p>
              Estos Términos regulan el acceso y uso de los sitios, aplicaciones, directorio
              profesional, cuentas, perfiles, agenda, reservas, suscripciones y demás
              funcionalidades habilitadas bajo la marca LucyCare.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. Aceptación</h2>
            <p>
              La persona acepta estos Términos cuando realiza cualquiera de las siguientes
              acciones:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Crea una cuenta;</li>
              <li>Inicia sesión;</li>
              <li>Completa un perfil;</li>
              <li>Reclama un perfil profesional;</li>
              <li>Acepta una invitación;</li>
              <li>Utiliza el panel;</li>
              <li>Configura agenda o disponibilidad;</li>
              <li>Publica información;</li>
              <li>Realiza una reserva;</li>
              <li>Contrata una suscripción;</li>
              <li>Continúa hacia un proceso de pago;</li>
              <li>
                Utiliza cualquier funcionalidad que indique que estos Términos resultan aplicables.
              </li>
            </ul>
            <p>
              La aceptación electrónica tendrá la misma validez que una aceptación realizada por
              otros medios legalmente reconocidos.
            </p>
            <p>Si la persona no está de acuerdo, deberá abstenerse de utilizar las funcionalidades.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. Naturaleza de LucyCare</h2>
            <p>LucyCare es una plataforma tecnológica que facilita, entre otras actividades:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Publicación de perfiles profesionales;</li>
              <li>Búsqueda de profesionales;</li>
              <li>Comunicación entre usuarios;</li>
              <li>Gestión de agendas;</li>
              <li>Reservas;</li>
              <li>Listas de espera;</li>
              <li>Herramientas administrativas;</li>
              <li>Herramientas clínicas;</li>
              <li>Administración de suscripciones.</li>
            </ul>
            <p>
              LucyCare no es una clínica, hospital, establecimiento de salud ni prestador directo de
              consultas médicas.
            </p>
            <p>LucyCare no diagnostica, prescribe, trata ni sustituye al profesional de la salud.</p>
            <p>
              La relación asistencial se establece directamente entre el paciente y el profesional o
              institución que presta la atención.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. Usuarios</h2>
            <p>LucyCare podrá ser utilizada por:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Visitantes;</li>
              <li>Pacientes;</li>
              <li>Profesionales de la salud;</li>
              <li>Asistentes;</li>
              <li>Personal autorizado;</li>
              <li>Clínicas;</li>
              <li>Instituciones;</li>
              <li>Administradores;</li>
              <li>Suscriptores.</li>
            </ul>
            <p>
              La disponibilidad de cada función dependerá del tipo de cuenta, permisos, estado del
              perfil, plan contratado y configuración del usuario.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. Capacidad</h2>
            <p>La persona que crea una cuenta o acepta estos Términos declara tener capacidad legal.</p>
            <p>
              Quien actúe en representación de una sociedad, clínica, institución, menor de edad o
              tercero declara contar con autorización válida.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. Cuenta y seguridad</h2>
            <p>La persona usuaria se compromete a:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Proporcionar información correcta;</li>
              <li>Mantener sus datos actualizados;</li>
              <li>Proteger su dispositivo;</li>
              <li>No compartir códigos de autenticación;</li>
              <li>No permitir accesos no autorizados;</li>
              <li>Reportar actividad sospechosa;</li>
              <li>Utilizar únicamente su propia identidad o una representación autorizada.</li>
            </ul>
            <p>
              Las cuentas son personales, salvo las cuentas o accesos institucionales expresamente
              habilitados.
            </p>
            <p>
              LucyCare podrá cerrar sesiones, bloquear accesos o solicitar verificaciones
              adicionales cuando detecte riesgos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">7. Perfiles profesionales</h2>
            <p>
              LucyCare podrá mostrar perfiles profesionales con información relevante para el
              público.
            </p>
            <p>
              Un perfil público podrá existir antes de ser reclamado por el profesional, cuando la
              información se haya obtenido o publicado legítimamente.
            </p>
            <p>La existencia de un perfil no implica que el profesional:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Haya contratado LucyCare;</li>
              <li>Administre el perfil;</li>
              <li>Haya sido verificado;</li>
              <li>Tenga agenda en línea;</li>
              <li>Mantenga relación laboral o societaria con Divalux;</li>
              <li>Sea recomendado por LucyCare.</li>
            </ul>
            <p>
              El profesional podrá utilizar los mecanismos disponibles para reclamar, corregir,
              completar o solicitar la despublicación de su información.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. Reclamación del perfil</h2>
            <p>Para reclamar un perfil, LucyCare podrá solicitar:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Autenticación;</li>
              <li>Confirmación de identidad;</li>
              <li>Número o documento profesional;</li>
              <li>Aceptación de estos Términos;</li>
              <li>Información adicional razonablemente necesaria.</li>
            </ul>
            <p>Reclamar el perfil significa asumir su administración dentro de LucyCare.</p>
            <p>Reclamar no equivale a:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Ser verificado;</li>
              <li>Quedar publicado automáticamente;</li>
              <li>Activar agenda;</li>
              <li>Habilitar reservas;</li>
              <li>Contratar una suscripción;</li>
              <li>Recibir aprobación de una autoridad sanitaria.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">9. Verificación profesional</h2>
            <p>
              La verificación de LucyCare es un procedimiento administrativo interno y limitado.
            </p>
            <p>
              LucyCare podrá revisar documentos, registros profesionales y consistencia de la
              información.
            </p>
            <p>La verificación:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>No sustituye la autorización de las autoridades competentes;</li>
              <li>No constituye certificación de calidad;</li>
              <li>No garantiza la conducta futura del profesional;</li>
              <li>No libera al profesional de sus obligaciones legales;</li>
              <li>
                Podrá ser suspendida o retirada si la información resulta incorrecta o
                desactualizada.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">10. Obligaciones del profesional</h2>
            <p>El profesional es responsable de:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Mantener habilitación legal para ejercer;</li>
              <li>Cumplir la normativa sanitaria y profesional;</li>
              <li>Mantener actualizada su información;</li>
              <li>Actuar dentro de su competencia;</li>
              <li>Obtener consentimientos clínicos cuando correspondan;</li>
              <li>Proteger la confidencialidad;</li>
              <li>Custodiar adecuadamente la información;</li>
              <li>Controlar el acceso de asistentes;</li>
              <li>Prestar directamente los servicios ofrecidos;</li>
              <li>Fijar y comunicar sus honorarios;</li>
              <li>Atender reclamaciones relacionadas con su actividad profesional;</li>
              <li>Cumplir obligaciones fiscales y regulatorias propias.</li>
            </ul>
            <p>
              LucyCare no responde por diagnósticos, tratamientos, recetas, decisiones clínicas,
              honorarios ni resultados profesionales.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              11. Asistentes y personal autorizado
            </h2>
            <p>El profesional podrá invitar asistentes cuando la funcionalidad esté habilitada.</p>
            <p>El profesional será responsable de:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Asignar acceso únicamente a personas autorizadas;</li>
              <li>Otorgar permisos proporcionales;</li>
              <li>Supervisar su uso;</li>
              <li>Revocar accesos innecesarios;</li>
              <li>Proteger información clínica y administrativa.</li>
            </ul>
            <p>
              Los asistentes no podrán actuar como profesionales de la salud salvo que cuenten con
              la habilitación y el rol correspondiente.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              12. Pacientes, reservas y atención
            </h2>
            <p>LucyCare podrá facilitar la reserva de una cita, pero:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>La disponibilidad es administrada por el profesional;</li>
              <li>Una solicitud puede requerir confirmación;</li>
              <li>El profesional puede reprogramar o cancelar;</li>
              <li>El paciente debe proporcionar datos correctos;</li>
              <li>Las urgencias no deben gestionarse exclusivamente por LucyCare;</li>
              <li>LucyCare no garantiza resultados médicos ni disponibilidad permanente.</li>
            </ul>
            <p>
              El precio de la consulta, forma de pago y condiciones de atención pertenecen al
              profesional o institución, salvo que LucyCare indique expresamente lo contrario.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">13. Suscripciones</h2>
            <p>Algunas funcionalidades requieren una suscripción.</p>
            <p>
              El plan aplicable, precio, periodicidad, funciones y cupos serán los mostrados antes
              de confirmar la contratación.
            </p>
            <p>
              La publicación o reclamación de un perfil no implica necesariamente una suscripción
              activa.
            </p>
            <p>
              La contratación y cancelación se regirán adicionalmente por la Política de Cancelación
              y Suscripción.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">14. Información publicada</h2>
            <p>La persona que publica contenido declara que:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Tiene derecho a utilizarlo;</li>
              <li>Es correcto;</li>
              <li>No infringe derechos de terceros;</li>
              <li>No contiene información ilícita;</li>
              <li>No contiene datos de pacientes en espacios públicos;</li>
              <li>Cuenta con las autorizaciones necesarias.</li>
            </ul>
            <p>
              El usuario autoriza a LucyCare a alojar, reproducir, adaptar técnicamente y mostrar el
              contenido durante el tiempo necesario para operar la plataforma.
            </p>
            <p>Esta autorización no transfiere la propiedad del contenido.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">15. Uso permitido</h2>
            <p>LucyCare deberá utilizarse con fines lícitos.</p>
            <p>Está prohibido:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Suplantar identidades;</li>
              <li>Crear perfiles falsos;</li>
              <li>Introducir información fraudulenta;</li>
              <li>Acceder sin autorización;</li>
              <li>Obtener datos de forma masiva;</li>
              <li>Vulnerar medidas de seguridad;</li>
              <li>Transmitir código malicioso;</li>
              <li>Acosar o amenazar;</li>
              <li>Publicar datos clínicos en espacios públicos;</li>
              <li>Utilizar LucyCare para ejercer ilegalmente una profesión;</li>
              <li>Manipular reseñas;</li>
              <li>Interferir con el funcionamiento;</li>
              <li>Revender accesos sin autorización;</li>
              <li>
                Utilizar información de LucyCare para prácticas discriminatorias o ilícitas.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">16. Moderación</h2>
            <p>
              LucyCare podrá revisar, corregir, restringir, despublicar o eliminar contenido cuando:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Sea falso o engañoso;</li>
              <li>Vulnere derechos;</li>
              <li>Comprometa la seguridad;</li>
              <li>Infrinja estos Términos;</li>
              <li>Exista requerimiento de una autoridad;</li>
              <li>El perfil esté duplicado;</li>
              <li>El profesional ya no esté habilitado;</li>
              <li>Sea necesario proteger a usuarios o terceros.</li>
            </ul>
            <p>
              Cuando sea razonablemente posible, LucyCare permitirá aclarar o corregir la
              información.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">17. Propiedad intelectual</h2>
            <p>
              LucyCare, sus marcas, logotipos, diseños, software, documentación y contenidos propios
              pertenecen a Divalux, S.A. de C.V. o a sus licenciantes.
            </p>
            <p>
              El uso de LucyCare no concede derechos sobre la marca, código, diseño o
              funcionalidades.
            </p>
            <p>
              No se permite copiar, modificar, distribuir, descompilar, explotar o utilizar estos
              elementos fuera de lo autorizado por la ley o por acuerdo expreso.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">18. Servicios de terceros</h2>
            <p>LucyCare puede integrar servicios externos de:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Alojamiento;</li>
              <li>Mapas;</li>
              <li>Comunicaciones;</li>
              <li>Autenticación;</li>
              <li>Pagos;</li>
              <li>Analítica;</li>
              <li>Soporte.</li>
            </ul>
            <p>El uso de esos servicios podrá estar sujeto a condiciones adicionales.</p>
            <p>
              LucyCare no controla la disponibilidad ni las políticas de plataformas externas.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">19. Disponibilidad y evolución</h2>
            <p>LucyCare podrá:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Agregar o retirar funciones;</li>
              <li>Realizar mantenimiento;</li>
              <li>Modificar interfaces;</li>
              <li>Establecer límites;</li>
              <li>Corregir errores;</li>
              <li>Actualizar medidas de seguridad;</li>
              <li>Adaptar funciones por país o plan.</li>
            </ul>
            <p>
              LucyCare procurará mantener una operación razonable, pero no garantiza disponibilidad
              ininterrumpida.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">20. Suspensión y terminación</h2>
            <p>LucyCare podrá suspender o terminar una cuenta cuando exista:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Incumplimiento de estos Términos;</li>
              <li>Falta de pago;</li>
              <li>Fraude;</li>
              <li>Riesgo de seguridad;</li>
              <li>Suplantación;</li>
              <li>Ejercicio profesional no autorizado;</li>
              <li>Requerimiento legal;</li>
              <li>Uso perjudicial para usuarios o terceros.</li>
            </ul>
            <p>La suspensión de una cuenta no elimina obligaciones pendientes.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">21. Responsabilidad</h2>
            <p>LucyCare responderá dentro de los límites establecidos por la legislación aplicable.</p>
            <p>LucyCare no será responsable por:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Decisiones médicas;</li>
              <li>Calidad o resultado de la atención;</li>
              <li>Actos u omisiones del profesional;</li>
              <li>Información incorrecta proporcionada por usuarios;</li>
              <li>Indisponibilidad causada por terceros;</li>
              <li>Pérdida causada por uso indebido de credenciales;</li>
              <li>Acuerdos celebrados directamente entre paciente y profesional;</li>
              <li>Eventos de fuerza mayor.</li>
            </ul>
            <p>
              Nada de estos Términos excluye derechos irrenunciables ni responsabilidad que
              legalmente no pueda limitarse.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">22. Evidencia electrónica</h2>
            <p>LucyCare podrá conservar evidencia de:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Fecha y hora de aceptación;</li>
              <li>Versión aceptada;</li>
              <li>Cuenta asociada;</li>
              <li>Dirección IP;</li>
              <li>Dispositivo;</li>
              <li>Evento realizado;</li>
              <li>Cambios de perfil;</li>
              <li>Autenticaciones;</li>
              <li>Suscripciones.</li>
            </ul>
            <p>
              Estos registros podrán utilizarse para seguridad, auditoría, cumplimiento y
              resolución de disputas.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">23. Cambios</h2>
            <p>LucyCare podrá actualizar estos Términos.</p>
            <p>
              Los cambios sustanciales serán comunicados mediante medios razonables y podrán
              requerir nueva aceptación.
            </p>
            <p>
              El uso posterior a la entrada en vigor implicará aceptación cuando la legislación lo
              permita.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">24. Legislación y jurisdicción</h2>
            <p>Estos Términos se rigen por las leyes de la República de El Salvador.</p>
            <p>
              Las controversias se someterán a las autoridades y tribunales competentes, sin limitar
              los derechos irrenunciables de consumidores o titulares de datos.
            </p>
            <p>
              La operación futura en Honduras u otros países podrá regirse también por anexos
              específicos.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
