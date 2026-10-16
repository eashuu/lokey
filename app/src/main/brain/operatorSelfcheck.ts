import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { UiTree } from '@shared/protocol'
import type { Sidecar } from '../sidecar'
import { TOOLS } from '../agent/tools'
import { FaultProvider, type Step } from '../ai/chaos'
import { Gateway } from '../ai/gateway'
import { runOperator } from './operator'
import { formatTree, remap, resolve } from './uia'
import raw from '../../../evals/uia/notepad-save-as.raw.json'
import recorded from '../../../evals/uia/notepad-save-as.tree.json'

// `--selfcheck` for computer use v2. HARD RULE: nothing here touches this PC. The "sidecar" is a fake that records the calls it is given
// (it never forwards one), the screen is a counter, the UI Automation tree is a RECORDED fixture (evals/uia: the raw nodes of a Save
// dialog, and the numbered list the sidecar's compacting code produced from them: `Lokey.Host.exe --uia-fixture` touches no window), and
// the grounding model is a script or a throw-away server on 127.0.0.1.
const TREE = recorded as unknown as UiTree
const id = (name: string, role = '') => TREE.nodes.find(n => n.name === name && (!role || n.role === role))!
const click = (nid: number): Step => ({ fault: 'ok', tool: { name: 'computer', args: { action: 'click', id: nid } } })
const finish: Step = { fault: 'ok', tool: { name: 'finish', args: { success: true, summary: 'done' } } }

function fake(o: { tree?: () => UiTree | null; title?: string; exe?: string } = {}) {
  const calls: { m: string; p: any }[] = []
  const sc = {
    call: async (m: string, p: any = {}) => {
      calls.push({ m, p })
      switch (m) {
        case 'ui.tree': { const t = o.tree ? o.tree() : TREE; if (!t) throw new Error('this window exposes no elements'); return t }
        case 'ui.act': case 'input.mouse': case 'input.keys': case 'text.insert': return { ok: true }
        case 'foreground.get': return { title: o.title ?? 'Save As', exe: o.exe ?? 'notepad.exe', pid: 4 }
        case 'text.focusRect': return { x: 0, y: 0, w: 10, h: 10, source: 'uia', password: false, hwnd: 7 }
        default: throw new Error('unexpected sidecar call ' + m)
      }
    },
  }
  return { sc: sc as unknown as Sidecar, calls }
}
let frame = 0
const capture = async () => ({ jpeg: `frame-${++frame}`, width: 1000, height: 1000 })
const gw = (fp: FaultProvider) => new Gateway(() => [{ id: fp.id, name: fp.id, kind: 'gemini', baseUrl: '', model: 'm', enabled: true, keyRef: 'k', roles: ['ground'], dailyLimit: 0 }], () => 'k', { db: null, build: () => fp })
const run = (sc: Sidecar, fp: FaultProvider, extra: Record<string, unknown> = {}) => runOperator({ goal: 'save the file as report.txt', sidecar: sc, signal: new AbortController().signal, router: gw(fp), capture, settleMs: 1, ...extra })
const toolText = (fp: FaultProvider, call: number) => fp.seen[call].messages.filter(m => m.role === 'tool').map(m => String(m.toolResult?.result)).join(' | ')

