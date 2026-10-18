import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import { WheelWindowApp } from './features/wheel/WheelWindowApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WheelWindowApp />
  </StrictMode>,
)
