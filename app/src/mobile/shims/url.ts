const _URL = URL, _USP = URLSearchParams
export { _URL as URL, _USP as URLSearchParams }
export const fileURLToPath = (u: string | URL) => decodeURIComponent(new URL(String(u)).pathname)
export const pathToFileURL = (p: string) => new URL('file://' + p)
export default { URL, URLSearchParams, fileURLToPath, pathToFileURL }
