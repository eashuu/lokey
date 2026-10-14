// main/brain/extraTools.ts for the phone: the two shared tools plus the Link tools. `ask_pc` hands a request to the Lokey on the paired PC
// (it runs there with phone limits and may ask the PC's user for approval, which the phone can also give); `pc_status` reads the PC's state.
import type { FunctionDecl } from '../../main/agent/session'
import type { ToolCtx, ToolResult } from '../../main/agent/tools'
import { EXTRA_TOOLS as BASE_TOOLS, runExtraTool as runBase } from '../../main/brain/extraTools'
import { linkClient } from '../linkClient'
import { BG_NAMES, BG_TOOLS, runBgTool, type BgCtx } from '../secondScreen'

const S = { type: 'STRING' }
const PC_TOOLS: FunctionDecl[] = [
  { name: 'ask_pc', description: 'Ask the user\'s Windows PC (a paired Lokey) to do something: open an app or a file there, search it, run a task. It works on its own and tells the user when done. Use it only for what needs the PC, e.g. "open my project on the laptop".', parameters: { type: 'OBJECT', properties: { request: { ...S, description: 'what the PC should do, in plain words' } }, required: ['request'] } },
  { name: 'pc_status', description: 'Whether the paired PC is online, what it is doing (assistant state, running jobs, what is playing, battery).', parameters: { type: 'OBJECT', properties: {} } },
]
export const EXTRA_TOOLS: FunctionDecl[] = [...BASE_TOOLS, ...PC_TOOLS, ...BG_TOOLS]
export const EXTRA_NAMES = new Set(EXTRA_TOOLS.map(t => t.name))
// everything but starting a second-screen task (the 'always ask' mode must ask for that one)
export const EXTRA_READ_ONLY = new Set([...EXTRA_NAMES].filter(n => n !== 'second_screen_task'))

export async function runExtraTool(name: string, a: Record<string, unknown>, ctx?: ToolCtx): Promise<ToolResult> {
  if (BG_NAMES.has(name)) return runBgTool(name, a, ctx as unknown as BgCtx)
  if (name !== 'ask_pc' && name !== 'pc_status') return runBase(name, a, ctx)
  if (!linkClient.paired) return { result: { ok: false, error: 'no PC is paired: pair one in Settings > Devices' } }
  if (name === 'pc_status') {
    const s = await linkClient.status()
    return s ? { result: { ok: true, online: true, ...s } } : { result: { ok: false, online: false, error: 'the PC is not reachable (off, asleep or on another network)' } }
  }
  const text = String(a.request ?? '').trim().slice(0, 1000)
  if (!text) return { result: { ok: false, error: 'say what the PC should do' } }
  const r = await linkClient.say(text)
  return r.ok ? { result: { ok: true, sent: true, note: 'the PC is working on it; the user is told there and here when it finishes' }, say: 'Sent to your PC.' } : { result: { ok: false, error: r.error } }
}
