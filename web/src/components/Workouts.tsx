import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ComponentProps } from 'react'
import { mesoFromProposal } from '../lib/agent/block'
import { coachLine, generatedTitle } from '../lib/agent/dayplan'
import { applyTrim, generatedRoutine } from '../lib/agent/options'
import {
  addNote,
  getDayPlan,
  getNotes,
  setDayPlan,
  useDayPlan,
} from '../lib/agent/store'
import type {
  AgentContext,
  BlockProposal,
  DayPlanItem,
  Trim,
} from '../lib/agent/types'
import { useCoach } from '../lib/agent/useCoach'
import { exercisesByFrequency } from '../lib/analytics'
import type { Api } from '../lib/api'
import { todayCheckin, type Checkin } from '../lib/checkins'
import {
  EQUIPMENT,
  MUSCLE_GROUPS,
  equipmentLabel,
  equipmentOf,
  exerciseCatalog,
  inferEquipment,
  isBodyweight,
  loadCustomExercises,
  makeMuscleLookup,
  registerEquipmentOverrides,
  saveCustomExercises,
  type CustomExercise,
  type Equipment,
} from '../lib/exercises'
import {
  buildIntervals,
  DEFAULT_PLAN,
  fmtSec,
  hasSlots,
  loadTemplateCache,
  routineToSections,
  saveTemplateCache,
  totalSec,
  type QuickIntervalPlan,
  type Template,
} from '../lib/templates'
import {
  effectiveRoutines,
  resolveRoutine,
  routineAsTemplate,
  routineMinutes,
  routineSections,
} from '../lib/routines'
import { strapSummary, useStrapMetrics } from '../lib/strap'
import { generateRoutine, suggestedMinutes } from '../lib/generate'
import {
  enqueue,
  finalizeWorkout,
  flushQueue,
  loadDraft,
  loadPending,
  loadTimerDraft,
  loadWorkoutCache,
  newWorkout,
  saveDraft,
  saveTimerDraft,
  saveWorkoutCache,
  workoutVolume,
  type IntervalSection,
  type Modality,
  type SessionRecord,
  type TimerDraft,
  type Workout,
  type WorkoutKind,
  type WorkoutSet,
} from '../lib/workouts'
import {
  autoStartLockScreen,
  lockScreenSupported,
  setLockScreenSuppressed,
  stopLockScreen,
} from '../lib/lockScreen'
import {
  activeMeso,
  dayKind,
  isDeloadWeek,
  loadMesoCache,
  mesoOverdue,
  mesoWeek,
  plannedSets,
  plannedSetsForExercise,
  prescribeExercises,
  saveMesoCache,
  type Mesocycle,
  type Prescription,
} from '../lib/mesocycle'
import type { CoachChip } from './coach/CoachHero'
import { CoachSheet } from './coach/CoachSheet'
import { MesoCard, MesoSetup } from './Mesocycle'
import { localInputValue } from '../lib/datetime'
import {
  blockDaysAt,
  isFilled,
  movePast,
  pastProblem,
  pastStartProblem,
  pastWorkout,
  sameRows,
  settlePast,
  type PastChoice,
} from '../lib/past'
import { PastSession } from './PastSession'
import {
  applyRecommendations,
  feedbackMuscles,
  recommendations,
  type Recommendation,
} from '../lib/progression'
import { refreshMe, useMe } from '../lib/me'
import { onMinimise, onResume, setInSession } from '../lib/sessionBus'
import { useUnitPref } from '../lib/units'
import {
  currentBodyWeight,
  dismissWeighIn,
  enqueueWeight,
  flushWeights,
  loadPendingWeights,
  loadWeightCache,
  localToday,
  mergeWeights,
  saveWeightCache,
  sortWeights,
  upsertWeight,
  weighInDismissedOn,
  weighInDue,
  type WeightEntry,
} from '../lib/weights'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Card } from './cadence/Card'
import { EmptyState } from './cadence/EmptyState'
import { Field, SELECT_WELL, TextArea, TextInput } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import { List, ListItem } from './cadence/ListItem'
import { ScaleRow } from './cadence/ScaleRow'
import { Progress, SessionBar } from './cadence/SessionBar'
import { AddSetButton, SetHeader, SetRow, type SetField } from './cadence/SetRow'
import { StatusPill } from './cadence/StatusPill'
import { FeedbackModal } from './Feedback'
import { IntervalSession } from './IntervalTimer'
import { LockScreenSwitch } from './LockScreenSwitch'
import { Manage } from './Manage'
import { modalityLabel, QuickLog } from './QuickLog'
import { Chips } from './shell/Chips'
import {
  IconChevronDown,
  IconChevronLeft,
  IconGrip,
  IconPlus,
  IconRecover,
  IconRun,
  IconSpeed,
  IconStrength,
  IconX,
} from './shell/icons'
import { confirm } from '../lib/confirm'
import { Segment } from './shell/Segment'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'
import { SlotFill } from './SlotFill'
import { KIND_LEAD, PlanFields, TemplateBuilder, templateMeta } from './TemplateBuilder'
import { Today } from './Today'
import { WeighIn } from './WeighIn'
import { WorkoutDetail } from './WorkoutDetail'

// Trends carries the recharts dependency — split it out of the logger path
const Trends = lazy(() =>
  import('./Trends').then((m) => ({ default: m.Trends })),
)

const YD = 0.9144
const MILE = 1609.34

/** Long histories render in pages — keeps the list DOM small offline too. */
const PAGE = 20

/** The Log chips: every kind, one kind, or the strap's captured sessions. */
type LogFilter = 'all' | WorkoutKind | 'captured'

const LOG_CHIPS: Array<{ value: LogFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'strength', label: 'Strength' },
  { value: 'speed', label: 'Speed' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'captured', label: 'Captured' },
]

const KIND_LABEL: Record<WorkoutKind, string> = {
  strength: 'Strength',
  speed: 'Speed',
  cardio: 'Cardio',
  recovery: 'Recovery',
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function fmtElapsed(ms: number): string {
  return fmtSec(ms / 1000)
}

/** Local calendar day as YYYY-MM-DD. */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Monday of the local week holding an instant, as a local day. */
function mondayOf(ms: number): string {
  const d = new Date(ms)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localDay(d)
}

/** A local day moved by whole days, safe across DST. */
function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + days)
  return localDay(d)
}

/** "Sep 8" for a section heading. */
function fmtDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Minutes a workout took: the logged figure, else its clock span. */
function workoutMinutes(w: Workout): number | null {
  if (w.durationMin != null) return w.durationMin
  if (!w.end) return null
  const ms = new Date(w.end).getTime() - new Date(w.start).getTime()
  return ms > 0 ? Math.round(ms / 60_000) : null
}

/** The ghost line under a set row: what this set was last time. */
function ghostLine(kind: WorkoutKind, s: WorkoutSet | undefined): string | undefined {
  if (!s) return undefined
  if (kind === 'speed') {
    if (s.distanceM == null && s.durationSec == null) return undefined
    const parts: string[] = []
    if (s.distanceM != null) parts.push(`${Math.round(s.distanceM / YD)} yd`)
    if (s.durationSec != null) parts.push(`${s.durationSec} s`)
    return `Last time ${parts.join(' · ')}`
  }
  if (s.weight == null && s.reps == null) return undefined
  const line = `Last time ${s.weight ?? '—'} × ${s.reps ?? '—'}`
  return s.rpe != null ? `${line} @ ${s.rpe}` : line
}

/** Rep target a row is showing: the block's per-set plan (a 12/10 session
 * progresses to 13/11, not 13/13), then its headline, then last time's. */
function ghostReps(
  presc: Prescription | undefined,
  prev: WorkoutSet | undefined,
  si: number,
): number | undefined {
  return presc?.targetRepsBySet?.[si] ?? presc?.targetReps ?? prev?.reps
}

/** Effort a row is showing: inside a block the week's target (RPE ≈ 10 −
 * RIR), otherwise last time's rating. A deload deliberately has none —
 * "stop far from failure" is not a number to prefill. */
function ghostRpe(
  presc: Prescription | undefined,
  prev: WorkoutSet | undefined,
): number | undefined {
  if (presc) return presc.rir != null ? 10 - presc.rir : undefined
  return prev?.rpe
}

// ---------------------------------------------------------------------------
// Strength session (RP-style: check off sets as you go)
// ---------------------------------------------------------------------------

