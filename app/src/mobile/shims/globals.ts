// Imported first by the mobile entry: gives the core the few Node globals it touches (process, Buffer, global).
import { Buffer } from './buffer'

const g = globalThis as unknown as Record<string, unknown>
g.Buffer ??= Buffer
g.global ??= globalThis
g.__dirname ??= '/app'
g.__filename ??= '/app/main.js'
// ponytail: process.env.X reads are replaced at build time (vite define); in `vite dev` the define lands on a bare globalThis.process, so the
// fields the core touches are filled in (not replaced) either way
const base: Record<string, unknown> = {
  argv: ['android', 'lokey'], env: {}, platform: 'android', pid: 1, versions: {}, version: 'v0', arch: 'arm64', cwd: () => '/', uptime: () => performance.now() / 1000,
  on() { return g.process }, off() { return g.process }, once() { return g.process }, emit() { return false }, exit() { /* a page cannot exit */ }, nextTick: (f: (...a: unknown[]) => void, ...a: unknown[]) => { queueMicrotask(() => f(...a)) },
  hrtime: Object.assign(() => { const t = performance.now(); return [Math.floor(t / 1000), Math.floor((t % 1000) * 1e6)] as [number, number] }, { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
}
const proc = (g.process ??= {}) as Record<string, unknown>
for (const [k, v] of Object.entries(base)) proc[k] ??= v
;((proc.env ??= {}) as Record<string, string>).LOCALAPPDATA ??= '/data'
export {}
