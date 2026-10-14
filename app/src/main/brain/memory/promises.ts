import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../../settings'

// Open loops: things the user said they would do or promised someone, extracted by the learn step.
export interface Promise_ { id: string; what: string; who?: string; due?: string; status: 'open' | 'done' | 'dropped'; snoozeUntil?: string; at: string; scheduled?: boolean; nudged?: boolean }
const file = join(dataDir, 'promises.json')
let items: Promise_[] | null = null
const all = () => items ??= (() => { try { return JSON.parse(readFileSync(file, 'utf8')) as Promise_[] } catch { return [] } })()
const save = () => { try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(all().slice(-200))) } catch { /* in-memory only */ } }

/** adds a commitment unless an open one with the same words exists; due must parse as a date or it is dropped */
export function addPromise(what: string, who?: string, due?: string): Promise_ | null {
  what = what.trim().slice(0, 160)
  if (what.length < 4 || all().some(p => p.status === 'open' && p.what.toLowerCase() === what.toLowerCase())) return null
  const d = due && !Number.isNaN(Date.parse(due)) ? new Date(due).toISOString() : undefined
  const p: Promise_ = { id: Math.random().toString(36).slice(2, 8), what, who: who?.trim() || undefined, due: d, status: 'open', at: new Date().toISOString() }
  all().push(p); save()
  return p
}
export const openLoops = (now = Date.now()) => all().filter(p => p.status === 'open' && (!p.snoozeUntil || Date.parse(p.snoozeUntil) <= now))
export function setPromise(id: string, action: 'done' | 'drop' | 'snooze'): boolean {
  const p = all().find(x => x.id === id)
  if (!p) return false
  if (action === 'snooze') p.snoozeUntil = new Date(Date.now() + 86_400_000).toISOString(); else p.status = action === 'done' ? 'done' : 'dropped'
  save()
  return true
}
/** one briefing line, or '' */
export function loopsLine(): string {
  const l = openLoops()
  return l.length ? `Open loops: ${l.slice(0, 3).map(p => p.what + (p.who ? ` (${p.who})` : '')).join('; ')}${l.length > 3 ? ` and ${l.length - 3} more` : ''}.` : ''
}

/** due-time work for the host loop: promises to turn into scheduler reminders, and overdue ones to nudge about (each once) */
export function dueWork(now = Date.now()): { remind: Promise_[]; overdue: Promise_[] } {
  const open = all().filter(p => p.status === 'open' && p.due)
  const remind = open.filter(p => !p.scheduled && Date.parse(p.due!) > now)
  const overdue = open.filter(p => !p.nudged && Date.parse(p.due!) <= now && (!p.snoozeUntil || Date.parse(p.snoozeUntil) <= now))
  remind.forEach(p => { p.scheduled = true }); overdue.forEach(p => { p.nudged = true })
  if (remind.length || overdue.length) save()
  return { remind, overdue }
}
export const allPromises = () => all()
