import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { submitReview, type ReviewCriteria } from '@/services/reviews.service';

// Texto que ve el paciente por cada criterio (orden de presentación)
const CRITERIA: Array<{ key: keyof ReviewCriteria; label: string }> = [
  { key: 'punctuality', label: 'Puntualidad de la atención' },
  { key: 'treatment', label: 'Trato del médico' },
  { key: 'clarity', label: 'Claridad de la explicación' },
  { key: 'listening', label: 'Escucha y respuesta a tus dudas' },
  { key: 'confidence', label: 'Confianza que te generó la atención' },
  { key: 'satisfaction', label: 'Satisfacción general con la consulta' },
];

type Scores = Partial<Record<keyof ReviewCriteria, number>>;

export default function CalificarPage() {
  const { token } = useParams<{ token: string }>();

  const [scores, setScores] = useState<Scores>({});
  const [nps, setNps] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'form' | 'submitting' | 'done' | 'error'>('form');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const allRated = CRITERIA.every((c) => scores[c.key] != null);

  const handleSubmit = async () => {
    if (!token || !allRated) return;
    setState('submitting');
    setErrorMsg(null);
    try {
      await submitReview(token, {
        punctuality: scores.punctuality!,
        treatment: scores.treatment!,
        clarity: scores.clarity!,
        listening: scores.listening!,
        confidence: scores.confidence!,
        satisfaction: scores.satisfaction!,
        nps,
        comment: comment.trim() || null,
      });
      setState('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo enviar la calificación.');
      setState('error');
    }
  };

  // ─── Pantallas de resultado ────────────────────────────────
  if (state === 'done') {
    return (
      <Shell>
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">¡Gracias por tu opinión!</h1>
          <p className="text-sm text-gray-600 mt-2">
            Tu calificación ayuda a otros pacientes a elegir mejor.
          </p>
        </div>
      </Shell>
    );
  }

  if (state === 'error') {
    return (
      <Shell>
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">No pudimos registrar tu calificación</h1>
          <p className="text-sm text-gray-600 mt-2">{errorMsg}</p>
          <p className="text-xs text-gray-400 mt-4">
            Si creés que es un error, contactá a la clínica.
          </p>
        </div>
      </Shell>
    );
  }

  // ─── Formulario ────────────────────────────────────────────
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">¿Cómo fue tu atención?</h1>
        <p className="text-sm text-gray-600 mt-1">
          Tu opinión es anónima para el médico y toma menos de un minuto.
        </p>
      </div>

      <div className="space-y-5">
        {CRITERIA.map((c) => (
          <div key={c.key}>
            <p className="text-sm font-medium text-gray-800 mb-1.5">{c.label}</p>
            <StarRating
              value={scores[c.key] ?? 0}
              onChange={(v) => setScores((s) => ({ ...s, [c.key]: v }))}
            />
          </div>
        ))}

        <div className="pt-2 border-t border-gray-100">
          <p className="text-sm font-medium text-gray-800 mb-2">
            ¿Recomendarías este médico a un familiar o amigo?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNps(n)}
                className={`w-9 h-9 rounded-lg text-sm font-medium border transition-colors ${
                  nps === n
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-gray-400 mt-1">
            <span>Nada probable</span>
            <span>Muy probable</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-800 mb-1.5">
            Comentario <span className="font-normal text-gray-400">(opcional)</span>
          </label>
          <textarea
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Cuéntanos qué fue lo mejor o qué podríamos mejorar"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none resize-y"
          />
        </div>

        <button
          type="button"
          disabled={!allRated || state === 'submitting'}
          onClick={handleSubmit}
          className="w-full px-4 py-3 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {state === 'submitting' ? 'Enviando…' : 'Enviar calificación'}
        </button>
        {!allRated && (
          <p className="text-xs text-gray-400 text-center">
            Calificá los 6 criterios para poder enviar.
          </p>
        )}
      </div>
    </Shell>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-8">
      <img
        src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
        alt="Lucy Care"
        className="h-14 mb-6"
      />
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        {children}
      </div>
      <p className="text-[11px] text-gray-400 mt-6">Lucy Care · Encuesta de satisfacción</p>
    </div>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = (hover || value) >= n;
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className="p-0.5"
          >
            <svg
              className={`w-7 h-7 transition-colors ${active ? 'text-amber-400' : 'text-gray-300'}`}
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.05 10.79c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
