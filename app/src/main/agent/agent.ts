import { EventEmitter } from 'node:events'
import type { ScheduledTask, VoiceEvent, VoiceInfo, VoiceKind, VoiceState } from '@shared/voice'
import type { Sidecar } from '../sidecar'
import { settings } from '../settings'
import { AgentAudio } from './audio'
import { captionBar } from './overlays'
import { clearKey, getKey, hasKey, setKey } from './keystore'
import { Scheduler } from './scheduler'
import { GeminiSession } from './session'
import { TOOLS, readMemory, runTool, type ToolCtx } from './tools'

// The conversation: push-to-talk -> Gemini Live -> tools -> spoken + written reply. One turn at a time. State changes
// and captions are broadcast as VoiceEvents; the island (soul, held shape, glow) and the caption bar react to them.
const SESSION_IDLE_MS = 60_000
const CLEAR_AFTER_MS = 3200

export class Agent extends EventEmitter {
  readonly audio = new AgentAudio()
  readonly scheduler = new Scheduler()
  private session: GeminiSession | null = null
  private connecting: Promise<GeminiSession> | null = null
  private state: VoiceState = 'idle'
  private kind: VoiceKind = 'assistant'
  private said = ''
  private reply = ''
  private sayShown = false
  private held = false
  private heldAt = 0
  private pending: Buffer[] = []
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private clearTimer: ReturnType<typeof setTimeout> | null = null
  private images: Buffer[] = []
  /** set by the demo runner: no network, no microphone */
  demo = false

  constructor(private sidecar: Sidecar, private broadcast: (e: VoiceEvent) => void) {
    super()
    this.audio.on('mic', b => { if (this.held && this.kind !== 'dictation') this.feed(b) })
    this.audio.on('level', (k, v) => { if ((k === 'mic' && this.state === 'listening') || (k === 'out' && this.state === 'speaking')) this.emit2({ type: 'level', v }) })
    this.audio.on('drained', () => { if (this.state === 'speaking' && this.turnDone) this.finishSpeaking() })
    this.audio.on('fail', m => { this.held = false; this.fail(m) })
    this.scheduler.on('changed', (t: ScheduledTask[]) => this.emit('tasks', t))
    this.scheduler.on('due', (t: ScheduledTask) => void this.runTask(t))
    this.scheduler.on('missed', (t: ScheduledTask) => this.notice(`I missed "${t.title}" while your PC was off.`, 'info'))
  }

  private turnDone = false

  /** a turn is in progress (dictation and the assistant never overlap) */
  get busy() { return this.state !== 'idle' }

  info(): VoiceInfo { return { hasKey: hasKey(), state: this.state, tasks: this.scheduler.list() } }
  setKey(k: string) { const ok = setKey(k); this.emit('info'); return ok }
  clearKey() { clearKey(); this.closeSession(); this.emit('info') }

  // ---- output ------------------------------------------------------------------------------------------------
  emit2(e: VoiceEvent) { this.broadcast(e) }
  setState(s: VoiceState) {
    if (this.state === s) return
    this.state = s
    this.emit2({ type: 'state', state: s, kind: this.kind })
  }
  caption(kind: 'said' | 'reply' | 'notice', text: string, tone: 'info' | 'error' = 'info') {
    if (this.clearTimer) { clearTimeout(this.clearTimer); this.clearTimer = null }
    captionBar.send({ kind, text, tone, label: kind === 'said' ? 'You' : 'Lokey' })
  }
  clearSoon(ms = CLEAR_AFTER_MS) {
    if (this.clearTimer) clearTimeout(this.clearTimer)
    this.clearTimer = setTimeout(() => { captionBar.send({ kind: 'clear' }); captionBar.closeSoon(700); this.emit2({ type: 'clear' }) }, ms)
    this.clearTimer.unref?.()
  }
  notice(text: string, tone: 'info' | 'error' = 'info') {
    this.caption('notice', text, tone)
    this.emit2({ type: 'notice', text, tone })
    if (tone === 'error') this.emit2({ type: 'mascot', play: 'shrug' })
    this.clearSoon(tone === 'error' ? 5200 : CLEAR_AFTER_MS)
  }
  private fail(m: string) {
    this.setState('error')
    this.notice(m, 'error')
    setTimeout(() => this.setState('idle'), 1200)
  }

