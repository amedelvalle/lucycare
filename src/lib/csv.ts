/**
 * Serialización CSV segura para Excel — ÚNICA fuente del proyecto.
 *
 * Toda celda de todo export pasa por `csvCell`. Resuelve dos problemas
 * distintos, en un solo lugar y en el orden correcto:
 *
 *   1. CSV / FORMULA INJECTION. Excel y LibreOffice evalúan como FÓRMULA
 *      cualquier celda que empiece por `=`, `+`, `-`, `@`, tabulador, retorno
 *      de carro o salto de línea. Un nombre guardado como `=1+1`, o un
 *      teléfono `+503…`, se ejecutaría al abrir el archivo, y lo mismo vale si
 *      viene precedido de un control:
 *      Excel descarta el blanco inicial y evalúa igual. Entrecomillar NO
 *      alcanza tampoco: Excel evalúa
 *      `"=1+1"` igual. La mitigación es anteponer un apóstrofo, que Excel
 *      interpreta como marca de "esto es texto" y no ejecuta.
 *   2. RFC 4180. Comillas internas dobladas, y campo entrecomillado cuando
 *      contiene comilla, coma o salto de línea.
 *
 * El ORDEN importa: se neutraliza ANTES de construir la celda, para que el
 * apóstrofo quede DENTRO del campo entrecomillado y no delante de él —si fuera
 * al revés, el apóstrofo quedaría fuera de las comillas y rompería el parseo.
 *
 * Sin dependencias: no hay librería de CSV en el bundle y no hace falta.
 */

/**
 * Byte Order Mark. No es decorativo: sin él, Excel en Windows abre el archivo
 * con la codificación local y rompe tildes y eñes.
 */
export const CSV_BOM = '﻿';

/**
 * Primer carácter que Excel puede leer como inicio de fórmula.
 *
 * Incluye los tres caracteres de control —tabulador, retorno de carro y salto
 * de línea—, no solo los cuatro operadores: al pegar o importar, Excel los
 * descarta como espacio en blanco inicial y evalúa lo que viene detrás, así
 * que `\n=1+1` es tan ejecutable como `=1+1`.
 */
const ARRANQUE_PELIGROSO = /^[=+\-@\t\r\n]/;

/** Caracteres que obligan a entrecomillar el campo (RFC 4180). */
const NECESITA_COMILLAS = /[",\r\n]/;

/**
 * Convierte un valor en una celda CSV segura.
 *
 * `null`/`undefined` → celda vacía. Todo lo demás se lleva a texto: el escape
 * es una decisión de serialización, no de tipo.
 */
export function csvCell(value: unknown): string {
  const texto = value === null || value === undefined ? '' : String(value);
  const neutral = ARRANQUE_PELIGROSO.test(texto) ? `'${texto}` : texto;
  return NECESITA_COMILLAS.test(neutral) ? `"${neutral.replace(/"/g, '""')}"` : neutral;
}

/** Una fila. Los encabezados también pasan por acá: una sola función, sin excepciones. */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** Documento completo, con BOM y saltos CRLF (los que espera Excel). */
export function buildCsv(headers: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  return CSV_BOM + [csvRow(headers), ...rows.map(csvRow)].join('\r\n');
}
