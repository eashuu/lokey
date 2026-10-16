// Structured outputs (plan 3.6): every model call that must return JSON (plans, extractions, classification) has a small schema.
// The gateway parses the answer, checks it here, and on failure repairs once (the error goes back to the model) and then tries the
// next model. The checker covers what those schemas need: types, required keys, enums, array items, string length. It is deliberately
// not JSON Schema.
export type Schema =
  | { type: 'string'; enum?: string[]; max?: number }
  | { type: 'number' } | { type: 'boolean' }
  | { type: 'array'; items: Schema; max?: number }
  | { type: 'object'; props: Record<string, Schema>; required?: string[] }

export function validate(v: unknown, s: Schema, path = '$'): string | null {
  switch (s.type) {
    case 'string': if (typeof v !== 'string') return `${path} must be a string`; if (s.enum && !s.enum.includes(v)) return `${path} must be one of ${s.enum.join(', ')}`; return s.max && v.length > s.max ? `${path} is longer than ${s.max}` : null
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? null : `${path} must be a number`
    case 'boolean': return typeof v === 'boolean' ? null : `${path} must be true or false`
    case 'array': {
      if (!Array.isArray(v)) return `${path} must be a list`
      if (s.max && v.length > s.max) return `${path} has more than ${s.max} items`
      for (let i = 0; i < v.length; i++) { const e = validate(v[i], s.items, `${path}[${i}]`); if (e) return e }
      return null
    }
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return `${path} must be an object`
      const o = v as Record<string, unknown>
      for (const k of s.required ?? []) if (o[k] === undefined) return `${path}.${k} is missing`
      for (const [k, sub] of Object.entries(s.props)) if (o[k] !== undefined) { const e = validate(o[k], sub, `${path}.${k}`); if (e) return e }
      return null
    }
  }
}

/** a model's JSON answer, tolerant of code fences and chatter around it */
export function parseJsonAnswer(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(t) } catch { /* look for the first object or array */ }
  const a = t.search(/[{[]/)
  if (a < 0) throw new Error('no JSON in the answer')
  const close = t[a] === '{' ? '}' : ']'
  const b = t.lastIndexOf(close)
  if (b <= a) throw new Error('unterminated JSON')
  return JSON.parse(t.slice(a, b + 1))
}
