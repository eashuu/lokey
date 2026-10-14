export const homedir = () => '/data/home'
export const tmpdir = () => '/tmp'
export const platform = () => 'android'
export const type = () => 'Linux'
export const arch = () => 'arm64'
export const hostname = () => 'phone'
export const cpus = () => [] as unknown[]
export const totalmem = () => 0
export const freemem = () => 0
export const release = () => ''
export const uptime = () => performance.now() / 1000
export const userInfo = () => ({ username: 'lokey', homedir: homedir() })
export const networkInterfaces = (): Record<string, { family: string; address: string; internal: boolean }[]> => ({})
export const EOL = '\n'
export default { homedir, tmpdir, platform, type, arch, hostname, cpus, totalmem, freemem, release, uptime, userInfo, networkInterfaces, EOL }
