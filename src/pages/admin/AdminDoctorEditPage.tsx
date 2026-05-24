import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getDoctorAdminDetail,
  getSpecialtiesForAdmin,
  updateDoctorProfile,
  updateDoctorClinic,
  updateDoctorInfo,
} from '../../services/admin.service';
import AdminDoctorServicesSection from './components/AdminDoctorServicesSection';
import AvatarUploader from '@/components/AvatarUploader';
import { uploadDoctorAvatarAsAdmin, removeDoctorAvatarAsAdmin } from '@/services/avatar.service';

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none ' +
  'disabled:bg-gray-50 disabled:text-gray-500';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {hint && <span className="text-gray-400 font-normal ml-1.5">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function SaveStatus({ savedAt, error, pending }: { savedAt: number | null; error: string | null; pending: boolean }) {
  if (pending) return <span className="text-xs text-gray-500">Guardando…</span>;
  if (error) return <span className="text-xs text-red-700">{error}</span>;
  if (savedAt && Date.now() - savedAt < 4000) return <span className="text-xs text-emerald-700">Guardado ✓</span>;
  return null;
}

export default function AdminDoctorEditPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ['admin-doctor-detail', id],
    queryFn: () => getDoctorAdminDetail(id!),
    enabled: !!id,
  });
  const specQ = useQuery({
    queryKey: ['admin-specialties'],
    queryFn: getSpecialtiesForAdmin,
  });

  // ─── Estado por sección ──────────────────────────────────
  const [perfil, setPerfil] = useState({ full_name: '', email: '', phone: '' });
  const [clinica, setClinica] = useState({ name: '', address: '', phone: '' });
  const [info, setInfo] = useState({ specialty_id: '', bio: '' });
  const [savedPerfil, setSavedPerfil] = useState<number | null>(null);
  const [savedClinica, setSavedClinica] = useState<number | null>(null);
  const [savedInfo, setSavedInfo] = useState<number | null>(null);

  useEffect(() => {
    if (!detailQ.data) return;
    setPerfil({
      full_name: detailQ.data.fullName ?? '',
      email: detailQ.data.email ?? '',
      phone: detailQ.data.phone ?? '',
    });
    setClinica({
      name: detailQ.data.clinicName ?? '',
      address: detailQ.data.clinicAddress ?? '',
      phone: detailQ.data.clinicPhone ?? '',
    });
    setInfo({
      specialty_id: detailQ.data.specialtyId ?? '',
      bio: detailQ.data.bio ?? '',
    });
  }, [detailQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-doctor-detail', id] });
    qc.invalidateQueries({ queryKey: ['admin-doctors'] });
  };

  const mPerfil = useMutation({
    mutationFn: () =>
      updateDoctorProfile(
        id!,
        perfil.full_name,
        perfil.email.trim() || null,
        perfil.phone.trim() || null,
      ),
    onSuccess: () => { setSavedPerfil(Date.now()); invalidate(); },
  });
  const mClinica = useMutation({
    mutationFn: () =>
      updateDoctorClinic(
        id!,
        clinica.name,
        clinica.address.trim() || null,
        clinica.phone.trim() || null,
      ),
    onSuccess: () => { setSavedClinica(Date.now()); invalidate(); },
  });
  const mInfo = useMutation({
    mutationFn: () =>
      updateDoctorInfo(
        id!,
        info.specialty_id || null,
        info.bio.trim() || null,
      ),
    onSuccess: () => { setSavedInfo(Date.now()); invalidate(); },
  });

  const errMsg = (m: { error: unknown }) =>
    m.error instanceof Error ? m.error.message : m.error ? String(m.error) : null;

  if (detailQ.isLoading) {
    return <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />;
  }
  if (detailQ.error || !detailQ.data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
        No se pudo cargar el médico: {detailQ.error instanceof Error ? detailQ.error.message : 'sin detalle'}
      </div>
    );
  }

  const d = detailQ.data;

  return (
    <div className="max-w-3xl">
      <Link to="/admin/medicos" className="text-sm text-emerald-700 hover:underline">← Volver al listado</Link>

      <header className="my-4">
        <h1 className="text-2xl font-bold text-gray-900">{d.fullName || '(sin nombre)'}</h1>
        <p className="text-sm text-gray-500 mt-1">
          ID {d.doctorId.slice(0, 8)}… · Estado:{' '}
          {d.isOperational ? 'Operativo' : 'Suspendido'} · {d.isPublished ? 'Publicado' : 'No publicado'} · lucy={d.lucyStatus}
        </p>
      </header>

      {/* ─── Foto de perfil ──────────────────────────────── */}
      <Section
        title="Foto de perfil"
        subtitle="Aparece en el directorio público y en el panel del médico. Tipos: JPG, PNG, WEBP · máx 5 MB."
      >
        <AvatarUploader
          name={d.fullName || ''}
          currentUrl={d.avatarUrl}
          onUpload={(file) => uploadDoctorAvatarAsAdmin(d.doctorId, d.profileId, file)}
          onRemove={() => removeDoctorAvatarAsAdmin(d.doctorId, d.profileId)}
          onSuccess={invalidate}
        />
      </Section>

      {/* ─── Perfil ─────────────────────────────────────── */}
      <Section
        title="Perfil"
        subtitle="Nombre visible y datos de contacto. ⚠ Email y teléfono son también credenciales de login del médico — al cambiarlos se actualiza el acceso."
      >
        <Field label="Nombre completo" hint="obligatorio">
          <input
            className={inputCls}
            value={perfil.full_name}
            onChange={(e) => setPerfil({ ...perfil, full_name: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Email" hint="login + contacto">
            <input
              type="email"
              className={inputCls}
              value={perfil.email}
              onChange={(e) => setPerfil({ ...perfil, email: e.target.value })}
            />
          </Field>
          <Field label="Teléfono" hint="login + contacto">
            <input
              className={inputCls}
              value={perfil.phone}
              onChange={(e) => setPerfil({ ...perfil, phone: e.target.value })}
              placeholder="50378XXXXXXX"
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-3 mt-2">
          <SaveStatus savedAt={savedPerfil} error={errMsg(mPerfil)} pending={mPerfil.isPending} />
          <button
            onClick={() => mPerfil.mutate()}
            disabled={mPerfil.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
          >
            Guardar perfil
          </button>
        </div>
      </Section>

      {/* ─── Clínica ────────────────────────────────────── */}
      <Section title="Clínica / consultorio" subtitle="Datos de la clínica donde atiende este médico.">
        <Field label="Nombre de la clínica" hint="obligatorio">
          <input
            className={inputCls}
            value={clinica.name}
            onChange={(e) => setClinica({ ...clinica, name: e.target.value })}
          />
        </Field>
        <Field label="Dirección">
          <input
            className={inputCls}
            value={clinica.address}
            onChange={(e) => setClinica({ ...clinica, address: e.target.value })}
          />
        </Field>
        <Field label="Teléfono de la clínica" hint="solo display; no es login">
          <input
            className={inputCls}
            value={clinica.phone}
            onChange={(e) => setClinica({ ...clinica, phone: e.target.value })}
            placeholder="50322XXXXXXX"
          />
        </Field>
        <div className="flex items-center justify-end gap-3 mt-2">
          <SaveStatus savedAt={savedClinica} error={errMsg(mClinica)} pending={mClinica.isPending} />
          <button
            onClick={() => mClinica.mutate()}
            disabled={mClinica.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
          >
            Guardar clínica
          </button>
        </div>
      </Section>

      {/* ─── Profesional ────────────────────────────────── */}
      <Section title="Información profesional" subtitle="Especialidad y biografía pública.">
        <Field label="Especialidad">
          <select
            className={inputCls}
            value={info.specialty_id}
            onChange={(e) => setInfo({ ...info, specialty_id: e.target.value })}
          >
            <option value="">— Sin especialidad —</option>
            {(specQ.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Bio / descripción">
          <textarea
            rows={4}
            className={inputCls}
            value={info.bio}
            onChange={(e) => setInfo({ ...info, bio: e.target.value })}
            placeholder="Texto visible en el perfil público…"
          />
        </Field>
        <div className="flex items-center justify-end gap-3 mt-2">
          <SaveStatus savedAt={savedInfo} error={errMsg(mInfo)} pending={mInfo.isPending} />
          <button
            onClick={() => mInfo.mutate()}
            disabled={mInfo.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
          >
            Guardar información
          </button>
        </div>
      </Section>

      {/* ─── Servicios (B3-admin) ──────────────────────────── */}
      <AdminDoctorServicesSection doctorId={d.doctorId} />

      <p className="text-[11px] text-gray-400 mt-2">
        Disponibilidad/horarios se editan en una fase posterior (B4).
        Esta pantalla NO toca contenido clínico.
      </p>
    </div>
  );
}
