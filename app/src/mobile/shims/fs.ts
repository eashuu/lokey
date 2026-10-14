// node:fs (sync API) on the in-memory virtual disk from ../vfs (persisted to IndexedDB in the background).
import { Buffer } from './buffer'
import { resolve, dirname } from './path'
import { vfs, vfsDelete, vfsSet, type Data } from '../vfs'

const td = new TextDecoder(), te = new TextEncoder()
const err = (code: string, op: string, p: string) => Object.assign(new Error(`${code}: ${op} '${p}'`), { code, errno: code === 'ENOENT' ? -2 : -1, syscall: op, path: p })
const P = (p: unknown) => resolve(String(p instanceof URL ? p.pathname : p))
type Enc = BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null | undefined
const encOf = (o: Enc) => (typeof o === 'string' ? o : o?.encoding ?? null)
const toBytes = (d: Data) => (typeof d === 'string' ? te.encode(d) : d)
const toText = (d: Data) => (typeof d === 'string' ? d : td.decode(d))

export const existsSync = (p: string) => { const a = P(p); return vfs.files.has(a) || vfs.dirs.has(a) }

export function mkdirSync(p: string, _o?: unknown) { const a = P(p); for (let d = a; d !== '/' && !vfs.dirs.has(d); d = dirname(d)) vfs.dirs.add(d); return a }

export function readFileSync(p: string, o?: Enc): any {
  const a = P(p), d = vfs.files.get(a)
  if (d === undefined) throw err(vfs.dirs.has(a) ? 'EISDIR' : 'ENOENT', 'open', p)
  const e = encOf(o)
  return e ? (e === 'utf8' || e === 'utf-8' ? toText(d) : Buffer.from(toBytes(d)).toString(e)) : Buffer.from(toBytes(d).slice())
}

export function writeFileSync(p: string, data: string | Uint8Array, _o?: unknown) {
  const a = P(p)
  if (vfs.dirs.has(a)) throw err('EISDIR', 'open', p)
  if (!vfs.dirs.has(dirname(a))) mkdirSync(dirname(a)) // ponytail: more forgiving than node (it would throw ENOENT); a missing folder is created
  vfsSet(a, typeof data === 'string' ? data : new Uint8Array(data))
}

export function appendFileSync(p: string, data: string | Uint8Array, _o?: unknown) {
  const a = P(p), cur = vfs.files.get(a)
  if (cur === undefined) return writeFileSync(p, data)
  if (typeof cur === 'string' && typeof data === 'string') return vfsSet(a, cur + data)
  const x = toBytes(cur), y = toBytes(data), out = new Uint8Array(x.length + y.length)
  out.set(x); out.set(y, x.length)
  vfsSet(a, out)
}

export function unlinkSync(p: string) { const a = P(p); if (!vfs.files.has(a)) throw err('ENOENT', 'unlink', p); vfsDelete(a) }

export function rmSync(p: string, o?: { recursive?: boolean; force?: boolean }) {
  const a = P(p)
  if (vfs.files.has(a)) return vfsDelete(a)
  if (vfs.dirs.has(a)) {
    if (!o?.recursive) throw err('ERR_FS_EISDIR', 'rm', p)
    for (const f of [...vfs.files.keys()]) if (f.startsWith(a + '/')) vfsDelete(f)
    for (const d of [...vfs.dirs]) if (d === a || d.startsWith(a + '/')) vfs.dirs.delete(d)
    return
  }
  if (!o?.force) throw err('ENOENT', 'rm', p)
}
export const rmdirSync = (p: string, o?: { recursive?: boolean }) => rmSync(p, { recursive: o?.recursive, force: false })

export function renameSync(from: string, to: string) {
  const a = P(from), b = P(to)
  if (vfs.files.has(a)) { const d = vfs.files.get(a)!; mkdirSync(dirname(b)); vfsSet(b, d); vfsDelete(a); return }
  if (vfs.dirs.has(a)) {
    for (const f of [...vfs.files.keys()]) if (f.startsWith(a + '/')) { vfsSet(b + f.slice(a.length), vfs.files.get(f)!); vfsDelete(f) }
    for (const d of [...vfs.dirs]) if (d === a || d.startsWith(a + '/')) { vfs.dirs.delete(d); vfs.dirs.add(b + d.slice(a.length)) }
    return
  }
  throw err('ENOENT', 'rename', from)
}

