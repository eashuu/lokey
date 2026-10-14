// The safety rules of the second screen, as pure functions (no plugin, no model): what is never operated, what is never typed, and which steps
// need the user's card first. Fixed in code, not in settings: autonomy "full control" does not reach them. The package pattern is the same one
// as ShizukuAllow.denyPackage in the Kotlin plugin (app/mobile/android/.../ShizukuAllow.kt); both have a test, keep them in step.

export const DENY_PACKAGES = new RegExp(
  'bank|banking|wallet|payment|(^|[._])pay([._]|$)|paytm|phonepe|gpay|paisa|upi|bhim|razorpay|paypal|venmo|cashapp|revolut|stripe|zelle|spay|' +
  'coinbase|binance|wazirx|metamask|crypto|zerodha|groww|upstox|' +
  'password|passkey|bitwarden|lastpass|1password|onepassword|dashlane|keepass|keeper|nordpass|enpass|roboform|proton\\.android\\.pass|' +
  'authenticator|authy|twofas|aegis|andotp|duomobile|okta|totp|otp|2fa|' +
  'vivo\\.wallet|bbk\\.account|digilocker|credit|debit|insurance|loan|cred\\.club|' +
  'sbi|hdfc|icici|kotak|yono|idfc|pnb|canara|indusind|hsbc|amex|mastercard|chase|wellsfargo|barclays|monzo|n26|nubank', 'i')

export const denyPackage = (pkg: string) => DENY_PACKAGES.test(pkg)

export const DENY_WHY = 'Lokey never operates banking, payment, wallet, password-manager or authenticator apps, and never enters passwords, one-time codes or card details.'

/** a request that is about money, passwords or codes is refused before anything starts */
const GOAL_BLOCK = /\b(bank(ing)?|net ?banking|upi|paytm|phonepe|gpay|google pay|wallet|credit card|debit card|card number|cvv|password manager|passwords?|passcode|otp|one[- ]time (code|password)|2fa|two[- ]factor|authenticator|pay\b.{0,30}\b(bills?|rent|fees?|emi|invoice|loan|premium)|transfer (money|funds)|send money|crypto|bitcoin)\b/i
export function goalRefusal(goal: string): string | null {
  const m = GOAL_BLOCK.exec(goal)
  return m ? `I will not do that on the second screen (it mentions "${m[0]}"). ${DENY_WHY}` : null
}

/** text on the screen that asks the user for a secret: the run stops there */
const SECRET_PROMPT = /\b(enter|type|input|key in|provide)\b[^.\n]{0,40}\b(otp|pin|password|passcode|cvv|card number|security code|verification code|mpin)\b|\bone[- ]time (password|code)\b|\bupi pin\b|\bnet ?banking\b|\bcard (number|details)\b|\bcvv\b/i
export const screenAsksForSecret = (text: string) => SECRET_PROMPT.test(text)

export interface UiNode { id?: number; cls?: string; text?: string; desc?: string; res?: string; b: [number, number, number, number]; click?: boolean; long?: boolean; edit?: boolean; scroll?: boolean; checked?: boolean; focus?: boolean; password?: boolean; disabled?: boolean }

/** words that make a tap a purchase / send / post / delete step: the user is asked, with the picture */
const SENSITIVE = /\b(buy|buy now|purchase|pay|pay now|checkout|check out|place order|order now|confirm (order|payment|purchase|booking)|book|book now|subscribe|donate|send|post|publish|tweet|share|reply|comment|delete|remove|uninstall|erase|clear data|factory reset|transfer|install|upgrade|sign out|log out|logout|unfollow|block|report|submit)\b/i
const SEND_ENTER = /^(send|post|reply|publish|tweet|comment)$/i

const area = (n: UiNode) => Math.max(1, (n.b[2] - n.b[0]) * (n.b[3] - n.b[1]))
const label = (n: UiNode) => [n.text, n.desc, n.res?.replace(/[_-]+/g, ' ')].filter(Boolean).join(' ')

/** what is under a point on the screen: the labels of the smallest nodes that contain it */
export function underPoint(nodes: UiNode[], x: number, y: number): { label: string; edit: boolean; password: boolean } {
  const hit = nodes.filter(n => x >= n.b[0] && x <= n.b[2] && y >= n.b[1] && y <= n.b[3]).sort((a, b) => area(a) - area(b)).slice(0, 3)
  return { label: hit.map(label).filter(Boolean).join(' / ').slice(0, 120), edit: hit.some(n => n.edit), password: hit.some(n => n.password) }
}

/** null = fine, a string = the reason this step needs a card. `declared` is what the model itself said (it may flag a step; it can never unflag one). */
export function sensitiveReason(action: { action?: unknown; keys?: unknown; text?: unknown }, nodes: UiNode[], point: { x: number; y: number } | null, declared?: string): string | null {
  if (declared && declared.trim()) return declared.trim().slice(0, 80)
  const a = String(action.action ?? '')
  if ((a === 'click' || a === 'tap' || a === 'long_press' || a === 'double_click') && point) {
    const u = underPoint(nodes, point.x, point.y)
    const m = SENSITIVE.exec(u.label)
    if (m) return `taps "${u.label}" (${m[0].toLowerCase()})`
  }
  if (a === 'key' && /^(enter|return)$/i.test(String(action.keys ?? ''))) {
    const focused = nodes.find(n => n.edit && n.focus)
    const send = nodes.find(n => n.click && SEND_ENTER.test((n.text ?? n.desc ?? '').trim()))
    if (focused && send) return `presses Enter, which would "${(send.text ?? send.desc ?? '').trim()}"`
  }
  return null
}

