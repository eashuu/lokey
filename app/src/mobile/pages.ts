// The "windows" the Windows core opens by hash, mounted in the one page on Android: #agent (microphone + speaker, the same engine as
// renderer/src/agent/AgentApp.tsx), #confirm (Allow/Deny card) and the transient #caption / #dictation / #lasso overlays. The main-process
// code (audio.ts, permissions.ts, overlays.ts) creates and talks to them exactly as on Windows.
import { pageListeners, registerPage } from './shims/electron'


// ---- #agent: mic capture (16 kHz PCM16) + speaker playback (24 kHz PCM16) -----------------------------------------------------------------
const WARM_MS = 12_000 // the mic stays open this long after a release so the next press loses no first word

function mountAgent() {
  const A = window.lokeyAgent
  if (!A) return
  type Mic = { ctx: AudioContext; stream: MediaStream; src: MediaStreamAudioSourceNode; node: AudioNode; stop(): void }
  let mic: Mic | null = null, out: AudioContext | null = null
  let nextAt = 0, sources: AudioBufferSourceNode[] = [], lastLevelAt = 0
  let want = false, starting: Promise<void> | null = null, cool: ReturnType<typeof setTimeout> | null = null

  const openMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true } })
      const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
      const src = ctx.createMediaStreamSource(stream)
      let node: AudioNode, stop: () => void
      try {
        await ctx.audioWorklet.addModule(new URL('mic-worklet.js', document.baseURI).href)
        const w = new AudioWorkletNode(ctx, 'lokey-mic', { numberOfOutputs: 1, outputChannelCount: [1] })
        w.port.onmessage = e => { if (want) { A.mic(e.data.pcm); A.level('mic', e.data.level) } }
        const sync = () => w.port.postMessage({ on: want })
        sync()
        ;(w as unknown as { sync: () => void }).sync = sync
        node = w; stop = () => { w.port.onmessage = null }
      } catch {
        // no worklet (blocked module load): the main-thread processor does the same job
        const sp = ctx.createScriptProcessor(512, 1, 1)
        sp.onaudioprocess = e => {
          if (!want) return
          const f = e.inputBuffer.getChannelData(0), pcm = new Int16Array(f.length)
          let sum = 0
          for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; sum += v * v }
          A.mic(pcm.buffer); A.level('mic', Math.min(1, Math.sqrt(sum / f.length) * 5))
        }
        node = sp; stop = () => { sp.onaudioprocess = null }
      }
      src.connect(node)
      node.connect(ctx.destination) // a processing node only runs while connected; it outputs silence
      mic = { ctx, stream, src, node, stop }
    } catch (e) {
      want = false
      A.fail(`microphone: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const tell = () => (mic?.node as unknown as { sync?: () => void } | undefined)?.sync?.()
  const closeMic = () => {
    if (!mic) return
    mic.stop(); mic.src.disconnect(); mic.node.disconnect()
    mic.stream.getTracks().forEach(t => t.stop())
    void mic.ctx.close()
    mic = null
  }
  const scheduleClose = () => { if (cool) clearTimeout(cool); cool = setTimeout(() => { cool = null; if (!want) closeMic() }, WARM_MS) }
  const startMic = async () => {
    want = true
    if (cool) { clearTimeout(cool); cool = null }
    if (mic) { if (mic.ctx.state === 'suspended') void mic.ctx.resume(); tell(); return }
    starting ??= openMic().finally(() => { starting = null })
    await starting
    tell()
    if (!want) scheduleClose() // released while the permission prompt / device was still opening
  }
  const stopMic = (hard = false) => { want = false; tell(); if (hard) { if (cool) clearTimeout(cool); cool = null; closeMic() } else scheduleClose() }

  const play = (data: Uint8Array) => {
    out ??= new AudioContext({ sampleRate: 24000 })
    if (out.state === 'suspended') void out.resume()
    const n = Math.floor(data.byteLength / 2)
    if (n === 0) return
    const view = new DataView(data.buffer, data.byteOffset, n * 2)
    const buf = out.createBuffer(1, n, 24000), ch = buf.getChannelData(0)
    let sum = 0
    for (let i = 0; i < n; i++) { const v = view.getInt16(i * 2, true) / 0x8000; ch[i] = v; sum += v * v }
    const s = out.createBufferSource()
    s.buffer = buf; s.connect(out.destination)
    const at = Math.max(out.currentTime + 0.03, nextAt)
    s.start(at); nextAt = at + buf.duration
    sources.push(s)
    const level = Math.min(1, Math.sqrt(sum / n) * 4)
    setTimeout(() => { if (performance.now() - lastLevelAt > 25) { lastLevelAt = performance.now(); A.level('out', level) } }, Math.max(0, (at - out!.currentTime) * 1000))
    s.onended = () => { sources = sources.filter(x => x !== s); if (sources.length === 0) A.level('out', -1) } // -1 = drained
  }
  const flush = () => {
    const old = sources
    sources = []; nextAt = 0
    for (const s of old) { s.onended = null; try { s.stop() } catch { /* already stopped */ } }
    A.level('out', -1)
  }

  A.onCmd(c => { if (c.cmd === 'mic') { if (c.on) void startMic(); else stopMic(!!c.hard) } else if (c.cmd === 'play') play(c.data); else if (c.cmd === 'flush') flush() })
  A.ready()
}

// ---- #confirm: a plain bottom sheet, only when nothing else in the page listens for confirm requests (the phone UI listens on window.lokeyConfirm and draws its own card) ---------------------------------------------------------------------------
function mountConfirm() {
  const C = window.lokeyConfirm
  if (!C) return
  if (!mountConfirm.done) {
    mountConfirm.done = true
    C.onRequest(r => {
      if (pageListeners('lokey:confirm:req') > 1) return // the UI has its own card; this sheet is the fallback
      const box = document.createElement('div')
      box.setAttribute('role', 'alertdialog')
      box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);z-index:2147483647;background:#1b1b20;color:#f2f2f5;border-radius:20px;padding:16px;font:15px system-ui,sans-serif;box-shadow:0 12px 40px #000a'
      const h = document.createElement('div'); h.style.cssText = 'font-weight:600;margin-bottom:6px'; h.textContent = r.title
      const d = document.createElement('div'); d.style.cssText = 'opacity:.75;font-size:13px;margin-bottom:12px;max-height:5.5em;overflow:auto;white-space:pre-wrap'; d.textContent = r.detail
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end'
      const done = (ok: boolean) => { clearTimeout(t); box.remove(); C.answer(r.id, ok) }
      const btn = (label: string, ok: boolean, bg: string) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `border:0;border-radius:14px;padding:10px 20px;font:inherit;color:#fff;background:${bg}`; b.onclick = () => done(ok); return b }
      row.append(btn('Deny', false, '#3a3a42'), btn('Allow', true, '#4f7cff'))
      box.append(h, d, row)
      document.body.append(box)
      const t = setTimeout(() => box.remove(), r.timeoutMs + 600)
    })
  }
  C.ready()
}
mountConfirm.done = false

// ---- overlays: only the "I am ready" ping; the UI subscribes with window.lokeyOverlay.on(...) when it wants captions ---------------------
const overlay = (name: 'caption' | 'dictation' | 'lasso') => () => window.lokeyOverlay?.ready(name)

registerPage('agent', mountAgent)
registerPage('confirm', mountConfirm)
registerPage('caption', overlay('caption'))
registerPage('dictation', overlay('dictation'))
registerPage('lasso', overlay('lasso'))
