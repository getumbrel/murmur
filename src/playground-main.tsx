// Dev-only entry for the chat playground: /playground.html
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Playground } from './features/chat/playground'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The composer's command palette reads the agent's commands. */}
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Playground />
    </QueryClientProvider>
  </StrictMode>,
)
