// Current weather for the morning briefing: ipwho.is (rough location from the IP, cached 12 h) + Open-Meteo (30 min).
// Any failure gives null; nothing is stored on disk.
interface Geo { lat: number; lon: number; city: string; at: number }
let geo: Geo | null = null
let last: { at: number; text: string } | null = null

const WMO: Record<number, string> = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 48: 'foggy', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'heavy showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
}

async function json(url: string): Promise<Record<string, any> | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return r.ok ? ((await r.json()) as Record<string, any>) : null
  } catch { return null }
}

/** e.g. "27°C, partly cloudy in Chennai, highs of 31°C, 40% chance of rain" or null */
export async function weatherLine(): Promise<string | null> {
  if (last && Date.now() - last.at < 30 * 60_000) return last.text
  if (!geo || Date.now() - geo.at > 12 * 3_600_000) {
    const j = await json('https://ipwho.is/')
    if (j && typeof j.latitude === 'number' && typeof j.longitude === 'number') geo = { lat: j.latitude, lon: j.longitude, city: String(j.city ?? ''), at: Date.now() }
  }
  if (!geo) return last?.text ?? null
  const j = await json(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,precipitation_probability_max&forecast_days=1&timezone=auto`)
  const c = j?.current
  if (!c || typeof c.temperature_2m !== 'number') return last?.text ?? null
  const hi = j?.daily?.temperature_2m_max?.[0], rain = j?.daily?.precipitation_probability_max?.[0]
  const text = `${Math.round(c.temperature_2m)}°C, ${WMO[c.weather_code as number] ?? 'mixed weather'}${geo.city ? ` in ${geo.city}` : ''}` +
    (typeof hi === 'number' ? `, high of ${Math.round(hi)}°C` : '') + (typeof rain === 'number' && rain >= 20 ? `, ${rain}% chance of rain` : '')
  last = { at: Date.now(), text }
  return text
}
