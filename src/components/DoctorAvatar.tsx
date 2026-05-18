import { useState } from 'react';

interface DoctorAvatarProps {
  name: string;
  photoUrl?: string | null;
  /** Clases de tamaño/forma del contenedor. Default: 80px circular. */
  className?: string;
  /** Tamaño del texto de iniciales. Default: text-xl. */
  textClassName?: string;
}

const HONORIFICS = new Set(['dr', 'dra', 'dr.', 'dra.', 'lic', 'lic.']);
const CONNECTORS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

/** Iniciales del médico ignorando títulos y conectores.
 *  "Dr. Camilo Carrillo" → "CC" · "Dra. Verónica de Chávez" → "VC" */
function getInitials(name: string): string {
  const words = (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !HONORIFICS.has(w.toLowerCase()))
    .filter((w) => !CONNECTORS.has(w.toLowerCase()));
  if (words.length === 0) return '';
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/**
 * Avatar de médico con fallback limpio. Nunca muestra el ícono roto:
 * si no hay foto o la URL falla (onError), cae a iniciales sobre un
 * contenedor circular con fondo suave. Sin iniciales → ícono usuario.
 */
export default function DoctorAvatar({
  name,
  photoUrl,
  className = 'w-20 h-20',
  textClassName = 'text-xl',
}: DoctorAvatarProps) {
  const [errored, setErrored] = useState(false);
  const initials = getInitials(name);

  const showImg = !!photoUrl && photoUrl.trim() !== '' && !errored;

  if (showImg) {
    return (
      <img
        src={photoUrl as string}
        alt={name}
        onError={() => setErrored(true)}
        className={`${className} rounded-full object-cover object-top bg-gray-100`}
      />
    );
  }

  return (
    <div
      className={`${className} rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold flex-shrink-0`}
      aria-label={name || 'Médico sin foto'}
      title={name}
    >
      {initials ? (
        <span className={textClassName}>{initials}</span>
      ) : (
        <i className={`ri-user-3-line ${textClassName}`} />
      )}
    </div>
  );
}
