import { trustSelfCheck } from './trust'
import { undoSelfCheck } from './undo'
import { nudgeSelfCheck } from './nudge'
import { activitySelfCheck } from './activity'
export const trustUndoNudgeSelfCheck = () => `trust ${trustSelfCheck()}, undo ${undoSelfCheck()}, nudge ${nudgeSelfCheck()}, activity ${activitySelfCheck()}`
