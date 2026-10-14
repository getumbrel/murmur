import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { RoutinesHarness } from './features/routines/harness'
import './styles.css'

// Dev-only page for routines against a live Hermes: /routines.html?agent=murmur-test-atlas
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: 1 } } })}>
      <RoutinesHarness />
      <Toaster position="top-center" toastOptions={{ className: 'murmur-toast' }} />
    </QueryClientProvider>
  </StrictMode>,
)
