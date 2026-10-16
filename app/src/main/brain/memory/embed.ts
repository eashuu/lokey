import { settings } from '../../settings'
import { ai } from '../../ai/gateway'

// Meaning-based search needs a vector for each memory. The `embed` role of the gateway serves it (Gemini's free embedding model by
// default); if no model can answer (no key, quota, offline) the gateway says so with null and memory falls back to word matching.
const DIMS = 256

export async function embed(texts: string[], kind: 'doc' | 'query' = 'doc'): Promise<number[][] | null> {
  if (!texts.length || !settings.value.brain.embed) return null
  const out = await ai.embed(texts, kind, { dims: DIMS })
  return out ? out.map(normalise) : null
}

function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return v.map(x => +(x / n).toFixed(5))
}
