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
  /** produce spoken audio; false = text-only replies */
  audio: boolean
}

export declare interface GeminiSession {
  on(e: 'inText', f: (t: string) => void): this
  on(e: 'outText', f: (t: string) => void): this
  on(e: 'audio', f: (pcm24k: Buffer) => void): this
  on(e: 'toolCall', f: (calls: ToolCall[]) => void): this
  on(e: 'turnComplete', f: () => void): this
  on(e: 'interrupted', f: () => void): this
  on(e: 'closed', f: (reason: string) => void): this
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
      const fail = (m: string) => { if (!settled) { settled = true; reject(new Error(m)) } this.close(m) }
      const timer = setTimeout(() => fail('timed out waiting for the model'), 12_000)
      const ws = new WebSocket(`${URL_BASE}?key=${encodeURIComponent(this.o.key)}`)
      this.ws = ws
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        const model = this.o.model.startsWith('models/') ? this.o.model : `models/${this.o.model}`
        this.send({
          setup: {
            model,
            generationConfig: {
              responseModalities: [this.o.audio ? 'AUDIO' : 'TEXT'],
              ...(this.o.audio ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.o.voice } } } } : {}),
            },
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
        else if (typeof p.text === 'string' && !this.o.audio) this.emit('outText', p.text)
      }
      if (sc.turnComplete) this.emit('turnComplete')
    }
    if (m.toolCall?.functionCalls?.length) {
      this.emit('toolCall', (m.toolCall.functionCalls as ToolCall[]).map(c => ({ id: c.id, name: c.name, args: c.args ?? {} })))
    }
    if (m.goAway) this.emit('closed', 'the server is closing this session')
  }

  private send(o: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o)) }

  sendAudio(pcm16k: Buffer) { if (this.open) this.send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: pcm16k.toString('base64') } } }) }
  audioEnd() { if (this.open) this.send({ realtimeInput: { audioStreamEnd: true } }) }
  sendText(text: string) { if (this.open) this.send({ realtimeInput: { text } }) }
  sendImage(jpeg: Buffer) { if (this.open) this.send({ realtimeInput: { video: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } } }) }
  toolResponse(id: string, name: string, response: Record<string, unknown>) { this.send({ toolResponse: { functionResponses: [{ id, name, response }] } }) }

  close(reason = 'closed') {
    const ws = this.ws
    this.ws = null
    this.open = false
    try { ws?.close(1000, reason.slice(0, 100)) } catch { /* already closed */ }
  }
}
