// Weather for the Today tab: ipwho.is (location, cached 12 h) + Open-Meteo (cached 30 min). Every failure -> null, never throws.
import { useEffect, useState } from 'react'
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun, type LucideIcon } from 'lucide-react'

export interface Weather { temp: number; code: number; isDay: boolean; city: string }
interface Geo { lat: number; lon: number; city: string }

const GEO_KEY = 'lokey.geo.v1', WX_KEY = 'lokey.weather.v1'
const GEO_TTL = 12 * 3600_000, WX_TTL = 30 * 60_000

function read<T>(key: string): { at: number; v: T } | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}
function write(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), v })) } catch { /* ignore */ } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(url: string): Promise<any> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 6000)
  try {
    const r = await fetch(url, { signal: ac.signal })
    return r.ok ? await r.json() : null
  } catch { return null } finally { clearTimeout(t) }
}

export function cachedWeather(): Weather | null {
  const c = read<Weather>(WX_KEY)
  return c && Date.now() - c.at < WX_TTL ? c.v : null
}

async function fetchWeather(): Promise<Weather | null> {
  let geo = read<Geo>(GEO_KEY)
  if (!geo || Date.now() - geo.at > GEO_TTL) {
    const j = await getJson('https://ipwho.is/')
    if (j && typeof j.latitude === 'number' && typeof j.longitude === 'number') {
      write(GEO_KEY, { lat: j.latitude, lon: j.longitude, city: String(j.city ?? '') })
      geo = read<Geo>(GEO_KEY)
    }
  }
  const stale = read<Weather>(WX_KEY)?.v ?? null
  if (!geo) return stale
  const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${geo.v.lat}&longitude=${geo.v.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`)
  const c = j?.current
  if (!c || typeof c.temperature_2m !== 'number') return stale
  const w: Weather = { temp: c.temperature_2m, code: c.weather_code, isDay: c.is_day === 1, city: geo.v.city }
  write(WX_KEY, w)
  return w
}

/** Fetches on mount only when the cache is stale. `null` = unknown (show an em dash). */
export function useWeather(): Weather | null {
  const [w, setW] = useState<Weather | null>(cachedWeather)
  useEffect(() => {
    if (cachedWeather()) return
    let live = true
    void fetchWeather().then(r => { if (live && r) setW(r) })
    return () => { live = false }
  }, [])
  return w
}

export function describeWeather(code: number, isDay: boolean): { Icon: LucideIcon; text: string } {
  if (code === 0) return { Icon: isDay ? Sun : Moon, text: 'Clear' }
  if (code <= 2) return { Icon: isDay ? CloudSun : CloudMoon, text: code === 1 ? 'Mostly clear' : 'Partly cloudy' }
  if (code === 3) return { Icon: Cloud, text: 'Overcast' }
  if (code === 45 || code === 48) return { Icon: CloudFog, text: 'Fog' }
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, text: 'Drizzle' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { Icon: CloudRain, text: 'Rain' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { Icon: CloudSnow, text: 'Snow' }
  if (code >= 95) return { Icon: CloudLightning, text: 'Thunderstorm' }
  return { Icon: Cloud, text: 'Cloudy' }
}
