// Lokey Link, phone side: pairs this phone with a Lokey on a PC (see main/link/server.ts for the PC API), keeps the live event stream, sends
// typed requests ("ask the PC"), answers the PC's confirm cards from the phone and syncs memory both ways. The PC applies its own limits to
// anything coming from a phone: never full control, no earned trust, no settings changes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { dataDir } from '../main/settings'
import { clearSecret, getSecret, setSecret } from '../main/agent/keystore'
import { memory } from '../main/brain/memory'
import type { FactKind } from '@shared/memory'

const file = join(dataDir, 'linkclient.json')
const SECRET = 'linkpc'
const DEFAULT_PORT = 47831

interface Saved { url: string; id: string; name: string; pairedAt: number; lastSync: number }
export interface PcStatus { pc: string; agent: string; battery?: unknown; nowPlaying?: { app: string; title: string; artist: string; playing: boolean } | null; jobs?: string[] }
export interface Credentials { base: string; token: string }
export interface LinkEvent { type: 'confirm' | 'confirm-done' | 'job' | 'nudge' | 'connected' | 'disconnected' | 'revoked'; data?: unknown }

/** "192.168.1.20", "192.168.1.20:47831" or a full http:// address -> a clean base URL (no trailing slash) */
export function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u
  if (!/:\d+$/.test(u.replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))) u = u.replace(/^(https?:\/\/[^/]+)/i, `$1:${DEFAULT_PORT}`)
  return u
}

// a paired PC is on the user's own network: private addresses only (the PC enforces the same on its side)
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?(::1|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:))/i
export const isPrivateHost = (url: string) => { try { return PRIVATE.test(new URL(url).hostname) || /\.local$/i.test(new URL(url).hostname) } catch { return false } }

