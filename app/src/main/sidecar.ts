import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'
import type { EventName, Events, MethodName, Methods } from '@shared/protocol'

const exeRelative = join('native', 'Lokey.Host', 'bin', 'Release', 'net8.0-windows10.0.22621.0', 'win-x64', 'Lokey.Host.exe')

export function sidecarPath(): string | null {
  // LOKEY_HOST_EXE: use a specific build (e.g. while the default exe is locked by a running instance)
  const override = process.env.LOKEY_HOST_EXE
  if (override && existsSync(override)) return override
  const candidates = [
    join(process.resourcesPath ?? '', 'host', 'Lokey.Host.exe'),            // packaged
    join(app.getAppPath(), '..', exeRelative),                                // dev: app/ -> repo root
    join(app.getAppPath(), exeRelative),
  ]
  return candidates.find(existsSync) ?? null
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

/** Owns the Lokey.Host.exe process and the named-pipe JSON-lines connection to it. */
export class Sidecar extends EventEmitter {
  private proc: ChildProcess | null = null
  private sock: net.Socket | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ''
  private stopping = false
  private restarts = 0
  ready = false
  failed = false
  pid = 0

  async start(): Promise<boolean> {
    const exe = sidecarPath()
    if (!exe) { this.emit('log', 'sidecar exe not found'); this.failed = true; return false }
    const pipe = `lokey-${process.pid}-${randomBytes(6).toString('hex')}`
    this.proc = spawn(exe, ['--pipe', pipe], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
    this.pid = this.proc.pid ?? 0
    this.proc.on('exit', code => this.onExit(code))
    try {
      this.sock = await this.connect(`\\\\.\\pipe\\${pipe}`)
    } catch (e) {
      this.emit('log', `sidecar pipe failed: ${(e as Error).message}`)
      this.proc.kill()
      this.failed = true
      return false
    }
    this.sock.setEncoding('utf8')
    this.sock.on('data', chunk => this.onData(chunk as string))
    this.sock.on('close', () => { this.ready = false })
    this.ready = true
    const hello = await this.call('sys.hello', { version: 1 }).catch(() => null)
    this.emit('log', `sidecar ready ${hello ? JSON.stringify(hello) : '(no hello)'}`)
    this.emit('ready')
    return true
  }

  private connect(path: string): Promise<net.Socket> {
    const deadline = Date.now() + 8000
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const s = net.connect(path)
        s.once('connect', () => resolve(s))
        s.once('error', err => {
          s.destroy()
          if (Date.now() > deadline) reject(err)
          else setTimeout(attempt, 120)
        })
      }
      attempt()
    })
  }

  private onData(chunk: string) {
    this.buffer += chunk
    let i: number
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim()
      this.buffer = this.buffer.slice(i + 1)
      if (!line) continue
      try { this.dispatch(JSON.parse(line)) } catch (e) { this.emit('log', `bad line from sidecar: ${(e as Error).message}`) }
    }
  }

  private dispatch(msg: { id?: number; result?: unknown; error?: { message: string }; event?: string; data?: unknown }) {
    if (msg.event) { this.emit('event', msg.event, msg.data); return }
    if (msg.id === undefined) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
  }

  /** Resolves once the pipe is connected (startup takes ~0.5 s); rejects after `ms` or if the sidecar is unavailable. */
  whenReady(ms = 8000): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.failed) return Promise.reject(new Error('sidecar unavailable'))
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.off('ready', ok); reject(new Error('sidecar not connected')) }, ms)
      const ok = () => { clearTimeout(t); resolve() }
      this.once('ready', ok)
    })
  }

  call<M extends MethodName>(method: M, params: Methods[M][0], timeoutMs = 15000): Promise<Methods[M][1]> {
    if (!this.sock || !this.ready) return Promise.reject(new Error('sidecar not connected'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)) }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.sock!.write(JSON.stringify({ id, method, params }) + '\n')
    })
  }

  onEvent<E extends EventName>(name: E, cb: (d: Events[E]) => void) {
    const h = (n: string, d: unknown) => { if (n === name) cb(d as Events[E]) }
    this.on('event', h)
    return () => this.off('event', h)
  }

  private onExit(code: number | null) {
    this.ready = false
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('sidecar exited')) }
    this.pending.clear()
    this.emit('log', `sidecar exited (${code})`)
    if (this.stopping || this.restarts >= 3) return
    this.restarts++
    setTimeout(() => { void this.start() }, 600 * this.restarts)
  }

  async stop() {
    this.stopping = true
    try { await this.call('sys.quit', {}, 1500) } catch { /* process may already be gone */ }
    this.sock?.destroy()
    this.proc?.kill()
  }
}
