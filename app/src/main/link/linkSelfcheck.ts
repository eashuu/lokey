import { request } from 'node:http'
import { confirmEvents, _setCurrentForTest } from '../agent/permissions'
import { linkNewCode, linkTestStart, linkTestStop } from './server'
import { Devices, Limiter, Pairing, isPrivateAddr } from './core'

function assert(c: unknown, m: string) { if (!c) throw new Error(m) }

function pureCheck(): string {
  // pairing: right code works once, expires, and dies after 5 wrong tries
  const p = new Pairing()
  let { code } = p.issue(1000)
  assert(p.attempt(code, 2000) && !p.attempt(code, 2001), 'code is one-time')
  ;({ code } = p.issue(1000))
  assert(!p.attempt(code, 1000 + 120_001), 'code expires after 2 min')
  ;({ code } = p.issue(1000))
  const wrong = code === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) assert(!p.attempt(wrong, 1500), 'wrong code rejected')
  assert(!p.attempt(code, 1600), 'code dead after 5 attempts')
  // tokens: only the hash is stored, verify, revoke
  const d = new Devices(null)
  const { id, token } = d.add('Test phone')
  assert(token.length >= 43, '256-bit token')
  assert(!JSON.stringify(d.all()).includes(token), 'token not stored')
  assert(d.verify(token)?.id === id, 'token verifies')
  assert(!d.verify(token + 'x') && !d.verify(''), 'bad token rejected')
  assert(d.revoke(id) && !d.verify(token), 'revoke is immediate')
  assert(!d.all().some(x => x.scopes.includes('control' as never)), 'no control scope')
  // addresses
  for (const a of ['192.168.1.5', '10.0.0.2', '172.16.0.1', '172.31.9.9', '::ffff:192.168.0.9', '127.0.0.1', '::1', 'fd12::1', 'fe80::1%eth0']) assert(isPrivateAddr(a), `${a} is private`)
  for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.5', '2001:db8::1', '::ffff:8.8.8.8', '999.1.1.1', '', undefined]) assert(!isPrivateAddr(a as string), `${a} is public`)
  // limiter
  const l = new Limiter()
  for (let i = 0; i < 5; i++) l.fail('1.1.1.1', 0)
  assert(l.blocked('1.1.1.1', 1000) && !l.blocked('1.1.1.1', 3000) && !l.blocked('2.2.2.2', 0), 'backoff per address')
  return 'ok (pairing expiry/attempts, token hash/verify/revoke, private-LAN only, backoff)'
}

function call(port: number, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((res, rej) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, m => {
      let s = ''; m.on('data', c => (s += c)); m.on('end', () => { let j: any = null; try { j = JSON.parse(s) } catch { /* not json */ } res({ status: m.statusCode ?? 0, json: j }) })
    })
    r.on('error', rej); r.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

/** Pair -> status -> SSE confirm event -> approve -> say -> revoke -> 401, over real http, then a clean shutdown. */
async function e2e(): Promise<string> {
  const said: string[] = []
  const port = await linkTestStart({ say: t => { said.push(t); return true }, status: async () => ({ pc: 'online' }), recall: async () => [] })
  try {
    assert((await call(port, 'GET', '/status')).status === 401, 'no token is 401')
    assert((await call(port, 'POST', '/pair', undefined, { code: '000000', name: 'x' })).status === 403, 'no active code is refused')
    const { code } = linkNewCode()
    const p = await call(port, 'POST', '/pair', undefined, { code, name: 'Selfcheck phone' })
    assert(p.status === 200 && p.json.token, 'pairs')
    const tok: string = p.json.token
    assert((await call(port, 'POST', '/pair', undefined, { code, name: 'again' })).status === 403, 'code is one-time')
    const st = await call(port, 'GET', '/status', tok)
    assert(st.status === 200 && st.json.pc === 'online', 'status')
    // SSE: open the stream, raise a card, expect it on the wire, answer it through /approve
    const events: string[] = []
    const sse = request({ host: '127.0.0.1', port, path: '/events', headers: { Authorization: `Bearer ${tok}` } }, m => { m.on('data', c => events.push(String(c))) })
    sse.end()
    await new Promise(r => setTimeout(r, 200))
    const card = { id: 'selfchk1', title: 'Test card', detail: 'd', tool: 'open_app', timeoutMs: 30000 }
    let answer: boolean | null = null
    _setCurrentForTest(card, ok => { answer = ok })
    confirmEvents.emit('req', card)
    await new Promise(r => setTimeout(r, 200))
    assert(events.join('').includes('event: confirm') && events.join('').includes('selfchk1'), 'SSE carried the confirm card: ' + JSON.stringify(events))
    assert((await call(port, 'POST', '/approve', tok, { id: 'nope', allow: true })).status === 404, 'unknown card id')
    assert((await call(port, 'POST', '/approve', tok, { id: 'selfchk1', allow: true })).status === 200 && answer === true, 'approve resolves the card')
    assert((await call(port, 'POST', '/say', tok, { text: 'hello' })).status === 200 && said[0] === 'hello', 'say reaches the agent path')
    const id = (await call(port, 'GET', '/status', tok)).status
    assert(id === 200, 'still authorised')
    // revoke by listing the in-memory store through the module (id is the first device)
    const { linkState, linkRevoke } = await import('./server')
    const dev = linkState().devices[0]
    assert(dev && linkRevoke(dev.id), 'revoke')
    assert((await call(port, 'GET', '/status', tok)).status === 401, 'revoked token is 401 at once')
    sse.destroy()
  } finally {
    assert(await linkTestStop(), 'server shuts down cleanly')
  }
  return 'e2e ok'
}

export async function linkSelfCheck(): Promise<string> {
  return `${pureCheck()}; ${await e2e()}`
}
