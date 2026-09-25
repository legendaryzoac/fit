import { Fragment, useId, useMemo, useState, type ReactNode } from 'react'
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
  mondayWeekday,
  nextDayIndex,
  plannedSets,
  WEEKDAY_SHORT,
  workoutsInWeek,
  type MesoDay,
  type Mesocycle,
  type MesoTemplate,
} from '../lib/mesocycle'
import { fmtSec, totalSec, type Template } from '../lib/templates'
import type { Workout } from '../lib/workouts'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Card, CardHead } from './cadence/Card'
import { Field, TextInput } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import { List, ListItem } from './cadence/ListItem'
import { Progress } from './cadence/SessionBar'
import { StatusPill } from './cadence/StatusPill'
import { Stepper } from './cadence/Stepper'
import { WeekStrip, type WeekDay } from './cadence/WeekStrip'
import { IconCheck, IconX } from './shell/icons'
import { Segment } from './shell/Segment'
import { confirm } from '../lib/confirm'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'

const FOCUS_CHOICES = MUSCLE_GROUPS.filter(
  (m) => m !== 'other' && m !== 'full body',
)

/** 'FRI' becomes 'Fri'. */
const weekdayLabel = (i: number) =>
  WEEKDAY_SHORT[i][0] + WEEKDAY_SHORT[i].slice(1).toLowerCase()

/** The sub line of a day: its lifts, its interval plan, or the stopwatch. */
function dayMeta(d: MesoDay): string {
  if (dayKind(d) === 'cardio') {
    return d.sections && d.sections.length > 0
      ? `Intervals · ${d.sections.length} sections · ${fmtSec(totalSec(d.sections))}`
      : 'Stopwatch'
  }
  const sets = d.exercises.reduce((n, e) => n + e.setCount, 0)
  return `${d.exercises.length} exercises · ${sets} sets`
}

/** A toggle chip, the Chips row's pill for a multi-select. */
function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`pressable h-9 shrink-0 rounded-pill px-3.5 text-[14px] ${
        selected
          ? 'bg-brand-soft font-semibold text-brand-strong'
          : 'bg-surface-2 font-medium text-ink-2'
      }`}
    >
      {children}
    </button>
  )
}

