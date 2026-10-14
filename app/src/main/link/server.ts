import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { clipboard } from 'electron'
import type { ConfirmRequest } from '@shared/voice'
import { dataDir } from '../settings'
import { answerConfirm, confirmEvents, logAction, pendingConfirm } from '../agent/permissions'
import { Devices, Limiter, Pairing, isPrivateAddr, type Device, type Scope } from './core'
import indexHtml from './web/index.html?raw'
import appJs from './web/app.js?raw'
import swJs from './web/sw.js?raw'
import manifest from './web/manifest.webmanifest?raw'
import iconSvg from './web/icon.svg?raw'

// Lokey Link, PC side: a small LAN-only HTTP + Server-Sent-Events API for the phone web app (see docs/MOBILE.md).
export interface LinkDeps {
  /** false when the assistant is busy */
  say(text: string, origin: string): boolean
  status(): Promise<Record<string, unknown>>
  recall(q: string): Promise<unknown[]>
  /** memory sync with a standalone phone: what the PC knows, and adding what the phone learned (duplicates merge in the memory engine) */
  facts?(): { text: string; kind: string; pinned: boolean; updated: number }[]
  addFacts?(items: { text: string; kind?: string }[]): Promise<number>
}
const cfgFile = join(dataDir, 'link.json')
const DEFAULT_PORT = 47831
let devices = new Devices(join(dataDir, 'devices.json'))
const pairing = new Pairing()
const limiter = new Limiter()
const clients = new Set<{ res: ServerResponse; dev: Device }>()
let server: Server | null = null
let deps: LinkDeps | null = null
let cfg = { enabled: false, port: DEFAULT_PORT }
try { cfg = { ...cfg, ...JSON.parse(readFileSync(cfgFile, 'utf8')) } } catch { /* first run: off */ }

export function lanUrl(): string | null {
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && isPrivateAddr(i.address)) return `http://${i.address}:${cfg.port}`
  return null
}
export const linkState = () => ({ enabled: cfg.enabled, running: !!server, port: cfg.port, url: lanUrl(), devices: devices.all(), pairing: pairing.active })
export const linkNewCode = () => pairing.issue()
export function linkRevoke(id: string) {
  const ok = devices.revoke(id)
  for (const c of [...clients]) if (c.dev.id === id) { c.res.end(); clients.delete(c) } // cut the live stream right now
  return ok
}
export function linkSetEnabled(on: boolean) {
  cfg.enabled = on
  try { mkdirSync(dataDir, { recursive: true }); writeFileSync(cfgFile, JSON.stringify(cfg)) } catch { /* ignore */ }
  if (on) start(); else stop()
  return linkState()
}
/** Broadcast to phones holding the notify/view scope (nudges, finished jobs, status). */
export function linkPush(type: string, data: unknown) {
  for (const c of clients) if (c.dev.scopes.includes('notify')) c.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
}

let wired = false
function wireEvents() {
  if (wired) return
  wired = true
  confirmEvents.on('req', (r: ConfirmRequest) => { for (const c of clients) if (c.dev.scopes.includes('agent')) c.res.write(`event: confirm\ndata: ${JSON.stringify(r)}\n\n`) })
  confirmEvents.on('done', (id: string, ok: boolean) => { for (const c of clients) c.res.write(`event: confirm-done\ndata: ${JSON.stringify({ id, ok })}\n\n`) })
}
export function startLink(d: LinkDeps) {
  deps = d
  wireEvents()
  if (cfg.enabled) start()
}
export const stopLink = () => stop()

function stop() { for (const c of clients) c.res.end(); clients.clear(); server?.close(); server?.closeAllConnections(); server = null }
function start() {
  if (server) return
  server = createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end() }) })
  server.on('error', () => { server = null })
  server.listen(cfg.port, '0.0.0.0')
}

