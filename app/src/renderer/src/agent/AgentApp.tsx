import { useEffect } from 'react'

// Hidden page: microphone capture (16 kHz PCM16 chunks to main) and speaker playback (24 kHz PCM16 chunks from main).
// No UI. ScriptProcessor is used (not a worklet) so no script has to be loaded from a blob under the page CSP.
const CHUNK = 1024 // samples per mic message (64 ms at 16 kHz)

export function AgentApp() {
  useEffect(() => {
    const A = window.lokeyAgent
    if (!A) return
    let mic: { ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; src: MediaStreamAudioSourceNode } | null = null
    let out: AudioContext | null = null
    let nextAt = 0
    let sources: AudioBufferSourceNode[] = []
    let lastLevelAt = 0

    const startMic = async () => {
      if (mic) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        const ctx = new AudioContext({ sampleRate: 16000 })
        const src = ctx.createMediaStreamSource(stream)
        const node = ctx.createScriptProcessor(CHUNK, 1, 1)
        node.onaudioprocess = e => {
          const f = e.inputBuffer.getChannelData(0)
          const pcm = new Int16Array(f.length)
          let sum = 0
          for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; sum += v * v }
          A.mic(pcm.buffer)
          A.level('mic', Math.min(1, Math.sqrt(sum / f.length) * 5))
        }
        src.connect(node)
        node.connect(ctx.destination) // a processor only runs while connected; it outputs silence
        mic = { ctx, stream, node, src }
      } catch (e) {
        A.fail(`microphone: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const stopMic = () => {
      if (!mic) return
      mic.node.onaudioprocess = null
      mic.src.disconnect(); mic.node.disconnect()
      mic.stream.getTracks().forEach(t => t.stop())
      void mic.ctx.close()
      mic = null
    }

    const play = (data: Uint8Array) => {
      out ??= new AudioContext({ sampleRate: 24000 })
      if (out.state === 'suspended') void out.resume()
      const n = Math.floor(data.byteLength / 2)
      if (n === 0) return
      const view = new DataView(data.buffer, data.byteOffset, n * 2)
      const buf = out.createBuffer(1, n, 24000)
      const ch = buf.getChannelData(0)
      let sum = 0
      for (let i = 0; i < n; i++) { const v = view.getInt16(i * 2, true) / 0x8000; ch[i] = v; sum += v * v }
      const s = out.createBufferSource()
      s.buffer = buf
      s.connect(out.destination)
      const at = Math.max(out.currentTime + 0.03, nextAt)
      s.start(at)
      nextAt = at + buf.duration
      sources.push(s)
      const level = Math.min(1, Math.sqrt(sum / n) * 4)
      setTimeout(() => { if (performance.now() - lastLevelAt > 25) { lastLevelAt = performance.now(); A.level('out', level) } }, Math.max(0, (at - out.currentTime) * 1000))
      s.onended = () => {
        sources = sources.filter(x => x !== s)
        if (sources.length === 0) A.level('out', -1) // drained
      }
    }
    const flush = () => {
      const old = sources
      sources = []
      nextAt = 0
      for (const s of old) { s.onended = null; try { s.stop() } catch { /* already stopped */ } }
      A.level('out', -1)
    }

    A.onCmd(c => {
      if (c.cmd === 'mic') { if (c.on) void startMic(); else stopMic() }
      else if (c.cmd === 'play') play(c.data)
      else if (c.cmd === 'flush') flush()
    })
    A.ready()
    return () => { stopMic(); void out?.close() }
  }, [])
  return null
}
