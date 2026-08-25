/**
 * PATIENT-CRM-P0 — servicio de lectura del CRM de pacientes.
 *
 * Habla EXCLUSIVAMENTE con las RPCs de `s7_77`. No consulta `patients` ni
 * `appointments` directamente, por dos razones:
 *
 *   1. La frontera clínica (D4) vive en el backend: la RPC enumera a mano las
 *      columnas que devuelve, así que ninguna columna asistencial llega al
 *      navegador. Una consulta directa desde acá saltaría esa barrera.
 *   2. Los agregados —citas, última actividad, próxima cita, relaciones— se
 *      calculan server-side sobre la página. Traerlos por separado sería el
 *      N+1 que este frente evita explícitamente.
 *
 * La unidad es la IDENTIDAD GLOBAL (`profiles`), no la ficha local. Las fichas
 * sin identidad viven en su propia bandeja y su conteo NO se suma al de
 * pacientes.
 */
import { supabase } from '../lib/supabase';
import { buildCsv } from '../lib/csv';

/** Tope duro, espejo del que aplica la RPC. Pedir más no sirve de nada. */
export const CRM_PAGE_SIZE = 25;
export const CRM_PAGE_SIZE_MAX = 50;

/** Estados derivados (D2). NO se persisten: los calcula la RPC en cada lectura. */
export type CrmStatus =
  | 'bloqueado'
  | 'en_seguimiento'
  | 'recurrente'
  | 'nuevo'
  | 'activo'
  | 'inactivo';

/** Prioridad de la etiqueta principal, fijada por el owner. */
export const CRM_STATUS_ORDER: readonly CrmStatus[] = [
  'bloqueado', 'en_seguimiento', 'recurrente', 'nuevo', 'activo', 'inactivo',
] as const;

export const CRM_STATUS_LABEL: Record<CrmStatus, string> = {
  bloqueado: 'Bloqueado',
  en_seguimiento: 'En seguimiento',
  recurrente: 'Recurrente',
  nuevo: 'Nuevo',
  activo: 'Activo',
  inactivo: 'Inactivo',
};

/**
 * Fila del listado. Es EXACTAMENTE la allowlist que devuelve la RPC: si algún
 * día alguien agrega un campo clínico al backend, este tipo no lo acepta sin
 * que alguien lo escriba a mano acá también.
 */
export interface CrmPatientRow {
  profile_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  crm_status: CrmStatus;
  blocked: boolean;
  /** Canal por el que entró la PRIMERA cita. NO es origen de adquisición. */
  canal_primera_cita: string | null;
  fichas: number;
  clinicas: number;
  medicos: number;
  citas_total: number;
  atendidas: number;
  ultima_actividad: string | null;
  proxima_cita: string | null;
  followups_abiertos: number;
  tags: string[];
}

/** Ficha local sin identidad global (D5). NO es un paciente comercial todavía. */
export interface UnlinkedPatientRow {
  patient_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  clinic_id: string | null;
  clinic_name: string | null;
  created_at: string;
  citas_total: number;
  ultima_actividad: string | null;
}

export interface CrmPage<T> {
  total: number;
  limit: number;
  offset: number;
  rows: T[];
}

export interface CrmStats {
  pacientes_totales: number;
  nuevos_30d: number;
  activos: number;
  con_proxima_cita: number;
  sin_actividad_180d: number;
  bloqueados: number;
  /** Se muestra APARTE: no se suma a `pacientes_totales` (D1). */
  pendientes_identificar: number;
}

/** Copy de los códigos tipados del backend. El mensaje crudo no se muestra. */
const ERROR_COPY: Record<string, string> = {
  P0140: 'No tienes permiso para ver el CRM de pacientes.',
  P0142: 'Ese formato de exportación no está disponible.',
  P0146: 'La exportación es demasiado grande. Afina la búsqueda o el filtro e inténtalo de nuevo.',
  P0147: 'Ese filtro de estado no es válido.',
};

function traducir(error: { code?: string; message?: string } | null): Error {
  const code = error?.code ?? '';
  return new Error(ERROR_COPY[code] ?? 'No pudimos cargar los pacientes. Prueba de nuevo en un momento.');
}

function acotar(limit: number): number {
  return Math.min(Math.max(limit || CRM_PAGE_SIZE, 1), CRM_PAGE_SIZE_MAX);
}

export async function listPatientsCrm(params: {
  search?: string;
  status?: CrmStatus | null;
  limit?: number;
  offset?: number;
} = {}): Promise<CrmPage<CrmPatientRow>> {
  const { data, error } = await supabase.rpc('admin_list_patients_crm', {
    p_search: params.search?.trim() || null,
    p_status: params.status ?? null,
    p_limit: acotar(params.limit ?? CRM_PAGE_SIZE),
    p_offset: Math.max(params.offset ?? 0, 0),
  });
  if (error) throw traducir(error);
  return data as unknown as CrmPage<CrmPatientRow>;
}

