import { useState } from 'react';
import {
  useAdminDoctorServices,
  useAdminCreateService,
  useAdminUpdateService,
  useAdminSetServiceActive,
  useAdminDeleteService,
} from '@/hooks/useAdminDoctorServices';
import { ADMIN_FK_VIOLATION, type AdminServiceItem } from '@/services/admin.service';
import { friendlyErrorMessage } from '@/lib/errors';

interface Props {
  doctorId: string;
}

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

function formatPrice(price: number | null): string {
  if (price == null) return 'Sin precio';
  const n = Number(price);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : 'Sin precio';
}

/**
 * Sección "Servicios" dentro de /admin/medicos/:id.
 * El admin plataforma puede crear / editar / activar-desactivar /
 * eliminar servicios del médico (RPCs `admin_*_service` en s7_12).
 *
 * Reusa los patrones visuales de /panel/servicios (lista + modal +
 * diálogo de borrado con fallback a desactivar cuando hay citas).
 */
export default function AdminDoctorServicesSection({ doctorId }: Props) {
  const { data: services = [], isLoading } = useAdminDoctorServices(doctorId);
  const createMut = useAdminCreateService(doctorId);
  const updateMut = useAdminUpdateService(doctorId);
  const toggleMut = useAdminSetServiceActive(doctorId);
  const deleteMut = useAdminDeleteService(doctorId);

  const [modal, setModal] = useState<AdminServiceItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminServiceItem | null>(null);

  const isSubmitting = createMut.isPending || updateMut.isPending;

  const handleSubmit = (input: {
    name: string;
    durationMinutes: number;
    price: number | null;
    isFirstVisit: boolean;
  }) => {
    if (modal === 'new') {
      createMut.mutate(input, { onSuccess: () => setModal(null) });
    } else if (modal) {
      updateMut.mutate(
        { serviceId: modal.id, ...input },
        { onSuccess: () => setModal(null) }
      );
    }
  };

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Servicios</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Tipos de consulta del médico. Aparecen en su perfil público y en la reserva online.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal('new')}
          className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg flex items-center gap-1.5 flex-shrink-0"
        >
          <PlusIcon />
          Nuevo servicio
        </button>
      </header>

      {isLoading && services.length === 0 ? (
        <SkeletonRows />
      ) : services.length === 0 ? (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">
            Este médico aún no tiene servicios cargados.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {services.map((s) => (
            <ServiceRow
              key={s.id}
              item={s}
              onEdit={() => setModal(s)}
              onToggleActive={() =>
                toggleMut.mutate({ serviceId: s.id, isActive: !s.isActive })
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
          onConfirmDelete={() => deleteMut.mutateAsync(deleting.id)}
          onDeactivate={() =>
            toggleMut.mutateAsync({ serviceId: deleting.id, isActive: false }).then(() => undefined)
          }
        />
      )}
    </section>
  );
}

// ─── Fila ─────────────────────────────────────────────────────────────

function ServiceRow({
  item,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  item: AdminServiceItem;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const meta = [`${item.durationMinutes} min`, formatPrice(item.price)].join(' · ');

  return (
    <li
      className={`bg-gray-50 rounded-lg border p-3 flex items-start gap-3 ${
        item.isActive ? 'border-gray-200' : 'border-gray-200 opacity-60'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
          {item.isFirstVisit && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700">
              Primera vez
            </span>
          )}
          {!item.isActive && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
              Inactivo
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{meta}</p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
        >
          Eliminar
        </button>
        <Toggle enabled={item.isActive} onToggle={onToggleActive} />
      </div>
    </li>
  );
}

// ─── Modal crear / editar ─────────────────────────────────────────────

function ServiceFormModal({
  item,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  item: AdminServiceItem | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    durationMinutes: number;
    price: number | null;
    isFirstVisit: boolean;
  }) => void;
}) {
  const isCreate = item === null;
  const [name, setName] = useState(item?.name ?? '');
  const [duration, setDuration] = useState(String(item?.durationMinutes ?? 30));
  const [price, setPrice] = useState(item?.price != null ? String(item.price) : '');
  const [isFirstVisit, setIsFirstVisit] = useState(item?.isFirstVisit ?? false);
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
      durationMinutes: dur,
      price: priceValue,
      isFirstVisit,
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
          <FieldLabel label="Duración (min)" required>
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
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !name.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
          >
            {isSubmitting ? 'Guardando...' : isCreate ? 'Crear' : 'Guardar'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Diálogo de eliminación (2 fases) ─────────────────────────────────

function DeleteServiceDialog({
  service,
  onClose,
  onConfirmDelete,
  onDeactivate,
}: {
  service: AdminServiceItem;
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
      if (code === ADMIN_FK_VIOLATION) {
        setPhase('blocked');
      } else {
        setErrMsg(friendlyErrorMessage(e));
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
      setErrMsg(friendlyErrorMessage(e));
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
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50"
            >
              {busy ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </>
      )}

      {phase === 'blocked' && (
        <>
          <p className="text-sm text-gray-600">
            No se puede eliminar <span className="font-medium text-gray-900">{service.name}</span>{' '}
            porque tiene citas asociadas.
          </p>
          {service.isActive ? (
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
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50"
            >
              {service.isActive ? 'Cancelar' : 'Cerrar'}
            </button>
            {service.isActive && (
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50"
              >
                {busy ? 'Desactivando…' : 'Desactivar servicio'}
              </button>
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
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl"
            >
              Cerrar
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

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
        <div key={i} className="bg-gray-50 rounded-lg border border-gray-200 p-3 animate-pulse">
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
