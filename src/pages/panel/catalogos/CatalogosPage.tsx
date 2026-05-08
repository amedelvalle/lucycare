import { useEffect, useState } from 'react';
import { useClinicContext } from '@/hooks/useClinicContext';
import {
  useDiagnosesAll,
  useUpdateDiagnosis,
  useMedicationsAll,
  useUpdateMedication,
} from '@/hooks/useCatalogs';
import { useCreateDiagnosis, useCreateMedication } from '@/hooks/useConsultation';
import type { DiagnosisCatalogItem } from '@/services/diagnosesCatalog.service';
import {
  PRESENTATIONS,
  type MedicationCatalogItem,
  type MedicationPresentation,
} from '@/services/medicationsCatalog.service';
import Button from '@/components/ui/Button';

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

type Tab = 'diagnosticos' | 'medicamentos';

export default function CatalogosPage() {
  const { data: ctx, isLoading: loadingCtx } = useClinicContext();
  const [tab, setTab] = useState<Tab>('diagnosticos');

  if (loadingCtx) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">No se encontró contexto de clínica.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Mis catálogos</h1>
        <p className="text-sm text-gray-500 mt-1">
          Diagnósticos y medicamentos que usás en consultas. Editá nombres,
          ajustá detalles o desactivá los que ya no uses.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        <TabButton active={tab === 'diagnosticos'} onClick={() => setTab('diagnosticos')}>
          Diagnósticos
        </TabButton>
        <TabButton active={tab === 'medicamentos'} onClick={() => setTab('medicamentos')}>
          Medicamentos
        </TabButton>
      </div>

      {tab === 'diagnosticos' ? (
        <DiagnosesTab doctorId={ctx.doctorId} />
      ) : (
        <MedicationsTab doctorId={ctx.doctorId} />
      )}
    </div>
  );
}

// ─── Tab: Diagnósticos ────────────────────────────────────────────────