/** true = this text may be typed. Never: into a password field, anything that looks like a code / card / secret, or when the screen is asking for a secret. */
export function typingRefusal(text: string, nodes: UiNode[], screenText: string, looksSecret: (s: string) => boolean): string | null {
  if (nodes.some(n => n.password && (n.focus || n.edit))) return 'a password field is on the screen: I do not type here. Ask the user to do this step themselves.'
  if (looksSecret(text) || /^\s*\d{4,8}\s*$/.test(text) || /\b(?:\d[ -]?){13,19}\b/.test(text)) return 'that looks like a code, card number or secret: I do not type those.'
  if (screenAsksForSecret(screenText)) return 'the screen is asking for a PIN, password, code or card detail: I do not enter those. Ask the user.'
  return null
}

/** the UI tree as short lines for the model: [id] "label" kind @x,y (the centre on the 0-1000 grid) */
export function summarise(nodes: UiNode[], w: number, h: number, max = 70): string {
  const lines: string[] = []
  for (const n of nodes) {
    if (lines.length >= max) { lines.push('…'); break }
    const t = (n.text ?? n.desc ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!t && !n.edit && !n.click) continue
    const cx = Math.round(((n.b[0] + n.b[2]) / 2 / w) * 1000), cy = Math.round(((n.b[1] + n.b[3]) / 2 / h) * 1000)
    const kind = n.password ? 'password field' : n.edit ? 'text field' : n.click ? 'button' : n.scroll ? 'list' : 'text'
    lines.push(`[${n.id ?? lines.length}] ${t ? `"${t}"` : '(no label)'} ${kind}${n.checked ? ' (checked)' : ''}${n.disabled ? ' (disabled)' : ''}${n.focus ? ' (focused)' : ''} @${cx},${cy}`)
  }
  return lines.join('\n')
}

export function safetySelfCheck(looksSecret: (s: string) => boolean): string {
  const need = (c: unknown, m: string) => { if (!c) throw new Error('secondScreenSafety: ' + m) }
  for (const p of ['com.sbi.lotusintouch', 'net.one97.paytm', 'com.phonepe.app', 'com.google.android.apps.nbu.paisa.user', 'com.google.android.apps.walletnfcrel', 'com.x8bit.bitwarden', 'com.google.android.apps.authenticator2', 'com.microsoft.authenticator', 'com.agilebits.onepassword', 'com.vivo.wallet', 'com.paypal.android.p2pmobile', 'org.keepassdroid', 'com.hdfcbank.android']) need(denyPackage(p), 'deny ' + p)
  for (const p of ['com.android.settings', 'com.google.android.youtube', 'com.whatsapp', 'com.android.chrome', 'com.google.android.apps.maps', 'org.telegram.messenger', 'com.spotify.music', 'com.google.android.calendar']) need(!denyPackage(p), 'allow ' + p)
  need(goalRefusal('open my bank app and check the balance') && goalRefusal('save this password') && goalRefusal('read the OTP from messages') && !goalRefusal('open YouTube and play lofi'), 'goal guard')
  need(screenAsksForSecret('Enter your 6-digit OTP') && screenAsksForSecret('Enter UPI PIN') && !screenAsksForSecret('Enter a title for the note'), 'secret prompt')
  const nodes: UiNode[] = [{ id: 0, text: 'Buy now', click: true, b: [100, 900, 500, 1000] }, { id: 1, text: 'Cancel', click: true, b: [520, 900, 900, 1000] }, { id: 2, edit: true, focus: true, desc: 'Message', b: [0, 800, 800, 880] }, { id: 3, text: 'Send', click: true, b: [820, 800, 900, 880] }]
  need(sensitiveReason({ action: 'click' }, nodes, { x: 300, y: 950 })?.includes('buy'), 'buy needs a card')
  need(sensitiveReason({ action: 'click' }, nodes, { x: 700, y: 950 }) === null, 'cancel is fine')
  need(sensitiveReason({ action: 'key', keys: 'enter' }, nodes, null)?.includes('Send'), 'enter that sends needs a card')
  need(sensitiveReason({ action: 'click' }, nodes, { x: 700, y: 950 }, 'sends a message') === 'sends a message', 'the model may flag a step')
  need(typingRefusal('hello', [{ b: [0, 0, 1, 1], password: true, edit: true }], '', looksSecret) !== null && typingRefusal('483920', [], '', looksSecret) !== null && typingRefusal('hello there', [], 'Search', looksSecret) === null && typingRefusal('hello', [], 'Enter your password', looksSecret) !== null, 'typing guard')
  need(summarise([{ id: 5, text: 'Wi-Fi', click: true, b: [0, 0, 500, 100] }], 1000, 2000).includes('[5] "Wi-Fi" button @250,25'), 'summary line')
  return 'ok'
}
