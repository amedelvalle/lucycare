import { useState } from 'react';
import { useClinicContext } from '@/hooks/useClinicContext';
import {
  useDoctorServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
} from '@/hooks/useDoctorServices';
import { FK_VIOLATION, type ServiceItem, type ServiceInput } from '@/services/services.service';
import Button from '@/components/ui/Button';

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

/** Formatea el precio; null → "Sin precio". Coerce defensivo por si PostgREST devuelve numeric como string. */
function formatPrice(price: number | null): string {
  if (price == null) return 'Sin precio';
  const n = Number(price);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : 'Sin precio';
}

export default function ServiciosPage() {
  const { data: ctx, isLoading: loadingCtx } = useClinicContext();
  const doctorId = ctx?.doctorId;

  const { data: services = [], isLoading } = useDoctorServices(doctorId);
  const createMutation = useCreateService(doctorId ?? '');
  const updateMutation = useUpdateService(doctorId ?? '');
  const deleteMutation = useDeleteService(doctorId ?? '');

  // null = cerrado · 'new' = creando · obj = editando
  const [modal, setModal] = useState<ServiceItem | 'new' | null>(null);
  // servicio en proceso de eliminación (abre el diálogo de borrado)
  const [deleting, setDeleting] = useState<ServiceItem | null>(null);

  if (loadingCtx) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!ctx || !doctorId) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">No se encontró perfil de médico asociado a tu cuenta.</p>
        </div>
      </div>
    );
  }

  const handleSubmit = (input: ServiceInput) => {
    if (modal === 'new') {
      createMutation.mutate(input, { onSuccess: () => setModal(null) });
    } else if (modal) {
      updateMutation.mutate({ id: modal.id, ...input }, { onSuccess: () => setModal(null) });
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mis servicios</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tus tipos de consulta. Definí nombre, duración y precio; aparecen en
            tu perfil público y en la reserva online.
          </p>
        </div>
        <Button variant="primary" size="sm" leftIcon={<PlusIcon />} onClick={() => setModal('new')}>
          Nuevo servicio
        </Button>
      </div>

      {isLoading && services.length === 0 ? (
        <SkeletonRows />
      ) : services.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500 mb-4">
            Aún no tenés servicios cargados. Creá tu primer tipo de consulta.
          </p>
          <Button variant="primary" size="sm" leftIcon={<PlusIcon />} onClick={() => setModal('new')}>
            Crear primer servicio
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {services.map((s) => (
            <ServiceRow
              key={s.id}
              item={s}
              onEdit={() => setModal(s)}
              onToggleActive={() =>
                updateMutation.mutate({ id: s.id, is_active: !s.is_active })
              }
              onDelete={() => setDeleting(s)}
            />
          ))}
        </ul>
      )}

      {modal && (
        <ServiceFormModal
          item={modal === 'new' ? null : modal}
          isSubmitting={isSubmitting}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {deleting && (
        <DeleteServiceDialog
          service={deleting}
          onClose={() => setDeleting(null)}
          onConfirmDelete={() => deleteMutation.mutateAsync(deleting.id)}
          onDeactivate={() =>
            updateMutation.mutateAsync({ id: deleting.id, is_active: false }).then(() => undefined)
          }
        />
      )}
    </div>
  );
}

// ─── Fila de servicio ─────────────────────────────────────────────────

function ServiceRow({
  item,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  item: ServiceItem;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const meta = [`${item.duration_minutes} min`, formatPrice(item.price)].join(' · ');

  return (
    <li
      className={`bg-white rounded-lg border p-3 flex items-start gap-3 ${
        item.is_active ? 'border-gray-200' : 'border-gray-200 opacity-60'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
          {item.is_first_visit && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700">
              Primera vez
            </span>
          )}
          {!item.is_active && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
              Inactivo
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{meta}</p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Editar
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          Eliminar
        </Button>
        <Toggle enabled={item.is_active} onToggle={onToggleActive} />
      </div>
    </li>
  );
}

// ─── Modal crear / editar ─────────────────────────────────────────────

/**
 * Modal único para crear o editar servicio — `item=null` indica modo crear.
 */
function ServiceFormModal({
  item,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  item: ServiceItem | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: ServiceInput) => void;
}) {
  const isCreate = item === null;
  const [name, setName] = useState(item?.name ?? '');
  const [duration, setDuration] = useState(String(item?.duration_minutes ?? 30));
  const [price, setPrice] = useState(item?.price != null ? String(item.price) : '');
  const [isFirstVisit, setIsFirstVisit] = useState(item?.is_first_visit ?? false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('El nombre es obligatorio.');
      return;
    }
    const dur = parseInt(duration, 10);
    if (!Number.isFinite(dur) || dur <= 0) {
      setError('La duración debe ser un número de minutos mayor a 0.');
      return;
    }
    const priceTrim = price.trim();
    let priceValue: number | null = null;
    if (priceTrim !== '') {
      const p = Number(priceTrim);
      if (!Number.isFinite(p) || p < 0) {
        setError('El precio debe ser un número mayor o igual a 0, o dejarse vacío.');
        return;
      }
      priceValue = p;
    }
    setError('');
    onSubmit({
      name: trimmedName,
      duration_minutes: dur,
      price: priceValue,
      is_first_visit: isFirstVisit,
    });
  };

  return (
    <ModalShell onClose={onClose} title={isCreate ? 'Nuevo servicio' : 'Editar servicio'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FieldLabel label="Nombre" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="Ej: Consulta general"
            required
            autoFocus
          />
        </FieldLabel>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldLabel label="Duración (minutos)" required>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className={inputCls}
              min={5}
              step={5}
              required
            />
          </FieldLabel>
          <FieldLabel label="Precio (USD)">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputCls}
              min={0}
              step={0.01}
              placeholder="Opcional"
            />
          </FieldLabel>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={isFirstVisit}
            onChange={(e) => setIsFirstVisit(e.target.checked)}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-200"
          />
          Es consulta de primera vez
        </label>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

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

// ─── Diálogo de eliminación (2 fases) ─────────────────────────────────

/**
 * Diálogo de borrado de servicio. Intenta hard-delete; si el servicio
 * tiene citas (FK 23503), pasa a la fase "bloqueado" y ofrece desactivar.
 */
function DeleteServiceDialog({
  service,
  onClose,
  onConfirmDelete,
  onDeactivate,
}: {
  service: ServiceItem;
  onClose: () => void;
  onConfirmDelete: () => Promise<void>;
  onDeactivate: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<'confirm' | 'blocked' | 'error'>('confirm');
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const handleDelete = async () => {
    setBusy(true);
    try {
      await onConfirmDelete();
      onClose();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === FK_VIOLATION) {
        setPhase('blocked');
      } else {
        setErrMsg((e as { message?: string })?.message ?? 'No se pudo eliminar el servicio.');
        setPhase('error');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    setBusy(true);
    try {
      await onDeactivate();
      onClose();
    } catch (e) {
      setErrMsg((e as { message?: string })?.message ?? 'No se pudo desactivar el servicio.');
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={busy ? () => {} : onClose} title="Eliminar servicio">
      {phase === 'confirm' && (
        <>
          <p className="text-sm text-gray-600">
            ¿Eliminar el servicio <span className="font-medium text-gray-900">{service.name}</span>?
            Esta acción no se puede deshacer.
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={busy}>
              Eliminar
            </Button>
          </div>
        </>
      )}

      {phase === 'blocked' && (
        <>
          <p className="text-sm text-gray-600">
            No se puede eliminar <span className="font-medium text-gray-900">{service.name}</span>{' '}
            porque tiene citas asociadas.
          </p>
          {service.is_active ? (
            <p className="text-sm text-gray-600 mt-2">
              Podés desactivarlo para que no aparezca en nuevas reservas. Las
              citas existentes se conservan.
            </p>
          ) : (
            <p className="text-sm text-gray-600 mt-2">
              Este servicio ya está desactivado, así que no aparece en nuevas
              reservas.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {service.is_active ? 'Cancelar' : 'Cerrar'}
            </Button>
            {service.is_active && (
              <Button variant="primary" onClick={handleDeactivate} loading={busy}>
                Desactivar servicio
              </Button>
            )}
          </div>
        </>
      )}

      {phase === 'error' && (
        <>
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {errMsg}
          </p>
          <div className="flex justify-end pt-4">
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ─── Sub-componentes UI ───────────────────────────────────────────────

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
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-3 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
          <div className="h-3 bg-gray-100 rounded w-1/4" />
        </div>
      ))}
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
