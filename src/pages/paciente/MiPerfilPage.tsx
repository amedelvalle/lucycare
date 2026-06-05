/**
 * /paciente/perfil — Paciente Global F2.2.
 *
 * El paciente ve y edita su identidad global (profiles, s7_32): nombre, tipo y
 * número de documento (DUI), fecha de nacimiento, género, departamento,
 * municipio. Teléfono read-only. DUI progresivo: todo opcional, nada bloquea.
 * Sugerencias de prefill desde fichas locales (botón "Usar" por campo); nunca
 * se copian solas; conflicto entre clínicas → se muestran las opciones.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PatientHeader from '@/components/PatientHeader';
import { useMyProfile, useLocalSuggestions, useUpdateMyProfile } from '@/hooks/usePatientProfile';
import { useDepartments, useMunicipalities } from '@/hooks/useDirectory';
import { sanitizeDuiInput, formatDuiDisplay, validateDocument, type DocumentType } from '@/lib/document';
import { DuplicateDocumentError, type Gender } from '@/services/patientProfile.service';

const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'dui', label: 'DUI' },
  { value: 'pasaporte', label: 'Pasaporte' },
  { value: 'carnet_residente', label: 'Carnet de residente' },
  { value: 'partida_nacimiento', label: 'Partida de nacimiento' },
];
const GENDERS: { value: Gender; label: string }[] = [
  { value: 'masculino', label: 'Masculino' },
  { value: 'femenino', label: 'Femenino' },
  { value: 'otro', label: 'Otro' },
];

interface FormState {
  full_name: string;
  document_type: DocumentType | '';
  document_number: string;
  date_of_birth: string;
  gender: Gender | '';
  department_id: string;
  municipality_id: string;
}

const EMPTY: FormState = {
  full_name: '', document_type: '', document_number: '', date_of_birth: '',
  gender: '', department_id: '', municipality_id: '',
};

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none ' +
  'disabled:bg-gray-50 disabled:text-gray-500';

export default function MiPerfilPage() {
  const navigate = useNavigate();
  const { data: profile, isLoading } = useMyProfile();
  const { data: suggestions = [] } = useLocalSuggestions();
  const update = useUpdateMyProfile();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const departmentsQ = useDepartments();
  const municipalitiesQ = useMunicipalities(form.department_id || null);

  // Hidratar al cargar el perfil
  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name ?? '',
        document_type: (profile.document_type as DocumentType) ?? '',
        document_number: profile.document_number ?? '',
        date_of_birth: profile.date_of_birth ?? '',
        gender: (profile.gender as Gender) ?? '',
        department_id: profile.department_id ?? '',
        municipality_id: profile.municipality_id ?? '',
      });
    }
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSavedAt(null);
  };

  // ─── Sugerencias por campo (valores distintos desde fichas locales) ───
  const sugg = useMemo(() => {
    const names = new Map<string, Set<string>>();
    const docs = new Map<string, { type: DocumentType; number: string; clinics: Set<string> }>();
    const dobs = new Map<string, Set<string>>();
    const genders = new Map<string, Set<string>>();
    for (const s of suggestions) {
      if (s.full_name?.trim()) { const k = s.full_name.trim(); (names.get(k) ?? names.set(k, new Set()).get(k)!).add(s.clinicName); }
      if (s.document_number && s.document_type) { const k = s.document_type + '|' + s.document_number; const e = docs.get(k) ?? { type: s.document_type, number: s.document_number, clinics: new Set() }; e.clinics.add(s.clinicName); docs.set(k, e); }
      if (s.date_of_birth) { const k = s.date_of_birth; (dobs.get(k) ?? dobs.set(k, new Set()).get(k)!).add(s.clinicName); }
      if (s.gender) { const k = s.gender; (genders.get(k) ?? genders.set(k, new Set()).get(k)!).add(s.clinicName); }
    }
    return { names, docs, dobs, genders };
  }, [suggestions]);

  const docError = useMemo(() => {
    if (form.document_type !== 'dui' || !form.document_number.trim()) return null;
    const v = validateDocument('dui', form.document_number);
    return v.valid ? null : v.error ?? 'Documento inválido';
  }, [form.document_type, form.document_number]);

  const onDocNumberChange = (raw: string) => {
    if (form.document_type === 'dui') set('document_number', formatDuiDisplay(sanitizeDuiInput(raw)));
    else set('document_number', raw);
  };

  const handleSave = async () => {
    setErrorMsg(null);
    if (docError) { setErrorMsg(docError); return; }
    try {
      await update.mutateAsync({
        full_name: form.full_name.trim(),
        document_type: form.document_type || null,
        document_number: form.document_number.trim() || null,
        date_of_birth: form.date_of_birth || null,
        gender: form.gender || null,
        department_id: form.department_id || null,
        municipality_id: form.municipality_id || null,
      });
      setSavedAt(Date.now());
    } catch (err) {
      if (err instanceof DuplicateDocumentError) setErrorMsg(err.message);
      else setErrorMsg(err instanceof Error ? err.message : 'No se pudo guardar.');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50"><PatientHeader />
        <main className="max-w-2xl mx-auto px-4 py-6"><div className="bg-white border rounded-2xl p-5 animate-pulse h-96" /></main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PatientHeader />
      <main className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <button onClick={() => navigate(-1)} className="mb-3 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <i className="ri-arrow-left-line" /> Volver
        </button>

        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">Mi perfil</h1>
          <p className="text-sm text-gray-600 mt-1">Tus datos personales en LucyCare.</p>
        </div>

        {suggestions.length > 0 && (
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
            Algunos datos los cargó una clínica. Revisalos y confirmá que son tuyos antes de guardar.
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          {/* Nombre */}
          <Field label="Nombre completo">
            <input type="text" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} className={inputCls} placeholder="Tu nombre" />
            <Suggestions show={!form.full_name.trim()} entries={[...sugg.names].map(([v, c]) => ({ value: v, clinics: c }))} onUse={(v) => set('full_name', v)} />
          </Field>

          {/* Documento */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Tipo de documento" className="sm:col-span-1">
              <select value={form.document_type} onChange={(e) => set('document_type', e.target.value as DocumentType | '')} className={inputCls}>
                <option value="">—</option>
                {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Número de documento" className="sm:col-span-2">
              <input
                type="text" inputMode={form.document_type === 'dui' ? 'numeric' : 'text'}
                value={form.document_number} onChange={(e) => onDocNumberChange(e.target.value)}
                className={inputCls} placeholder={form.document_type === 'dui' ? '00000000-0' : 'Número'}
                disabled={!form.document_type}
              />
              {docError && <p className="text-xs text-red-600 mt-1">{docError}</p>}
              <p className="text-[11px] text-gray-500 mt-1">
                El DUI es opcional para reservar. Nos ayuda a evitar duplicados y a vincular correctamente tus atenciones.
              </p>
              <Suggestions
                show={!form.document_number.trim()}
                entries={[...sugg.docs.values()].map((d) => ({ value: d.number, label: `${DOC_TYPES.find((t) => t.value === d.type)?.label ?? d.type}: ${d.number}`, clinics: d.clinics, apply: () => { set('document_type', d.type); set('document_number', d.number); } }))}
                onUse={() => {}}
              />
            </Field>
          </div>

          {/* DOB + Género */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Fecha de nacimiento">
              <input type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} className={inputCls} />
              <Suggestions show={!form.date_of_birth} entries={[...sugg.dobs].map(([v, c]) => ({ value: v, clinics: c }))} onUse={(v) => set('date_of_birth', v)} />
            </Field>
            <Field label="Género">
              <select value={form.gender} onChange={(e) => set('gender', e.target.value as Gender | '')} className={inputCls}>
                <option value="">—</option>
                {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
              <Suggestions show={!form.gender} entries={[...sugg.genders].map(([v, c]) => ({ value: v, label: GENDERS.find((g) => g.value === v)?.label ?? v, clinics: c }))} onUse={(v) => set('gender', v as Gender)} />
            </Field>
          </div>

          {/* Depto + Muni */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Departamento">
              <select value={form.department_id} onChange={(e) => { set('department_id', e.target.value); set('municipality_id', ''); }} className={inputCls}>
                <option value="">—</option>
                {(departmentsQ.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Municipio">
              <select value={form.municipality_id} onChange={(e) => set('municipality_id', e.target.value)} disabled={!form.department_id} className={inputCls}>
                <option value="">{form.department_id ? '—' : 'Elegí departamento primero'}</option>
                {(municipalitiesQ.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
          </div>

          {/* Teléfono read-only */}
          <Field label="Teléfono">
            <input type="text" value={profile?.phone ?? ''} disabled className={inputCls} />
            <p className="text-[11px] text-gray-500 mt-1">
              Tu teléfono se usa para acceder a tu cuenta. Para cambiarlo se requerirá verificación por código.
            </p>
          </Field>

          {errorMsg && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <i className="ri-error-warning-line text-red-500 mt-0.5" />
              <p className="text-xs text-red-700">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Barra de acción (sticky en móvil) */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 z-30 sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:mt-4">
          <div className="max-w-2xl mx-auto flex items-center justify-end gap-3">
            {savedAt && <span className="text-xs text-emerald-700 flex items-center gap-1"><i className="ri-check-line" /> Guardado</span>}
            <button
              type="button" onClick={handleSave} disabled={update.isPending || !!docError}
              className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
            >
              {update.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

interface SuggEntry { value: string; label?: string; clinics: Set<string>; apply?: () => void }
function Suggestions({ show, entries, onUse }: { show: boolean; entries: SuggEntry[]; onUse: (value: string) => void }) {
  if (!show || entries.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {entries.map((e, i) => (
        <button
          key={i} type="button"
          onClick={() => (e.apply ? e.apply() : onUse(e.value))}
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 hover:bg-emerald-50 border border-gray-200 px-2.5 py-1 text-[11px] text-gray-700"
          title={`Sugerido por ${[...e.clinics].join(', ')}`}
        >
          <span className="font-medium">{e.label ?? e.value}</span>
          <span className="text-gray-400">· {[...e.clinics][0]}{e.clinics.size > 1 ? ` +${e.clinics.size - 1}` : ''}</span>
          <span className="text-emerald-700 font-semibold">Usar</span>
        </button>
      ))}
    </div>
  );
}
