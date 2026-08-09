import { Fragment, useMemo, useState } from 'react'
import {
  EXERCISES,
  MUSCLE_GROUPS,
  type CustomExercise,
} from '../lib/exercises'
import {
  dayKind,
  doneDayIndexes,
  isDeloadWeek,
  MESO_TEMPLATES,
  mesoOverdue,
  mesoWeek,
  nextDayIndex,
  plannedSets,
  WEEKDAY_SHORT,
  type MesoDay,
  type Mesocycle,
  type MesoTemplate,
} from '../lib/mesocycle'
import { fmtSec, totalSec, type Template } from '../lib/templates'
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
              {d.weekday != null && (
                <span className="mr-1 text-[9px] font-semibold tracking-wider opacity-70">
                  {WEEKDAY_SHORT[d.weekday]}
                </span>
              )}
              {d.label}
              {dayKind(d) === 'cardio' && (
                <span className="ml-1 text-[9px] font-semibold tracking-wider opacity-70">
                  CARDIO
                </span>
              )}
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
// Setup wizard: 1 basics (templates, length, focus) → 2 days → 3 review
// ---------------------------------------------------------------------------

const STEPS = ['Basics', 'Days', 'Review'] as const
type Step = 1 | 2 | 3

/** First weekday with fewer than two sessions planned — new days land
 * somewhere sensible instead of stacking on Monday. */
