import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue } from 'motion/react'
import { Bell, Loader2, Monitor, Zap, BatteryLow } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { useFocus } from '@/lib/focus'
import { animSpeed } from '@/lib/motion'
import { haptic } from '@/lib/platform'
import { voiceLevel } from '@/island/voice'
import { mascot } from '@/mascot/bus'
import { FullRing } from '@/tabs/stats/Ring'
import { useActivities, useIsl, type Kind } from './activities'
import { CARD_W, CardFor, Chips, clock } from './cards'
import { useChat } from './chat'
import { Spirit } from './spirit'

// The Origin Island: a pure-black capsule at the top centre, over the front camera. Compact (36 px) it shows one live activity as
// its face (the spirit on the left, the state on the right, the camera hole stays free in the middle); expanded it is a card with
// 28 px corners. Width, height and radius are spring-driven; nothing else animates while it is idle.
const H = 36
const FACE_W: Record<Kind, number> = { idle: 128, voice: 176, timer: 140, job: 196, music: 176, approval: 164, reminder: 196, charging: 140, pc: 128 }
const COLOR: Record<Kind, string> = { approval: '#f5a524', voice: 'var(--accent)', timer: '#F5A524', job: 'var(--accent)', music: '#fff', reminder: '#f28bb6', charging: '#8fd16a', pc: '#62b6ff', idle: 'rgba(255,255,255,.5)' }
const txt = { fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontVariantNumeric: 'tabular-nums' } as const

/** voice bars (listening / speaking, from the microphone and speaker levels) or three dots (thinking); one rAF loop while mounted */
function Wave() {
  const state = useChat(s => s.state)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const SHAPE = [0.4, 0.7, 1, 0.7, 0.4]
  useEffect(() => {
    let raf = 0, smooth = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const live = state === 'speaking' ? (now - mascot.levelAt < 300 ? mascot.level : 0.18 + 0.3 * Math.abs(Math.sin((now - t0) / 200))) : state === 'listening' ? (now - voiceLevel.at < 300 ? voiceLevel.v : 0.12 + 0.2 * Math.abs(Math.sin((now - t0) / 260))) : 0.12 + 0.55 * Math.max(0, Math.sin((now - t0) / 300))
      smooth += (live - smooth) * 0.3
      bars.current.forEach((el, i) => { if (el) el.style.transform = `scaleY(${state === 'thinking' ? 0.3 + 0.7 * Math.max(0, Math.sin((now - t0) / 260 - i * 0.7)) : 0.18 + SHAPE[i] * smooth})` })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state])
  return (
    <span aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 3, height: 20 }}>
      {SHAPE.map((_, i) => <span key={i} ref={el => { bars.current[i] = el }} style={{ width: state === 'thinking' ? 5 : 3, height: state === 'thinking' ? 5 : 18, borderRadius: 3, background: state === 'speaking' ? 'var(--accent)' : '#fff', transformOrigin: 'center' }} />)}
    </span>
  )
}

function Eq({ playing }: { playing: boolean }) {
  return <span aria-hidden className="ih-eq" data-on={playing}>{[0, 1, 2, 3].map(i => <i key={i} style={{ animationDelay: `${i * 0.17}s` }} />)}</span>
}

