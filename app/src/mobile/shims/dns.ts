// A page cannot resolve names itself; the URL safety check treats a failed lookup as "unknown host" and the fetch still goes through the native stack.
export const lookup = async (_host: string, _o?: unknown): Promise<any> => { throw Object.assign(new Error('dns lookup is not available'), { code: 'ENOTFOUND' }) }
export default { lookup }
