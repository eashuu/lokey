import { EventEmitter } from 'node:events'
import { clipboard, screen } from 'electron'
import type { DictationEvent } from '@shared/voice'
import type { Sidecar } from '../sidecar'
import { settings } from '../settings'
import type { AgentAudio } from './audio'
import { getKey, hasKey } from './keystore'
import { dictationBar } from './overlays'
import { GeminiSession } from './session'

// Dictation: hold the key anywhere, talk, release. A live session streams the raw transcript into a bubble over the
// focused field; on release a plain Gemini call cleans it up (false starts, corrections), the bubble rewrites itself and
// the text is typed into the field. Nothing is spoken back.

const SILENT = 'You are a silent transcriber for dictation. Never answer, never speak, never use tools. Say nothing.'
const CLEAN = 'The user dictated this by voice. Rewrite it as the final text they meant to write: drop filler words, false starts and self-corrections (keep the last version they settled on), fix punctuation, capitalisation and numbers/times, keep their own words, tone and language. Do not add, answer or explain anything. Output only the text.'

/** last-resort tidy when the cleanup call fails */
export function tidy(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const s = t[0].toUpperCase() + t.slice(1)
  return /[.!?…]$/.test(s) ? s : s + '.'
}

export async function cleanTranscript(raw: string): Promise<string> {
  const key = getKey()
  if (!key || !raw.trim()) return tidy(raw)
  try {
    const m = settings.value.voice.cleanupModel
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: CLEAN }] }, contents: [{ role: 'user', parts: [{ text: raw }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 1024 } }),
      signal: AbortSignal.timeout(6000),
    })
    if (!r.ok) return tidy(raw)
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const out = j.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim().replace(/^["“]|["”]$/g, '')
    return out || tidy(raw)
  } catch { return tidy(raw) }
}

export class Dictation extends EventEmitter {
  active = false
  private session: GeminiSession | null = null
  private raw = ''
  private pending: Buffer[] = []
  private hwnd = 0
  private startedAt = 0
  private onMic = (b: Buffer) => { if (this.session?.connected) this.session.sendAudio(b); else if (this.pending.length < 120) this.pending.push(b) }
  private onLevel = (k: 'mic' | 'out', v: number) => { if (k === 'mic') this.send({ type: 'level', v }) }

  constructor(private sidecar: Sidecar, private audio: AgentAudio, private notify: (text: string, tone: 'info' | 'error') => void) { super() }

  private send(e: DictationEvent) { dictationBar.send(e) }

  async begin() {
    const v = settings.value.voice
    if (this.active || !v.enabled || !v.dictation) return
    if (!hasKey()) { this.notify('Add your Gemini key in Settings → Voice to dictate.', 'error'); return }
    this.active = true
    this.raw = ''; this.pending = []; this.startedAt = Date.now()
    let rect = { x: 0, y: 0, w: 0, h: 0 }
    try {
      const fi = await this.sidecar.call('text.focusRect', {})
      if (fi.password) { this.active = false; this.notify('I do not dictate into password fields.', 'info'); return }
      this.hwnd = fi.hwnd
      const a = screen.screenToDipPoint({ x: fi.x, y: fi.y })
      const b = screen.screenToDipPoint({ x: fi.x + fi.w, y: fi.y + fi.h })
      const d = screen.getPrimaryDisplay().bounds
      rect = { x: a.x - d.x, y: a.y - d.y, w: b.x - a.x, h: b.y - a.y }
    } catch {
      const d = screen.getPrimaryDisplay().bounds
      rect = { x: d.width / 2 - 200, y: d.height - 140, w: 400, h: 60 }
      this.hwnd = 0
    }
    this.send({ type: 'start', rect })
    this.audio.on('mic', this.onMic)
    this.audio.on('level', this.onLevel)
    try {
      await this.audio.mic(true)
      const key = getKey()!
      const s = new GeminiSession({ key, model: v.model, voice: settings.value.loadout.voice, system: SILENT, tools: [], audio: true })
      s.on('inText', t => { this.raw += t; this.send({ type: 'raw', text: this.raw.trim() }) })
      this.session = s
      await s.connect()
      for (const b of this.pending.splice(0)) s.sendAudio(b)
    } catch (e) {
      await this.abort(`Couldn't start dictation: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async end() {
    if (!this.active) return
    this.audio.off('mic', this.onMic)
    this.audio.mic(false).catch(() => undefined)
    this.audio.off('level', this.onLevel)
    const s = this.session
    if (!s?.connected || Date.now() - this.startedAt < 400) { await this.abort(); return }
    s.audioEnd()
    // the last words of the transcript arrive just after the audio ends: wait until the model starts answering (we ignore it) or 2 s
    await new Promise<void>(res => { const t = setTimeout(res, 2000); s.once('audio', () => { clearTimeout(t); setTimeout(res, 150) }); s.once('turnComplete', () => { clearTimeout(t); res() }) })
    s.close('done')
    this.session = null
    const raw = this.raw.trim()
    if (!raw) { await this.abort('I did not catch anything.'); return }
    const clean = await cleanTranscript(raw)
    this.send({ type: 'clean', text: clean })
    await new Promise(r => setTimeout(r, 900)) // let the bubble finish rewriting itself
    const r = await this.sidecar.call('text.insert', { text: clean, hwnd: this.hwnd }).catch(() => ({ ok: false, reason: 'could not type' }))
    if (r.ok) this.send({ type: 'done' })
    else { clipboard.writeText(clean); this.send({ type: 'error', text: `Copied instead (${r.reason ?? 'could not type'})` }) }
    this.active = false
    dictationBar.closeSoon(r.ok ? 1100 : 2600)
  }

  private async abort(msg?: string) {
    this.audio.off('mic', this.onMic)
    this.audio.off('level', this.onLevel)
    this.audio.mic(false).catch(() => undefined)
    this.session?.close('abort')
    this.session = null
    this.active = false
    this.send(msg ? { type: 'error', text: msg } : { type: 'cancel' })
    dictationBar.closeSoon(msg ? 2200 : 400)
  }
}
