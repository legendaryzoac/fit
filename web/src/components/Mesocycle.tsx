import { useMemo, useState } from 'react'
import {
  EXERCISES,
  MUSCLE_GROUPS,
  type CustomExercise,
} from '../lib/exercises'
import {
  doneDayIndexes,
  isDeloadWeek,
  mesoOverdue,
  mesoWeek,
  nextDayIndex,
  type MesoExercise,
  type Mesocycle,
} from '../lib/mesocycle'
import type { Template } from '../lib/templates'
import type { Workout } from '../lib/workouts'
import { buttonClass, inputClass, NumberField, XIcon } from './ui'

const FOCUS_CHOICES = MUSCLE_GROUPS.filter(
  (m) => m !== 'other' && m !== 'full body',
)

/**
 * Card shown above the workout list while a mesocycle is active (or a slim
 * planner entry when none is). Deliberately additive — ad-hoc training
 * stays exactly as it was.
 */
export function MesoCard({
  meso,
  workouts,
  onStartDay,
  onEnd,
  onPlan,
}: {
  meso?: Mesocycle
  workouts: Workout[]
  onStartDay: (dayIndex: number) => void
  onEnd: (status: 'completed' | 'abandoned') => void
  onPlan: () => void
}) {
  if (!meso) {
    return (
      <button
        onClick={onPlan}
        className="rounded-xl border border-dashed border-neutral-700 p-3 text-left text-sm text-neutral-500 hover:border-neutral-500 hover:text-neutral-300"
      >
        + Plan a mesocycle — focused block with per-session prescriptions
      </button>
    )
  }

  const now = Date.now()
  const week = mesoWeek(meso, now)
  const overdue = mesoOverdue(meso, now)
  const deload = !overdue && isDeloadWeek(meso, week)
  const done = doneDayIndexes(meso, workouts, week)
  const next = nextDayIndex(meso, workouts, now)
  // Reaching the deload week means the block did its job — ending from
  // here is a completion, not an abandonment.
  const wrapUp = overdue || deload

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-neutral-100">
          {meso.name}
        </p>
        <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-300">
          {overdue
            ? 'finished — wrap up'
            : deload
              ? `deload · week ${week + 1}/${meso.weeks}`
              : `week ${week + 1}/${meso.weeks}`}
        </span>
      </div>
      {meso.focus.length > 0 && (
        <p className="mb-2 text-xs text-neutral-500">
          focus: {meso.focus.join(', ')}
        </p>
      )}
      {!overdue && (
        <div className="mb-2 flex flex-wrap gap-2">
          {meso.days.map((d, i) => (
            <button
              key={i}
              onClick={() => onStartDay(i)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                i === next
                  ? 'border-violet-500/60 bg-violet-500/10 text-violet-200'
                  : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
              }`}
            >
              {done.has(i) ? '✓ ' : ''}
              {d.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-4 text-xs font-medium">
        {overdue && (
          <button
            onClick={() => onEnd('completed')}
            className="text-teal-400 hover:text-teal-300"
          >
            Mark completed
          </button>
        )}
        <button
          onClick={() => {
            if (window.confirm('End this mesocycle?')) {
              onEnd(wrapUp ? 'completed' : 'abandoned')
            }
          }}
          className="text-neutral-600 hover:text-red-400"
        >
          End meso
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Setup flow: length, focus muscles, and the repeating days
// ---------------------------------------------------------------------------

interface DraftDay {
  label: string
  exercises: MesoExercise[]
}

export function MesoSetup({
  templates,
  customs,
  lookup,
  history,
  onSave,
  onCancel,
}: {
  templates: Template[]
  customs: CustomExercise[]
  lookup: (name: string) => string | undefined
  history: Workout[]
  onSave: (meso: Mesocycle) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [weeks, setWeeks] = useState(5)
  const [focus, setFocus] = useState<string[]>([])
  const [days, setDays] = useState<DraftDay[]>([])
  const [error, setError] = useState<string | null>(null)

  const strengthTemplates = templates.filter((t) => t.kind === 'strength')

  const knownNames = useMemo(() => {
    const names = new Set(EXERCISES.map((e) => e.name))
    for (const c of customs) names.add(c.name)
    for (const w of history) {
      if (w.kind !== 'strength') continue
      for (const e of w.exercises) names.add(e.name)
    }
    return [...names].sort()
  }, [customs, history])

  /** Most recent exercise of a muscle, for pre-filling template slots. */
  function lastUsed(muscle: string, taken: Set<string>): string {
    for (const w of history) {
      if (w.kind !== 'strength') continue
      for (const e of w.exercises) {
        if (lookup(e.name) === muscle && !taken.has(e.name)) {
          taken.add(e.name)
          return e.name
        }
      }
    }
    return ''
  }

  function toggleFocus(m: string) {
    setFocus((prev) =>
      prev.includes(m)
        ? prev.filter((x) => x !== m)
        : prev.length >= 3
          ? prev // 3 max — more focus is no focus
          : [...prev, m],
    )
  }

  function addDayFromTemplate(t: Template) {
    const taken = new Set<string>()
    setDays((prev) => [
      ...prev,
      {
        label: t.name,
        // Slots resolve to concrete lifts now so prescriptions can anchor
        // to the same exercise week over week (rows stay editable).
        exercises: (t.exercises ?? []).map((e) => ({
          name: e.muscle !== undefined ? lastUsed(e.muscle, taken) : e.name,
          setCount: e.setCount,
          ...(e.muscle !== undefined && { muscle: e.muscle }),
        })),
      },
    ])
  }

  function addBlankDay() {
    setDays((prev) => [
      ...prev,
      { label: `Day ${prev.length + 1}`, exercises: [] },
    ])
  }

  function patchDay(i: number, patch: Partial<DraftDay>) {
    setDays((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  }

  function save() {
    // Mirrors api/src/mesos.ts parse rules — an optimistic save the
    // server rejects would be silently wiped on the next refresh.
    const trimmed = name.trim()
    if (!trimmed) return setError('Name the mesocycle.')
    if (days.length === 0) return setError('Add at least one training day.')
    if (days.length > 7) return setError('A microcycle fits at most 7 days.')
    for (const d of days) {
      if (d.exercises.length === 0) {
        return setError(`"${d.label}" has no exercises.`)
      }
      if (d.exercises.length > 30) {
        return setError(`"${d.label}" has more than 30 exercises.`)
      }
      if (d.exercises.some((e) => !e.name.trim())) {
        return setError(`"${d.label}" has an unnamed exercise.`)
      }
    }
    onSave({
      id: crypto.randomUUID(),
      name: trimmed,
      weeks,
      focus,
      days: days.map((d) => ({
        label: d.label.trim() || 'Day',
        exercises: d.exercises.map((e) => ({
          ...e,
          name: e.name.trim(),
        })),
      })),
      startDate: new Date().toISOString(),
      status: 'active',
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-neutral-300">
          Plan a mesocycle
        </h1>
        <button
          onClick={() => {
            const dirty = name.trim() !== '' || days.length > 0
            if (!dirty || window.confirm('Discard this mesocycle plan?')) {
              onCancel()
            }
          }}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          Cancel
        </button>
      </div>

      <input
        className={inputClass}
        placeholder="name (e.g. Leg block, Push emphasis)"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="flex items-center gap-2 text-sm text-neutral-400">
        length
        <NumberField
          className={`${inputClass} w-16 text-center`}
          aria-label="mesocycle length in weeks"
          min={2}
          max={12}
          value={weeks}
          onCommit={setWeeks}
        />
        weeks — 4–6 recommended, the last one is a deload
      </label>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs uppercase tracking-wide text-neutral-600">
          focus muscles (up to 3) — these ramp toward their weekly max while
          everything else holds steady
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FOCUS_CHOICES.map((m) => (
            <button
              key={m}
              onClick={() => toggleFocus(m)}
              className={`rounded-full border px-3 py-1 text-sm ${
                focus.includes(m)
                  ? 'border-violet-500/60 bg-violet-500/10 text-violet-200'
                  : 'border-neutral-700 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {days.map((day, di) => (
        <div
          key={di}
          className="flex flex-col gap-2 rounded-xl border border-neutral-800/60 bg-neutral-900/60 p-3"
        >
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              aria-label={`day ${di + 1} label`}
              maxLength={60}
              value={day.label}
              onChange={(e) => patchDay(di, { label: e.target.value })}
            />
            <button
              onClick={() => setDays((prev) => prev.filter((_, j) => j !== di))}
              aria-label={`remove ${day.label}`}
              className="shrink-0 px-1 text-neutral-600 hover:text-red-400"
            >
              <XIcon />
            </button>
          </div>
          {day.exercises.map((e, ei) => (
            <div key={ei} className="flex items-center gap-2">
              <input
                className={inputClass}
                list="meso-exercise-names"
                maxLength={80}
                aria-label={`day ${di + 1} exercise ${ei + 1}`}
                placeholder={
                  e.muscle !== undefined
                    ? `pick a ${e.muscle} exercise…`
                    : 'exercise…'
                }
                value={e.name}
                onChange={(ev) =>
                  patchDay(di, {
                    exercises: day.exercises.map((x, j) =>
                      j === ei ? { ...x, name: ev.target.value } : x,
                    ),
                  })
                }
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500">
                sets
                <NumberField
                  className={`${inputClass} w-14 text-center`}
                  aria-label={`sets for day ${di + 1} exercise ${ei + 1}`}
                  min={1}
                  max={30}
                  value={e.setCount}
                  onCommit={(n) =>
                    patchDay(di, {
                      exercises: day.exercises.map((x, j) =>
                        j === ei ? { ...x, setCount: n } : x,
                      ),
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  patchDay(di, {
                    exercises: day.exercises.filter((_, j) => j !== ei),
                  })
                }
                aria-label="remove exercise"
                className="shrink-0 text-neutral-600 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
          {day.exercises.length < 30 && (
            <button
              onClick={() =>
                patchDay(di, {
                  exercises: [...day.exercises, { name: '', setCount: 3 }],
                })
              }
              className="self-start text-xs font-medium text-teal-400 hover:text-teal-300"
            >
              + add exercise
            </button>
          )}
        </div>
      ))}
      <datalist id="meso-exercise-names">
        {knownNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {days.length < 7 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-neutral-600">
            add a training day
          </p>
          <div className="flex flex-wrap gap-2">
            {strengthTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => addDayFromTemplate(t)}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
              >
                from “{t.name}”
              </button>
            ))}
            <button
              onClick={addBlankDay}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
            >
              blank day
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button onClick={save} className={`${buttonClass} w-full`}>
        Start mesocycle
      </button>
    </div>
  )
}
