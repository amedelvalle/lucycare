import { Suspense } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './router'
import ScrollToTop from './components/ScrollToTop'
import SessionGuard from './components/SessionGuard'
import PublicAnalytics from './components/PublicAnalytics'

// Fallback de las rutas lazy (Perf P2): spinner de marca, centrado, sin datos
// ni dependencias. Home y /doctor/* son estáticos (no pasan por acá); esto solo
// se ve al entrar por primera vez a panel/admin/paciente/calificar/reset.
function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div
        className="w-8 h-8 rounded-full border-2 border-gray-200 animate-spin"
        style={{ borderTopColor: '#3C2285' }}
        role="status"
        aria-label="Cargando"
      />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter basename={__BASE_PATH__}>
      <ScrollToTop />
      <SessionGuard />
      <PublicAnalytics />
      <Suspense fallback={<RouteFallback />}>
        <AppRoutes />
      </Suspense>
    </BrowserRouter>
  )
}

export default App