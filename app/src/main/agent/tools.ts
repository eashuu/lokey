import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from 'electron'
import type { Sidecar } from '../sidecar'
import { dataDir } from '../settings'
import type { FunctionDecl } from './session'
import type { Scheduler } from './scheduler'

// What the assistant is allowed to do. Everything here is reversible or harmless: no deleting, no shell, no purchases,
// no sending messages. A tool returns a result for the model and an optional line to show the user.

export interface ToolCtx { sidecar: Sidecar; scheduler: Scheduler; abilities: string[] }
export interface ToolResult { result: Record<string, unknown>; say?: string }

// ---- web helpers --------------------------------------------------------------------------------------------
const SITES: Record<string, { home: string; search?: string; label: string }> = {
  netflix: { home: 'https://www.netflix.com/browse', search: 'https://www.netflix.com/search?q=', label: 'Netflix' },
  youtube: { home: 'https://www.youtube.com', search: 'https://www.youtube.com/results?search_query=', label: 'YouTube' },
  amazon: { home: 'https://www.amazon.com', search: 'https://www.amazon.com/s?k=', label: 'Amazon' },
  google: { home: 'https://www.google.com', search: 'https://www.google.com/search?q=', label: 'Google' },
  gmail: { home: 'https://mail.google.com', label: 'Gmail' },
  maps: { home: 'https://www.google.com/maps', search: 'https://www.google.com/maps/search/', label: 'Google Maps' },
  github: { home: 'https://github.com', search: 'https://github.com/search?q=', label: 'GitHub' },
  wikipedia: { home: 'https://wikipedia.org', search: 'https://en.wikipedia.org/w/index.php?search=', label: 'Wikipedia' },
  reddit: { home: 'https://www.reddit.com', search: 'https://www.reddit.com/search/?q=', label: 'Reddit' },
  spotify: { home: 'https://open.spotify.com', search: 'https://open.spotify.com/search/', label: 'Spotify' },
  steam: { home: 'https://store.steampowered.com', search: 'https://store.steampowered.com/search/?term=', label: 'Steam' },
}
const siteFor = (name: string) => SITES[name.toLowerCase().replace(/[^a-z]/g, '')]

