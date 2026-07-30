import { Link } from 'react-router-dom';
import {
  OTP_PRIVACY_PATH,
  OTP_CONSENT_NOTICE_PRIMARY,
  OTP_CONSENT_NOTICE_SECONDARY_PREFIX,
  OTP_CONSENT_NOTICE_LINK_LABEL,
} from '../lib/otpConsent';

/**
 * Aviso de consentimiento de OTP (AUTH-P1D2) — superficie VISIBLE, comercial y
 * discreta. Se muestra antes de solicitar el código.
 *
 * Sin casilla, sin modal, sin texto de cargos del operador: el botón de enviar
 * el código es la acción afirmativa.
 *
 * Lo que se ve aquí es EXACTAMENTE el texto canónico de `otp-consent-v1` cuyo
 * hash queda registrado como evidencia (canónico === PRIMARY + ' ' + SECONDARY).
 * La Política de Privacidad puede ampliar información, pero eso NO forma parte
 * de este aviso ni de su hash — ver src/lib/otpConsent.ts.
 */
export default function OtpConsentNotice({ className = '' }: { className?: string }) {
  return (
    <div className={className}>
      <p className="text-sm text-gray-600">{OTP_CONSENT_NOTICE_PRIMARY}</p>
      <p className="text-xs text-gray-400 mt-0.5">
        {OTP_CONSENT_NOTICE_SECONDARY_PREFIX}
        <Link
          to={OTP_PRIVACY_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          {OTP_CONSENT_NOTICE_LINK_LABEL}
        </Link>
        .
      </p>
    </div>
  );
}
