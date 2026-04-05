/**
 * Provider de React Query (TanStack Query).
 * 
 * Wrappea toda la app para que los hooks useQuery funcionen.
 * Configuración global: reintentos, tiempo de cache, etc.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode } from 'react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,                          // 1 reintento en fallo
      refetchOnWindowFocus: false,       // No refetch al cambiar de tab
      staleTime: 1000 * 60 * 2,         // 2 min default
    },
  },
})

interface Props {
  children: ReactNode
}

export function AppProviders({ children }: Props) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
