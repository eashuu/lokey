// Undo: remember how to reverse the last few executed actions. Only actions with a known inverse are recorded.
export interface Inverse { tool: string; args: Record<string, unknown> }
export interface UndoItem { id: string; at: string; summary: string; inverse: Inverse }
const CANT = /^(run_command|send_|.*mail|.*message)/i
const stack: UndoItem[] = []

/** the inverse of a finished action, or null when there is none */
export function inverseOf(tool: string, a: Record<string, unknown>, result: Record<string, unknown>): Inverse | null {
  if (tool === 'change_setting') return { tool: 'undo_setting', args: {} }
  if (tool === 'toggle' && typeof a.on === 'boolean' && typeof a.what === 'string') return { tool: 'toggle', args: { what: a.what, on: !a.on } }
  if (tool === 'set_volume' && typeof a.muted === 'boolean') return { tool: 'set_volume', args: { muted: !a.muted } } // ponytail: percent changes have no previous value to restore
  if (tool === 'schedule' && typeof result.id === 'string') return { tool: 'cancel_task', args: { id: result.id } }
  return null
}
export function recordUndo(tool: string, a: Record<string, unknown>, result: Record<string, unknown>, summary: string) {
  const inv = inverseOf(tool, a, result)
  if (!inv) return
  stack.push({ id: Math.random().toString(36).slice(2, 8), at: new Date().toISOString(), summary, inverse: inv })
  if (stack.length > 20) stack.shift()
}
export const undoList = () => [...stack].reverse()
export function takeUndo(id?: string): UndoItem | null {
  const i = id ? stack.findIndex(x => x.id === id) : stack.length - 1
  return i < 0 ? null : stack.splice(i, 1)[0]
}
export const cannotUndo = (tool: string) => CANT.test(tool)

export function undoSelfCheck(): string {
  const r = inverseOf('toggle', { what: 'dark_mode', on: true }, {})
  if (r?.args.on !== false) throw new Error('toggle inverse')
  if (inverseOf('run_command', {}, {})) throw new Error('run_command must not undo')
  if (inverseOf('schedule', {}, { id: 'x' })?.tool !== 'cancel_task') throw new Error('schedule inverse')
  recordUndo('toggle', { what: 'wifi', on: false }, {}, 'a'); recordUndo('schedule', {}, { id: 'q' }, 'b')
  if (takeUndo()?.summary !== 'b' || takeUndo()?.summary !== 'a' || takeUndo()) throw new Error('stack order')
  if (!cannotUndo('send_email')) throw new Error('cannot')
  return 'ok'
}
