import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { McpServerConfig } from '@shared/bridge'
import type { FunctionDecl } from './session'

// A small MCP (Model Context Protocol) client over stdio: lets the assistant use any tool server the user installs
// (filesystem, GitHub, Notion, a browser...). Newline-delimited JSON-RPC 2.0. Each server's tools appear to the model as
// `mcp_<server>__<tool>`; calls to servers that are not marked trusted show the confirm card first (see tools.ts).
const INIT_MS = 20_000
const CALL_MS = 60_000
const MAX_RESULT = 6000

interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown> }
interface Pending { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'x'

/** JSON Schema -> the OpenAPI subset Gemini accepts (upper-case types; no $schema/additionalProperties/etc.) */
export function toGeminiSchema(s: unknown, depth = 0): Record<string, unknown> {
  if (!s || typeof s !== 'object' || depth > 6) return { type: 'STRING' }
  const o = s as Record<string, any>
  let type = Array.isArray(o.type) ? o.type.find((t: string) => t !== 'null') : o.type
  if (!type && o.properties) type = 'object'
  if (!type && (o.anyOf || o.oneOf)) return toGeminiSchema((o.anyOf ?? o.oneOf)[0], depth + 1)
  const out: Record<string, unknown> = { type: String(type ?? 'string').toUpperCase() }
  if (typeof o.description === 'string') out.description = o.description.slice(0, 400)
  if (Array.isArray(o.enum) && out.type === 'STRING') out.enum = o.enum.map(String)
  if (out.type === 'OBJECT') {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o.properties ?? {})) props[k] = toGeminiSchema(v, depth + 1)
    out.properties = props
    if (Array.isArray(o.required)) out.required = o.required.filter((r: string) => r in props)
  }
  if (out.type === 'ARRAY') out.items = toGeminiSchema(o.items, depth + 1)
  return out
}

class Server {
  proc: ChildProcessWithoutNullStreams | null = null
  tools: McpTool[] = []
  error = ''
  private next = 1
  private pending = new Map<number, Pending>()
  private buf = ''

  constructor(readonly cfg: McpServerConfig) {}

  private send(msg: unknown) { this.proc?.stdin.write(JSON.stringify(msg) + '\n') }

  private request(method: string, params: unknown, ms: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.next++
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)) }, ms)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ jsonrpc: '2.0', id, method, params }) } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e as Error) }
    })
  }

  private onData(chunk: string) {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      let m: any
      try { m = JSON.parse(line) } catch { continue }
      if (m.id !== undefined && (m.result !== undefined || m.error)) {
        const p = this.pending.get(m.id)
        if (!p) continue
        this.pending.delete(m.id)
        clearTimeout(p.timer)
        if (m.error) p.reject(new Error(String(m.error.message ?? 'error'))); else p.resolve(m.result)
      } else if (m.id !== undefined && m.method) {
        // a request from the server (sampling, roots...): we support none of them
        this.send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported' } })
      }
    }
  }

  async start() {
    const c = this.cfg
    const winShell = process.platform === 'win32' && !/\.exe$/i.test(c.command) // npx, uvx, node shims are .cmd files
    this.proc = spawn(c.command, c.args, { stdio: 'pipe', windowsHide: true, shell: winShell })
    this.proc.stdout.setEncoding('utf8').on('data', d => this.onData(d))
    this.proc.stderr.on('data', () => undefined)
    this.proc.on('error', e => { this.error = e.message; this.fail(e.message) })
    this.proc.on('exit', code => { if (!this.error && code) this.error = `exited with code ${code}`; this.fail('server exited'); this.proc = null })
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lokey', version: '0.5.1' } }, INIT_MS)
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const r = await this.request('tools/list', {}, INIT_MS)
    this.tools = (Array.isArray(r?.tools) ? r.tools : []).slice(0, 40) as McpTool[]
  }

  private fail(m: string) { for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(m)); this.pending.delete(id) } }

  async call(tool: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.request('tools/call', { name: tool, arguments: args }, CALL_MS)
    const text = (Array.isArray(r?.content) ? r.content : []).map((c: any) => (c?.type === 'text' ? String(c.text) : `[${c?.type ?? 'data'}]`)).join('\n')
    const out = text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) + '…' : text
    if (r?.isError) throw new Error(out || 'tool failed')
    return out
  }

  stop() { this.fail('stopped'); try { this.proc?.kill() } catch { /* gone */ } this.proc = null }
}

