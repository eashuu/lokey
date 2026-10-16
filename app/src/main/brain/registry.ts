import type { DeepPartial, Settings } from '@shared/bridge'

// Lokey's own settings, described so the assistant can change them when asked ("make the island bigger", "use Tamil replies",
// "switch to light theme", "move yourself to the right edge"). Each entry says what the setting is, what values it accepts and
// whether changing it needs the user's OK. Anything not listed here (keys, providers, full control, MCP servers) cannot be
// changed by voice at all.
export type Risk = 'safe' | 'ask' | 'blocked'
export interface Entry {
  path: string
  label: string
  type: 'bool' | 'enum' | 'number' | 'text' | 'color' | 'hotkey'
  options?: string[]
  min?: number; max?: number
  risk: Risk
  /** extra words people use for it, for finding it from a sentence */
  words?: string
  note?: string
}

export const SKINS = ['puff', 'bloom', 'sunny', 'minty', 'sky', 'droplet', 'ember', 'wisp', 'amethyst', 'gilded']
const TABS = ['controls', 'today', 'stats', 'clipboard', 'apps', 'wallpaper', 'power']
const COLORS: Record<string, string> = { red: '#e5484d', orange: '#f76b15', yellow: '#f5d90a', green: '#30a46c', teal: '#12a594', cyan: '#00a2c7', blue: '#3e63dd', indigo: '#5b5bd6', purple: '#8e4ec6', violet: '#8e4ec6', pink: '#d6409f', magenta: '#d6409f', white: '#e6e8ee', gold: '#d9a441' }

