/**
 * render.ts — lógica PURA del aviso al owner.
 *
 * Vive separada de `index.ts` a propósito: aquí no se usa ninguna API de Deno,
 * ni red, ni entorno. Así `scripts/check-s7_80.mjs` puede transpilarla con
 * esbuild y EJECUTARLA sobre casos sintéticos, en vez de inspeccionar texto.
 * Un check que solo lee el archivo no prueba comportamiento.
 */

/** Fila que devuelve `notify_owner_claim_batch`. La allowlist vive en la BASE. */
export interface OutboxItem {
  id: string;
  event_type: 'affiliation_submitted' | 'doctor_profile_claimed';
  occurred_at: string;
  attempt: number;
  full_name: string | null;
  specialty: string | null;
  phone: string | null;
  email: string | null;
  doctor_id: string | null;
  lucy_status: string | null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  idempotencyKey: string;
}

/**
 * Dominio como CONSTANTE LITERAL, nunca derivado del entorno.
 *
 * Misma regla que fijó el export de médicos (#352): un origen tomado del
 * runtime produciría enlaces que fallan en cuanto el correo sale de donde se
 * generó, y el error sería invisible hasta que alguien hiciera clic.
 */
const DOMINIO = 'https://lucycare.app';

/** Zona FIJADA. Sin ella, `Intl` usaría el reloj del servidor de la función. */
const ZONA = 'America/El_Salvador';

/**
 * `DD/MM/YYYY HH:mm` en hora de El Salvador.
 *
 * Se ensambla con `formatToParts` y NO con `toLocaleString`, por dos motivos
 * que solo aparecen al probarlo (los mismos de #350):
 *   · `es-SV` es un locale de 12 HORAS: sin `hourCycle` devuelve "01:49 p. m.".
 *   · `toLocaleString` INTERCALA UNA COMA entre fecha y hora.
 * Se usa `hourCycle: 'h23'` y no `hour12: false`: este último puede rendir
 * "24:15" para la medianoche.
 *
 * Una fecha ilegible conserva el valor original en vez de escribir
 * "Invalid Date".
 */
export function formatSv(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const partes = new Intl.DateTimeFormat('es-SV', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`;
}

/**
 * Clave de idempotencia de Resend, DETERMINÍSTICA a partir del id de la fila.
 *
 * Determinística es el punto entero: un reintento tras timeout envía la MISMA
 * clave, así que el proveedor devuelve el mensaje original en vez de mandar un
 * segundo correo. Eso es lo que hace recuperable una fila atascada en
 * `sending` sin arriesgar duplicados.
 *
 * No lleva PII: solo un uuid ya opaco.
 */
export function idempotencyKey(outboxId: string): string {
  return `lucycare-owner-notif-${outboxId}`;
}

const guion = (v: string | null | undefined): string => {
  const s = (v ?? '').trim();
  return s === '' ? '(no indicado)' : s;
};

/** Arma asunto y cuerpo. Texto plano, tuteo, sin anglicismos. */
export function renderEmail(item: OutboxItem): RenderedEmail {
  const cuando = formatSv(item.occurred_at);

  if (item.event_type === 'affiliation_submitted') {
    return {
      subject: 'LucyCare · Nueva solicitud de afiliación',
      text: [
        'Un médico completó el formulario para aparecer en LucyCare.',
        '',
        `Nombre:        ${guion(item.full_name)}`,
        `Especialidad:  ${guion(item.specialty)}`,
        `Teléfono:      ${guion(item.phone)}`,
        `Correo:        ${guion(item.email)}`,
        `Fecha:         ${cuando}`,
        '',
        `Revisá la solicitud en ${DOMINIO}/admin/afiliaciones`,
        '',
        '— Aviso automático de LucyCare. No respondas a este correo.',
      ].join('\n'),
      idempotencyKey: idempotencyKey(item.id),
    };
  }

  // doctor_profile_claimed.
  // El enlace apunta a la ficha admin del médico, que SÍ es ruta canónica
  // (`/admin/medicos/:id`). Si por lo que sea faltara el id, se cae a la
  // lista en vez de emitir un enlace roto.
  const enlace = item.doctor_id
    ? `${DOMINIO}/admin/medicos/${item.doctor_id}`
    : `${DOMINIO}/admin/medicos`;

  return {
    subject: 'LucyCare · Perfil médico reclamado',
    text: [
      'Un médico reclamó su perfil en LucyCare.',
      '',
      `Nombre:          ${guion(item.full_name)}`,
      `Especialidad:    ${guion(item.specialty)}`,
      `Estado LucyCare: ${guion(item.lucy_status)}`,
      `Fecha:           ${cuando}`,
      '',
      `Revisá la ficha en ${enlace}`,
      '',
      '— Aviso automático de LucyCare. No respondas a este correo.',
    ].join('\n'),
    idempotencyKey: idempotencyKey(item.id),
  };
}

/**
 * Código de error CORTO y acotado para `last_error_code`.
 *
 * Nunca se guarda el cuerpo del error del proveedor: puede traer direcciones
 * de correo, y la columna se lee desde LucyAdmin.
 */
export function errorCode(status: number | null, kind: string): string {
  const k = kind.replace(/[^a-z_]/gi, '').slice(0, 32) || 'unknown';
  return status === null ? k : `${k}_${status}`;
}
