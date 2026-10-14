// The virtual disk behind the node:fs shim: everything lives in memory (so the core's synchronous fs calls just work) and is written
// through to IndexedDB in the background. `vfsLoad()` must finish before any core module is evaluated (they read their files at import).
export type Data = string | Uint8Array

const files = new Map<string, Data>()
const dirs = new Set<string>(['/'])
const dirty = new Map<string, Data | null>()
let timer: ReturnType<typeof setTimeout> | null = null
let db: IDBDatabase | null = null
const DB = 'lokey-vfs', STORE = 'files'

export const vfs = { files, dirs, meta: new Map<string, number>() }

function addParents(p: string) {
  for (let i = p.lastIndexOf('/'); i > 0; i = p.lastIndexOf('/', i - 1)) dirs.add(p.slice(0, i))
}

export function vfsSet(path: string, data: Data) { files.set(path, data); vfs.meta.set(path, Date.now()); addParents(path); dirty.set(path, data); schedule() }
export function vfsDelete(path: string) { files.delete(path); vfs.meta.delete(path); dirty.set(path, null); schedule() }

function schedule() {
  if (timer || !db) return
  timer = setTimeout(() => { timer = null; void vfsFlush() }, 250)
}

/** writes everything pending (also called when the page is hidden: the OS may kill a background WebView at any time) */
export function vfsFlush(): Promise<void> {
  if (!db || dirty.size === 0) return Promise.resolve()
  const batch = [...dirty]
  dirty.clear()
  return new Promise(resolve => {
    try {
      const tx = db!.transaction(STORE, 'readwrite')
      const st = tx.objectStore(STORE)
      for (const [k, v] of batch) { if (v === null) st.delete(k); else st.put({ v, t: Date.now() }, k) }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => { for (const [k, v] of batch) if (!dirty.has(k)) dirty.set(k, v); resolve() }
    } catch { resolve() }
  })
}

export async function vfsLoad(): Promise<void> {
  if (typeof indexedDB === 'undefined') return // plain Node / private mode: memory only
  try {
    db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(STORE)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    await new Promise<void>(res => {
      const c = db!.transaction(STORE).objectStore(STORE).openCursor()
      c.onsuccess = () => {
        const cur = c.result
        if (!cur) return res()
        const e = cur.value as { v: Data; t: number }
        files.set(String(cur.key), e.v); vfs.meta.set(String(cur.key), e.t); addParents(String(cur.key))
        cur.continue()
      }
      c.onerror = () => res()
    })
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void vfsFlush() })
      addEventListener('pagehide', () => { void vfsFlush() })
    }
  } catch { db = null }
}
