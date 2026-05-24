import { useRef, useState } from 'react';
import DoctorAvatar from './DoctorAvatar';
import { AVATAR_ALLOWED_MIME, AVATAR_MAX_BYTES, type AvatarUploadResult } from '../services/avatar.service';

interface AvatarUploaderProps {
  /** Nombre del médico (fallback iniciales). */
  name: string;
  /** URL actual del avatar (puede ser null). */
  currentUrl: string | null | undefined;
  /** Handler de subida — el caller decide si es self-service o admin. */
  onUpload: (file: File) => Promise<AvatarUploadResult>;
  /** Handler de remoción. */
  onRemove: () => Promise<AvatarUploadResult>;
  /** Callback opcional cuando la subida termina OK (para invalidar queries). */
  onSuccess?: (newUrl: string | null) => void;
  /** Deshabilita controles (p.ej. mientras un padre carga datos). */
  disabled?: boolean;
}

/**
 * UI reusable para subir/cambiar/quitar la foto de perfil del médico.
 *
 * Estados internos:
 *  - idle:    muestra el avatar actual + botones Cambiar/Quitar.
 *  - preview: el usuario eligió un archivo, ve preview + botones Subir/Cancelar.
 *  - busy:    está subiendo o quitando.
 *  - error:   muestra mensaje y permite reintentar.
 *
 * Sin crop. Sin drag&drop. Sin librerías externas. Cámara móvil habilitada
 * vía capture="user".
 */
export default function AvatarUploader({
  name,
  currentUrl,
  onUpload,
  onRemove,
  onSuccess,
  disabled,
}: AvatarUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptAttr = AVATAR_ALLOWED_MIME.join(',');

  const handlePick = () => {
    if (disabled || busy) return;
    setError(null);
    inputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-seleccionar el mismo archivo si cancelan
    if (!file) return;

    if (!AVATAR_ALLOWED_MIME.includes(file.type as (typeof AVATAR_ALLOWED_MIME)[number])) {
      setError('Formato no permitido. Usá JPG, PNG o WEBP.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError('La imagen supera los 5 MB. Reducila e intentá de nuevo.');
      return;
    }

    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
  };

  const cancelPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(null);
    setPreviewUrl(null);
    setError(null);
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onUpload(pendingFile);
      if (result.success) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPendingFile(null);
        setPreviewUrl(null);
        onSuccess?.(result.avatarUrl ?? null);
      } else {
        setError(result.errorMessage || 'No pudimos subir la imagen.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (busy) return;
    if (!window.confirm('¿Quitar la foto de perfil?')) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onRemove();
      if (result.success) {
        onSuccess?.(null);
      } else {
        setError(result.errorMessage || 'No pudimos quitar la imagen.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  };

  const showingPreview = !!previewUrl;

  return (
    <div className="flex flex-col sm:flex-row items-start gap-5">
      {/* Avatar / preview */}
      <div className="flex-shrink-0">
        {showingPreview ? (
          <img
            src={previewUrl as string}
            alt="Vista previa"
            className="w-24 h-24 rounded-full object-cover bg-gray-100 border-2 border-emerald-300"
          />
        ) : (
          <DoctorAvatar name={name} photoUrl={currentUrl ?? null} className="w-24 h-24" textClassName="text-2xl" />
        )}
      </div>

      {/* Controles */}
      <div className="flex-1 min-w-0">
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          capture="user"
          onChange={handleFileChange}
          className="hidden"
        />

        {showingPreview ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Vista previa. Confirmá para subir o cancelá para descartar.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={confirmUpload}
                disabled={busy || disabled}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  busy || disabled
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                }`}
              >
                {busy ? 'Subiendo…' : 'Subir foto'}
              </button>
              <button
                type="button"
                onClick={cancelPreview}
                disabled={busy}
                className="px-4 py-2 rounded-lg font-medium text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              JPG, PNG o WEBP · máx 5 MB · cuadrada se ve mejor.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handlePick}
                disabled={disabled || busy}
                className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                  disabled || busy
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                }`}
              >
                {currentUrl ? 'Cambiar foto' : 'Subir foto'}
              </button>
              {currentUrl && (
                <button
                  type="button"
                  onClick={confirmRemove}
                  disabled={disabled || busy}
                  className="px-4 py-2 rounded-lg font-medium text-sm border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Quitando…' : 'Quitar'}
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
