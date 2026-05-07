/**
 * StatCard — Tarjeta de métrica individual para el dashboard
 *
 * ACCIÓN: CREAR este archivo nuevo
 * RUTA:   src/pages/panel/home/components/StatCard.tsx
 */

interface StatCardProps {
  label: string
  value: string | number
  subtitle?: string
  icon: string          // clase de Remix Icon, ej: 'ri-calendar-line'
  accentColor?: string  // clase Tailwind, ej: 'text-blue-600 bg-blue-50'
}

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  accentColor = 'text-emerald-700 bg-emerald-50',
}: StatCardProps) {
  // Separar color de texto y fondo del acento
  const [textClass, bgClass] = accentColor.split(' ')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 hover:border-emerald-200 hover:shadow-sm transition-all">
      <div className={`flex-shrink-0 w-11 h-11 rounded-lg flex items-center justify-center ${bgClass || 'bg-gray-50'}`}>
        <i className={`${icon} text-xl ${textClass || 'text-emerald-700'}`}></i>
      </div>
      <div className="min-w-0">
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {subtitle && (
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  )
}
