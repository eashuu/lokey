interface Window {
  /** Preload helper for the transient whole-screen effect windows (#reveal / #glow). */
  lokeyFx?: {
    ready(): void
    done(): void
    onStart(cb: (d: { src: string; x: number; y: number; w: number; h: number; ms: number }) => void): void
    onGlow(cb: (state: import('@shared/bridge').GlowState) => void): void
  }
}
