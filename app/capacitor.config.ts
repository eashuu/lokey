import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.lokey.link',
  appName: 'Lokey',
  webDir: 'mobile/www',
  android: { path: 'mobile/android', allowMixedContent: true }, // the page is https://localhost and talks to a paired PC on http://192.168.x.x (the live event stream cannot go through the native HTTP layer)
  server: { androidScheme: 'https' },
  plugins: { CapacitorHttp: { enabled: true } }, // fetch() goes through the native stack: no CORS limits for providers and a paired PC on the LAN
}
export default config
