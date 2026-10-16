import { EventEmitter } from 'node:events'
import { AiError, type AiKind } from '../errors'

// One Gemini Live conversation over a raw WebSocket (no SDK). Wire format: setup first, wait for setupComplete, then
// realtimeInput (audio/image/text) in and serverContent/toolCall out. Audio in = 16 kHz PCM16, out = 24 kHz PCM16.
export const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

export interface FunctionDecl { name: string; description: string; parameters?: Record<string, unknown> }
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }

export interface SessionOptions {
  key: string
  model: string
  voice: string
  system: string
  tools: FunctionDecl[]
  /** push-to-talk: the server's own voice detection is off; the client marks where speech starts and ends */
  manual?: boolean
  /** a resumption handle from an earlier connection: the server restores that conversation's context */
  resume?: string
  /** tests: a local mock server instead of Google */
  url?: string
  /** `--livetest` bisecting: leave out the optional setup fields (compression, transcription, resumption) */
  minimal?: boolean
}

/**
 * What a WebSocket close code (and the reason text Google puts in it) means. `kind` null = a normal end. 1007 means Google refused what we sent
 * (never retry it the same way); 1008 is a policy refusal (key, quota); 1011 and the network codes are worth reconnecting for.
 */
export function classifyClose(code: number, reason: string): { kind: AiKind | null; recoverable: boolean } {
  if (/exceeded your current quota|quota|resource.?exhausted|rate limit/i.test(reason)) return { kind: /per ?day|daily/i.test(reason) ? 'QUOTA_DAY' : 'RATE_MINUTE', recoverable: false }
  if (code === 1000 || code === 1005 && !reason) return { kind: null, recoverable: true }
  if (code === 1007) return { kind: 'BAD_REQUEST', recoverable: false }
  if (code === 1008) return /api key|permission|credential|unauthori|auth/i.test(reason) ? { kind: 'AUTH', recoverable: false } : { kind: 'BAD_REQUEST', recoverable: false }
  if (code === 1006) return { kind: 'NETWORK', recoverable: true }
  return { kind: 'OVERLOADED', recoverable: true }   // 1011, 1001, 1012, 1013...
}

export declare interface GeminiSession {
  on(e: 'inText', f: (t: string) => void): this
  on(e: 'outText', f: (t: string) => void): this
  on(e: 'audio', f: (pcm24k: Buffer) => void): this
  on(e: 'toolCall', f: (calls: ToolCall[]) => void): this
  on(e: 'turnComplete', f: () => void): this
  on(e: 'interrupted', f: () => void): this
  on(e: 'closed', f: (reason: string, code: number, kind: AiKind | null) => void): this
  on(e: 'rx', f: () => void): this
  on(e: 'handle', f: (h: string) => void): this
  on(e: 'goAway', f: (timeLeftMs: number) => void): this
}

export class GeminiSession extends EventEmitter {
  private ws: WebSocket | null = null
  private open = false
  /** metering: seconds of audio sent and received, and when the session came up */
  audioInSec = 0
  audioOutSec = 0
  openedAt = 0
  resumed = false
  private done: Promise<void> = Promise.resolve()
  private doneRes: (() => void) | null = null
  /** resolves when this session's socket is really closed (or after `ms`): a new connect waits for it, because the server refuses a second socket while the first is still open ("session is already connected to an existing client") */
  whenClosed(ms = 1500): Promise<void> { return Promise.race([this.done, new Promise<void>(r => { const t = setTimeout(r, ms); t.unref?.() })]) }

