// Messages between the main-process agent and the windows that show it (island, caption bar, dictation/lasso overlays).

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'
/** which feature owns the current turn */
export type VoiceKind = 'assistant' | 'dictation' | 'lasso'

export type VoiceEvent =
  | { type: 'state'; state: VoiceState; kind: VoiceKind }
  /** what the user said so far (live transcript); `final` once the turn's speech is complete */
  | { type: 'said'; text: string; final: boolean }
  /** what the assistant says; `label` = who is talking (the app name) */
  | { type: 'reply'; text: string; final: boolean }
  /** 0..1: microphone level while listening, speaker level while speaking */
  | { type: 'level'; v: number }
  /** a short status line (errors, hints) shown in the caption bar */
  | { type: 'notice'; text: string; tone: 'info' | 'error' }
  /** drive the mascot: a pose by name and/or a floating emote */
  | { type: 'mascot'; play?: string; emote?: string }
  /** the caption bar should go away now */
  | { type: 'clear' }

export interface ScheduledTask {
  id: string
  /** what the user asked for, shown in the Desk list */
  title: string
  /** ISO time when it runs */
  runAt: string
  /** the actions to run then (same tool vocabulary the live agent has) */
  steps: { tool: string; args: Record<string, unknown> }[]
  /** wording for the "Opening Netflix." caption at run time */
  say: string
  status: 'pending' | 'done' | 'missed' | 'cancelled'
  createdAt: string
}

export interface VoiceInfo {
  hasKey: boolean
  state: VoiceState
  tasks: ScheduledTask[]
}

/** Dictation overlay window input: where the focused field is and what to show. */
export interface DictationEvent {
  type: 'start' | 'raw' | 'clean' | 'done' | 'cancel' | 'level' | 'error'
  /** field rectangle in DIPs relative to the overlay (= the display); the bar sits at its bottom edge */
  rect?: { x: number; y: number; w: number; h: number }
  text?: string
  v?: number
}

/** Lasso overlay window input. */
export interface LassoEvent {
  type: 'start' | 'point' | 'end' | 'cancel'
  /** pointer samples (overlay DIPs) since the last message */
  pts?: { x: number; y: number }[]
}
