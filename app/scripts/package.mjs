// Builds a ready-to-run Windows folder: release/Lokey/Lokey.exe (+ the .NET sidecar in resources/host).
// Usage: node scripts/package.mjs        (from the app/ folder, or via `pnpm package`)
// No installer, no signing, no downloads: it reuses the Electron runtime already in node_modules.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(app, '..')
let out = join(app, 'release', 'Lokey')
// paths contain spaces (C:\Users\Jane Doe\...), so quote every argument for the Windows shell
const q = a => (/[\s&()^%!]/.test(a) ? '"' + a + '"' : a)
const run = (cmd, args, cwd) => execFileSync(q(cmd), args.map(q), { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
const step = msg => console.log(`\n== ${msg}`)

step('build the app (electron-vite)')
run('npx', ['electron-vite', 'build'], app)

step('publish the sidecar (self-contained, single file)')
const hostOut = join(app, 'release', '_host')
rmSync(hostOut, { recursive: true, force: true })
run('dotnet', ['publish', join(repo, 'native', 'Lokey.Host'), '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', '-o', hostOut], repo)

step('assemble release/Lokey')
// a running copy keeps its files locked: never kill it, build next to it instead
try {
  // renaming a folder fails while one of its executables is running, and (unlike deleting) leaves the files intact
  if (existsSync(out)) {
    const gone = out + '.old'
    rmSync(gone, { recursive: true, force: true })
    renameSync(out, gone)
    rmSync(gone, { recursive: true, force: true })
  }
} catch {
  out = join(app, 'release', 'Lokey-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12))
  console.log(`release/Lokey is in use (a copy is running): building ${out} instead`)
}
mkdirSync(out, { recursive: true })
const electronDist = join(app, 'node_modules', 'electron', 'dist')
if (!existsSync(join(electronDist, 'electron.exe'))) throw new Error('Electron runtime missing: run `node node_modules/electron/install.js` in app/')
cpSync(electronDist, out, { recursive: true })
rmSync(join(out, 'resources', 'default_app.asar'), { force: true })
rmSync(join(out, 'electron.exe.sig'), { force: true })

const appDir = join(out, 'resources', 'app')
mkdirSync(appDir, { recursive: true })
const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'lokey', version: pkg.version, main: pkg.main, license: pkg.license }, null, 2))
cpSync(join(app, 'out'), join(appDir, 'out'), { recursive: true })
cpSync(join(app, 'resources'), join(appDir, 'resources'), { recursive: true })
mkdirSync(join(out, 'resources', 'host'), { recursive: true })
cpSync(join(hostOut, 'Lokey.Host.exe'), join(out, 'resources', 'host', 'Lokey.Host.exe'))

step('rename and brand the executable')
const exe = join(out, 'Lokey.exe')
cpSync(join(out, 'electron.exe'), exe)
rmSync(join(out, 'electron.exe'), { force: true })

// PNG-in-ICO (valid on Windows Vista+): header + one 256x256 entry pointing at the PNG bytes
const png = readFileSync(join(app, 'resources', 'icon.png'))
const ico = Buffer.alloc(22 + png.length)
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4)
ico.writeUInt8(0, 6); ico.writeUInt8(0, 7); ico.writeUInt8(0, 8); ico.writeUInt8(0, 9)
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18)
png.copy(ico, 22)
const icoPath = join(app, 'release', 'lokey.ico')
writeFileSync(icoPath, ico)
try {
  const { rcedit } = await import('rcedit')
  await rcedit(exe, { icon: icoPath, 'version-string': { ProductName: 'lokey', FileDescription: 'lokey', InternalName: 'Lokey', OriginalFilename: 'Lokey.exe' }, 'product-version': pkg.version, 'file-version': pkg.version })
} catch (e) {
  console.warn('icon/version branding skipped:', e.message)
}

rmSync(hostOut, { recursive: true, force: true })
step(`done: ${exe}`)
