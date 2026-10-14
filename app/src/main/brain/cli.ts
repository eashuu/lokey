import { execFile, spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { clip } from './types'

// Hand a programming job to a coding agent that is already installed and signed in on this PC: Claude Code (`claude -p`) or
// Codex (`codex exec`). Lokey runs the user's own, unmodified command-line tool; it never reads or forwards anyone's login. The
// task goes in on stdin (no shell quoting to get wrong), progress comes back as JSON lines, and stopping kills the whole process tree.
const TIMEOUT_MS = 20 * 60_000

export type CliTool = 'claude' | 'codex'

/** where the tool is installed, or null */
export function findCli(tool: CliTool): Promise<string | null> {
  return new Promise(resolve => execFile('where.exe', [tool], { windowsHide: true, timeout: 4000 }, (err, out) => {
    if (err) return resolve(null)
    const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    resolve(lines.find(l => /\.(exe|cmd)$/i.test(l)) ?? lines[0] ?? null)
  }))
}

/** claude -p (stream-json) and codex exec (--json) event -> a short progress line, or the final answer */
export function parseCliLine(tool: CliTool, line: string): { progress?: string; final?: string } {
  let j: any
  try { j = JSON.parse(line) } catch { return {} }
  if (tool === 'claude') {
    if (j.type === 'result') return { final: typeof j.result === 'string' ? j.result : undefined }
    if (j.type === 'assistant') {
      for (const c of j.message?.content ?? []) {
        if (c.type === 'tool_use') return { progress: `${c.name}${c.input?.file_path ? ' ' + String(c.input.file_path).split(/[\\/]/).pop() : c.input?.command ? ': ' + clip(String(c.input.command), 50) : ''}` }
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
  return {}
}

export function cliArgs(tool: CliTool, allowEdits: boolean): string[] {
  if (tool === 'claude') {
    return ['-p', '--output-format', 'stream-json', '--verbose', '--allowedTools', allowEdits ? 'Read,Glob,Grep,Edit,Write,Bash' : 'Read,Glob,Grep', '--permission-mode', allowEdits ? 'acceptEdits' : 'default']
  }
  return ['exec', '--json', '--skip-git-repo-check', '--sandbox', allowEdits ? 'workspace-write' : 'read-only', '-']
}

export interface CliRun { tool: CliTool; task: string; folder: string; allowEdits: boolean; signal: AbortSignal; onLine: (line: string) => void }

export async function runCli(o: CliRun): Promise<{ ok: boolean; text: string }> {
  const exe = await findCli(o.tool)
  if (!exe) return { ok: false, text: o.tool === 'claude' ? 'Claude Code is not installed on this PC (npm install -g @anthropic-ai/claude-code, then sign in once in a terminal).' : 'Codex is not installed on this PC (npm install -g @openai/codex, then sign in once in a terminal).' }
  if (!o.folder || !existsSync(o.folder) || !statSync(o.folder).isDirectory()) return { ok: false, text: 'The project folder does not exist.' }
  return new Promise(resolve => {
    const shell = /\.(cmd|bat)$/i.test(exe) // npm installs are .cmd shims
    const p = spawn(shell ? `"${exe}"` : exe, cliArgs(o.tool, o.allowEdits), { cwd: o.folder, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let final = '', tail = '', buf = '', done = false
    const finish = (ok: boolean, text: string) => { if (done) return; done = true; clearTimeout(timer); o.signal.removeEventListener('abort', stop); resolve({ ok, text }) }
    const kill = () => { if (p.pid) execFile('taskkill', ['/pid', String(p.pid), '/T', '/F'], () => undefined) }
    const stop = () => { kill(); finish(false, final || 'Stopped.') }
    const timer = setTimeout(() => { kill(); finish(false, final || 'It took too long, so I stopped it.') }, TIMEOUT_MS)
    o.signal.addEventListener('abort', stop)
    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        const r = parseCliLine(o.tool, line)
        if (r.final) final = r.final
        if (r.progress) o.onLine(r.progress)
      }
    })
    p.stderr.on('data', (d: Buffer) => { tail = (tail + d.toString('utf8')).slice(-600) })
    p.on('error', e => finish(false, `Could not start it: ${e.message}`))
    p.on('close', code => finish(code === 0 && !!final, final || (code === 0 ? 'It finished without a report.' : `It stopped with an error${tail ? ': ' + clip(tail.replace(/\s+/g, ' '), 200) : ''}`)))
    p.stdin.on('error', () => undefined)
    p.stdin.end(o.task)
  })
}

export function cliSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('cli: ' + m) }
  need(parseCliLine('claude', '{"type":"result","result":"All done."}').final === 'All done.', 'claude result')
  need(/Edit a\.ts/.test(parseCliLine('claude', '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"C:\\\\x\\\\a.ts"}}]}}').progress ?? ''), 'claude tool use')
  need(parseCliLine('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"Fixed it."}}').final === 'Fixed it.', 'codex message')
  need(parseCliLine('codex', 'not json').final === undefined, 'garbage ignored')
  need(cliArgs('claude', false).includes('Read,Glob,Grep') && !cliArgs('claude', false).join(' ').includes('Bash') && cliArgs('codex', false).includes('read-only') && cliArgs('codex', true).includes('workspace-write'), 'read-only unless edits are allowed')
  return 'cli ok'
}
