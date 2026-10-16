import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { installedCli } from './roles'
import { clip } from './types'

// Hand a programming job to a coding agent that is already installed and signed in on this PC: Claude Code (`claude -p`) or
// Codex (`codex exec`). Lokey runs the user's own, unmodified command-line tool; it never reads or forwards anyone's login. The
// task goes in on stdin (no shell quoting to get wrong), progress comes back as JSON lines, and stopping ends the whole process tree.
// Checked against the real claude 2.1.301 (`--help`, nothing was run): -p, --output-format stream-json (needs --verbose), --allowedTools,
// --permission-mode {acceptEdits, auto, bypassPermissions, manual, dontAsk, plan} (there is NO "default" mode), the prompt on stdin.
const TIMEOUT_MS = 20 * 60_000
const IDLE_MS = 5 * 60_000        // no output at all for this long: it is stuck (waiting for a login or a question nobody can answer)

export type CliTool = 'claude' | 'codex'
export const CLI_NAME: Record<CliTool, string> = { claude: 'Claude Code', codex: 'Codex' }
export const INSTALL_HINT: Record<CliTool, string> = {
  claude: 'Claude Code is not installed on this PC (install it from claude.ai/code, then sign in once by running "claude" in a terminal).',
  codex: 'Codex is not installed on this PC (npm install -g @openai/codex, then sign in once by running "codex" in a terminal).',
}
const NOT_SIGNED_IN = /not logged in|please run \/login|invalid api key|authentication[_ ]?(error|failed|required)|unauthorized|sign in|log ?in (first|required)|401/i

/** where the app looks besides PATH: the packaged app is started by Windows, whose PATH may lack the user folders a CLI installer added later */
function extraDirs(): string[] {
  const h = homedir(), ad = process.env.APPDATA ?? join(h, 'AppData', 'Roaming'), la = process.env.LOCALAPPDATA ?? join(h, 'AppData', 'Local')
  return [join(h, '.local', 'bin'), join(ad, 'npm'), join(la, 'Programs', 'claude'), join(la, 'Microsoft', 'WinGet', 'Links'), join(h, '.claude', 'local'), join(h, 'AppData', 'Roaming', 'npm')]
}
/** PATH with those folders added (also for the CLI itself, so the tools it starts are found) */
export function cliEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cur = (base.PATH ?? base.Path ?? '').split(delimiter).filter(Boolean)
  const add = extraDirs().filter(d => existsSync(d) && !cur.some(c => c.toLowerCase() === d.toLowerCase()))
  return { ...base, PATH: [...cur, ...add].join(delimiter) }
}

/** tests: pretend a CLI is (not) installed and run a mock in its place */
export const cliTest: { installed?: Partial<Record<CliTool, boolean>>; command?: (tool: CliTool) => CliRun['command'] } = {}

/** where the tool is installed, or null: the usual install folders first (.exe, then the npm .cmd shim; PATHEXT order), then `where` on PATH */
export function findCli(tool: CliTool): Promise<string | null> {
  if (cliTest.installed && tool in cliTest.installed) return Promise.resolve(cliTest.installed[tool] ? '<test cli>' : null)
  const exts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';').filter(Boolean)
  const order = ['.exe', ...exts.filter(e => e !== '.exe')]
  for (const d of extraDirs()) for (const e of order) { const f = join(d, tool + e); try { if (existsSync(f) && statSync(f).isFile()) return Promise.resolve(f) } catch { /* next */ } }
  return new Promise(resolve => execFile('where.exe', [tool], { windowsHide: true, timeout: 4000, env: cliEnv() }, (err, out) => {
    if (err) return resolve(null)
    const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    resolve(lines.find(l => /\.exe$/i.test(l)) ?? lines.find(l => /\.cmd$/i.test(l)) ?? lines[0] ?? null)
  }))
}

