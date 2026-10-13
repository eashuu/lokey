import type { Flyout } from '@/island/shapes'
import { Audio } from './Audio'
import { Bluetooth } from './Bluetooth'
import { Wifi } from './Wifi'

/** Wi-Fi / Bluetooth / Sound flyouts, laid out in the design box (w x h) with a shared back header. */
export function FlyoutView({ view, w, h }: { view: Flyout; w: number; h: number }) {
  return view === 'wifi' ? <Wifi w={w} h={h} /> : view === 'bluetooth' ? <Bluetooth w={w} h={h} /> : <Audio w={w} h={h} />
}
