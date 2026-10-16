// The message channel between the native app shell (Kotlin `WebCore`) and the headless core in the hidden WebView. Pure logic, no DOM:
// docs/NATIVE-APP.md "Core protocol" is the written form. One JSON object per message, both directions.
//
//   Kotlin -> JS   {t:'call',  id, path, args?}   call the function at `path` ("bridge.voice.say"), answer with a 'res'
//                  {t:'sub',   sid, path, args?}  call it with the args + a callback appended; every callback call is an 'ev'
//                  {t:'unsub', sid}               run the unsubscribe function the subscription returned
//   JS -> Kotlin   {t:'res', id, ok:true, v?} | {t:'res', id, ok:false, err}
//                  {t:'ev',  sid, v}            callback arguments (one argument = itself, several = an array)
//                  {t:'ready', ok:true, kind} | {t:'ready', ok:false, error}   once, after the core booted (or failed)
//
// `path` starts at a root (bridge = window.lokey, confirm = window.lokeyConfirm, overlay = window.lokeyOverlay, native = plugin events, core = window.__lokeyCore: agent, linkClient...).

export type HostIn =
  | { t: 'call'; id: number; path: string; args?: unknown[] }
  | { t: 'sub'; sid: number; path: string; args?: unknown[] }
  | { t: 'unsub'; sid: number }
export type HostOut =
  | { t: 'res'; id: number; ok: true; v?: unknown }
  | { t: 'res'; id: number; ok: false; err: string }
  | { t: 'ev'; sid: number; v: unknown }
  | { t: 'ready'; ok: true; kind: string }
  | { t: 'ready'; ok: false; error: string }

type Fn = (...a: unknown[]) => unknown
const BAD = new Set(['__proto__', 'constructor', 'prototype'])

/** the function at `path`, bound to its owner; throws on unknown roots, blocked names and non-functions */
export function resolvePath(roots: Record<string, unknown>, path: string): Fn {
  const parts = path.split('.')
  if (parts.length < 2 || parts.some(p => !p || BAD.has(p))) throw new Error(`bad path: ${path}`)
  let owner: unknown = undefined, cur: unknown = Object.prototype.hasOwnProperty.call(roots, parts[0]) ? roots[parts[0]] : undefined
  if (cur == null) throw new Error(`no such root: ${parts[0]}`)
  for (const p of parts.slice(1)) {
    owner = cur
    cur = (cur as Record<string, unknown> | null | undefined)?.[p]
    if (cur == null) throw new Error(`no such member: ${path}`)
  }
  if (typeof cur !== 'function') throw new Error(`not a function: ${path}`)
  return (...a: unknown[]) => (cur as Fn).apply(owner, a)
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
// JSON has no undefined; a payload that cannot be stringified (cycle, BigInt) must not kill the channel
const clean = (v: unknown): unknown => { if (v === undefined) return null; try { JSON.stringify(v); return v } catch { return String(v) } }

/** the dispatcher: feed it the raw JSON strings from Kotlin; `post` sends JSON to Kotlin */
export function createHost(roots: () => Record<string, unknown>, post: (m: HostOut) => void) {
  const subs = new Map<number, unknown>()
  const recv = (raw: string): void => {
    let m: HostIn
    try { m = JSON.parse(raw) as HostIn } catch { return }
    if (m.t === 'call') {
      const { id } = m
      try {
        Promise.resolve(resolvePath(roots(), m.path)(...(Array.isArray(m.args) ? m.args : []))).then(
          v => post({ t: 'res', id, ok: true, v: clean(v) }), e => post({ t: 'res', id, ok: false, err: errText(e) }))
      } catch (e) { post({ t: 'res', id, ok: false, err: errText(e) }) }
    } else if (m.t === 'sub') {
      const { sid } = m
      try {
        const off = resolvePath(roots(), m.path)(...(Array.isArray(m.args) ? m.args : []), (...a: unknown[]) => post({ t: 'ev', sid, v: clean(a.length <= 1 ? a[0] : a) }))
        subs.set(sid, off)
      } catch (e) { post({ t: 'ev', sid, v: { error: errText(e) } }) }
    } else if (m.t === 'unsub') {
      const off = subs.get(m.sid); subs.delete(m.sid)
      if (typeof off === 'function') try { (off as () => void)() } catch { /* already gone */ }
    }
  }
  return { recv, active: () => subs.size }
}

export async function hostSelfCheck(): Promise<string> {
  const need = (c: unknown, m: string) => { if (!c) throw new Error(m) }
  const out: HostOut[] = []
  const h: { cb?: (...a: unknown[]) => void } = {}; let offs = 0
  const lokey = { x: { add: (a: number, b: number) => a + b, boom: () => { throw new Error('nope') }, later: async () => { throw new Error('async nope') }, onTick: (c: (...a: unknown[]) => void) => { h.cb = c; return () => { offs++ } } } }
  const host = createHost(() => ({ bridge: lokey }), m => out.push(m))
  const tick = () => new Promise(r => setTimeout(r, 0))
  host.recv(JSON.stringify({ t: 'call', id: 1, path: 'bridge.x.add', args: [2, 3] })); await tick()
  host.recv(JSON.stringify({ t: 'call', id: 2, path: 'bridge.x.boom' })); host.recv(JSON.stringify({ t: 'call', id: 3, path: 'bridge.x.later' }))
  host.recv(JSON.stringify({ t: 'call', id: 4, path: 'bridge.__proto__.x' })); host.recv(JSON.stringify({ t: 'call', id: 5, path: 'nope.x.y' })); host.recv('not json'); await tick()
  const r = (id: number) => out.find(o => o.t === 'res' && o.id === id) as Extract<HostOut, { t: 'res' }> | undefined
  need(r(1)?.ok === true && (r(1) as { v?: unknown }).v === 5, 'call result')
  need(r(2)?.ok === false && r(3)?.ok === false && r(4)?.ok === false && r(5)?.ok === false, 'errors are answers, never throws')
  host.recv(JSON.stringify({ t: 'sub', sid: 9, path: 'bridge.x.onTick' }))
  h.cb?.({ a: 1 }); h.cb?.(1, 2)
  const ev = out.filter(o => o.t === 'ev') as Extract<HostOut, { t: 'ev' }>[]
  need(ev.length === 2 && (ev[0].v as { a: number }).a === 1 && (ev[1].v as number[]).join() === '1,2', 'event payloads')
  host.recv(JSON.stringify({ t: 'unsub', sid: 9 }))
  need(offs === 1 && host.active() === 0, 'unsubscribe')
  return 'ok (call, errors, sub/unsub, blocked paths)'
}
