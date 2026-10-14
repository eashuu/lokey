import { isPhone } from './lib/platform' // first: it marks <html class="phone"> before anything is styled
import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/tokens.css'
import { App } from './App'
import { bridge } from './bridge'
import { SettingsApp } from './settings/SettingsApp'
import { RevealApp } from './effects/RevealApp'
import { GlowApp } from './effects/GlowApp'
import { MainApp } from './mainwin/MainApp'
import { Lab } from './mascot/Lab'
import { Reel } from './mascot/Reel'
import { Mock } from './mascot/Mock'
import { AgentApp } from './agent/AgentApp'
import { CaptionApp } from './agent/CaptionApp'
import { DictationApp } from './agent/DictationApp'
import { LassoApp } from './agent/LassoApp'
import { ConfirmApp } from './agent/ConfirmApp'
import { LyricsLab } from './lyrics/LyricsLab'
import { LyricsWindow } from './lyrics/LyricsWindow'
import { PhoneApp } from './phone/PhoneApp'

/** one boundary per page root: a render error blanks that page and is logged, instead of tearing down the window */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { try { bridge.app.log(`render error: ${e instanceof Error ? e.message : String(e)}`) } catch { /* no bridge */ } }
  render() { return this.state.failed ? null : this.props.children }
}

function route() {
  const h = location.hash.split('?')[0]
  // phone: one app shell (island + pages + lyrics); Lab / Reel / Mock / Lyrics lab previews stay available for development
  if (isPhone && ['', '#', '#home', '#lyrics', '#settings', '#main'].includes(h)) return <PhoneApp />
  if (h === '#settings') return <SettingsApp />
  if (h === '#main') return <MainApp />
  if (h === '#reveal') return <RevealApp />
  if (h === '#glow') return <GlowApp />
  if (h === '#lab') return <Lab />
  if (h === '#reel') return <Reel />
  if (h === '#mock') return <Mock />
  if (h === '#agent') return <AgentApp />
  if (h === '#caption') return <CaptionApp />
  if (h === '#dictation') return <DictationApp />
  if (h === '#lasso') return <LassoApp />
  if (h === '#confirm') return <ConfirmApp />
  if (h === '#lyricslab') return <LyricsLab />
  if (h === '#lyrics') return <LyricsWindow />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>{route()}</Boundary>
  </StrictMode>,
)
