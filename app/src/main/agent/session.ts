import { EventEmitter } from 'node:events'

// One Gemini Live conversation over a raw WebSocket (no SDK). Wire format: setup first, wait for setupComplete, then
// realtimeInput (audio/image/text) in and serverContent/toolCall out. Audio in = 16 kHz PCM16, out = 24 kHz PCM16.
const URL_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

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
}

export declare interface GeminiSession {
  on(e: 'inText', f: (t: string) => void): this
  on(e: 'outText', f: (t: string) => void): this
  on(e: 'audio', f: (pcm24k: Buffer) => void): this
  on(e: 'toolCall', f: (calls: ToolCall[]) => void): this
  on(e: 'turnComplete', f: () => void): this
  on(e: 'interrupted', f: () => void): this
  on(e: 'closed', f: (reason: string) => void): this
  on(e: 'handle', f: (h: string) => void): this
  on(e: 'goAway', f: () => void): this
}

export class GeminiSession extends EventEmitter {
  private ws: WebSocket | null = null
  private open = false

  constructor(private o: SessionOptions) { super() }

  get connected() { return this.open }

  /** Resolves after `setupComplete`; rejects on a socket error, a refusal or after 12 s. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (m: string) => { const was = this.open; if (!settled) { settled = true; reject(new Error(m)) } this.close(m); if (was) this.emit('closed', m) } // a socket error on a live session is a close too
      const timer = setTimeout(() => fail('timed out waiting for the model'), 12_000)
      const ws = new WebSocket(`${URL_BASE}?key=${encodeURIComponent(this.o.key)}`)
      this.ws = ws
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        const model = this.o.model.startsWith('models/') ? this.o.model : `models/${this.o.model}`
        this.send({
          setup: {
            model,
            // native-audio models only answer in AUDIO; "captions only" just means we do not play it
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.o.voice } } } },
            sessionResumption: this.o.resume ? { handle: this.o.resume } : {},
            contextWindowCompression: { slidingWindow: {} },
            ...(this.o.manual ? { realtimeInputConfig: { automaticActivityDetection: { disabled: true }, activityHandling: 'START_OF_ACTIVITY_INTERRUPTS', turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY' } } : {}),
            systemInstruction: { parts: [{ text: this.o.system }] },
            tools: this.o.tools.length ? [{ functionDeclarations: this.o.tools }] : undefined,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
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
        if (m.setupComplete) { this.open = true; if (!settled) { settled = true; clearTimeout(timer); resolve() } return }
        this.handle(m)
      }
      ws.onerror = () => fail('connection error')
      ws.onclose = ev => {
        clearTimeout(timer)
        const was = this.open
        this.open = false
        this.ws = null
        if (!settled) { settled = true; reject(new Error(ev.reason || `closed before setup (code ${ev.code})`)) }
        else if (was) this.emit('closed', ev.reason || `closed (code ${ev.code})`)
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
        if (p.inlineData?.data && String(p.inlineData.mimeType ?? '').startsWith('audio/')) this.emit('audio', Buffer.from(p.inlineData.data, 'base64'))
      }
      if (sc.turnComplete) this.emit('turnComplete')
    }
    if (m.toolCall?.functionCalls?.length) {
      this.emit('toolCall', (m.toolCall.functionCalls as ToolCall[]).map(c => ({ id: c.id, name: c.name, args: c.args ?? {} })))
    }
    if (m.sessionResumptionUpdate?.newHandle) this.emit('handle', String(m.sessionResumptionUpdate.newHandle))
    // the server will close this connection soon: finish the current turn, reconnect (with the handle) for the next one
    if (m.goAway) this.emit('goAway')
  }

  private send(o: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)) }

  sendAudio(pcm16k: Buffer) { if (this.open) this.send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: pcm16k.toString('base64') } } }) }
  /** push-to-talk down / up (the model only answers after activityEnd) */
  activityStart() { if (this.open && this.o.manual) this.send({ realtimeInput: { activityStart: {} } }) }
  /** without manual turns (server-side voice detection) the end of the audio stream is the closest thing to a release */
  activityEnd() { if (this.open) this.send({ realtimeInput: this.o.manual ? { activityEnd: {} } : { audioStreamEnd: true } }) }
  /** a typed turn. Newer Live models take text only as realtime input (client content is for seeding history), and with manual turns
   *  a message is a turn only between activityStart and activityEnd. */
  sendText(text: string) {
    if (!this.open) return
    if (this.o.manual) this.send({ realtimeInput: { activityStart: {} } })
    this.send({ realtimeInput: { text } })
    if (this.o.manual) this.send({ realtimeInput: { activityEnd: {} } })
  }
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