const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = ''
  for await (const c of req) { s += c; if (s.length > 20_000) throw new Error('too big') }
  try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : {} } catch { return {} }
}
const STATIC: Record<string, [string, string]> = {
  '/': ['text/html; charset=utf-8', indexHtml], '/index.html': ['text/html; charset=utf-8', indexHtml], '/app.js': ['text/javascript', appJs], '/sw.js': ['text/javascript', swJs],
  '/manifest.webmanifest': ['application/manifest+json', manifest], '/icon.svg': ['image/svg+xml', iconSvg],
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const ip = req.socket.remoteAddress ?? ''
  if (!isPrivateAddr(ip)) { res.writeHead(403); res.end(); return } // private LAN only
  const url = new URL(req.url ?? '/', 'http://x')
  const path = url.pathname
  if (req.method === 'GET' && STATIC[path]) { res.writeHead(200, { 'Content-Type': STATIC[path][0], 'Cache-Control': 'no-cache' }); res.end(STATIC[path][1]); return }
  if (limiter.blocked(ip)) { res.writeHead(429, { 'Retry-After': '30' }); res.end(); return }

  if (req.method === 'POST' && path === '/pair') {
    const b = await body(req)
    if (!pairing.attempt(String(b.code ?? ''))) { limiter.fail(ip); return json(res, 403, { error: 'wrong or expired code' }) }
    limiter.ok(ip)
    const { id, token } = devices.add(String(b.name ?? 'Phone'))
    logAction({ tool: 'link.pair', summary: `Paired phone "${devices.all().find(d => d.id === id)?.name}"`, outcome: 'done' })
    return json(res, 200, { id, token })
  }

  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
  const dev = m ? devices.verify(m[1]) : null
  if (!dev) { limiter.fail(ip); return json(res, 401, { error: 'unauthorized' }) }
  limiter.ok(ip)
  devices.touch(dev.id)
  const need = (s: Scope) => { if (!dev.scopes.includes(s)) { json(res, 403, { error: `missing scope ${s}` }); return false } return true }
  const origin = `remote:${dev.id}`

  if (req.method === 'GET' && path === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    const c = { res, dev }
    clients.add(c)
    res.write('retry: 3000\n\n')
    const pend = pendingConfirm()
    if (pend && dev.scopes.includes('agent')) res.write(`event: confirm\ndata: ${JSON.stringify(pend)}\n\n`)
    const ka = setInterval(() => res.write(': ka\n\n'), 20_000)
    req.on('close', () => { clearInterval(ka); clients.delete(c) })
    return
  }
  if (req.method === 'GET' && path === '/status') { if (!need('view')) return; return json(res, 200, await deps!.status()) }
  if (req.method === 'GET' && path === '/memory/search') { if (!need('view')) return; return json(res, 200, await deps!.recall(String(url.searchParams.get('q') ?? '').slice(0, 200))) }
  if (req.method === 'GET' && path === '/sync/facts') { if (!need('view')) return; return json(res, 200, { facts: deps!.facts?.() ?? [] }) }
  if (req.method === 'POST' && path === '/sync/facts') {
    if (!need('agent')) return
    const items = ((await body(req)).facts as unknown[] | undefined ?? []).slice(0, 200).map(f => ({ text: String((f as { text?: unknown }).text ?? '').slice(0, 300), kind: String((f as { kind?: unknown }).kind ?? 'fact') })).filter(f => f.text.length > 2)
    const added = deps!.addFacts ? await deps!.addFacts(items) : 0
    if (added) logAction({ tool: 'link.sync', summary: `${origin} synced ${added} new memories to the PC`, outcome: 'done' })
    return json(res, 200, { ok: true, added })
  }
  if (req.method === 'POST' && path === '/approve') {
    if (!need('agent')) return
    const b = await body(req)
    const ok = answerConfirm(String(b.id ?? ''), b.allow === true)
    if (ok) logAction({ tool: 'link.approve', summary: `${origin} ${b.allow === true ? 'allowed' : 'denied'} a confirm card`, outcome: 'done' })
    return json(res, ok ? 200 : 404, { ok })
  }
  if (req.method === 'POST' && path === '/say') {
    if (!need('agent')) return
    const text = String((await body(req)).text ?? '').trim().slice(0, 1000)
    if (!text) return json(res, 400, { error: 'empty' })
    logAction({ tool: 'link.say', summary: `${origin}: ${text.slice(0, 80)}`, outcome: 'done' })
    if (!deps!.say(text, origin)) return json(res, 409, { error: 'busy' }) // same text path as typing, forced to at most the risky mode
    return json(res, 200, { ok: true })
  }
  if (req.method === 'POST' && path === '/clipboard') {
    if (!need('agent')) return
    const text = String((await body(req)).text ?? '').slice(0, 20_000)
    if (!text) return json(res, 400, { error: 'empty' })
    clipboard.writeText(text)
    logAction({ tool: 'link.clipboard', summary: `${origin} sent ${text.length} chars to the clipboard`, outcome: 'done' })
    return json(res, 200, { ok: true })
  }
  json(res, 404, { error: 'not found' })
}

/** self-check only: an isolated in-memory instance on an ephemeral loopback port (loopback counts as private). */
export async function linkTestStart(d: LinkDeps): Promise<number> {
  devices = new Devices(null); wireEvents()
  deps = d
  server = createServer((req, res) => { void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end() }) })
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
  return (server!.address() as { port: number }).port
}
export function linkTestStop(): Promise<boolean> {
  return new Promise(r => { if (!server) return r(true); const s = server; stop(); s.once('close', () => r(true)); setTimeout(() => r(false), 3000) })
}
