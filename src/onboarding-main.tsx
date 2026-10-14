import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Playground } from './features/onboarding/playground'
import './styles.css'

// Dev-only page for the onboarding and agent screens: /onboarding.html
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
)
