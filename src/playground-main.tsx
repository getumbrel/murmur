// Dev-only entry for the chat playground: /playground.html
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Playground } from './features/chat/playground'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
)
