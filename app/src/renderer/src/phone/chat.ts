import { create } from 'zustand'
import { bridge } from '@/bridge'
import type { ConfirmRequest, VoiceKind, VoiceState } from '@shared/voice'
import { useIsland } from '@/island/store'
import { usePage } from './nav'

// The phone's replacement for the caption window, the confirm window and the dictation overlay: one store, fed by the same events
// the Windows overlays get (bridge.voice.onEvent, window.lokeyConfirm, window.lokeyOverlay), so the core needs no phone-only path.
// Contract for the page host (the mobile core), when it has no lokeyConfirm / lokeyOverlay of its own:
//   window.dispatchEvent(new CustomEvent('lokey:confirm',   { detail: { id, title, detail, tool, timeoutMs } }))   -> answer arrives as 'lokey:confirm-answer' { id, ok }
//   window.dispatchEvent(new CustomEvent('lokey:dictation', { detail: <DictationEvent> }))

export interface Msg { id: number; kind: 'said' | 'reply' | 'notice' | 'error'; text: string; final: boolean; at: number; typed?: boolean }
export interface Dictation { phase: 'listening' | 'working' | 'done' | 'error'; raw: string; text: string }

interface Chat {
  msgs: Msg[]
  state: VoiceState
  kind: VoiceKind
  convo: boolean
  confirms: (ConfirmRequest & { at: number })[]
  dictation: Dictation | null
  push: (kind: Msg['kind'], text: string, final?: boolean, typed?: boolean) => void
  setDictation: (d: Dictation | null) => void
  clear: () => void
}

let seq = 1
const MAX = 120

export const useChat = create<Chat>((set) => ({
  msgs: [], state: 'idle', kind: 'assistant', convo: false, confirms: [], dictation: null,
  push: (kind, text, final = true, typed) => set(s => {
    const t = text.trim()
    if (!t) return s
    const last = s.msgs[s.msgs.length - 1]
    if ((kind === 'said' || kind === 'reply') && last && last.kind === kind && !last.final) {
      return { msgs: [...s.msgs.slice(0, -1), { ...last, text: t, final }] }
    }
    // a typed request is echoed locally; the core may echo it again as a "said" event: show it once
    if (kind === 'said' && !typed && last?.typed && last.kind === 'said' && last.text === t && Date.now() - last.at < 5000) return s
    return { msgs: [...s.msgs, { id: seq++, kind, text: t, final, at: Date.now(), typed }].slice(-MAX) }
  }),
  setDictation: dictation => set({ dictation }),
  clear: () => set({ msgs: [] }),
}))

/** type a request (same as speaking it) */
export function sendText(text: string) {
  const t = text.trim()
  if (!t) return
  useChat.getState().push('said', t, true, true)
  bridge.voice.say(t)
}

// one request whose answer must not appear in the transcript (a drafted reply): the next final reply goes to the caller
let capture: ((text: string) => void) | null = null
/** ask the assistant for text only (e.g. a reply in the user's voice); resolves with the answer, or '' after `ms` */
export function askText(prompt: string, ms = 30_000): Promise<string> {
  return new Promise(res => {
    const t = setTimeout(() => { capture = null; res('') }, ms)
    capture = text => { clearTimeout(t); capture = null; res(text) }
    bridge.voice.say(prompt)
  })
}

let captionTimer: ReturnType<typeof setTimeout> | undefined

export function initChat() {
  const offs: (() => void)[] = []
  const chat = useChat.getState

  void bridge.voice.info().then(i => useChat.setState({ state: i.state })).catch(() => undefined)
  offs.push(bridge.voice.onEvent(e => {
    if (e.type === 'state') useChat.setState({ state: e.state, kind: e.kind })
    else if (capture && (e.type === 'said' || e.type === 'reply')) { if (e.type === 'reply' && e.final && e.text.trim()) capture(e.text.trim()) }
    else if (e.type === 'said') { if (chat().kind === 'assistant') chat().push('said', e.text, e.final) }
    else if (e.type === 'reply') chat().push('reply', e.text, e.final)
    else if (e.type === 'notice') chat().push(e.tone === 'error' ? 'error' : 'notice', e.text)
    else if (e.type === 'convo') useChat.setState({ convo: e.on })
    // the speech pill under the island for pages that have no transcript on screen
    if ((e.type === 'said' || e.type === 'reply') && e.text && usePage.getState().page !== 'home') {
      useIsland.getState().setCaption({ kind: e.type, text: e.text })
      clearTimeout(captionTimer)
      captionTimer = setTimeout(() => useIsland.getState().setCaption(null), e.final ? 4200 : 9000)
    } else if (e.type === 'clear') useIsland.getState().setCaption(null)
  }))

  // confirm cards
  const addConfirm = (r: ConfirmRequest) => useChat.setState(s => ({ confirms: [...s.confirms.filter(c => c.id !== r.id), { ...r, at: Date.now() }] }))
  window.lokeyConfirm?.onRequest(addConfirm)
  const onConfirm = (e: Event) => addConfirm((e as CustomEvent<ConfirmRequest>).detail)
  window.addEventListener('lokey:confirm', onConfirm)
  offs.push(() => window.removeEventListener('lokey:confirm', onConfirm))

  // dictation result card
  const onDict = (d: { type: string; text?: string }) => {
    const cur = useChat.getState().dictation
    if (d.type === 'start') useChat.setState({ dictation: { phase: 'listening', raw: '', text: '' } })
    else if (d.type === 'raw' || d.type === 'partial') useChat.setState({ dictation: { phase: 'listening', raw: d.text ?? '', text: cur?.text ?? '' } })
    else if (d.type === 'working') useChat.setState({ dictation: { phase: 'working', raw: cur?.raw ?? '', text: '' } })
    else if (d.type === 'clean') useChat.setState({ dictation: { phase: 'done', raw: cur?.raw ?? '', text: d.text ?? '' } })
    else if (d.type === 'error') useChat.setState({ dictation: { phase: 'error', raw: '', text: d.text ?? 'Dictation failed' } })
    else if (d.type === 'cancel') useChat.setState({ dictation: null })
  }
  window.lokeyOverlay?.on('dictation', onDict)
  const onDictEvt = (e: Event) => onDict((e as CustomEvent).detail)
  window.addEventListener('lokey:dictation', onDictEvt)
  offs.push(() => window.removeEventListener('lokey:dictation', onDictEvt))
  return () => offs.forEach(f => f())
}

export function answerConfirm(id: string, ok: boolean) {
  useChat.setState(s => ({ confirms: s.confirms.filter(c => c.id !== id) }))
  if (window.lokeyConfirm) window.lokeyConfirm.answer(id, ok)
  else window.dispatchEvent(new CustomEvent('lokey:confirm-answer', { detail: { id, ok } }))
}

// dev / demo hooks (browser with the mock bridge): window.__chat.push('reply', 'hi'), __chat.confirm({...})
;(window as unknown as { __chat: unknown }).__chat = {
  store: useChat,
  confirm: (r: Partial<ConfirmRequest> = {}) => window.dispatchEvent(new CustomEvent('lokey:confirm', { detail: { id: String(Date.now()), title: 'Send “on my way” to Amma', detail: 'WhatsApp · +91 98xxx xxxxx', tool: 'send_message', timeoutMs: 30000, ...r } })),
  dictation: (d: { type: string; text?: string }) => window.dispatchEvent(new CustomEvent('lokey:dictation', { detail: d })),
}
