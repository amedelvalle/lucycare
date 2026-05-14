import { Navigate } from 'react-router-dom';
import { useClinicContext } from '../hooks/useClinicContext';

export default function DoctorOnlyRoute({ children }: { children: React.ReactNode }) {
  const { data: ctx, isLoading, error } = useClinicContext();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !ctx) {
    return <Navigate to="/panel" replace />;
  }

  if (ctx.role !== 'doctor') {
    return <Navigate to="/panel" replace />;
  }

  return <>{children}</>;
}
