import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/tokens.css'
import { App } from './App'
import { SettingsApp } from './settings/SettingsApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.hash === '#settings' ? <SettingsApp /> : <App />}
  </StrictMode>,
)
