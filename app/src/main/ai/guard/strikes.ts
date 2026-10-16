// Strikes and the graduated response (plan 3.7, step 10). Blocked or denied actions add up:
//   level 1 (any recent block)             : actions wait a moment first, so the stop key is easy to reach
//   level 2 (3 in a row, or 20 in a session): every action asks, whatever the autonomy level (Claude Code's auto mode does the same)
//   level 3 (6 in a row)                    : the run halts until the person speaks again
// An incident (a protected-list hit, a hostile-content detection followed by a state change, a taint-flow block) also revokes full
// control at once. Approving something resets the streak; a new spoken or typed request lifts level 3.
export const STRIKE_ROW = 3, STRIKE_TOTAL = 20, STRIKE_HALT = 6

export class Strikes {
  row = 0
  total = 0
  halted = false
  incidents = 0
  onIncident: (why: string) => void = () => undefined
  /** a policy refusal or a denied card */
  hit() { this.row++; this.total++; if (this.row >= STRIKE_HALT) this.halted = true }
  /** an action went through (approved or allowed) */
  ok() { this.row = 0 }
  incident(why: string) { this.incidents++; this.onIncident(why) }
  get level(): 0 | 1 | 2 | 3 {
    if (this.halted) return 3
    if (this.row >= STRIKE_ROW || this.total >= STRIKE_TOTAL) return 2
    return this.row > 0 ? 1 : 0
  }
  /** the person spoke again: a halt is lifted, the streak starts over (the session total stays) */
  newTurn() { this.halted = false; this.row = 0 }
  /** a new session */
  reset() { this.row = 0; this.total = 0; this.halted = false }
}