export function copyFileSync(from: string, to: string) { const d = vfs.files.get(P(from)); if (d === undefined) throw err('ENOENT', 'copyfile', from); vfsSet(P(to), d) }
export function cpSync(from: string, to: string, o?: { recursive?: boolean }) {
  const a = P(from), b = P(to)
  if (vfs.files.has(a)) { mkdirSync(dirname(b)); return copyFileSync(a, b) }
  if (!vfs.dirs.has(a)) throw err('ENOENT', 'cp', from)
  if (!o?.recursive) throw err('ERR_FS_EISDIR', 'cp', from)
  mkdirSync(b)
  for (const f of [...vfs.files.keys()]) if (f.startsWith(a + '/')) { mkdirSync(dirname(b + f.slice(a.length))); vfsSet(b + f.slice(a.length), vfs.files.get(f)!) }
  for (const d of [...vfs.dirs]) if (d.startsWith(a + '/')) vfs.dirs.add(b + d.slice(a.length))
}

class Stats {
  constructor(private dir: boolean, public size: number, public mtimeMs: number) {}
  isFile() { return !this.dir }
  isDirectory() { return this.dir }
  isSymbolicLink() { return false }
  get mtime() { return new Date(this.mtimeMs) }
  get ctimeMs() { return this.mtimeMs }
  get birthtimeMs() { return this.mtimeMs }
}
export function statSync(p: string, o?: { throwIfNoEntry?: boolean }) {
  const a = P(p), d = vfs.files.get(a)
  if (d !== undefined) return new Stats(false, toBytes(d).length, vfs.meta.get(a) ?? 0)
  if (vfs.dirs.has(a)) return new Stats(true, 0, 0)
  if (o?.throwIfNoEntry === false) return undefined as never
  throw err('ENOENT', 'stat', p)
}
export const lstatSync = statSync

class Dirent {
  constructor(public name: string, private dir: boolean) {}
  isFile() { return !this.dir }
  isDirectory() { return this.dir }
  isSymbolicLink() { return false }
}
export function readdirSync(p: string, o?: { withFileTypes?: boolean }): any {
  const a = P(p)
  if (!vfs.dirs.has(a)) throw err(vfs.files.has(a) ? 'ENOTDIR' : 'ENOENT', 'scandir', p)
  const pre = a === '/' ? '/' : a + '/', seen = new Map<string, boolean>()
  for (const f of vfs.files.keys()) if (f.startsWith(pre)) { const r = f.slice(pre.length), i = r.indexOf('/'); if (i < 0) seen.set(r, false); else seen.set(r.slice(0, i), true) }
  for (const d of vfs.dirs) if (d.startsWith(pre)) { const r = d.slice(pre.length), i = r.indexOf('/'); seen.set(i < 0 ? r : r.slice(0, i), true) }
  const names = [...seen.keys()].sort()
  return o?.withFileTypes ? names.map(n => new Dirent(n, seen.get(n)!)) : names
}

export function mkdtempSync(prefix: string) {
  const d = prefix + Math.random().toString(36).slice(2, 8)
  mkdirSync(d)
  return d
}
export const accessSync = (p: string) => { if (!existsSync(p)) throw err('ENOENT', 'access', p) }
export const realpathSync = (p: string) => P(p)
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2 }

const asyncify = <A extends unknown[], R>(f: (...a: A) => R) => async (...a: A) => f(...a)
export const promises = {
  readFile: asyncify(readFileSync), writeFile: asyncify(writeFileSync), appendFile: asyncify(appendFileSync), mkdir: asyncify(mkdirSync), readdir: asyncify(readdirSync),
  stat: asyncify(statSync), rm: asyncify(rmSync), rename: asyncify(renameSync), unlink: asyncify(unlinkSync), copyFile: asyncify(copyFileSync), access: asyncify(accessSync),
}
export default { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, rmSync, rmdirSync, renameSync, copyFileSync, cpSync, statSync, lstatSync, readdirSync, mkdtempSync, accessSync, realpathSync, constants, promises }
