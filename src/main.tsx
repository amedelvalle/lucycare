import { StrictMode } from 'react'
import './i18n'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppProviders } from './providers/AppProviders.tsx'
import { supabase } from './lib/supabase'

// Si hay un token stale en localStorage, PostgREST rechaza todas las queries con 401
// (incluso las públicas). Validamos contra el servidor antes de renderizar.
//
// IMPORTANTE: la validación tiene timeout duro. Si Supabase no responde
// (red lenta, proxy corporativo, lock interno de supabase-js), seguimos
// renderizando igual. Mejor mostrar la app con sesión potencialmente
// stale que dejar al usuario en pantalla blanca para siempre.
const BOOT_TIMEOUT_MS = 3000

async function bootstrap() {
  try {
    const hasStoredToken = Object.keys(localStorage).some(
      (k) => k.startsWith('sb-') && k.includes('auth-token')
    )

    if (hasStoredToken) {
      const userPromise = supabase.auth.getUser()
      const timeoutPromise = new Promise<'__timeout__'>((resolve) =>
        setTimeout(() => resolve('__timeout__'), BOOT_TIMEOUT_MS),
      )
      const result = await Promise.race([userPromise, timeoutPromise])

      if (result === '__timeout__') {
        console.warn('[boot] getUser timeout — continuando con render para no bloquear la UI')
      } else if (result.error) {
        console.warn('[boot] sesión stale detectada, limpiando localStorage:', result.error.message)
        try {
          await Promise.race([
            supabase.auth.signOut({ scope: 'local' }),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ])
        } catch {
          /* ignorado */
        }
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
