// Microphone capture off the main thread: 16 kHz mono float input -> PCM16 chunks of 512 samples (32 ms) + a 0..1 level, only while `on`.
class LokeyMic extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Int16Array(512); this.n = 0; this.sum = 0; this.on = false
    this.port.onmessage = e => { this.on = !!e.data.on; if (!this.on) { this.n = 0; this.sum = 0 } }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch || !this.on) return true
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]))
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
      this.sum += v * v
      if (this.n === 512) {
        const out = this.buf.slice()
        this.port.postMessage({ pcm: out.buffer, level: Math.min(1, Math.sqrt(this.sum / 512) * 5) }, [out.buffer])
        this.n = 0; this.sum = 0
      }
    }
    return true
  }
}
registerProcessor('lokey-mic', LokeyMic)
