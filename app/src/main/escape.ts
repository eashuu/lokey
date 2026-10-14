import { globalShortcut } from 'electron'

// One owner list for the global Escape shortcut: move mode and the lasso each used to unregister the other's.
const owners = new Map<string, () => void>()
export function holdEscape(owner: string, fn: () => void) {
  const first = owners.size === 0
  owners.set(owner, fn)
  if (first) try { globalShortcut.register('Escape', () => { for (const f of [...owners.values()]) f() }) } catch { /* the editor also handles a right click */ }
}
export function releaseEscape(owner: string) {
  if (owners.delete(owner) && owners.size === 0) try { globalShortcut.unregister('Escape') } catch { /* not registered */ }
}
