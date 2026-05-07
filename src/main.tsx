import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppProviders } from './providers/AppProviders.tsx'
import { supabase } from './lib/supabase'

// Si hay un token stale en localStorage, PostgREST rechaza todas las queries con 401
// (incluso las públicas). Validamos contra el servidor antes de renderizar.
async function bootstrap() {
  try {
    const hasStoredToken = Object.keys(localStorage).some(
      (k) => k.startsWith('sb-') && k.includes('auth-token')
    )

    if (hasStoredToken) {
      const { error } = await supabase.auth.getUser()
      if (error) {
        console.warn('[boot] sesión stale detectada, limpiando localStorage:', error.message)
        await supabase.auth.signOut({ scope: 'local' })
      }
    }
  } catch (err) {
    console.warn('[boot] error al validar sesión, limpiando manualmente:', err)
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith('sb-')) localStorage.removeItem(k)
    })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  )
}

bootstrap()