function DiagnosesTab({ doctorId }: { doctorId: string }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  // null = cerrado · 'new' = creando · obj = editando
  const [modal, setModal] = useState<DiagnosisCatalogItem | 'new' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: items = [], isLoading } = useDiagnosesAll(doctorId, debouncedSearch, includeInactive);
  const updateMutation = useUpdateDiagnosis(doctorId);
  const createMutation = useCreateDiagnosis(doctorId);

  const totalActive = items.filter((d) => d.is_active).length;
  const totalUsed = items.reduce((acc, d) => acc + (d.usage_count ?? 0), 0);

  const handleSubmit = (input: { name: string; description: string | null }) => {
    if (modal === 'new') {
      createMutation.mutate(
        { name: input.name, description: input.description ?? undefined },
        { onSuccess: () => setModal(null) }
      );
    } else if (modal) {
      updateMutation.mutate(
        { id: modal.id, name: input.name, description: input.description },
        { onSuccess: () => setModal(null) }
      );
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Diagnósticos</h2>
        <Button variant="primary" size="sm" leftIcon={<PlusIcon />} onClick={() => setModal('new')}>
          Nuevo diagnóstico
        </Button>
      </div>

      <CatalogControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar diagnóstico..."
        includeInactive={includeInactive}
        onIncludeInactiveChange={setIncludeInactive}
        stats={
          <>
            <Stat label="Activos" value={totalActive} />
            <Stat label="Total mostrado" value={items.length} />
            <Stat label="Veces usados" value={totalUsed} />
          </>
        }
      />

      {isLoading ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <EmptyCatalog
          hasSearch={!!debouncedSearch}
          message={
            debouncedSearch
              ? 'Sin resultados para esa búsqueda.'
              : 'Aún no tenés diagnósticos. Crealos desde acá o se crearán automáticamente cuando los uses en una consulta.'
          }
          onCreate={!debouncedSearch ? () => setModal('new') : undefined}
          createLabel="Crear primer diagnóstico"
        />
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <DiagnosisRow
              key={d.id}
              item={d}
              onEdit={() => setModal(d)}
              onToggleActive={() =>
                updateMutation.mutate({ id: d.id, is_active: !d.is_active })
              }
            />
          ))}
        </ul>
      )}

      {modal && (
        <DiagnosisFormModal
          item={modal === 'new' ? null : modal}
          isSubmitting={isSubmitting}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}

function DiagnosisRow({
  item,
  onEdit,
  onToggleActive,
}: {
  item: DiagnosisCatalogItem;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  return (
    <li
      className={`bg-white rounded-lg border p-3 flex items-start gap-3 ${
        item.is_active ? 'border-gray-200' : 'border-gray-200 opacity-60'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
          {!item.is_active && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
              Inactivo
            </span>
          )}
        </div>
        {item.description && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{item.description}</p>
        )}
        <p className="text-[11px] text-gray-400 mt-1">
          Usado {item.usage_count ?? 0} {(item.usage_count ?? 0) === 1 ? 'vez' : 'veces'}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <Toggle enabled={item.is_active} onToggle={onToggleActive} />
      </div>
    </li>
  );
}

/**
 * Modal único para crear o editar diagnóstico — `item=null` indica modo crear.
 */
function DiagnosisFormModal({
  item,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  item: DiagnosisCatalogItem | null;
  isSubmitting: boolean;
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
    <ModalShell onClose={onClose} title={isCreate ? 'Nuevo diagnóstico' : 'Editar diagnóstico'}>
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
            placeholder="Notas internas sobre este diagnóstico..."
            className={`${inputCls} resize-y`}
          />
        </FieldLabel>
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

function MedicationsTab({ doctorId }: { doctorId: string }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [modal, setModal] = useState<MedicationCatalogItem | 'new' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: items = [], isLoading } = useMedicationsAll(doctorId, debouncedSearch, includeInactive);
  const updateMutation = useUpdateMedication(doctorId);
  const createMutation = useCreateMedication(doctorId);

  const totalActive = items.filter((m) => m.is_active).length;
  const totalUsed = items.reduce((acc, m) => acc + (m.usage_count ?? 0), 0);

  const handleSubmit = (input: {
    commercial_name: string;
    active_ingredient: string | null;
    concentration: string | null;
    presentation: MedicationPresentation | null;
  }) => {
    if (modal === 'new') {
      createMutation.mutate(
        {
          commercial_name: input.commercial_name,
          active_ingredient: input.active_ingredient ?? undefined,
          concentration: input.concentration ?? undefined,
          presentation: input.presentation ?? undefined,
        },
        { onSuccess: () => setModal(null) }
      );
    } else if (modal) {
      updateMutation.mutate(
        { id: modal.id, ...input },
        { onSuccess: () => setModal(null) }
      );
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Medicamentos</h2>
        <Button variant="primary" size="sm" leftIcon={<PlusIcon />} onClick={() => setModal('new')}>
          Nuevo medicamento
        </Button>
      </div>

      <CatalogControls
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar medicamento por nombre o principio activo..."
        includeInactive={includeInactive}
        onIncludeInactiveChange={setIncludeInactive}
        stats={
          <>
            <Stat label="Activos" value={totalActive} />
            <Stat label="Total mostrado" value={items.length} />
            <Stat label="Veces usados" value={totalUsed} />
          </>
        }
      />

      {isLoading ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <EmptyCatalog
          hasSearch={!!debouncedSearch}
          message={
            debouncedSearch
              ? 'Sin resultados para esa búsqueda.'
              : 'Aún no tenés medicamentos. Crealos desde acá o se crearán automáticamente cuando los uses en una receta.'
          }
          onCreate={!debouncedSearch ? () => setModal('new') : undefined}
          createLabel="Crear primer medicamento"
        />
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <MedicationRow
              key={m.id}
              item={m}
              onEdit={() => setModal(m)}
              onToggleActive={() =>
                updateMutation.mutate({ id: m.id, is_active: !m.is_active })
              }
            />
          ))}
        </ul>
      )}

      {modal && (
        <MedicationFormModal
          item={modal === 'new' ? null : modal}
          isSubmitting={isSubmitting}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}

function MedicationRow({
  item,
  onEdit,
  onToggleActive,
}: {
  item: MedicationCatalogItem;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const subParts = [item.active_ingredient, item.concentration, item.presentation].filter(Boolean);

  return (
    <li
      className={`bg-white rounded-lg border p-3 flex items-start gap-3 ${
        item.is_active ? 'border-gray-200' : 'border-gray-200 opacity-60'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{item.commercial_name}</p>
          {!item.is_active && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
              Inactivo
            </span>
          )}
        </div>
        {subParts.length > 0 && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{subParts.join(' · ')}</p>
        )}
        <p className="text-[11px] text-gray-400 mt-1">
          Usado {item.usage_count ?? 0} {(item.usage_count ?? 0) === 1 ? 'vez' : 'veces'}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <Toggle enabled={item.is_active} onToggle={onToggleActive} />
      </div>
    </li>
  );
}

/**
 * Modal único para crear o editar medicamento — `item=null` indica modo crear.
 */
function MedicationFormModal({
  item,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  item: MedicationCatalogItem | null;
  isSubmitting: boolean;
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
    <ModalShell onClose={onClose} title={isCreate ? 'Nuevo medicamento' : 'Editar medicamento'}>
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

function CatalogControls({
  search,
  onSearchChange,
  searchPlaceholder,
  includeInactive,
  onIncludeInactiveChange,
  stats,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  includeInactive: boolean;
  onIncludeInactiveChange: (v: boolean) => void;
  stats: React.ReactNode;
}) {
  return (
    <div className="space-y-3 mb-4">
      <div className="grid grid-cols-3 gap-2">{stats}</div>

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
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
      title={enabled ? 'Desactivar' : 'Activar'}
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
  hasSearch: _hasSearch,
  message,
  onCreate,
  createLabel,
}: {
  hasSearch: boolean;
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
