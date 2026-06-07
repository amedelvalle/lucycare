import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Button from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';
import { friendlyErrorMessage } from '../../lib/errors';
import {
  listGlobalDiagnosesAdmin,
  createGlobalDiagnosis,
  updateGlobalDiagnosis,
  listGlobalMedicationsAdmin,
  createGlobalMedication,
  updateGlobalMedication,
  DuplicateCatalogError,
} from '../../services/adminCatalog.service';
import type { DiagnosisCatalogItem } from '../../services/diagnosesCatalog.service';
import {
  PRESENTATIONS,
  type MedicationCatalogItem,
  type MedicationPresentation,
} from '../../services/medicationsCatalog.service';

const PAGE_SIZE = 50;

type Tab = 'diagnosticos' | 'medicamentos';

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

export default function AdminCatalogosPage() {
  const [tab, setTab] = useState<Tab>('diagnosticos');

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Catálogos · Base Lucy</h1>
        <p className="text-sm text-gray-500 mt-1">
          Diagnósticos y medicamentos <strong>globales</strong> que todos los médicos
          ven y pueden usar en consulta. Editar o inactivar un ítem no altera recetas
          ni consultas ya firmadas.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
        <TabButton active={tab === 'diagnosticos'} onClick={() => setTab('diagnosticos')}>
          Diagnósticos
        </TabButton>
        <TabButton active={tab === 'medicamentos'} onClick={() => setTab('medicamentos')}>
          Medicamentos
        </TabButton>
      </div>

      {tab === 'diagnosticos' ? <DiagnosesTab /> : <MedicationsTab />}
    </div>
  );
}

// ─── Tab: Diagnósticos ────────────────────────────────────────────────

function DiagnosesTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  // null = cerrado · 'new' = creando · obj = editando
  const [modal, setModal] = useState<DiagnosisCatalogItem | 'new' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, includeInactive]);

  const queryKey = ['admin-global-diagnoses', { search: debouncedSearch, includeInactive, page }];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      listGlobalDiagnosesAdmin({ search: debouncedSearch, includeInactive, page, pageSize: PAGE_SIZE }),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['admin-global-diagnoses'] });

  const createMutation = useMutation({
    mutationFn: (input: { name: string; description: string | null }) =>
      createGlobalDiagnosis(input),
    onSuccess: () => {
      invalidate();
      setModal(null);
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; name?: string; description?: string | null; is_active?: boolean }) =>
      updateGlobalDiagnosis(input.id, input),
    onSuccess: invalidate,
  });

  const handleSubmit = (input: { name: string; description: string | null }) => {
    if (modal === 'new') {
      createMutation.mutate(input);
    } else if (modal) {
      updateMutation.mutate(
        { id: modal.id, name: input.name, description: input.description },
        { onSuccess: () => { invalidate(); setModal(null); } }
      );
    }
  };

  // Limpia errores de envío previos al abrir/cerrar el modal de form.
  const openModal = (m: DiagnosisCatalogItem | 'new') => {
    createMutation.reset();
    updateMutation.reset();
    setModal(m);
  };
  const closeModal = () => {
    createMutation.reset();
    updateMutation.reset();
    setModal(null);
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const submitError =
    modal === 'new' ? createMutation.error : updateMutation.error;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Diagnósticos globales</h2>
        <Button variant="primary" size="sm" leftIcon={<PlusIcon />} onClick={() => openModal('new')}>
          Nuevo diagnóstico
        </Button>
      </div>

      <CatalogControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar diagnóstico..."
        includeInactive={includeInactive}
        onIncludeInactiveChange={setIncludeInactive}
      />

      {isLoading && items.length === 0 ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <EmptyCatalog
          message={
            debouncedSearch
              ? 'Sin resultados para esa búsqueda.'
              : 'No hay diagnósticos en la Base Lucy todavía.'
          }
          onCreate={!debouncedSearch ? () => openModal('new') : undefined}
          createLabel="Crear primer diagnóstico"
        />
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((d) => (
              <CatalogRow
                key={d.id}
                title={d.name}
                subtitle={d.description}
                isActive={d.is_active}
                onEdit={() => openModal(d)}
                onToggleActive={() =>
                  updateMutation.mutate({ id: d.id, is_active: !d.is_active })
                }
              />
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            itemLabel={{ singular: 'diagnóstico', plural: 'diagnósticos' }}
          />
        </>
      )}

      {modal && (
        <DiagnosisFormModal
          item={modal === 'new' ? null : modal}
          isSubmitting={isSubmitting}
          error={submitError}
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}

function DiagnosisFormModal({
  item,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  item: DiagnosisCatalogItem | null;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (updates: { name: string; description: string | null }) => void;
}) {
  const isCreate = item === null;
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() || null });
  };

  return (
    <ModalShell onClose={onClose} title={isCreate ? 'Nuevo diagnóstico global' : 'Editar diagnóstico global'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldLabel label="Nombre" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="Ej: Hipertensión arterial"
            required
            autoFocus
          />
        </FieldLabel>
        <FieldLabel label="Descripción (opcional)">
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notas sobre este diagnóstico..."
            className={`${inputCls} resize-y`}
          />
        </FieldLabel>
        <FormError error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!name.trim()}>
            {isCreate ? 'Crear' : 'Guardar'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Tab: Medicamentos ────────────────────────────────────────────────

function MedicationsTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<MedicationCatalogItem | 'new' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, includeInactive]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-global-medications', { search: debouncedSearch, includeInactive, page }],
    queryFn: () =>
      listGlobalMedicationsAdmin({ search: debouncedSearch, includeInactive, page, pageSize: PAGE_SIZE }),
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['admin-global-medications'] });

  type MedFields = {
    commercial_name: string;
    active_ingredient: string | null;
    concentration: string | null;
    presentation: MedicationPresentation | null;
  };

  const createMutation = useMutation({
    mutationFn: (input: MedFields) => createGlobalMedication(input),
    onSuccess: () => {
      invalidate();
      setModal(null);
    },
  });
  const updateMutation = useMutation({
    mutationFn: (input: { id: string } & Partial<MedFields & { is_active: boolean }>) =>
      updateGlobalMedication(input.id, input),
    onSuccess: invalidate,
  });

  const handleSubmit = (input: MedFields) => {
    if (modal === 'new') {
      createMutation.mutate(input);
    } else if (modal) {
      updateMutation.mutate(
        { id: modal.id, ...input },
        { onSuccess: () => { invalidate(); setModal(null); } }
      );
    }
  };

  // Limpia errores de envío previos al abrir/cerrar el modal de form.
  const openModal = (m: MedicationCatalogItem | 'new') => {
    createMutation.reset();
    updateMutation.reset();
    setModal(m);
  };
  const closeModal = () => {
    createMutation.reset();
    updateMutation.reset();
    setModal(null);
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const submitError =
    modal === 'new' ? createMutation.error : updateMutation.error;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Medicamentos globales</h2>
        <Button variant="primary" size="sm" leftIcon={<PlusIcon />} onClick={() => openModal('new')}>
          Nuevo medicamento
        </Button>
      </div>

      <CatalogControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por nombre o principio activo..."
        includeInactive={includeInactive}
        onIncludeInactiveChange={setIncludeInactive}
      />

      {isLoading && items.length === 0 ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <EmptyCatalog
          message={
            debouncedSearch
              ? 'Sin resultados para esa búsqueda.'
              : 'No hay medicamentos en la Base Lucy todavía.'
          }
          onCreate={!debouncedSearch ? () => openModal('new') : undefined}
          createLabel="Crear primer medicamento"
        />
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((m) => (
              <CatalogRow
                key={m.id}
                title={m.commercial_name}
                subtitle={[m.active_ingredient, m.concentration, m.presentation]
                  .filter(Boolean)
                  .join(' · ') || null}
                isActive={m.is_active}
                onEdit={() => openModal(m)}
                onToggleActive={() =>
                  updateMutation.mutate({ id: m.id, is_active: !m.is_active })
                }
              />
            ))}
          </ul>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            itemLabel={{ singular: 'medicamento', plural: 'medicamentos' }}
          />
        </>
      )}

      {modal && (
        <MedicationFormModal
          item={modal === 'new' ? null : modal}
          isSubmitting={isSubmitting}
          error={submitError}
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}

function MedicationFormModal({
  item,
  isSubmitting,
  error,
  onClose,
  onSubmit,
}: {
  item: MedicationCatalogItem | null;
  isSubmitting: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (updates: {
    commercial_name: string;
    active_ingredient: string | null;
    concentration: string | null;
    presentation: MedicationPresentation | null;
  }) => void;
}) {
  const isCreate = item === null;
  const [form, setForm] = useState({
    commercial_name: item?.commercial_name ?? '',
    active_ingredient: item?.active_ingredient ?? '',
    concentration: item?.concentration ?? '',
    presentation: (item?.presentation ?? '') as MedicationPresentation | '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.commercial_name.trim()) return;
    onSubmit({
      commercial_name: form.commercial_name.trim(),
      active_ingredient: form.active_ingredient.trim() || null,
      concentration: form.concentration.trim() || null,
      presentation: form.presentation || null,
    });
  };

  return (
    <ModalShell onClose={onClose} title={isCreate ? 'Nuevo medicamento global' : 'Editar medicamento global'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldLabel label="Nombre comercial" required>
          <input
            type="text"
            value={form.commercial_name}
            onChange={(e) => setForm({ ...form, commercial_name: e.target.value })}
            className={inputCls}
            required
            autoFocus
          />
        </FieldLabel>

        <FieldLabel label="Principio activo">
          <input
            type="text"
            value={form.active_ingredient}
            onChange={(e) => setForm({ ...form, active_ingredient: e.target.value })}
            placeholder="Ej: paracetamol"
            className={inputCls}
          />
        </FieldLabel>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldLabel label="Concentración">
            <input
              type="text"
              value={form.concentration}
              onChange={(e) => setForm({ ...form, concentration: e.target.value })}
              placeholder="Ej: 500mg"
              className={inputCls}
            />
          </FieldLabel>
          <FieldLabel label="Presentación">
            <select
              value={form.presentation}
              onChange={(e) =>
                setForm({ ...form, presentation: e.target.value as MedicationPresentation | '' })
              }
              className={`${inputCls} cursor-pointer`}
            >
              <option value="">—</option>
              {PRESENTATIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </FieldLabel>
        </div>

        <FormError error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!form.commercial_name.trim()}>
            {isCreate ? 'Crear' : 'Guardar'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Sub-componentes UI ───────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-emerald-600 text-emerald-700'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function CatalogRow({
  title,
  subtitle,
  isActive,
  onEdit,
  onToggleActive,
}: {
  title: string;
  subtitle: string | null;
  isActive: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  return (
    <li
      className={`bg-white rounded-lg border p-3 flex items-start gap-3 ${
        isActive ? 'border-gray-200' : 'border-gray-200 opacity-60'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
          {!isActive && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
              Inactivo
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <Toggle enabled={isActive} onToggle={onToggleActive} />
      </div>
    </li>
  );
}

function CatalogControls({
  search,
  onSearchChange,
  searchPlaceholder,
  includeInactive,
  onIncludeInactiveChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  includeInactive: boolean;
  onIncludeInactiveChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3 mb-4">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none"
        />
      </div>

      <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-200"
        />
        Mostrar inactivos
      </label>
    </div>
  );
}

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      title={enabled ? 'Inactivar' : 'Reactivar'}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-200 ${
        enabled ? 'bg-emerald-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
          <div className="h-3 bg-gray-100 rounded w-1/4" />
        </div>
      ))}
    </div>
  );
}

function EmptyCatalog({
  message,
  onCreate,
  createLabel,
}: {
  message: string;
  onCreate?: () => void;
  createLabel?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
      <p className="text-sm text-gray-500 mb-4">{message}</p>
      {onCreate && (
        <Button variant="primary" size="sm" leftIcon={<PlusIcon />} onClick={onCreate}>
          {createLabel ?? 'Crear'}
        </Button>
      )}
    </div>
  );
}

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const isDup = error instanceof DuplicateCatalogError;
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs border ${
        isDup
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-red-50 border-red-200 text-red-700'
      }`}
    >
      {isDup ? error.message : friendlyErrorMessage(error)}
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function FieldLabel({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';
