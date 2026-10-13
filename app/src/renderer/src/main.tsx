import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/tokens.css'
import { App } from './App'
import { SettingsApp } from './settings/SettingsApp'
import { RevealApp } from './effects/RevealApp'
import { GlowApp } from './effects/GlowApp'
import { MainApp } from './mainwin/MainApp'
import { Lab } from './mascot/Lab'
import { AgentApp } from './agent/AgentApp'
import { CaptionApp } from './agent/CaptionApp'

function route() {
  const h = location.hash.split('?')[0]
  if (h === '#settings') return <SettingsApp />
  if (h === '#main') return <MainApp />
  if (h === '#reveal') return <RevealApp />
  if (h === '#glow') return <GlowApp />
  if (h === '#lab') return <Lab />
  if (h === '#agent') return <AgentApp />
  if (h === '#caption') return <CaptionApp />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {route()}
  </StrictMode>,
)
