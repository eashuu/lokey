// Takeover and watch mode (plan 3.7, step 6). Lokey never types passwords, one-time codes or card numbers.
//  - TAKEOVER: a login, verification code or captcha screen (or a password field): the run stops with "your turn", the person does it
//    and says continue.
//  - WATCH: banking and payment windows: nothing is done there unless the person confirms each step.
// Detection is by the window the action would land in (program and title), plus the sidecar's password-field flag when it is known.
// Heuristic words, not a classifier: a miss falls back to the ordinary cards, a false alarm costs one confirm.
export type TakeoverMode = 'takeover' | 'watch' | null
export interface Where { exe?: string; title?: string; password?: boolean }

const TAKEOVER = /\b(sign[- ]?in|log[- ]?in|log ?on|password|passcode|one[- ]time|otp|verification code|2fa|two[- ]factor|captcha|not a robot|security code|authenticat)/i
const WATCH = /\b(bank|banking|netbanking|paypal|razorpay|paytm|phonepe|gpay|google pay|bhim|upi|payment|pay now|checkout|credit card|debit card|card number|wallet|stripe|billing|invoice|order summary)\b/i

export function takeoverCheck(w: Where | null | undefined): { mode: TakeoverMode; why: string } {
  if (!w) return { mode: null, why: '' }
  if (w.password) return { mode: 'takeover', why: 'a password field is in focus' }
  const text = `${w.exe ?? ''} ${w.title ?? ''}`
  if (TAKEOVER.test(text)) return { mode: 'takeover', why: 'this looks like a login or verification screen' }
  if (WATCH.test(text)) return { mode: 'watch', why: 'this looks like a banking or payment window' }
  return { mode: null, why: '' }
}

export const TAKEOVER_SAY = (why: string) => `Your turn: ${why}. I never type passwords, codes or card details. Do it yourself, then tell me to continue.`
