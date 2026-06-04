import type { ConsultationContext } from '@/services/consultations.service';
import type { Prescription, DurationUnit } from '@/services/prescriptions.service';

/**
 * Layout de receta para impresión (window.print()).
 * Por default está oculto en pantalla y solo aparece al imprimir.
 *
 * Uso:
 *   <RecetaPrint ctx={ctx} prescriptions={prescriptions} />
 *   <Button onClick={() => window.print()}>Imprimir</Button>
 *
 * El parent debe asegurar que TODO lo demás esté con `print:hidden` para que
 * solo aparezca este componente al imprimir.
 */
interface Props {
  ctx: ConsultationContext;
  prescriptions: Prescription[];
}

export default function RecetaPrint({ ctx, prescriptions }: Props) {
  const signedDate = ctx.signed_at ? new Date(ctx.signed_at) : new Date();
  const age = calculateAge(ctx.patient.date_of_birth);

  // Receta corregida: la consulta tiene ≥1 adenda (cubre receta versionada,
  // medicamento agregado/quitado o corrección de texto). La fecha es la de la
  // corrección más reciente. La receta original (v1) se imprime sin esta marca.
  const isCorrected = ctx.amendment_count > 0;
  const correctedDate = ctx.last_corrected_at ? new Date(ctx.last_corrected_at) : null;

  return (
    <div className="hidden print:block print-receta">
      {/* Header — datos del médico */}
      <header className="border-b-2 border-gray-800 pb-4 mb-6">
        <div className="flex justify-between items-start gap-6">
          <div className="flex-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Receta médica</p>
            <h1 className="text-2xl font-bold text-gray-900">Dr. {ctx.doctor.full_name}</h1>
            {ctx.doctor.specialty_name && (
              <p className="text-sm text-gray-700 mt-0.5">{ctx.doctor.specialty_name}</p>
            )}
            {ctx.doctor.license_number && (
              <p className="text-xs text-gray-600 mt-1">JVPM: {ctx.doctor.license_number}</p>
            )}
          </div>
          <div className="text-right text-xs text-gray-600">
            <p>Fecha de emisión</p>
            <p className="font-semibold text-gray-900 text-sm mt-0.5">
              {formatLongDate(signedDate)}
            </p>
          </div>
        </div>
      </header>

      {/* Aviso de corrección — solo si la consulta fue corregida tras la firma */}
      {isCorrected && (
        <div className="border-2 border-gray-800 rounded-md px-4 py-2 mb-6">
          <p className="text-sm font-bold text-gray-900 uppercase tracking-wide">
            Receta corregida
            {correctedDate && (
              <span className="font-semibold"> · {formatLongDate(correctedDate)}</span>
            )}
          </p>
          <p className="text-xs text-gray-700 mt-0.5">
            Esta receta reemplaza versiones anteriores.
          </p>
        </div>
      )}

      {/* Datos del paciente */}
      <section className="mb-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Paciente</p>
          <p className="text-base font-semibold text-gray-900 mt-0.5">{ctx.patient.full_name}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Edad / Sexo</p>
          <p className="text-sm text-gray-900 mt-0.5">
            {age !== null ? `${age} años` : '—'} · <span className="capitalize">{ctx.patient.gender}</span>
          </p>
        </div>
      </section>

      {/* Lista de medicamentos */}
      <section className="mb-8">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3 border-b border-gray-300 pb-1">
          Prescripción
        </h2>
        {prescriptions.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No se prescribieron medicamentos en esta consulta.
          </p>
        ) : (
          <ol className="space-y-4">
            {prescriptions.map((p, i) => (
              <PrescriptionItem key={p.id} index={i + 1} p={p} />
            ))}
          </ol>
        )}
      </section>

      {/* Footer — firma */}
      <footer className="mt-12 pt-4 border-t border-gray-300">
        <div className="flex justify-end">
          <div className="text-right">
            <div className="border-b border-gray-800 w-64 mb-1" />
            <p className="text-sm font-semibold text-gray-900">Dr. {ctx.doctor.full_name}</p>
            {ctx.doctor.license_number && (
              <p className="text-xs text-gray-600">JVPM: {ctx.doctor.license_number}</p>
            )}
            <p className="text-[11px] text-gray-500 mt-2">
              Firmado digitalmente · {formatLongDate(signedDate)}
            </p>
            {isCorrected && correctedDate && (
              <p className="text-[11px] text-gray-500">
                Corregida · {formatLongDate(correctedDate)}
              </p>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-componente ───────────────────────────────────────────────────

function PrescriptionItem({ index, p }: { index: number; p: Prescription }) {
  const subParts = [p.medication.active_ingredient, p.medication.concentration, p.medication.presentation].filter(Boolean);

  const dosageParts = [];
  if (p.dosage) dosageParts.push(p.dosage);
  if (p.frequency) dosageParts.push(p.frequency);
  const dosageLine = dosageParts.join(' · ');

  const durationLine = formatDuration(p.duration_value, p.duration_unit);

  return (
    <li className="text-sm text-gray-800">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-gray-900">{index}.</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900">
            {p.medication.commercial_name}
            {p.version > 1 && (
              <span className="ml-2 text-xs font-bold text-gray-700 uppercase">
                · Corrección v{p.version}
              </span>
            )}
          </p>
          {subParts.length > 0 && (
            <p className="text-xs text-gray-600 mt-0.5">{subParts.join(' · ')}</p>
          )}
          {dosageLine && (
            <p className="mt-1.5">{dosageLine}</p>
          )}
          {durationLine && (
            <p className="text-gray-700">Duración: {durationLine}</p>
          )}
          {p.instructions && (
            <p className="mt-1 italic text-gray-700">{p.instructions}</p>
          )}
          {p.alternatives && (
            <p className="mt-1 text-xs text-gray-600">
              <span className="font-medium">Alternativas:</span> {p.alternatives}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

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
