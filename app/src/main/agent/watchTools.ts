import type { FunctionDecl } from './session'
import type { ToolCtx, ToolResult } from './tools'
import { book, startWatching, stopWatching, watcher, type Routine } from './watch'

// Tools for C7 (learn by watching). Recording needs a confirm card (it is the consent), listing is read-only, and a replay is a normal
// sequence of tool calls: every step goes through execute() => classify => confirm => log, exactly as if the model had asked for it.
const S = { type: 'STRING' }
export const WATCH_TOOLS: FunctionDecl[] = [
  { name: 'watch_start', description: 'Start learning a routine by watching which apps the user opens ("watch me do this", "learn my morning setup"). Records only app names in order, never typing, screen or window titles. Asks the user first and shows that it is recording.', parameters: { type: 'OBJECT', properties: { name: { ...S, description: 'short name for the routine, e.g. "expense report"' } }, required: ['name'] } },
  { name: 'watch_stop', description: 'Stop watching and save what was learned as a routine the user can review in Desk.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'routine_list', description: 'List the routines learned by watching, with their steps.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'routine_run', description: 'Replay a learned routine by name ("do my expense report"). Each step goes through the normal permission check; the first run (and the first after any edit) asks the user.', parameters: { type: 'OBJECT', properties: { name: { ...S, description: 'routine name' } }, required: ['name'] } },
  { name: 'routine_delete', description: 'Delete a learned routine by name. Asks first.', parameters: { type: 'OBJECT', properties: { name: { ...S, description: 'routine name' } }, required: ['name'] } },
]
export const WATCH_NAMES = new Set(WATCH_TOOLS.map(t => t.name))
export const WATCH_READ_ONLY = new Set(['routine_list', 'watch_stop'])

const list = (r: Routine) => r.steps.map((s, i) => `${i + 1}. ${s.label}`).join('; ')

export function classifyWatch(name: string, a: Record<string, unknown>): { risk: 'safe' | 'ask' | 'deny'; title: string; detail: string } | null {
  if (!WATCH_NAMES.has(name)) return null
  const q = String(a.name ?? '')
  switch (name) {
    case 'watch_start': return { risk: 'ask', title: `Watch what you open to learn "${q.slice(0, 40)}"`, detail: 'I will note which apps you bring to the front, in order, until you stop me. I do not record typing, the screen or window titles, and I skip password and banking windows. A "watching" notice stays visible.' }
    case 'routine_delete': return { risk: 'ask', title: `Delete routine "${q.slice(0, 40)}"`, detail: book.find(q) ? list(book.find(q)!) : '' }
    case 'routine_run': {
      const r = book.find(q)
      if (r && !book.approved(r)) return { risk: 'ask', title: `Run "${r.name}" for the first time`, detail: `${list(r)}. Each step is still checked on its own.` }
      return { risk: 'safe', title: '', detail: '' }
    }
    default: return { risk: 'safe', title: '', detail: '' }
  }
}

type Exec = (name: string, a: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult>

export async function runWatchTool(name: string, a: Record<string, unknown>, ctx: ToolCtx, exec: Exec, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): Promise<ToolResult> {
  const q = String(a.name ?? '').trim()
  switch (name) {
    case 'watch_start':
      if (watcher.active) return { result: { ok: false, error: 'already watching' } }
      startWatching(q)
      return { result: { ok: true, watching: watcher.name }, say: 'Okay, I am watching. Do the steps, then tell me to stop.' }
    case 'watch_stop': {
      if (!watcher.active) return { result: { ok: false, error: 'I was not watching' } }
      const r = stopWatching()
      return r ? { result: { ok: true, saved: r.name, steps: r.steps.map(s => s.label) }, say: `Saved ${r.name} with ${r.steps.length} steps. You can review it in Desk.` } : { result: { ok: true, saved: null }, say: 'I did not see anything to save.' }
    }
    case 'routine_list':
      return { result: { ok: true, routines: book.list().map(r => ({ name: r.name, steps: r.steps.map(s => s.label), runs: r.runs })) } }
    case 'routine_delete': {
      const r = book.find(q)
      if (!r) return { result: { ok: false, error: `no routine named "${q}"` } }
      book.remove(r.id)
      return { result: { ok: true, deleted: r.name }, say: `Deleted ${r.name}.` }
    }
    case 'routine_run': {
      const r = book.find(q)
      if (!r) return { result: { ok: false, error: `no routine named "${q}"` }, say: `I don't have a routine called ${q}.` }
      if (!r.steps.length) return { result: { ok: false, error: 'the routine has no steps' } }
      const done: string[] = []
      for (const s of r.steps) {
        if (ctx.signal?.aborted) return { result: { ok: false, stopped: true, done } }
        const res = await exec(s.tool, s.args, ctx)
        if ((res.result as { ok?: boolean }).ok === false) return { result: { ok: false, failedAt: s.label, done, error: String((res.result as { error?: unknown }).error ?? 'a step failed') }, say: `I stopped at "${s.label}".` }
        done.push(s.label)
        await sleep(1200) // let the window come up before the next step
      }
      book.markRun(r)
      return { result: { ok: true, ran: r.name, steps: done }, say: `Done: ${r.name}.` }
    }
  }
  return { result: { ok: false, error: 'unknown' } }
}
