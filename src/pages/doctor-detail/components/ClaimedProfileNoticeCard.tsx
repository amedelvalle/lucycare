/**
 * Card informativa que aparece en /doctor/:id cuando el médico ya
 * reclamó su perfil (`lucy_status='claimed'`) pero todavía no tiene
 * agenda online ni verificación oficial.
 *
 * Comunica al visitante que el profesional confirmó su perfil y que
 * el onboarding está en curso. Al propio médico (si entra a su perfil
 * público) le sirve como confirmación visible del paso completado.
 */
export default function ClaimedProfileNoticeCard() {
  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-full flex items-center justify-center flex-shrink-0 border border-blue-200">
          <i className="ri-checkbox-circle-line text-2xl sm:text-3xl text-blue-700"></i>
        </div>
        <div className="flex-1">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">
            Perfil reclamado · onboarding en curso
          </h3>
          <p className="text-sm text-gray-700 mt-1">
            Este profesional ya confirmó su perfil. Estamos coordinando con Lucy para activar la reserva online. Mientras
            tanto, podés contactarlo directamente desde los datos del perfil.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            ¿Sos el profesional y necesitás continuar el onboarding?{' '}
            <a
              href="https://wa.me/50378056365"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 font-medium underline hover:text-blue-800"
            >
              Escribinos por WhatsApp
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
