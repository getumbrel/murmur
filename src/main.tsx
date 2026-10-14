import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { AccessGate } from '@/features/connection/gate'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Standalone installs can require a password before anything connects. */}
    <AccessGate>
      <App />
    </AccessGate>
  </StrictMode>,
)