/** claude -p (stream-json) and codex exec (--json) event -> a short progress line, the final answer, or an error */
/** look for the CLIs on this PC and remember it (what the 'agents' tool group offers) */
export async function refreshCli(): Promise<void> {
  const [c, x] = await Promise.all([findCli('claude'), findCli('codex')])
  installedCli.claude = !!c; installedCli.codex = !!x; installedCli.at = Date.now()
}

export function parseCliLine(tool: CliTool, line: string): { progress?: string; final?: string; error?: string } {
  let j: any
  try { j = JSON.parse(line) } catch { return {} }
  if (tool === 'claude') {
    if (j.type === 'result') {
      const text = typeof j.result === 'string' ? j.result : undefined
      if (j.is_error || /^error/.test(String(j.subtype ?? ''))) return { error: text || String(j.subtype ?? 'the run failed') }
      return { final: text }
    }
    if (j.type === 'system' && j.subtype === 'init') return { progress: `started${j.model ? ' (' + String(j.model) + ')' : ''}` }
    if (j.type === 'assistant') {
      for (const c of j.message?.content ?? []) {
        if (c.type === 'tool_use') return { progress: `${c.name}${c.input?.file_path ? ' ' + String(c.input.file_path).split(/[\\/]/).pop() : c.input?.command ? ': ' + clip(String(c.input.command), 50) : c.input?.pattern ? ': ' + clip(String(c.input.pattern), 40) : ''}` }
        if (c.type === 'text' && c.text) return { progress: clip(String(c.text).replace(/\s+/g, ' '), 70) }
      }
    }
    return {}
  }
  if (j.type === 'item.completed' && j.item) {
    if (j.item.type === 'agent_message' && j.item.text) return { final: String(j.item.text), progress: clip(String(j.item.text).replace(/\s+/g, ' '), 70) }
    if (j.item.type === 'command_execution') return { progress: `ran ${clip(String(j.item.command ?? ''), 50)}` }
    if (j.item.type === 'file_change') return { progress: 'changed files' }
  }
  if (j.type === 'error' && j.message) return { error: String(j.message) }
  return {}
}

export function cliArgs(tool: CliTool, allowEdits: boolean): string[] {
  if (tool === 'claude') {
    // read-only: "dontAsk" refuses everything that is not on the allowed list instead of waiting for a question nobody can answer
    return ['-p', '--output-format', 'stream-json', '--verbose', '--allowedTools', allowEdits ? 'Read,Glob,Grep,Edit,Write,Bash' : 'Read,Glob,Grep', '--permission-mode', allowEdits ? 'acceptEdits' : 'dontAsk']
  }
  return ['exec', '--json', '--skip-git-repo-check', '--sandbox', allowEdits ? 'workspace-write' : 'read-only', '-']
}

export interface CliRun {
  tool: CliTool; task: string; folder: string; allowEdits: boolean; signal: AbortSignal; onLine: (line: string) => void
  /** tests: run this instead of the real tool (a mock that prints claude's stream-json) */
  command?: { exe: string; args: string[]; env?: NodeJS.ProcessEnv }
  timeoutMs?: number; idleMs?: number
}

/** a message for the person when the tool says it cannot work: not signed in, or its own error text */
export function explainCliError(tool: CliTool, text: string): string {
  return NOT_SIGNED_IN.test(text) ? `${CLI_NAME[tool]} is not signed in. Open a terminal, run "${tool}" and sign in once, then ask me again.` : `${CLI_NAME[tool]} reported an error: ${clip(text.replace(/\s+/g, ' '), 240)}`
}

