import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { normalizePhoneSV } from '@/lib/phone';
import { PHONE_CHANGE_SUSPENDED, PHONE_CHANGE_SUSPENDED_MESSAGE } from '@/lib/authFlags';

/**
 * Modal de cambio de teléfono por OTP (reusable: paciente y médico).
 *
 * Flujo (Supabase Auth, sesión activa requerida):
 *   1. Nuevo número → updateUser({ phone }) → OTP SMS al NUEVO número.
 *   2. Código → verifyOtp({ phone, token, type: 'phone_change' }) → confirma.
 *   3. auth.users.phone = nuevo → el trigger s7_34 sincroniza profiles.phone +
 *      patients.phone vinculadas + audit (server-side).
 *
 * "Secure phone change" OFF → no se pide OTP al número anterior. Modal sensible:
 * no cierra al click-outside; X/Escape salvo durante envío.
 */

interface Props {
  currentPhone: string | null;
  onClose: () => void;
  onChanged: (newPhone: string) => void;
}

type Step = 'phone' | 'otp' | 'done';

const inputCls =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-800 ' +
  'focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 outline-none';

export default function ChangePhoneModal({ currentPhone, onClose, onChanged }: Props) {
  const [step, setStep] = useState<Step>('phone');
  const [phoneRaw, setPhoneRaw] = useState('');
  const [otp, setOtp] = useState('');
  const [e164, setE164] = useState('');       // +503XXXXXXXX confirmado en el paso 1
  const [displayNew, setDisplayNew] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onClose]);

  const sendCode = async () => {
    if (PHONE_CHANGE_SUSPENDED) return; // AUTH-P1D2: no ejecutar updateUser({phone})
    setError(null);
    const norm = normalizePhoneSV(phoneRaw);
    if (!norm) { setError('Ingresá un número válido.'); return; }
    const currentNorm = normalizePhoneSV(currentPhone);
    if (norm === currentNorm) { setError('Ese ya es tu número actual.'); return; }
    const target = '+' + norm;
    setLoading(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ phone: target });
      if (upErr) { setError(mapUpdateError(upErr.message)); return; }
      setE164(target);
      setDisplayNew(norm);
      setStep('otp');
    } catch {
      setError('No pudimos enviar el código. Probá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const confirmCode = async () => {
    setError(null);
    if (otp.trim().length < 4) { setError('Ingresá el código que recibiste.'); return; }
    setLoading(true);
    try {
      const { error: vErr } = await supabase.auth.verifyOtp({ phone: e164, token: otp.trim(), type: 'phone_change' });
      if (vErr) { setError(mapVerifyError(vErr.message)); return; }
      setStep('done');
      onChanged(normalizePhoneSV(e164) ?? displayNew); // refresca el perfil en el parent
    } catch {
      setError('No pudimos confirmar el código. Probá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (PHONE_CHANGE_SUSPENDED) return; // AUTH-P1D2: no ejecutar updateUser({phone})
    setError(null);
    setLoading(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ phone: e164 });
      if (upErr) setError(mapUpdateError(upErr.message));
    } finally {
      setLoading(false);
    }
  };

  // AUTH-P1D2: cambio de teléfono SUSPENDIDO temporalmente. Se muestra un aviso
  // breve y NO se ejecuta updateUser({ phone }). El código del flujo se conserva
  // (no se elimina) para restaurarlo cuando se levante la suspensión.
  if (PHONE_CHANGE_SUSPENDED) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h3 className="text-base font-semibold text-gray-900">Cambiar teléfono</h3>
            <button type="button" onClick={onClose} aria-label="Cerrar"
              className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-700">{PHONE_CHANGE_SUSPENDED_MESSAGE}</p>
          <button type="button" onClick={onClose}
            className="mt-5 w-full px-4 py-2.5 bg-brand-purple text-white rounded-lg font-medium hover:bg-brand-purple-dark cursor-pointer">
            Entendido
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h3 className="text-base font-semibold text-gray-900">Cambiar teléfono</h3>
          <button type="button" onClick={onClose} disabled={loading} aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {step === 'phone' && (
          <>
            <p className="text-sm text-gray-600 mb-4">
              Tu teléfono es tu forma de acceder a Lucy. Verificamos el número nuevo con un código por SMS.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nuevo número</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">+503</span>
              <input type="tel" inputMode="numeric" value={phoneRaw} disabled={loading}
                onChange={(e) => setPhoneRaw(e.target.value)} placeholder="7700 3001" className={inputCls} autoFocus />
            </div>
          </>
        )}

        {step === 'otp' && (
          <>
            <p className="text-sm text-gray-600 mb-4">
              Te enviamos un código por SMS a <span className="font-semibold">+{displayNew}</span>. Ingresalo para confirmar.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Código</label>
            <input type="text" inputMode="numeric" value={otp} disabled={loading}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="000000" className={inputCls} autoFocus />
            <button type="button" onClick={resend} disabled={loading}
              className="mt-2 text-xs text-emerald-700 hover:text-emerald-800 disabled:opacity-50">
              Reenviar código
            </button>
          </>
        )}

        {step === 'done' && (
          <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-3">
            <svg className="w-5 h-5 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <p className="text-sm text-emerald-800">Tu teléfono se actualizó a <span className="font-semibold">+{displayNew}</span>.</p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mt-3">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-5">
          {step === 'done' ? (
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl">Listo</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={loading}
                className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={step === 'phone' ? sendCode : confirmCode} disabled={loading}
                className="px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl disabled:opacity-50">
                {loading ? 'Procesando…' : step === 'phone' ? 'Enviar código' : 'Confirmar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function mapUpdateError(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (/already|registered|exists|taken|duplicate/.test(m)) return 'Ese número ya está registrado en LucyCare.';
  if (/invalid|phone/.test(m)) return 'Número de teléfono inválido. Verificá el formato.';
  if (/rate|too many/.test(m)) return 'Demasiados intentos. Esperá un momento antes de reintentar.';
  return 'No pudimos enviar el código. Probá de nuevo.';
}
function mapVerifyError(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (/expired/.test(m)) return 'El código expiró. Pedí uno nuevo con "Reenviar código".';
  if (/invalid|token|incorrect/.test(m)) return 'Código incorrecto. Verificá e intentá de nuevo.';
  return 'No pudimos confirmar el código. Probá de nuevo.';
}
