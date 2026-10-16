import type { FunctionDecl } from './session'

// What the realtime voice model is offered (round-9 plan 3.5). Every declaration is paid for on every turn and a long list makes
// the model slower and less accurate, so the voice gets a short list of the things people ask for by voice, and everything else
// goes through `do_task`, which hands the request to a background worker that has the whole catalog (and the MCP tools).
// The list is fixed, so the session's cache and resumption handle stay valid between turns.
export const LIVE_CORE = [
  'get_context', 'read_selection', 'type_text', 'switch_window', 'open_app', 'open_url', 'web_search', 'media',
  'set_volume', 'schedule', 'list_tasks', 'remember', 'recall', 'briefing', 'undo', 'do_task',
] as const

export function liveTools(all: FunctionDecl[], includeContext = true): FunctionDecl[] {
  const by = new Map(all.map(t => [t.name, t]))
  return LIVE_CORE.filter(n => includeContext || (n !== 'get_context' && n !== 'read_selection')).map(n => by.get(n)).filter((t): t is FunctionDecl => !!t)
}

// NOTE (0.8.3): the real rule, measured with --livetest on gemini-3.8-live: an ACTIVITY WITH NO AUDIO IN IT is closed with 1007 "Precondition check failed".
// (The 0.8.2 theory, that text inside an audio activity is refused, was refuted by the same run: that is accepted.) So a typed turn is sent as
// realtimeInput.text on its own, never wrapped in activityStart/activityEnd, and an empty push-to-talk turn is never ended (see Agent.finishTurn).
/** a small per-turn note: the time (which goes stale in a system prompt) and the program in front. Sent with each turn, not baked in at connect. */
export function preamble(now: Date, app = ''): string {
  const t = now.toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `(Context for this turn, not from the user: it is ${t}${app ? `; the program in front is ${app}` : ''}.)`
}
