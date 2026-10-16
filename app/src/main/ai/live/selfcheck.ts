import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { TOOLS } from '../../agent/tools'
import { openDb } from '../db'
import { Gateway } from '../gateway'
import { GeminiSession, classifyClose } from './session'
import { LiveSupervisor } from './supervisor'
import { LIVE_CORE, liveTools, preamble } from './surface'

// `--selfcheck` for the Live voice socket: a throw-away WebSocket server on 127.0.0.1 plays Google's side (setup, resumption handles,
// goAway, abnormal closes, silence, a pulled network) and the REAL GeminiSession and LiveSupervisor are run against it.
// No network, no key, no microphone.
interface Plan {
  setup?: 'ok' | 'close' | 'destroy'
  code?: number; reason?: string
  rejectResume?: boolean
  onTurn?: 'reply' | 'close' | 'destroy' | 'goaway' | 'silent'
  turnCode?: number; turnReason?: string
  audioSec?: number
  /** enforce the documented message rules (and the one observed live on gemini-3.8-live: an activity needs audio in it) */
  strict?: boolean
}
interface Conn { model: string; handle: string; tools: number; system: string; texts: string[]; send(o: unknown): void; close(code: number, reason: string): void; destroy(): void }

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const frame = (op: number, p: Buffer) => {
  const h = p.length < 126 ? Buffer.from([0x80 | op, p.length]) : p.length < 65536 ? Buffer.from([0x80 | op, 126, p.length >> 8, p.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(p.length), 2); return b })()
  return Buffer.concat([h, p])
}

