import type { Sidecar } from '../sidecar'
import { settings } from '../settings'
import { guard } from '../ai/guard/policy'
import { Agent } from './agent'
import { captionBar } from './overlays'

// `--selfcheck`: the path from the voice model's transcripts to the caption bar, on the REAL Agent with a stub bar (nothing is shown, no network, no microphone).
// What Live sends as inputTranscription / outputTranscription reaches the Agent as onSaid / onReply (ai/live/selfcheck.ts proves the session emits them); here
// each of those must become a 'said' / 'reply' caption, and the end of the turn, a cancel, a notice and the "controlling" indicator must all end with a clear.
export async function captionSelfCheck(): Promise<string> {
  let n = 0
  const problems: string[] = []
  const ok = (c: boolean, m: string) => { n++; if (!c) problems.push(m) }
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  const sent: { kind: string; text?: string }[] = []
  const closes: number[] = []
  const bar = captionBar as unknown as { send: (m: { kind: string; text?: string }) => void; closeSoon: (ms: number) => void }
  const orig = { send: bar.send, closeSoon: bar.closeSoon }
  bar.send = m => { sent.push(m) }
  bar.closeSoon = ms => { closes.push(ms) }
  const speak = settings.value.voice.speakReplies
  settings.value.voice.speakReplies = false   // nothing waits for a speaker
  const agent = new Agent({ call: async () => ({}) } as unknown as Sidecar, () => undefined)
  agent.demo = true
  const a = agent as unknown as Record<string, any>
  try {
    // a spoken turn: transcripts become captions, the end of the turn clears them
    a.resetTurn('assistant'); a.sent = true; a.turnDone = false
    a.onSaid('open chro'); a.onSaid('me')
    ok(sent.some(m => m.kind === 'said' && m.text === 'open chrome'), 'the input transcript becomes a "You" caption (said), growing as more arrives')
    a.onReply('Opening ')
    a.onReply('Chrome.')
    ok(sent.some(m => m.kind === 'reply' && m.text === 'Opening Chrome.'), 'the output transcript becomes a "Lokey" caption (reply)')
    a.onTurnComplete()
    ok(a.state === 'idle', 'with nothing to speak the turn ends at once')
    sent.length = 0; closes.length = 0
    await wait(3600)
    ok(sent.some(m => m.kind === 'clear') && closes.length >= 1, 'a finished turn clears the caption by itself (about 3 s) and closes the bar')

    // a notice clears by itself
    sent.length = 0; closes.length = 0
    agent.notice('Voice is back.', 'info')
    ok(sent.some(m => m.kind === 'notice'), 'a notice is shown')
    await wait(3600)
    ok(sent.some(m => m.kind === 'clear') && closes.length >= 1, 'a notice is cleared by itself, never left up')

    // cancel: cleared at once
    sent.length = 0; closes.length = 0
    a.held = true; a.caption('said', 'half a sentence'); agent.cancel()
    ok(sent.some(m => m.kind === 'clear') && closes.includes(700), 'cancelling a press clears the caption and closes the bar')

    // the "controlling" line is a hold, repeated while true, and gone when the job ends
    sent.length = 0; closes.length = 0
    a.controlling(true)
    ok(sent.some(m => m.kind === 'hold'), 'the controlling indicator is a hold caption')
    a.controlEnded()
    await wait(900)
    ok(sent.some(m => m.kind === 'clear') && a.controlTimer === null, 'when the job ends (done, failed, parked or stopped) the indicator is cleared even if the control-off event never came')

    // stop everything clears and says so
    sent.length = 0; closes.length = 0
    a.controlling(true); agent.stopAll()
    ok(a.controlTimer === null, 'stop-all ends the controlling indicator')
    await wait(3600)
    ok(sent.some(m => m.kind === 'clear'), 'stop-all: the "Stopped everything." notice is cleared too')

    // the voice ladder in the Agent: a socket that dies under a turn does not lose it (audio -> speech-to-text, typed -> text answer, pictures kept), and Live-less answers are spoken
    const rec: [string, unknown, number][] = []
    a.degradedAudio = async (pcm: Buffer, imgs: Buffer[]) => { rec.push(['audio', pcm.length, imgs.length]) }
    a.degradedTurn = async (t: string, imgs: Buffer[]) => { rec.push(['text', t, imgs.length]) }
    a.typed = false; a.turnAudio = [Buffer.alloc(32 * 1000)]; a.turnImages = [Buffer.from('jpeg')]; a.said = ''; a.lastText = ''
    ok(a.salvage() === true && rec[0]?.[0] === 'audio' && rec[0][2] === 1 && a.turnAudio.length === 0, 'a push-to-talk turn whose socket died is salvaged from its audio, with its picture (lasso)')
    a.typed = true; a.said = 'open chrome'; a.turnAudio = []
    ok(a.salvage() === true && rec[1]?.[0] === 'text' && rec[1][1] === 'open chrome' && rec[1][2] === 1, 'a typed turn is answered as text, with its picture')
    a.typed = false; a.said = ''; a.lastText = ''; a.turnAudio = [Buffer.alloc(100)]
    ok(a.salvage() === false, 'a tap is not salvaged')
    settings.value.voice.speakReplies = true
    agent.demo = false
    const said: string[] = []
    ;(agent.audio as unknown as { say: (t: string) => Promise<void> }).say = async t => { said.push(t) }
    a.setState('idle')
    a.speakPlain('Your job finished. **Done.**')
    ok(said[0] === 'Your job finished. Done.' && a.state === 'speaking', 'the last rung: a reply with Live down is spoken with the system voice (the state is speaking)')
    agent.audio.emit('drained')
    ok(a.state === 'idle', 'and the turn ends when the speaker is done')
    settings.value.voice.speakReplies = false
    said.length = 0; a.speakPlain('quiet'); ok(said.length === 0, 'nothing is spoken when speaking replies is off')
    ok(agent.voiceStatus().rung === 'live' || agent.voiceStatus().rung === 'text' || agent.voiceStatus().rung === 'spoken-text', 'the voice status names its rung for the Models page')
  } finally {
    guard.newTurn()
    bar.send = orig.send; bar.closeSoon = orig.closeSoon
    settings.value.voice.speakReplies = speak
    try { agent.dispose() } catch { /* a test agent */ }
  }
  if (problems.length) throw new Error('captions: ' + problems.join(' | '))
  return `captions ok (${n} checks)`
}
