import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDirectoryDoctors, type DirectoryDoctorRow } from '../../../services/directoryEditor.service';
import { setDoctorPublished } from '../../../services/admin.service';

/**
 * Listado de médicos para el nivel `directory_editor` (LucyAdmin acotado).
 * Consume SOLO `directory_list_doctors` (sin teléfono/email de login) y la RPC
 * re-gateada `admin_set_doctor_published` (toca solo is_published). NO muestra
 * lucy_status editable, operatividad, lista de espera ni datos de login.
 */
const PAGE_SIZE = 25;
type TriState = 'all' | 'yes' | 'no';
const triToBool = (v: TriState): boolean | null => (v === 'all' ? null : v === 'yes');

function Badge({ on, labelOn, labelOff }: { on: boolean; labelOn: string; labelOff: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
      {on ? labelOn : labelOff}
    </span>
  );
}

export default function DirectoryDoctorsList() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [published, setPublished] = useState<TriState>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);
  useEffect(() => { setPage(1); }, [published]);

  const hasFilters = !!search || published !== 'all';
  const clearFilters = () => { setSearchInput(''); setSearch(''); setPublished('all'); setPage(1); };

  const { data, isLoading, error } = useQuery({
    queryKey: ['directory-doctors', { search, published, page }],
    queryFn: () => getDirectoryDoctors({
      search: search || undefined,
      published: triToBool(published),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    placeholderData: (prev) => prev,
  });

  const mPublished = useMutation({
    mutationFn: ({ id, v }: { id: string; v: boolean }) => setDoctorPublished(id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['directory-doctors'] }),
  });

  const anyError = error ?? mPublished.error;
  const errMsg = anyError instanceof Error ? anyError.message : anyError ? String(anyError) : null;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Médicos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Corregí y completá la información pública del directorio. La verificación
          y los estados operativos los gestiona el equipo de LucyCare.
        </p>
      </header>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-3">
            <label className="block text-xs text-gray-500 mb-1">Buscar</label>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nombre o especialidad…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Publicado</label>
            <select
              value={published}
              onChange={(e) => setPublished(e.target.value as TriState)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            >
              <option value="all">Todos</option>
              <option value="yes">Publicado</option>
              <option value="no">No publicado</option>
            </select>
          </div>
          <div className="md:col-span-4 flex items-center justify-end gap-2">
            {hasFilters && (
              <button onClick={clearFilters} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50">
                Limpiar filtros
              </button>
            )}
            <span className="text-xs text-gray-500 self-center">
              {total} {total === 1 ? 'resultado' : 'resultados'}
            </span>
          </div>
        </div>
      </div>

      {errMsg && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 mb-4">{errMsg}</div>
      )}

      {isLoading && rows.length === 0 ? (
        <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-600">No se encontraron médicos con esos filtros.</p>
          {hasFilters && (
            <button onClick={clearFilters} className="mt-3 text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-2xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Médico</th>
                <th className="px-3 py-3 text-left">Directorio</th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((d: DirectoryDoctorRow) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 align-top">
                    <p className="font-medium text-gray-900">{d.fullName ?? '—'}</p>
                    <p className="text-xs text-gray-500">{d.specialty ?? 'Sin especialidad'}</p>
                    <p className="text-[11px] text-gray-400">{d.clinicName ?? ''}</p>
                  </td>
                  <td className="px-3 py-3 align-top space-y-1">
                    <Badge on={d.isPublished} labelOn="Publicado" labelOff="No publicado" />{' '}
                    {d.isVerified && <Badge on labelOn="Verificado" labelOff="" />}
                  </td>
                  <td className="px-3 py-3 align-top text-right space-x-1.5 whitespace-nowrap">
                    <Link
                      to={`/admin/medicos/${d.id}`}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center"
                    >
                      Editar
                    </Link>
                    <button
                      onClick={() => mPublished.mutate({ id: d.id, v: !d.isPublished })}
                      disabled={mPublished.isPending}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      {d.isPublished ? 'Despublicar' : 'Publicar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>Página {page} de {totalPages}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
