import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentAuthUser, type AuthUser } from '../services/auth.service';

/**
 * Guard para rutas /paciente/* ("Mis atenciones", "Mi perfil").
 *
 * Identidad múltiple (Fase 1, ver docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md):
 * una persona es una identidad única que puede tener varios contextos. Su lado
 * paciente ("cuenta personal") debe ser accesible aunque también sea médico o
 * asistente — un médico también se atiende.
 *
 * Gate: permite a personas autenticadas con rol **patient, doctor o assistant**.
 * Excluye **admin** (cuenta privilegiada de plataforma, separada en MVP) y
 * **anon** (sin sesión). NO toca RLS: los datos siguen protegidos por las
 * policies (cada quien ve solo lo suyo, filtrado por auth.uid()/profile_id).
 * Abrir esta ruta no abre datos de otros.
 */
const PATIENT_AREA_ROLES = new Set(['patient', 'doctor', 'assistant']);

export default function PatientOnlyRoute({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    getCurrentAuthUser().then(setUser);
  }, []);

  if (user === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user || !PATIENT_AREA_ROLES.has(user.role ?? '')) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
