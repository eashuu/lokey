export const promisify = <T extends (...a: any[]) => any>(f: T) => (...a: unknown[]) => new Promise((res, rej) => f(...a, (e: unknown, v: unknown) => (e ? rej(e) : res(v))))
export const inspect = (v: unknown) => { try { return typeof v === 'string' ? v : JSON.stringify(v) } catch { return String(v) } }
export const format = (...a: unknown[]) => a.map(x => (typeof x === 'string' ? x : inspect(x))).join(' ')
export const types = { isPromise: (x: unknown) => x instanceof Promise }
export default { promisify, inspect, format, types }
