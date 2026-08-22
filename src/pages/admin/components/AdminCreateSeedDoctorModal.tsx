/**
 * ADMIN-DOCTOR-SEED-P0 — "Crear perfil" desde LucyAdmin.
 *
 * Crea un perfil médico SEMBRADO: publicable para prospección, sin identidad
 * utilizable para el médico. Él la obtiene después por el flujo normal y
 * reclama el perfil con el Claim existente.
 *
 * Dos reglas de producto que la UI hace explícitas:
 *   1. El **teléfono de verificación del reclamo** (privado) y el **teléfono
 *      público del consultorio** son campos DISTINTOS y no se copian entre sí.
 *   2. La agenda queda SIEMPRE desactivada: la enciende el médico después de
 *      reclamar. Publicado ≠ agenda habilitada.
 *
 * Patrón de modal del sistema de diseño: no cierra al click fuera; sale por X,
 * Escape o éxito, y la X se bloquea durante el envío.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSpecialtiesForAdmin } from '../../../services/admin.service';
import {
  createSeedDoctor,
  publicDoctorUrl,
  SeedDoctorError,
  type SeedDoctorPayload,
  type SeedDoctorResult,
} from '../../../services/adminDoctorSeed.service';
import { debeRotarOperationId, siguienteOperationId } from '../../../services/seedOperationPolicy';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const VACIO: SeedDoctorPayload = {
  full_name: '', specialty_id: null, clinic_name: '', clinic_address: null,
  clinic_phone: null, department_id: null, municipality_id: null,
  claim_phone: null, email: null, bio: null, consultation_fee: null,
  experience_years: null, jvpm: null, publish: false,
};

export default function AdminCreateSeedDoctorModal({ isOpen, onClose, onCreated }: Props) {
  const [form, setForm] = useState<SeedDoctorPayload>(VACIO);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SeedDoctorResult | null>(null);
  const [copiado, setCopiado] = useState(false);

  /**
   * Clave de idempotencia. Se CONSERVA mientras el resultado de la operación
   * sea incierto —request en vuelo, timeout, error de red, `in_progress`,
   * `lease_lost`, `payload_mismatch`— porque reutilizarla es justamente lo que
   * impide crear dos médicos. La garantía real vive en la PK de
   * `admin_seed_operations`.
   */
  const operationIdRef = useRef<string>(crypto.randomUUID());
  /**
   * Se enciende cuando el servidor respondió con un error que dejó la
   * operación en `failed` (estado TERMINAL). Reintentar con la misma clave
   * chocaría para siempre contra `previously_failed`, así que el PRÓXIMO envío
   * —y solo entonces, si el usuario decide reintentar— estrena clave.
   * Nunca se rota por un clic ni por un fallo ambiguo.
   */
  const rotarEnProximoEnvioRef = useRef(false);

  const especialidadesQ = useQuery({
    queryKey: ['admin-specialties'],
    queryFn: getSpecialtiesForAdmin,
    enabled: isOpen,
    staleTime: 5 * 60_000,
  });

  // Escape cierra (salvo durante el envío). Listener antes de cualquier return.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, loading, onClose]);

  // Cada apertura es un intento nuevo: clave nueva y formulario limpio.
  useEffect(() => {
    if (!isOpen) return;
    operationIdRef.current = crypto.randomUUID();
    rotarEnProximoEnvioRef.current = false;
    setForm(VACIO);
    setError('');
    setResult(null);
    setCopiado(false);
  }, [isOpen]);

  const set = <K extends keyof SeedDoctorPayload>(k: K, v: SeedDoctorPayload[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  /** D1: la publicación exige nombre + especialidad + clínica + dirección. */
  const cumpleD1 = useMemo(
    () =>
      !!form.full_name.trim() && !!form.specialty_id &&
      !!form.clinic_name.trim() && !!form.clinic_address?.trim(),
    [form],
  );
  const puedeGuardar = !!form.full_name.trim() && !!form.clinic_name.trim();
  const requiereAsistencia = !form.claim_phone?.trim() || !form.jvpm?.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    // Solo acá se rota, y solo si el intento anterior terminó en `failed`.
    operationIdRef.current = siguienteOperationId(
      operationIdRef.current,
      rotarEnProximoEnvioRef.current,
      () => crypto.randomUUID(),
    );
    rotarEnProximoEnvioRef.current = false;

    try {
      const r = await createSeedDoctor(operationIdRef.current, {
        ...form,
        publish: form.publish && cumpleD1,
      });
      setResult(r);
      onCreated();
    } catch (err) {
      const code = err instanceof SeedDoctorError ? err.code : null;
      // `null` = fallo ambiguo (timeout/red): NO se rota, se reintenta con la
      // misma clave para recuperar la operación en vez de duplicarla.
      rotarEnProximoEnvioRef.current = debeRotarOperationId(code);
      setError(err instanceof Error ? err.message : 'No pudimos crear el perfil.');
    } finally {
      setLoading(false);
    }
  };

  const copiar = async () => {
    if (!result?.slug) return;
    await navigator.clipboard.writeText(publicDoctorUrl(result.slug));
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 my-8">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {result ? 'Perfil creado' : 'Crear perfil de médico'}
            </h2>
            {!result && (
              <p className="text-sm text-gray-500 mt-1">
                Se crea sin reclamar y con la agenda desactivada. El médico lo reclama
                después desde su perfil público.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 cursor-pointer"
          >
            <i className="ri-close-line text-xl" aria-hidden="true"></i>
          </button>
        </div>

        {/* ───── Éxito ───── */}
        {result ? (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <p className="text-sm font-medium text-emerald-900">
                {result.is_published ? 'Publicado en el directorio' : 'Guardado sin publicar'}
              </p>
              <p className="text-sm text-emerald-800 mt-1">
                La agenda en línea queda desactivada hasta que el médico reclame el perfil.
              </p>
            </div>

            {result.slug ? (
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-2">Enlace público del perfil</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm text-gray-900 truncate">
                    {publicDoctorUrl(result.slug)}
                  </code>
                  <button
                    type="button"
                    onClick={copiar}
                    className="px-3 py-1.5 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
                  >
                    {copiado ? 'Copiado' : 'Copiar enlace'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                El enlace público se genera al publicar el perfil.
              </p>
            )}

            {!result.claim_ready && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-medium text-amber-900">Requiere asistencia para reclamar</p>
                <p className="text-sm text-amber-800 mt-1">
                  Sin teléfono de verificación y sin JVPM, el médico no puede completar el
                  reclamo automático: hay que atenderlo manualmente.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          /* ───── Formulario ───── */
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Datos públicos */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Información pública</h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nombre completo *</label>
                <input
                  type="text" value={form.full_name}
                  onChange={(e) => set('full_name', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Especialidad</label>
                  <select
                    value={form.specialty_id ?? ''}
                    onChange={(e) => set('specialty_id', e.target.value || null)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Sin especialidad</option>
                    {(especialidadesQ.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Clínica *</label>
                  <input
                    type="text" value={form.clinic_name}
                    onChange={(e) => set('clinic_name', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Dirección del consultorio</label>
                <input
                  type="text" value={form.clinic_address ?? ''}
                  onChange={(e) => set('clinic_address', e.target.value || null)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Teléfono público del consultorio
                </label>
                <input
                  type="tel" value={form.clinic_phone ?? ''}
                  onChange={(e) => set('clinic_phone', e.target.value || null)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Se muestra en el perfil público"
                />
              </div>
            </section>

            {/* Datos internos */}
            <section className="space-y-3 pt-2 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">
                Información interna <span className="font-normal text-gray-500">— no se publica</span>
              </h3>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Teléfono de verificación del reclamo (privado)
                </label>
                <input
                  type="tel" value={form.claim_phone ?? ''}
                  onChange={(e) => set('claim_phone', e.target.value || null)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-amber-700 mt-1">
                  Es un campo distinto del teléfono público y no se copia de él.
                  <strong> Quien controle este número podrá intentar verificar el reclamo</strong>,
                  así que cárgalo solo si estás seguro de que es del profesional.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">JVPM</label>
                  <input
                    type="text" value={form.jvpm ?? ''}
                    onChange={(e) => set('jvpm', e.target.value || null)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Correo de contacto</label>
                  <input
                    type="email" value={form.email ?? ''}
                    onChange={(e) => set('email', e.target.value || null)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {requiereAsistencia && (
                <p className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
                  Sin teléfono de verificación o sin JVPM el perfil se puede crear y publicar
                  igual, pero el médico <strong>no podrá completar el reclamo automático</strong> y
                  habrá que atenderlo manualmente.
                </p>
              )}
            </section>

            {/* Publicación */}
            <section className="pt-2 border-t border-gray-100">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox" checked={form.publish} disabled={!cumpleD1}
                  onChange={(e) => set('publish', e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-sm text-gray-700">
                  Publicar en el directorio ahora
                  {!cumpleD1 && (
                    <span className="block text-xs text-gray-500">
                      Para publicar hacen falta nombre, especialidad, clínica y dirección.
                    </span>
                  )}
                </span>
              </label>
              <p className="text-xs text-gray-500 mt-2">
                La agenda en línea queda desactivada en todos los casos. La activa el médico
                después de reclamar el perfil.
              </p>
            </section>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button" onClick={onClose} disabled={loading}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-40 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit" disabled={loading || !puedeGuardar}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-medium hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? 'Creando…' : form.publish ? 'Crear y publicar' : 'Crear sin publicar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