export class McpHub {
  private servers = new Map<string, Server>()
  private sig = ''
  private starting: Promise<void> = Promise.resolve()

  /** (re)start servers when the configured list changed; returns when they are up (or failed) */
  sync(cfg: McpServerConfig[]): Promise<void> {
    const list = cfg.filter(c => c.enabled && c.command.trim())
    const sig = JSON.stringify(list.map(c => [c.id, c.command, c.args]))
    if (sig === this.sig) return this.starting
    this.sig = sig
    this.stop()
    this.starting = Promise.all(list.map(async c => {
      const s = new Server(c)
      this.servers.set(c.id, s)
      try { await s.start() } catch (e) { s.error = s.error || (e instanceof Error ? e.message : String(e)); s.stop() }
    })).then(() => undefined)
    return this.starting
  }

  status() { return [...this.servers.values()].map(s => ({ id: s.cfg.id, name: s.cfg.name, ok: !s.error && !!s.proc, tools: s.tools.length, error: s.error || undefined })) }

  /** function declarations for every tool of every live server */
  decls(): FunctionDecl[] {
    const out: FunctionDecl[] = []
    for (const s of this.servers.values()) {
      if (!s.proc) continue
      for (const t of s.tools) {
        const name = `mcp_${slug(s.cfg.name)}__${t.name.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64)
        const params = toGeminiSchema(t.inputSchema ?? { type: 'object', properties: {} })
        out.push({ name, description: `[${s.cfg.name}] ${t.description ?? t.name}`.slice(0, 600), parameters: params.type === 'OBJECT' ? params : { type: 'OBJECT', properties: {} } })
      }
    }
    return out
  }

  /** which server/tool a declared name belongs to */
  resolve(declName: string): { server: Server; tool: string } | null {
    if (!declName.startsWith('mcp_')) return null
    for (const s of this.servers.values()) {
      for (const t of s.tools) {
        if (`mcp_${slug(s.cfg.name)}__${t.name.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64) === declName) return { server: s, tool: t.name }
      }
    }
    return null
  }

  trusted(declName: string) { return !!this.resolve(declName)?.server.cfg.trusted }
  label(declName: string) { const r = this.resolve(declName); return r ? `${r.tool} (${r.server.cfg.name})` : declName }
  async call(declName: string, args: Record<string, unknown>) {
    const r = this.resolve(declName)
    if (!r) throw new Error('that tool is no longer available')
    return r.server.call(r.tool, args)
  }

  stop() { for (const s of this.servers.values()) s.stop(); this.servers.clear() }

  /** pure check of the schema conversion (no process is started) */
  static selfCheck(): string {
    const g = toGeminiSchema({ type: 'object', $schema: 'x', additionalProperties: false, properties: { path: { type: 'string', description: 'p' }, n: { type: ['integer', 'null'] }, tags: { type: 'array', items: { type: 'string' } } }, required: ['path', 'ghost'] }) as any
    if (g.type !== 'OBJECT' || g.properties.path.type !== 'STRING' || g.properties.n.type !== 'INTEGER' || g.properties.tags.items.type !== 'STRING') throw new Error('mcp: schema conversion')
    if (g.required.join() !== 'path' || '$schema' in g || 'additionalProperties' in g) throw new Error('mcp: schema cleanup')
    return 'mcp ok'
  }
}
