import type { ConsultationContext } from '@/services/consultations.service';
import type { Prescription, DurationUnit } from '@/services/prescriptions.service';

/**
 * Layout de receta para impresión (window.print()) / Guardar como PDF.
 * Por default está oculto en pantalla y solo aparece al imprimir.
 *
 * Uso:
 *   <RecetaPrint ctx={ctx} prescriptions={prescriptions} />
 *   <Button onClick={() => window.print()}>Imprimir</Button>
 *
 * El parent debe asegurar que TODO lo demás esté con `print:hidden` para que
 * solo aparezca este componente al imprimir.
 *
 * Diseño: tarjeta limpia con franja superior teal, encabezado del médico +
 * fecha, bloque gris de paciente y tabla de prescripción. SIN pie de firma
 * (los datos del médico viven una sola vez, en el encabezado).
 */
interface Props {
  ctx: ConsultationContext;
  prescriptions: Prescription[];
}

export default function RecetaPrint({ ctx, prescriptions }: Props) {
  const signedDate = ctx.signed_at ? new Date(ctx.signed_at) : new Date();
  const age = calculateAge(ctx.patient.date_of_birth);

  // Receta corregida: SOLO si alguna adenda tocó medicamentos/recetas
  // (affects_prescriptions, s7_30). Una corrección solo de texto de la consulta
  // NO marca la receta. La fecha es la de la corrección de receta más reciente.
  const isCorrected = ctx.receta_corrected_at !== null;
  const correctedDate = ctx.receta_corrected_at ? new Date(ctx.receta_corrected_at) : null;

  return (
    <div className="hidden print:block print-receta">
      {/* Franja superior de marca (teal médico) */}
      <div className="h-2 bg-teal-600 rounded-t-lg" />

      {/* Tarjeta */}
      <div className="border border-gray-200 border-t-0 rounded-b-lg px-8 py-6">
        {/* Encabezado — médico (izq.) + fecha (der.), una sola vez */}
        <header className="flex justify-between items-start gap-6 pb-4 border-b border-gray-200">
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-wide text-teal-700 font-semibold mb-1">
              Receta médica
            </p>
            <h1 className="text-xl font-bold text-gray-900">{doctorTitleName(ctx.doctor.full_name)}</h1>
            {ctx.doctor.specialty_name && (
              <p className="text-sm text-gray-600 mt-0.5">{ctx.doctor.specialty_name}</p>
            )}
            {ctx.doctor.license_number && (
              <p className="text-xs text-gray-500 mt-1">JVPM: {ctx.doctor.license_number}</p>
            )}
          </div>
          <div className="text-right text-xs text-gray-500">
            <p className="uppercase tracking-wide">Fecha de emisión</p>
            <p className="font-semibold text-gray-900 text-sm mt-0.5">{formatLongDate(signedDate)}</p>
            {isCorrected && correctedDate && (
              <>
                <p className="mt-1.5 uppercase tracking-wide">Corregida</p>
                <p className="font-semibold text-gray-900 text-sm mt-0.5">{formatLongDate(correctedDate)}</p>
              </>
            )}
          </div>
        </header>

        {/* Marca de corrección — nota sobria. El encabezado ya da el hecho y la
            fecha, así que acá basta con dejar constancia de que esta hoja
            reemplaza a las anteriores. Sin color: debe leerse igual impresa en
            escala de grises. */}
        {isCorrected && (
          <div className="mt-4 border border-gray-300 rounded-md px-3 py-2">
            <p className="text-xs font-semibold text-gray-900">Receta corregida</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Reemplaza versiones anteriores.</p>
          </div>
        )}

        {/* Datos del paciente — bloque gris claro */}
        <section className="mt-5 bg-gray-50 border border-gray-200 rounded-md px-4 py-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[11px] text-gray-500 uppercase tracking-wide">Paciente</p>
            <p className="text-base font-semibold text-gray-900 mt-0.5">{ctx.patient.full_name}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-500 uppercase tracking-wide">Edad / Sexo</p>
            <p className="text-sm text-gray-900 mt-0.5">
              {age !== null ? `${age} años` : '—'} · <span className="capitalize">{ctx.patient.gender}</span>
            </p>
          </div>
        </section>

        {/* Prescripción — tabla */}
        <section className="mt-6">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">
            Prescripción médica
          </h2>
          {prescriptions.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              No se prescribieron medicamentos en esta consulta.
            </p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-600">
                  <th className="py-2 px-3 border border-gray-200 font-semibold">Medicamento</th>
                  <th className="py-2 px-3 border border-gray-200 font-semibold whitespace-nowrap">Dosis</th>
                  <th className="py-2 px-3 border border-gray-200 font-semibold whitespace-nowrap">Frecuencia</th>
                  <th className="py-2 px-3 border border-gray-200 font-semibold whitespace-nowrap">Duración</th>
                </tr>
              </thead>
              <tbody>
                {prescriptions.map((p, i) => (
                  <PrescriptionRows key={p.id} index={i + 1} p={p} />
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Sub-componente ───────────────────────────────────────────────────
// Una fila principal (Medicamento | Dosis | Frecuencia | Duración) + una fila
// secundaria de ancho completo para Indicaciones/Alternativas (texto largo →
// no rompe el A4 como columna rígida).
function PrescriptionRows({ index, p }: { index: number; p: Prescription }) {
  const subParts = [p.medication.active_ingredient, p.medication.concentration, p.medication.presentation].filter(Boolean);
  const durationLine = formatDuration(p.duration_value, p.duration_unit);
  const hasSecondary = !!(p.instructions || p.alternatives);

  return (
    <>
      <tr className="align-top break-inside-avoid">
        <td className={`py-2 px-3 border border-gray-200 ${hasSecondary ? 'border-b-0' : ''}`}>
          <p className="font-semibold text-gray-900">
            <span className="tabular-nums text-gray-500 mr-1">{index}.</span>
            {p.medication.commercial_name}
            {p.version > 1 && (
              <span className="ml-2 text-[11px] font-medium text-gray-500">· Corrección v{p.version}</span>
            )}
          </p>
          {subParts.length > 0 && (
            <p className="text-xs text-gray-600 mt-0.5">{subParts.join(' · ')}</p>
          )}
        </td>
        <td className={`py-2 px-3 border border-gray-200 text-gray-800 ${hasSecondary ? 'border-b-0' : ''}`}>
          {p.dosage || '—'}
        </td>
        <td className={`py-2 px-3 border border-gray-200 text-gray-800 ${hasSecondary ? 'border-b-0' : ''}`}>
          {p.frequency || '—'}
        </td>
        <td className={`py-2 px-3 border border-gray-200 text-gray-800 whitespace-nowrap ${hasSecondary ? 'border-b-0' : ''}`}>
          {durationLine || '—'}
        </td>
      </tr>
      {hasSecondary && (
        <tr className="break-inside-avoid">
          <td colSpan={4} className="py-2 px-3 border border-gray-200 border-t-0 text-xs text-gray-700">
            {p.instructions && (
              <p>
                <span className="font-semibold text-gray-800">Indicaciones:</span> {p.instructions}
              </p>
            )}
            {p.alternatives && (
              <p className={p.instructions ? 'mt-1' : ''}>
                <span className="font-semibold text-gray-800">Alternativas:</span> {p.alternatives}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Antepone "Dr." al nombre del médico SOLO si no trae ya un título.
 * Evita "Dr. Dr. X" / "Dr. Dra. Y" cuando el `full_name` ya incluye el
 * prefijo (caso real de algunos médicos importados/creados por afiliación).
 * No infiere género: si ya hay título lo respeta tal cual; si no, usa "Dr.".
 */
function doctorTitleName(fullName: string): string {
  const name = (fullName ?? '').trim();
  if (!name) return 'Dr.';
  // Ya trae título: "Dr", "Dr.", "Dra", "Dra." seguido de espacio.
  if (/^dra?\.?\s/i.test(name)) return name;
  return `Dr. ${name}`;
}

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString('es-SV', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDuration(value: number | null, unit: DurationUnit | null): string {
  if (unit === 'permanente') return 'Permanente';
  if (!value || !unit) return '';
  return `${value} ${unit}`;
}
