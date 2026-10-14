// The phone's stand-in for main/sidecar.ts: same surface (call / onEvent / ready / whenReady / 'ready' + 'log' events) on top of the native
// plugin. Without the plugin, or for a method it does not know yet, the answers of the UI mock (renderer/bridge/mock.ts) keep every panel rendering.
import { EventEmitter } from 'node:events'
import type { EventName, Events, MethodName, Methods } from '@shared/protocol'
import type { Bridge } from '@shared/bridge'
import { createMockBridge } from '../renderer/src/bridge/mock'
import { hasNative, nativeCall, NativeUnavailable, onNativeEvent } from './native'
import { fromNative, toNative } from './nativeMap'

export class NativeSidecar extends EventEmitter {
  ready = false
  failed = false
  pid = 0
  private mock: Bridge | null = null
  private offNative: (() => void) | null = null
  private fallbackLogged = new Set<string>()
  /** boot adds fields only the phone's plugin takes (wake.set's phrase list) without touching the shared Wake class */
  extra: ((method: string, params: unknown) => unknown) | null = null

  private fake() { return (this.mock ??= createMockBridge()) }

  /** true when the answers come from the real plugin */
  get native() { return hasNative() }

  async start(): Promise<boolean> {
    this.ready = true
    this.emit('log', hasNative() ? 'native plugin ready' : 'no native plugin: sample data only')
    this.emit('ready')
    return true
  }

  /** start receiving native events (durable ones queued while the page was down arrive right away): call once everything that handles them is wired */
  listen() { if (!this.offNative) this.offNative = onNativeEvent((name, data) => this.emit('event', name, data)) }

  whenReady(): Promise<void> { return Promise.resolve() }

  async call<M extends MethodName>(method: M, params: Methods[M][0], timeoutMs = 15_000): Promise<Methods[M][1]> {
    return this.callAny(method, params, timeoutMs) as Promise<Methods[M][1]>
  }

  /** any method name, protocol or phone-only (`perm.status`, `reminder.set`, ...): the plugin's answer, or the mock's when the plugin cannot */
  async callAny(method: string, params: unknown, timeoutMs = 15_000): Promise<unknown> {
    if (hasNative()) {
      try { return fromNative(method, await nativeCall(method, toNative(method, this.extra ? this.extra(method, params) : params), timeoutMs)) } catch (e) {
        if (!(e instanceof NativeUnavailable)) throw e
        if (!this.fallbackLogged.has(method)) { this.fallbackLogged.add(method); this.emit('log', `native method ${method} not available, using sample data`) }
      }
    }
    return this.fake().call(method as MethodName, params as never)
  }

  onEvent<E extends EventName>(name: E, cb: (d: Events[E]) => void) {
    const h = (n: string, d: unknown) => { if (n === name) cb(d as Events[E]) }
    this.on('event', h)
    // the mock only ticks (stats, visualiser, media) for methods the plugin did not answer, so listening to both never doubles an event
    const off = this.fake().on(name, cb)
    return () => { this.off('event', h); off() }
  }

  async stop() { this.offNative?.(); this.offNative = null; this.ready = false }
}
