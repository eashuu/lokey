// Small LRU for app icons (data URLs) + a 4-wide request queue so a long list never floods the sidecar pipe.
import { bridge } from '@/bridge'

const MAX = 300
const LIMIT = 4
const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()
const queue: (() => void)[] = []
let active = 0

function put(id: string, icon: string | null) {
  cache.delete(id)
  cache.set(id, icon)
  if (cache.size > MAX) cache.delete(cache.keys().next().value as string)
}

function pump() {
  while (active < LIMIT && queue.length) { active++; queue.shift()!() }
}

/** `undefined` = not loaded yet, `null` = loaded but the app has no icon. */
export function cachedIcon(id: string): string | null | undefined { return cache.get(id) }

export function loadIcon(id: string): Promise<string | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null)
  const hit = inflight.get(id)
  if (hit) return hit
  const p = new Promise<string | null>(resolve => {
    queue.push(() => {
      bridge.call('apps.icon', { id }).then(r => r?.icon ?? null, () => null).then(icon => {
        put(id, icon); inflight.delete(id); active--; pump(); resolve(icon)
      })
    })
  })
  inflight.set(id, p)
  pump()
  return p
}