export async function runCli(o: CliRun): Promise<{ ok: boolean; text: string }> {
  const command = o.command ?? cliTest.command?.(o.tool)
  const exe = command?.exe ?? await findCli(o.tool)
  if (!exe) return { ok: false, text: INSTALL_HINT[o.tool] }
  if (!o.folder || !existsSync(o.folder) || !statSync(o.folder).isDirectory()) return { ok: false, text: o.folder ? `The project folder "${o.folder}" does not exist.` : 'Which project folder should it work in? Tell me the folder.' }
  return new Promise(resolve => {
    const args = command?.args ?? cliArgs(o.tool, o.allowEdits)
    const shell = !command && /\.(cmd|bat)$/i.test(exe) // npm installs are .cmd shims
    const p = spawn(shell ? `"${exe}"` : exe, args, { cwd: o.folder, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: command?.env ?? cliEnv() })
    let final = '', err = '', tail = '', buf = '', done = false
    const finish = (ok: boolean, text: string) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(idle); o.signal.removeEventListener('abort', stop); resolve({ ok, text }) }
    // end the whole tree: first the polite taskkill /T (a console program cannot be sent Ctrl+Break from Node), then /F two seconds later
    const kill = () => {
      const pid = p.pid
      if (!pid) return
      execFile('taskkill', ['/pid', String(pid), '/T'], { windowsHide: true }, () => undefined)
      setTimeout(() => execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined), 2000).unref?.()
    }
    const stop = () => { kill(); finish(false, final || 'Stopped.') }
    const timer = setTimeout(() => { kill(); finish(false, final || `It took more than ${Math.round((o.timeoutMs ?? TIMEOUT_MS) / 60_000)} minutes, so I stopped it.`) }, o.timeoutMs ?? TIMEOUT_MS)
    let idle = setTimeout(() => undefined, 0)
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => { kill(); finish(false, final || `${CLI_NAME[o.tool]} went quiet for ${Math.round((o.idleMs ?? IDLE_MS) / 60_000) || 'a few'} minutes (it may be waiting for a sign-in or a question), so I stopped it.`) }, o.idleMs ?? IDLE_MS) }
    bump()
    o.signal.addEventListener('abort', stop)
    p.stdout.on('data', (d: Buffer) => {
      bump()
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        const r = parseCliLine(o.tool, line)
        if (r.final) final = r.final
        if (r.error) err = r.error
        if (r.progress) o.onLine(r.progress)
      }
    })
    p.stderr.on('data', (d: Buffer) => { bump(); tail = (tail + d.toString('utf8')).slice(-600) })
    p.on('error', e => finish(false, `Could not start ${CLI_NAME[o.tool]}: ${e.message}`))
    p.on('close', code => {
      if (err) return finish(false, explainCliError(o.tool, err))
      if (code === 0 && final) return finish(true, final)
      const why = tail.replace(/\s+/g, ' ').trim()
      finish(false, final || (code === 0 ? 'It finished without a report.' : NOT_SIGNED_IN.test(why) ? explainCliError(o.tool, why) : `${CLI_NAME[o.tool]} stopped with an error${why ? ': ' + clip(why, 200) : ` (exit code ${code})`}`))
    })
    p.stdin.on('error', () => undefined)
    p.stdin.end(o.task)
  })
}

// ---- a stand-in for the real CLI, for the self-check and for trying the whole path without a model ---------------------------------------------
const MOCK = `
const mode = process.argv[2] || 'ok'
let task = ''
process.stdin.on('data', d => { task += d })
const out = o => process.stdout.write(JSON.stringify(o) + '\\n')
process.stdin.on('end', () => {
  if (mode === 'notlogged') { out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in \\u00b7 Please run /login' }); process.exit(1) }
  out({ type: 'system', subtype: 'init', model: 'mock-claude' })
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:\\\\proj\\\\a.ts' } }] } })
  if (mode === 'hang') { setInterval(() => out({ type: 'assistant', message: { content: [{ type: 'text', text: 'still working on it' }] } }), 100); return }
  if (mode === 'silent') { setInterval(() => {}, 1000); return }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading ' + task.length + ' characters of task' }] } })
  if (mode === 'fail') { process.stderr.write('boom'); process.exit(3) }
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Fixed it: ' + task.slice(0, 20) })
})
`
/** writes the mock to a temp folder and returns what \`runCli({ command })\` needs */
export function mockCli(mode: 'ok' | 'notlogged' | 'hang' | 'silent' | 'fail'): { exe: string; args: string[]; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), 'lokey-mockcli-'))
  const f = join(dir, 'mock.cjs')
  writeFileSync(f, MOCK)
  return { exe: process.execPath, args: [f, mode], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
}

