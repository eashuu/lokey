import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// The Android build: the same React UI as the desktop app (src/renderer) plus the main-process core (src/main/*) running in the
// WebView through shims (src/mobile). Output goes to mobile/www, which Capacitor packs into the APK (mobile/android).
// Node/Electron modules are replaced by small browser versions under src/mobile/shims; add an alias here when a new one is needed.
// A few core files are swapped whole for phone versions (OVERRIDES): the Windows source is untouched, only this build sees the swap.
const fwd = (p: string) => p.split('\\').join('/')
const shims = resolve('src/mobile/shims')
const ov = (f: string) => fwd(resolve('src/mobile/overrides', f))
const OVERRIDES: Record<string, string> = {
  [fwd(resolve('src/main/agent/keystore.ts'))]: ov('keystore.ts'),         // secrets in the Android Keystore through the plugin
  [fwd(resolve('src/main/link/server.ts'))]: ov('linkServer.ts'),          // the phone is a Link client, not a server
  [fwd(resolve('src/main/brain/screen.ts'))]: ov('screen.ts'),             // screenshots from the plugin
  [fwd(resolve('src/main/brain/extraTools.ts'))]: ov('extraTools.ts'),     // + ask_pc / pc_status
  [fwd(resolve('src/main/agent/mcp.ts'))]: ov('mcp.ts'),                   // remote (HTTP) MCP servers; no child processes on a phone
}
const overrides = (): Plugin => ({
  name: 'mobile-overrides',
  enforce: 'pre',
  async resolveId(source, importer, opts) {
    if (!importer || fwd(importer).includes('/mobile/overrides/')) return null // an override may import the original it replaces
    const r = await this.resolve(source, importer, { ...opts, skipSelf: true })
    return (r && OVERRIDES[fwd(r.id)]) || null
  },
})
// the page boots through src/mobile/entry.ts (globals, virtual disk, core, window.lokey) and that loads the renderer's own main.tsx afterwards
// (in `vite` dev the file is outside the server root, so it is served through /@fs/)
const entry = (): Plugin => ({ name: 'mobile-entry', transformIndexHtml: { order: 'pre', handler: (h: string, ctx) => h.replace('src="/src/main.tsx"', ctx.server ? `src="/@fs/${fwd(resolve('src/mobile/entry.ts'))}"` : 'src="../mobile/entry.ts"') } })

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  publicDir: resolve('src/mobile/public'),
  server: { fs: { allow: [resolve('.'), resolve('..')] } },
  plugins: [
    overrides(),
    entry(),
    react(),
    tailwind(),
    // the desktop CSP only allows a few hosts; the phone talks to Gemini, LRCLIB, the user's providers, a paired PC...
    { name: 'mobile-csp', transformIndexHtml: (h: string) => h.replace(/content="default-src[^"]*"/, `content="default-src 'self' https: http: data: blob: ws: wss:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; media-src 'self' blob: data:"`) },
  ],
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@': resolve('src/renderer/src'),
      ...Object.fromEntries(['electron', 'node:fs', 'fs', 'node:path', 'path', 'node:os', 'os', 'node:crypto', 'crypto', 'node:events', 'events', 'node:child_process', 'child_process', 'node:http', 'http', 'node:net', 'net', 'node:url', 'url', 'node:util', 'util'].map(m => [m, resolve(shims, m.replace('node:', '') + '.ts')])),
      'node:dns/promises': resolve(shims, 'dns.ts'),
      'dns/promises': resolve(shims, 'dns.ts'),
    },
  },
  // process.env.X is replaced at build time (dataDir comes from LOCALAPPDATA: a virtual folder on the phone's disk image)
  define: { 'process.env.LOCALAPPDATA': '"/data"', 'process.env': '{}', 'process.platform': '"android"' },
  build: { outDir: resolve('mobile/www'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 },
})
