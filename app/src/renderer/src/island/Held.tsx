import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import { useData } from '@/lib/data'
import { mascot } from '@/mascot/bus'
import { Soul } from './Soul'
import { voiceLevel } from './voice'
import type { HeldPhase } from './store'

const SHAPE = [0.35, 0.62, 0.85, 1, 0.85, 0.62, 0.35]

/**
 * Contents of the "held" notch: the small spirit at the left and, depending on the phase, voice bars (listening),
 * three pulsing dots (thinking) or a check mark (done). Bars follow `level` (0..1) or, without one, the loopback
 * bands; at rest they sit as dots. One rAF loop, only while mounted.
 */
export function Held({ width, height, phase, level }: { width: number; height: number; phase: HeldPhase; level?: () => number }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const dots = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => { if (phase === 'done') mascot.play('celebrate') }, [phase])

  useEffect(() => {
    let raf = 0
    let smooth = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (phase === 'listening') {
        const b = useData.getState().bands
        const target = level ? level() : performance.now() - voiceLevel.at < 300 ? voiceLevel.v : b.length ? b.reduce((s, v) => s + v, 0) / b.length : 0.15 + 0.35 * Math.abs(Math.sin((now - t0) / 260))
        smooth += (target - smooth) * 0.25
        bars.current.forEach((el, i) => {
          if (!el) return
          el.style.height = `${4.8 + SHAPE[i] * smooth * height * 0.5}px`
          el.style.borderRadius = smooth < 0.04 ? '50%' : '1.5px'
          el.style.width = smooth < 0.04 ? '4.8px' : '3px'
        })
      } else if (phase === 'thinking') {
        dots.current.forEach((el, i) => {
          if (el) el.style.opacity = String(0.35 + 0.65 * Math.max(0, Math.sin(((now - t0) / 1000) * 5 - i * 0.9)))
        })
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [height, level, phase])

  return (
    <div style={{ position: 'absolute', inset: 0, width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      <Soul width={height * 0.95} height={height * 0.95} mode={phase === 'thinking' ? 'THINKING' : phase === 'listening' ? 'HEARING' : 'LISTENING'} active />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: width * 0.34, height: '100%', gap: 3 }}>
        {phase === 'listening' && SHAPE.map((_, i) => (
          <span key={i} ref={el => { bars.current[i] = el }} style={{ display: 'block', width: 4.8, height: 4.8, margin: '0 1px', borderRadius: '50%', background: '#fff' }} />
        ))}
        {phase === 'thinking' && [0, 1, 2].map(i => (
          <span key={i} ref={el => { dots.current[i] = el }} style={{ display: 'block', width: 5, height: 5, margin: '0 2px', borderRadius: '50%', background: '#fff' }} />
        ))}
        {phase === 'done' && <Check size={height * 0.5} color="#fff" strokeWidth={2.6} />}
      </div>
    </div>
  )
}
