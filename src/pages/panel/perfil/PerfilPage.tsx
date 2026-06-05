import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  myDoctorProfileKey,
  useMyDoctorProfile,
  useUpdateDoctorPublic,
  useUpdateProfileBasic,
  useSetDoctorPublished,
  useSetBookingEnabled,
} from '@/hooks/useDoctorProfile';
import { useSpecialties } from '@/hooks/useDirectory';
import { useClinicContext } from '@/hooks/useClinicContext';
import AvatarUploader from '@/components/AvatarUploader';
import ChangePhoneModal from '@/components/ChangePhoneModal';
import { uploadMyAvatar, removeMyAvatar } from '@/services/avatar.service';

export default function PerfilPage() {
  const qc = useQueryClient();
  const [showChangePhone, setShowChangePhone] = useState(false);
  const { data: ctx, isLoading: ctxLoading } = useClinicContext();
  const { data: profile, isLoading } = useMyDoctorProfile();
  const { data: specialties = [] } = useSpecialties();

  // Asistentes no pueden ver/editar el perfil público — es del doctor.
  if (!ctxLoading && ctx?.role === 'assistant') {
    return <Navigate to="/panel" replace />;
  }

  const updateDoctor = useUpdateDoctorPublic(profile?.doctor_id ?? '');
  const updateProfile = useUpdateProfileBasic(profile?.profile_id ?? '');
  const setPublished = useSetDoctorPublished(profile?.doctor_id ?? '');
  const setBooking = useSetBookingEnabled(profile?.doctor_id ?? '');

  // Estado del formulario (controlado, se inicializa cuando llega el profile)
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    bio: '',
    specialty_id: '',
    experience_years: 0,
    consultation_fee: 0,
    languagesText: '', // Comma-separated en UI
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name,
        email: profile.email ?? '',
        bio: profile.bio ?? '',
        specialty_id: profile.specialty_id ?? '',
        experience_years: profile.experience_years ?? 0,
        consultation_fee: profile.consultation_fee ?? 0,
        languagesText: (profile.languages ?? []).join(', '),
      });
    }
  }, [profile]);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-100 rounded" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">No se encontró perfil de médico asociado a tu cuenta.</p>
        </div>
      </div>
    );
  }

  const isSaving =
    updateDoctor.isPending || updateProfile.isPending || setPublished.isPending || setBooking.isPending;

  const handleSaveAll = async () => {
    const languages = form.languagesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await Promise.all([
        updateProfile.mutateAsync({
          full_name: form.full_name,
          email: form.email || null,
        }),
        updateDoctor.mutateAsync({
          bio: form.bio || null,
          specialty_id: form.specialty_id || null,
          experience_years: form.experience_years || null,
          consultation_fee: form.consultation_fee || null,
          languages: languages.length > 0 ? languages : null,
        }),
      ]);
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Error guardando perfil:', err);
    }
  };

  const handleTogglePublished = () => {
    setPublished.mutate(!profile.is_published);
  };

  const handleToggleBooking = () => {
    setBooking.mutate(!profile.booking_enabled);
  };

  const publicUrl = `/doctor/${profile.doctor_id}`;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mi perfil público</h1>
          <p className="text-sm text-gray-500 mt-1">
            Información que ven los pacientes en el directorio Lucy.
          </p>
        </div>
        {profile.is_published && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
            Ver perfil público
          </a>
        )}
      </div>

      {/* Foto de perfil */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Foto de perfil</h2>
          <p className="text-xs text-gray-500 mt-1">
            Es lo primero que ven los pacientes. Una foto clara, con buena iluminación y mirando a cámara funciona
            mejor.
          </p>
        </div>
        <AvatarUploader
          name={profile.full_name}
          currentUrl={profile.avatar_url}
          onUpload={uploadMyAvatar}
          onRemove={removeMyAvatar}
          onSuccess={() => qc.invalidateQueries({ queryKey: myDoctorProfileKey })}
        />
      </div>

      {/* Estado de publicación */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Estado de publicación</h2>

        <ToggleRow
          title="Visible en el directorio"
          description="Cuando está activo, tu perfil aparece en las búsquedas de pacientes."
          enabled={profile.is_published}
          onChange={handleTogglePublished}
          disabled={setPublished.isPending}
          activeBadge={
            profile.is_published ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Publicado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                Oculto
              </span>
            )
          }
        />

        <ToggleRow
          title="Reserva online activa"
          description="Permite que los pacientes agenden citas desde tu perfil público."
          enabled={profile.booking_enabled}
          onChange={handleToggleBooking}
          disabled={setBooking.isPending}
          activeBadge={
            profile.booking_enabled ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                Activa
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                Inactiva
              </span>
            )
          }
        />

        {profile.is_verified && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <p className="text-xs text-blue-700 font-medium">Médico verificado por Lucy</p>
          </div>
        )}
      </div>

      {/* Datos básicos */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Datos básicos</h2>

        <Field label="Nombre completo" required>
          <input
            type="text"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            className={inputCls}
            required
          />
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Teléfono" hint="Es tu forma de acceso. Para cambiarlo verificamos el número nuevo con un código por SMS.">
            <div className="flex items-center gap-2">
              <input
                type="tel"
                value={profile.phone ? `+${profile.phone}` : ''}
                disabled
                className={`${inputCls} bg-gray-50 text-gray-500 cursor-not-allowed`}
              />
              <button
                type="button"
                onClick={() => setShowChangePhone(true)}
                className="px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg whitespace-nowrap"
              >
                Cambiar
              </button>
            </div>
          </Field>
        </div>
      </div>

      {/* Información profesional */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Información profesional</h2>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Especialidad">
            <select
              value={form.specialty_id}
              onChange={(e) => setForm({ ...form, specialty_id: e.target.value })}
              className={inputCls}
            >
              <option value="">Selecciona...</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Años de experiencia">
            <input
              type="number"
              min={0}
              max={70}
              value={form.experience_years}
              onChange={(e) =>
                setForm({ ...form, experience_years: parseInt(e.target.value) || 0 })
              }
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Tarifa de consulta (USD)">
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.consultation_fee}
              onChange={(e) =>
                setForm({ ...form, consultation_fee: parseFloat(e.target.value) || 0 })
              }
              className={inputCls}
            />
          </Field>
          <Field label="Licencia (JVPM)" hint="Para cambiarla, contacta soporte">
            <input
              type="text"
              value={profile.license_number ?? ''}
              disabled
              className={`${inputCls} bg-gray-50 text-gray-500 cursor-not-allowed`}
            />
          </Field>
        </div>

        <Field label="Idiomas" hint="Separados por coma — ej: Español, Inglés">
          <input
            type="text"
            value={form.languagesText}
            onChange={(e) => setForm({ ...form, languagesText: e.target.value })}
            className={inputCls}
            placeholder="Español, Inglés"
          />
        </Field>

        <Field label="Biografía" hint="Aparece en tu perfil público">
          <textarea
            rows={5}
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            className={inputCls}
            placeholder="Cuéntale a los pacientes sobre tu experiencia, enfoque y trayectoria..."
          />
          <p className="text-[11px] text-gray-400 mt-1">{form.bio.length} caracteres</p>
        </Field>
      </div>

      {/* Botón guardar */}
      <div className="flex items-center justify-between gap-3 sticky bottom-0 bg-gray-50 -mx-4 px-4 py-3 border-t border-gray-200 lg:static lg:bg-transparent lg:border-0 lg:py-0 lg:px-0 lg:mx-0">
        <div className="text-xs text-gray-500">
          {savedAt && Date.now() - savedAt < 5000 && (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Cambios guardados
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={isSaving || !form.full_name.trim()}
          className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
        >
          {isSaving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>

      {showChangePhone && (
        <ChangePhoneModal
          currentPhone={profile.phone ?? null}
          onClose={() => setShowChangePhone(false)}
          onChanged={() => qc.invalidateQueries({ queryKey: myDoctorProfileKey })}
        />
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="text-gray-400 font-normal ml-1.5">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function ToggleRow({
  title,
  description,
  enabled,
  onChange,
  disabled,
  activeBadge,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onChange: () => void;
  disabled: boolean;
  activeBadge: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900">{title}</p>
          {activeBadge}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        role="switch"
        aria-checked={enabled}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed ${
          enabled ? 'bg-emerald-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