async function liveMock() {
  const plans: Plan[] = []
  const conns: Conn[] = []
  let handles = 0
  const sockets = new Set<Socket>()
  const srv = createServer()
  srv.on('upgrade', (req, socket: Socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => undefined)
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash('sha1').update(String(req.headers['sec-websocket-key']) + GUID).digest('base64')}\r\n\r\n`)
    const plan = plans.shift() ?? {}
    const conn: Conn = {
      model: '', handle: '', tools: 0, system: '', texts: [],
      send: o => { if (!socket.destroyed) socket.write(frame(1, Buffer.from(JSON.stringify(o)))) },
      close: (code, reason) => { const p = Buffer.alloc(2 + Buffer.byteLength(reason)); p.writeUInt16BE(code); p.write(reason, 2); if (!socket.destroyed) socket.write(frame(8, p)); setTimeout(() => socket.end(), 10) },
      destroy: () => socket.destroy(),
    }
    conns.push(conn)
    const reply = () => {
      conn.send({ serverContent: { outputTranscription: { text: 'hello' } } })
      if (plan.audioSec) conn.send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(Math.round(48000 * plan.audioSec)).toString('base64') } }] } } })
      conn.send({ serverContent: { turnComplete: true } })
    }
    let setupDone = false, manual = false, actOpen = false, actAudio = false
    const violation = (m: any): string | null => {
      const keys = Object.keys(m)
      if (keys.length !== 1) return 'a message must have exactly one top-level field'
      if (!setupDone && !m.setup) return 'the first message must be setup'
      const ri = m.realtimeInput
      if (!ri) return null
      if (Object.keys(ri).length !== 1) return 'realtimeInput carries one thing at a time here'
      if ((ri.activityStart || ri.activityEnd) && !manual) return 'activityStart/activityEnd need automatic activity detection to be disabled'
      if (ri.audioStreamEnd && manual) return 'audioStreamEnd is only for automatic activity detection'
      if (ri.activityStart) { if (actOpen) return 'an activity is already open'; actOpen = true; actAudio = false }
      else if (ri.activityEnd) { if (!actOpen) return 'no activity is open'; if (!actAudio) return 'an activity with no audio in it'; actOpen = false }   // observed 2026-10-16 on gemini-3.8-live, not documented
      else if (ri.audio) { if (manual && !actOpen) return 'audio outside an activity'; actAudio = true }
      return null
    }
    let buf = Buffer.alloc(0)
    socket.on('data', d => {
      buf = Buffer.concat([buf, Buffer.from(d)])
      for (;;) {
        if (buf.length < 2) return
        const op = buf[0] & 15
        let len = buf[1] & 127, off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        if (buf.length < off + 4 + len) return
        const mask = buf.subarray(off, off + 4)
        const body = Uint8Array.from(buf.subarray(off + 4, off + 4 + len), (b, i) => b ^ mask[i % 4])
        buf = buf.subarray(off + 4 + len)
        if (op === 8) { socket.end(); return }
        if (op !== 1) continue
        let m: any
        try { m = JSON.parse(Buffer.from(body).toString('utf8')) } catch { continue }
        if (plan.strict) { const v = violation(m); if (v) { conn.close(1007, 'Precondition check failed.'); continue } }
        if (m.setup) {
          setupDone = true; manual = m.setup.realtimeInputConfig?.automaticActivityDetection?.disabled === true
          conn.handle = m.setup.sessionResumption?.handle ?? ''
          conn.tools = m.setup.tools?.[0]?.functionDeclarations?.length ?? 0
          conn.system = m.setup.systemInstruction?.parts?.[0]?.text ?? ''
          conn.model = String(m.setup.model ?? '')
          if (plan.setup === 'close') { conn.close(plan.code ?? 1011, plan.reason ?? ''); continue }
          if (plan.setup === 'destroy') { socket.destroy(); continue }
          if (plan.rejectResume && conn.handle) { conn.close(1007, 'invalid session handle'); continue }
          conn.send({ setupComplete: {} })
          conn.send({ sessionResumptionUpdate: { newHandle: `h${++handles}` } })
        } else if (typeof m.realtimeInput?.text === 'string') {
          conn.texts.push(m.realtimeInput.text)
          if (plan.onTurn === 'reply') reply()
          else if (plan.onTurn === 'goaway') { conn.send({ goAway: { timeLeft: '20s' } }); reply() }
          else if (plan.onTurn === 'close') conn.close(plan.turnCode ?? 1011, plan.turnReason ?? 'internal error')
          else if (plan.onTurn === 'destroy') socket.destroy()
        }
      }
    })
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as AddressInfo).port
  return {
    url: `ws://127.0.0.1:${port}/`, plans, conns,
    stop: () => { for (const s of sockets) s.destroy(); srv.close() },
    /** the server goes away entirely (a pulled network cable): new connections are refused */
    down: () => new Promise<void>(r => { for (const s of sockets) s.destroy(); srv.close(() => r()) }),
  }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const until = async (f: () => boolean, ms = 3000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await wait(15) }