  // What was sent and received, as TYPES with sizes and time offsets only (never audio, text, prompts or keys), kept so that a close with an
  // error can say what led up to it (main.log + the notice).
  private t0 = 0
  private out: { label: string; at: number; n: number; bytes: number }[] = []
  private inn: string[] = []
  private note(label: string, bytes: number) {
    const at = Date.now() - this.t0, last = this.out[this.out.length - 1]
    if (last && last.label === label && label.endsWith('.audio')) { last.n++; last.bytes += bytes; return }
    this.out.push({ label, at, n: 1, bytes }); if (this.out.length > 8) this.out.shift()
  }
  /** "sent: setup +0ms (tools 16, system 2314 chars) | realtimeInput.activityStart +310ms | realtimeInput.audio x44 (1.4 MB) +311ms | ... ; got: setupComplete, sessionResumptionUpdate" */
  diagnostics(): string {
    const f = (e: { label: string; at: number; n: number; bytes: number }) => `${e.label}${e.n > 1 ? ` x${e.n}` : ''} (${e.bytes > 1024 ? Math.round(e.bytes / 1024) + ' KB' : e.bytes + ' B'}) +${e.at}ms`
    return `sent: ${this.out.map(f).join(' | ') || 'nothing'}; got: ${this.inn.join(', ') || 'nothing'}`
  }

  constructor(private o: SessionOptions) { super() }

  get connected() { return this.open }

