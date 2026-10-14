// Node's EventEmitter, trimmed to what the core uses.
type Fn = (...a: any[]) => void
export class EventEmitter {
  private _l = new Map<string | symbol, { fn: Fn; once: boolean }[]>()
  private _max = 10
  setMaxListeners(n: number) { this._max = n; return this }
  getMaxListeners() { return this._max }
  on(e: string | symbol, fn: Fn) { return this.addListener(e, fn) }
  addListener(e: string | symbol, fn: Fn) { const l = this._l.get(e) ?? []; l.push({ fn, once: false }); this._l.set(e, l); return this }
  prependListener(e: string | symbol, fn: Fn) { const l = this._l.get(e) ?? []; l.unshift({ fn, once: false }); this._l.set(e, l); return this }
  once(e: string | symbol, fn: Fn) { const l = this._l.get(e) ?? []; l.push({ fn, once: true }); this._l.set(e, l); return this }
  off(e: string | symbol, fn: Fn) { return this.removeListener(e, fn) }
  removeListener(e: string | symbol, fn: Fn) { const l = this._l.get(e); if (l) { const i = l.findIndex(x => x.fn === fn); if (i >= 0) l.splice(i, 1); if (!l.length) this._l.delete(e) } return this }
  removeAllListeners(e?: string | symbol) { if (e === undefined) this._l.clear(); else this._l.delete(e); return this }
  emit(e: string | symbol, ...a: unknown[]): boolean {
    const l = this._l.get(e)
    if (!l?.length) { if (e === 'error') throw (a[0] instanceof Error ? a[0] : new Error(String(a[0]))); return false }
    for (const x of [...l]) { if (x.once) this.removeListener(e, x.fn); x.fn.apply(this, a) }
    return true
  }
  listenerCount(e: string | symbol) { return this._l.get(e)?.length ?? 0 }
  listeners(e: string | symbol) { return (this._l.get(e) ?? []).map(x => x.fn) }
  eventNames() { return [...this._l.keys()] }
}
export default EventEmitter
export const once = (em: EventEmitter, e: string) => new Promise<unknown[]>(r => em.once(e, (...a: unknown[]) => r(a)))
