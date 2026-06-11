import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listPlatformAdmins,
  invitePlatformAdmin,
  revokePlatformAdmin,
  type PlatformAdmin,
  type PlatformAdminInvitation,
} from '../../services/platformAdmins.service';
import { getSessionWithTimeout } from '../../lib/session';

/**
 * /admin/administradores — Administración de LucyAdmins (Fase 1, s7_44).
 *
 * Ciclo de vida sin SQL manual: invitar → activar (al primer OTP login del
 * invitado) → revocar. Reglas (docs/ANALISIS_ADMINISTRADORES_LUCY.md):
 * admin = cuenta dedicada; pending sin privilegios; guard de último admin;
 * audit en cada transición. Backend autoritativo — esta UI solo dispara RPCs.
 */

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function AdminAdministradoresPage() {
  const qc = useQueryClient();
  const [myId, setMyId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSessionWithTimeout(3000).then((s) => alive && setMyId(s?.userId ?? null));
    return () => { alive = false; };
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-admins'],
    queryFn: listPlatformAdmins,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform-admins'] });

  const revokeMut = useMutation({
    mutationFn: (profileId: string) => revokePlatformAdmin(profileId),
    onSuccess: () => {
      setNotice('Administrador revocado. Su acceso quedó bloqueado de inmediato.');
      setActionError(null);
      invalidate();
    },
    onError: (e: Error) => { setActionError(e.message); setNotice(null); },
  });

  const admins = data?.admins ?? [];
  const invitations = data?.invitations ?? [];
  const pendingVigentes = invitations.filter((i) => i.status === 'pending' && !i.expired);
  const pendingVencidas = invitations.filter((i) => i.status === 'pending' && i.expired);
  const revoked = invitations.filter((i) => i.status === 'revoked');

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5 flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Administradores</h1>
          <p className="text-sm text-gray-500 mt-1">
            Administradores de la plataforma LucyCare. La invitación se activa cuando la
            persona entra por primera vez con su teléfono (OTP); hasta entonces no tiene
            ningún acceso. El admin usa una <strong>cuenta dedicada</strong>.
          </p>
        </div>
        <button
          onClick={() => { setShowInvite((v) => !v); setActionError(null); setNotice(null); }}
          className="px-4 py-2 text-sm font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800"
        >
          {showInvite ? 'Cancelar' : 'Invitar administrador'}
        </button>
      </div>

      {notice && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {actionError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {showInvite && (
        <InviteForm
          onDone={(msg) => { setShowInvite(false); setNotice(msg); setActionError(null); invalidate(); }}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          No se pudo cargar la lista: {error instanceof Error ? error.message : 'error'}
        </div>
      ) : (
        <>
          {/* ── Activos ── */}
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">
              Activos ({admins.length})
            </h2>
            <ul className="space-y-2">
              {admins.map((a) => (
                <AdminRow
                  key={a.profileId}
                  admin={a}
                  isSelf={a.profileId === myId}
                  isLast={admins.length <= 1}
                  busy={revokeMut.isPending}
                  onRevoke={() => {
                    if (
                      window.confirm(
                        `Vas a revocar a "${a.fullName || a.phone}". Perderá TODO el acceso de administración de inmediato. ¿Continuar?`,
                      )
                    ) {
                      revokeMut.mutate(a.profileId);
                    }
                  }}
                />
              ))}
            </ul>
          </section>

          {/* ── Invitaciones pendientes ── */}
          {(pendingVigentes.length > 0 || pendingVencidas.length > 0) && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-2">
                Invitaciones pendientes
              </h2>
              <p className="text-xs text-gray-500 mb-2">
                Una invitación pendiente no otorga ningún acceso. Se activa cuando la
                persona entra con su teléfono. No se envía aviso automático — contactala
                por tu canal.
              </p>
              <ul className="space-y-2">
                {[...pendingVigentes, ...pendingVencidas].map((inv) => (
                  <InvitationRow key={inv.id} inv={inv} onReinvited={(msg) => { setNotice(msg); invalidate(); }} onError={setActionError} />
                ))}
              </ul>
            </section>
          )}

          {/* ── Historial de revocados ── */}
          {revoked.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Revocados</h2>
              <ul className="space-y-2">
                {revoked.map((inv) => (
                  <li key={inv.id} className="bg-white rounded-lg border border-gray-200 p-3 opacity-70">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">{inv.displayName}</p>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">
                        Revocado
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {inv.phoneNormalized} · revocado el {formatDate(inv.revokedAt)}
                      {inv.revokedByName && <> por {inv.revokedByName}</>}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ─── Filas ────────────────────────────────────────────────────────────

function AdminRow({
  admin,
  isSelf,
  isLast,
  busy,
  onRevoke,
}: {
  admin: PlatformAdmin;
  isSelf: boolean;
  isLast: boolean;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">
            {admin.fullName || 'Sin nombre'}
          </p>
          {isSelf && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">
              vos
            </span>
          )}
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
            Activo
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {admin.phone ?? '—'}
          {admin.activatedAt
            ? <> · admin desde {formatDate(admin.activatedAt)}{admin.invitedByName && <> · invitado por {admin.invitedByName}</>}</>
            : <> · creado por bootstrap</>}
        </p>
      </div>
      <button
        type="button"
        onClick={onRevoke}
        disabled={busy || isLast}
        title={isLast ? 'No se puede revocar al último administrador activo' : 'Revocar acceso de administración'}
        className="px-3 py-1.5 text-xs font-medium border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Revocar
      </button>
    </li>
  );
}

function InvitationRow({
  inv,
  onReinvited,
  onError,
}: {
  inv: PlatformAdminInvitation;
  onReinvited: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const reinviteMut = useMutation({
    mutationFn: () =>
      invitePlatformAdmin({ phone: inv.phoneNormalized, displayName: inv.displayName, email: inv.email }),
    onSuccess: () => onReinvited(`Invitación renovada para ${inv.displayName} (14 días más).`),
    onError: (e: Error) => onError(e.message),
  });

  return (
    <li className={`bg-white rounded-lg border p-3 flex items-center justify-between gap-3 flex-wrap ${inv.expired ? 'border-amber-200' : 'border-gray-200'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-900 truncate">{inv.displayName}</p>
          {inv.expired ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
              Vencida
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">
              Pendiente · expira en {Math.max(0, daysUntil(inv.expiresAt))} día{daysUntil(inv.expiresAt) === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {inv.phoneNormalized}
          {inv.email && <> · {inv.email}</>}
          {inv.invitedByName && <> · invitado por {inv.invitedByName}</>} · {formatDate(inv.invitedAt)}
        </p>
      </div>
      {inv.expired && (
        <button
          type="button"
          onClick={() => reinviteMut.mutate()}
          disabled={reinviteMut.isPending}
          className="px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50"
        >
          {reinviteMut.isPending ? 'Renovando…' : 'Re-invitar'}
        </button>
      )}
    </li>
  );
}

// ─── Form de invitación ───────────────────────────────────────────────

function InviteForm({ onDone }: { onDone: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviteMut = useMutation({
    mutationFn: () => invitePlatformAdmin({ phone, displayName: name, email: email || null }),
    onSuccess: () =>
      onDone(
        `Invitación creada para ${name}. Se activará cuando entre con su teléfono (OTP). Vence en 14 días. Avisale por tu canal — no se envía notificación automática.`,
      ),
    onError: (e: Error) => setError(e.message),
  });

  const inputCls =
    'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
    'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';

  return (
    <div className="mb-6 bg-white rounded-2xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Invitar administrador</h2>
      <p className="text-xs text-gray-500 mb-4">
        El teléfono debe ser una <strong>cuenta dedicada</strong> (no puede pertenecer a un
        paciente, médico o asistente existente). La persona se activa al entrar por primera
        vez con OTP; hasta entonces no tiene acceso.
      </p>

      <div className="space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">
            Nombre <span className="text-red-500">*</span>
          </span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">
              Teléfono (SV) <span className="text-red-500">*</span>
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="7XXXXXXX o 503XXXXXXXX"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Email (opcional)</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </label>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <label className="flex items-start gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 w-4 h-4 text-emerald-700 rounded cursor-pointer flex-shrink-0"
            />
            <span className="text-amber-900">
              Entiendo que, al activarse, esta persona tendrá <strong>acceso total de
              administración</strong> a la plataforma LucyCare.
            </span>
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => { setError(null); inviteMut.mutate(); }}
          disabled={inviteMut.isPending || !confirmed || name.trim().length < 2 || phone.replace(/\D/g, '').length < 8}
          className="px-4 py-2 text-sm font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {inviteMut.isPending ? 'Invitando…' : 'Crear invitación'}
        </button>
      </div>
    </div>
  );
}
