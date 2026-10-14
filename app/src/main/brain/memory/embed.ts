import { settings } from '../../settings'
import { getKey } from '../../agent/keystore'

// Meaning-based search needs a vector for each memory. Google's embedding endpoint is free with the same key as everything else;
// if it is unavailable (no key, quota, a wrong model name) memory simply falls back to word matching: nothing breaks.
const DIMS = 256
let offUntil = 0

export async function embed(texts: string[], kind: 'doc' | 'query' = 'doc'): Promise<number[][] | null> {
  const key = getKey()
  if (!key || !texts.length || !settings.value.brain.embed || Date.now() < offUntil) return null
  const model = settings.value.brain.embedModel || 'gemini-embedding-001'
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ requests: texts.map(t => ({ model: `models/${model}`, content: { parts: [{ text: t.slice(0, 2000) }] }, taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', outputDimensionality: DIMS })) }),
    })
    if (!r.ok) { offUntil = Date.now() + (r.status === 429 ? 5 : 30) * 60_000; return null }
    const j = (await r.json()) as { embeddings?: { values?: number[] }[] }
    const out = (j.embeddings ?? []).map(e => e.values ?? [])
    if (out.length !== texts.length || out.some(v => v.length < 8)) return null
    return out.map(normalise)
  } catch { offUntil = Date.now() + 10 * 60_000; return null }
}

function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  return v.map(x => +(x / n).toFixed(5))
}
