import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'

// MCP wire layer: transports (stdio, Streamable HTTP) and version negotiation.
// Spec read 2026-10-16 at modelcontextprotocol.io/specification/2026-07-28 (basic/transports/streamable-http, basic/versioning, server/discover):
//  - 2026-07-28 ("modern") has no initialize handshake: every request carries _meta protocolVersion/clientInfo/clientCapabilities;
//    HTTP also needs MCP-Protocol-Version, Mcp-Method (+ Mcp-Name for tools/call) headers; no sessions, no GET stream.
//  - a version the server lacks => error -32022 with data.supported; header problems => -32020.
//  - era detection: modern request first (server/discover), a 4xx/error that is NOT a recognised modern error => legacy `initialize`.
//  - legacy Streamable HTTP (2025-03-26..2025-11-25) keeps Mcp-Session-Id (DELETE to end). HTTP+SSE (2024-11-05) is deprecated: not implemented.
export const MODERN = '2026-07-28'
export const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const META = 'io.modelcontextprotocol/'
const CLIENT = { name: 'lokey', version: '0.6.0' }

export interface Reply { result?: any; error?: { code?: number; message?: string; data?: any }; status?: number }
export interface Tx {
  call(method: string, params: Record<string, unknown>, ms: number, hdr?: Record<string, string>): Promise<Reply>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  /** the version header/session a legacy HTTP server needs from now on */
  setLegacy(version: string): void
  close(): void
}

/** the JSON-RPC message with this id out of a reply that is plain JSON or an SSE stream */
export function pickReply(body: string, contentType: string, id: number | string): Reply | null {
  const msgs: any[] = []
  if (/text\/event-stream/i.test(contentType)) {
    for (const ev of body.split(/\r?\n\r?\n/)) {
      const data = ev.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
      if (data) try { msgs.push(JSON.parse(data)) } catch { /* comment or junk */ }
    }
  } else try { const j = JSON.parse(body); msgs.push(...(Array.isArray(j) ? j : [j])) } catch { /* empty */ }
  const m = msgs.find(x => x && x.id === id && (x.result !== undefined || x.error))
  return m ? { result: m.result, error: m.error } : null
}

const b64 = (s: string) => `=?base64?${Buffer.from(s, 'utf8').toString('base64')}?=`
/** header value rule from the spec: plain visible ASCII as is, anything else (or sentinel look-alikes) base64 */
export const headerValue = (v: string) => (/^[\x20-\x7e]*$/.test(v) && !/^\s|\s$/.test(v) && !/^=\?base64\?.*\?=$/.test(v) ? v : b64(v))

