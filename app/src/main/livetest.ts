import { readFileSync, writeFileSync } from 'node:fs'
import type { ProviderConfig } from '@shared/bridge'
import type { Agent } from './agent/agent'
import { buildPrompt, wav } from './agent/dictation'
import { getKey, getSecret } from './agent/keystore'
import { listLiveModels } from './ai/adapters/gemini'
import { userMessage, AiError } from './ai/errors'
import { ai, Gateway } from './ai/gateway'
import { GeminiSession } from './ai/live/session'
import { settings } from './settings'

// `Lokey.exe --livetest <report file>`: a headless check of the REAL services with the person's own saved keys (authorised by them). It runs
// inside the app (same identity, so Windows decrypts the keys through the app's own code), opens no window, starts no sidecar, registers no
// hotkey and sends no input. The shared database and every data file stay untouched (the database is switched off in this mode, nothing is
// saved). It never prints a key: the report is also run through a redaction pass. What is logged per step is the result, the close code and
// reason, the time, and the TYPES of the messages sent (never audio, text, prompts or keys).
const BARE = 'You are Lokey, a friendly voice assistant on the user’s Windows PC. Answer briefly, in the language the user spoke.'
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const redact = (s: string) => s.replace(/AIza[\w-]{20,}/g, '[key]').replace(/\bsk-[\w-]{16,}/g, '[key]').replace(/Bearer\s+\S+/gi, 'Bearer [key]').replace(/([?&]key=)[^&\s"]+/g, '$1[key]')

function tone(sec: number): Buffer {
  const n = Math.round(16000 * sec), b = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / 16000) * 0.3 * 32767 * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / 16000))), i * 2)
  return b
}
const PIXEL = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

interface Row { section: string; step: string; ok: boolean | null; ms: number; evidence: string }
type Shape = 'empty' | 'short' | 'connect' | 'typed' | 'typed-text' | 'typed-client' | 'typed-server' | 'ptt' | 'ptt-legacy' | 'ptt-server' | 'resume'
interface Trial { shape: Shape; model?: string; tools?: boolean; bare?: boolean; minimal?: boolean; resume?: string }
interface Outcome { ok: boolean; ms: number; code?: number; reason?: string; handle?: string; ev: string }

