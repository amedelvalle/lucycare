/**
 * Validación y formato de documentos de identidad por tipo.
 *
 * - DUI (El Salvador): 9 dígitos, formato visual `00000000-0`. La forma
 *   canónica para guardar / dedup es CON guion (`00000000-0`).
 * - Pasaporte / carnet de minoridad / otro: trim + cap de longitud,
 *   sin máscara estricta (mezcla de letras y dígitos permitida).
 *
 * Documento vacío es válido — el paciente queda sin documento (NULL).
 */

export type DocumentType = 'dui' | 'partida_nacimiento' | 'pasaporte' | 'carnet_residente';

/** Longitud máxima razonable para tipos no-DUI. */
const GENERIC_DOC_MAX_LEN = 40;

export interface DocumentValidation {
  valid: boolean;
  error?: string;
  /** Forma canónica para guardar (`null` si el documento queda vacío). */
  canonical: string | null;
}

/**
 * Solo dígitos, máximo 9. Para usar en `input.onChange` de DUI:
 * descarta letras y separadores que tipea el usuario, y cuela a 9 dígitos.
 */
export function sanitizeDuiInput(input: string): string {
  return input.replace(/[^0-9]/g, '').slice(0, 9);
}

/**
 * Toma dígitos de un DUI (1-9) y devuelve el display: con guion
 * cuando hay 9 dígitos completos (`'02526538-4'`), si no se muestra
 * tal cual mientras el usuario tipea.
 */
export function formatDuiDisplay(digits: string): string {
  if (digits.length <= 8) return digits;
  return digits.slice(0, 8) + '-' + digits.slice(8);
}

/** trim + colapsa espacios + cap a maxLen. Para documentos no-DUI. */
export function sanitizeGenericDoc(input: string, maxLen = GENERIC_DOC_MAX_LEN): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

/** Match estricto del formato canónico DUI. Útil para diagnósticos. */
export function isCanonicalDui(s: string | null | undefined): boolean {
  return !!s && /^[0-9]{8}-[0-9]$/.test(s);
}

/**
 * Valida y normaliza un documento. Documento vacío → `valid:true, canonical:null`
 * (el paciente queda sin documento). DUI inválido → `valid:false` con error
 * en español. Otros tipos validados de forma laxa.
 */
export function validateDocument(
  type: DocumentType | string | undefined,
  rawNumber: string | null | undefined
): DocumentValidation {
  const num = (rawNumber ?? '').trim();
  if (!num) return { valid: true, canonical: null };

  if (type === 'dui') {
    const digits = num.replace(/[^0-9]/g, '');
    if (digits.length !== 9) {
      return {
        valid: false,
        error: 'El DUI debe tener 9 dígitos.',
        canonical: null,
      };
    }
    return { valid: true, canonical: digits.slice(0, 8) + '-' + digits[8] };
  }

  const generic = sanitizeGenericDoc(num);
  if (!generic) return { valid: true, canonical: null };
  if (generic.length > GENERIC_DOC_MAX_LEN) {
    return {
      valid: false,
      error: `El documento es demasiado largo (máx ${GENERIC_DOC_MAX_LEN} caracteres).`,
      canonical: null,
    };
  }
  return { valid: true, canonical: generic };
}