/** x-mcp-header params reachable only through `properties` chains. Returns header name -> property path, or an error text (the tool must be dropped) */
export function mirroredParams(schema: unknown): { map: Record<string, string[]> } | { error: string } {
  const map: Record<string, string[]> = {}, seen = new Set<string>()
  const walk = (s: any, path: string[], depth: number): string | null => {
    if (!s || typeof s !== 'object' || depth > 8) return null
    if ('x-mcp-header' in s) {
      const n = s['x-mcp-header']
      if (typeof n !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(n)) return 'x-mcp-header is not a valid header token'
      if (seen.has(n.toLowerCase())) return 'x-mcp-header repeated'
      if (!['string', 'integer', 'boolean'].includes(s.type)) return 'x-mcp-header on a non-primitive'
      seen.add(n.toLowerCase()); map[n] = path
    }
    for (const k of ['items', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', '$ref']) if (JSON.stringify(s[k] ?? null).includes('"x-mcp-header"')) return 'x-mcp-header in an unreachable place'
    for (const [k, v] of Object.entries(s.properties ?? {})) { const e = walk(v, [...path, k], depth + 1); if (e) return e }
    return null
  }
  const e = walk(schema, [], 0)
  return e ? { error: e } : { map }
}
export function mirrorHeaders(map: Record<string, string[]>, args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [n, path] of Object.entries(map)) {
    let v: any = args
    for (const p of path) v = v && typeof v === 'object' ? v[p] : undefined
    if (v === undefined || v === null || typeof v === 'object') continue
    out[`Mcp-Param-${n}`] = headerValue(String(v))
  }
  return out
}

// ---- stdio ---------------------------------------------------------------------------------------------------------
export class StdioTx implements Tx {
  proc: ChildProcessWithoutNullStreams | null = null
  error = ''
  private next = 1
  private pending = new Map<number, { resolve: (r: Reply) => void; timer: ReturnType<typeof setTimeout> }>()
  private buf = ''
  constructor(private command: string, private args: string[], private env?: NodeJS.ProcessEnv) {}

  start() {
    const winShell = process.platform === 'win32' && !/\.exe$/i.test(this.command) // npx, uvx, node shims are .cmd files
    this.proc = spawn(this.command, this.args, { stdio: 'pipe', windowsHide: true, shell: winShell, env: this.env ? { ...process.env, ...this.env } : process.env })
    this.proc.stdout.setEncoding('utf8').on('data', d => this.onData(d))
    this.proc.stderr.on('data', () => undefined)
    this.proc.on('error', e => { this.error = e.message; this.failAll(e.message) })
    this.proc.on('exit', code => { if (!this.error && code) this.error = `exited with code ${code}`; this.failAll('server exited'); this.proc = null })
  }
  private send(msg: unknown) { this.proc?.stdin.write(JSON.stringify(msg) + '\n') }
  private failAll(m: string) { for (const [id, p] of this.pending) { clearTimeout(p.timer); p.resolve({ error: { code: -32000, message: m } }); this.pending.delete(id) } }
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
        this.pending.delete(m.id); clearTimeout(p.timer)
        p.resolve({ result: m.result, error: m.error })
      } else if (m.id !== undefined && m.method) {
        // a request from the server (sampling, roots...): we support none of them
        this.send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported' } })
      }
    }
  }
  call(method: string, params: Record<string, unknown>, ms: number): Promise<Reply> {
    return new Promise(resolve => {
      const id = this.next++
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ error: { code: -32001, message: `${method} timed out` } }) }, ms)
      this.pending.set(id, { resolve, timer })
      try { this.send({ jsonrpc: '2.0', id, method, params }) } catch (e) { clearTimeout(timer); this.pending.delete(id); resolve({ error: { code: -32000, message: String(e) } }) }
    })
  }
  async notify(method: string, params?: Record<string, unknown>) { this.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) }
  setLegacy() { /* nothing to remember on a pipe */ }
  close() { this.failAll('stopped'); try { this.proc?.kill() } catch { /* gone */ } this.proc = null }
}

