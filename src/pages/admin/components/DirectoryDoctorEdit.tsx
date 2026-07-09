import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getDirectoryDoctorDetail,
  updateDirectoryDoctorName,
} from '../../../services/directoryEditor.service';
import {
  getSpecialtiesForAdmin,
  updateDoctorClinic,
  updateDoctorInfo,
  setDoctorPublished,
} from '../../../services/admin.service';
import AdminDoctorServicesSection from './AdminDoctorServicesSection';
import { useDepartments, useMunicipalities } from '@/hooks/useDirectory';

/**
 * Ficha de médico para el nivel `directory_editor` (LucyAdmin acotado).
 * SOLO secciones públicas/editables, vía RPCs acotadas / re-gateadas del PR-A:
 *   - nombre visible  → directory_update_doctor_name (solo profiles.full_name)
 *   - clínica/dir/depto-muni/tel. público → admin_update_doctor_clinic
 *   - especialidad/bio → admin_update_doctor_info
 *   - servicios (sin borrar) → admin_*_service (canDelete=false)
 *   - publicar/despublicar → admin_set_doctor_published (solo is_published)
 * OCULTA: login (email/phone), avatar (Storage RLS), verificación/lucy_status/
 * operatividad/booking, lista de espera, borrado.
 */
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

export default function DirectoryDoctorEdit({ doctorId }: { doctorId: string }) {
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ['directory-doctor-detail', doctorId],
    queryFn: () => getDirectoryDoctorDetail(doctorId),
    enabled: !!doctorId,
  });
  const specQ = useQuery({ queryKey: ['admin-specialties'], queryFn: getSpecialtiesForAdmin });

  const [name, setName] = useState('');
  const [clinica, setClinica] = useState({ name: '', address: '', phone: '', departmentId: '', municipalityId: '' });
  const [info, setInfo] = useState({ specialty_id: '', bio: '' });
  const [savedName, setSavedName] = useState<number | null>(null);
  const [savedClinica, setSavedClinica] = useState<number | null>(null);
  const [savedInfo, setSavedInfo] = useState<number | null>(null);

  const departmentsQ = useDepartments();
  const municipalitiesQ = useMunicipalities(clinica.departmentId || null);

  const locationRequired = !!detailQ.data?.isPublished;

  useEffect(() => {
    if (!detailQ.data) return;
    setName(detailQ.data.fullName ?? '');
    setClinica({
      name: detailQ.data.clinicName ?? '',
      address: detailQ.data.clinicAddress ?? '',
      phone: detailQ.data.clinicPhone ?? '',
      departmentId: detailQ.data.clinicDepartmentId ?? '',
      municipalityId: detailQ.data.clinicMunicipalityId ?? '',
    });
    setInfo({ specialty_id: detailQ.data.specialtyId ?? '', bio: detailQ.data.bio ?? '' });
  }, [detailQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['directory-doctor-detail', doctorId] });
    qc.invalidateQueries({ queryKey: ['directory-doctors'] });
  };

  const mName = useMutation({
    mutationFn: () => updateDirectoryDoctorName(doctorId, name),
    onSuccess: () => { setSavedName(Date.now()); invalidate(); },
  });
  const mClinica = useMutation({
    mutationFn: () => {
      if (locationRequired && (!clinica.departmentId || !clinica.municipalityId)) {
        throw new Error('Departamento y Municipio son obligatorios para médicos publicados.');
      }
      return updateDoctorClinic(
        doctorId, clinica.name, clinica.address.trim() || null, clinica.phone.trim() || null,
        clinica.departmentId || null, clinica.municipalityId || null,
      );
    },
    onSuccess: () => { setSavedClinica(Date.now()); invalidate(); },
  });
  const mInfo = useMutation({
    mutationFn: () => updateDoctorInfo(doctorId, info.specialty_id || null, info.bio.trim() || null),
    onSuccess: () => { setSavedInfo(Date.now()); invalidate(); },
  });
  const mPublished = useMutation({
    mutationFn: (v: boolean) => setDoctorPublished(doctorId, v),
    onSuccess: invalidate,
  });

  const errMsg = (m: { error: unknown }) =>
    m.error instanceof Error ? m.error.message : m.error ? String(m.error) : null;

  if (detailQ.isLoading) return <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />;
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

      <header className="my-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{d.fullName || '(sin nombre)'}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {d.isPublished ? 'Publicado en el directorio' : 'No publicado'}
            {d.isVerified ? ' · Verificado por LucyCare' : ''}
          </p>
        </div>
        <button
          onClick={() => mPublished.mutate(!d.isPublished)}
          disabled={mPublished.isPending}
          className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 flex-shrink-0"
        >
          {d.isPublished ? 'Despublicar' : 'Publicar'}
        </button>
      </header>

      {/* ─── Nombre visible ─── */}
      <Section title="Nombre visible" subtitle="Cómo aparece el médico en el directorio público.">
        <Field label="Nombre completo" hint="obligatorio">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex items-center justify-end gap-3 mt-2">
          <SaveStatus savedAt={savedName} error={errMsg(mName)} pending={mName.isPending} />
          <button
            onClick={() => mName.mutate()}
            disabled={mName.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
          >
            Guardar nombre
          </button>
        </div>
      </Section>

      {/* ─── Clínica ─── */}
      <Section title="Clínica / consultorio" subtitle="Datos públicos de la clínica donde atiende este médico.">
        <Field label="Nombre de la clínica" hint="obligatorio">
          <input className={inputCls} value={clinica.name} onChange={(e) => setClinica({ ...clinica, name: e.target.value })} />
        </Field>
        <Field label="Dirección">
          <input className={inputCls} value={clinica.address} onChange={(e) => setClinica({ ...clinica, address: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Departamento" hint={locationRequired ? 'obligatorio' : undefined}>
            <select
              className={inputCls}
              value={clinica.departmentId}
              onChange={(e) => setClinica({ ...clinica, departmentId: e.target.value, municipalityId: '' })}
            >
              <option value="">— Seleccioná —</option>
              {(departmentsQ.data ?? []).map((dep) => (
                <option key={dep.id} value={dep.id}>{dep.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Municipio" hint={locationRequired ? 'obligatorio' : undefined}>
            <select
              className={inputCls}
              value={clinica.municipalityId}
              disabled={!clinica.departmentId}
              onChange={(e) => setClinica({ ...clinica, municipalityId: e.target.value })}
            >
              <option value="">{clinica.departmentId ? '— Seleccioná —' : '— Elegí departamento primero —'}</option>
              {(municipalitiesQ.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Teléfono de la clínica" hint="público; no es login">
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

      {/* ─── Profesional ─── */}
      <Section title="Información profesional" subtitle="Especialidad y biografía pública.">
        <Field label="Especialidad">
          <select className={inputCls} value={info.specialty_id} onChange={(e) => setInfo({ ...info, specialty_id: e.target.value })}>
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

      {/* ─── Servicios (sin borrar) ─── */}
      <AdminDoctorServicesSection doctorId={d.doctorId} canDelete={false} />

      <p className="text-[11px] text-gray-400 mt-2">
        La verificación, los estados operativos y los datos de cuenta los gestiona
        el equipo de LucyCare. Esta pantalla no toca contenido clínico.
      </p>
    </div>
  );
}