export async function operatorSelfCheck(): Promise<string> {
  let n = 0
  const ok = (c: boolean, m: string) => { if (!c) throw new Error('operator: ' + m); n++ }

  // ---- the recorded tree (made by the sidecar's own compacting code from the raw fixture) -----------------------------------------------------
  const save = id('Save', 'button'), field = id('File name:'), pw = id('Password'), dis = id('Disabled thing')
  ok(Array.isArray(raw) && raw.length > TREE.count && TREE.count === 12 && !TREE.truncated, 'compacting dropped the hidden, tiny, nameless, duplicate and non-interactive rows (17 raw -> 12 numbered)')
  ok(TREE.nodes.every((x, i) => x.id === i + 1) && save.canInvoke && field.canType && pw.password && !pw.canType && !dis.enabled, 'elements are numbered from 1, a password field can never take text')
  const shown = formatTree(TREE)
  ok(/\[\d+\] button "Save"/.test(shown) && /password: never typed into/.test(shown) && /disabled/.test(shown) && /not instructions/.test(shown), 'the list the model sees names role, name and state, and says the names are data')
  ok(remap(save, TREE)?.id === save.id && remap(save, { ...TREE, nodes: TREE.nodes.filter(x => x !== save) }) === null && remap(save, null) === null && resolve({ id: 99 }, TREE).kind === 'bad' && resolve({ id: dis.id }, TREE).kind === 'bad' && resolve({ x: 1 }, TREE).kind === 'point', 'an element is found again after the screen changed by role+name, or not at all; bad and disabled ids are refused')

  // ---- one action by element: UI Automation, no pointer ------------------------------------------------------------------------------------------
  {
    const f = fake(), fp = new FaultProvider('g', [click(save.id), finish])
    const ctl: boolean[] = []
    const r = await run(f.sc, fp, { onControl: (b: boolean) => ctl.push(b) })
    ok(r.ok && f.calls.some(c => c.m === 'ui.act' && c.p.action === 'invoke' && c.p.id === save.id && c.p.snapshot === 'fixture') && !f.calls.some(c => c.m === 'input.mouse'), 'a click by element number uses UI Automation (invoke), the mouse is not involved')
    ok(/\[\d+\] button "Save"/.test(fp.seen[0].messages[0].text ?? '') && fp.seen[0].messages[0].images?.length === 1, 'the model gets the screenshot AND the numbered list together')
    ok(ctl.join() === 'true,false', 'the "controlling" indicator is switched on and off around the run')
  }

  // ---- speculative batch: click a field, type, click Save (3 actions in one answer) ---------------------------------------------------------------
  {
    const f = fake(), fp = new FaultProvider('g', [{ fault: 'ok', tools: [{ name: 'computer', args: { action: 'click', id: field.id } }, { name: 'computer', args: { action: 'type', text: 'report.txt' } }, { name: 'computer', args: { action: 'click', id: save.id } }] }, finish])
    const r = await run(f.sc, fp)
    const order = f.calls.filter(c => ['input.mouse', 'text.insert', 'ui.act'].includes(c.m)).map(c => c.m + (c.m === 'ui.act' ? ':' + c.p.action : ''))
    ok(r.ok && order.join() === 'ui.act:focus,text.insert,ui.act:invoke' || order.join() === 'input.mouse,text.insert,ui.act:invoke', `a batch of three runs in order (${order.join()})`)
    ok(!/not done/.test(toolText(fp, 1)) && fp.seen[1].messages.filter(m => m.role === 'tool').length === 3, 'every call of the batch is answered')
    ok(f.calls.filter(c => c.m === 'ui.tree').length >= 2, 'before the later actions the tree is read again')
  }
  {   // the screen changes after the first action: the rest of the batch is NOT run
    let reads = 0
    const f = fake({ tree: () => (++reads <= 1 ? TREE : { ...TREE, snapshot: 'fixture2', nodes: TREE.nodes.filter(x => x.name !== 'Save') }) })
    const fp = new FaultProvider('g', [{ fault: 'ok', tools: [{ name: 'computer', args: { action: 'click', id: field.id } }, { name: 'computer', args: { action: 'click', id: save.id } }] }, finish])
    await run(f.sc, fp)
    ok(!f.calls.some(c => c.m === 'ui.act' && c.p.action === 'invoke') && /not done: the screen changed/.test(toolText(fp, 1)), 'when the element is gone after the first action, the batch stops there and the model is told')
  }
  {   // a blind click by position cannot follow another action; more than 3 actions are cut
    const f = fake(), fp = new FaultProvider('g', [{ fault: 'ok', tools: [{ name: 'computer', args: { action: 'key', keys: 'ctrl+a' } }, { name: 'computer', args: { action: 'click', x: 500, y: 500 } }, { name: 'computer', args: { action: 'key', keys: 'a' } }] }, finish])
    await run(f.sc, fp)
    ok(f.calls.filter(c => c.m === 'input.keys').length === 1 && !f.calls.some(c => c.m === 'input.mouse') && /by position/.test(toolText(fp, 1)), 'a click by position cannot follow another action without looking again')
    const f2 = fake(), many = Array.from({ length: 5 }, () => ({ name: 'computer', args: { action: 'key', keys: 'tab' } }))
    await run(f2.sc, new FaultProvider('g', [{ fault: 'ok', tools: many }, finish]))
    ok(f2.calls.filter(c => c.m === 'input.keys').length === 3, 'at most 3 actions per answer')
  }

  // ---- refusals --------------------------------------------------------------------------------------------------------------------------------------
  {
    const f = fake(), fp = new FaultProvider('g', [{ fault: 'ok', tool: { name: 'computer', args: { action: 'type', id: pw.id, text: 'hunter2' } } }, { fault: 'ok', tool: { name: 'computer', args: { action: 'click', id: dis.id } } }, { fault: 'ok', tool: { name: 'computer', args: { action: 'click', id: 99 } } }, finish])
    await run(f.sc, fp)
    ok(!f.calls.some(c => c.m === 'text.insert') && /password field/.test(toolText(fp, 1)) && /disabled/.test(toolText(fp, 2)) && /no element 99/.test(toolText(fp, 3)), 'nothing is typed into a password field, and disabled or unknown elements are refused with a reason')
  }
  {   // login screens end the run ("your turn") before anything is sent
    const f = fake({ title: 'Sign in to your account - Google Chrome', exe: 'chrome.exe' }), fp = new FaultProvider('g', [click(save.id), finish])
    const r = await run(f.sc, fp)
    ok(!r.ok && /^Your turn/.test(r.summary) && !f.calls.some(c => ['ui.act', 'input.mouse', 'input.keys', 'text.insert'].includes(c.m)), 'on a login window the run stops with "your turn" and sends no input at all')
  }

  // ---- no element list: pixels ---------------------------------------------------------------------------------------------------------------------------
  {
    const f = fake({ tree: () => null }), fp = new FaultProvider('g', [{ fault: 'ok', tool: { name: 'computer', args: { action: 'click', x: 500, y: 500 } } }, finish])
    const r = await run(f.sc, fp)
    ok(r.ok && /point with x and y/.test(fp.seen[0].messages[0].text ?? '') && f.calls.filter(c => c.m === 'input.mouse').length === 1, 'when the window exposes no elements the model is told to point, and the coordinate path still works')
  }

  // ---- the screen role through the gateway: a LOCAL grounding model (Ollama-style endpoint) -------------------------------------------------------------------------------
  {
    const seenBodies: string[] = []
    const replies = [{ tool_calls: [{ id: 'c1', type: 'function', function: { name: 'computer', arguments: JSON.stringify({ action: 'click', id: save.id }) } }] }, { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ success: true, summary: 'saved' }) } }] }]
    const srv = createServer((req, res) => { let b = ''; req.on('data', d => { b += d }); req.on('end', () => { seenBodies.push(b); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ model: 'ui-tars', choices: [{ message: { role: 'assistant', content: null, ...(replies.shift() ?? {}) } }], usage: { prompt_tokens: 9, completion_tokens: 3 } })) }) })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
    try {
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`
      const local = new Gateway(() => [{ id: 'ollama-ground', name: 'local screen model', kind: 'openai', baseUrl: base, model: 'ui-tars', enabled: true, keyRef: 'ollama', roles: ['ground', 'vision'], dailyLimit: 0, local: true }], () => null, { db: null })
      const f = fake()
      const r = await runOperator({ goal: 'save', sidecar: f.sc, signal: new AbortController().signal, router: local, capture, settleMs: 1 })
      ok(r.ok && f.calls.some(c => c.m === 'ui.act' && c.p.id === save.id), 'the ground role served by a local OpenAI-style endpoint (an Ollama grounding model) drives the loop')
      ok(seenBodies.length === 2 && /image_url/.test(seenBodies[0]) && /button \\"Save\\"/.test(seenBodies[0]), 'the local model is sent the screenshot and the element list')
    } finally { srv.close() }
  }

  // ---- API first ---------------------------------------------------------------------------------------------------------------------------------------
  ok(/LAST RESORT/.test(TOOLS.find(t => t.name === 'computer_task')?.description ?? ''), 'the screen tool is described as the last resort, after connectors, commands and files')
  return `operator ok (${n} checks)`
}
