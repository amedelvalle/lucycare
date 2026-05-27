/**
 * @deprecated Reemplazado por `AffiliationRequestModal` (Afiliación
 * Fase 1) que persiste el lead en `doctor_affiliation_requests` y
 * captura datos estructurados (nombre, phone, email, license,
 * especialidad, etc.).
 *
 * Este modal era una mitigación intermedia post-PR #53: solo invitaba
 * a contactar por WhatsApp, sin captura estructurada. Se conserva por
 * historial git. NO importar desde código nuevo.
 */

interface DoctorInterestModalProps {
  onClose: () => void;
}

const WHATSAPP_NUMBER = '50378056365'; // mismo número usado en otros CTAs de soporte
const WHATSAPP_MESSAGE = encodeURIComponent(
  'Hola, soy médico y quiero afiliarme a Lucy. Mi nombre es [tu nombre completo], ' +
    'especialidad [tu especialidad], licencia/JVPM [tu número]. Gracias.',
);
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`;

export default function DoctorInterestModal({ onClose }: DoctorInterestModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 pr-4">
            Soy médico, quiero aparecer en Lucy
          </h2>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full cursor-pointer flex-shrink-0"
            aria-label="Cerrar"
          >
            <i className="ri-close-line text-xl text-gray-700"></i>
          </button>
        </div>

        {/* Body */}
        <div className="text-center py-2">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <i className="ri-stethoscope-line text-3xl text-emerald-700" />
          </div>
          <p className="text-base text-gray-800 mb-2 font-medium">
            Estamos habilitando nuevas afiliaciones médicas.
          </p>
          <p className="text-sm text-gray-600 mb-6">
            Dejanos tus datos por WhatsApp y el equipo de Lucy te contactará.
          </p>

          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 w-full justify-center px-6 py-3 bg-emerald-700 text-white rounded-lg font-medium hover:bg-emerald-800 cursor-pointer"
          >
            <i className="ri-whatsapp-line text-lg"></i>
            Escribir por WhatsApp
          </a>

          <button
            onClick={onClose}
            className="mt-3 w-full px-6 py-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
