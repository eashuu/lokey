const no = () => { throw new Error('a local HTTP server is not available on Android') }
export const createServer = no
export const request = no
export const get = no
export type IncomingMessage = any
export type ServerResponse = any
export type Server = any
export default { createServer, request, get }
