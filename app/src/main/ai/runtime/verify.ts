import { existsSync, statSync } from 'node:fs'

// Verify after act (plan 3.6): each side-effecting tool can declare a cheap post-condition. If it fails the model is told the action
// did NOT happen (instead of believing a "success" the tool reported), and the model that chose it earns a demerit. The same checks
// settle a step a crash left half-done: if the post-condition already holds, the step is treated as done and not repeated.
// Only checks that need nothing but the file system live here; window and setting checks can be added the same way.
type Verifier = (a: Record<string, unknown>) => string | null    // null = holds, otherwise why it does not
const str = (a: Record<string, unknown>, k: string) => String(a[k] ?? '')

export const VERIFIERS: Record<string, Verifier> = {
  write_file: a => { const p = str(a, 'path'); if (!existsSync(p)) return `${p} does not exist`; return statSync(p).size === 0 && str(a, 'content') ? `${p} is empty` : null },
  make_folder: a => (existsSync(str(a, 'path')) ? null : `${str(a, 'path')} does not exist`),
  copy_file: a => (existsSync(str(a, 'to')) ? null : `${str(a, 'to')} does not exist`),
  move_file: a => (!existsSync(str(a, 'to')) ? `${str(a, 'to')} does not exist` : existsSync(str(a, 'from')) ? `${str(a, 'from')} is still there` : null),
  delete_file: a => (existsSync(str(a, 'path')) ? `${str(a, 'path')} is still there` : null),
}

export const hasVerifier = (name: string) => name in VERIFIERS
/** null = the post-condition holds (or none is declared) */
export function verify(name: string, a: Record<string, unknown>): string | null {
  try { return VERIFIERS[name]?.(a) ?? null } catch (e) { return e instanceof Error ? e.message : 'could not check' }
}
