import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAdminDoctors,
  setDoctorPublished,
  setDoctorOperational,
  setDoctorLucyStatus,
  type AdminDoctorRow,
  type LucyStatus,
} from '../../services/admin.service';

const LUCY_OPTIONS: Array<{ value: LucyStatus; label: string }> = [
  { value: 'listed_only', label: 'Solo listado' },
  { value: 'claimed', label: 'Perfil reclamado' },
  { value: 'booking_enabled', label: 'Agenda habilitada' },
  { value: 'verified', label: 'Verificado' },
];

function Badge({ on, labelOn, labelOff }: { on: boolean; labelOn: string; labelOff: string }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
        on ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {on ? labelOn : labelOff}
    </span>
  );
}

export default function AdminDoctorsPage() {
  const qc = useQueryClient();
  const { data: doctors = [], isLoading, error } = useQuery({
    queryKey: ['admin-doctors'],
    queryFn: getAdminDoctors,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-doctors'] });

  const mPublished = useMutation({
    mutationFn: ({ id, v }: { id: string; v: boolean }) => setDoctorPublished(id, v),
    onSuccess: invalidate,
  });
  const mOperational = useMutation({
    mutationFn: ({ id, v }: { id: string; v: boolean }) => setDoctorOperational(id, v),
    onSuccess: invalidate,
  });
  const mLucy = useMutation({
    mutationFn: ({ id, v }: { id: string; v: LucyStatus }) => setDoctorLucyStatus(id, v),
    onSuccess: invalidate,
  });

  const anyError =
    error ?? mPublished.error ?? mOperational.error ?? mLucy.error;
  const errMsg =
    anyError instanceof Error ? anyError.message : anyError ? String(anyError) : null;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Médicos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ejes independientes — <strong>publicar</strong> (visible en directorio),
          <strong> operar</strong> (puede usar panel/agenda/atender),
          y <strong> lucy_status</strong> (etapa comercial; "Verificado" se deriva
          automáticamente de <code>lucy_status='verified'</code>).
        </p>
      </header>

      {errMsg && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 mb-4">
          {errMsg}
        </div>
      )}

      {isLoading ? (
        <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />
      ) : (
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-2xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Médico</th>
                <th className="px-3 py-3 text-left">Estado</th>
                <th className="px-3 py-3 text-left">Lucy status</th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {doctors.map((d: AdminDoctorRow) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-gray-900">{d.fullName ?? '—'}</p>
                    <p className="text-xs text-gray-500">{d.specialty ?? 'Sin especialidad'}</p>
                    <p className="text-[11px] text-gray-400">{d.clinicName ?? ''}</p>
                  </td>
                  <td className="px-3 py-3 align-top space-y-1">
                    <Badge on={d.isOperational} labelOn="Operativo" labelOff="Suspendido" />{' '}
                    <Badge on={d.isPublished} labelOn="Publicado" labelOff="No publicado" />{' '}
                    <Badge on={d.isVerified} labelOn="Verificado" labelOff="No verificado" />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <select
                      value={d.lucyStatus}
                      disabled={mLucy.isPending}
                      onChange={(e) =>
                        mLucy.mutate({ id: d.id, v: e.target.value as LucyStatus })
                      }
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                    >
                      {LUCY_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-3 align-top text-right space-x-1.5 whitespace-nowrap">
                    <button
                      onClick={() => mPublished.mutate({ id: d.id, v: !d.isPublished })}
                      disabled={mPublished.isPending}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
                    >
                      {d.isPublished ? 'Despublicar' : 'Publicar'}
                    </button>
                    <button
                      onClick={() => mOperational.mutate({ id: d.id, v: !d.isOperational })}
                      disabled={mOperational.isPending}
                      className={`text-xs px-2.5 py-1.5 rounded-lg text-white ${
                        d.isOperational ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                      }`}
                    >
                      {d.isOperational ? 'Suspender' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
              {doctors.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                    No hay médicos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
