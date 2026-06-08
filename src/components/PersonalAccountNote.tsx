/**
 * Nota mínima de contexto para el área de paciente (identidad múltiple, Fase 1).
 *
 * Se muestra SOLO a personas cuyo rol es doctor/assistant cuando entran a su
 * lado paciente ("Mis atenciones" / "Mi perfil"), para aclarar que están en su
 * **cuenta personal** y que su **panel médico es aparte**. Para un paciente puro
 * no se muestra nada (no agrega ruido).
 *
 * No toca datos ni RLS — es solo copy. El rol se lee de la sesión.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCurrentAuthUser } from '@/services/auth.service';

export default function PersonalAccountNote() {
  const [role, setRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getCurrentAuthUser()
      .then((u) => alive && setRole(u?.role ?? null))
      .catch(() => alive && setRole(null));
    return () => {
      alive = false;
    };
  }, []);

  if (role !== 'doctor' && role !== 'assistant') return null;

  return (
    <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-sm text-blue-900 flex items-start gap-2">
      <i className="ri-information-line text-blue-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <span>
        Estás en tu <strong>cuenta personal de paciente</strong>. Tu perfil profesional y tu
        panel médico son aparte — una misma persona puede tener cuenta personal y perfil médico.{' '}
        <Link to="/panel" className="font-medium underline">Ir al panel médico</Link>.
      </span>
    </div>
  );
}
