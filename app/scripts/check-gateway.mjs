// Round-9 guard: no model provider is called from anywhere except the gateway (src/main/ai). Run: pnpm check:gateway
// Fails when code outside the allowlist names a provider host, builds an adapter, or hard-codes a model id.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = join(import.meta.dirname, '..', 'src')
const HOSTS = /generativelanguage\.googleapis|api\.openai\.com|openrouter\.ai|api\.groq\.com|api\.anthropic\.com|api\.cerebras\.ai|api\.mistral\.ai|api\.deepseek|api\.together|localhost:3001|127\.0\.0\.1:11434|localhost:11434/
const MODEL_ID = /['"`](gemini-[0-9a-z.-]*|gpt-[0-9a-z.-]+|claude-[0-9a-z.-]+|llama-?[0-9][0-9a-z.-]*|mistral-[0-9a-z.-]+|qwen[0-9a-z.-]*)['"`]/
const ADAPTER = /new (GeminiProvider|OpenAiProvider)\b|from ['"][./]*ai\/adapters\//
// path (relative to src, forward slashes) -> what it may contain
const ALLOW = {
  'main/ai/': ['hosts', 'models', 'adapters'],                 // the gateway itself
  'shared/bridge.ts': ['hosts', 'models'],                      // the default provider list (the one place model ids are written)
  'main/settings.ts': ['models'],                               // settings upgrade refers to provider ids
  'renderer/src/settings/SettingsApp.tsx': ['hosts', 'models'], // placeholder text and the stock provider ids
  'main/brain/selfcheck.ts': ['adapters'],                      // wire-format checks
  'main/agent/dictation.ts': ['adapters'],                      // re-exports sseText for its self-check
  'main/brain/roleSelfcheck.ts': ['models'],                    // the admission-gate check names the stock model it exempts
  'main/livetest.ts': ['adapters'],                             // --livetest lists the Live-capable models through the adapter
  'renderer/src/bridge/modelsMock.ts': ['models'],             // the browser mock of the Models page names stock models
  'main/brain/router.ts': [],
}
const allowed = (rel, kind) => Object.entries(ALLOW).some(([p, k]) => (rel === p || (p.endsWith('/') && rel.startsWith(p))) && k.includes(kind))

const bad = []
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); continue }
    if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue
    const rel = relative(root, p).split(sep).join('/')
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/(^|\s)\/\/.*$/, '$1')
      for (const [kind, re] of [['hosts', HOSTS], ['models', MODEL_ID], ['adapters', ADAPTER]]) if (re.test(code) && !allowed(rel, kind)) bad.push(`${rel}:${i + 1}: ${kind}: ${line.trim().slice(0, 110)}`)
    })
  }
}
walk(root)
if (bad.length) { console.error('Direct provider use outside the gateway:\n' + bad.join('\n')); process.exit(1) }
console.log('check:gateway ok (no provider host, adapter or model id outside the gateway allowlist)')