  // ---- session ---------------------------------------------------------------------------------------------------
  private system(): string {
    const lo = settings.value.loadout
    const p = lo.personalities.find(x => x.id === lo.personality) ?? lo.personalities[0]
    const mem = readMemory()
    const now = new Date()
    return [
      `You are ${p?.name ?? 'Lokey'}, a voice assistant living in the notch of the user's Windows PC. ${p?.prompt ?? ''}`.trim(),
      'Speak in one or two short sentences. Do things with your tools instead of explaining how.',
      'If the user names a time or delay ("at 7", "in half an hour", "an hour later"), call schedule with the actions as steps instead of doing them now; do the parts that are meant to happen now immediately.',
      'If the user circled something on screen, two images are attached: first the whole screen for context, then a zoomed crop of exactly the region they circled. Answer about, or act on, the circled thing (for example open its store page or search for it).',
      `It is ${now.toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} local time.`,
      mem.length ? `Facts you know about the user: ${mem.join('; ')}.` : '',
    ].filter(Boolean).join('\n')
  }

  private ensureSession(): Promise<GeminiSession> {
    if (this.session?.connected) return Promise.resolve(this.session)
    if (this.connecting) return this.connecting
    const key = getKey()
    if (!key) return Promise.reject(new Error('NOKEY'))
    const v = settings.value.voice
    const s = new GeminiSession({ key, model: v.model, voice: settings.value.loadout.voice, system: this.system(), tools: TOOLS, audio: v.speakReplies })
    s.on('inText', t => this.onSaid(t))
    s.on('outText', t => this.onReply(t))
    s.on('audio', b => this.onAudio(b))
    s.on('toolCall', calls => void this.onTools(s, calls))
    s.on('turnComplete', () => this.onTurnComplete())
    s.on('interrupted', () => this.audio.flush())
    s.on('closed', r => { if (this.session === s) this.session = null; if (this.state !== 'idle') this.fail(`Lost the connection (${r}).`) })
    this.connecting = s.connect().then(() => { this.session = s; return s }).finally(() => { this.connecting = null })
    return this.connecting
  }

  private closeSession() {
    this.session?.close('idle')
    this.session = null
    this.audio.destroy()
  }

