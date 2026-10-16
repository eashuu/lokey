import { ipcMain } from 'electron'
import type { GEvent, GJob, GModel, GReroute, GraphSnapshot } from '@shared/graph'
import { ai } from '../ai/gateway'
import { loopsChanged, openLoops } from '../brain/memory/promises'
import { ROLES } from '../brain/roles'
import { settings } from '../settings'
import type { Agent } from './agent'

// The "Agents" island tab's feed: jobs, schedule, open loops, which models answer, connectors. Built from what the app already
// keeps; nothing polls. It is recomputed when one of those changes (an event) and pushed to the windows at most twice a second,
// and only while some view has the tab open.
const SERVING_MS = 5 * 60_000

export function graphSnapshot(agent: Agent, now = Date.now()): GraphSnapshot {
  const cfg = settings.value.brain.providers
  let traces: ReturnType<typeof ai.traces> = []
  let st: ReturnType<typeof ai.status> | null = null
  try { traces = ai.traces({ limit: 60 }); st = ai.status() } catch { /* no database yet */ }
  const okRecent = traces.filter(t => t.ok && now - t.at < SERVING_MS)
  const lastForRole = (role: string) => traces.find(t => t.ok && t.role === role && now - t.at < 20 * 60_000)?.provider

  const models: GModel[] = []
  for (const p of st?.providers ?? []) {
    const c = cfg.find(x => x.id === p.id)
    if (c && !c.enabled) continue
    const served = okRecent.filter(t => t.provider === p.id)
    const resting = (p.restingUntil ?? 0) > now || (p.exhaustedUntil ?? 0) > now || p.breaker === 'open'
    if (!served.length && !resting) continue
    models.push({
      id: p.id, name: c?.name ?? 'Gemini Live', model: c?.model ?? '', state: resting ? 'resting' : 'serving',
      roles: [...new Set(served.map(t => t.role))], requests: p.requests, tokens: p.tin + p.tout, note: p.note, until: Math.max(p.restingUntil ?? 0, p.exhaustedUntil ?? 0) || undefined,
    })
  }
  if (!models.length) {
    const c = cfg.find(x => x.enabled && x.roles.includes('main'))
    const p = st?.providers.find(x => x.id === c?.id)
    if (c) models.push({ id: c.id, name: c.name, model: c.model, state: 'idle', roles: ['main'], requests: p?.requests ?? 0, tokens: (p?.tin ?? 0) + (p?.tout ?? 0), note: p?.note ?? '' })
  }

  const jobs: GJob[] = agent.tasks.list().map(t => ({
    id: t.id, role: t.role, title: t.title, goal: t.goal, status: t.status, kind: t.kind, backend: t.backend, startedAt: t.startedAt, endedAt: t.endedAt, steps: t.steps, line: t.line, result: t.result, until: t.until, waitKind: t.waitKind,
    model: t.backend === 'api' ? lastForRole(ROLES[t.role]?.model ?? 'main') : undefined,
  }))
  for (const r of agent.tasks.interrupted()) if (!jobs.some(j => j.id === r.id)) jobs.push({ id: r.id, role: r.role, title: r.goal.slice(0, 70), goal: r.goal, status: 'interrupted', kind: 'task', backend: 'api', startedAt: r.updated, steps: 0, line: 'the app was closed while this ran' })

  // reroutes: a call failed on one model and the next attempt of the same role was answered by another within 90 s (the gateway's fallback)
  const nameOf = (id: string) => cfg.find(x => x.id === id)?.name ?? (id === 'live' ? 'Gemini Live' : id)
  const reroutes: GReroute[] = [], events: GEvent[] = []
  for (const [i, ok] of traces.entries()) {
    if (!ok.ok || now - ok.at > 10 * 60_000 || reroutes.length >= 3) continue
    const failed = traces.slice(i + 1).find(f => !f.ok && f.role === ok.role && f.provider !== ok.provider && ok.at - f.at < 90_000)
    if (!failed) continue
    reroutes.push({ from: failed.provider, to: ok.provider, at: ok.at, role: ok.role })
    events.push({ id: `r:${ok.id}`, at: ok.at, kind: 'retry', text: `Retrying on ${nameOf(ok.provider)}`, sub: `${nameOf(failed.provider)} could not answer` })
  }

  return {
    at: now, voice: agent.info().state, offline: !!st?.offline,
    jobs,
    schedule: agent.scheduler.list().filter(t => t.status === 'pending' || t.status === 'missed').map(t => ({ id: t.id, title: t.title, runAt: Date.parse(t.runAt), repeat: t.repeat, status: t.status as 'pending' | 'missed' })),
    loops: openLoops(now).map(l => ({ id: l.id, what: l.what, who: l.who, due: l.due ? Date.parse(l.due) : undefined })),
    models,
    mcp: agent.hub.status().map(m => ({ id: m.id, name: m.name, ok: m.ok, tools: m.tools, error: m.error })),
    events, reroutes,
  }
}

/** `agents.graph` over IPC: one snapshot on request, then pushes on change while at least one view is watching */
export function registerGraphIpc(agent: Agent, broadcast: (channel: string, ...args: unknown[]) => void) {
  let watchers = 0, timer: ReturnType<typeof setTimeout> | null = null, last = 0, hooked = false
  const flush = () => { timer = null; last = Date.now(); if (watchers > 0) broadcast('lokey:agents:graph', graphSnapshot(agent)) }
  const changed = () => {
    if (watchers <= 0 || timer) return
    timer = setTimeout(flush, Math.max(0, 500 - (Date.now() - last)))   // <= 2 pushes a second
    timer.unref?.()
  }
  const hook = () => {
    if (hooked) return
    hooked = true
    agent.on('agents', changed); agent.on('tasks', changed); agent.on('vstate', changed)
    loopsChanged.on('changed', changed)
    settings.on('changed', changed)
    try { ai.tracer.onRecord = changed } catch { /* no database: models update on the next event */ }
  }
  ipcMain.handle('lokey:agents:graph', () => graphSnapshot(agent))
  ipcMain.on('lokey:agents:graphWatch', (_e, on: boolean) => { watchers = Math.max(0, watchers + (on ? 1 : -1)); if (on) { hook(); changed() } })
  ipcMain.handle('lokey:agents:retry', (_e, id: string) => agent.tasks.retry(String(id)))
}
