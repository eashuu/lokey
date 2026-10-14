import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ProviderConfig } from '@shared/bridge'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolCtx } from '../agent/tools'
import { runComputerTool } from './computer'
import { runLoop } from './loop'
import { Router } from './router'
import { parseOpenAi, toOpenAiMessages } from './providers/openai'
import { parseResponse, toContents } from './providers/gemini'
import { ProviderError, toJsonSchema, type ChatMessage } from './types'

// `--selfcheck` for the model layer: the wire formats, the router's fallback and the agent loop, against a throw-away HTTP server on
// 127.0.0.1 that plays an OpenAI-compatible provider. No network, no key, no model.
type Reply = { status: number; body: unknown }

function mock(replies: Reply[]) {
  const seen: any[] = []
  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    let b = ''
    req.on('data', d => { b += d })
    req.on('end', () => {
      try { seen.push(JSON.parse(b)) } catch { seen.push(null) }
      const r = replies.shift() ?? { status: 500, body: { error: 'script ran out' } }
      res.writeHead(r.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(r.body))
    })
  })
  return new Promise<{ url: string; seen: any[]; close: () => void }>(resolve => srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`, seen, close: () => srv.close() })))
}

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const ok = (message: unknown) => ({ status: 200, body: { model: 'mock-1', choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 20 } } })

export async function brainSelfCheck(): Promise<string> {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('brain: ' + m) }

  // ---- wire formats
  const msgs: ChatMessage[] = [
    { role: 'user', text: 'hi', images: ['QUJD'] },
    { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'echo', args: { a: 1 } }] },
    { role: 'tool', toolResult: { id: 'c1', name: 'echo', result: '{"ok":true}' } },
    { role: 'tool', toolResult: { id: 'c2', name: 'echo', result: '{"ok":true}' } },
  ]
  const g = toContents(msgs)
  need(g.length === 3 && g[0].parts.length === 2 && g[1].role === 'model' && (g[1].parts[0] as any).functionCall.name === 'echo' && g[2].parts.length === 2, 'gemini contents: image, call, both results in one turn')
  const o = toOpenAiMessages('sys', msgs) as any[]
  need(o[0].role === 'system' && Array.isArray(o[1].content) && o[2].tool_calls[0].function.arguments === '{"a":1}' && o[3].role === 'tool' && o[3].tool_call_id === 'c1' && o.length === 5, 'openai messages')
  need(parseOpenAi({ choices: [{ message: { content: null, tool_calls: [call('x', 'echo', { n: 2 })] } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }, 'p', 'm').toolCalls[0].args.n === 2, 'openai tool call parsed')
  need(parseResponse({ candidates: [{ content: { parts: [{ text: 'hello' }, { functionCall: { name: 'echo', args: { z: 1 } } }] } }], usageMetadata: { promptTokenCount: 9 } }, 'p', 'm').toolCalls[0].args.z === 1, 'gemini function call parsed')
  need((toJsonSchema({ type: 'OBJECT', properties: { a: { type: 'STRING' } } }) as any).properties.a.type === 'string', 'schema types lower-cased')

  // ---- router fallback: the first provider is rate limited, the second answers; the first then rests
  const bad = await mock([{ status: 429, body: { error: 'slow down' } }])
  const good = await mock([ok({ role: 'assistant', content: 'from B' })])
  const cfg = (id: string, url: string): ProviderConfig => ({ id, name: id, kind: 'openai', baseUrl: url, model: 'm', enabled: true, keyRef: id, roles: ['main'], dailyLimit: 0 })
  const providers = [cfg('A', bad.url), cfg('B', good.url)]
  const router = new Router(() => providers, () => 'k', false)
  const r1 = await router.chat('main', { system: 's', messages: [{ role: 'user', text: 'x' }] })
  need(r1.text === 'from B' && r1.provider === 'B', 'falls through to the next provider')
  need(router.candidates('main').map(c => c.id).join() === 'B', 'a rate-limited provider rests')
  const u = router.getUsage()
  need(u.A.errors === 1 && u.B.requests === 1 && u.B.in === 100, 'usage is counted')
  bad.close()
  let none = false
  try { await new Router(() => [], () => null, false).chat('main', { system: '', messages: [] }) } catch (e) { none = e instanceof ProviderError }
  need(none, 'no provider gives a clear error')

  // ---- the loop: model asks for a tool, gets the result, answers; a tool that is not switched on is refused; repeats are cut
  const catalog = [{ name: 'echo', description: 'echo', parameters: { type: 'OBJECT', properties: { a: { type: 'NUMBER' } } } }, { name: 'secret', description: 's' }]
  const srv = await mock([
    ok({ role: 'assistant', content: null, tool_calls: [call('1', 'echo', { a: 7 }), call('2', 'secret', {})] }),
    ok({ role: 'assistant', content: 'The echo said 7.' }),
  ])
  const loopRouter = new Router(() => [cfg('L', srv.url)], () => 'k', false)
  const ran: string[] = []
  const out = await runLoop({ goal: 'echo 7', system: 'sys', role: 'main', catalog, enabled: new Set(['echo']), maxSteps: 5, router: loopRouter, run: async (n, a) => { ran.push(`${n}:${JSON.stringify(a)}`); return { result: { ok: true, value: a.a } } } })
  need(out.reason === 'done' && out.text === 'The echo said 7.' && out.steps === 2, 'loop finishes with the model\'s answer')
  need(ran.length === 1 && ran[0] === 'echo:{"a":7}', 'only the switched-on tool ran')
  const second = srv.seen[1]
  need(second.messages.filter((m: any) => m.role === 'tool').length === 2 && /not switched on/.test(second.messages.at(-1).content), 'the model was told the other tool is not available')
  need(srv.seen[0].tools.length === 2 && srv.seen[0].tools.some((t: any) => t.function.name === 'use_tools') && !srv.seen[0].tools.some((t: any) => t.function.name === 'secret'), 'only enabled tools (plus use_tools) are offered')
  srv.close()

  const loopy = await mock(Array.from({ length: 6 }, () => ok({ role: 'assistant', content: null, tool_calls: [call('r', 'echo', { a: 1 })] })))
  const r2 = await runLoop({ goal: 'again', system: 's', role: 'main', catalog, enabled: new Set(['echo']), maxSteps: 6, router: new Router(() => [cfg('R', loopy.url)], () => 'k', false), run: async () => ({ result: { ok: true } }) })
  need(r2.reason === 'max' && loopy.seen.at(-1).messages.some((m: any) => m.role === 'tool' && /three times/.test(m.content)), 'the same call is not allowed forever')
  loopy.close()

  const ctl = new AbortController(); ctl.abort()
  const stopped = await runLoop({ goal: 'x', system: 's', role: 'main', catalog, enabled: new Set(['echo']), maxSteps: 3, signal: ctl.signal, router: loopRouter, run: async () => ({ result: {} }) })
  need(stopped.reason === 'abort' && stopped.steps === 0, 'a stopped job makes no more calls')
  good.close()

  // ---- the file and shell tools, for real, in a throw-away folder
  const dir = mkdtempSync(join(tmpdir(), 'lokey-check-'))
  try {
    const ctx = {} as ToolCtx
    const f = join(dir, 'sub', 'a.txt')
    need((await runComputerTool('write_file', { path: f, content: 'héllo ' }, ctx)).result.ok === true, 'write_file creates folders and the file')
    await runComputerTool('write_file', { path: f, content: 'wörld', append: true }, ctx)
    need((await runComputerTool('read_file', { path: f }, ctx)).result.text === 'héllo wörld', 'read_file sees what was written, accents intact')
    const over = await runComputerTool('write_file', { path: f, content: 'new' }, ctx)
    need(typeof over.result.backup === 'string', 'overwriting keeps a backup')
    need(((await runComputerTool('list_dir', { path: join(dir, 'sub') }, ctx)).result.items as unknown[]).length === 1, 'list_dir')
    need((await runComputerTool('copy_file', { from: f, to: join(dir, 'b.txt') }, ctx)).result.ok === true && (await runComputerTool('move_file', { from: join(dir, 'b.txt'), to: join(dir, 'c.txt') }, ctx)).result.ok === true, 'copy then move')
    need((await runComputerTool('move_file', { from: f, to: join(dir, 'c.txt') }, ctx)).result.ok === false, 'nothing is overwritten by a move')
    const r = await runComputerTool('run_command', { command: 'Write-Output "hi from ps"; exit 3', timeout_s: 20 }, ctx)
    need(r.result.exit_code === 3 && /hi from ps/.test(String(r.result.output)), 'run_command returns output and the exit code')
    const t = await runComputerTool('run_command', { command: 'Start-Sleep -Seconds 20', timeout_s: 2 }, ctx)
    need(t.result.timed_out === true, 'a slow command is stopped')
    need((await runComputerTool('web_fetch', { url: 'http://127.0.0.1:1/' }, ctx)).result.ok === false, 'local addresses are never fetched')
  } finally { rmSync(dir, { recursive: true, force: true }) }
  return 'brain ok'
}
