// Shapes shared by the coach: what travels to and from /api/agent, what
// the engine keeps once it has checked a proposal, and what the thread
// stores. The wire blocks mirror the Messages API so a tool loop can send
// an assistant turn back exactly as it arrived.

import type { Checkin } from '../checkins'
import type { CustomExercise } from '../exercises'
import type { MesoDay, Mesocycle } from '../mesocycle'
import type { Template } from '../templates'
import type { WeightUnit } from '../units'
import type { Workout } from '../workouts'

// ---- wire ----

export interface TextBlock {
  type: 'text'
  text: string
}
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}
/** Opaque to us: returned unmodified while a tool loop is running. */
export interface ThinkingBlock {
  type: 'thinking' | 'redacted_thinking'
  [key: string]: unknown
}

export type AssistantBlock = TextBlock | ToolUseBlock | ThinkingBlock
export type UserBlock = TextBlock | ToolResultBlock

export type WireMessage =
  | { role: 'user'; content: string | UserBlock[] }
  | { role: 'assistant'; content: string | AssistantBlock[] }

/** Who answered: the model, or the coach built into the app. */
export type CoachSource = 'live' | 'builtin'

export interface AgentReply {
  content: AssistantBlock[]
  stopReason: string | null
  source: CoachSource
}

// ---- what the coach can see ----

/** The wearable's morning numbers, already reduced to what matters. */
export interface StrapSummary {
  recovery: number
  hrvMs?: number
  /** Difference from the 30-day mean, same unit. */
  hrvVs30d?: number
  rhr?: number
  rhrVs30d?: number
  sleepHours?: number
  sleepPerformancePct?: number
}

export type NoteCategory =
  | 'goal'
  | 'schedule'
  | 'equipment'
  | 'injury'
  | 'preference'

export interface CoachNote {
  id: string
  category: NoteCategory
  text: string
  createdAt: string
}

/** Everything the snapshot and the tools read. Workouts newest first. */
export interface AgentContext {
  now: number
  workouts: Workout[]
  mesos: Mesocycle[]
  templates: Template[]
  customs: CustomExercise[]
  lookup: (name: string) => string | undefined
  checkins: Checkin[]
  bodyWeightLb?: number
  unit: WeightUnit
  strap: StrapSummary | null
  notes: CoachNote[]
  dayPlan: DayPlan | null
}

/** The only things a tool call may change without a tap from the athlete. */
export interface AgentEffects {
  saveCheckin: (patch: Partial<Checkin>) => void
  setDayPlan: (plan: DayPlan) => void
  addNote: (note: CoachNote) => void
}

// ---- day plan ----

/** Changes to a planned strength session, already checked by the engine. */
export interface Trim {
  /** Keep only the first N exercises. */
  keepFirst?: number
  /** Sets taken off each exercise (never below one). */
  dropSets?: number
  /** Repeat last session's numbers instead of progressing. */
  holdLoad?: boolean
  /** `to: null` removes the exercise. */
  swaps?: Array<{ from: string; to: string | null }>
}

export interface PlannedExercise {
  name: string
  sets: number
  /** "185 lb × 8" when the engine has a prescription. */
  target?: string
}

interface ItemBase {
  /** Stable within a plan; the list key and the done-state handle. */
  key: string
  title: string
  minutes?: number
  note?: string
}

export type DayPlanItem =
  | (ItemBase & {
      kind: 'block'
      mesoId: string
      dayIndex: number
      session: 'strength' | 'cardio'
      exercises: PlannedExercise[]
      trim?: Trim
    })
  | (ItemBase & {
      kind: 'template'
      templateId: string
      session: 'strength' | 'timer'
      exercises: PlannedExercise[]
      trim?: Trim
    })
  | (ItemBase & { kind: 'custom'; exercises: PlannedExercise[] })
  | (ItemBase & { kind: 'routine'; routineId: string })
  | (ItemBase & { kind: 'user-routine'; templateId: string })
  | (ItemBase & {
      kind: 'warmup' | 'cooldown'
      /** What the main session trains; the routine is generated from it. */
      muscles: string[]
    })

export interface DayPlan {
  /** Local YYYY-MM-DD the plan is for. */
  date: string
  headline: string
  rationale: string
  items: DayPlanItem[]
  /** What the engine changed while checking it, in plain words. */
  adjustments: string[]
  source: CoachSource
  createdAt: string
}

// ---- block proposal ----

export type VolumeZone = 'below' | 'maintenance' | 'productive' | 'high' | 'over'

export interface VolumeRow {
  muscle: string
  sets: number
  zone: VolumeZone
  mev: number
  mrv: number
  focus: boolean
}

export interface BlockProposal {
  name: string
  weeks: number
  focus: string[]
  days: MesoDay[]
  rationale: string
  /** Week-one weekly sets per muscle against the landmarks. */
  volume: VolumeRow[]
  /** Estimated minutes per day, same order as days. */
  minutes: number[]
  adjustments: string[]
  warnings: string[]
}

// ---- thread ----

export type CoachCard =
  | { type: 'day-plan'; plan: DayPlan }
  | {
      type: 'block'
      id: string
      proposal: BlockProposal
      /** Set once the athlete saved it: the block it became. */
      savedMesoId?: string
    }
  | { type: 'choices'; options: string[] }
  | { type: 'note'; note: CoachNote }
  | { type: 'checkin'; saved: Partial<Checkin> }

export interface ThreadEntry {
  id: string
  role: 'user' | 'coach'
  text: string
  cards?: CoachCard[]
  at: string
  source?: CoachSource
  /** A turn that failed; shown with a retry, never sent back as history. */
  error?: string
}

// ---- tool execution ----

export interface ToolOutcome {
  /** JSON the model reads. */
  result: string
  isError: boolean
  card?: CoachCard
  /**
   * True when the model should see the result before the turn can end: a
   * lookup it asked for, or a proposal the engine changed or rejected.
   */
  followUp: boolean
}