const rawFetch = (): typeof fetch => ((globalThis as unknown as { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch ?? fetch).bind(globalThis)

export class LinkClient extends EventEmitter {
  private saved: Saved | null = null
  private abort: AbortController | null = null
  private loop = false
  connected = false
  lastError = ''
  /** confirm cards of the PC the user has not answered yet, and ones already answered (here or by the native link): never answered twice */
  private cards = new Map<string, unknown>()
  private answered = new Set<string>()
  private gen = 0
  private stale: Set<string> | null = null

  load() {
    try { this.saved = JSON.parse(readFileSync(file, 'utf8')) as Saved } catch { this.saved = null }
    if (this.saved && !getSecret(SECRET)) this.saved = null
    return this
  }
  private save() { try { mkdirSync(dataDir, { recursive: true }); if (this.saved) writeFileSync(file, JSON.stringify(this.saved)) } catch { /* kept in memory */ } }

  get paired() { return !!this.saved }
  /** what the native link client needs to keep the PC link alive in the background (null = unpaired); also emitted as 'credentials' */
  credentials(): Credentials | null { const t = getSecret(SECRET); return this.saved && t ? { base: this.saved.url, token: t } : null }
  get url() { return this.saved?.url ?? null }
  get name() { return this.saved?.name ?? '' }

  /** what Settings > Devices shows in client mode: the paired PC as the one "device" */
  state() {
    const s = this.saved
    return {
      enabled: !!s, running: this.connected, port: s ? Number(new URL(s.url).port) || DEFAULT_PORT : DEFAULT_PORT, url: s?.url ?? null, pairing: false,
      devices: s ? [{ id: s.id, name: s.name || 'PC', scopes: ['agent', 'view', 'notify'], created: s.pairedAt, lastSeen: this.connected ? Date.now() : 0 }] : [],
    }
  }

  private async http<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = true, timeoutMs = 10_000, base = this.saved?.url): Promise<{ status: number; json: T }> {
    if (!base) throw new Error('no PC paired')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth) headers.Authorization = `Bearer ${getSecret(SECRET) ?? ''}`
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    let json = {} as T
    try { json = (await r.json()) as T } catch { /* empty body */ }
    return { status: r.status, json }
  }

  /** pair with the code shown in Lokey on the PC (Settings > Devices > "Pair a phone") */
  async pair(rawUrl: string, code: string, deviceName = 'Phone'): Promise<{ ok: boolean; error?: string }> {
    const url = normalizeUrl(rawUrl)
    if (!isPrivateHost(url)) return { ok: false, error: 'that is not an address on your own network' }
    if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: 'the code has 6 digits' }
    try {
      const r = await this.http<{ id?: string; token?: string; error?: string }>('POST', '/pair', { code: code.trim(), name: deviceName }, false, 10_000, url)
      if (r.status !== 200 || !r.json.token || !r.json.id) return { ok: false, error: r.status === 403 ? 'wrong or expired code' : r.status === 429 ? 'too many tries, wait a moment' : r.json.error ?? `the PC answered ${r.status}` }
      if (!setSecret(SECRET, r.json.token)) return { ok: false, error: 'could not store the pairing key' }
      this.saved = { url, id: r.json.id, name: new URL(url).hostname, pairedAt: Date.now(), lastSync: 0 }
      this.save()
      this.emit('credentials', this.credentials())
      this.connect()
      void this.sync().catch(() => undefined)
      return { ok: true }
    } catch (e) { return { ok: false, error: `could not reach ${new URL(url).host}: ${e instanceof Error ? e.message : String(e)}` } }
  }

  unpair() {
    this.stop()
    this.saved = null
    clearSecret(SECRET)
    try { writeFileSync(file, '') } catch { /* nothing to remove */ }
    this.cards.clear()
    this.emit('credentials', null)
    this.emit('event', { type: 'revoked' } satisfies LinkEvent)
    return true
  }

  // ---- requests ------------------------------------------------------------------------------------------------------------------------
  async status(): Promise<PcStatus | null> {
    try { const r = await this.http<PcStatus>('GET', '/status'); this.checkAuth(r.status); return r.status === 200 ? r.json : null } catch (e) { this.lastError = String(e); return null }
  }
  /** type a request to the PC's assistant (it runs there with phone limits); false when it is busy or unreachable */
  async say(text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await this.http<{ ok?: boolean; error?: string }>('POST', '/say', { text })
      this.checkAuth(r.status)
      return r.status === 200 ? { ok: true } : { ok: false, error: r.status === 409 ? 'the PC assistant is busy right now' : r.json.error ?? `the PC answered ${r.status}` }
    } catch (e) { return { ok: false, error: `PC not reachable: ${e instanceof Error ? e.message : String(e)}` } }
  }
  async approve(id: string, allow: boolean): Promise<boolean> {
    if (this.answered.has(id)) return false // already answered (here, on the PC, or by the native link's notification buttons)
    try {
      const r = await this.http('POST', '/approve', { id, allow })
      this.checkAuth(r.status)
      if (r.status === 200 || r.status === 404) this.settle(id)
      return r.status === 200
    } catch { return false }
  }
  /** a card is finished: forget it and tell the UI to drop it */
  private settle(id: string) { this.answered.add(id); if (this.answered.size > 200) this.answered.delete(this.answered.values().next().value as string); if (this.cards.delete(id)) this.emit('event', { type: 'confirm-done', data: { id } } satisfies LinkEvent) }
  async recall(q: string): Promise<unknown[]> {
    try { const r = await this.http<unknown[]>('GET', `/memory/search?q=${encodeURIComponent(q)}`); return r.status === 200 && Array.isArray(r.json) ? r.json : [] } catch { return [] }
  }

  /** memory sync both ways through /sync/facts; duplicates merge in the memory engine on each side */
  async sync(): Promise<{ pulled: number; pushed: number }> {
    if (!this.saved) throw new Error('no PC paired')
    const since = this.saved.lastSync
    const pulledList = await this.http<{ facts?: { text: string; kind: string; pinned: boolean; updated: number }[] }>('GET', '/sync/facts')
    this.checkAuth(pulledList.status)
    let pulled = 0
    const kinds = ['preference', 'fact', 'person', 'project', 'routine', 'place', 'other']
    for (const f of pulledList.json.facts ?? []) {
      if (typeof f.text !== 'string' || f.text.length < 3) continue
      const r = await memory.add(f.text.slice(0, 300), { source: 'pc', kind: (kinds.includes(f.kind) ? f.kind : 'fact') as FactKind, pinned: !!f.pinned })
      if (r && !r.existing) pulled++
    }
    // what this phone knows (learned here, newer than the last sync), newest first; the PC accepts 200 at a time
    const mine = memory.list().filter(f => f.source !== 'pc' && f.updated > since).slice(0, 200).map(f => ({ text: f.text, kind: f.kind }))
    let pushed = 0
    if (mine.length) {
      const r = await this.http<{ added?: number }>('POST', '/sync/facts', { facts: mine })
      this.checkAuth(r.status)
      pushed = r.json.added ?? 0
    }
    this.saved.lastSync = Date.now(); this.save()
    return { pulled, pushed }
  }

  private checkAuth(status: number) { if (status === 401 && this.saved) this.unpair() } // the PC revoked this phone

  // ---- the live stream (Server-Sent Events) ----------------------------------------------------------------------------------------------
  connect() {
    if (this.loop || !this.saved) return
    this.loop = true
    void this.run(++this.gen)
  }
  stop() { this.loop = false; this.gen++; this.abort?.abort(); this.abort = null; this.setConnected(false) }
  /** the page is back in front: the native link may have handled approvals meanwhile. Reconnect now; the PC re-sends what is still pending as the
   *  stream's first message, and any card it does not re-send was answered elsewhere and is dropped (never answered twice). */
  resync() {
    if (!this.saved) return
    this.stale = new Set(this.cards.keys())
    this.stop(); this.connect()
    setTimeout(() => { const s = this.stale; this.stale = null; for (const id of s ?? []) this.settle(id) }, 2500)
  }
  private setConnected(on: boolean) { if (this.connected !== on) { this.connected = on; this.emit('event', { type: on ? 'connected' : 'disconnected' } satisfies LinkEvent) } }

  private async run(gen: number) {
    let wait = 3000
    while (this.loop && this.saved && gen === this.gen) {
      this.abort = new AbortController()
      try {
        // the unpatched fetch: Capacitor's native HTTP layer would buffer the whole response and never deliver an open stream
        const r = await rawFetch()(this.saved.url + '/events', { headers: { Authorization: `Bearer ${getSecret(SECRET) ?? ''}`, Accept: 'text/event-stream' }, signal: this.abort.signal })
        if (r.status === 401) { this.unpair(); return }
        if (!r.ok || !r.body) throw new Error(`events ${r.status}`)
        this.setConnected(true); wait = 3000
        const reader = r.body.getReader(), dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i: number
          while ((i = buf.indexOf('\n\n')) >= 0) { this.onFrame(buf.slice(0, i)); buf = buf.slice(i + 2) }
        }
      } catch (e) { if (!this.loop || gen !== this.gen) return; this.lastError = e instanceof Error ? e.message : String(e) }
      this.setConnected(false)
      if (!this.loop || gen !== this.gen) return
      // no live stream (blocked by the WebView, PC asleep): a plain request still tells whether the PC is reachable, so the UI shows the truth
      if (await this.status()) this.setConnected(true)
      await new Promise(res => setTimeout(res, wait))
      this.setConnected(false)
      wait = Math.min(wait * 2, 30_000)
    }
  }

  private onFrame(frame: string) {
    let type = 'message', data = ''
    for (const l of frame.split('\n')) { if (l.startsWith('event:')) type = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim() }
    if (!data || !/^(confirm|confirm-done|job|nudge)$/.test(type)) return
    let parsed: unknown
    try { parsed = JSON.parse(data) } catch { return }
    const id = String((parsed as { id?: unknown } | null)?.id ?? '')
    if (type === 'confirm') { if (this.answered.has(id)) return; this.stale?.delete(id); this.cards.set(id, parsed) }
    else if (type === 'confirm-done') { this.answered.add(id); this.cards.delete(id) }
    this.emit('event', { type, data: parsed } as LinkEvent)
  }
}

export const linkClient = new LinkClient()