export async function runLiveTest(agent: Agent, outFile: string): Promise<number> {
  const argv = process.argv
  const onlyLive = argv.includes('--only-live'), onlyModel = argv.includes('--only-model')
  // optional real speech (a WAV made with Windows' own speech engine, written to a file: nothing is played), 16 kHz mono 16-bit
  let speech: Buffer | null = null
  const sp = argv.indexOf('--speech')
  if (sp >= 0 && argv[sp + 1]) { try { const w = readFileSync(argv[sp + 1]); speech = w.subarray(44) } catch { speech = null } }
  ai.setLogger(() => undefined)   // nothing is written to the person's main.log
  const rows: Row[] = []
  const lines: string[] = []
  const say = (s: string) => { lines.push(s); console.log(redact(s)) }
  const add = (section: string, step: string, ok: boolean | null, ms: number, evidence: string) => { rows.push({ section, step, ok, ms, evidence: redact(evidence) }); say(`${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${section} / ${step}  (${ms} ms)  ${redact(evidence)}`) }
  const key = getKey()
  say(`Lokey --livetest  ${new Date().toISOString()}  (reads your saved settings and keys, writes nothing of yours)`)
  say(`voice key: ${key ? 'present' : 'MISSING'}; live model in settings: ${settings.value.voice.model}`)

  // ================= LIVE =================
  const trial = async (t: Trial): Promise<Outcome> => {
    const setup = agent.liveSetup(!!t.resume)
    const manual = t.shape === 'ptt-server' || t.shape === 'typed-server' ? false : setup.manual
    const s = new GeminiSession({ key: key!, model: t.model ?? setup.model, voice: setup.voice, system: t.bare ? BARE : setup.system, tools: t.tools === false ? [] : setup.tools, manual, resume: t.resume, minimal: t.minimal })
    let closed: { code: number; reason: string } | null = null, turn = false, text = '', audio = 0, handle = '', tool = ''
    s.on('closed', (reason, code) => { closed = { code, reason } })
    s.on('turnComplete', () => { turn = true })
    s.on('outText', x => { text += x })
    s.on('audio', b => { audio += b.length })
    s.on('handle', h => { handle = h })
    s.on('toolCall', calls => { for (const c of calls) { tool += c.name + ' '; s.toolResponse(c.id, c.name, { ok: false, error: 'this is a protocol test, no tools run' }) } })
    const t0 = Date.now()
    try { await s.connect() } catch (e) { const code = e instanceof AiError ? e.status : 0; return { ok: false, ms: Date.now() - t0, code, reason: e instanceof Error ? e.message : String(e), ev: `did not get past setup: ${e instanceof Error ? e.message : String(e)}` } }
    const up = Date.now()
    try {
      if (t.shape === 'typed') { s.activityStart(); s.sendNote('Reply with just the word ok.'); s.activityEnd() }   // what 0.5.1 to 0.8.2 sent for a typed turn
      else if (t.shape === 'typed-text' || t.shape === 'typed-server' || t.shape === 'resume') s.sendText('Reply with just the word ok.')   // the app's own sendText: realtimeInput.text on its own
      else if (t.shape === 'typed-client') s.sendClientText('Reply with just the word ok.')
      else if (t.shape === 'empty') { s.activityStart(); await wait(300); s.activityEnd() }
      else if (t.shape === 'short') { s.activityStart(); s.sendAudio(tone(0.15)); s.activityEnd() }
      else if (t.shape === 'ptt' || t.shape === 'ptt-legacy' || t.shape === 'ptt-server') {
        s.activityStart()
        const pcm = speech ?? tone(2)
        for (let i = 0; i < pcm.length; i += 3200) { s.sendAudio(pcm.subarray(i, i + 3200)); await wait(20) }
        if (t.shape === 'ptt-legacy') s.sendNote('(Context for this turn, not from the user: it is Friday.)')   // the 0.8.0 shape: text inside the audio activity
        s.activityEnd()
      }
      const limit = t.shape === 'connect' ? 3000 : 20_000
      const end = Date.now() + limit
      while (!turn && !closed && Date.now() < end) await wait(50)
      if (turn && !closed) await wait(300)   // a refusal would arrive right after
    } finally { const sent = s.diagnostics(); s.close('livetest'); (s as unknown as { _d: string })._d = sent }
    const sent = (s as unknown as { _d: string })._d
    const c = closed as { code: number; reason: string } | null
    const ok = t.shape === 'connect' ? !c : turn && !c
    return { ok, ms: Date.now() - up, code: c?.code, reason: c?.reason, handle, ev: `turnComplete=${turn} replyChars=${text.length} audioBytes=${audio}${tool ? ` toolCalls=${tool.trim()}` : ''}${c ? ` CLOSED ${c.code} "${c.reason}"` : ''}; ${sent}` }
  }
  const logTrial = (label: string, o: Outcome) => add('LIVE', label, o.ok, o.ms, o.ev)

  let models: string[] = []
  if (onlyModel) { /* the live part is skipped */ } else if (!key) add('LIVE', 'voice key', false, 0, 'no Gemini key saved, nothing to test')
  else {
    try { const t0 = Date.now(); models = await listLiveModels(key); add('LIVE', 'models that support the Live API', models.includes(settings.value.voice.model) ? true : null, Date.now() - t0, `${models.join(', ') || 'none listed'}${models.includes(settings.value.voice.model) ? '' : `  (the model in settings, ${settings.value.voice.model}, is NOT in this list)`}`) }
    catch (e) { add('LIVE', 'models that support the Live API', false, 0, userMessage(e)) }
    const base: [string, Trial][] = [['connect + setupComplete (idle 3 s)', { shape: 'connect' }], ['typed turn A: activityStart, text, activityEnd (what 0.5.1-0.8.2 send)', { shape: 'typed' }], ['typed turn B: text only (no activity messages), manual-turn setup', { shape: 'typed-text' }], ['typed turn C: clientContent with turnComplete', { shape: 'typed-client' }], ['typed turn D: text only, server-side turn detection', { shape: 'typed-server' }], [`push-to-talk turn, 0.8.2 shape (activityStart, ${speech ? 'real speech' : '2 s tone'}, activityEnd)`, { shape: 'ptt' }], ['push-to-talk turn, 0.8.0 LEGACY shape (text inside the audio activity)', { shape: 'ptt-legacy' }], ['EMPTY activity (activityStart, activityEnd, no audio)', { shape: 'empty' }], ['SHORT activity (150 ms of audio)', { shape: 'short' }]]
    const res: Record<string, Outcome> = {}
    for (const [label, t] of base) { const o = await trial(t); res[t.shape] = o; logTrial(label, o); await wait(800) }
    // bisect whatever still fails
    const failing = (['ptt'] as const).filter(s => !res[s].ok)   // (typed A / empty / short are EXPECTED to fail on some models; they are the experiment)
    if (!res.connect.ok || failing.length) {
      say('--- bisecting: same turns with parts left out ---')
      const shape: Shape = failing[0] ?? 'ptt'
      const variants: [string, Trial][] = [['no tools', { shape, tools: false }], ['no tools + 2-line system prompt', { shape, tools: false, bare: true }], ['no tools + 2-line prompt + minimal setup fields', { shape, tools: false, bare: true, minimal: true }], ['minimal setup fields only', { shape, minimal: true }], ['server-side voice detection instead of manual turns', { shape: 'ptt-server', tools: false, bare: true, minimal: true }]]
      for (const [label, t] of variants) { logTrial(`${shape}: ${label}`, await trial(t)); await wait(800) }
      for (const m of models.filter(x => x !== settings.value.voice.model).slice(0, 4)) {
        logTrial(`${shape} on ${m} (minimal)`, await trial({ shape, model: m, tools: false, bare: true, minimal: true }))
        await wait(800)
      }
    } else say('--- no bisecting needed: every flow was accepted ---')
    // resume round trip
    const h = res['typed-text']?.handle || res.ptt?.handle
    if (h) { logTrial('resume with the handle from a good session, then a typed turn', await trial({ shape: 'resume', resume: h })) }
    else add('LIVE', 'resume handle', null, 0, 'the server sent no resumption handle in the short window')
    add('LIVE', 'goAway', null, 0, 'not triggered: the server only sends it near the end of a long session, not testable in a short run')
  }

  // ================= MODEL SIDE =================
  if (onlyLive) { say(`SUMMARY (live only): ${rows.filter(r => r.ok).length} passed, ${rows.filter(r => r.ok === false).length} failed`); try { writeFileSync(outFile, redact(lines.join('\n'))) } catch { /* stdout has it */ } return rows.some(r => r.ok === false) ? 1 : 0 }
  say('--- model side, one provider at a time, through the gateway ---')
  const providers = settings.value.brain.providers
  const gw = (c: ProviderConfig, role: ProviderConfig['roles'][number]) => new Gateway(() => [{ ...c, enabled: true, roles: [role] }], getSecret, { db: null })
  const timed = async <T>(f: () => Promise<T>) => { await wait(1200); const t0 = Date.now(); try { return { v: await Promise.race([f(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out after 60 s: the model never answered')), 60_000))]), ms: Date.now() - t0, err: null as null | string } } catch (e) { return { v: null as T | null, ms: Date.now() - t0, err: e instanceof AiError ? `${e.kind}: ${userMessage(e, undefined)}` : userMessage(e) } } }
  for (const c of providers) {
    const sec = c.name
    if (!c.enabled) { add(sec, 'status', null, 0, 'switched off'); continue }
    const hasKey = !!getSecret(c.keyRef)
    add(sec, 'setup', c.model.trim() ? true : null, 0, `kind=${c.kind} model=${c.model || '(empty)'} key=${hasKey ? 'present' : 'none'} roles=${c.roles.join(',')}${c.baseUrl ? ` base=${c.baseUrl}` : ''}`)
    if (c.kind === 'gemini' && !hasKey) { add(sec, 'chat', false, 0, 'no key saved'); continue }
    const test = await timed(() => gw(c, c.roles[0] ?? 'main').test(c.id))
    if (c.kind === 'openai') {
      if (!c.model.trim()) { add(sec, 'server and models', test.v?.ok ? true : false, test.ms, test.v?.error ?? test.err ?? ''); continue }
      add(sec, 'ping + tool-call probe (Test button)', test.v?.ok === true && test.v.tools !== false, test.ms, test.v ? `${test.v.ok ? 'reply ok' : test.v.error}${test.v.tools === undefined ? '' : `; calls tools: ${test.v.tools}`}` : test.err ?? '')
    }
    const role = c.roles.find(r => r === 'main') ?? c.roles.find(r => r === 'fast') ?? c.roles[0]
    if (role === 'main' || role === 'fast') {
      const chat = await timed(() => gw(c, role).call(role, { system: 'Reply with the single word: ok', messages: [{ role: 'user', text: 'ping' }], maxTokens: 16, temperature: 0 }, { op: 'livetest' }))
      add(sec, `chat (${role})`, !!chat.v?.text, chat.ms, chat.v ? `reply "${chat.v.text.slice(0, 30)}", ${chat.v.usage.in}+${chat.v.usage.out} tokens` : chat.err ?? '')
      const probe = await timed(() => gw(c, role).probe(c))
      add(sec, 'tool-call probe', probe.v === null ? null : probe.v === true, probe.ms, probe.err ?? (probe.v === null ? 'inconclusive: the call itself failed (see the chat line)' : `calls a tool when told to: ${probe.v}`))
      const js = await timed(() => gw(c, role).callJson(role, { system: 'Answer ONLY with JSON {"a":1}', messages: [{ role: 'user', text: 'go' }], temperature: 0, maxTokens: 40 }, { type: 'object', required: ['a'], props: { a: { type: 'number' } } }, { op: 'livetest' }))
      add(sec, 'JSON mode', js.v !== null, js.ms, js.err ?? JSON.stringify(js.v))
    }
    if (c.roles.includes('vision')) {
      const v = await timed(() => gw(c, 'vision').call('vision', { system: 'Answer in one word.', messages: [{ role: 'user', text: 'Is this picture empty? yes or no', images: [PIXEL] }], maxTokens: 20, temperature: 0 }, { op: 'livetest' }))
      add(sec, 'vision (a 1x1 picture)', !!v.v, v.ms, v.err ?? `reply "${v.v?.text.slice(0, 30)}"`)
    }
    if (c.roles.includes('transcribe')) {
      const clip = wav(tone(2)).toString('base64')
      const tr = await timed(() => gw(c, 'transcribe').call('transcribe', { system: buildPrompt('english'), messages: [{ role: 'user', text: 'Transcribe this recording.', audio: clip }], temperature: 0, maxTokens: 200 }, { op: 'livetest', allowEmpty: true }))
      add(sec, 'dictation / transcribe (2 s tone)', !!tr.v, tr.ms, tr.err ?? `reply "${tr.v?.text.slice(0, 40)}" (a tone has no words: "<none>" or nothing is right)`)
    }
    if (c.roles.includes('embed')) {
      const g = gw(c, 'embed')
      const e = await timed(() => g.embed(['hello world', 'good morning'], 'query'))
      const why = g.traces({ failed: true })[0]
      add(sec, 'embeddings', !!e.v, e.ms, e.v ? `${e.v.length} vectors of ${e.v[0].length}` : `${why?.kind ?? ''} ${why?.note ?? e.err ?? ''}`)
    }
    if (c.roles.includes('search')) {
      const se = await timed(() => gw(c, 'search').search('What is the capital of France?', { op: 'livetest' }))
      add(sec, 'search / grounding', !!se.v?.text, se.ms, se.err ?? `answer "${se.v?.text.slice(0, 60)}", ${se.v?.sources.length} sources`)
    }
  }

  const bad = rows.filter(r => r.ok === false)
  say('')
  say(`SUMMARY: ${rows.filter(r => r.ok).length} passed, ${bad.length} failed, ${rows.filter(r => r.ok === null).length} informational`)
  for (const r of bad) say(`  FAILED: ${r.section} / ${r.step}: ${r.evidence.slice(0, 200)}`)
  try { writeFileSync(outFile, redact(lines.join('\n'))) } catch { /* stdout has it */ }
  return bad.some(r => r.section === 'LIVE') ? 1 : 0
}
