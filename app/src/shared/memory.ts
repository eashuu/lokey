// Types shared between the memory engine (main process) and the Bond page that shows it.
export type FactKind = 'preference' | 'fact' | 'person' | 'project' | 'routine' | 'place' | 'other'

export interface FactView {
  id: string
  text: string
  kind: FactKind
  entities: string[]
  source: string
  importance: number
  pinned: boolean
  updated: number
  created: number
  /** how far to believe it, where it came from, and when it became true */
  trust?: 'confirmed' | 'inferred' | 'untrusted'
  origin?: string
  validFrom?: number
}
/** a fact learned from untrusted content that waits for the person's approval (never used until then) */
export interface QuarantineView extends FactView { taint: string }
export interface ProposalView { id: string; text: string; why: string; at: number }

export interface GraphNode { id: string; name: string; type: string; weight: number }
export interface GraphEdge { src: string; dst: string; rel: string }
export interface GraphView { nodes: GraphNode[]; edges: GraphEdge[] }

export interface MemoryStats { quarantined?: number; encrypted?: boolean; db?: boolean; plans?: number; facts: number; entities: number; relations: number; episodes: number; lessons: number; paused: boolean; embedded: number; lastLearned: number | null; queued: number }
export interface LessonView { id: string; trigger: string; advice: string; hits: number }
export interface JournalView { day: string; text: string }
