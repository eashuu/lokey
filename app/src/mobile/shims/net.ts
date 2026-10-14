// Sockets do not exist in a WebView. isIP is pure string logic and is used by the URL safety check.
export const isIPv4 = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every(p => Number(p) <= 255)
export const isIPv6 = (s: string) => /^[0-9a-fA-F:.]+$/.test(s) && s.includes(':') && s.split(':').length <= 9
export const isIP = (s: string) => (isIPv4(s) ? 4 : isIPv6(s) ? 6 : 0)
const no = () => { throw new Error('sockets are not available on Android') }
export const connect = no
export const createServer = no
export type AddressInfo = { address: string; family: string; port: number }
export default { isIP, isIPv4, isIPv6, connect, createServer }
