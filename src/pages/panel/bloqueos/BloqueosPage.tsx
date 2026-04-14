// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/bloqueos/BloqueosPage.tsx
// ACCIÓN: NUEVO — crear archivo en carpeta bloqueos
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import {
  useOverrides,
  useCreateOverride,
  useDeleteOverride,
} from '@/hooks/overrides.hooks';
import type {
  AvailabilityOverride,
  CreateOverrideInput,
} from '@/services/overrides.service';
import BlockForm from './BlockForm';
import BlockList from './BlockList';
import ConfirmDialog from './ConfirmDialog';
import { supabase } from '@/lib/supabase';

// ─── Iconos ──────────────────────────────────────────────────────────
const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const ShieldIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

export default function BloqueosPage() {
  // ─── Obtener doctor actual ─────────────────────────────────────
  const [doctorData, setDoctorData] = useState<{
    doctorId: string;
    clinicId: string;
  } | null>(null);
  const [loadingDoctor, setLoadingDoctor] = useState(true);

  useEffect(() => {
    async function loadDoctor() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: doctor } = await supabase
          .from('doctors')
          .select('id, clinic_id')
          .eq('profile_id', user.id)
          .single();

        if (doctor) {
          setDoctorData({
            doctorId: doctor.id,
            clinicId: doctor.clinic_id,
          });
        }
      } catch (err) {
        console.error('Error loading doctor data:', err);
      } finally {
        setLoadingDoctor(false);
      }
    }
    loadDoctor();
  }, []);

  // ─── Estado del UI ─────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingBlock, setEditingBlock] = useState<AvailabilityOverride | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AvailabilityOverride | null>(null);
  const [successMessage, setSuccessMessage] = useState('');

  // ─── Queries & Mutations ───────────────────────────────────────
  const {
    data: overrides = [],
    isLoading: loadingOverrides,
  } = useOverrides(doctorData?.doctorId);

  const createMutation = useCreateOverride();
  const deleteMutation = useDeleteOverride(doctorData?.doctorId ?? '');

  // ─── Handlers ──────────────────────────────────────────────────
  const handleOpenNew = useCallback(() => {
    setEditingBlock(null);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((override: AvailabilityOverride) => {
    setEditingBlock(override);
    setShowForm(true);
  }, []);

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setEditingBlock(null);
  }, []);

  const handleSubmit = useCallback(async (input: CreateOverrideInput) => {
    try {
      await createMutation.mutateAsync(input);
      setShowForm(false);
      setEditingBlock(null);
      showSuccess('Bloqueo creado correctamente');
    } catch (err: any) {
      alert(err.message || 'Error al crear el bloqueo');
    }
  }, [createMutation]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      showSuccess('Bloqueo eliminado');
    } catch (err) {
      alert('Error al eliminar el bloqueo');
    }
  }, [deleteTarget, deleteMutation]);

  function showSuccess(msg: string) {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(''), 3000);
  }

  // ─── Loading ───────────────────────────────────────────────────
  if (loadingDoctor) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!doctorData) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">
            No se encontró perfil de médico asociado a tu cuenta.
          </p>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bloqueos de agenda</h1>
          <p className="text-sm text-gray-500 mt-1">
            Bloquea días por vacaciones, congresos o cualquier motivo. Los pacientes no podrán agendar en fechas bloqueadas.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={handleOpenNew}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <PlusIcon /> Nuevo bloqueo
          </button>
        )}
      </div>

      {/* Success toast */}
      {successMessage && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          {successMessage}
        </div>
      )}

      {/* Info box */}
      <div className="mb-6 flex items-start gap-3 p-4 bg-blue-50/60 border border-blue-100 rounded-lg">
        <ShieldIcon />
        <div className="text-sm text-blue-700">
          <p className="font-medium">¿Cómo funcionan los bloqueos?</p>
          <p className="mt-1 text-blue-600">
            Al crear un bloqueo, los slots de esas fechas se eliminan automáticamente del directorio público. Las citas que ya existan en esas fechas <strong>no se cancelan</strong> — debes gestionarlas por separado.
          </p>
        </div>
      </div>

      {/* Formulario */}
      {showForm && (
        <div className="mb-6">
          <BlockForm
            doctorId={doctorData.doctorId}
            clinicId={doctorData.clinicId}
            editingBlock={editingBlock}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createMutation.isPending}
          />
        </div>
      )}

      {/* Lista */}
      <BlockList
        overrides={overrides}
        isLoading={loadingOverrides}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
        deletingId={deleteMutation.isPending ? deleteTarget?.id : null}
      />

      {/* Dialog eliminación */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar bloqueo"
        message={
          deleteTarget
            ? `¿Eliminar el bloqueo de ${deleteTarget.block_type?.name ?? 'agenda'} del ${formatDate(deleteTarget.date_start)}${
                deleteTarget.date_start !== deleteTarget.date_end ? ` al ${formatDate(deleteTarget.date_end)}` : ''
              }? Los slots volverán a estar disponibles para reserva.`
            : ''
        }
        confirmLabel="Sí, eliminar"
        variant="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
}