// ---- Streamable HTTP -----------------------------------------------------------------------------------------------
export class HttpTx implements Tx {
  private next = 1
  private session = ''
  private legacyVersion = ''
  constructor(private url: string, private headers: Record<string, string>, private f: typeof fetch) {}
  setLegacy(v: string) { this.legacyVersion = v }
  private head(extra: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...this.headers, ...extra }
    if (this.legacyVersion) h['MCP-Protocol-Version'] = this.legacyVersion
    if (this.session) h['Mcp-Session-Id'] = this.session
    return h
  }
  async call(method: string, params: Record<string, unknown>, ms: number, hdr: Record<string, string> = {}): Promise<Reply> {
    const id = this.next++
    const meta = (params._meta as Record<string, unknown> | undefined)?.[META + 'protocolVersion']
    const extra: Record<string, string> = { ...hdr }
    if (typeof meta === 'string') {
      extra['MCP-Protocol-Version'] = meta; extra['Mcp-Method'] = method
      if (method === 'tools/call' && typeof params.name === 'string') extra['Mcp-Name'] = headerValue(params.name)
    }
    let r: Response
    try { r = await this.f(this.url, { method: 'POST', headers: this.head(extra), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(ms) }) } catch (e) { return { error: { code: -32000, message: e instanceof Error ? e.message : String(e) } } }
    const sid = r.headers.get('Mcp-Session-Id'); if (sid) this.session = sid
    const text = await r.text().catch(() => '')
    const m = pickReply(text, r.headers.get('Content-Type') ?? '', id)
    if (m) return { ...m, status: r.status }
    return { status: r.status, error: { code: r.ok ? -32000 : -r.status, message: r.ok ? 'no reply' : `the server answered ${r.status}` } }
  }
  async notify(method: string, params?: Record<string, unknown>) {
    await this.f(this.url, { method: 'POST', headers: this.head({}), body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
  }
  close() { if (this.session) void this.f(this.url, { method: 'DELETE', headers: this.head({}), signal: AbortSignal.timeout(3000) }).catch(() => undefined); this.session = '' }
}

// ---- negotiation ---------------------------------------------------------------------------------------------------
export interface Session { era: 'modern' | 'legacy'; version: string; tx: Tx; instructions?: string }
/** errors a modern server (and nobody else) produces: -32022 unsupported version, -32020 header mismatch */
const modernError = (r: Reply) => r.error?.code === -32022 || r.error?.code === -32020
const meta = (version: string) => ({ [META + 'protocolVersion']: version, [META + 'clientInfo']: CLIENT, [META + 'clientCapabilities']: {} })

export async function negotiate(tx: Tx, ms = 8000): Promise<Session> {
  let r = await tx.call('server/discover', { _meta: meta(MODERN) }, ms)
  let supported: string[] = Array.isArray(r.result?.supportedVersions) ? r.result.supportedVersions : []
  if (r.error && r.error.code === -32022) supported = Array.isArray(r.error.data?.supported) ? r.error.data.supported : []
  if (r.result?.supportedVersions || r.error?.code === -32022) {
    if (supported.includes(MODERN)) {
      if (r.error) r = await tx.call('server/discover', { _meta: meta(MODERN) }, ms)
      if (!r.error) return { era: 'modern', version: MODERN, tx, instructions: typeof r.result?.instructions === 'string' ? r.result.instructions : undefined }
    }
    // a dual-era server that no longer offers the modern version: use the newest legacy one both sides know
    if (!supported.some(v => LEGACY.includes(v))) throw new Error(`no common MCP version (server offers ${supported.join(', ') || 'none'})`)
  } else if (modernError(r)) throw new Error('the server rejected the request headers')
  // legacy (initialize) era
  const init = await tx.call('initialize', { protocolVersion: LEGACY[0], capabilities: {}, clientInfo: CLIENT }, ms)
  if (init.error) throw new Error(init.error.message ?? 'initialize failed')
  const v = String(init.result?.protocolVersion ?? '')
  if (!LEGACY.includes(v)) throw new Error(`the server answered with an MCP version I do not speak (${v || 'none'})`)
  tx.setLegacy(v)
  await tx.notify('notifications/initialized')
  return { era: 'legacy', version: v, tx, instructions: typeof init.result?.instructions === 'string' ? init.result.instructions : undefined }
}

/** one request in the session's era; throws on a JSON-RPC error */
export async function rpc(s: Session, method: string, params: Record<string, unknown>, ms: number, hdr?: Record<string, string>): Promise<any> {
  const p = s.era === 'modern' ? { ...params, _meta: { ...((params._meta as object) ?? {}), ...meta(s.version) } } : params
  const r = await s.tx.call(method, p, ms, hdr)
  if (r.error) throw new Error(String(r.error.message ?? 'error'))
  if (r.result?.resultType === 'input_required') throw new Error('the tool asked for extra input (elicitation), which Lokey does not support yet')
  return r.result
}

// ---- tool definition pins ------------------------------------------------------------------------------------------
/** hash of everything the model reads about a tool: a changed hash means the definition was edited after the user first saw it */
export const toolHash = (t: { name: string; title?: string; description?: string; inputSchema?: unknown; annotations?: unknown }) =>
  createHash('sha256').update(JSON.stringify([t.name, t.title ?? '', t.description ?? '', t.inputSchema ?? null, t.annotations ?? null])).digest('hex').slice(0, 16)

export class PinStore {
  pins: Record<string, Record<string, string>> = {}
  constructor(private save: (d: Record<string, Record<string, string>>) => void = () => {}) {}
  load(d: unknown) { this.pins = d && typeof d === 'object' ? (d as typeof this.pins) : {} }
  /** first sight of a server pins everything ('new'); later a different hash, or a tool that was not there before, is 'changed' until accepted */
  check(server: string, tool: string, hash: string): 'new' | 'same' | 'changed' {
    const known = this.pins[server]
    if (!known) return 'new'
    return known[tool] === hash ? 'same' : 'changed'
  }
  pinAll(server: string, hashes: Record<string, string>) { if (!this.pins[server]) { this.pins[server] = { ...hashes }; this.save(this.pins) } }
  accept(server: string, tool: string, hash: string) { (this.pins[server] ??= {})[tool] = hash; this.save(this.pins) }
  forget(server: string) { delete this.pins[server]; this.save(this.pins) }
}