/** Seven day circles; the chosen weekday is brand. */
function WeekdayPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | undefined
  onChange: (weekday: number) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-7 gap-1">
      {WEEKDAY_SHORT.map((wd, wi) => {
        const selected = value === wi
        return (
          <button
            key={wd}
            type="button"
            aria-pressed={selected}
            aria-label={weekdayLabel(wi)}
            onClick={() => onChange(wi)}
            className={`pressable mx-auto flex h-11 w-11 items-center justify-center rounded-pill text-caption font-semibold ${
              selected ? 'bg-brand text-on-brand' : 'bg-surface-2 text-ink-2'
            }`}
          >
            {wd[0]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Plan-screen block cards: the current block as a hero (name, status,
 * week line, progress, edit and end), then this week as a strip of day
 * circles with the week's sessions as rows.
 */
export function MesoCard({
  meso,
  workouts,
  onStartDay,
  onEnd,
  onEdit,
  onPlan,
}: {
  meso?: Mesocycle
  workouts: Workout[]
  onStartDay: (dayIndex: number) => void
  onEnd: (status: 'completed' | 'abandoned') => void
  onEdit: () => void
  onPlan: () => void
}) {
  if (!meso) {
    return (
      <Card>
        <p className="text-title-sm text-ink">No block</p>
        <p className="mt-1 text-body text-ink-2">
          Plan weeks of sessions with progression.
        </p>
        <Button variant="primary" className="mt-3.5" onClick={onPlan}>
          New block
        </Button>
      </Card>
    )
  }

  const now = Date.now()
  const week = mesoWeek(meso, now)
  const overdue = mesoOverdue(meso, now)
  const deload = !overdue && isDeloadWeek(meso, week)
  const done = doneDayIndexes(meso, workouts, week)
  const next = nextDayIndex(meso, workouts, now)
  const todayW = mondayWeekday(now)
  // Reaching the deload week means the block did its job — ending from
  // here is a completion, not an abandonment.
  const wrapUp = overdue || deload

  // Monday-anchored dates for the week strip
  const monday = new Date(now)
  monday.setDate(monday.getDate() - todayW)

  const scheduled = meso.days
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.weekday != null)
    .sort((a, b) => a.d.weekday! - b.d.weekday! || a.i - b.i)
  const unscheduled = meso.days
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.weekday == null)

  const sessionsDone = done.size
  const totalSessions = meso.days.length

  // A scheduled session whose day has passed this week without being
  // trained — but only days the block already covered: a block started
  // on a Friday is not behind on Monday's session.
  const startDay = new Date(meso.startDate)
  startDay.setHours(0, 0, 0, 0)
  const todayDay = new Date(now)
  todayDay.setHours(0, 0, 0, 0)
  const missed = (d: MesoDay, i: number): boolean => {
    if (d.weekday == null || done.has(i)) return false
    const date = new Date(monday)
    date.setDate(monday.getDate() + d.weekday)
    date.setHours(0, 0, 0, 0)
    return date < todayDay && date >= startDay
  }
  const behind = !overdue && scheduled.some(({ d, i }) => missed(d, i))
  const status: { tone: 'good' | 'mid' | 'neutral'; label: string } = overdue
    ? { tone: 'neutral', label: 'Finished' }
    : behind
      ? { tone: 'mid', label: 'Behind' }
      : { tone: 'good', label: 'On track' }

  const weekLine = [
    `Week ${Math.min(week, meso.weeks - 1) + 1} of ${meso.weeks}`,
    meso.focus.length > 0 ? meso.focus.join(', ') : null,
    overdue ? null : deload ? 'Deload' : `Deload in week ${meso.weeks}`,
  ]
    .filter((s): s is string => s != null)
    .join(' · ')

  // The strip: trained days are done, scheduled sessions still to come are
  // planned; a legacy weekday-less block spreads its remaining sessions
  // over the days left in the week.
  const trained = new Set(workouts.map((w) => new Date(w.start).toDateString()))
  let remaining =
    scheduled.length === 0
      ? Math.max(0, totalSessions - workoutsInWeek(meso, workouts, week).length)
      : 0
  const weekDays: WeekDay[] = WEEKDAY_SHORT.map((_, wi) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + wi)
    const isToday = wi === todayW
    const isDone = trained.has(date.toDateString())
    let planned = false
    if (!isDone && wi >= todayW && !overdue) {
      if (scheduled.length > 0) {
        planned = scheduled.some(
          ({ d, i }) => d.weekday === wi && !done.has(i),
        )
      } else if (remaining > 0) {
        planned = true
        remaining -= 1
      }
    }
    return {
      label: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
      num: date.getDate(),
      done: isDone,
      planned,
      today: isToday,
    }
  })

  async function endBlock() {
    if (await confirm({ title: 'End this block?', action: 'End block' })) {
      onEnd(wrapUp ? 'completed' : 'abandoned')
    }
  }

  function sessionRow(d: MesoDay, i: number, title: string) {
    const isDone = done.has(i)
    const isToday = d.weekday === todayW
    // Today's, the next one, any missed session, and every floating
    // ("any day") session can start from here
    const startable =
      !isDone && (d.weekday == null || isToday || i === next || missed(d, i))
    return (
      <div
        key={i}
        className="flex min-h-11 items-center justify-between gap-3"
      >
        <span className="min-w-0 truncate text-body font-medium text-ink">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {isDone ? (
            <StatusPill tone="good">Done</StatusPill>
          ) : (
            <>
              {isToday && <StatusPill tone="good">Today</StatusPill>}
              {startable ? (
                <Button
                  variant="tonal"
                  size="sm"
                  onClick={() => onStartDay(i)}
                >
                  Start
                </Button>
              ) : (
                <span className="text-caption text-ink-3">Planned</span>
              )}
            </>
          )}
        </span>
      </div>
    )
  }

  return (
    <>
      <Card hero>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-eyebrow text-ink-2">Current block</p>
            <h2 className="mt-0.5 truncate text-title text-ink">{meso.name}</h2>
          </div>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        </div>
        <p className="mt-1 text-caption text-ink-2">{weekLine}</p>
        <div className="mt-3">
          <Progress
            value={Math.min(week, meso.weeks) / meso.weeks}
            label="Weeks done"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {overdue && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onEnd('completed')}
            >
              Mark completed
            </Button>
          )}
          <Button variant="tonal" size="sm" onClick={onEdit}>
            Edit block
          </Button>
          <Button variant="ghost-danger" size="sm" onClick={endBlock}>
            End block
          </Button>
        </div>
      </Card>

      {!overdue && (
        <Card>
          <CardHead
            title="This week"
            action={
              <span className="text-caption text-ink-2">
                {sessionsDone} of {totalSessions} done
              </span>
            }
          />
          <div className="mt-4">
            <WeekStrip days={weekDays} />
          </div>
          {scheduled.length > 0 && (
            <div className="mt-4 flex flex-col">
              {scheduled.map(({ d, i }, k) => (
                <Fragment key={i}>
                  {k > 0 && (
                    <div aria-hidden="true" className="h-px bg-hairline" />
                  )}
                  {sessionRow(d, i, `${weekdayLabel(d.weekday!)} · ${d.label}`)}
                </Fragment>
              ))}
            </div>
          )}
          {unscheduled.length > 0 && (
            <>
              <p className="mt-4 text-caption text-ink-3">Any day</p>
              <div className="flex flex-col">
                {unscheduled.map(({ d, i }, k) => (
                  <Fragment key={i}>
                    {k > 0 && (
                      <div aria-hidden="true" className="h-px bg-hairline" />
                    )}
                    {sessionRow(d, i, d.label)}
                  </Fragment>
                ))}
              </div>
            </>
          )}
        </Card>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Setup wizard: 1 basics (templates, length, focus) → 2 days → 3 review
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3
const STEP_OPTIONS: Array<{ value: `${Step}`; label: string }> = [
  { value: '1', label: 'Basics' },
  { value: '2', label: 'Days' },
  { value: '3', label: 'Review' },
]

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

/** Deep copy so edits never mutate a shared preset or the live block. */
function copyDays(days: MesoDay[]): MesoDay[] {
  return days.map((d) => ({
    ...d,
    exercises: d.exercises.map((e) => ({ ...e })),
    ...(d.sections && { sections: d.sections.map((s) => ({ ...s })) }),
  }))
}

export function MesoSetup({
  templates,
  customs,
  lookup,
  history,
  initial,
  onSave,
  onCancel,
}: {
  templates: Template[]
  customs: CustomExercise[]
  lookup: (name: string) => string | undefined
  history: Workout[]
  /** An existing block to edit; its id, start and status are kept. */
  initial?: Mesocycle
  /** Runs once the sheet has dropped. */
  onSave: (meso: Mesocycle) => void
  /** Runs once the sheet has dropped. */
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>(1)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [weeks, setWeeks] = useState(initial?.weeks ?? 5)
  const [focus, setFocus] = useState<string[]>(initial ? [...initial.focus] : [])
  const [days, setDays] = useState<MesoDay[]>(
    initial ? copyDays(initial.days) : [],
  )
  /** The day open in the step-2 editor. */
  const [editingDay, setEditingDay] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  const weeksId = useId()
  const labelId = useId()
  const namesId = useId()
  const { open, dismiss, onExited } = useSheetDismiss()

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

  function goTo(s: Step) {
    setEditingDay(null)
    setStep(s)
  }

  async function cancel() {
    if (
      !dirty ||
      (await confirm({ title: 'Discard this plan?', action: 'Discard' }))
    ) {
      dismiss(onCancel)
    }
  }

  async function loadPreset(t: MesoTemplate) {
    if (
      dirty &&
      presetId !== t.id &&
      !(await confirm({
        title: 'Replace the plan?',
        body: `${t.name} takes its place.`,
        action: 'Replace',
      }))
    ) {
      return
    }
    setPresetId(t.id)
    setName(t.name)
    setWeeks(t.weeks)
    setFocus([...t.focus])
    setDays(copyDays(t.days))
    setError(null)
  }

  async function startFromScratch() {
    if (
      dirty &&
      !(await confirm({ title: 'Clear the plan?', action: 'Clear' }))
    ) {
      return
    }
    setPresetId(null)
    setDays([])
    setFocus([])
    setName('')
    setWeeks(5)
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

  function removeDay(i: number) {
    setDays((prev) => prev.filter((_, j) => j !== i))
    setEditingDay(null)
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
          goTo(1)
          setError('Name the mesocycle.')
          return
        }
        s = 2
      } else {
        const err = daysError()
        if (err) {
          goTo(2)
          setError(err)
          return
        }
        s = 3
      }
    }
    goTo(target)
  }

  function save() {
    const err = !name.trim() ? 'Name the mesocycle.' : daysError()
    if (err) return setError(err)
    const meso: Mesocycle = {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      weeks,
      focus,
      days: days.map((d) => ({
        ...d,
        label: d.label.trim() || 'Day',
        exercises: d.exercises.map((e) => ({ ...e, name: e.name.trim() })),
      })),
      startDate: initial?.startDate ?? new Date().toISOString(),
      status: initial?.status ?? 'active',
    }
    // The API rejects bodies over 32KB — catch it here instead of letting
    // an optimistic save be silently wiped on the next refresh.
    if (JSON.stringify(meso).length > 30_000) {
      return setError(
        'This plan is too large to sync — trim exercises or shorten names.',
      )
    }
    dismiss(() => onSave(meso))
  }

  // Projection for the review: planned sets per strength day per week,
  // ramp only (no feedback history yet).
  const draftMeso: Mesocycle = {
    id: 'draft',
    name: name || 'draft',
    weeks,
    focus,
    days,
    startDate: new Date().toISOString(),
    status: 'active',
  }

  const sortedDayIdx = days
    .map((_, i) => i)
    .sort((a, b) => (days[a].weekday ?? 99) - (days[b].weekday ?? 99) || a - b)

  const check = <IconCheck className="h-5 w-5 text-brand-strong" />

  function dayEditor(di: number) {
    const day = days[di]
    if (!day) return null
    const cardio = dayKind(day) === 'cardio'
    return (
      <div className="flex flex-col gap-3">
        <div>
          <StatusPill tone={cardio ? 'rest' : 'good'}>
            {cardio ? 'Cardio' : 'Strength'}
          </StatusPill>
        </div>
        <Field label="Label" htmlFor={labelId}>
          <TextInput
            id={labelId}
            maxLength={60}
            value={day.label}
            onChange={(e) => patchDay(di, { label: e.target.value })}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-caption font-semibold text-ink-2">Weekday</p>
          <WeekdayPicker
            value={day.weekday}
            onChange={(wi) => patchDay(di, { weekday: wi })}
            ariaLabel={`Weekday for ${day.label}`}
          />
        </div>

        {cardio ? (
          <div className="flex flex-col gap-2">
            <p className="text-caption font-semibold text-ink-2">Plan</p>
            <p className="text-caption text-ink-3">{dayMeta(day)}</p>
            <div className="flex flex-wrap gap-2">
              <Chip
                selected={!day.sections || day.sections.length === 0}
                onClick={() => patchDay(di, { sections: [] })}
              >
                Stopwatch
              </Chip>
              {timerTemplates.map((t) => {
                // sections are copied on pick, so match by content
                const selected =
                  !!day.sections &&
                  day.sections.length > 0 &&
                  JSON.stringify(day.sections) ===
                    JSON.stringify(t.sections ?? [])
                return (
                  <Chip
                    key={t.id}
                    selected={selected}
                    onClick={() =>
                      patchDay(di, {
                        sections: (t.sections ?? []).map((s) => ({ ...s })),
                      })
                    }
                  >
                    {t.name}
                  </Chip>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            {day.exercises.length > 0 && (
              <div className="flex flex-col">
                {day.exercises.map((e, ei) => (
                  <Fragment key={ei}>
                    {ei > 0 && (
                      <div aria-hidden="true" className="h-px bg-hairline" />
                    )}
                    <div className="flex flex-col gap-2 py-2">
                      <div className="flex items-center gap-2">
                        <TextInput
                          className="min-w-0 flex-1"
                          list={namesId}
                          maxLength={80}
                          aria-label={`Exercise ${ei + 1}`}
                          placeholder={
                            e.muscle !== undefined
                              ? `${e.muscle} exercise`
                              : 'Exercise'
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
                        <IconButton
                          size="sm"
                          label="Remove"
                          onClick={() =>
                            patchDay(di, {
                              exercises: day.exercises.filter(
                                (_, j) => j !== ei,
                              ),
                            })
                          }
                        >
                          <IconX className="h-4 w-4" />
                        </IconButton>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-caption font-semibold text-ink-2">
                          Sets
                        </span>
                        <Stepper
                          ariaLabel={`Sets for exercise ${ei + 1}`}
                          min={1}
                          max={30}
                          value={e.setCount}
                          onChange={(n) =>
                            patchDay(di, {
                              exercises: day.exercises.map((x, j) =>
                                j === ei ? { ...x, setCount: n } : x,
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  </Fragment>
                ))}
              </div>
            )}
            <datalist id={namesId}>
              {knownNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {day.exercises.length < 30 && (
              <Button
                variant="quiet"
                block
                onClick={() =>
                  patchDay(di, {
                    exercises: [...day.exercises, { name: '', setCount: 3 }],
                  })
                }
              >
                Add exercise
              </Button>
            )}
          </>
        )}

        <Button variant="primary" block onClick={() => setEditingDay(null)}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={cancel}
      onExited={onExited}
      title={initial ? 'Edit block' : 'New block'}
    >
      <div className="flex flex-col gap-3">
        <Segment
          block
          options={STEP_OPTIONS}
          value={`${step}`}
          onChange={(v) => {
            const n = Number(v) as Step
            // free navigation backward; forward runs validation
            if (n < step) goTo(n)
            else if (n > step) tryAdvanceTo(n)
          }}
          ariaLabel="Step"
        />

        {step === 1 && (
          <>
            <List>
              {MESO_TEMPLATES.map((t) => (
                <ListItem
                  key={t.id}
                  title={t.name}
                  sub={`${t.weeks} weeks · ${t.days.length} sessions${
                    t.focus.length > 0 ? ` · ${t.focus.join(', ')}` : ''
                  }`}
                  trail={presetId === t.id ? check : undefined}
                  onClick={() => loadPreset(t)}
                />
              ))}
              <ListItem
                key="scratch"
                title="From scratch"
                trail={presetId === null ? check : undefined}
                onClick={startFromScratch}
              />
            </List>

            <Field label="Name" htmlFor={nameId}>
              <TextInput
                id={nameId}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <div className="flex min-h-11 items-center justify-between gap-3">
              <label
                htmlFor={weeksId}
                className="text-caption font-semibold text-ink-2"
              >
                Weeks
              </label>
              <Stepper
                id={weeksId}
                ariaLabel="Weeks"
                min={2}
                max={12}
                value={weeks}
                onChange={setWeeks}
              />
            </div>
            <p className="text-caption text-ink-3">Last week deloads</p>

            <div className="flex flex-col gap-2">
              <p className="text-caption font-semibold text-ink-2">
                Focus (up to 3)
              </p>
              <div className="flex flex-wrap gap-2">
                {FOCUS_CHOICES.map((m) => (
                  <Chip
                    key={m}
                    selected={focus.includes(m)}
                    onClick={() => toggleFocus(m)}
                  >
                    {m}
                  </Chip>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 2 && editingDay != null && dayEditor(editingDay)}

        {step === 2 && editingDay == null && (
          <>
            {days.length > 0 && (
              <List>
                {days.map((day, di) => (
                  <ListItem
                    key={di}
                    title={day.label}
                    sub={dayMeta(day)}
                    trail={
                      day.weekday != null ? weekdayLabel(day.weekday) : 'Any day'
                    }
                    chevron
                    onClick={() => setEditingDay(di)}
                    action={
                      <IconButton
                        size="sm"
                        label={`Remove ${day.label}`}
                        onClick={() => removeDay(di)}
                      >
                        <IconX className="h-4 w-4" />
                      </IconButton>
                    }
                  />
                ))}
              </List>
            )}
            {days.length < 14 && (
              <div className="flex flex-col gap-2">
                <p className="text-caption font-semibold text-ink-2">Add</p>
                <div className="flex flex-wrap gap-2">
                  {strengthTemplates.map((t) => (
                    <Button
                      key={t.id}
                      variant="quiet"
                      size="sm"
                      onClick={() => addDayFromTemplate(t)}
                    >
                      {t.name}
                    </Button>
                  ))}
                  <Button variant="quiet" size="sm" onClick={addBlankDay}>
                    Lift day
                  </Button>
                  <Button variant="quiet" size="sm" onClick={addCardioDay}>
                    Cardio day
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-caption text-ink-2">
              {name || 'Untitled'} · {weeks} weeks
              {focus.length > 0 ? ` · ${focus.join(', ')}` : ''}
            </p>
            <List>
              {sortedDayIdx.map((i) => {
                const d = days[i]
                return (
                  <ListItem
                    key={i}
                    title={d.label}
                    sub={dayMeta(d)}
                    trail={
                      d.weekday != null ? weekdayLabel(d.weekday) : 'Any day'
                    }
                  />
                )
              })}
            </List>

            <Card>
              <p className="text-caption font-semibold text-ink-2">
                Week at a glance
              </p>
              <div className="mt-3 grid grid-cols-7 gap-1">
                {WEEKDAY_SHORT.map((wd, wi) => {
                  const count = days.filter((d) => d.weekday === wi).length
                  return (
                    <div key={wd} className="flex flex-col items-center gap-1.5">
                      <span className="text-micro text-ink-3">{wd[0]}</span>
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-pill text-caption font-semibold ${
                          count > 0
                            ? 'bg-brand-soft text-brand-strong'
                            : 'bg-surface-2 text-ink-3'
                        }`}
                      >
                        {count > 0 ? count : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 flex flex-col">
                {Array.from({ length: weeks }, (_, wk) => {
                  const deload = wk === weeks - 1
                  // Cardio plans don't deload and carry no sets — the ramp
                  // projection sums the strength days only.
                  const sets = sortedDayIdx.reduce((n, i) => {
                    const d = days[i]
                    if (dayKind(d) === 'cardio') return n
                    return (
                      n +
                      plannedSets(draftMeso, d, wk, [], lookup, Date.now()).reduce(
                        (s, e) => s + e.setCount,
                        0,
                      )
                    )
                  }, 0)
                  return (
                    <div
                      key={wk}
                      className="flex min-h-9 items-center justify-between gap-3"
                    >
                      <span className="text-caption text-ink-2">
                        Week {wk + 1}
                      </span>
                      <span
                        className={`text-caption font-semibold ${
                          deload ? 'text-brand-strong' : 'text-ink'
                        }`}
                      >
                        {deload ? `Deload · ${sets} sets` : `${sets} sets`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          </>
        )}

        {error && <Banner tone="error">{error}</Banner>}

        <div className="flex items-center gap-3">
          {step > 1 && (
            <Button variant="tonal" onClick={() => goTo((step - 1) as Step)}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => tryAdvanceTo((step + 1) as Step)}
            >
              Next
            </Button>
          ) : (
            <Button variant="primary" className="flex-1" onClick={save}>
              Save block
            </Button>
          )}
        </div>
        <Button variant="ghost" block onClick={cancel}>
          Cancel
        </Button>
      </div>
    </Sheet>
  )
}
