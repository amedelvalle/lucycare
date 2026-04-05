/**
 * Componentes skeleton para estados de carga.
 * 
 * Se muestran mientras los datos cargan desde Supabase,
 * reemplazando la pantalla en blanco por un placeholder visual.
 * 
 * Implementa: S1-07 del backlog
 */

export function DoctorCardSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
      {/* Imagen placeholder */}
      <div className="h-48 bg-gray-200" />
      <div className="p-4 space-y-3">
        {/* Nombre */}
        <div className="h-5 bg-gray-200 rounded w-3/4" />
        {/* Especialidad */}
        <div className="h-4 bg-gray-200 rounded w-1/2" />
        {/* Ubicación */}
        <div className="h-4 bg-gray-200 rounded w-2/3" />
        {/* Precio */}
        <div className="flex justify-between items-center pt-2">
          <div className="h-5 bg-gray-200 rounded w-1/4" />
          <div className="h-8 bg-gray-200 rounded w-24" />
        </div>
      </div>
    </div>
  )
}

export function DoctorGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <DoctorCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function DoctorDetailSkeleton() {
  return (
    <div className="max-w-4xl mx-auto p-4 animate-pulse space-y-6">
      {/* Header */}
      <div className="flex gap-6">
        <div className="w-32 h-32 bg-gray-200 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="h-7 bg-gray-200 rounded w-1/2" />
          <div className="h-5 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
      {/* Bio */}
      <div className="space-y-2">
        <div className="h-4 bg-gray-200 rounded w-full" />
        <div className="h-4 bg-gray-200 rounded w-5/6" />
        <div className="h-4 bg-gray-200 rounded w-4/6" />
      </div>
      {/* Servicios */}
      <div className="space-y-2">
        <div className="h-6 bg-gray-200 rounded w-1/4" />
        <div className="h-12 bg-gray-200 rounded" />
        <div className="h-12 bg-gray-200 rounded" />
      </div>
    </div>
  )
}

export function FiltersSkeleton() {
  return (
    <div className="flex gap-3 animate-pulse">
      <div className="h-10 bg-gray-200 rounded-lg w-48" />
      <div className="h-10 bg-gray-200 rounded-lg w-40" />
      <div className="h-10 bg-gray-200 rounded-lg w-40" />
    </div>
  )
}
