interface Window {
  /** Preload helper for the hidden audio page (#agent). */
  lokeyAgent?: {
    onCmd(cb: (c: { cmd: 'mic'; on: boolean; hard?: boolean } | { cmd: 'play'; data: Uint8Array } | { cmd: 'flush' }) => void): void
    mic(b: ArrayBuffer): void
    level(kind: 'mic' | 'out', v: number): void
    ready(): void
    fail(m: string): void
  }
  /** Preload helper for the transient overlay pages (#caption, #dictation, #lasso). */
  lokeyOverlay?: {
    on(channel: 'caption' | 'dictation' | 'lasso', cb: (d: any) => void): void
    ready(channel: string): void
  }
  /** Preload helper for the confirm card (#confirm). */
  lokeyConfirm?: {
    onRequest(cb: (r: { id: string; title: string; detail: string; tool: string; timeoutMs: number }) => void): void
    ready(): void
    answer(id: string, ok: boolean): void
  }
  /** Preload helper for the lasso page: report a finished stroke or a cancel. */
  lokeyLasso?: { stroke(pts: { x: number; y: number }[]): void; cancel(): void }
}