function Compact({ kind }: { kind: Kind }) {
  const media = useData(s => s.media)
  const f = useFocus()
  const jobs = useIsl(s => s.jobs).filter(j => j.status === 'running')
  const due = useIsl(s => s.due)
  const pc = useIsl(s => s.pc)
  const fl = useIsl(s => s.flash)
  const asks = useChat(s => s.confirms.length) + useIsl(s => s.pcAsks.length)
  const state = useChat(s => s.state)
  let right: React.ReactNode = pc.paired ? <Monitor size={14} color={pc.connected ? '#62b6ff' : 'rgba(255,255,255,.4)'} /> : null
  let left: React.ReactNode = <Spirit size={28} face />
  if (kind === 'music') { left = <span style={{ width: 28, height: 28, borderRadius: 9, overflow: 'hidden', background: 'rgba(255,255,255,.12)', display: 'block', flex: 'none' }}>{media?.art && <img src={media.art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</span>; right = <Eq playing={!!media?.playing} /> }
  else if (kind === 'voice') right = <Wave />
  else if (kind === 'timer') right = <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FullRing value={f.status === 'done' ? 100 : f.totalMs ? (f.remainingMs / f.totalMs) * 100 : 0} size={20} stroke={3} track="rgba(255,255,255,.18)" color={f.status === 'done' ? '#8fd16a' : '#F5A524'}>{null}</FullRing><span style={txt}>{f.status === 'done' ? 'Done' : clock(f.remainingMs)}</span></span>
  else if (kind === 'job') right = <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><Loader2 size={14} className="ph-spin" color="var(--accent)" style={{ flex: 'none' }} /><span style={{ ...txt, maxWidth: 108, color: 'rgba(255,255,255,.8)' }}>{jobs[0]?.line || jobs[0]?.title}</span></span>
  else if (kind === 'approval') right = <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i className="ih-pulse" style={{ width: 8, height: 8, borderRadius: 4, background: '#f5a524' }} /><span style={txt}>Approve{asks > 1 ? ` (${asks})` : '?'}</span></span>
  else if (kind === 'reminder') right = <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><Bell size={14} color="#f28bb6" style={{ flex: 'none' }} /><span style={{ ...txt, maxWidth: 108 }}>{due[0]?.title}</span></span>
  else if (kind === 'charging') right = <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{fl?.icon === 'low' ? <BatteryLow size={15} color="#ff7373" /> : <Zap size={15} color="#8fd16a" fill="#8fd16a" />}<span style={txt}>{fl?.text}</span></span>
  else if (kind === 'pc') right = <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Monitor size={14} color={pc.connected ? '#62b6ff' : 'rgba(255,255,255,.5)'} /><span style={txt}>PC</span></span>
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 9px', height: H, gap: 34 }}>
      {left}
      <span style={{ display: 'flex', alignItems: 'center', minWidth: 0, justifyContent: 'flex-end' }} aria-live="polite" aria-label={`${kind} ${state}`}>{right}</span>
    </div>
  )
}

export function OriginIsland() {
  const { list, face } = useActivities()
  const expanded = useIsl(s => s.expanded)
  const setExpanded = useIsl(s => s.setExpanded)
  const setPick = useIsl(s => s.setPick)
  const haptics = useData(s => s.settings.phone?.haptics) !== false
  const glow = useChat(s => s.state === 'listening' || s.state === 'speaking')
  const [mount, setMount] = useState(false)
  const [eh, setEh] = useState(140)
  const inner = useRef<HTMLDivElement>(null)
  const cardKind: Kind = face === 'charging' ? 'idle' : face
  const canExpand = face !== 'charging'

  const w = useMotionValue(FACE_W[face]), h = useMotionValue(H), r = useMotionValue(H / 2)
  const spring = () => (animSpeed() <= 0 ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.9 })
  useEffect(() => {
    const ex = expanded && canExpand
    const tw = ex ? CARD_W() : FACE_W[face], th = ex ? eh : H, tr = ex ? 28 : H / 2
    const cs = [animate(w, tw, spring()), animate(h, th, spring()), animate(r, tr, spring())]
    return () => cs.forEach(c => c.stop())
  }, [expanded, canExpand, face, eh]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (expanded && canExpand) { setMount(true); return }
    const t = setTimeout(() => setMount(false), 260)
    return () => clearTimeout(t)
  }, [expanded, canExpand])
  useLayoutEffect(() => {
    const el = inner.current
    if (!el || !mount) return
    const ro = new ResizeObserver(() => setEh(Math.min(Math.round(el.getBoundingClientRect().height), innerHeight - 40)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [mount, cardKind])
  useEffect(() => { if (!canExpand) setExpanded(false) }, [canExpand, setExpanded])

  const tick = useCallback((k: 'tick' | 'heavy' = 'tick') => { if (haptics) haptic(k) }, [haptics])
  const close = useCallback(() => setExpanded(false), [setExpanded])
  const cycle = (d: number) => { if (list.length < 2) return; tick(); setPick(list[(list.indexOf(face) + d + list.length) % list.length]) }

  // ---- gestures: tap expand, swipe down expand, swipe up collapse, swipe left/right cycle, long-press talk, double tap conversation ----
  const g = useRef({ id: -1, x: 0, y: 0, long: undefined as ReturnType<typeof setTimeout> | undefined, holding: false, handled: false, tapAt: 0 })
  const interactive = (e: React.PointerEvent) => !!(e.target as HTMLElement).closest('button,input,textarea,[data-nogest]')
  const down = (e: React.PointerEvent) => {
    if (interactive(e)) return
    const d = g.current
    Object.assign(d, { id: e.pointerId, x: e.clientX, y: e.clientY, holding: false, handled: false })
    clearTimeout(d.long)
    if (!expanded) d.long = setTimeout(() => { d.holding = true; tick('heavy'); bridge.voice.hold(true) }, 380)
  }
  const move = (e: React.PointerEvent) => {
    const d = g.current
    if (e.pointerId !== d.id || d.handled || d.holding) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.hypot(dx, dy) < 12) return
    clearTimeout(d.long); d.handled = true
    if (Math.abs(dy) > Math.abs(dx)) { if (dy > 0 && !expanded && canExpand) { tick(); setExpanded(true) } else if (dy < 0 && expanded) { tick(); setExpanded(false) } }
    else if (!expanded) cycle(dx < 0 ? 1 : -1)
  }
  const up = (e: React.PointerEvent) => {
    const d = g.current
    if (e.pointerId !== d.id) return
    d.id = -1; clearTimeout(d.long)
    if (d.holding) { d.holding = false; bridge.voice.hold(false); return }
    if (d.handled) return
    const now = performance.now()
    if (now - d.tapAt < 300) { d.tapAt = 0; tick('heavy'); setExpanded(false); bridge.voice.toggleConversation(); useChat.setState(s => ({ convo: !s.convo })); return }
    d.tapAt = now
    if (!expanded && canExpand) { tick(); setExpanded(true) }
  }
  useEffect(() => () => clearTimeout(g.current.long), [])

  const dots = list.length > 1 && !expanded
  return (
    <>
      {expanded && canExpand && <motion.div aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} onPointerDown={close} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.4)' }} />}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 'var(--ih-top, 8px)', display: 'flex', justifyContent: 'center', zIndex: 50, pointerEvents: 'none' }}>
        <motion.div role="button" aria-label={expanded ? 'Island open' : `Island: ${face}`} aria-expanded={expanded && canExpand} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={e => e.preventDefault()}
          style={{ width: w, height: h, borderRadius: r, background: '#000', color: '#fff', position: 'relative', overflow: 'hidden', pointerEvents: 'auto', touchAction: 'none', fontFamily: 'var(--font-island)', userSelect: 'none', WebkitTouchCallout: 'none',
            boxShadow: glow ? '0 0 22px color-mix(in srgb, var(--accent) 38%, transparent)' : '0 0 0 transparent', transition: 'box-shadow .3s linear' }}>
          <motion.div animate={{ opacity: expanded && canExpand ? 0 : 1 }} transition={{ duration: animSpeed() <= 0 ? 0 : 0.14 }} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><Compact kind={face} /></motion.div>
          {mount && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: expanded ? 1 : 0 }} transition={{ duration: animSpeed() <= 0 ? 0 : 0.2, delay: expanded ? 0.06 : 0 }} style={{ position: 'absolute', left: 0, top: 0, width: '100%' }}>
              <div ref={inner} style={{ position: 'relative' }}>
                <Chips list={list} face={face} onPick={k => setPick(k)} onClose={close} />
                <CardFor kind={cardKind} close={close} />
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
      {dots && (
        <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: `calc(var(--ih-top, 8px) + ${H + 6}px)`, display: 'flex', justifyContent: 'center', gap: 5, zIndex: 50, pointerEvents: 'none' }}>
          {list.map(k => <i key={k} style={{ width: k === face ? 14 : 5, height: 5, borderRadius: 3, background: k === face ? '#fff' : COLOR[k], opacity: k === face ? 0.9 : 0.75, transition: 'width .2s' }} />)}
        </div>
      )}
    </>
  )
}
