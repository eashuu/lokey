// No processes on Android: every call fails the way a missing program would, so tools report "not available" instead of crashing.
const gone = () => Object.assign(new Error('running programs is not available on Android'), { code: 'ENOENT' })
const no = (): never => { throw gone() }
export const spawn = (..._a: unknown[]): any => no()
export const exec = (..._a: unknown[]): any => no()
export const execSync = (..._a: unknown[]): any => no()
export const execFile = (_f: string, ..._rest: unknown[]): any => {
  const cb = _rest.find(x => typeof x === 'function') as ((e: Error) => void) | undefined
  if (cb) { queueMicrotask(() => cb(gone())); return { on() { /* never runs */ }, kill() { /* nothing */ }, stdout: null, stderr: null } }
  return no()
}
export type ChildProcess = any
export type ChildProcessWithoutNullStreams = any
export default { spawn, exec, execFile, execSync }
