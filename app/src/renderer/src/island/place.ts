import { create } from 'zustand'
import { bridge } from '@/bridge'
import type { Edge } from '@shared/placement'

// Where the island sits (which screen edge, how far along it) as told by the main process, which owns the overlay window's
// position. `editing`: the user is moving it ('drag' = a press on the notch is still held, 'pick' = click where it should go).
export interface PlaceState { edge: Edge; along: number; editing: false | 'hold' | 'pick' }

export const usePlace = create<{ place: PlaceState; cursor: { x: number; y: number } | null }>(() => ({ place: { edge: 'top', along: Math.round(innerWidth / 2), editing: false }, cursor: null }))

let started = false
export function initPlace() {
  if (started) return () => undefined
  started = true
  void bridge.place.get().then(p => usePlace.setState({ place: p }))
  const off = bridge.place.onChange(p => usePlace.setState({ place: p, cursor: null }))
  const offC = bridge.place.onCursor(c => usePlace.setState({ cursor: c }))
  return () => { started = false; off(); offC() }
}
