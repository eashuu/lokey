import { useEffect, useRef } from 'react'

export type MascotState = 'idle' | 'listening' | 'speaking' | 'thinking'

/**
 * Original spirit mascot: a small flame-drop with eyes. Deliberately has NO looping animation while idle,
 * because any running animation keeps the compositor producing frames. It blinks via a timer-triggered
 * one-shot, and floats only while `active` (panel open / voice states).
 */
export function Mascot({ size = 22, state = 'idle', active = false }: { size?: number; state?: MascotState; active?: boolean }) {
  const eyes = useRef<SVGGElement>(null)

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const blink = () => {
      const el = eyes.current
      if (el) { el.classList.remove('mascot-blink'); void el.getBoundingClientRect(); el.classList.add('mascot-blink') }
      t = setTimeout(blink, 3500 + Math.random() * 3500)
    }
    if (active) t = setTimeout(blink, 1200)
    return () => clearTimeout(t)
  }, [active])

  const glow = state === 'listening' ? '#7fe3ff' : state === 'speaking' ? '#ffd27a' : state === 'thinking' ? '#c4a6ff' : '#6fb2ff'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={active ? 'mascot-float' : undefined} style={{ overflow: 'visible', display: 'block' }} aria-hidden>
      <defs>
        <radialGradient id="lk-body" cx="50%" cy="62%" r="62%">
          <stop offset="0%" stopColor="#e9f8ff" />
          <stop offset="55%" stopColor="#8fd0ff" />
          <stop offset="100%" stopColor="#2f78e8" />
        </radialGradient>
      </defs>
      <ellipse cx="16" cy="17" rx="13" ry="14" fill={glow} opacity="0.16" />
      <path d="M16 2.2c.2 4.6 1.5 6.5 4.7 9.8 3.3 3.3 5.3 5.7 5.3 9.2A10 10 0 0 1 16 31 10 10 0 0 1 6 21.2c0-3.5 2-6 5.2-9.2C14.4 8.700 15.800 6.800 16 2.200Z" fill="url(#lk-body)" />
      <g ref={eyes} style={{ transformOrigin: '16px 21px' }}>
        <ellipse cx="12.300" cy="21" rx="1.500" ry="2" fill="#0d2a55" />
        <ellipse cx="19.700" cy="21" rx="1.500" ry="2" fill="#0d2a55" />
      </g>
      <ellipse cx="16" cy="25.500" rx="1.600" ry="0.800" fill="#0d2a55" opacity="0.55" />
    </svg>
  )
}