function safeUrl(u: string): string | null {
  try {
    const x = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`)
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : null
  } catch { return null }
}

// ---- memory -------------------------------------------------------------------------------------------------
const memFile = join(dataDir, 'memory.json')
export function readMemory(): string[] { try { return JSON.parse(readFileSync(memFile, 'utf8')) as string[] } catch { return [] } }
export function writeMemory(m: string[]) { try { mkdirSync(dataDir, { recursive: true }); writeFileSync(memFile, JSON.stringify(m.slice(-200), null, 2)) } catch { /* keep going */ } }

// ---- parsing "when" -----------------------------------------------------------------------------------------
/** delay in minutes, or a clock time ("19:00", "7pm", ISO) -> the next such moment; null if it cannot be understood */
export function parseWhen(a: { delay_minutes?: unknown; at?: unknown }, now = new Date()): Date | null {
  const d = Number(a.delay_minutes)
  if (a.delay_minutes !== undefined && Number.isFinite(d) && d >= 0) return new Date(now.getTime() + d * 60_000)
  const at = String(a.at ?? '').trim()
  if (!at) return null
  const iso = Date.parse(at)
  if (/^\d{4}-\d{2}-\d{2}/.test(at) && !Number.isNaN(iso)) return new Date(iso)
  const m = at.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  const t = new Date(now)
  t.setHours(h, min, 0, 0)
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1)
  return t
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
export function describeWhen(d: Date, now = new Date()): string {
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = d.toDateString() === new Date(now.getTime() + 86_400_000).toDateString()
  return `${sameDay ? 'today' : tomorrow ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} at ${clock(d)}`
}

// ---- declarations the model sees ------------------------------------------------------------------------------
const STEP = { type: 'OBJECT', properties: { tool: { type: 'STRING', description: 'open_app, open_url, web_search, media, set_volume' }, args: { type: 'OBJECT', description: 'arguments for that tool' } }, required: ['tool', 'args'] }

export const TOOLS: FunctionDecl[] = [
  { name: 'open_app', description: 'Open an installed Windows app, or a well-known website (Netflix, YouTube, Gmail...) when no app matches.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'app or site name, e.g. "Visual Studio Code"' } }, required: ['name'] } },
  { name: 'open_url', description: 'Open a web address in the default browser.', parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] } },
  { name: 'web_search', description: 'Search the web or a specific site in the browser.', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, site: { type: 'STRING', description: 'optional: amazon, youtube, google, github, maps, wikipedia, reddit, spotify, steam, netflix' } }, required: ['query'] } },
  { name: 'schedule', description: 'Run actions later. Give either delay_minutes or a clock time in `at` (24h "19:00", "7pm" or an ISO date-time). Steps use the same tools as above. Always call this instead of doing the action now when the user names a time or delay.', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING', description: 'short label, e.g. "Open Netflix"' }, delay_minutes: { type: 'NUMBER' }, at: { type: 'STRING' }, steps: { type: 'ARRAY', items: STEP }, say: { type: 'STRING', description: 'what to say when it runs, e.g. "Opening Netflix."' } }, required: ['title', 'steps', 'say'] } },
  { name: 'list_tasks', description: 'List the scheduled tasks.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'cancel_task', description: 'Cancel a scheduled task by id.', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] } },
  { name: 'media', description: 'Control the playing media.', parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', description: 'play, pause, toggle, next, prev' } }, required: ['action'] } },
  { name: 'set_volume', description: 'Set system volume 0-100, or mute/unmute.', parameters: { type: 'OBJECT', properties: { percent: { type: 'NUMBER' }, muted: { type: 'BOOLEAN' } } } },
  { name: 'set_brightness', description: 'Set screen brightness 0-100.', parameters: { type: 'OBJECT', properties: { percent: { type: 'NUMBER' } }, required: ['percent'] } },
  { name: 'remember', description: 'Remember a short fact about the user for later conversations.', parameters: { type: 'OBJECT', properties: { fact: { type: 'STRING' } }, required: ['fact'] } },
  { name: 'forget', description: 'Forget remembered facts containing this text.', parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] } },
]
const RUNNABLE_LATER = new Set(['open_app', 'open_url', 'web_search', 'media', 'set_volume'])

// ---- execution -------------------------------------------------------------------------------------------------
export async function runTool(name: string, a: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult> {
  const { sidecar } = ctx
  const str = (k: string) => String(a[k] ?? '').trim()
  switch (name) {
    case 'open_app': {
      const q = str('name').toLowerCase()
      if (!q) return { result: { ok: false, error: 'no name' } }
      const apps = await sidecar.call('apps.list', {}).catch(() => [])
      const score = (n: string) => { const l = n.toLowerCase(); return l === q ? 3 : l.startsWith(q) ? 2 : l.includes(q) ? 1 : 0 }
      const best = apps.map(x => ({ x, s: score(x.name) })).filter(o => o.s > 0).sort((p, r) => r.s - p.s || (r.x.lastUsed ?? 0) - (p.x.lastUsed ?? 0))[0]
      if (best) { await sidecar.call('apps.launch', { id: best.x.id }); return { result: { ok: true, opened: best.x.name }, say: `Opening ${best.x.name}.` } }
      const site = siteFor(q)
      if (site) { await shell.openExternal(site.home); return { result: { ok: true, opened: site.label }, say: `Opening ${site.label}.` } }
      return { result: { ok: false, error: `no app named "${str('name')}"` }, say: `I couldn't find ${str('name')}.` }
    }
    case 'open_url': {
      const u = safeUrl(str('url'))
      if (!u) return { result: { ok: false, error: 'not a web address' } }
      await shell.openExternal(u)
      return { result: { ok: true }, say: `Opening ${new URL(u).hostname.replace(/^www\./, '')}.` }
    }
    case 'web_search': {
      const q = str('query')
      if (!q) return { result: { ok: false, error: 'empty query' } }
      const site = siteFor(str('site') || 'google') ?? SITES.google
      const url = (site.search ?? SITES.google.search!) + encodeURIComponent(q)
      await shell.openExternal(url)
      return { result: { ok: true, site: site.label }, say: `Opening ${site.label}, searching for ${q}.` }
    }
    case 'schedule': {
      const when = parseWhen(a)
      if (!when) return { result: { ok: false, error: 'give delay_minutes or a clock time in `at`' } }
      const steps = (Array.isArray(a.steps) ? a.steps : []).filter((s): s is { tool: string; args: Record<string, unknown> } => !!s && typeof s === 'object' && RUNNABLE_LATER.has((s as { tool?: string }).tool ?? '')).slice(0, 6)
      if (!steps.length) return { result: { ok: false, error: 'no runnable steps' } }
      const t = ctx.scheduler.add({ title: str('title') || 'Task', runAt: when.toISOString(), steps, say: str('say') || 'Running your task.' })
      const first = steps[0]
      const what = first.tool === 'open_app' ? `open ${String(first.args.name ?? '')}` : first.tool === 'web_search' ? `search for ${String(first.args.query ?? '')}` : str('title').toLowerCase()
      return { result: { ok: true, id: t.id, runs: when.toISOString() }, say: `Scheduled: I will ${what} ${describeWhen(when)}.` }
    }
    case 'list_tasks': return { result: { tasks: ctx.scheduler.list().filter(t => t.status === 'pending').map(t => ({ id: t.id, title: t.title, runAt: t.runAt })) } }
    case 'cancel_task': { ctx.scheduler.cancel(str('id')); return { result: { ok: true }, say: 'Cancelled.' } }
    case 'media': {
      const action = str('action')
      if (!['play', 'pause', 'toggle', 'next', 'prev'].includes(action)) return { result: { ok: false, error: 'unknown action' } }
      await sidecar.call('media.control', { action: action as 'play' })
      return { result: { ok: true } }
    }
    case 'set_volume': {
      if (typeof a.muted === 'boolean') await sidecar.call('audio.setMuted', { muted: a.muted })
      if (a.percent !== undefined) await sidecar.call('audio.setVolume', { level: Math.max(0, Math.min(1, Number(a.percent) / 100)) })
      return { result: { ok: true } }
    }
    case 'set_brightness': await sidecar.call('system.setBrightness', { level: Math.max(0, Math.min(1, Number(a.percent) / 100)) }); return { result: { ok: true } }
    case 'remember': { const f = str('fact').slice(0, 300); if (f) writeMemory([...readMemory().filter(x => x !== f), f]); return { result: { ok: true }, say: 'Got it.' } }
    case 'forget': { const t = str('text').toLowerCase(); writeMemory(readMemory().filter(x => !x.toLowerCase().includes(t))); return { result: { ok: true } } }
    default: return { result: { ok: false, error: `unknown tool ${name}` } }
  }
}

/** pure helper checks (no network, no OS): `--selfcheck` style, called from tests/dev */
export function toolsSelfCheck(): string {
  const now = new Date('2026-03-01T18:30:00')
  const need = (c: boolean, m: string) => { if (!c) throw new Error('tools: ' + m) }
  need(parseWhen({ delay_minutes: 30 }, now)?.getTime() === now.getTime() + 30 * 60_000, 'delay')
  need(parseWhen({ at: '19:00' }, now)?.getHours() === 19, '19:00 today')
  need(parseWhen({ at: '7am' }, now)?.getDate() === 2, '7am is tomorrow when past')
  need(parseWhen({ at: '12am' }, now)?.getHours() === 0, '12am')
  need(parseWhen({ at: 'whenever' }, now) === null, 'garbage')
  need(describeWhen(new Date('2026-03-01T19:00:00'), now).startsWith('today at'), 'describe today')
  need(safeUrl('javascript:alert(1)') === null && safeUrl('example.com/a') === 'https://example.com/a', 'url safety')
  return 'tools ok'
}
