// main/agent/mcp.ts for the phone. Android cannot start child processes, so stdio servers are desktop-only; here a server is REMOTE: set its
// "command" to the server's https address (Streamable HTTP, JSON-RPC over fetch) and put optional headers in "args" as "Name: value" lines
// (e.g. "Authorization: Bearer ..."). Same McpHub surface as the desktop one, so tools.ts / agent.ts do not know the difference.
import type { McpServerConfig } from '@shared/bridge'
import type { FunctionDecl } from '../../main/agent/session'
import { toGeminiSchema } from '../../main/agent/mcp'
import { PinStore } from '../../main/agent/mcpWire'

export { toGeminiSchema }
/** tool-definition pins: in memory only on the phone (the desktop persists them to mcp-pins.json) */
export const pins = new PinStore(() => undefined)
const INIT_MS = 20_000
const CALL_MS = 60_000
const MAX_RESULT = 6000
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'x'

interface McpTool { name: string; description?: string; inputSchema?: Record<string, unknown> }

/** the JSON-RPC message with this id out of a reply that is either plain JSON or a Server-Sent-Events stream */
export function pickReply(body: string, contentType: string, id: number): { result?: any; error?: { message?: string } } | null {
  const msgs: any[] = []
  if (/text\/event-stream/i.test(contentType)) {
    for (const ev of body.split(/\r?\n\r?\n/)) {
      const data = ev.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      if (data) try { msgs.push(JSON.parse(data)) } catch { /* not a message */ }
    }
  } else try { const j = JSON.parse(body); msgs.push(...(Array.isArray(j) ? j : [j])) } catch { /* empty body */ }
  return msgs.find(m => m && m.id === id && (m.result !== undefined || m.error)) ?? null
}

class Server {
  live = false
  tools: McpTool[] = []
  error = ''
  private next = 1
  private session = ''
  private fetch: typeof fetch = (...a) => fetch(...a)

  constructor(readonly cfg: McpServerConfig, f?: typeof fetch) { if (f) this.fetch = f }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' }
    for (const line of this.cfg.args) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim() }
    if (this.session) h['Mcp-Session-Id'] = this.session
    return h
  }

  private async post(msg: unknown, ms: number): Promise<Response> {
    const r = await this.fetch(this.cfg.command.trim(), { method: 'POST', headers: this.headers(), body: JSON.stringify(msg), signal: AbortSignal.timeout(ms) })
    const sid = r.headers.get('Mcp-Session-Id'); if (sid) this.session = sid
    return r
  }

  private async request(method: string, params: unknown, ms: number): Promise<any> {
    const id = this.next++
    const r = await this.post({ jsonrpc: '2.0', id, method, params }, ms)
    if (!r.ok) throw new Error(`${method}: the server answered ${r.status}`)
    const m = pickReply(await r.text(), r.headers.get('Content-Type') ?? '', id)
    if (!m) throw new Error(`${method}: no reply`)
    if (m.error) throw new Error(String(m.error.message ?? 'error'))
    return m.result
  }

  async start() {
    const u = this.cfg.command.trim()
    if (!/^https?:\/\//i.test(u)) throw new Error('on a phone an MCP server must be an https address (programs cannot run here)')
    await this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'lokey', version: '0.5.1' } }, INIT_MS)
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, INIT_MS).catch(() => undefined)
    const r = await this.request('tools/list', {}, INIT_MS)
    this.tools = (Array.isArray(r?.tools) ? r.tools : []).slice(0, 40) as McpTool[]
    this.live = true
  }

  async call(tool: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.request('tools/call', { name: tool, arguments: args }, CALL_MS)
    const text = (Array.isArray(r?.content) ? r.content : []).map((c: any) => (c?.type === 'text' ? String(c.text) : `[${c?.type ?? 'data'}]`)).join('\n')
    const out = text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) + '…' : text
    if (r?.isError) throw new Error(out || 'tool failed')
    return out
  }

  stop() {
    if (this.session) void this.fetch(this.cfg.command.trim(), { method: 'DELETE', headers: this.headers(), signal: AbortSignal.timeout(3000) }).catch(() => undefined)
    this.live = false
  }
}

export class McpHub {
  private servers = new Map<string, Server>()
  private sig = ''
  private starting: Promise<void> = Promise.resolve()
  /** self-check hook: a fake fetch for the servers */
  static fetchImpl: typeof fetch | undefined

  sync(cfg: McpServerConfig[]): Promise<void> {
    const list = cfg.filter(c => c.enabled && c.command.trim())
    const sig = JSON.stringify(list.map(c => [c.id, c.command, c.args]))
    if (sig === this.sig) return this.starting
    this.sig = sig
    this.stop()
    this.starting = Promise.all(list.map(async c => {
      const s = new Server(c, McpHub.fetchImpl)
      this.servers.set(c.id, s)
      try { await s.start() } catch (e) { s.error = s.error || (e instanceof Error ? e.message : String(e)); s.stop() }
    })).then(() => undefined)
    return this.starting
  }

  status() { return [...this.servers.values()].map(s => ({ id: s.cfg.id, name: s.cfg.name, ok: !s.error && s.live, tools: s.tools.length, error: s.error || undefined })) }

  decls(): FunctionDecl[] {
    const out: FunctionDecl[] = []
    for (const s of this.servers.values()) {
      if (!s.live) continue
      for (const t of s.tools) {
        const name = `mcp_${slug(s.cfg.name)}__${t.name.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64)
        const params = toGeminiSchema(t.inputSchema ?? { type: 'object', properties: {} })
        out.push({ name, description: `[${s.cfg.name}] ${t.description ?? t.name}`.slice(0, 600), parameters: params.type === 'OBJECT' ? params : { type: 'OBJECT', properties: {} } })
      }
    }
    return out
  }

  resolve(declName: string): { server: Server; tool: string } | null {
    if (!declName.startsWith('mcp_')) return null
    for (const s of this.servers.values()) for (const t of s.tools) if (`mcp_${slug(s.cfg.name)}__${t.name.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64) === declName) return { server: s, tool: t.name }
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

  static selfCheck(): string {
    const g = toGeminiSchema({ type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }) as any
    if (g.type !== 'OBJECT' || g.properties.path.type !== 'STRING') throw new Error('mcp: schema conversion')
    const sse = pickReply('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n', 'text/event-stream', 2)
    if (sse?.result?.ok !== 1 || pickReply('{"jsonrpc":"2.0","id":3,"result":{}}', 'application/json', 4) !== null) throw new Error('mcp: reply parsing')
    return 'mcp ok'
  }
}
