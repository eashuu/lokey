// main/link/server.ts for the phone: a phone is only ever a Link CLIENT (see ../linkClient.ts); it never serves. These keep the imports
// of the shared core (nudgeHost -> linkPush) satisfied.
export const lanUrl = (): string | null => null
export const linkState = () => ({ enabled: false, running: false, port: 0, url: null as string | null, devices: [] as unknown[], pairing: false })
export const linkNewCode = () => ({ code: '', expiresAt: 0 })
export const linkRevoke = (_id: string) => false
export const linkSetEnabled = (_on: boolean) => linkState()
export const linkPush = (_type: string, _data: unknown) => undefined
export const startLink = (_d: unknown) => undefined
export const stopLink = () => undefined
export const linkTestStart = async (_d: unknown): Promise<number> => { throw new Error('the Link server does not run on Android') }
export const linkTestStop = async () => true
