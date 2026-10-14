import type { FunctionDecl } from '../agent/session'
import type { ToolResult } from '../agent/tools'
import { logAction } from '../agent/permissions'
import { settings } from '../settings'
import { openMain } from '../windows'
import { ENTRIES, coerce, describeAll, entryFor, findEntries, patchFor, valueAt } from './registry'

// "Change the island theme to light." The assistant changes Lokey's own settings through these tools: a registry says which
// settings exist and what values they take (registry.ts), the value is checked, risky ones show a card first, and the previous
// value is remembered so "undo that" works. Keys, providers, MCP servers and full control are not in the registry at all.
const PAGES = ['home', 'bond', 'soul', 'desk', 'settings']
const SECTIONS = ['general', 'island', 'appearance', 'voice', 'brain', 'shortcuts', 'wallpaper', 'about']

export const SETTINGS_TOOLS: FunctionDecl[] = [
  { name: 'change_setting', description: `Change one of Lokey's own settings (theme, island size and place, language, mascot, shortcuts...). Use the exact path and one of the allowed values. Settings:\n${describeAll()}`, parameters: { type: 'OBJECT', properties: { path: { type: 'STRING', description: 'setting path, e.g. appearance.theme' }, value: { type: 'STRING', description: 'the new value (true/false for switches, a number, or one of the listed words)' } }, required: ['path', 'value'] } },
  { name: 'get_settings', description: 'Look up what Lokey settings exist for a topic and their current values ("theme", "size", "language").', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'topic words' } }, required: ['query'] } },
  { name: 'undo_setting', description: 'Undo the last settings change made through change_setting.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'open_page', description: "Open one of Lokey's own pages: home, bond (what it knows about the user), soul (the mascot), desk (scheduled things and jobs) or settings (optionally a section: general, island, appearance, voice, brain, shortcuts, wallpaper, about).", parameters: { type: 'OBJECT', properties: { page: { type: 'STRING', enum: PAGES }, section: { type: 'STRING', enum: SECTIONS } }, required: ['page'] } },
]
export const SETTINGS_NAMES = new Set(SETTINGS_TOOLS.map(t => t.name))
export const SETTINGS_READ_ONLY = new Set(['get_settings', 'open_page'])

type Cls = { risk: 'safe' | 'ask' | 'deny'; title: string; detail: string }

export function classifySettings(name: string, a: Record<string, unknown>): Cls | null {
  if (!SETTINGS_NAMES.has(name)) return null
  if (name !== 'change_setting') return { risk: 'safe', title: '', detail: '' }
  const e = entryFor(String(a.path ?? ''))
  if (!e || e.risk === 'blocked') return { risk: 'deny', title: 'Refused', detail: 'that setting cannot be changed by voice' }
  if (e.risk === 'ask') return { risk: 'ask', title: `Change “${e.label}”`, detail: `to ${String(a.value)}` }
  return { risk: 'safe', title: '', detail: '' }
}

const undo: { path: string; before: unknown }[] = []

export function runSettingsTool(name: string, a: Record<string, unknown>): ToolResult {
  switch (name) {
    case 'change_setting': {
      const e = entryFor(String(a.path ?? ''))
      if (!e || e.risk === 'blocked') return { result: { ok: false, error: 'there is no such setting that I may change', closest: findEntries(String(a.path ?? ''), 3).map(x => x.path) } }
      const c = coerce(e, a.value)
      if (!c.ok) return { result: { ok: false, error: c.error } }
      const before = valueAt(settings.value, e.path)
      if (before === c.value) return { result: { ok: true, unchanged: true, now: c.value }, say: `It is already ${String(c.value)}.` }
      undo.push({ path: e.path, before }); if (undo.length > 20) undo.shift()
      settings.set(patchFor(e.path, c.value) as never)
      logAction({ tool: 'change_setting', summary: `${e.label}: ${String(before)} → ${String(c.value)}`, outcome: 'done' })
      return { result: { ok: true, setting: e.label, from: before, to: c.value }, say: `${e.label}: ${String(c.value)}.` }
    }
    case 'get_settings': {
      const list = findEntries(String(a.query ?? ''), 6).filter(e => e.risk !== 'blocked')
      return { result: { ok: true, settings: list.map(e => ({ path: e.path, label: e.label, value: valueAt(settings.value, e.path), allowed: e.options ?? (e.min !== undefined ? `${e.min}..${e.max}` : e.type) })) } }
    }
    case 'undo_setting': {
      const last = undo.pop()
      if (!last) return { result: { ok: false, error: 'nothing to undo' } }
      settings.set(patchFor(last.path, last.before) as never)
      return { result: { ok: true, restored: last.path, to: last.before }, say: 'Undone.' }
    }
    case 'open_page': {
      const page = PAGES.includes(String(a.page)) ? String(a.page) : 'home'
      const section = SECTIONS.includes(String(a.section)) ? String(a.section) : undefined
      openMain(page, section)
      return { result: { ok: true } }
    }
    default: return { result: { ok: false, error: 'unknown tool' } }
  }
}

export function settingsToolsSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('settings tools: ' + m) }
  need(classifySettings('change_setting', { path: 'appearance.theme', value: 'light' })?.risk === 'safe', 'theme is a plain change')
  need(classifySettings('change_setting', { path: 'island.hotkey', value: 'Ctrl+K' })?.risk === 'ask', 'shortcuts ask')
  need(classifySettings('change_setting', { path: 'brain.providers', value: 'x' })?.risk === 'deny' && classifySettings('change_setting', { path: 'agent.fullUntil', value: '9' })?.risk === 'deny', 'secrets and full control are not settable')
  need(classifySettings('get_settings', { query: 'x' })?.risk === 'safe' && classifySettings('run_command', {}) === null, 'other tools are not ours')
  need(ENTRIES.length > 30 && describeAll().includes('appearance.theme'), 'the description lists the settings')
  return 'settings tools ok'
}
