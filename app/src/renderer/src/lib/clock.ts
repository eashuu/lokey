import { useEffect, useState } from 'react'

/** Re-renders once a minute, aligned to the minute boundary. No other timers. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => { setNow(new Date()); t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50) }
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
    return () => clearTimeout(t)
  }, [])
  return now
}