export async function listUnlinkedPatients(params: {
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<CrmPage<UnlinkedPatientRow>> {
  const { data, error } = await supabase.rpc('admin_list_unlinked_patients', {
    p_search: params.search?.trim() || null,
    p_limit: acotar(params.limit ?? CRM_PAGE_SIZE),
    p_offset: Math.max(params.offset ?? 0, 0),
  });
  if (error) throw traducir(error);
  return data as unknown as CrmPage<UnlinkedPatientRow>;
}

export async function getPatientsCrmStats(): Promise<CrmStats> {
  const { data, error } = await supabase.rpc('admin_patients_crm_stats');
  if (error) throw traducir(error);
  return data as unknown as CrmStats;
}

/* ═══════════════════════════════════════════════════════════
 * P5 · Exportación
 * ═══════════════════════════════════════════════════════════ */

/** Tope técnico, espejo del que aplica la RPC. Por encima, se pide acotar. */
export const CRM_EXPORT_MAX = 5000;

/**
 * Trae el conjunto FILTRADO COMPLETO, no la página visible.
 *
 * Reusa la misma RPC-núcleo que el listado, así que hereda el universo
 * canónico, la búsqueda, el filtro y —sobre todo— la allowlist de columnas: es
 * imposible que el export traiga un campo que la lista no traiga.
 *
 * El archivo se genera EN EL NAVEGADOR a partir de esta respuesta. No se sube
 * nada a Supabase ni se crea ningún bucket.
 */
export async function fetchPatientsCrmForExport(params: {
  search?: string;
  status?: CrmStatus | null;
  /** P0 exporta CSV y nada más. `.xlsx` real es una mejora posterior. */
  formato: 'csv';
}): Promise<CrmPatientRow[]> {
  const { data, error } = await supabase.rpc('admin_export_patients_crm', {
    p_search: params.search?.trim() || null,
    p_status: params.status ?? null,
    p_formato: params.formato,
  });
  if (error) throw traducir(error);
  return (data as unknown as CrmPage<CrmPatientRow>).rows;
}

/**
 * Columnas del archivo. Es un SUBCONJUNTO de la allowlist del backend: el
 * export no puede inventar campos, solo elegir cuáles de los que ya vienen
 * escribe. Las notas administrativas quedan FUERA de P0.
 */
const EXPORT_COLUMNS: { key: keyof CrmPatientRow; header: string }[] = [
  { key: 'profile_id', header: 'ID LucyCare' },
  { key: 'full_name', header: 'Nombre' },
  { key: 'phone', header: 'Teléfono' },
  { key: 'email', header: 'Correo' },
  { key: 'crm_status', header: 'Estado CRM' },
  { key: 'created_at', header: 'Fecha de registro' },
  { key: 'ultima_actividad', header: 'Última actividad' },
  { key: 'proxima_cita', header: 'Próxima cita' },
  { key: 'citas_total', header: 'Total de citas' },
  { key: 'atendidas', header: 'Total de atenciones' },
  { key: 'medicos', header: 'Médicos relacionados' },
  { key: 'clinicas', header: 'Clínicas relacionadas' },
  { key: 'canal_primera_cita', header: 'Canal 1.ª cita' },
  { key: 'tags', header: 'Etiquetas' },
];

function celda(row: CrmPatientRow, key: keyof CrmPatientRow): string {
  const v = row[key];
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(' | ');
  if (key === 'crm_status') return CRM_STATUS_LABEL[v as CrmStatus] ?? String(v);
  return String(v);
}

/**
 * CSV UTF-8 **con BOM**, generado con el serializador único de `lib/csv`.
 *
 * Ese serializador hace dos cosas que este archivo NO debe reimplementar:
 * neutraliza las celdas que Excel leería como fórmula (`=`, `+`, `-`, `@`,
 * tabulador, retorno de carro) y escapa según RFC 4180. Encabezados y datos
 * pasan por la misma función: una sola ruta, sin excepciones.
 */
export function buildPatientsCsv(rows: CrmPatientRow[]): Blob {
  const cabecera = EXPORT_COLUMNS.map((c) => c.header);
  const cuerpo = rows.map((r) => EXPORT_COLUMNS.map((c) => celda(r, c.key)));
  return new Blob([buildCsv(cabecera, cuerpo)], { type: 'text/csv;charset=utf-8;' });
}

export function exportFileName(ext: 'csv'): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `lucycare-pacientes-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${ext}`;
}
