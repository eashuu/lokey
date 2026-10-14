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
  | { type: 'mascot'; play?: string; emote?: string; /** wake a sleeping notch for a moment so it is seen */ flash?: boolean }
  /** the caption bar should go away now */
  | { type: 'clear' }
  /** hands-free conversation mode started or ended */
  | { type: 'convo'; on: boolean }

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
  /** steps of one "do A, then B an hour later" request share a flow id; `seq` is their order */
  flowId?: string
  seq?: number
  /** the user approved this task (and any confirm card it needed) when it was created, so it may run unattended */
  approved?: boolean
  /** a routine: after it runs (or is missed) the next occurrence is scheduled */
  repeat?: 'daily' | 'weekdays' | 'weekly'
}

export interface VoiceInfo {
  hasKey: boolean
  state: VoiceState
  tasks: ScheduledTask[]
}

/** Dictation overlay window input: where the focused field is and what to show. */
export interface DictationEvent {
  type: 'start' | 'raw' | 'clean' | 'done' | 'cancel' | 'level' | 'error' | 'working' | 'partial'
  /** field rectangle in DIPs relative to the overlay (= the display); the bar sits at its bottom edge */
  rect?: { x: number; y: number; w: number; h: number }
  text?: string
  v?: number
}

/** Lasso overlay window input. */
export interface LassoEvent {
  type: 'start' | 'point' | 'end' | 'cancel' | 'arm'
  /** `arm`: the line shown to the user while the screen is dimmed and waiting for a stroke */
  hint?: string
  /** pointer samples (overlay DIPs) since the last message */
  pts?: { x: number; y: number }[]
}

/** One line of the assistant's action log (what it did, was refused, or was denied). */
export interface ActionRecord {
  at: string
  tool: string
  summary: string
  outcome: 'done' | 'failed' | 'denied' | 'refused'
}

/** What the confirm card shows; the user answers Allow or Deny. */
export interface ConfirmRequest { id: string; title: string; detail: string; tool: string; timeoutMs: number
  /** a base64 JPEG of what the action is about to touch (second-screen steps show the frame) */
  image?: string }

/** A background job: a task the assistant took on, a helper agent, a delegated coding agent, or a computer-control run. */
export interface AgentTask {
  id: string
  kind: 'task' | 'agent' | 'operator' | 'cli'
  role: string
  title: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  backend: 'api' | 'claude' | 'codex'
  startedAt: number
  endedAt?: number
  steps: number
  /** what it is doing now / what it finished with */
  line: string
  result?: string
}