export async function cliSelfCheck(): Promise<string> {
  let n = 0
  const need = (c: boolean, m: string) => { n++; if (!c) throw new Error('cli: ' + m) }
  need(parseCliLine('claude', '{"type":"result","result":"All done."}').final === 'All done.', 'claude result')
  need(/Edit a\.ts/.test(parseCliLine('claude', '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"C:\\\\x\\\\a.ts"}}]}}').progress ?? ''), 'claude tool use')
  need(parseCliLine('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"Fixed it."}}').final === 'Fixed it.', 'codex message')
  need(parseCliLine('codex', 'not json').final === undefined, 'garbage ignored')
  const ro = cliArgs('claude', false), rw = cliArgs('claude', true)
  need(ro.includes('Read,Glob,Grep') && !ro.join(' ').includes('Bash') && cliArgs('codex', false).includes('read-only') && cliArgs('codex', true).includes('workspace-write'), 'read-only unless edits are allowed')
  need(ro.includes('dontAsk') && !ro.includes('default') && rw.includes('acceptEdits') && ro.includes('--verbose') && ro.includes('stream-json'), 'claude 2.1.301 flags: stream-json with --verbose, a permission mode that exists')
  need(parseCliLine('claude', '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in"}').error === 'Not logged in', 'an error result is an error')
  need(/not signed in/.test(explainCliError('claude', 'Not logged in · Please run /login')) && /Codex is not installed/.test(INSTALL_HINT.codex), 'plain messages for not signed in and not installed')
  need(cliEnv({ PATH: 'C:\\x' }).PATH!.startsWith('C:\\x'), 'the PATH is extended, not replaced')
  if (process.platform === 'android') return `cli ok (${n} checks; no programs run on a phone)`
  // the whole path against the mock (no model, no login): progress lines, the answer, a missing folder, not signed in, a crash, idle and total timeouts, stop
  const dir = mkdtempSync(join(tmpdir(), 'lokey-proj-'))
  const lines: string[] = []
  const ctl = new AbortController()
  const base = { tool: 'claude' as const, task: 'fix the login bug', folder: dir, allowEdits: false, signal: ctl.signal, onLine: (l: string) => { lines.push(l) } }
  const ok = await runCli({ ...base, command: mockCli('ok') })
  need(ok.ok && /Fixed it: fix the login bug/.test(ok.text) && lines.some(l => /Read a\.ts/.test(l)) && lines.some(l => /started \(mock-claude\)/.test(l)), 'a run streams its progress and returns the answer (task read from stdin)')
  const nf = await runCli({ ...base, folder: join(dir, 'missing'), command: mockCli('ok') })
  need(!nf.ok && /does not exist/.test(nf.text), 'a missing folder is said plainly')
  const nof = await runCli({ ...base, folder: '', command: mockCli('ok') })
  need(!nof.ok && /Which project folder/.test(nof.text), 'no folder asks which one')
  const nl = await runCli({ ...base, command: mockCli('notlogged') })
  need(!nl.ok && /not signed in/.test(nl.text), 'not signed in is explained')
  const fl = await runCli({ ...base, command: mockCli('fail') })
  need(!fl.ok && /exit code 3|boom/.test(fl.text), 'a crash reports the exit code or its message')
  const idle = await runCli({ ...base, command: mockCli('silent'), idleMs: 400 })
  need(!idle.ok && /went quiet/.test(idle.text), 'a silent tool is stopped by the idle timeout')
  const tot = await runCli({ ...base, command: mockCli('hang'), timeoutMs: 500 })
  need(!tot.ok && /took more than/.test(tot.text), 'a run that never ends is stopped by the total timeout')
  const c2 = new AbortController()
  setTimeout(() => c2.abort(), 300)
  const st = await runCli({ ...base, signal: c2.signal, command: mockCli('hang') })
  need(!st.ok && /Stopped/.test(st.text), 'stop ends the run')
  return `cli ok (${n} checks)`
}