  /** Resolves after `setupComplete`; rejects on a socket error, a refusal or after 12 s. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      this.done = new Promise<void>(r => { this.doneRes = r })
      const fail = (m: string, kind: AiKind = 'NETWORK') => { const was = this.open; if (!settled) { settled = true; reject(new AiError(kind, m)) } this.close(m); if (was) this.emit('closed', m, 1006, kind) } // a socket error on a live session is a close too
      const timer = setTimeout(() => fail('timed out waiting for the model', 'TIMEOUT'), 12_000)
      const ws = new WebSocket(`${this.o.url ?? LIVE_URL}?key=${encodeURIComponent(this.o.key)}`)
      this.ws = ws
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        this.t0 = Date.now()
        const model = this.o.model.startsWith('models/') ? this.o.model : `models/${this.o.model}`
        this.send({
          setup: {
            model,
            // native-audio models only answer in AUDIO; "captions only" just means we do not play it
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.o.voice } } } },
            ...(this.o.minimal ? {} : { sessionResumption: this.o.resume ? { handle: this.o.resume } : {}, contextWindowCompression: { slidingWindow: {} } }),
            ...(this.o.manual ? { realtimeInputConfig: { automaticActivityDetection: { disabled: true }, activityHandling: 'START_OF_ACTIVITY_INTERRUPTS', turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY' } } : {}),
            systemInstruction: { parts: [{ text: this.o.system }] },
            tools: this.o.tools.length ? [{ functionDeclarations: this.o.tools }] : undefined,
            ...(this.o.minimal ? {} : { inputAudioTranscription: {}, outputAudioTranscription: {} }),
          },
        })
      }
      ws.onmessage = async ev => {
        let text: string
        const d = ev.data as unknown
        if (typeof d === 'string') text = d
        else if (d instanceof ArrayBuffer) text = Buffer.from(d).toString('utf8')
        else if (typeof Blob !== 'undefined' && d instanceof Blob) text = await d.text()
        else return
        let m: Record<string, any>
        try { m = JSON.parse(text) } catch { return }
        this.emit('rx')
        { const k = Object.keys(m).find(x => x !== 'usageMetadata') ?? '?'; const sub = m.serverContent ? Object.keys(m.serverContent).filter(x => x !== 'modelTurn').concat(m.serverContent.modelTurn ? ['modelTurn'] : []).join('+') : ''; const tag = sub ? `${k}.${sub}` : k; if (this.inn[this.inn.length - 1] !== tag) { this.inn.push(tag); if (this.inn.length > 6) this.inn.shift() } }
        if (m.setupComplete) { this.open = true; this.openedAt = Date.now(); this.resumed = !!this.o.resume; if (!settled) { settled = true; clearTimeout(timer); resolve() } return }
        this.handle(m)
      }
      ws.onerror = () => fail('connection error')
      ws.onclose = ev => {
        clearTimeout(timer)
        this.doneRes?.()
        const was = this.open
        this.open = false
        this.ws = null
        const c = classifyClose(ev.code, ev.reason ?? '')
        if (!settled) { settled = true; reject(new AiError(c.kind ?? 'NETWORK', ev.reason || `closed before setup (code ${ev.code})`, ev.code)) }
        else if (was) this.emit('closed', ev.reason || `closed (code ${ev.code})`, ev.code, c.kind)
      }
    })
  }

  private handle(m: Record<string, any>) {
    const sc = m.serverContent
    if (sc) {
      if (sc.interrupted) this.emit('interrupted')
      if (sc.inputTranscription?.text) this.emit('inText', String(sc.inputTranscription.text))
      if (sc.outputTranscription?.text) this.emit('outText', String(sc.outputTranscription.text))
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data && String(p.inlineData.mimeType ?? '').startsWith('audio/')) { const b = Buffer.from(p.inlineData.data, 'base64'); this.audioOutSec += b.length / 48000; this.emit('audio', b) }
      }
      if (sc.turnComplete) this.emit('turnComplete')
    }
    if (m.toolCall?.functionCalls?.length) {
      this.emit('toolCall', (m.toolCall.functionCalls as ToolCall[]).map(c => ({ id: c.id, name: c.name, args: c.args ?? {} })))
    }
    if (m.sessionResumptionUpdate?.newHandle) this.emit('handle', String(m.sessionResumptionUpdate.newHandle))
    // the server will close this connection soon: finish the current turn, reconnect (with the handle) for the next one
    if (m.goAway) { const t = /([\d.]+)s/.exec(String(m.goAway.timeLeft ?? '')); this.emit('goAway', t ? Number(t[1]) * 1000 : 0) }
  }

  private send(o: unknown) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const json = JSON.stringify(o)
    const top = Object.keys(o as object)[0] ?? '?'
    const m = o as Record<string, any>
    const label = top === 'setup' ? `setup (tools ${m.setup?.tools?.[0]?.functionDeclarations?.length ?? 0}, system ${String(m.setup?.systemInstruction?.parts?.[0]?.text ?? '').length} chars, ${m.setup?.realtimeInputConfig ? 'manual turns' : 'server turns'}${m.setup?.sessionResumption?.handle ? ', resumed' : ''})`
      : top === 'realtimeInput' ? `realtimeInput.${Object.keys(m.realtimeInput)[0]}` : top
    this.note(label, json.length)
    this.ws.send(json)
  }

  sendAudio(pcm16k: Buffer) { if (this.open) this.audioInSec += pcm16k.length / 32000; if (this.open) this.send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: pcm16k.toString('base64') } } }) }
  /** push-to-talk down / up (the model only answers after activityEnd) */
  activityStart() { if (this.open && this.o.manual) this.send({ realtimeInput: { activityStart: {} } }) }
  /** without manual turns (server-side voice detection) the end of the audio stream is the closest thing to a release */
  activityEnd() { if (this.open) this.send({ realtimeInput: this.o.manual ? { activityEnd: {} } : { audioStreamEnd: true } }) }
  /**
   * A typed turn: `realtimeInput.text` on its own, in every mode. (Found with `--livetest` against gemini-3.8-live: wrapping the text in
   * activityStart / activityEnd, which 0.5.1 to 0.8.2 did when manual turns were on, is an activity with no audio in it, and the server closes
   * the session with 1007 "Precondition check failed". The text alone is a complete turn and is answered.)
   */
  sendText(text: string) { if (this.open) this.send({ realtimeInput: { text } }) }
  /** a typed turn as client content (a complete user turn; no activity messages) */
  sendClientText(text: string) { if (this.open) this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }) }
  /** a line of text inside the current turn (what the pictures show) */
  sendNote(text: string) { if (this.open) this.send({ realtimeInput: { text } }) }
  sendImage(jpeg: Buffer) { if (this.open) this.send({ realtimeInput: { video: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } } }) }
  toolResponse(id: string, name: string, response: Record<string, unknown>) { this.send({ toolResponse: { functionResponses: [{ id, name, response }] } }) }

  close(reason = 'closed') {
    const ws = this.ws
    this.ws = null
    this.open = false
    try { ws?.close(1000, reason.slice(0, 100)) } catch { /* already closed */ }
  }
}