export const ENTRIES: Entry[] = [
  { path: 'appearance.theme', label: 'Theme', type: 'enum', options: ['dark', 'light', 'auto'], risk: 'safe', words: 'island theme dark mode light mode follow windows colour scheme' },
  { path: 'appearance.accent', label: 'Accent colour', type: 'color', risk: 'safe', words: 'accent colour color highlight wallpaper', note: '"wallpaper", a colour name, or #rrggbb' },
  { path: 'appearance.scale', label: 'Overall size', type: 'number', min: 0.75, max: 1.5, risk: 'safe', words: 'scale zoom ui size bigger smaller' },
  { path: 'appearance.animSpeed', label: 'Animation speed', type: 'number', min: 0, max: 2, risk: 'safe', words: 'animations speed faster slower' },
  { path: 'appearance.reduceMotion', label: 'Reduce motion', type: 'bool', risk: 'safe', words: 'animations motion calm' },
  { path: 'island.size', label: 'Island size', type: 'number', min: 0.7, max: 1.2, risk: 'safe', words: 'island notch bigger smaller size' },
  { path: 'island.trigger', label: 'How the island opens', type: 'enum', options: ['scroll', 'hover', 'both'], risk: 'safe', words: 'open scroll hover trigger' },
  { path: 'island.rest', label: 'Resting shape', type: 'enum', options: ['sleep', 'awake'], risk: 'safe', words: 'closed idle rest awake sleeping' },
  { path: 'island.sleepLook', label: 'Sleeping look', type: 'enum', options: ['sliver', 'hairline'], risk: 'safe', words: 'sleeping thin hairline sliver' },
  { path: 'island.edge', label: 'Screen edge', type: 'enum', options: ['top', 'bottom', 'left', 'right'], risk: 'safe', words: 'move island position side edge corner' },
  { path: 'island.offset', label: 'Position along the edge (0 = start/corner, 0.5 = middle, 1 = end/corner)', type: 'number', min: 0, max: 1, risk: 'safe', words: 'corner position left right centre center' },
  { path: 'island.openOnHover', label: 'Open when the pointer rests on it', type: 'bool', risk: 'safe', words: 'hover open' },
  { path: 'island.hoverDelayMs', label: 'Hover delay (ms)', type: 'number', min: 0, max: 600, risk: 'safe', words: 'delay' },
  { path: 'island.closeDelayMs', label: 'Close delay (ms)', type: 'number', min: 100, max: 1500, risk: 'safe', words: 'delay close' },
  { path: 'island.scrollToOpen', label: 'Scroll down to open', type: 'bool', risk: 'safe', words: 'scroll' },
  { path: 'island.startTab', label: 'First tab', type: 'enum', options: TABS, risk: 'safe', words: 'tab default start' },
  { path: 'island.lyrics', label: 'Lyrics lookup', type: 'enum', options: ['on', 'off'], risk: 'safe', words: 'lyrics song' },
  { path: 'island.enabled', label: 'The island itself', type: 'bool', risk: 'ask', words: 'turn off hide island notch' },
  { path: 'loadout.soul', label: 'Mascot skin', type: 'enum', options: SKINS, risk: 'safe', words: 'spirit character colour skin mascot' },
  { path: 'loadout.voice', label: 'Assistant voice', type: 'text', risk: 'safe', words: 'voice speaker tone male female', note: 'a Gemini voice name such as Charon, Puck, Kore, Fenrir, Aoede, Leda, Orus, Zephyr' },
  { path: 'voice.language', label: 'Reply language', type: 'enum', options: ['auto', 'ta', 'en'], risk: 'safe', words: 'language tamil english tanglish reply speak', note: 'auto = match the user, ta = Tamil, en = English' },
  { path: 'voice.speakReplies', label: 'Speak replies aloud', type: 'bool', risk: 'safe', words: 'mute silent captions speak voice' },
  { path: 'voice.halfDuplex', label: 'Pause listening while speaking (conversation mode)', type: 'bool', risk: 'safe', words: 'headphones speakers echo interrupt' },
  { path: 'voice.holdToAnswer', label: 'Answer only after the key is released', type: 'bool', risk: 'safe', words: 'push to talk release' },
  { path: 'voice.dictationScript', label: 'How dictation writes Tamil', type: 'enum', options: ['mixed', 'roman', 'english'], risk: 'safe', words: 'dictation tamil tanglish english script' },
  { path: 'voice.dictation', label: 'Dictation', type: 'bool', risk: 'ask', words: 'dictate typing' },
  { path: 'voice.lasso', label: 'Circle to ask', type: 'bool', risk: 'ask', words: 'circle lasso' },
  { path: 'voice.enabled', label: 'Voice assistant', type: 'bool', risk: 'ask', words: 'voice assistant off on' },
  { path: 'agent.context', label: 'Look at the app in front when asked about "this"', type: 'bool', risk: 'safe', words: 'context screen aware' },
  { path: 'agent.confirmMode', label: 'When to ask before acting', type: 'enum', options: ['risky', 'always'], risk: 'safe', words: 'ask confirm permission careful', note: 'only the safer two; full control can only be given in Settings' },
  { path: 'agent.confirmIn', label: 'Where requests for you appear', type: 'enum', options: ['island', 'window'], risk: 'ask', words: 'confirm card allow deny island window popup', note: 'island = inside the island, window = the separate always-on-top card' },
  { path: 'agent.askSound', label: 'Soft sound when Lokey asks you something', type: 'bool', risk: 'safe', words: 'sound chime ask request' },
  { path: 'brain.maxSteps', label: 'Most steps per background job', type: 'number', min: 4, max: 30, risk: 'safe', words: 'job steps limit' },
  { path: 'brain.learn', label: 'Learn from conversations', type: 'bool', risk: 'safe', words: 'memory learn remember pause privacy' },
  { path: 'wake.enabled', label: 'Wake-up listening (claps and phrases)', type: 'bool', risk: 'ask', words: 'wake word clap hey lokey listening always on microphone' },
  { path: 'wake.claps', label: 'Wake on a double clap', type: 'bool', risk: 'ask', words: 'clap clapping' },
  { path: 'wake.phrases', label: 'Wake on spoken phrases', type: 'bool', risk: 'ask', words: 'hey lokey phrase wake word' },
  { path: 'startWithWindows', label: 'Start with Windows', type: 'bool', risk: 'ask', words: 'startup boot login' },
  { path: 'focusTimerMinutes', label: 'Focus timer length (minutes)', type: 'number', min: 1, max: 180, risk: 'safe', words: 'pomodoro timer focus' },
  { path: 'island.hotkey', label: 'Shortcut: open the island', type: 'hotkey', risk: 'ask', words: 'shortcut hotkey key' },
  { path: 'island.moveKey', label: 'Shortcut: hold to move the island', type: 'hotkey', risk: 'ask', words: 'shortcut hotkey key move' },
  { path: 'island.lyricsKey', label: 'Shortcut: lyrics window', type: 'hotkey', risk: 'ask', words: 'shortcut hotkey key lyrics' },
  { path: 'voice.pushToTalk', label: 'Shortcut: hold to talk', type: 'hotkey', risk: 'ask', words: 'shortcut hotkey key talk' },
  { path: 'voice.dictationKey', label: 'Shortcut: hold to dictate', type: 'hotkey', risk: 'ask', words: 'shortcut hotkey key dictation' },
  { path: 'voice.lassoKey', label: 'Shortcut: circle to ask', type: 'hotkey', risk: 'ask', words: 'shortcut hotkey key circle' },
  { path: 'voice.conversationKey', label: 'Shortcut: conversation mode', type: 'hotkey', risk: 'ask', words: 'shortcut hotkey key conversation' },
  { path: 'agent.stopKey', label: 'Shortcut: stop everything', type: 'hotkey', risk: 'ask', words: 'shortcut hotkey key stop kill' },
]

export const entryFor = (path: string) => ENTRIES.find(e => e.path === path.trim())

export function valueAt(s: unknown, path: string): unknown {
  let v: any = s
  for (const k of path.split('.')) v = v?.[k]
  return v
}

export function patchFor(path: string, value: unknown): DeepPartial<Settings> {
  const keys = path.split('.')
  const out: any = {}
  let cur = out
  keys.forEach((k, i) => { cur[k] = i === keys.length - 1 ? value : {}; cur = cur[k] })
  return out
}

const ON = new Set(['true', 'on', 'yes', 'enable', 'enabled', '1', 'y']), OFF = new Set(['false', 'off', 'no', 'disable', 'disabled', '0', 'n'])
const SYN: Record<string, string> = { 'dark mode': 'dark', night: 'dark', black: 'dark', 'light mode': 'light', white: 'light', bright: 'light', 'follow windows': 'auto', system: 'auto', default: 'auto', tamil: 'ta', english: 'en', match: 'auto', reset: 'auto', normal: 'auto', center: 'middle', centre: 'middle', middle: 'middle' }

