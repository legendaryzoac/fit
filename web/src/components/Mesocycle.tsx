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
        className="border border-dashed border-ink/40 p-3 text-left text-sm font-semibold text-ink/55 hover:bg-ink/5 hover:text-ink"
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
    <div className="border-t-2 border-ink/40 pt-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="kicker min-w-0 truncate">
          {meso.name}
        </p>
        <span className="shrink-0 bg-accent-200 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-800">
          {overdue
            ? 'finished — wrap up'
            : deload
              ? `deload · week ${week + 1}/${meso.weeks}`
              : `week ${week + 1}/${meso.weeks}`}
        </span>
      </div>
      {meso.focus.length > 0 && (
        <p className="mb-2 text-xs text-ink/55">
          focus: {meso.focus.join(', ')}
        </p>
      )}
      {!overdue && (
        <div className="mb-2 flex flex-wrap gap-2">
          {meso.days.map((d, i) => (
            <button
              key={i}
              onClick={() => onStartDay(i)}
              className={`border px-3 py-1.5 text-sm ${
                i === next
                  ? 'border-accent bg-accent font-extrabold text-paper'
                  : 'border-ink/40 font-semibold text-ink/70 hover:bg-ink/5'
              }`}
            >
              {done.has(i) ? '✓ ' : ''}
              {d.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-4 text-xs">
        {overdue && (
          <button
            onClick={() => onEnd('completed')}
            className="font-semibold text-accent-700 hover:text-accent"
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
          className="font-semibold text-ink/45 hover:text-accent-700"
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
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          Plan a mesocycle
        </h1>
        <button
          onClick={() => {
            const dirty = name.trim() !== '' || days.length > 0
            if (!dirty || window.confirm('Discard this mesocycle plan?')) {
              onCancel()
            }
          }}
          className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
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

      <label className="flex items-center gap-2 text-sm text-ink/70">
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
        <p className="kicker">
          focus muscles (up to 3) — these ramp toward their weekly max while
          everything else holds steady
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FOCUS_CHOICES.map((m) => (
            <button
              key={m}
              onClick={() => toggleFocus(m)}
              className={`border px-3 py-1 text-sm ${
                focus.includes(m)
                  ? 'border-accent bg-accent font-extrabold text-paper'
                  : 'border-ink/40 font-semibold text-ink/60 hover:bg-ink/5'
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
          className={`flex flex-col gap-2 border border-ink/40 p-3 ${
            di > 0 ? '-mt-4 border-t-0' : ''
          }`}
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
              className="shrink-0 px-1 text-ink/45 hover:text-accent-700"
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
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink/55">
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
                className="shrink-0 text-ink/45 hover:text-accent-700"
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
              className="self-start text-xs font-semibold text-accent-700 hover:text-accent"
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
          <p className="kicker">
            add a training day
          </p>
          <div className="flex flex-wrap gap-2">
            {strengthTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => addDayFromTemplate(t)}
                className="border border-ink/40 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-ink/5"
              >
                from “{t.name}”
              </button>
            ))}
            <button
              onClick={addBlankDay}
              className="border border-ink/40 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-ink/5"
            >
              blank day
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm font-semibold text-accent-700">{error}</p>
      )}

      <button onClick={save} className={`${buttonClass} w-full justify-between`}>
        Start mesocycle
        <span>→</span>
      </button>
    </div>
  )
}
