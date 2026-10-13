import type { Bridge } from '@shared/bridge'
import { createMockBridge } from './mock'

// Electron's preload provides `window.lokey`. In a plain browser we use the mock. With `--mock`
// (dev / bench without the sidecar) calls the sidecar cannot answer fall back to the mock, events merge.
function create(): Bridge {
  const real = window.lokey
  if (!real) return createMockBridge()
  if (!window.lokeyFlags?.mock) return real
  const mock = createMockBridge()
  return {
    ...real,
    call: async (m, p) => {
      try { return await real.call(m, p) } catch { return mock.call(m, p) }
    },
    on: (e, cb) => { const a = real.on(e, cb), b = mock.on(e, cb); return () => { a(); b() } },
  }
}

export const bridge: Bridge = create()