export async function liveSelfCheck(): Promise<string> {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('live: ' + m) }
  let n = 0
  const ok = (c: boolean, m: string) => { need(c, m); n++ }

  // ---- close codes ---------------------------------------------------------------------------------------------------------------
  ok(classifyClose(1000, 'idle').kind === null && classifyClose(1011, 'Internal error').kind === 'OVERLOADED' && classifyClose(1006, '').kind === 'NETWORK', 'normal, internal error and abnormal closes')
  ok(classifyClose(1007, 'Request contains an invalid argument').kind === 'BAD_REQUEST' && !classifyClose(1007, 'x').recoverable, '1007 is a refusal, never retried the same way')
  ok(classifyClose(1008, 'API key not valid').kind === 'AUTH' && classifyClose(1011, 'You exceeded your current quota').kind === 'RATE_MINUTE' && classifyClose(1011, 'quota exceeded for requests per day').kind === 'QUOTA_DAY', 'policy and quota texts are typed')

  // ---- the tool surface and the per-turn note --------------------------------------------------------------------------------------
  const surface = liveTools(TOOLS)
  ok(surface.length === LIVE_CORE.length && surface.length === 16 && surface.some(t => t.name === 'do_task') && surface.every(t => LIVE_CORE.includes(t.name as never)), 'the voice is offered 16 tools including do_task')
  ok(!liveTools(TOOLS, false).some(t => t.name === 'get_context') && TOOLS.length > 40, 'context tools drop out when context is off; the full catalog stays for workers')
  ok(/October|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/.test(preamble(new Date(), 'Code.exe')) && /Code\.exe/.test(preamble(new Date(), 'Code.exe')), 'the per-turn note carries the time and the program in front')

  const mock = await liveMock()
  const g = new Gateway(() => [], () => null, { db: openDb(':memory:') })
  const mk = (stallMs = 5000) => {
    const sup = new LiveSupervisor(resume => new GeminiSession({ key: 'k', model: 'live-test', voice: 'v', system: 'sys', tools: surface, manual: true, resume, url: mock.url }), g, { model: () => 'live-test', stallMs })
    const ev: string[] = []
    sup.on('closed', i => ev.push(`closed:${i.kind}:${i.code}:${i.recoverable}:${i.midTurn}`))
    sup.on('stalled', () => ev.push('stalled'))
    sup.on('refresh', () => ev.push('refresh'))
    sup.on('degraded', d => ev.push(`degraded:${d.kind}`))
    sup.on('recovered', () => ev.push('recovered'))
    return { sup, ev }
  }
  try {
    {   // a normal session: handle kept, tools declared, audio metered through the gateway
      const { sup } = mk()
      mock.plans.push({ onTurn: 'reply', audioSec: 2 })
      const s = await sup.connect()
      await until(() => !!sup.handle)
      ok(sup.handle === 'h1' && mock.conns[0].tools === 16 && mock.conns[0].handle === '', 'connects fresh, declares 16 tools, stores the resumption handle')
      s.sendAudio(Buffer.alloc(64000)); s.sendText('hi'); sup.turnSent()
      await until(() => s.audioOutSec > 0)
      sup.turnEnded()
      sup.closeSession('idle')
      const live = g.status().providers.find(p => p.id === 'live')!
      ok(live.requests >= 1 && live.tin === 50 && live.tout === 50, 'Live sessions are metered through the gateway ledger (2 s in, 2 s out = 25 tokens a second)')
      ok(g.traces({ role: 'live' }).some(t => t.op === 'live.connect' && t.ok) && g.traces({ role: 'live' }).some(t => t.op === 'live.session'), 'connections and sessions are traced')
    }
    {   // resume with the saved handle; a rejected handle falls back to a fresh session
      const { sup } = mk()
      sup.handle = 'old'; (sup as unknown as { handleAt: number; handleModel: string }).handleAt = Date.now(); (sup as unknown as { handleModel: string }).handleModel = 'live-test'
      mock.plans.push({ rejectResume: true }, {})
      const before = mock.conns.length
      await sup.connect()
      ok(mock.conns.length === before + 2 && mock.conns[before].handle === 'old' && mock.conns[before + 1].handle === '', 'a rejected resumption handle: one fresh retry without it')
      sup.closeSession()
      const { sup: s2 } = mk()
      s2.handle = 'h-good'; (s2 as unknown as { handleAt: number }).handleAt = Date.now(); (s2 as unknown as { handleModel: string }).handleModel = 'live-test'
      mock.plans.push({})
      await s2.connect()
      ok(mock.conns.at(-1)!.handle === 'h-good', 'a good handle is sent to resume the conversation')
      s2.closeSession()
    }
    {   // the real server's words (main.log 13:05Z): a stale handle at setup is dropped and the connect retried fresh at once, as no failure at all
      const { sup, ev } = mk()
      sup.handle = 'old'; (sup as unknown as { handleAt: number }).handleAt = Date.now(); (sup as unknown as { handleModel: string }).handleModel = 'live-test'
      mock.plans.push({ setup: 'close', code: 1007, reason: 'BidiGenerateContent session not found or expired' }, {})
      const before = mock.conns.length, failsBefore = g.traces({ role: 'live', failed: true }).length
      const s = await sup.connect()
      ok(s.connected && mock.conns.length === before + 2 && mock.conns[before + 1].handle === '' && sup.handle !== 'old', 'a stale handle ("session not found or expired") is dropped and the retry is fresh')
      ok(g.traces({ role: 'live', failed: true }).length === failsBefore && !sup.degraded && !sup.noTools && !ev.length, 'and it is not a failure: no failed trace, no ladder step, no notice')
      sup.closeSession()
    }
    {   // "session is already connected to an existing client": our own earlier socket; connects are serialized and it is retried after that socket closes
      const { sup, ev } = mk()
      mock.plans.push({ setup: 'close', code: 1007, reason: 'BidiGenerateContent session is already connected to an existing client' }, {})
      const before = mock.conns.length, failsBefore = g.traces({ role: 'live', failed: true }).length
      const s = await sup.connect()
      ok(s.connected && mock.conns.length === before + 2 && g.traces({ role: 'live', failed: true }).length === failsBefore && !sup.degraded && !ev.length, 'an "already connected" refusal is waited out and retried once, not counted as a failure')
      sup.closeSession()
      // two callers at the same moment share one connect: one socket, not two
      mock.plans.push({})
      const b2 = mock.conns.length
      const [x, y] = await Promise.all([sup.connect(), sup.connect()])
      ok(x === y && mock.conns.length === b2 + 1, 'two simultaneous connects open one socket')
      // a new connect while a session is open closes the old socket first (and waits for it)
      mock.plans.push({})
      const b3 = mock.conns.length
      const z = await sup.connect()
      ok(z !== x && mock.conns.length === b3 + 1 && !x.connected, 'a connect while a session is open replaces it: the old socket is closed first, never two for one voice session')
      sup.closeSession()
    }
    {   // 1011 in the middle of a turn: typed as recoverable, the handle survives and the next connection resumes with it
      const { sup, ev } = mk()
      mock.plans.push({ onTurn: 'close', turnCode: 1011, turnReason: 'Internal error encountered.' })
      const s = await sup.connect()
      await until(() => !!sup.handle)
      const h = sup.handle
      s.sendText('do it'); sup.turnSent()
      await until(() => ev.some(e => e.startsWith('closed')))
      ok(ev.includes('closed:OVERLOADED:1011:true:true') && sup.handle === h && sup.session === null, `close 1011 mid-turn: recoverable, handle kept (${ev.join(' ')} | ${sup.handle} vs ${h} | ${sup.session === null})`)
      mock.plans.push({})
      await sup.connect()
      ok(mock.conns.at(-1)!.handle === h, 'the next connection resumes with that handle')
      sup.closeSession()
    }
    {   // a resumed session that dies at once poisons the handle: the next one is fresh
      const { sup, ev } = mk()
      sup.handle = 'h-bad'; (sup as unknown as { handleAt: number }).handleAt = Date.now()
      mock.plans.push({ onTurn: 'close', turnCode: 1011 })
      const s = await sup.connect()
      s.sendText('x'); sup.turnSent()
      await until(() => ev.some(e => e.startsWith('closed')))
      ok(sup.handle === null, 'resume-then-fresh: a resumed session that dies within 10 s drops the handle')
    }
    {   // 1007: refused, handle dropped, not recoverable
      const { sup, ev } = mk()
      mock.plans.push({ onTurn: 'close', turnCode: 1007, turnReason: 'Request contains an invalid argument.' })
      const s = await sup.connect()
      await until(() => !!sup.handle)
      s.sendText('x'); sup.turnSent()
      await until(() => ev.some(e => e.startsWith('closed')))
      ok(ev.some(e => e === 'closed:BAD_REQUEST:1007:false:true') && sup.handle === null, 'close 1007: not recoverable, handle dropped')
      ok(g.traces({ role: 'live', failed: true }).some(t => t.kind === 'BAD_REQUEST'), '1007 leaves a trace row for the bug report')
    }
    {   // goAway: between turns the connection is replaced at once; mid-turn only when the turn ends
      const { sup, ev } = mk()
      mock.plans.push({})
      await sup.connect()
      mock.conns.at(-1)!.send({ goAway: { timeLeft: '20s' } })
      await until(() => ev.includes('refresh'))
      ok(ev.includes('refresh') && sup.stale, 'goAway while idle: asks for a fresh connection right away')
      sup.closeSession()
      const b = mk()
      mock.plans.push({ onTurn: 'goaway', audioSec: 0.5 })
      const s = await b.sup.connect()
      s.sendText('x'); b.sup.turnSent()
      await until(() => s.audioOutSec > 0)
      await wait(60)
      ok(!b.ev.includes('refresh'), 'goAway mid-turn: the turn is not interrupted')
      b.sup.turnEnded()
      ok(b.ev.includes('refresh'), 'goAway mid-turn: the connection is replaced once the turn ends')
      b.sup.closeSession()
    }
    {   // a silent stall
      const { sup, ev } = mk(150)
      mock.plans.push({ onTurn: 'silent' })
      const s = await sup.connect()
      await until(() => !!sup.handle)
      s.sendText('x'); sup.turnSent()
      await until(() => ev.includes('stalled'), 2000)
      ok(ev.includes('stalled'), 'a server that goes silent after a turn is detected')
      sup.replaceStalled()
      ok(sup.session === null && sup.handle === null && g.traces({ role: 'live', failed: true }).some(t => /stalled/.test(t.note)), 'the stalled session is replaced, its young handle dropped, and it is recorded as a failure')
    }
    {   // network pulled mid-turn, then down for good: failures open the breaker and Live degrades without touching the network
      const { sup, ev } = mk()
      mock.plans.push({ onTurn: 'destroy' })
      const s = await sup.connect()
      s.sendText('x'); sup.turnSent()
      await until(() => ev.some(e => e.startsWith('closed')))
      ok(ev.some(e => e === 'closed:NETWORK:1006:true:true'), 'a pulled network mid-turn is an abnormal close (1006), typed NETWORK and recoverable')
      await mock.down()
      let kinds = ''
      for (let i = 0; i < 4; i++) { try { await sup.connect() } catch (e) { kinds += (e as { kind?: string }).kind + ',' } }
      ok(/^NETWORK,/.test(kinds) && !!sup.degraded && ev.some(e => e.startsWith('degraded:')), `with the network down, repeated failures open the breaker: Live is degraded (${kinds} | ${ev.join(' ')})`)
      ok(ev.filter(e => e.startsWith('degraded')).length === 1, 'the degraded state is announced once')
    }
    {   // quota: a typed daily-quota close degrades Live until the reset, with no more connection attempts
      const g2 = new Gateway(() => [], () => null, { db: openDb(':memory:') })
      const m2 = await liveMock()
      m2.plans.push({ setup: 'close', code: 1011, reason: 'You exceeded your current quota for requests per day' })
      const sup = new LiveSupervisor(r => new GeminiSession({ key: 'k', model: 'm', voice: 'v', system: 's', tools: surface, resume: r, url: m2.url }), g2, { model: () => 'm' })
      let kind = ''
      try { await sup.connect() } catch (e) { kind = (e as { kind?: string }).kind ?? '' }
      const d = sup.degraded
      const seen = m2.conns.length
      try { await sup.connect() } catch { /* degraded */ }
      ok(kind === 'QUOTA_DAY' && d?.kind === 'QUOTA_DAY' && d.until > Date.now() && m2.conns.length === seen, 'a daily quota close degrades Live until the reset and stops further connection attempts')
      ok(g2.status().providers.find(p => p.id === 'live')!.exhaustedUntil !== null, 'the exhausted Live quota shows in the gateway status')
      m2.stop()
    }
    {   // voice ladder, rung 1: other Live model ids (voice.models) take over from a model that keeps failing
      const m4 = await liveMock()
      const g4 = new Gateway(() => [], () => null, { db: openDb(':memory:') })
      const mkM = (gw: Gateway = g4) => { const sup = new LiveSupervisor((resume, model) => new GeminiSession({ key: 'k', model: model ?? 'A', voice: 'v', system: 's', tools: surface, manual: true, resume, url: m4.url }), gw, { model: () => 'A', alts: () => ['B', 'C'] }); const ev: string[] = []; sup.on('closed', i => ev.push(`closed:${i.kind}:${i.code}`)); sup.on('degraded', () => ev.push('degraded')); return { sup, ev } }
      const { sup, ev } = mkM()
      const refuse = async () => { m4.plans.push({ strict: false, onTurn: 'close', turnCode: 1007, turnReason: 'Precondition check failed.' }); const s = await sup.connect(); s.sendText('x'); sup.turnSent(); const n = ev.length; await until(() => ev.length > n) }
      await refuse(); await refuse()
      ok(sup.models().join() === 'A,B,C' && sup.active === 'A' && sup.bare, 'two refusals on the first model: still the first model, with the cut-down setup')
      await refuse()
      ok(!sup.degraded && !ev.includes('degraded'), 'three refusals rest the first model but Live is NOT down: another id is available')
      m4.plans.push({}); const s2 = await sup.connect()
      ok(s2.connected && m4.conns.at(-1)!.model === 'models/B' && sup.usingAlternate && sup.active === 'B' && !sup.noTools, 'the next session is on the alternate model id, with the full setup again')
      sup.closeSession()
      // the first model's own daily quota: the next id is used in the same connect() call
      const g7 = new Gateway(() => [], () => null, { db: openDb(':memory:') })
      const q = mkM(g7)
      m4.plans.push({ setup: 'close', code: 1011, reason: 'You exceeded your current quota for requests per day' }, {})
      const sq = await q.sup.connect()
      ok(sq.connected && m4.conns.at(-1)!.model === 'models/B' && !g7.liveAllowed('A').ok, 'a per-model quota close moves on to the next model id within the same connect')
      q.sup.closeSession()
      // a model id that no longer exists is retired for a day
      const g5 = new Gateway(() => [], () => null, { db: openDb(':memory:') })
      const sup5 = new LiveSupervisor((resume, model) => new GeminiSession({ key: 'k', model: model ?? 'A', voice: 'v', system: 's', tools: surface, manual: true, resume, url: m4.url }), g5, { model: () => 'A', alts: () => ['B'] })
      m4.plans.push({ setup: 'close', code: 1007, reason: 'models/A is not found for API version v1beta' }, {})
      const s5 = await sup5.connect()
      ok(s5.connected && m4.conns.at(-1)!.model === 'models/B' && !g5.liveAllowed('A').ok, 'a model id that is not found is retired and the next one used')
      sup5.closeSession()
      // all ids down: degraded, with a reason
      const g6 = new Gateway(() => [], () => null, { db: openDb(':memory:') })
      g6.liveRest('A', 600_000, 'x'); g6.liveRest('B', 600_000, 'x')
      const sup6 = new LiveSupervisor(() => { throw new Error('must not connect') }, g6, { model: () => 'A', alts: () => ['B'] })
      ok(!!sup6.degraded, 'when every Live model id is resting, the voice is degraded (the text ladder takes over)')
      m4.stop()
    }
    {   // what Google refused on gemini-3.8-live (found with --livetest): an activity with no audio in it, which is what a typed turn was wrapped in
      const m3 = await liveMock()
      const lines: string[] = []
      const gl = new Gateway(() => [], () => null, { db: openDb(':memory:'), log: l => lines.push(l) })
      const mkL = () => { const sup = new LiveSupervisor(resume => new GeminiSession({ key: 'k', model: 'live-test', voice: 'v', system: 'sys', tools: surface, manual: true, resume, url: m3.url }), gl, { model: () => 'live-test' }); const ev: string[] = []; sup.on('closed', i => ev.push(`closed:${i.kind}:${i.code}`)); return { sup, ev } }
      const ptt = async (sup: LiveSupervisor, note: boolean) => {
        const s = await sup.connect()
        s.activityStart()
        for (let i = 0; i < 6; i++) s.sendAudio(Buffer.alloc(3200))
        if (note) s.sendNote('(Context for this turn, not from the user: it is Friday.)')   // the 0.8.0 flow: accepted by the real server (refuted as the cause)
        s.activityEnd(); sup.turnSent()
        return s
      }
      const old = mkL()
      m3.plans.push({ strict: true })
      const so = await old.sup.connect()
      so.activityStart(); so.sendNote('(Context: it is Friday.)\nopen chrome'); so.activityEnd(); old.sup.turnSent()   // what 0.5.1 to 0.8.2 sent for a TYPED turn
      await until(() => old.ev.some(e => e.startsWith('closed')))
      ok(old.ev.includes('closed:BAD_REQUEST:1007'), 'the old typed-turn shape (activityStart, text, activityEnd: an activity with no audio) is closed with 1007 by a server that enforces the rules')
      ok(lines.some(l => /live\.session ended: BAD_REQUEST code=1007/.test(l) && /Precondition check failed/.test(l) && /realtimeInput\.activityStart/.test(l) && /realtimeInput\.text/.test(l) && /realtimeInput\.activityEnd/.test(l) && /setup \(tools 16/.test(l) && !/Friday|chrome/.test(l)), 'main.log gets the close code and reason plus the last messages sent as TYPES, sizes and offsets only (no text, no audio)')
      const legacy = mkL()
      m3.plans.push({ strict: true, onTurn: 'reply' })
      const sl = await ptt(legacy.sup, true)
      await wait(300)
      ok(sl.connected && !legacy.ev.length, 'a text note inside an audio activity is accepted (the first suspicion, refuted against the real server)')
      legacy.sup.closeSession()
      const fixed = mkL()
      m3.plans.push({ strict: true, onTurn: 'reply' })
      const s2 = await ptt(fixed.sup, false)
      await wait(300)
      ok(s2.connected && !fixed.ev.length, 'push-to-talk (activityStart, audio, activityEnd) is accepted')
      fixed.sup.closeSession()
      const typed = mkL()
      m3.plans.push({ strict: true, onTurn: 'reply' })
      const s3 = await typed.sup.connect(); s3.sendText('(Context for this turn: it is Friday.)\nopen chrome'); typed.sup.turnSent()
      await wait(300)
      ok(s3.connected && !typed.ev.length, 'a typed turn is sent as the text alone (no activity messages) and is accepted')
      typed.sup.closeSession()
      // the ladder: refusals right after start take the tools out, then the system prompt, then the voice goes to text for a while
      const lad = mkL()
      const refuse = async () => { m3.plans.push({ strict: false, onTurn: 'close', turnCode: 1007, turnReason: 'Precondition check failed.' }); const s = await lad.sup.connect(); s.sendText('x'); lad.sup.turnSent(); const n = lad.ev.length; await until(() => lad.ev.length > n) }
      ok(!lad.sup.noTools && !lad.sup.bare && !lad.sup.degraded, 'a fresh supervisor starts with the full setup')
      await refuse()
      ok(lad.sup.noTools && !lad.sup.bare && !lad.sup.degraded, 'after one refusal the next session is set up without tools')
      await refuse()
      ok(lad.sup.bare && !lad.sup.degraded, 'after two, also with a short system prompt')
      await refuse()
      const d = lad.sup.degraded
      ok(d?.kind === 'BAD_REQUEST' && /1007/.test(d.why) && d.until > Date.now(), 'after three the voice goes to text mode with the reason')
      lad.sup.resetRefusals()
      ok(!lad.sup.noTools && !lad.sup.degraded, 'a new key or model starts from the full setup again')
      m3.stop()
    }
  } finally { mock.stop() }
  return `live ok (${n} checks)`
}
