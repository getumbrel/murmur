import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectionPlayground } from './features/connection/playground'
import './styles.css'

// Dev-only page for the Hermes connection form and Murmur's sign-in: /connection.html
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <ConnectionPlayground />
    </QueryClientProvider>
  </StrictMode>,
)
