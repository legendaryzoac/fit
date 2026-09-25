import { useMemo } from 'react'
import { epley } from '../lib/analytics'
import { mesoWeek, type Mesocycle } from '../lib/mesocycle'
import { fmtSec, totalSec } from '../lib/templates'
import {
  workoutVolume,
  type DifficultyRating,
  type Workout,
  type WorkoutExercise,
  type WorkoutKind,
  type WorkoutSet,
} from '../lib/workouts'
import { Button } from './cadence/Button'
import { List, ListItem } from './cadence/ListItem'
import { StatusPill, type StatusTone } from './cadence/StatusPill'
import { confirm } from '../lib/confirm'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'

const MILE = 1609.34
const YD = 0.9144

const KIND_LABEL: Record<WorkoutKind, string> = {
  strength: 'Strength',
  speed: 'Speed',
  cardio: 'Cardio',
}

const KIND_TONE: Record<WorkoutKind, StatusTone> = {
  strength: 'good',
  speed: 'effort',
  cardio: 'rest',
}

const FELT: Record<DifficultyRating, string> = {
  easy: 'Too easy',
  right: 'Just right',
  hard: 'Too hard',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** Minutes logged, or the clock span when the workout has an end. */
function minutesOf(w: Workout): number | null {
  if (w.durationMin != null) return w.durationMin
  if (!w.end) return null
  const ms = new Date(w.end).getTime() - new Date(w.start).getTime()
  return ms > 0 ? Math.round(ms / 60_000) : null
}

/** "185 × 8" for a strength set, "40 yd 5.1 s" for a speed rep. */
function setSummary(kind: WorkoutKind, s: WorkoutSet): string {
  if (kind === 'speed') {
    const parts: string[] = []
    if (s.distanceM != null) parts.push(`${Math.round(s.distanceM / YD)} yd`)
    if (s.durationSec != null) parts.push(`${s.durationSec} s`)
    return parts.length > 0 ? parts.join(' ') : '—'
  }
  if (s.weight == null && s.reps == null) return '—'
  return `${s.weight ?? '—'} × ${s.reps ?? '—'}`
}

/** Best Epley e1RM over an exercise's sets; 0 when nothing was weighted. */
function bestE1rm(e: WorkoutExercise): number {
  let best = 0
  for (const s of e.sets) {
    if (s.weight == null || s.reps == null || s.reps < 1) continue
    best = Math.max(best, epley(s.weight, s.reps))
  }
  return best
}

function Well({
  label,
  value,
  unit,
}: {
  label: string
  value: string
  unit?: string
}) {
  return (
    <div className="rounded-md bg-surface-2 p-3.5">
      <p className="text-eyebrow text-ink-2">{label}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-1">
        <span className="text-numeric-lg text-ink">{value}</span>
        {unit && (
          <span className="text-caption font-semibold text-ink-2">{unit}</span>
        )}
      </p>
    </div>
  )
}

/**
 * A logged workout, read-only: the stats, the exercises with a PR pill
 * where this session holds the lift's best e1RM, and the three actions.
 * Every action drops the sheet first and runs once the exit has finished.
 */
export function WorkoutDetail({
  workout: w,
  history,
  mesos,
  onEdit,
  onRepeat,
  onDelete,
  onClose,
}: {
  workout: Workout
  history: Workout[]
  mesos: Mesocycle[]
  onEdit: () => void
  onRepeat: () => void
  /** Resolves true once the workout is gone. */
  onDelete: (w: Workout) => Promise<boolean>
  onClose: () => void
}) {
  const { open, dismiss, onExited } = useSheetDismiss()

  const { sets, volume } = workoutVolume(w)
  const minutes = minutesOf(w)
  const meso = w.mesoId ? mesos.find((m) => m.id === w.mesoId) : undefined
  const week = meso
    ? Math.min(mesoWeek(meso, new Date(w.start).getTime()), meso.weeks - 1) + 1
    : null

  // Best e1RM per lift across everything logged; the sheet's workout is
  // part of that history, so a tie is this session's record.
  const records = useMemo(() => {
    const best = new Map<string, number>()
    for (const past of history) {
      if (past.kind !== 'strength') continue
      for (const e of past.exercises) {
        const key = e.name.toLowerCase()
        best.set(key, Math.max(best.get(key) ?? 0, bestE1rm(e)))
      }
    }
    return best
  }, [history])

  const subParts = [fmtDate(w.start)]
  if (minutes != null) subParts.push(`${minutes} min`)
  if (meso && week != null) subParts.push(`Week ${week} of ${meso.weeks}`)

  // Timer sessions: the plan they ran and what they covered.
  const timerRows: Array<{ title: string; sub?: string; trail: string }> = []
  if (w.intervals && w.intervals.length > 0) {
    timerRows.push({
      title: 'Intervals',
      sub: `${w.intervals.length} sections`,
      trail: fmtSec(totalSec(w.intervals)),
    })
  }
  if (w.durationMin != null) {
    timerRows.push({ title: 'Duration', trail: `${w.durationMin} min` })
  }
  if (w.distanceM != null) {
    timerRows.push({
      title: 'Distance',
      trail: `${Math.round((w.distanceM / MILE) * 100) / 100} mi`,
    })
  }

  async function remove() {
    if (!(await confirm({ title: 'Delete this workout?', action: 'Delete' }))) {
      return
    }
    void onDelete(w).then((ok) => {
      if (ok) dismiss(onClose)
    })
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onClose)}
      onExited={onExited}
      title={w.title || KIND_LABEL[w.kind]}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-body text-ink-2">{subParts.join(' · ')}</p>
          <StatusPill tone={KIND_TONE[w.kind]}>{KIND_LABEL[w.kind]}</StatusPill>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Well
            label="Volume"
            value={volume > 0 ? Math.round(volume).toLocaleString() : '—'}
            unit={volume > 0 ? w.weightUnit : undefined}
          />
          <Well label="Sets" value={sets > 0 ? String(sets) : '—'} />
          <Well
            label="Felt"
            value={w.feedback?.overall ? FELT[w.feedback.overall] : '—'}
          />
        </div>

        {w.exercises.length > 0 && (
          <List>
            {w.exercises.map((e, i) => {
              const mine = w.kind === 'strength' ? bestE1rm(e) : 0
              const pr =
                mine > 0 && mine >= (records.get(e.name.toLowerCase()) ?? 0)
              const rpe = e.sets.reduce<number | undefined>(
                (best, s) =>
                  s.rpe != null && (best === undefined || s.rpe > best)
                    ? s.rpe
                    : best,
                undefined,
              )
              const unit = w.kind === 'speed' ? 'reps' : 'sets'
              return (
                <ListItem
                  key={i}
                  title={
                    pr ? (
                      <span className="inline-flex items-center gap-2">
                        {e.name}
                        <StatusPill tone="effort">PR</StatusPill>
                      </span>
                    ) : (
                      e.name
                    )
                  }
                  sub={`${e.sets.length} ${unit} · ${e.sets
                    .map((s) => setSummary(w.kind, s))
                    .join(', ')}`}
                  trail={rpe != null ? `@ ${rpe}` : undefined}
                />
              )
            })}
          </List>
        )}

        {timerRows.length > 0 && (
          <List>
            {timerRows.map((r) => (
              <ListItem key={r.title} title={r.title} sub={r.sub} trail={r.trail} />
            ))}
          </List>
        )}

        {w.notes && <p className="text-caption text-ink-3">{w.notes}</p>}

        <div className="flex items-center gap-2">
          <Button
            variant="tonal"
            className="flex-1"
            onClick={() => dismiss(onEdit)}
          >
            Edit
          </Button>
          {w.kind === 'strength' && (
            <Button variant="ghost" onClick={() => dismiss(onRepeat)}>
              Repeat
            </Button>
          )}
          <Button variant="ghost-danger" onClick={remove}>
            Delete
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