function nextFreeWeekday(days: MesoDay[]): number {
  for (const wd of [0, 2, 4, 1, 3, 5, 6]) {
    if (days.filter((d) => d.weekday === wd).length === 0) return wd
  }
  for (const wd of [0, 1, 2, 3, 4, 5, 6]) {
    if (days.filter((d) => d.weekday === wd).length < 2) return wd
  }
  return 0
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
  const [step, setStep] = useState<Step>(1)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [weeks, setWeeks] = useState(5)
  const [focus, setFocus] = useState<string[]>([])
  const [days, setDays] = useState<MesoDay[]>([])
  const [error, setError] = useState<string | null>(null)

  const strengthTemplates = templates.filter((t) => t.kind === 'strength')
  const timerTemplates = templates.filter(
    (t) => t.kind !== 'strength' && (t.sections?.length ?? 0) > 0,
  )

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

  const dirty = name.trim() !== '' || days.length > 0

  function loadPreset(t: MesoTemplate) {
    if (
      dirty &&
      presetId !== t.id &&
      !window.confirm('Replace the current plan with this template?')
    ) {
      return
    }
    setPresetId(t.id)
    setName(t.name)
    setWeeks(t.weeks)
    setFocus([...t.focus])
    // deep copy so edits never mutate the shared preset
    setDays(
      t.days.map((d) => ({
        ...d,
        exercises: d.exercises.map((e) => ({ ...e })),
        ...(d.sections && { sections: d.sections.map((s) => ({ ...s })) }),
      })),
    )
    setError(null)
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
        weekday: nextFreeWeekday(prev),
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
      {
        label: `Day ${prev.length + 1}`,
        weekday: nextFreeWeekday(prev),
        exercises: [],
      },
    ])
  }

  function addCardioDay() {
    setDays((prev) => [
      ...prev,
      {
        label: 'Cardio',
        weekday: nextFreeWeekday(prev),
        kind: 'cardio' as const,
        exercises: [],
        sections: [],
      },
    ])
  }

  function patchDay(i: number, patch: Partial<MesoDay>) {
    setDays((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  }

  /** Mirrors api/src/mesos.ts parse rules — an optimistic save the server
   * rejects would be silently wiped on the next refresh. */
  function daysError(): string | null {
    if (days.length === 0) return 'Add at least one training day.'
    if (days.length > 14) return 'A microcycle fits at most 14 sessions.'
    for (const d of days) {
      if (dayKind(d) === 'strength') {
        if (d.exercises.length === 0) return `"${d.label}" has no exercises.`
        if (d.exercises.length > 30) {
          return `"${d.label}" has more than 30 exercises.`
        }
        if (d.exercises.some((e) => !e.name.trim())) {
          return `"${d.label}" has an unnamed exercise.`
        }
      }
    }
    return null
  }

  /** Advance toward `target`, validating every step crossed — a tap two
   * steps ahead runs both gates instead of silently doing nothing. */
  function tryAdvanceTo(target: Step) {
    setError(null)
    let s: Step = step
    while (s < target) {
      if (s === 1) {
        if (!name.trim()) {
          setStep(1)
          setError('Name the mesocycle.')
          return
        }
        s = 2
      } else {
        const err = daysError()
        if (err) {
          setStep(2)
          setError(err)
          return
        }
        s = 3
      }
    }
    setStep(target)
  }

  function save() {
    const err = !name.trim() ? 'Name the mesocycle.' : daysError()
    if (err) return setError(err)
    const meso: Mesocycle = {
      id: crypto.randomUUID(),
      name: name.trim(),
      weeks,
      focus,
      days: days.map((d) => ({
        ...d,
        label: d.label.trim() || 'Day',
        exercises: d.exercises.map((e) => ({ ...e, name: e.name.trim() })),
      })),
      startDate: new Date().toISOString(),
      status: 'active',
    }
    // The API rejects bodies over 32KB — catch it here instead of letting
    // an optimistic save be silently wiped on the next refresh.
    if (JSON.stringify(meso).length > 30_000) {
      return setError(
        'This plan is too large to sync — trim exercises or shorten names.',
      )
    }
    onSave(meso)
  }

  // Projection for the review grid: planned sets per strength day per
  // week, ramp only (no feedback history yet).
  const draftMeso: Mesocycle = {
    id: 'draft',
    name: name || 'draft',
    weeks,
    focus,
    days,
    startDate: new Date().toISOString(),
    status: 'active',
  }
  const weekTints = ['bg-accent-200', 'bg-accent-300', 'bg-accent-400', 'bg-accent-500 text-paper', 'bg-accent-600 text-paper']

  const sortedDayIdx = days
    .map((_, i) => i)
    .sort((a, b) => (days[a].weekday ?? 99) - (days[b].weekday ?? 99) || a - b)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          Plan a mesocycle
        </h1>
        <button
          onClick={() => {
            if (!dirty || window.confirm('Discard this mesocycle plan?')) {
              onCancel()
            }
          }}
          className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
        >
          Cancel
        </button>
      </div>

      {/* step bar — numbered, red inset marker on the active step */}
      <div className="-mx-4 grid grid-cols-3 border-y-2 border-ink/40">
        {STEPS.map((label, i) => {
          const n = (i + 1) as Step
          const active = step === n
          const complete = step > n
          return (
            <button
              key={label}
              onClick={() => {
                // free navigation backward; forward runs validation
                if (n < step) setStep(n)
                else if (n > step) tryAdvanceTo(n)
              }}
              className={`px-4 py-2.5 text-left text-[10px] uppercase tracking-wider ${
                i > 0 ? 'border-l border-ink/25' : ''
              } ${
                active
                  ? 'font-extrabold text-accent-700 shadow-[inset_0_3px_0_#ec3013]'
                  : 'font-semibold text-ink/45 hover:text-ink'
              }`}
            >
              {n} {label}
              {complete ? ' ✓' : ''}
            </button>
          )
        })}
      </div>

      {step === 1 && (
        <>
          <div className="flex flex-col gap-2">
            <p className="kicker">Start from a block template</p>
            {MESO_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => loadPreset(t)}
                className={`border p-3 text-left ${
                  presetId === t.id
                    ? 'border-accent bg-accent-100'
                    : 'border-ink/40 hover:bg-ink/5'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-extrabold text-ink">
                    {t.name}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/50">
                    {t.weeks} wks · {t.days.length} sessions
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink/60">{t.blurb}</p>
                {t.focus.length > 0 && (
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-accent-700">
                    focus: {t.focus.join(' + ')}
                  </p>
                )}
              </button>
            ))}
            <button
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm('Clear the current plan and start over?')
                ) {
                  return
                }
                setPresetId(null)
                setDays([])
                setFocus([])
                setName('')
                setWeeks(5)
              }}
              className={`border border-dashed p-3 text-left text-sm font-semibold ${
                presetId === null
                  ? 'border-ink/60 text-ink'
                  : 'border-ink/40 text-ink/55 hover:text-ink'
              }`}
            >
              Start from scratch
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
              focus muscles (up to 3) — these ramp toward their weekly max
              while everything else holds steady
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
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-xs text-ink/55">
            Pick a weekday for every session. Two sessions can share a day —
            cardio in the morning before an evening lift, for example.
          </p>

          {days.map((day, di) => (
            <div
              key={di}
              className={`flex flex-col gap-2 border border-ink/40 p-3 ${
                di > 0 ? '-mt-4 border-t-0' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    dayKind(day) === 'cardio'
                      ? 'bg-accent2-100 text-accent2-800'
                      : 'bg-accent-100 text-accent-800'
                  }`}
                >
                  {dayKind(day)}
                </span>
                <input
                  className={inputClass}
                  aria-label={`day ${di + 1} label`}
                  maxLength={60}
                  value={day.label}
                  onChange={(e) => patchDay(di, { label: e.target.value })}
                />
                <button
                  onClick={() =>
                    setDays((prev) => prev.filter((_, j) => j !== di))
                  }
                  aria-label={`remove ${day.label}`}
                  className="shrink-0 px-1 text-ink/45 hover:text-accent-700"
                >
                  <XIcon />
                </button>
              </div>

              <div
                className="flex border border-ink/40"
                role="group"
                aria-label={`weekday for ${day.label}`}
              >
                {WEEKDAY_SHORT.map((wd, wi) => (
                  <button
                    key={wd}
                    onClick={() => patchDay(di, { weekday: wi })}
                    aria-pressed={day.weekday === wi}
                    className={`flex-1 py-1.5 text-[10px] tracking-wider ${
                      wi > 0 ? 'border-l border-ink/25' : ''
                    } ${
                      day.weekday === wi
                        ? 'bg-accent font-extrabold text-paper'
                        : 'font-semibold text-ink/55 hover:bg-ink/5'
                    }`}
                  >
                    {wd[0]}
                  </button>
                ))}
              </div>

              {dayKind(day) === 'cardio' ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-ink/55">
                    {day.sections && day.sections.length > 0
                      ? `Interval plan · ${day.sections.length} sections · ${fmtSec(totalSec(day.sections))}`
                      : 'Stopwatch — open-ended, log miles afterwards.'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => patchDay(di, { sections: [] })}
                      className={`border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                        !day.sections || day.sections.length === 0
                          ? 'border-accent bg-accent text-paper'
                          : 'border-ink/40 text-ink/60 hover:bg-ink/5'
                      }`}
                    >
                      Stopwatch
                    </button>
                    {timerTemplates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() =>
                          patchDay(di, {
                            sections: (t.sections ?? []).map((s) => ({
                              ...s,
                            })),
                          })
                        }
                        className="border border-ink/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink/60 hover:bg-ink/5"
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
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
                            exercises: day.exercises.filter(
                              (_, j) => j !== ei,
                            ),
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
                          exercises: [
                            ...day.exercises,
                            { name: '', setCount: 3 },
                          ],
                        })
                      }
                      className="self-start text-xs font-semibold text-accent-700 hover:text-accent"
                    >
                      + add exercise
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
          <datalist id="meso-exercise-names">
            {knownNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          {days.length < 14 && (
            <div className="flex flex-col gap-2">
              <p className="kicker">add a session</p>
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
                  blank lift day
                </button>
                <button
                  onClick={addCardioDay}
                  className="border border-ink/40 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-ink/5"
                >
                  cardio day
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <div>
            <p className="kicker mb-1">
              {name || 'Untitled block'} — {weeks} weeks
              {focus.length > 0 ? ` · focus ${focus.join(' + ')}` : ''}
            </p>
            <div className="flex flex-col">
              {sortedDayIdx.map((i) => {
                const d = days[i]
                return (
                  <div
                    key={i}
                    className="flex items-baseline justify-between border-b border-ink/20 py-1.5 text-sm"
                  >
                    <span className="font-extrabold text-ink">
                      <span className="mr-2 text-[10px] font-semibold tracking-wider text-ink/50">
                        {d.weekday != null ? WEEKDAY_SHORT[d.weekday] : '—'}
                      </span>
                      {d.label}
                    </span>
                    <span className="text-xs text-ink/55">
                      {dayKind(d) === 'cardio'
                        ? d.sections && d.sections.length > 0
                          ? fmtSec(totalSec(d.sections))
                          : 'stopwatch'
                        : `${d.exercises.length} exercises · ${d.exercises.reduce((n, e) => n + e.setCount, 0)} sets`}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="kicker">Week at a glance</span>
              <span className="text-[9px] font-semibold tracking-widest text-ink/45">
                SETS RAMP → WK {Math.max(1, weeks - 1)} · WK {weeks} DELOAD
              </span>
            </div>
            <div className="overflow-x-auto scroll-thin">
              <div
                className="grid gap-0.5 text-[10px] font-semibold"
                style={{
                  gridTemplateColumns: `44px repeat(${sortedDayIdx.length}, minmax(56px, 1fr))`,
                }}
              >
                <div />
                {sortedDayIdx.map((i) => (
                  <div
                    key={i}
                    className="truncate px-1 text-center text-[9px] uppercase tracking-wider text-ink/50"
                  >
                    {days[i].label}
                  </div>
                ))}
                {Array.from({ length: weeks }, (_, wk) => {
                  const deload = wk === weeks - 1
                  return (
                    <Fragment key={wk}>
                      <div
                        className={`self-center text-[9px] uppercase tracking-wider ${
                          deload ? 'font-extrabold text-accent-700' : 'text-ink/50'
                        }`}
                      >
                        WK {wk + 1}
                      </div>
                      {sortedDayIdx.map((i) => {
                        const d = days[i]
                        // Cardio plans don't deload — their cell stays the
                        // same duration in every week row.
                        if (deload && dayKind(d) !== 'cardio') {
                          return (
                            <div
                              key={i}
                              className="border border-dashed border-accent py-1.5 text-center text-[9px] tracking-wider text-accent-700"
                            >
                              DELOAD
                            </div>
                          )
                        }
                        if (dayKind(d) === 'cardio') {
                          return (
                            <div
                              key={i}
                              className="bg-surface py-1.5 text-center text-ink/70"
                            >
                              {d.sections && d.sections.length > 0
                                ? fmtSec(totalSec(d.sections))
                                : 'free'}
                            </div>
                          )
                        }
                        const sets = plannedSets(
                          draftMeso,
                          d,
                          wk,
                          [],
                          lookup,
                          Date.now(),
                        ).reduce((n, e) => n + e.setCount, 0)
                        return (
                          <div
                            key={i}
                            className={`py-1.5 text-center ${
                              weekTints[Math.min(wk, weekTints.length - 1)]
                            }`}
                          >
                            {sets}
                          </div>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {error && <p className="text-sm font-semibold text-accent-700">{error}</p>}

      <div className="flex items-center gap-4">
        {step < 3 ? (
          <button
            onClick={() => tryAdvanceTo((step + 1) as Step)}
            className={`${buttonClass} flex-1 justify-between`}
          >
            Continue — {STEPS[step as 1 | 2]}
            <span>→</span>
          </button>
        ) : (
          <button onClick={save} className={`${buttonClass} flex-1 justify-between`}>
            Start mesocycle
            <span>→</span>
          </button>
        )}
        {step > 1 && (
          <button
            onClick={() => setStep((s) => (s - 1) as Step)}
            className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
          >
            Back
          </button>
        )}
      </div>
    </div>
  )
}
