/**
 * Asunto y cuerpo del correo de bienvenida al médico.
 *
 * Vive separada de `index.ts` a propósito: acá no se usa ninguna API de Deno,
 * así que el render se puede ejercitar desde Node en `check-s7_83.mjs` sin
 * levantar la función.
 *
 * Solo entran los cuatro datos aprobados: nombre visible, correo de
 * afiliación, slug y la URL pública derivada. Ni licencias, ni JVPM, ni DUI,
 * ni datos clínicos, ni nada interno de LucyAdmin.
 */

/** Dominio como CONSTANTE LITERAL, nunca un origen recibido (regla de #352). */
const PUBLIC_ORIGIN = 'https://lucycare.app';
const GUIDE_URL = 'https://medicos.lucycare.app/medicos/empezar';

/**
 * Trata el tratamiento profesional SIN duplicarlo.
 *
 * `profiles.full_name` es mixto en producción, verificado contra el directorio
 * público: "Dr. Camilo Carrillo" y "Dra. Pamela Bolaños" ya traen el
 * tratamiento, mientras que "Elba Angélica Lobo" no. Anteponer "Dr. " a ciegas
 * produciría "Dr. Dr. Harold Trillos" y, peor, "Dr. Dra. Pamela Bolaños", que
 * además la trataría en masculino.
 *
 * Regla: si el nombre YA trae tratamiento, se respeta tal cual. Si no lo trae,
 * se antepone "Dr. " según el copy aprobado.
 */
export function honorific(fullName: string): string {
  const name = fullName.trim().replace(/\s+/g, ' ');
  if (/^(dr|dra|doctor|doctora)\.?\s/i.test(name)) return name;
  return `Dr. ${name}`;
}

export function publicProfileUrl(slug: string): string {
  return `${PUBLIC_ORIGIN}/doctor/${slug}`;
}

export interface WelcomeInput {
  name: string;
  slug: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

export function renderWelcomeEmail(input: WelcomeInput): RenderedEmail {
  const treated = honorific(input.name);
  const url = publicProfileUrl(input.slug);

  const subject = `Bienvenido a LucyCare, ${treated}`;

  const text = [
    `Hola, ${treated}:`,
    '',
    'Gracias por solicitar tu afiliación a LucyCare.',
    '',
    'Hemos revisado tu solicitud y tu perfil profesional ya está disponible en LucyCare.',
    '',
    'Ver perfil:',
    url,
    '',
    'El siguiente paso es abrir tu perfil y, al final de la página, seleccionar',
    '"¿Eres este profesional?" para reclamarlo.',
    '',
    'Una vez completado el reclamo, podrás ingresar a tu panel de LucyCare y',
    'comenzar a administrar tu información profesional.',
    '',
    'Te recomendamos avanzar en este orden:',
    '',
    '- Completar tu fotografía, especialidad, descripción, clínica y ubicación.',
    '- Configurar los servicios que ofreces.',
    '- Definir tus días y horarios de atención.',
    '- Revisar cómo verán tu perfil los pacientes.',
    '- Preparar tu agenda para recibir reservas en línea.',
    '',
    'Guía para empezar:',
    GUIDE_URL,
    '',
    'No necesitas completar todo de una sola vez. Puedes comenzar con tu perfil',
    'y avanzar progresivamente con los servicios y la agenda.',
    '',
    'Si tienes alguna duda o necesitas ayuda durante la configuración, responde',
    'directamente a este correo y con gusto te ayudaremos.',
    '',
    'Bienvenido a LucyCare.',
    '',
    'LucyCare para Médicos',
  ].join('\n');

  return { subject, text };
}
