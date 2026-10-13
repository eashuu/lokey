import { AnimatePresence, motion } from 'motion/react'
import { useIsland } from './store'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Speech caption under the island. "said" = what you spoke (white bubble, "YOU" label), cleaned up word by word
 * (blur-in, 32 ms stagger); "reply" = what the assistant says (black bubble). Driven by the store; dormant until
 * voice is wired in, but the bench exercises it.
 */
export function Caption({ top, scale }: { top: number; scale: number }) {
  const caption = useIsland(s => s.caption)
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', justifyContent: 'center', pointerEvents: 'none', fontFamily: 'var(--font-island)' }}>
      <AnimatePresence mode="wait">
        {caption && (
          <motion.div
            key={`${caption.kind}-${caption.text}`}
            initial={{ opacity: 0, y: -10, scale: 0.94, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { duration: 0.45, ease: EASE } }}
            exit={{ opacity: 0, y: -6, filter: 'blur(6px)', transition: { duration: 0.3, ease: [0.4, 0, 0.6, 1] } }}
            style={{
              maxWidth: 560 * scale, padding: `${9 * scale}px ${18 * scale}px`, borderRadius: 20 * scale, textAlign: 'center', fontSize: 14 * scale, lineHeight: 1.4,
              ...(caption.kind === 'said'
                ? { background: 'rgba(255,255,255,.94)', color: '#14161b', boxShadow: '0 14px 30px -6px rgba(15,23,42,.26), 0 1px 2px rgba(15,23,42,.16), inset 0 1.2px 0 rgba(255,255,255,.95)' }
                : { background: 'rgba(0,0,0,.9)', color: '#fff', boxShadow: '0 10px 28px -8px rgba(0,0,0,.45)' }),
            }}
          >
            {caption.kind === 'said' && <span style={{ marginRight: 8, fontSize: '.72em', letterSpacing: '.12em', textTransform: 'uppercase', opacity: 0.55 }}>You</span>}
            {caption.text.split(' ').map((w, i) => (
              <motion.span key={i} initial={{ opacity: 0, y: 7, filter: 'blur(7px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: 0.05 + 0.032 * i, duration: 0.5, ease: EASE }} style={{ display: 'inline-block', whiteSpace: 'pre' }}>
                {w}{' '}
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
