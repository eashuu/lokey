// Runs src/mobile/selfcheck.ts under Node with the Android shims and overrides (same mapping as vite.mobile.config.ts): `pnpm mobile:check`.
// Node-only: nothing here touches the Windows app, the user's settings or any real input.
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const esbuild = createRequire(createRequire(join(root, 'package.json')).resolve('vite'))('esbuild')
const src = p => join(root, 'src', p)
const fwd = p => p.split('\\').join('/')

const nodeShims = ['electron', 'fs', 'path', 'os', 'crypto', 'events', 'child_process', 'http', 'net', 'url', 'util']
const overrides = new Map([['main/agent/keystore.ts', 'keystore.ts'], ['main/link/server.ts', 'linkServer.ts'], ['main/brain/screen.ts', 'screen.ts'], ['main/brain/extraTools.ts', 'extraTools.ts'], ['main/agent/mcp.ts', 'mcp.ts']].map(([a, b]) => [fwd(src(a)), fwd(src('mobile/overrides/' + b))]))

const plugin = {
  name: 'mobile-shims',
  setup(b) {
    b.onResolve({ filter: /^(node:)?(electron|fs|path|os|crypto|events|child_process|http|net|url|util)$/ }, a => ({ path: src(`mobile/shims/${a.path.replace('node:', '')}.ts`) }))
    b.onResolve({ filter: /^(node:)?dns\/promises$/ }, () => ({ path: src('mobile/shims/dns.ts') }))
    b.onResolve({ filter: /^@shared\// }, a => b.resolve('./' + a.path.slice(8), { kind: a.kind, resolveDir: src('shared') }))
    b.onResolve({ filter: /^\.{1,2}\// }, async a => {
      if (a.pluginData === 'skip' || fwd(a.importer).includes('/mobile/overrides/')) return null
      const r = await b.resolve(a.path, { kind: a.kind, resolveDir: a.resolveDir, importer: a.importer, pluginData: 'skip' })
      const hit = r.path && overrides.get(fwd(r.path))
      return hit ? { path: hit } : r
    })
  },
}

const dir = mkdtempSync(join(tmpdir(), 'lokey-mobile-check-'))
const outfile = join(dir, 'check.mjs')
await esbuild.build({
  stdin: { contents: `import { runAll } from ${JSON.stringify(src('mobile/selfcheck.ts'))}\nconst out = await runAll()\nconsole.log(out.join('\\n'))\nprocess.exit(out.some(l => l.includes('FAIL')) ? 1 : 0)`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile, logLevel: 'error', plugins: [plugin],
  define: { 'process.env.LOCALAPPDATA': '"/data"', 'process.platform': '"android"' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})
await import(pathToFileURL(outfile).href)