function SessionEditor({
  initial,
  isNew,
  past = false,
  onMoved,
  whenHelp,
  history,
  customs,
  lookup,
  bodyWeightLb,
  prescribe,
  mesoSetCount,
  onSaveCustom,
  onFinish,
  onClose,
  onDiscard,
  onDelete,
  onWarmUp,
  prsToday,
  onPrs,
}: {
  initial: Workout
  isNew: boolean
  /** A session being entered after the fact: not live, not yet saved.
   * `history` is then what had been logged before it. */
  past?: boolean
  /** Past sessions: the date was changed in the form. Gets the session
   * with its new start and returns it as it should now stand (a block
   * day re-planned for that date, say). */
  onMoved?: (moved: Workout) => Workout
  /** Past sessions: what the chosen date means, shown under When. */
  whenHelp?: string
  history: Workout[]
  customs: CustomExercise[]
  lookup: (name: string) => string | undefined
  bodyWeightLb?: number
  /** Meso targets for a set of exercises — ghosts and check-offs adopt
   * these. A function, not a snapshot: the list changes mid-session. */
  prescribe?: (
    names: string[],
    setsByName: Record<string, number>,
  ) => Record<string, Prescription>
  /** How many sets a lift added mid-block should start with. */
  mesoSetCount?: (name: string, usedByMuscle: number) => number
  onSaveCustom: (name: string, muscle: string, equipment?: Equipment) => void
  /** Finish (live) or Save (editing); runs once the sheet has dropped. */
  onFinish: (w: Workout) => void
  /** Minimise (live) or Back (editing); runs once the sheet has dropped. */
  onClose: () => void
  /** A live session thrown away; the draft is already cleared. */
  onDiscard: () => void
  /** Resolves true once the saved workout is gone. */
  onDelete?: (w: Workout) => Promise<boolean>
  /** Offered before the first set: a dynamic warm-up keyed to the
   * session's muscle groups. Runs once the sheet has dropped. */
  onWarmUp?: (muscles: string[]) => void
  /** Today's perceived-recovery check-in value, 0–10, if logged already. */
  prsToday?: number
  /** Offered before the first set: how recovered the lifter feels right
   * now, folded straight into today's check-in. */
  onPrs?: (n: number) => void
}) {
  const [w, setW] = useState<Workout>(initial)
  const [exerciseName, setExerciseName] = useState('')
  const [newMuscle, setNewMuscle] = useState<string>('other')
  const [newEquipment, setNewEquipment] = useState<Equipment | null>(null)
  const [now, setNow] = useState(Date.now())
  const [coachHidden, setCoachHidden] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const exerciseId = useId()
  const muscleId = useId()
  const equipmentId = useId()
  const titleId = useId()
  const startId = useId()
  const notesId = useId()
  const durationId = useId()
  const distanceId = useId()
  const lengthId = useId()

  // Every way out unmounts this screen in the parent, so the sheet drops
  // first and the real callback waits for the exit to finish.
  const { open, dismiss, onExited } = useSheetDismiss()

  // Computed at mount (session start), so the 7-day windows are fresh.
  // Meso sessions get no global coach — the meso prescription IS the
  // coaching, and the two would contradict each other.
  const recs = useMemo(
    () =>
      // …and neither do sessions the coach's day plan already shaped
      isNew && !initial.mesoId && !initial.coach
        ? recommendations(history, lookup)
        : ({} as Record<string, Recommendation>),
    [isNew, initial.mesoId, initial.coach, history, lookup],
  )

  // Targets follow the exercise list: swap a lift or add one mid-session
  // and it gets ghosts and a target like any lift the block planned.
  // Keyed on the list's shape so typing in a set field can't re-run it.
  const exerciseShape = w.exercises
    .map((e) => `${e.name}:${e.sets.length}`)
    .join('|')
  const prescriptions = useMemo(
    () =>
      prescribe?.(
        w.exercises.map((e) => e.name),
        Object.fromEntries(w.exercises.map((e) => [e.name, e.sets.length])),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prescribe, exerciseShape],
  )

  // Coach lines for the muscle groups this session actually trains
  const coach = useMemo(() => {
    if (!isNew) return []
    const muscles: string[] = []
    for (const e of w.exercises) {
      const m = lookup(e.name)
      if (m && recs[m] && !muscles.includes(m)) muscles.push(m)
    }
    return muscles.map((m) => recs[m])
  }, [isNew, recs, w.exercises, lookup])

  // Bodyweight moves default to the athlete's WHOOP-measured mass (whole lb).
  const roundedBodyWeight =
    bodyWeightLb !== undefined ? Math.round(bodyWeightLb) : undefined

  // Drag-to-reorder: exercise cards move as the handle crosses a neighbour's
  // midpoint. Refs to the card elements let us read live positions on the fly.
  // The live drag position lives in a ref (not just state) so the move logic
  // stays out of state updaters — React double-invokes those in StrictMode,
  // which would swap twice and cancel the reorder.
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const dragFrom = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  // Draft autosave: a locked phone or dead battery must not eat a workout
  useEffect(() => {
    if (isNew) saveDraft(w)
  }, [w, isNew])

  useEffect(() => {
    if (!isNew) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [isNew])

  const knownNames = useMemo(() => {
    const names = new Set(
      exerciseCatalog(customs, w.kind === 'speed' ? 'speed' : 'strength').map(
        (e) => e.name,
      ),
    )
    for (const past of history) {
      if (past.kind !== w.kind) continue
      for (const e of past.exercises) names.add(e.name)
    }
    return [...names].sort()
  }, [history, w.kind, customs])

  const typedUnknown =
    exerciseName.trim().length > 0 && lookup(exerciseName) === undefined

  /** Last time's sets, for ghost placeholders per set index. Inside a
   * mesocycle the same lift on two different days is two separate slots,
   * so pass 0 looks for the same meso day and only pass 1 widens to any
   * session. */
  function prevSetsFor(name: string): WorkoutSet[] {
    const sameSlot = (past: Workout) =>
      w.mesoId != null &&
      past.mesoId === w.mesoId &&
      past.mesoDayIndex === w.mesoDayIndex
    for (const pass of [0, 1]) {
      for (const past of history) {
        if (past.id === w.id) continue
        if (pass === 0 && !sameSlot(past)) continue
        const match = past.exercises.find(
          (e) => e.name.toLowerCase() === name.toLowerCase(),
        )
        if (match && match.sets.length > 0) return match.sets
      }
    }
    return []
  }

  function addExercise() {
    const name = exerciseName.trim()
    if (!name) return
    // First time we see this name: remember it (and its muscle) per-user
    if (lookup(name) === undefined) {
      onSaveCustom(name, newMuscle, newEquipment ?? inferEquipment(name) ?? 'other')
    }
    const prev = prevSetsFor(name)
    // Inside a block the block sizes the lift: a swap onto a focus muscle
    // picks up this week's ramp, everything else repeats what it did last
    // time — and the per-muscle session cap still applies.
    const muscle = lookup(name)
    const used =
      muscle === undefined
        ? 0
        : w.exercises.reduce(
            (n, e) => (lookup(e.name) === muscle ? n + e.sets.length : n),
            0,
          )
    const rows = mesoSetCount?.(name, used) ?? Math.max(prev.length, 1)
    setW({
      ...w,
      exercises: [
        ...w.exercises,
        { name, sets: Array.from({ length: rows }, () => ({})) },
      ],
    })
    setExerciseName('')
    setNewMuscle('other')
    setNewEquipment(null)
  }

  function patchSet(ei: number, si: number, patch: Partial<WorkoutSet>) {
    setW({
      ...w,
      exercises: w.exercises.map((e, i) =>
        i !== ei
          ? e
          : {
              ...e,
              sets: e.sets.map((s, j) => (j !== si ? s : { ...s, ...patch })),
            },
      ),
    })
  }

  function toggleDone(ei: number, si: number, prev: WorkoutSet | undefined) {
    const current = w.exercises[ei].sets[si]
    if (current.done) {
      patchSet(ei, si, { done: false })
      return
    }
    // Checking an empty row adopts exactly what the row was SHOWING —
    // the meso prescription when there is one, else last time's (RP-style
    // "same again"). Effort included: an unrated set is a set the engine
    // has to guess the effort of later. Bodyweight moves track TODAY's
    // measured mass. A typed value always wins, and whatever lands here
    // anchors the next meso prescription — enter 355 where the plan said
    // 335 and next session builds on 355.
    const exName = w.exercises[ei].name
    const bw = w.kind !== 'speed' && isBodyweight(exName)
    const presc = prescriptions?.[exName]
    patchSet(ei, si, {
      done: true,
      // BW moves always follow today's measurement, even inside a meso
      weight:
        current.weight ??
        (bw
          ? (roundedBodyWeight ?? presc?.weight ?? prev?.weight)
          : (presc?.weight ?? prev?.weight)),
      reps: current.reps ?? ghostReps(presc, prev, si),
      rpe: current.rpe ?? ghostRpe(presc, prev),
      durationSec: current.durationSec ?? prev?.durationSec,
      distanceM: current.distanceM ?? prev?.distanceM,
    })
  }

  function addSet(ei: number) {
    setW({
      ...w,
      exercises: w.exercises.map((e, i) =>
        i !== ei
          ? e
          : { ...e, sets: [...e.sets, { ...e.sets.at(-1), done: false }] },
      ),
    })
  }

  function removeExercise(ei: number) {
    setW({ ...w, exercises: w.exercises.filter((_, i) => i !== ei) })
  }

  // Drop one set; the exercise itself goes when its last set is removed.
  function removeSet(ei: number, si: number) {
    setW({
      ...w,
      exercises: w.exercises
        .map((e, i) =>
          i !== ei ? e : { ...e, sets: e.sets.filter((_, j) => j !== si) },
        )
        .filter((e) => e.sets.length > 0),
    })
  }

  function moveExercise(from: number, to: number) {
    if (from === to) return
    setW((prev) => {
      const next = [...prev.exercises]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...prev, exercises: next }
    })
  }

  function onHandlePointerDown(ei: number, ev: React.PointerEvent) {
    ev.preventDefault()
    // preventDefault also suppresses the focus change a press would cause,
    // so end any in-progress set-field edit explicitly — inputs are keyed
    // to list positions and an edit must not follow the wrong exercise
    // through a reorder.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    try {
      // Capture keeps move events flowing to the handle once the finger
      // wanders off it; if capture is unavailable the drag still works
      // while the pointer stays over the handle.
      ev.currentTarget.setPointerCapture(ev.pointerId)
    } catch {
      /* no active pointer (synthetic events, exotic devices) */
    }
    dragFrom.current = ei
    setDragIndex(ei)
  }

  function onHandlePointerMove(ev: React.PointerEvent) {
    const from = dragFrom.current
    if (from === null) return
    // Swap once the pointer clears the midpoint of an adjacent card.
    const prev = cardRefs.current[from - 1]
    if (prev) {
      const r = prev.getBoundingClientRect()
      if (ev.clientY < r.top + r.height / 2) {
        moveExercise(from, from - 1)
        dragFrom.current = from - 1
        setDragIndex(from - 1)
        return
      }
    }
    const next = cardRefs.current[from + 1]
    if (next) {
      const r = next.getBoundingClientRect()
      if (ev.clientY > r.top + r.height / 2) {
        moveExercise(from, from + 1)
        dragFrom.current = from + 1
        setDragIndex(from + 1)
      }
    }
  }

  function onHandlePointerUp(ev: React.PointerEvent) {
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId)
    } catch {
      /* capture may never have been acquired */
    }
    dragFrom.current = null
    setDragIndex(null)
  }

  const numeric = (raw: string) => (raw === '' ? undefined : Number(raw))

  const doneCount = w.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.done).length,
    0,
  )
  const totalCount = w.exercises.reduce((n, e) => n + e.sets.length, 0)
  // Nothing is ticked off live in a past session: a row with numbers in
  // it is a set that was done.
  const enteredCount = w.exercises.reduce(
    (n, e) => n + e.sets.filter(isFilled).length,
    0,
  )

  // What was wrong with the last save attempt stops being true as soon
  // as the session changes
  useEffect(() => {
    setProblem(null)
  }, [w])

  function finish() {
    if (past) {
      const why = pastProblem(w, Date.now())
      if (why) {
        setProblem(why)
        topRef.current?.scrollIntoView({ block: 'start' })
        return
      }
    } else if (!isNew && w.start !== initial.start) {
      // A saved session moved to a date the log cannot show (a half-typed
      // year, the future) would simply vanish from it
      const why = pastStartProblem(new Date(w.start).getTime(), Date.now())
      if (why) {
        setProblem(why)
        topRef.current?.scrollIntoView({ block: 'start' })
        return
      }
    }
    const done = { ...w, end: isNew ? new Date().toISOString() : w.end }
    dismiss(() => onFinish(done))
  }

  // A saved session's length is its end minus its start, so the two are
  // edited together: moving the start keeps the length.
  // A timer session also stores its minutes, and everything that shows a
  // duration reads that figure first, so it is the one the field edits.
  const startMs = new Date(w.start).getTime()
  const storesMinutes = w.kind !== 'cardio' && initial.durationMin != null
  const lengthMin =
    storesMinutes && w.durationMin != null
      ? w.durationMin
      : w.end != null
        ? Math.max(0, Math.round((new Date(w.end).getTime() - startMs) / 60_000))
        : undefined

  // What the form opened with, to tell an edit from a look
  const openedLength = useRef(lengthMin)

  function setStart(value: string) {
    const next = new Date(value)
    if (!value || Number.isNaN(next.getTime())) return
    // The end travels with the start, by exactly as much: a session keeps
    // its length to the second, whatever that length is. One that only
    // stores its minutes gets an end from them.
    let end: string | undefined
    if (!isNew) {
      if (w.end != null) {
        const shift = next.getTime() - startMs
        end = new Date(new Date(w.end).getTime() + shift).toISOString()
      } else if (lengthMin != null && lengthMin > 0) {
        end = new Date(next.getTime() + lengthMin * 60_000).toISOString()
      }
    }
    const moved = {
      ...w,
      start: next.toISOString(),
      ...(end !== undefined && { end }),
    }
    setW(onMoved ? onMoved(moved) : moved)
  }

  function setLength(raw: number | undefined) {
    const minutes = raw != null && raw > 0 ? Math.round(raw) : undefined
    setW({
      ...w,
      end:
        minutes != null
          ? new Date(startMs + minutes * 60_000).toISOString()
          : undefined,
      ...(storesMinutes && { durationMin: minutes }),
    })
  }

  /** Back out of a past session, asking first once something is entered. */
  async function leave() {
    const entered =
      past &&
      (Boolean(w.notes) ||
        enteredCount > 0 ||
        w.distanceM != null ||
        w.sessionRpe != null ||
        w.durationMin !== initial.durationMin ||
        lengthMin !== openedLength.current ||
        // `initial` is the session as last laid out, so a list that
        // differs from it is one the athlete built or reshaped
        !sameRows(w.exercises, initial.exercises))
    if (
      entered &&
      !(await confirm({ title: 'Discard this session?', action: 'Discard' }))
    ) {
      return
    }
    dismiss(onClose)
  }

  async function discard() {
    if (
      w.exercises.length > 0 &&
      !(await confirm({ title: 'Discard this workout?', action: 'Discard' }))
    ) {
      return
    }
    saveDraft(null)
    dismiss(onDiscard)
  }

  function deleteSaved() {
    if (!onDelete) return
    void onDelete(w).then((ok) => {
      if (ok) dismiss(onClose)
    })
  }

  const heading = w.title || KIND_LABEL[w.kind]
  const headerLabels =
    w.kind === 'speed' ? ['yd', 's'] : [w.weightUnit, 'reps', 'rpe']

  // A dynamic warm-up offer, keyed to the muscles this session trains —
  // generateRoutine returning null (an all-custom exercise list, say)
  // hides the offer instead of linking to an empty routine. Keyed on the
  // exercise list's shape (like exerciseShape above) so typing in a set
  // field can't re-run the generator.
  const exerciseNames = w.exercises.map((e) => e.name).join('|')
  const warmupMuscles = useMemo(
    () => [
      ...new Set(
        w.exercises
          .map((e) => lookup(e.name))
          .filter((m): m is string => m !== undefined),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exerciseNames, lookup],
  )
  const warmupRoutine = useMemo(
    () =>
      isNew && doneCount === 0 && w.exercises.length > 0
        ? generateRoutine({
            muscles: warmupMuscles,
            phase: 'pre',
            minutes: suggestedMinutes(warmupMuscles, 'pre'),
          })
        : null,
    [isNew, doneCount, w.exercises.length, warmupMuscles],
  )

  return (
    <Sheet
      open={open}
      onClose={() => void leave()}
      onExited={onExited}
      ariaLabel={
        isNew ? 'Live session' : past ? 'Log a past session' : 'Edit workout'
      }
      dockClearance={isNew}
      header={
        <SessionBar
          left={
            <IconButton
              label={isNew ? 'Minimise' : 'Back'}
              onClick={() => void leave()}
            >
              {isNew ? <IconChevronDown /> : <IconChevronLeft />}
            </IconButton>
          }
          center={
            <div className="flex min-w-0 items-baseline gap-2">
              {isNew ? (
                <span className="text-numeric-lg text-ink">
                  {fmtElapsed(now - new Date(w.start).getTime())}
                </span>
              ) : (
                <span className="truncate text-body font-medium text-ink">
                  {fmtDate(w.start)}
                </span>
              )}
              {totalCount > 0 && (
                <span className="shrink-0 text-caption text-ink-2">
                  {past ? enteredCount : doneCount} of {totalCount} sets
                </span>
              )}
            </div>
          }
          right={
            <Button variant="tonal" size="sm" onClick={finish}>
              {isNew ? 'Finish' : 'Save'}
            </Button>
          }
          progress={
            isNew ? (
              <Progress
                value={totalCount > 0 ? doneCount / totalCount : 0}
                label="Sets done"
              />
            ) : undefined
          }
        />
      }
    >
      <div ref={topRef} className="mt-3 flex scroll-mt-24 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 truncate text-title text-ink">{heading}</h2>
          {isNew && (
            <StatusPill tone="effort" dot>
              Live
            </StatusPill>
          )}
          {past && <StatusPill>Past session</StatusPill>}
        </div>

        {problem && <Banner tone="error">{problem}</Banner>}

        {past && (
          <Card>
            <div className="flex flex-col gap-3">
              <Field label="When" htmlFor={startId} help={whenHelp}>
                <TextInput
                  id={startId}
                  type="datetime-local"
                  value={localInputValue(w.start)}
                  max={localInputValue(new Date().toISOString())}
                  onChange={(e) => setStart(e.target.value)}
                />
              </Field>
              {w.kind !== 'cardio' && (
                <Field label="How long (min)" htmlFor={lengthId}>
                  <TextInput
                    id={lengthId}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={lengthMin ?? ''}
                    onChange={(e) => setLength(numeric(e.target.value))}
                  />
                </Field>
              )}
            </div>
          </Card>
        )}

        {isNew && initial.coach?.holdLoad && (
          <Banner>
            <span>
              <b>Coach</b> Hold today. Repeat last time&rsquo;s weights and
              reps.
            </span>
          </Banner>
        )}

        {coach.length > 0 && !coachHidden && (
          <Card tone="brand">
            <div className="flex items-start justify-between gap-3">
              <p className="text-eyebrow">Coach</p>
              <IconButton
                size="sm"
                inherit
                label="Dismiss"
                onClick={() => setCoachHidden(true)}
              >
                <IconX className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="mt-1 flex flex-col gap-2">
              {coach.map((r) => (
                <p key={r.muscle} className="text-body">
                  <span className="font-semibold capitalize">{r.muscle}</span>
                  {' · '}
                  {r.summary}
                  <span className="block text-caption opacity-80">
                    {r.reason}
                  </span>
                </p>
              ))}
            </div>
          </Card>
        )}

        {isNew && onPrs && doneCount === 0 && (
          <Card>
            <ScaleRow
              label="Recovered"
              low="Not at all"
              high="Fully"
              value={prsToday}
              onChange={onPrs}
            />
          </Card>
        )}

        {isNew && onWarmUp && doneCount === 0 && w.exercises.length > 0 && warmupRoutine && (
          <List>
            <ListItem
              lead={<IconRecover />}
              leadTone="calm"
              title="Warm up"
              sub={`${suggestedMinutes(warmupMuscles, 'pre')} min`}
              chevron
              onClick={() => dismiss(() => onWarmUp(warmupMuscles))}
            />
          </List>
        )}

        {w.kind === 'cardio' && (
          <Card>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duration (min)" htmlFor={durationId}>
                <TextInput
                  id={durationId}
                  type="number"
                  inputMode="numeric"
                  value={w.durationMin ?? ''}
                  onChange={(e) =>
                    setW({ ...w, durationMin: numeric(e.target.value) })
                  }
                />
              </Field>
              <Field label="Distance (mi)" htmlFor={distanceId}>
                <TextInput
                  id={distanceId}
                  type="number"
                  inputMode="decimal"
                  value={
                    w.distanceM != null
                      ? Math.round((w.distanceM / MILE) * 100) / 100
                      : ''
                  }
                  onChange={(e) =>
                    setW({
                      ...w,
                      distanceM: e.target.value
                        ? Math.round(Number(e.target.value) * MILE)
                        : undefined,
                    })
                  }
                />
              </Field>
            </div>
          </Card>
        )}

        {w.exercises.map((e, ei) => {
          const prev = prevSetsFor(e.name)
          const muscle = lookup(e.name)
          const bw = w.kind !== 'speed' && isBodyweight(e.name)
          const eq = w.kind !== 'speed' ? equipmentOf(e.name) : undefined
          const presc = prescriptions?.[e.name]
          return (
            <div
              key={ei}
              ref={(el) => {
                cardRefs.current[ei] = el
              }}
              className={dragIndex === ei ? 'rounded-lg shadow-float' : ''}
            >
              <Card>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-title-sm text-ink">{e.name}</p>
                    {(muscle || eq) && (
                      <div className="mt-0.5 flex items-center gap-2">
                        {muscle && (
                          <span className="text-caption text-ink-2">
                            {muscle}
                          </span>
                        )}
                        {eq && <StatusPill>{equipmentLabel(eq)}</StatusPill>}
                      </div>
                    )}
                  </div>
                  <IconButton
                    size="sm"
                    label="Reorder"
                    onPointerDown={(ev) => onHandlePointerDown(ei, ev)}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerUp}
                    className="touch-none cursor-grab select-none"
                  >
                    <IconGrip />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label="Remove exercise"
                    onClick={() => removeExercise(ei)}
                  >
                    <IconX className="h-4 w-4" />
                  </IconButton>
                </div>

                {presc && (
                  <p className="mt-2 text-caption text-brand-strong">
                    {presc.note}
                  </p>
                )}

                <div className="mt-3 flex flex-col">
                  <SetHeader labels={headerLabels} />
                  {e.sets.map((s, si) => {
                    const ghost = prev[si] ?? prev.at(-1)
                    const fields: SetField[] =
                      w.kind === 'speed'
                        ? [
                            {
                              key: 'yd',
                              value:
                                s.distanceM != null
                                  ? Math.round(s.distanceM / YD)
                                  : undefined,
                              placeholder:
                                ghost?.distanceM != null
                                  ? String(Math.round(ghost.distanceM / YD))
                                  : '',
                              ariaLabel: `Set ${si + 1} yards`,
                              inputMode: 'numeric',
                              onChange: (v) =>
                                patchSet(ei, si, {
                                  distanceM:
                                    v === undefined
                                      ? undefined
                                      : Math.round(v * YD * 100) / 100,
                                }),
                            },
                            {
                              key: 's',
                              value: s.durationSec,
                              placeholder:
                                ghost?.durationSec != null
                                  ? String(ghost.durationSec)
                                  : '',
                              ariaLabel: `Set ${si + 1} seconds`,
                              inputMode: 'decimal',
                              onChange: (v) =>
                                patchSet(ei, si, { durationSec: v }),
                            },
                          ]
                        : [
                            {
                              key: 'weight',
                              value: s.weight,
                              // today's body weight rules BW moves (even in
                              // a meso), then the meso target, then history
                              placeholder:
                                bw && roundedBodyWeight !== undefined
                                  ? String(roundedBodyWeight)
                                  : presc?.weight != null
                                    ? String(presc.weight)
                                    : ghost?.weight != null
                                      ? String(ghost.weight)
                                      : '',
                              ariaLabel: `Set ${si + 1} ${w.weightUnit}`,
                              inputMode: 'decimal',
                              onChange: (v) => patchSet(ei, si, { weight: v }),
                            },
                            {
                              key: 'reps',
                              value: s.reps,
                              placeholder:
                                ghostReps(presc, ghost, si)?.toString() ?? '',
                              ariaLabel: `Set ${si + 1} reps`,
                              inputMode: 'numeric',
                              onChange: (v) => patchSet(ei, si, { reps: v }),
                            },
                            {
                              key: 'rpe',
                              value: s.rpe,
                              // RIR n ≈ RPE 10−n
                              placeholder:
                                ghostRpe(presc, ghost)?.toString() ?? '',
                              ariaLabel: `Set ${si + 1} RPE`,
                              inputMode: 'decimal',
                              onChange: (v) => patchSet(ei, si, { rpe: v }),
                            },
                          ]
                    return (
                      <SetRow
                        key={si}
                        index={si + 1}
                        fields={fields}
                        done={Boolean(s.done)}
                        onToggleDone={() => toggleDone(ei, si, ghost)}
                        onRemove={() => removeSet(ei, si)}
                        ghost={ghostLine(w.kind, ghost)}
                      />
                    )
                  })}
                  <AddSetButton onClick={() => addSet(ei)} />
                </div>
              </Card>
            </div>
          )
        })}

        {w.kind !== 'cardio' && (
          <Card>
            <div className="flex flex-col gap-3">
              <Field
                label={w.kind === 'speed' ? 'Drill' : 'Exercise'}
                htmlFor={exerciseId}
              >
                <TextInput
                  id={exerciseId}
                  list="exercise-names"
                  value={exerciseName}
                  onChange={(e) => setExerciseName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addExercise()}
                />
                <datalist id="exercise-names">
                  {knownNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </Field>
              {typedUnknown && (
                <Field label="Muscle group" htmlFor={muscleId}>
                  <select
                    id={muscleId}
                    className={SELECT_WELL}
                    value={newMuscle}
                    onChange={(e) => setNewMuscle(e.target.value)}
                  >
                    {MUSCLE_GROUPS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {typedUnknown && w.kind !== 'speed' && (
                <Field label="Equipment" htmlFor={equipmentId}>
                  <select
                    id={equipmentId}
                    className={SELECT_WELL}
                    value={newEquipment ?? inferEquipment(exerciseName) ?? 'other'}
                    onChange={(e) => setNewEquipment(e.target.value as Equipment)}
                  >
                    {EQUIPMENT.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Button variant="quiet" block onClick={addExercise}>
                {w.kind === 'speed' ? 'Add drill' : 'Add exercise'}
              </Button>
            </div>
          </Card>
        )}

        {!isNew && w.kind !== 'strength' && (
          <Card>
            <ScaleRow
              label="Effort"
              low="Rest"
              high="Max"
              value={w.sessionRpe}
              onChange={(n) => setW({ ...w, sessionRpe: n })}
            />
          </Card>
        )}

        <Card>
          <div className="flex flex-col gap-3">
            <Field label="Title" htmlFor={titleId}>
              <TextInput
                id={titleId}
                value={w.title ?? ''}
                onChange={(e) =>
                  setW({ ...w, title: e.target.value || undefined })
                }
              />
            </Field>
            {!past && (
              <Field label="Start" htmlFor={startId}>
                <TextInput
                  id={startId}
                  type="datetime-local"
                  value={localInputValue(w.start)}
                  onChange={(e) => setStart(e.target.value)}
                />
              </Field>
            )}
            {!isNew && !past && w.kind !== 'cardio' && (
              <Field label="Duration (min)" htmlFor={lengthId}>
                <TextInput
                  id={lengthId}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={lengthMin ?? ''}
                  onChange={(e) => setLength(numeric(e.target.value))}
                />
              </Field>
            )}
            <Field label="Notes" htmlFor={notesId}>
              <TextArea
                id={notesId}
                value={w.notes ?? ''}
                onChange={(e) =>
                  setW({ ...w, notes: e.target.value || undefined })
                }
              />
            </Field>
          </div>
        </Card>

        {isNew && lockScreenSupported() && (
          <Card>
            <LockScreenSwitch />
          </Card>
        )}

        {isNew ? (
          <Button variant="ghost-danger" block onClick={discard}>
            Discard
          </Button>
        ) : past ? (
          <Button variant="ghost-danger" block onClick={() => void leave()}>
            Discard
          </Button>
        ) : (
          onDelete && (
            <Button variant="ghost-danger" block onClick={deleteSaved}>
              Delete
            </Button>
          )
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Start flow: templates, an open workout, a stopwatch, or quick intervals
// ---------------------------------------------------------------------------

type StartPane = 'train' | 'recover'

const START_PANES: Array<{ value: StartPane; label: string }> = [
  { value: 'train', label: 'Train' },
  { value: 'recover', label: 'Recover' },
]

function StartPicker({
  templates,
  initialKind = null,
  onStrength,
  onTimer,
  onQuickLog,
  onPast,
  onNewRoutine,
  confirmStart,
  onEnter,
  onDeleteTemplate,
  onCancel,
}: {
  templates: Template[]
  /** Opens straight to the Recover pane when 'recovery'. */
  initialKind?: WorkoutKind | null
  /** Set up the session on the click (drafts, lock screen) and hand back
   * the mode that shows it; the mode flips once the sheet has dropped. */
  onStrength: (template?: Template) => Mode
  onTimer: (kind: WorkoutKind, sections: IntervalSection[], title?: string) => Mode
  /** Runs once the sheet has dropped. */
  onQuickLog: () => void
  /** Log something that already happened; runs once the sheet has dropped. */
  onPast: () => void
  /** Runs once the sheet has dropped. */
  onNewRoutine: () => void
  /** False when a live draft exists and the lifter keeps it. */
  confirmStart: () => Promise<boolean>
  onEnter: (m: Mode) => void
  onDeleteTemplate: (t: Template) => void
  onCancel: () => void
}) {
  const [pane, setPane] = useState<StartPane>(
    initialKind === 'recovery' ? 'recover' : 'train',
  )
  const [plan, setPlan] = useState<QuickIntervalPlan>(DEFAULT_PLAN)
  const [intervalsOpen, setIntervalsOpen] = useState(false)
  const { open, dismiss, onExited } = useSheetDismiss()

  const planSections = useMemo(() => buildIntervals(plan), [plan])

  async function start(next: () => Mode, guard = true) {
    if (guard && !(await confirmStart())) return
    const m = next()
    dismiss(() => onEnter(m))
  }

  function startTemplate(t: Template) {
    if (t.kind === 'strength') {
      // A slot template picks its lifts first; that flow guards the draft.
      start(() => onStrength(t), !hasSlots(t))
    } else if (t.sections) {
      start(() => onTimer(t.kind, t.sections ?? [], t.name), false)
    }
  }

  function startRoutine(t: Template) {
    start(
      () =>
        onTimer('recovery', routineToSections(t.items ?? [], t.transitionSec), t.name),
      false,
    )
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onCancel)}
      onExited={onExited}
      title="Start a session"
    >
      <div className="flex flex-col gap-3">
        <Segment
          options={START_PANES}
          value={pane}
          onChange={setPane}
          block
          ariaLabel="Start"
        />

        {pane === 'train' && (
          <List>
            {templates
              .filter((t) => t.kind !== 'recovery')
              .map((t) => (
                <ListItem
                  key={t.id}
                  lead={KIND_LEAD[t.kind].icon}
                  leadTone={KIND_LEAD[t.kind].tone}
                  title={t.name}
                  sub={templateMeta(t)}
                  onClick={() => startTemplate(t)}
                  action={
                    <IconButton
                      size="sm"
                      label={`Delete template ${t.name}`}
                      onClick={() => onDeleteTemplate(t)}
                    >
                      <IconX className="h-4 w-4" />
                    </IconButton>
                  }
                />
              ))}
            <ListItem
              key="open"
              lead={<IconPlus />}
              title="Open workout"
              sub="Add exercises as you go"
              onClick={() => start(() => onStrength())}
            />
            <ListItem
              key="stopwatch"
              lead={<IconRun />}
              leadTone="rest"
              title="Stopwatch"
              sub="Log the miles after"
              onClick={() => start(() => onTimer('cardio', []), false)}
            />
            <div key="intervals">
              <ListItem
                lead={<IconSpeed />}
                leadTone="effort"
                title="Intervals"
                sub={`${planSections.length} sections · ${fmtSec(totalSec(planSections))}`}
                chevron={!intervalsOpen}
                onClick={() => setIntervalsOpen((v) => !v)}
              />
              {intervalsOpen && (
                <div className="mx-1 mb-1 flex flex-col gap-3 rounded-md bg-surface-2 p-4">
                  <PlanFields plan={plan} onChange={setPlan} summary={false} />
                  <Button
                    variant="primary"
                    block
                    onClick={() =>
                      start(() => onTimer('speed', buildIntervals(plan)), false)
                    }
                  >
                    Start
                  </Button>
                </div>
              )}
            </div>
          </List>
        )}

        {pane === 'recover' && (
          <List>
            {templates
              .filter((t) => t.kind === 'recovery' && !t.builtin)
              .map((t) => (
                <ListItem
                  key={t.id}
                  lead={<IconRecover />}
                  leadTone="calm"
                  title={t.name}
                  sub={templateMeta(t)}
                  onClick={() => startRoutine(t)}
                />
              ))}
            {/* The built-ins, each standing aside for the user's own edit */}
            {effectiveRoutines(templates).map(({ routine: r }) => (
              <ListItem
                key={r.id}
                lead={<IconRecover />}
                leadTone="calm"
                title={r.name}
                sub={`${routineMinutes(r)} min`}
                onClick={() =>
                  start(() => onTimer('recovery', routineSections(r), r.name), false)
                }
              />
            ))}
            <ListItem
              key="free-stretch"
              lead={<IconRecover />}
              leadTone="calm"
              title="Free stretch"
              sub="Stopwatch"
              onClick={() =>
                start(() => onTimer('recovery', [], 'Free stretch'), false)
              }
            />
            <ListItem
              key="quicklog"
              lead={<IconRecover />}
              leadTone="calm"
              title="Quick log"
              sub="Sauna, cold, walk"
              onClick={() => dismiss(onQuickLog)}
            />
            <ListItem
              key="new-routine"
              lead={<IconPlus />}
              leadTone="calm"
              title="New routine"
              sub="Your own stretches"
              onClick={() => dismiss(onNewRoutine)}
            />
          </List>
        )}

        <Button variant="quiet" block onClick={() => dismiss(onPast)}>
          Log a past session
        </Button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Lists: logged training, separated from WHOOP-captured activity
// ---------------------------------------------------------------------------

/** The sub line of a Log row: what the workout held, without the weekday. */
function workoutMeta(w: Workout): string[] {
  const { sets, volume } = workoutVolume(w)
  const parts: string[] = []
  if (w.kind === 'strength' && sets > 0) {
    const n = w.exercises.length
    parts.push(
      `${n} ${n === 1 ? 'exercise' : 'exercises'} · ${sets} ${sets === 1 ? 'set' : 'sets'}`,
    )
    // Tonnage shows in the row's trail instead
  }
  if (w.kind === 'recovery') {
    // The modality, unless the title already says it ("Sauna · Sauna")
    if (
      w.modality &&
      w.modality !== 'stretch' &&
      w.modality !== 'mobility' &&
      modalityLabel(w.modality) !== w.title
    ) {
      parts.push(modalityLabel(w.modality))
    }
    if (sets > 0) parts.push(`${sets} holds`)
    if (w.rating?.post != null) parts.push(`Feel ${w.rating.post}/5`)
    return parts
  }
  if (w.intervals && w.intervals.length > 0) {
    parts.push(`${w.intervals.length} intervals`)
  }
  if (w.durationMin != null) parts.push(`${w.durationMin} min`)
  // Distance shows in the trail when there is no tonnage
  if (w.distanceM != null && volume > 0) {
    parts.push(`${Math.round((w.distanceM / MILE) * 100) / 100} mi`)
  }
  return parts
}

/** The trail of a Log row: tonnage, else distance, else (recovery) minutes. */
function workoutTrail(w: Workout): string | undefined {
  if (w.kind === 'recovery') {
    return w.durationMin != null ? `${w.durationMin} min` : undefined
  }
  const { volume } = workoutVolume(w)
  if (volume > 0) return `${Math.round(volume).toLocaleString()} ${w.weightUnit}`
  if (w.distanceM != null) {
    return `${Math.round((w.distanceM / MILE) * 100) / 100} mi`
  }
  return undefined
}

/**
 * Habit-stack offer after a strength session: the cue is "workout just
 * finished" and this screen already knows which muscles it was for. Its
 * own sheet — it is shown alongside the strength save completing, not
 * nested inside another sheet's render.
 */
function CooldownOffer({
  muscles,
  onStart,
  onSkip,
}: {
  muscles: string[]
  onStart: (sections: IntervalSection[], title: string) => void
  onSkip: () => void
}) {
  const { open, dismiss, onExited } = useSheetDismiss()
  const r = generateRoutine({
    muscles,
    phase: 'post',
    minutes: suggestedMinutes(muscles, 'post'),
  })
  const label = muscles.slice(0, 3).join(', ')

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onSkip)}
      onExited={onExited}
      title="Cool down?"
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink-2">
          {label}
          {r && ` · ${routineMinutes(r)} min`}
        </p>
        <Button
          variant="primary"
          block
          onClick={() =>
            r && dismiss(() => onStart(routineSections(r), `Cool-down · ${label}`))
          }
        >
          Start cool-down
        </Button>
        <Button variant="ghost" block onClick={() => dismiss(onSkip)}>
          Not now
        </Button>
      </div>
    </Sheet>
  )
}

type Mode =
  | { m: 'list' }
  | { m: 'pick'; kind?: WorkoutKind }
  | {
      m: 'build'
      initial?: Template
      kind?: WorkoutKind
      returnTo?: 'recover'
      /** `initial` is a seed (a built-in routine about to be edited), not
       * a saved template — so there is nothing to delete yet. */
      fresh?: boolean
    }
  /** `past`: a session entered after the fact. It is not live (`isNew`
   * is false) and not saved yet either. */
  | { m: 'strength'; workout: Workout; isNew: boolean; past?: boolean }
  | { m: 'timer'; draft: TimerDraft }
  | { m: 'slots'; template: Template }
  | { m: 'feedback'; workout: Workout; past?: boolean }
  /** After a strength save: offer a cooldown for the muscles just trained. */
  | { m: 'cooldown'; muscles: string[] }
  /** Untimed recovery log, or editing any recovery session. `pastStart`
   * opens it on a recovery session that already happened. */
  | { m: 'quicklog'; workout?: Workout; pastStart?: string }
  /** Choosing what to log after the fact, and when it was. */
  | { m: 'past' }
  /** `draft`: `initial` is a coach proposal that was never saved, and
   * `cardId` is the card in the conversation it came from. */
  | { m: 'meso-setup'; initial?: Mesocycle; draft?: boolean; cardId?: string }
  /** The coach conversation; `seed` is sent as it opens. */
  | { m: 'coach'; seed?: string }

/** Which bottom-nav tab this instance is rendering (Recovery lives in its
 * own component). One Workouts instance persists across all four so live
 * sessions, drafts, and caches survive tab hops. */
export type WorkoutsTab = 'today' | 'history' | 'plan' | 'progress'

export function Workouts({
  api,
  tab,
  checkins,
  onSaveCheckin,
  strapLinked,
  demo = false,
}: {
  api: Api
  tab: WorkoutsTab
  checkins: Checkin[]
  onSaveCheckin: (patch: Partial<Checkin>) => void
  /** The public demo: its coach is the one built into the app. */
  demo?: boolean
  /** A wearable is connected (or waiting on a re-auth). Without one, every
   * strap-only surface — captured sessions, readiness, sleep — stays hidden. */
  strapLinked: boolean
}) {
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  /** The workout open in the Log's detail sheet. */
  const [detail, setDetail] = useState<Workout | null>(null)
  const [workouts, setWorkouts] = useState<Workout[]>(loadWorkoutCache)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [templates, setTemplates] = useState<Template[]>(loadTemplateCache)
  const [mesos, setMesos] = useState<Mesocycle[]>(loadMesoCache)
  const [customs, setCustoms] = useState<CustomExercise[]>(loadCustomExercises)
  const muscleLookup = useMemo(() => makeMuscleLookup(customs), [customs])
  // Registered during render, not in an effect: the editor and prescriptions
  // below read equipment through the module registry, so it must already be
  // current on the very render that adds or edits an exercise.
  useMemo(() => registerEquipmentOverrides(customs), [customs])
  const [pendingCount, setPendingCount] = useState(() => loadPending().length)
  const me = useMe()
  // The strap's measurement only counts while a strap is linked
  const whoopWeightLb = strapLinked ? me?.whoop.bodyWeightLb : undefined
  const [weights, setWeights] = useState<WeightEntry[]>(loadWeightCache)
  const unit = useUnitPref()
  // The local date the morning weigh-in was waved off on
  const [weighInDismissed, setWeighInDismissed] = useState<string | null>(
    weighInDismissedOn,
  )
  // A number the lifter typed always outranks the strap's measurement
  const bodyWeightLb = currentBodyWeight(weights, whoopWeightLb)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE)
  // Captured sessions are the strap's; the server keeps old ones after a
  // disconnect, so the gate is here rather than on the fetch.
  const strapSessions = strapLinked ? sessions : []
  const [mode, setMode] = useState<Mode>(() => {
    const timer = loadTimerDraft()
    if (timer) return { m: 'timer', draft: timer }
    const draft = loadDraft()
    if (draft) return { m: 'strength', workout: draft, isNew: true }
    return { m: 'list' }
  })

  // ---- the coach ----
  // The lift logged most often: the one worth a "how is it going" chip
  const topLift = useMemo(() => exercisesByFrequency(workouts)[0], [workouts])
  // Fetched here rather than in Today so the coach reads the same strap
  // numbers the home screen draws, whichever tab it is opened from.
  const strap = useStrapMetrics(api, strapLinked, tab)
  const dayPlan = useDayPlan()
  const coach = useCoach(
    api,
    // Built when a turn starts, so the snapshot is as fresh as the tap
    (): AgentContext => ({
      now: Date.now(),
      workouts,
      mesos,
      templates,
      customs,
      lookup: muscleLookup,
      checkins,
      bodyWeightLb,
      unit,
      strap: strapSummary(strap, Date.now()),
      notes: getNotes(),
      dayPlan: getDayPlan(),
    }),
    { saveCheckin: onSaveCheckin, setDayPlan, addNote },
  )
  // Shown on Home when a plan item could not be started; gone once there
  // is a plan again
  const [planNotice, setPlanNotice] = useState<string | null>(null)
  useEffect(() => {
    if (dayPlan) setPlanNotice(null)
  }, [dayPlan])

  async function refresh() {
    try {
      const [wRes, sRes, tRes, eRes, mRes, wtRes] = await Promise.all([
        api.get('/api/workouts?days=365'),
        api.get('/api/sessions?days=365'),
        api.get('/api/templates'),
        api.get('/api/exercises'),
        api.get('/api/mesos'),
        api.get('/api/weights'),
        // The shared profile (strap state, its body weight) rides along;
        // it never throws, so an offline run still lands in the catch below
        refreshMe(api),
      ])
      if (wRes.ok) {
        const body = await wRes.json()
        // Overlay the unsynced queue so a workout mid-flush can never vanish
        // from the timeline when the server list (which lacks it) comes back.
        const pending = loadPending()
        const merged = [
          ...pending,
          ...body.workouts.filter(
            (w: Workout) => !pending.some((p) => p.id === w.id),
          ),
        ].sort((a, b) => b.start.localeCompare(a.start))
        setWorkouts(merged)
        saveWorkoutCache(merged)
      }
      if (sRes.ok) setSessions((await sRes.json()).sessions)
      if (tRes.ok) {
        const body = await tRes.json()
        setTemplates(body.templates)
        saveTemplateCache(body.templates)
      }
      if (eRes.ok) {
        const body = await eRes.json()
        setCustoms(body.exercises)
        saveCustomExercises(body.exercises)
      }
      if (wtRes.ok) {
        const body = await wtRes.json()
        if (Array.isArray(body.weights)) {
          // A weigh-in mid-flush stays until the server list carries it
          const merged = mergeWeights(body.weights, loadPendingWeights())
          setWeights(merged)
          saveWeightCache(merged)
        }
      }
      if (mRes.ok) {
        const body = await mRes.json()
        if (Array.isArray(body.mesos)) {
          setMesos(body.mesos)
          saveMesoCache(body.mesos)
        }
      }
      setOffline(false)
    } catch {
      setOffline(true) // cached view stays up
    }
  }

  async function sync() {
    const result = await flushQueue(api)
    setPendingCount(result.remaining)
    await flushWeights(api)
    await refresh()
  }

  /** A weigh-in: local first, one entry per day, queued for the server. */
  function logWeight(lb: number) {
    const entry: WeightEntry = {
      date: localToday(),
      lb: Math.round(lb * 10) / 10,
    }
    setWeights((prev) => {
      const next = upsertWeight(prev, entry)
      saveWeightCache(next)
      return next
    })
    enqueueWeight(entry)
    void flushWeights(api)
  }

  useEffect(() => {
    sync()
    const onOnline = () => sync()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => {
    setVisibleCount(PAGE)
  }, [logFilter, tab])

  // Keep the session bus in sync so the dock knows when we're live. Every
  // flow here is a sheet over the tab, so the dock stays (under the scrim)
  // and takes over the moment a session is minimised.
  useEffect(() => {
    // Only a live session raises the dock: over an edit or a past session
    // a tab tap would park the sheet and lose what was typed.
    setInSession((mode.m === 'strength' && mode.isNew) || mode.m === 'timer')
    return () => setInSession(false)
  }, [mode])

  // Resume from the dock while already mounted: re-enter the draft —
  // unless the user is mid-way through planning a mesocycle, which a
  // mode swap would silently destroy.
  const modeRef = useRef(mode)
  modeRef.current = mode
  useEffect(() => {
    return onResume(() => {
      const cur = modeRef.current
      if (cur.m === 'meso-setup' || cur.m === 'coach') return
      // …or half-way through entering a past session
      if (cur.m === 'strength' && cur.past) return
      const timer = loadTimerDraft()
      if (timer) {
        setMode({ m: 'timer', draft: timer })
        return
      }
      const draft = loadDraft()
      if (draft) setMode({ m: 'strength', workout: draft, isNew: true })
    })
  }, [])

  // A dock tab tap over a live session sheet parks it (drafts stay in
  // storage, the dock shows the live bar) before the tab switches.
  useEffect(
    () =>
      onMinimise(() => {
        const cur = modeRef.current
        if ((cur.m === 'strength' && cur.isNew) || cur.m === 'timer') {
          setMode({ m: 'list' })
        }
      }),
    [],
  )

  interface FinishOptions {
    isNew?: boolean
    /** A warm-up timer saving from inside a strength session: leave the
     * strength draft alone and return to the ledger. */
    keepStrengthDraft?: boolean
    /** A record being written, not a live session ending: an edit, a
     * quick log, a past session. Whatever is live stays live. */
    logged?: boolean
  }

  /**
   * Strength sessions detour through the how-did-it-feel sheet before the
   * save lands; timer saves and edits go straight through.
   */
  function finish(raw: Workout, opts?: FinishOptions) {
    if (
      raw.kind === 'strength' &&
      opts?.isNew &&
      feedbackMuscles(raw, muscleLookup).length > 0
    ) {
      // The draft stays (crash-safety) but the session is over — keep the
      // lock-screen widget from re-advertising it while the sheet is up.
      setLockScreenSuppressed(true)
      stopLockScreen()
      setMode({ m: 'feedback', workout: raw })
      return
    }
    commitFinish(raw, opts)
  }

  /**
   * A session entered after the fact. It still gets the how-did-it-feel
   * sheet (those ratings steer the block), but it is a record, not a live
   * session ending: no draft is touched and no cooldown is offered.
   */
  function finishPast(raw: Workout) {
    const w = settlePast(
      raw,
      mesos.find((x) => x.id === raw.mesoId),
    )
    if (w.kind === 'strength' && feedbackMuscles(w, muscleLookup).length > 0) {
      setMode({ m: 'feedback', workout: w, past: true })
      return
    }
    commitFinish(w, { logged: true })
  }

  /** Open the right form for a past session, dated and pre-shaped. */
  function openPast(choice: PastChoice, startIso: string) {
    if (choice.kind === 'recovery') {
      setMode({ m: 'quicklog', pastStart: startIso })
      return
    }
    const w = pastWorkout(choice, startIso, {
      meso: activeMeso(mesos),
      templates,
      workouts,
      lookup: muscleLookup,
    })
    setMode(w ? { m: 'strength', workout: w, isNew: false, past: true } : { m: 'list' })
  }

  /** Back into the live strength draft, or the list if it's gone. */
  function reenterStrength() {
    const d = loadDraft()
    setMode(d ? { m: 'strength', workout: d, isNew: true } : { m: 'list' })
  }

  function commitFinish(raw: Workout, opts?: FinishOptions) {
    const w = finalizeWorkout(raw)
    enqueue(w)
    setPendingCount(loadPending().length)
    setWorkouts((prev) => {
      const merged = [w, ...prev.filter((x) => x.id !== w.id)].sort((a, b) =>
        b.start.localeCompare(a.start),
      )
      saveWorkoutCache(merged)
      return merged
    })
    if (opts?.logged) {
      setMode({ m: 'list' })
      void sync()
      return
    }
    saveTimerDraft(null)
    if (opts?.keepStrengthDraft) {
      // The warm-up is logged; the lift it was for is still live.
      reenterStrength()
      void sync()
      return
    }
    saveDraft(null)
    setLockScreenSuppressed(false) // drafts are gone; nothing to resurrect
    // Habit stacking: the cue for a cooldown is "workout finished", and
    // this is the one screen that knows which muscles it was for.
    const trained =
      raw.kind === 'strength' && opts?.isNew
        ? feedbackMuscles(raw, muscleLookup)
        : []
    if (
      trained.length > 0 &&
      generateRoutine({
        muscles: trained,
        phase: 'post',
        minutes: suggestedMinutes(trained, 'post'),
      })
    ) {
      setMode({ m: 'cooldown', muscles: trained })
    } else {
      setMode({ m: 'list' })
    }
    void sync()
  }

  /** Delete a saved workout; the editor's sheet closes itself on true. */
  async function remove(w: Workout): Promise<boolean> {
    try {
      const res = await api.send(
        'DELETE',
        `/api/workouts?id=${encodeURIComponent(w.id)}&start=${encodeURIComponent(w.start)}`,
      )
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      setWorkouts((prev) => {
        const next = prev.filter((x) => x.id !== w.id)
        saveWorkoutCache(next)
        return next
      })
      return true
    } catch {
      setError('Deleting needs a connection — try again when online.')
      return false
    }
  }

  function saveCustomExercise(
    name: string,
    muscle: string,
    equipment?: Equipment,
  ) {
    // Optimistic: usable immediately, server write is fire-and-forget (the
    // exercise also lives inside the workout record either way)
    const custom: CustomExercise = equipment
      ? { name, muscle, equipment }
      : { name, muscle }
    setCustoms((prev) => {
      const next = [
        ...prev.filter((c) => c.name.toLowerCase() !== name.toLowerCase()),
        custom,
      ]
      saveCustomExercises(next)
      return next
    })
    void api.send('POST', '/api/exercises', custom).catch(() => {})
  }

  /** Delete a template; resolves true once it is gone. */
  async function removeTemplate(t: Template): Promise<boolean> {
    try {
      const res = await api.send(
        'DELETE',
        `/api/templates?id=${encodeURIComponent(t.id)}`,
      )
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      setTemplates((prev) => {
        const next = prev.filter((x) => x.id !== t.id)
        saveTemplateCache(next)
        return next
      })
      const plan = getDayPlan()
      if (
        plan?.items.some(
          (i) =>
            (i.kind === 'template' || i.kind === 'user-routine') &&
            i.templateId === t.id,
        )
      ) {
        setDayPlan(null)
      }
      return true
    } catch {
      setError('Deleting templates needs a connection.')
      return false
    }
  }

  function upsertMeso(meso: Mesocycle) {
    // A plan built on a block that just ended would offer a session that
    // can no longer start; Home falls back to the engine's own card.
    if (meso.status !== 'active') {
      const plan = getDayPlan()
      if (plan?.items.some((i) => i.kind === 'block' && i.mesoId === meso.id)) {
        setDayPlan(null)
      }
    }
    // Optimistic — the card keeps working offline; refresh() reconciles.
    setMesos((prev) => {
      const next = [...prev.filter((m) => m.id !== meso.id), meso]
      saveMesoCache(next)
      return next
    })
    void api
      .send('POST', '/api/mesos', meso)
      .then((res) => {
        if (!res.ok) throw new Error(`API responded ${res.status}`)
      })
      .catch(() => setError('Syncing the mesocycle needs a connection.'))
  }

  /** A minimised live session's draft must not be silently clobbered. */
  async function confirmReplaceLive(): Promise<boolean> {
    if (!(loadDraft() || loadTimerDraft())) return true
    return confirm({ title: 'Discard the live session?', action: 'Discard' })
  }

  /**
   * Start the given microcycle day with this week's prescriptions. A day
   * plan from the coach may reshape it first (`trim`): the set counts come
   * from the same applyTrim that drew the plan card, so the session opens
   * as the card showed it.
   */
  async function startMesoDay(meso: Mesocycle, dayIndex: number, trim?: Trim) {
    const day = meso.days[dayIndex]
    if (!day) return
    if (!(await confirmReplaceLive())) return
    const now = Date.now()
    // Overdue mesos clamp to the deload week's (gentle) prescriptions
    const week = Math.min(mesoWeek(meso, now), meso.weeks - 1)

    if (dayKind(day) === 'cardio') {
      // Cardio days run the interval timer (or stopwatch), tagged to the
      // meso so day tracking counts them like any other session.
      saveDraft(null)
      const draft: TimerDraft = {
        kind: 'cardio',
        title: `${day.label} · wk ${week + 1}`,
        sections: day.sections ?? [],
        startEpoch: Date.now(),
        skipOffsetMs: 0,
        paused: false,
        pausedElapsedMs: 0,
        mesoId: meso.id,
        mesoDayIndex: dayIndex,
      }
      saveTimerDraft(draft)
      autoStartLockScreen()
      setMode({ m: 'timer', draft })
      return
    }

    const mesoWorkouts = workouts.filter((w) => w.mesoId === meso.id)
    const planned = applyTrim(
      plannedSets(meso, day, week, mesoWorkouts, muscleLookup, now).map((e) => ({
        name: e.name,
        sets: e.setCount,
      })),
      trim,
      muscleLookup,
    )
    const w = newWorkout('strength')
    w.mesoId = meso.id
    w.mesoDayIndex = dayIndex
    w.title = `${day.label} · wk ${week + 1}`
    w.exercises = planned.map((e) => ({
      name: e.name,
      sets: Array.from({ length: e.sets }, () => ({})),
    }))
    // Never on a deload week: its prescription is already the light one,
    // and "repeat last time" would be the block's hardest numbers
    if (trim) {
      w.coach = { holdLoad: trim.holdLoad === true && !isDeloadWeek(meso, week) }
    }
    setMode(beginStrength(w))
  }

  /** A live strength session with exactly these rows: what a day plan
   * showed is what opens, with no further set changes applied. */
  function startRows(
    title: string,
    rows: Array<{ name: string; sets: number }>,
    holdLoad = false,
  ) {
    const w = newWorkout('strength')
    w.title = title
    w.exercises = rows.map((r) => ({
      name: r.name,
      sets: Array.from({ length: r.sets }, () => ({})),
    }))
    w.coach = { holdLoad }
    setMode(beginStrength(w))
  }

  /** Start one item of the coach's day plan. Always from a tap. */
  async function startPlanItem(item: DayPlanItem) {
    const gone = () => {
      setPlanNotice(
        'That plan pointed at a block or template that is gone. Ask the coach to plan the day again.',
      )
      if (getDayPlan()?.items.some((i) => i.key === item.key)) setDayPlan(null)
    }
    if (item.kind === 'block') {
      const m = mesos.find((x) => x.id === item.mesoId && x.status === 'active')
      if (m) await startMesoDay(m, item.dayIndex, item.trim)
      else gone()
      return
    }
    if (item.kind === 'template') {
      const t = templates.find((x) => x.id === item.templateId)
      if (!t) return gone()
      // Slot templates pick their exercises first; that flow asks about a
      // live session itself
      if (item.session === 'strength' && hasSlots(t)) {
        setMode({ m: 'slots', template: t })
        return
      }
      if (!(await confirmReplaceLive())) return
      if (item.session === 'timer') {
        setMode(startTimer(t.kind, t.sections ?? [], t.name))
        return
      }
      startRows(
        t.name,
        applyTrim(
          (t.exercises ?? []).map((e) => ({ name: e.name, sets: e.setCount })),
          item.trim,
          muscleLookup,
        ),
        item.trim?.holdLoad === true,
      )
      return
    }
    if (!(await confirmReplaceLive())) return
    if (item.kind === 'custom') {
      startRows(item.title, item.exercises)
    } else if (item.kind === 'routine') {
      const r = resolveRoutine(item.routineId, templates)
      if (!r) return gone()
      setMode(startTimer('recovery', routineSections(r), r.name))
    } else if (item.kind === 'user-routine') {
      const t = templates.find((x) => x.id === item.templateId)
      if (!t) return gone()
      setMode(
        startTimer(
          'recovery',
          routineToSections(t.items ?? [], t.transitionSec),
          t.name,
        ),
      )
    } else {
      const r = generatedRoutine(
        item.muscles,
        item.kind === 'warmup' ? 'pre' : 'post',
        Date.now(),
      )
      if (!r) return gone()
      setMode(
        startTimer(
          'recovery',
          routineSections(r),
          generatedTitle(item.kind, item.muscles),
          item.kind === 'warmup' ? { modality: 'mobility' } : undefined,
        ),
      )
    }
  }

  /** Ending a block by hand: completed if it ran its course, else abandoned. */
  function endBlock(old: Mesocycle) {
    const now = Date.now()
    const ran =
      mesoOverdue(old, now) ||
      isDeloadWeek(old, Math.min(mesoWeek(old, now), old.weeks - 1))
    upsertMeso({ ...old, status: ran ? 'completed' : 'abandoned' })
  }

  /** Save a block the coach proposed. Only one block is ever active, so
   * the current one ends first, and only once the athlete has agreed. */
  async function saveCoachBlock(cardId: string, proposal: BlockProposal) {
    const old = activeMeso(mesos)
    if (old) {
      const ok = await confirm({
        title: `End ${old.name}?`,
        body: `${proposal.name} starts today in its place.`,
        action: 'Start new block',
        tone: 'brand',
      })
      if (!ok) return
      endBlock(old)
    }
    const meso = mesoFromProposal(proposal, Date.now())
    upsertMeso(meso)
    coach.markBlockSaved(cardId, meso.id)
  }

  /** What the athlete can tap instead of typing, for where they are now. */
  function coachChips(): CoachChip[] {
    const meso = activeMeso(mesos)
    const lift = topLift
    return [
      // With a plan in place the first chip just opens the conversation
      dayPlan
        ? { label: 'Change the plan', say: '' }
        : { label: 'Plan my day', say: 'Plan my day.' },
      { label: 'Short on time', say: 'I only have 30 minutes today.' },
      { label: 'Feeling beat up', say: 'I am beat up today. Go easy.' },
      ...(!meso || mesoOverdue(meso, Date.now())
        ? [{ label: 'Build a block', say: 'Build me a training block.' }]
        : []),
      ...(lift
        ? [
            {
              label: `How\u2019s my ${lift.toLowerCase()}?`,
              say: `How is my ${lift.toLowerCase()} going?`,
            },
          ]
        : []),
    ]
  }

  /**
   * Set up a fresh live strength session and hand back the mode that
   * shows it. The draft swap and the lock-screen autoplay run here, on
   * the click's call stack (autoplay needs the gesture); the caller flips
   * the mode — at once, or after a sheet has dropped. The caller has
   * already cleared any live draft with confirmReplaceLive.
   */
  function beginStrength(w: Workout): Mode {
    saveTimerDraft(null)
    autoStartLockScreen()
    return { m: 'strength', workout: w, isNew: true }
  }

  /** Template entries -> session exercises, with coach set-deltas applied.
   * Recommendations are computed here, at start time, so the 7-day volume
   * window can't go stale in a long-lived tab. */
  function buildExercises(entries: Array<{ name: string; setCount: number }>) {
    const recs = recommendations(workouts, muscleLookup)
    return applyRecommendations(entries, recs, muscleLookup).map((e) => ({
      name: e.name,
      sets: Array.from({ length: e.setCount }, () => ({})),
    }))
  }

  function startStrength(template?: Template): Mode {
    if (template && hasSlots(template)) return { m: 'slots', template }
    const w = newWorkout('strength')
    if (template) {
      w.title = template.name
      w.exercises = buildExercises(
        (template.exercises ?? []).map((e) => ({
          name: e.name,
          setCount: e.setCount,
        })),
      )
    }
    return beginStrength(w)
  }

  function startTimer(
    kind: WorkoutKind,
    sections: IntervalSection[],
    title?: string,
    extra?: Pick<TimerDraft, 'modality' | 'resumeStrength'>,
  ): Mode {
    const draft: TimerDraft = {
      kind,
      title,
      sections,
      startEpoch: Date.now(),
      skipOffsetMs: 0,
      paused: false,
      pausedElapsedMs: 0,
      ...extra,
    }
    saveTimerDraft(draft)
    autoStartLockScreen()
    return { m: 'timer', draft }
  }

  /** Dynamic warm-up for the muscles a strength session is about to train.
   * The strength draft stays in storage; the ledger returns afterwards. */
  function startWarmUp(muscles: string[]) {
    const r = generateRoutine({
      muscles,
      phase: 'pre',
      minutes: suggestedMinutes(muscles, 'pre'),
    })
    if (!r) return
    setMode(
      startTimer(
        'recovery',
        routineSections(r),
        `Warm-up · ${muscles.slice(0, 3).join(', ')}`,
        { modality: 'mobility', resumeStrength: true },
      ),
    )
  }

  /** Most recent recovery session of a modality — QuickLog pre-fills from it. */
  function lastRecoveryOf(m: Modality): Workout | undefined {
    return workouts.find((w) => w.kind === 'recovery' && w.modality === m)
  }

  const toList = () => setMode({ m: 'list' })

  function sessionSheet(m: Extract<Mode, { m: 'strength' }>) {
    const originalStart = m.workout.start
    const past = m.past === true
    // A past session sees the log as it stood when it happened: targets
    // and "last time" come from what came before it, not from sessions
    // logged since.
    const known = past
      ? workouts.filter((w) => w.start < originalStart)
      : workouts
    // Meso sessions carry per-exercise targets anchored to this meso's
    // logged actuals. The session re-runs this as its exercise list
    // changes, so a lift swapped in mid-session is prescribed for too.
    const meso = m.workout.mesoId
      ? mesos.find((x) => x.id === m.workout.mesoId)
      : undefined
    // A past block day says what its date means: which week it counts
    // for, or that it has left the block and will be saved on its own.
    let whenHelp: string | undefined
    if (past && meso) {
      const startMs = new Date(originalStart).getTime()
      whenHelp =
        blockDaysAt(meso, startMs).length > 0
          ? `Counts for week ${mesoWeek(meso, startMs) + 1} of ${meso.name}`
          : `Outside ${meso.name}. It will be saved on its own.`
    }
    let prescribe: ComponentProps<typeof SessionEditor>['prescribe']
    let mesoSetCount: ComponentProps<typeof SessionEditor>['mesoSetCount']
    // Targets belong to a date inside the block; outside it there are none
    const inBlock =
      meso != null &&
      (!past || blockDaysAt(meso, new Date(originalStart).getTime()).length > 0)
    if (meso && inBlock && (m.isNew || past)) {
      const at = past ? new Date(originalStart).getTime() : Date.now()
      const week = Math.min(mesoWeek(meso, at), meso.weeks - 1)
      const dayIdx = m.workout.mesoDayIndex
      const mesoWorkouts = known.filter(
        (w) => w.mesoId === meso.id && w.id !== m.workout.id,
      )
      // A held day prescribes nothing: the rows fall back to this slot's
      // last session, which is exactly "repeat last time".
      if (!m.workout.coach?.holdLoad)
        prescribe = (names, setsByName) =>
          prescribeExercises(
            meso,
            names,
            week,
            mesoWorkouts,
            known,
            setsByName,
            muscleLookup,
            bodyWeightLb,
            dayIdx,
          )
      mesoSetCount = (name, usedByMuscle) =>
        plannedSetsForExercise(
          meso,
          name,
          week,
          mesoWorkouts,
          known,
          muscleLookup(name),
          muscleLookup,
          usedByMuscle,
        )
    }
    return (
      <SessionEditor
        key={m.workout.id}
        initial={m.workout}
        isNew={m.isNew}
        past={past}
        onMoved={
          past
            ? (moved) => {
                // The date drives the plan: lay the session out again for
                // the new one and remember that layout for the next move
                const next = movePast(moved, m.workout, {
                  meso,
                  templates,
                  workouts,
                  lookup: muscleLookup,
                })
                setMode({ ...m, workout: next.plan })
                return next.workout
              }
            : undefined
        }
        whenHelp={whenHelp}
        history={known}
        customs={customs}
        lookup={muscleLookup}
        bodyWeightLb={bodyWeightLb}
        prescribe={prescribe}
        mesoSetCount={mesoSetCount}
        onSaveCustom={saveCustomExercise}
        onFinish={(w) =>
          past
            ? finishPast(w)
            : finish(
                // An edited start time is a key move — tell the API which
                // old row to drop so the workout doesn't duplicate.
                !m.isNew && w.start !== originalStart
                  ? { ...w, previousStart: originalStart }
                  : w,
                { isNew: m.isNew, logged: !m.isNew },
              )
        }
        onClose={toList}
        onDiscard={toList}
        onDelete={m.isNew || past ? undefined : remove}
        onWarmUp={m.isNew ? startWarmUp : undefined}
        prsToday={todayCheckin(checkins)?.prs}
        onPrs={m.isNew ? (n) => onSaveCheckin({ prs: n }) : undefined}
      />
    )
  }

  // ---- tabbed content, with the session sheets over it ----

  let content: ReactNode
  if (tab === 'today') {
    const today = localToday()
    const lastWeight = sortWeights(weights)[0]
    // Before noon, with nothing logged yet, Today opens on the scale.
    content = weighInDue(weights, weighInDismissed) ? (
      <WeighIn
        // The cache can be empty until the server list lands; remounting
        // on the newest entry keeps the prefill in step with it
        key={lastWeight?.date ?? 'first'}
        last={lastWeight}
        unit={unit}
        onSave={logWeight}
        onDismiss={() => {
          dismissWeighIn(today)
          setWeighInDismissed(today)
        }}
      />
    ) : (
      <>
        {planNotice && <Banner tone="caution">{planNotice}</Banner>}
        <Today
          strap={strap}
          dayPlan={dayPlan}
          coachChips={coachChips()}
          coachBusy={coach.busy}
          onCoach={(seed) => {
            setPlanNotice(null)
            setMode({ m: 'coach', seed })
          }}
          onStartPlanItem={startPlanItem}
          workouts={workouts}
          meso={activeMeso(mesos)}
          lookup={muscleLookup}
          bodyWeightLb={bodyWeightLb}
          checkins={checkins}
          onSaveCheckin={onSaveCheckin}
          strapLinked={strapLinked}
          templates={templates}
          onStartMesoDay={(i) => {
            const m = activeMeso(mesos)
            if (m) startMesoDay(m, i)
          }}
          onStartWorkout={() => setMode({ m: 'pick' })}
          onPlan={() => setMode({ m: 'meso-setup' })}
          onEndMeso={() => {
            const m = activeMeso(mesos)
            if (m) upsertMeso({ ...m, status: 'completed' })
          }}
          onRecover={() => setMode({ m: 'pick', kind: 'recovery' })}
          onQuickLog={() => setMode({ m: 'quicklog' })}
          onStartRoutine={(r) =>
            setMode(startTimer('recovery', routineSections(r), r.name))
          }
        />
      </>
    )
  } else if (tab === 'progress') {
    content = (
      <Suspense
        fallback={
          <p className="py-12 text-center text-body text-ink-3">Loading</p>
        }
      >
        <Trends
          api={api}
          workouts={workouts}
          sessions={strapSessions}
          lookup={muscleLookup}
          weights={weights}
          checkins={checkins}
          onLogWeight={logWeight}
          strapLinked={strapLinked}
        />
      </Suspense>
    )
  } else if (tab === 'plan') {
    content = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-title-lg text-ink">Plan</h1>
          {activeMeso(mesos) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setMode({ m: 'coach', seed: 'Build me my next training block.' })
              }
            >
              Next block with coach
            </Button>
          )}
        </div>
        <MesoCard
          onCoach={() =>
            setMode({ m: 'coach', seed: 'Build me a training block.' })
          }
          meso={activeMeso(mesos)}
          workouts={workouts}
          onStartDay={(i) => {
            const m = activeMeso(mesos)
            if (m) startMesoDay(m, i)
          }}
          onEnd={(status) => {
            const m = activeMeso(mesos)
            if (m) upsertMeso({ ...m, status })
          }}
          onEdit={() => {
            const m = activeMeso(mesos)
            if (m) setMode({ m: 'meso-setup', initial: m })
          }}
          onPlan={() => setMode({ m: 'meso-setup' })}
        />
        {error && <Banner tone="error">{error}</Banner>}
        <Manage
          api={api}
          templates={templates}
          customs={customs}
          workouts={workouts}
          onNewTemplate={() => setMode({ m: 'build' })}
          onEditTemplate={(t) => setMode({ m: 'build', initial: t })}
          onEditBuiltinRoutine={(r) =>
            setMode({ m: 'build', initial: routineAsTemplate(r), fresh: true })
          }
          onCustomsChange={(next) => {
            setCustoms(next)
            saveCustomExercises(next)
          }}
          onTemplatesChange={(next) => {
            setTemplates(next)
            saveTemplateCache(next)
          }}
          onWorkoutsChange={(next) => {
            setWorkouts(next)
            saveWorkoutCache(next)
          }}
        />
      </div>
    )
  } else {
    // tab === 'history'
    // Captured sessions come from the strap: without one the chip goes,
    // and a filter left on it reads as All.
    const filter: LogFilter =
      logFilter === 'captured' && !strapLinked ? 'all' : logFilter
    const chips = strapLinked
      ? LOG_CHIPS
      : LOG_CHIPS.filter((c) => c.value !== 'captured')
    const captured = filter === 'captured'
    const shown =
      filter === 'all' || captured
        ? workouts
        : workouts.filter((w) => w.kind === filter)
    const visible = shown.slice(0, visibleCount)

    // Calendar weeks, Monday first, newest week on top.
    const thisMonday = mondayOf(Date.now())
    const lastMonday = shiftDay(thisMonday, -7)
    const sections: Array<{ monday: string; items: Workout[] }> = []
    for (const w of visible) {
      const monday = mondayOf(new Date(w.start).getTime())
      const last = sections.at(-1)
      if (last && last.monday === monday) last.items.push(w)
      else sections.push({ monday, items: [w] })
    }

    const sortedSessions = captured
      ? strapSessions.slice().sort((a, b) => b.start.localeCompare(a.start))
      : []
    const visibleSessions = sortedSessions.slice(0, visibleCount)

    content = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-title-lg text-ink">Log</h1>
          <div className="flex items-center gap-1">
            <Button variant="quiet" size="sm" onClick={() => setMode({ m: 'past' })}>
              Add past session
            </Button>
            <IconButton
              label="New workout"
              onClick={() => setMode({ m: 'pick' })}
            >
              <IconPlus />
            </IconButton>
          </div>
        </div>
        <Chips
          options={chips}
          value={filter}
          onChange={setLogFilter}
          ariaLabel="Log"
        />

        {offline && (
          <Banner tone="info">
            {pendingCount > 0
              ? `Offline. ${pendingCount} workouts will sync.`
              : 'Offline.'}
          </Banner>
        )}
        {!offline && pendingCount > 0 && (
          <Banner tone="info">{pendingCount} workouts will sync.</Banner>
        )}
        {error && <Banner tone="error">{error}</Banner>}

        {!captured && workouts.length === 0 && (
          <EmptyState title="No workouts yet" caption="Start one from Today." />
        )}
        {!captured && workouts.length > 0 && shown.length === 0 && (
          <EmptyState title="Nothing logged" />
        )}

        {!captured &&
          sections.map(({ monday, items }) => {
            const minutes = items
              .map(workoutMinutes)
              .filter((m): m is number => m != null)
            const total = minutes.reduce((a, b) => a + b, 0)
            return (
              <section key={monday} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h2 className="text-title-sm text-ink">
                    {monday === thisMonday
                      ? 'This week'
                      : monday === lastMonday
                        ? 'Last week'
                        : fmtDay(monday)}
                  </h2>
                  <span className="text-caption text-ink-3">
                    {items.length} {items.length === 1 ? 'session' : 'sessions'}
                    {minutes.length > 0 && ` · ${total} min`}
                  </span>
                </div>
                <List>
                  {items.map((w) => (
                    <ListItem
                      key={w.id}
                      lead={KIND_LEAD[w.kind].icon}
                      leadTone={KIND_LEAD[w.kind].tone}
                      title={w.title || KIND_LABEL[w.kind]}
                      sub={[
                        new Date(w.start).toLocaleDateString(undefined, {
                          weekday: 'short',
                        }),
                        ...workoutMeta(w),
                      ].join(' · ')}
                      trail={workoutTrail(w)}
                      chevron
                      onClick={() => setDetail(w)}
                    />
                  ))}
                </List>
              </section>
            )
          })}
        {!captured && shown.length > PAGE && (
          <p className="text-center text-caption text-ink-3">
            Showing {visible.length} of {shown.length}
          </p>
        )}
        {!captured && visibleCount < shown.length && (
          <Button
            variant="quiet"
            block
            onClick={() => setVisibleCount((n) => n + PAGE)}
          >
            Show more
          </Button>
        )}

        {captured && strapSessions.length === 0 && (
          <p className="text-caption text-ink-3">Nothing captured yet.</p>
        )}
        {captured && visibleSessions.length > 0 && (
          <List>
            {visibleSessions.map((s) => {
              const sport = s.sport ?? 'Activity'
              const lifting = sport === 'weightlifting'
              const parts = [fmtDateTime(s.start)]
              if (s.strain != null) {
                parts.push(`strain ${Math.round(s.strain * 10) / 10}`)
              }
              if (s.avgHr != null) parts.push(`${Math.round(s.avgHr)} bpm avg`)
              if (s.maxHr != null) parts.push(`${Math.round(s.maxHr)} max`)
              if (s.distanceM != null) {
                parts.push(`${Math.round((s.distanceM / MILE) * 100) / 100} mi`)
              }
              return (
                <ListItem
                  key={s.sk}
                  lead={lifting ? <IconStrength /> : <IconRun />}
                  leadTone={lifting ? 'brand' : 'rest'}
                  title={sport.charAt(0).toUpperCase() + sport.slice(1)}
                  sub={parts.join(' · ')}
                />
              )
            })}
          </List>
        )}
        {captured && sortedSessions.length > 0 && (
          <p className="text-center text-caption text-ink-3">
            Showing {visibleSessions.length} of {sortedSessions.length}
          </p>
        )}
        {captured && visibleCount < sortedSessions.length && (
          <Button
            variant="quiet"
            block
            onClick={() => setVisibleCount((n) => n + PAGE)}
          >
            Show more
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      {content}

      {detail && (
        <WorkoutDetail
          key={detail.id}
          workout={detail}
          history={workouts}
          mesos={mesos}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setDetail(null)
            setMode(
              detail.kind === 'recovery'
                ? { m: 'quicklog', workout: detail }
                : { m: 'strength', workout: detail, isNew: false },
            )
          }}
          onRepeat={async () => {
            setDetail(null)
            // Guards a live draft like every other session start.
            if (!(await confirmReplaceLive())) return
            if (detail.kind === 'recovery') {
              // A recovery repeat re-runs the same routine in the timer.
              setMode(startTimer('recovery', detail.intervals ?? [], detail.title))
              return
            }
            setMode(
              beginStrength({
                ...detail,
                id: crypto.randomUUID(),
                start: new Date().toISOString(),
                end: undefined,
                updatedAt: undefined,
                // Ratings and meso membership belong to the session
                // they came from — a repeat is a plain ad-hoc workout.
                feedback: undefined,
                mesoId: undefined,
                mesoDayIndex: undefined,
                exercises: detail.exercises.map((e) => ({
                  ...e,
                  sets: e.sets.map((s) => ({ ...s, done: false })),
                })),
              }),
            )
          }}
          onDelete={remove}
        />
      )}

      {mode.m === 'strength' && sessionSheet(mode)}

      {mode.m === 'timer' && (
        <IntervalSession
          key={mode.draft.startEpoch}
          initial={mode.draft}
          sessions={strapSessions}
          onSave={(w) =>
            finish(w, { keepStrengthDraft: mode.draft.resumeStrength === true })
          }
          onCancel={() =>
            mode.draft.resumeStrength === true ? reenterStrength() : toList()
          }
          onMinimize={toList}
        />
      )}

      {mode.m === 'feedback' && (
        <FeedbackModal
          muscles={feedbackMuscles(mode.workout, muscleLookup)}
          onSubmit={(fb, sessionRpe) =>
            commitFinish(
              { ...mode.workout, feedback: fb, sessionRpe },
              mode.past ? { logged: true } : { isNew: true },
            )
          }
          onSkip={() =>
            commitFinish(mode.workout, mode.past ? { logged: true } : { isNew: true })
          }
        />
      )}

      {mode.m === 'cooldown' && (
        <CooldownOffer
          muscles={mode.muscles}
          onStart={(sections, title) => setMode(startTimer('recovery', sections, title))}
          onSkip={toList}
        />
      )}

      {mode.m === 'quicklog' && (
        <QuickLog
          key={mode.workout?.id ?? mode.pastStart ?? 'new'}
          initial={mode.workout}
          pastStart={mode.pastStart}
          lastOf={lastRecoveryOf}
          onSave={(w) =>
            finish(
              mode.workout && w.start !== mode.workout.start
                ? { ...w, previousStart: mode.workout.start }
                : w,
              { logged: true },
            )
          }
          onCancel={toList}
          onDelete={mode.workout ? remove : undefined}
        />
      )}

      {mode.m === 'past' && (
        <PastSession
          meso={activeMeso(mesos)}
          templates={templates}
          onPick={openPast}
          onCancel={toList}
        />
      )}

      {mode.m === 'pick' && (
        <StartPicker
          templates={templates}
          initialKind={mode.kind ?? null}
          onStrength={startStrength}
          onTimer={startTimer}
          onQuickLog={() => setMode({ m: 'quicklog' })}
          onPast={() => setMode({ m: 'past' })}
          onNewRoutine={() =>
            setMode({ m: 'build', kind: 'recovery', returnTo: 'recover' })
          }
          confirmStart={confirmReplaceLive}
          onEnter={setMode}
          onDeleteTemplate={removeTemplate}
          onCancel={toList}
        />
      )}

      {mode.m === 'slots' && (
        <SlotFill
          key={mode.template.id}
          template={mode.template}
          customs={customs}
          lookup={muscleLookup}
          history={workouts}
          onStart={async (entries) => {
            if (!(await confirmReplaceLive())) return null
            // A free-typed pick inherits its slot's muscle group, otherwise
            // feedback and progression would never see the exercise.
            const slotEntries = mode.template.exercises ?? []
            entries.forEach((e, i) => {
              const muscle = slotEntries[i]?.muscle
              if (muscle && muscleLookup(e.name) === undefined) {
                saveCustomExercise(e.name, muscle)
              }
            })
            const w = newWorkout('strength')
            w.title = mode.template.name
            w.exercises = buildExercises(entries)
            // The draft swap and lock-screen autoplay run on the click;
            // the mode flips once the sheet has dropped.
            const next = beginStrength(w)
            return () => setMode(next)
          }}
          onCancel={() => setMode({ m: 'pick' })}
        />
      )}

      {mode.m === 'meso-setup' && (
        <MesoSetup
          key={mode.initial?.id ?? 'new'}
          templates={templates}
          customs={customs}
          lookup={muscleLookup}
          history={workouts}
          initial={mode.initial}
          draft={mode.draft}
          confirmSave={
            mode.draft
              ? async (m) => {
                  const old = activeMeso(mesos)
                  return (
                    !old ||
                    old.id === m.id ||
                    confirm({
                      title: `End ${old.name}?`,
                      body: `${m.name} starts today in its place.`,
                      action: 'Start new block',
                      tone: 'brand',
                    })
                  )
                }
              : undefined
          }
          onSave={(m) => {
            // A coach draft replaces whatever block is running
            const old = activeMeso(mesos)
            if (mode.draft && old && old.id !== m.id) endBlock(old)
            if (mode.cardId) coach.markBlockSaved(mode.cardId, m.id)
            // Slot-derived rows carry a muscle — register free-typed names
            // so feedback/volume/prescriptions can resolve them (the same
            // convention SlotFill established).
            for (const day of m.days) {
              for (const e of day.exercises) {
                if (e.muscle && muscleLookup(e.name) === undefined) {
                  saveCustomExercise(e.name, e.muscle)
                }
              }
            }
            upsertMeso(m)
            setMode({ m: 'list' })
          }}
          onCancel={toList}
        />
      )}

      {mode.m === 'coach' && (
        <CoachSheet
          coach={coach}
          seed={mode.seed}
          demo={demo}
          prompt={coachLine(workouts, dayPlan, localToday())}
          chips={coachChips()}
          workouts={workouts}
          activeBlockName={activeMeso(mesos)?.name}
          // The sheet has already dropped when this runs. Leave coach mode
          // first: a start that is declined or cannot run would otherwise
          // strand the app on a closed sheet.
          onStartItem={(item) => {
            toList()
            void startPlanItem(item)
          }}
          onSaveBlock={saveCoachBlock}
          onCustomizeBlock={(cardId, p) =>
            setMode({
              m: 'meso-setup',
              initial: mesoFromProposal(p, Date.now()),
              draft: true,
              cardId,
            })
          }
          onClose={toList}
        />
      )}

      {mode.m === 'build' && (
        <TemplateBuilder
          key={mode.initial?.id ?? 'new'}
          api={api}
          customs={customs}
          initial={mode.initial}
          initialKind={mode.kind}
          onSaveCustom={saveCustomExercise}
          onSaved={(t) => {
            setTemplates((prev) => {
              const next = [...prev.filter((x) => x.id !== t.id), t]
              saveTemplateCache(next)
              return next
            })
            setMode(
              mode.returnTo === 'recover'
                ? { m: 'pick', kind: 'recovery' }
                : { m: 'list' },
            )
          }}
          onDelete={mode.fresh ? undefined : removeTemplate}
          onCancel={() =>
            setMode(
              mode.returnTo === 'recover'
                ? { m: 'pick', kind: 'recovery' }
                : { m: 'list' },
            )
          }
        />
      )}
    </>
  )
}