  private touchIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { if (this.state === 'idle') this.closeSession() }, SESSION_IDLE_MS)
    this.idleTimer.unref?.()
  }

  private feed(b: Buffer) {
    if (this.session?.connected) this.session.sendAudio(b)
    else if (this.pending.length < 80) this.pending.push(b) // ~5 s buffered while connecting
  }

  // ---- a turn -----------------------------------------------------------------------------------------------------
  /** push-to-talk down. `image` (lasso) is attached when the turn ends. */
  async begin(kind: 'assistant' | 'lasso' = 'assistant') {
    if (!settings.value.voice.enabled) return
    if (!hasKey()) { this.notice('Add your Gemini key in Settings → Voice to talk to me.', 'error'); return }
    if (this.state === 'speaking' || this.state === 'thinking') { this.audio.flush(); this.session?.close('barge-in'); this.session = null }
    this.kind = kind
    this.held = true
    this.heldAt = Date.now()
    this.said = ''; this.reply = ''; this.sayShown = false; this.turnDone = false; this.images = []; this.pending = []
    if (this.clearTimer) { clearTimeout(this.clearTimer); this.clearTimer = null }
    this.setState('listening')
    try {
      await this.audio.mic(true)
      const s = await this.ensureSession()
      for (const b of this.pending.splice(0)) s.sendAudio(b)
    } catch (e) {
      this.held = false
      this.audio.mic(false).catch(() => undefined)
      const m = e instanceof Error ? e.message : String(e)
      if (m === 'NOKEY') this.notice('Add your Gemini key in Settings → Voice to talk to me.', 'error')
      else if (/API key|permission|403|401/i.test(m)) this.fail('Google rejected that API key.')
      else this.fail(`Couldn't reach Gemini: ${m}`)
    }
  }

  /** screenshots to attach to this turn (lasso): [whole screen, circled region] */
  setImages(jpegs: Buffer[]) { this.images = jpegs }

  /** push-to-talk up */
  async end() {
    if (!this.held) return
    this.held = false
    this.audio.mic(false).catch(() => undefined)
    const quick = Date.now() - this.heldAt < 350 && !this.said
    const s = this.session
    if (!s?.connected || quick) { this.setState('idle'); this.emit2({ type: 'clear' }); captionBar.send({ kind: 'clear' }); return }
    for (const im of this.images.splice(0)) s.sendImage(im)
    s.audioEnd()
    this.setState('thinking')
    this.touchIdle()
  }

  /** typed request instead of speech */
  async say(text: string, kind: 'assistant' | 'lasso' = 'assistant') {
    const t = text.trim()
    if (!t) return
    if (!hasKey()) { this.notice('Add your Gemini key in Settings → Voice first.', 'error'); return }
    this.kind = kind
    this.said = t; this.reply = ''; this.sayShown = false; this.turnDone = false
    this.caption('said', t)
    this.setState('thinking')
    try {
      const s = await this.ensureSession()
      for (const im of this.images.splice(0)) s.sendImage(im)
      s.sendText(t)
    } catch (e) { this.fail(`Couldn't reach Gemini: ${e instanceof Error ? e.message : String(e)}`) }
  }

  private onSaid(t: string) {
    this.said += t
    this.caption('said', this.said.trim())
    this.emit2({ type: 'said', text: this.said.trim(), final: false })
  }

  private onReply(t: string) {
    if (this.sayShown) { this.reply = ''; this.sayShown = false }
    if (this.state !== 'speaking') this.setState('speaking')
    this.reply += t
    this.caption('reply', this.reply.trim())
    this.emit2({ type: 'reply', text: this.reply.trim(), final: false })
  }

  private onAudio(b: Buffer) {
    if (this.state !== 'speaking') this.setState('speaking')
    if (settings.value.voice.speakReplies) void this.audio.play(b)
  }

  private async onTools(s: GeminiSession, calls: { id: string; name: string; args: Record<string, unknown> }[]) {
    const ctx: ToolCtx = { sidecar: this.sidecar, scheduler: this.scheduler, abilities: settings.value.loadout.abilities }
    for (const c of calls) {
      try {
        const r = await runTool(c.name, c.args, ctx)
        if (r.say) {
          this.reply = r.say; this.sayShown = true
          this.caption('reply', r.say)
          this.emit2({ type: 'reply', text: r.say, final: false })
        }
        const ok = (r.result as { ok?: boolean }).ok !== false
        this.emit2({ type: 'mascot', play: ok ? (c.name === 'schedule' ? 'nod' : 'bounce') : 'shrug', emote: c.name === 'schedule' ? 'clock' : ok ? 'success' : 'sweat' })
        s.toolResponse(c.id, c.name, r.result)
      } catch (e) {
        s.toolResponse(c.id, c.name, { ok: false, error: e instanceof Error ? e.message : String(e) })
        this.emit2({ type: 'mascot', play: 'shrug', emote: 'sweat' })
      }
    }
  }

  private onTurnComplete() {
    this.turnDone = true
    this.emit2({ type: 'said', text: this.said.trim(), final: true })
    this.emit2({ type: 'reply', text: this.reply.trim(), final: true })
    // wait for the speaker to drain; if nothing was spoken, finish now
    if (!settings.value.voice.speakReplies || this.state !== 'speaking') this.finishSpeaking()
    else setTimeout(() => { if (this.state === 'speaking') this.finishSpeaking() }, 20_000).unref?.()
  }

  private finishSpeaking() {
    this.setState('idle')
    this.emit2({ type: 'mascot', play: 'celebrate' })
    this.clearSoon()
    this.touchIdle()
  }

  // ---- scheduled tasks ----------------------------------------------------------------------------------------
  private async runTask(t: ScheduledTask) {
    const ctx: ToolCtx = { sidecar: this.sidecar, scheduler: this.scheduler, abilities: settings.value.loadout.abilities }
    for (const st of t.steps) { try { await runTool(st.tool, st.args, ctx) } catch { /* the caption below still tells the user */ } }
    this.caption('reply', t.say)
    this.emit2({ type: 'reply', text: t.say, final: true })
    this.emit2({ type: 'mascot', play: 'wave', emote: 'success' })
    this.clearSoon()
  }

  start() { this.scheduler.load().arm() }
  dispose() { this.scheduler.dispose(); this.closeSession() }
}