/** the typed value for this setting, or why it is not acceptable */
export function coerce(e: Entry, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const str = String(raw ?? '').trim()
  switch (e.type) {
    case 'bool': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      const l = str.toLowerCase()
      return ON.has(l) ? { ok: true, value: true } : OFF.has(l) ? { ok: true, value: false } : { ok: false, error: 'give true or false' }
    }
    case 'number': {
      const n = Number(str)
      if (!Number.isFinite(n)) return { ok: false, error: 'give a number' }
      const lo = e.min ?? -Infinity, hi = e.max ?? Infinity
      return { ok: true, value: Math.min(hi, Math.max(lo, e.path === 'brain.maxSteps' || e.path.endsWith('Ms') || e.path === 'focusTimerMinutes' ? Math.round(n) : n)) }
    }
    case 'enum': {
      let l = str.toLowerCase()
      if (e.path === 'island.offset') return { ok: false, error: 'internal' }
      l = SYN[l] ?? l
      const hit = e.options!.find(o => o === l)
      return hit ? { ok: true, value: hit } : { ok: false, error: `choose one of: ${e.options!.join(', ')}` }
    }
    case 'color': {
      const l = str.toLowerCase()
      if (l === 'wallpaper') return { ok: true, value: 'wallpaper' }
      if (COLORS[l]) return { ok: true, value: COLORS[l] }
      return /^#[0-9a-f]{6}$/i.test(str) ? { ok: true, value: str.toLowerCase() } : { ok: false, error: 'give "wallpaper", a colour name or #rrggbb' }
    }
    case 'hotkey': return /^(?:(?:ctrl|alt|shift|win)\+)*(?:ctrl|alt|shift|win|[a-z0-9]|f\d{1,2}|space|enter|esc|tab|backspace|delete|home|end|up|down|left|right)$/i.test(str) && str.length <= 40 ? { ok: true, value: str.replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/\bCtrl\b/i, 'Ctrl') } : { ok: false, error: 'give a shortcut like Ctrl+Alt+K' }
    case 'text': return str && str.length <= 60 && /^[\w .-]+$/.test(str) ? { ok: true, value: str } : { ok: false, error: 'give a short plain name' }
  }
}

/** a one-line-per-setting list for the tool description (kept short: it is part of every session's setup) */
export function describeAll(): string {
  return ENTRIES.filter(e => e.risk !== 'blocked').map(e => `${e.path}: ${e.label}${e.type === 'enum' ? ` [${e.options!.join('|')}]` : e.type === 'number' ? ` [${e.min}..${e.max}]` : e.type === 'bool' ? ' [on|off]' : e.note ? ` (${e.note})` : ''}`).join('\n')
}

/** settings that match words in a sentence ("theme", "make it bigger") */
export function findEntries(query: string, k = 6): Entry[] {
  const q = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1)
  if (!q.length) return ENTRIES.slice(0, k)
  return ENTRIES.map(e => { const hay = `${e.path} ${e.label} ${e.words ?? ''}`.toLowerCase(); return { e, s: q.filter(w => hay.includes(w)).length } }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.e)
}

export function registrySelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('registry: ' + m) }
  const theme = entryFor('appearance.theme')!
  need((coerce(theme, 'Dark Mode') as any).value === 'dark' && (coerce(theme, 'light') as any).value === 'light' && !coerce(theme, 'purple').ok, 'theme values and synonyms')
  need((coerce(entryFor('island.size')!, '5') as any).value === 1.2 && (coerce(entryFor('island.size')!, '0.9') as any).value === 0.9 && !coerce(entryFor('island.size')!, 'big').ok, 'numbers are clamped')
  need((coerce(entryFor('voice.speakReplies')!, 'off') as any).value === false, 'booleans')
  need((coerce(entryFor('appearance.accent')!, 'Blue') as any).value === '#3e63dd' && !coerce(entryFor('appearance.accent')!, 'javascript:1').ok, 'colours')
  need((coerce(entryFor('island.hotkey')!, 'ctrl+alt+k') as any).ok !== false && !coerce(entryFor('island.hotkey')!, 'rm -rf').ok, 'hotkeys are shaped')
  need(!coerce(entryFor('agent.confirmMode')!, 'full').ok, 'full control cannot be set through the registry')
  need(JSON.stringify(patchFor('island.size', 1)) === '{"island":{"size":1}}', 'patch shape')
  need(findEntries('change the island theme to light')[0].path.includes('theme') || findEntries('change the island theme to light').some(e => e.path === 'appearance.theme'), 'finding settings from a sentence')
  need(ENTRIES.every(e => e.type !== 'enum' || (e.options?.length ?? 0) > 1) && !ENTRIES.some(e => /key$|secret|mcp|providers|fullUntil/i.test(e.path) && e.type !== 'hotkey'), 'nothing secret is exposed')
  return 'registry ok'
}
