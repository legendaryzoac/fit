import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Api } from '../lib/api'
import {
  EXERCISES,
  MUSCLE_GROUPS,
  SPEED_DRILLS,
  makeMuscleLookup,
  type CustomExercise,
} from '../lib/exercises'
import {
  buildIntervals,
  DEFAULT_PLAN,
  fmtSec,
  planFromSections,
  totalSec,
  type QuickIntervalPlan,
  type Template,
  type TemplateExercise,
} from '../lib/templates'
import type { WorkoutKind } from '../lib/workouts'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Field, SELECT_WELL, TextInput } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import type { LeadTone } from './cadence/ListItem'
import { Stepper } from './cadence/Stepper'
import { IconGrip, IconRun, IconSpeed, IconStrength, IconX } from './shell/icons'
import { Segment } from './shell/Segment'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'

/** The lead circle per kind: barbell, bolt, wave. */
export const KIND_LEAD: Record<WorkoutKind, { icon: ReactNode; tone: LeadTone }> = {
  strength: { icon: <IconStrength />, tone: 'brand' },
  speed: { icon: <IconSpeed />, tone: 'effort' },
  cardio: { icon: <IconRun />, tone: 'rest' },
}

const KIND_OPTIONS: Array<{ value: WorkoutKind; label: string }> = [
  { value: 'strength', label: 'Strength' },
  { value: 'speed', label: 'Speed' },
  { value: 'cardio', label: 'Cardio' },
]

/** The sub line of a template row: what it holds. */
export function templateMeta(t: Template): string {
  if (t.kind === 'strength' && t.exercises) {
    const sets = t.exercises.reduce((n, e) => n + e.setCount, 0)
    return `${t.exercises.length} exercises · ${sets} sets`
  }
  if (t.sections) {
    return `${t.sections.length} sections · ${fmtSec(totalSec(t.sections))}`
  }
  return ''
}

const PLAN_FIELDS: Array<{
  key: keyof QuickIntervalPlan
  label: string
  min: number
  max: number
  step: number
}> = [
  { key: 'warmupSec', label: 'Warm up (s)', min: 0, max: 7200, step: 30 },
  { key: 'workSec', label: 'Work (s)', min: 1, max: 7200, step: 5 },
  { key: 'restSec', label: 'Rest (s)', min: 0, max: 7200, step: 5 },
  { key: 'sets', label: 'Rounds', min: 1, max: 99, step: 1 },
  { key: 'cooldownSec', label: 'Cool down (s)', min: 0, max: 7200, step: 30 },
]

/** The quick interval plan as labelled Steppers; summary adds the
 * sections-and-total line under them. */
export function PlanFields({
  plan,
  onChange,
  summary = true,
}: {
  plan: QuickIntervalPlan
  onChange: (plan: QuickIntervalPlan) => void
  summary?: boolean
}) {
  const id = useId()
  const sections = useMemo(() => buildIntervals(plan), [plan])
  return (
    <div className="flex flex-col gap-3">
      {PLAN_FIELDS.map(({ key, label, min, max, step }) => (
        <div
          key={key}
          className="flex min-h-11 items-center justify-between gap-3"
        >
          <label
            htmlFor={`${id}-${key}`}
            className="text-caption font-semibold text-ink-2"
          >
            {label}
          </label>
          <Stepper
            id={`${id}-${key}`}
            ariaLabel={label}
            min={min}
            max={max}
            step={step}
            value={plan[key]}
            onChange={(n) => onChange({ ...plan, [key]: n })}
          />
        </div>
      ))}
      {summary && (
        <p className="text-caption text-ink-3">
          {sections.length} sections · {fmtSec(totalSec(sections))}
        </p>
      )}
    </div>
  )
}

export function TemplateBuilder({
  api,
  customs,
  initial,
  onSaveCustom,
  onSaved,
  onDelete,
  onCancel,
}: {
  api: Api
  customs: CustomExercise[]
  initial?: Template
  onSaveCustom: (name: string, muscle: string) => void
  /** Runs once the sheet has dropped. */
  onSaved: (t: Template) => void
  /** Resolves true once the template is gone; the sheet then drops. */
  onDelete?: (t: Template) => Promise<boolean>
  /** Runs once the sheet has dropped. */
  onCancel: () => void
}) {
  const [kind, setKind] = useState<WorkoutKind>(initial?.kind ?? 'strength')
  const [name, setName] = useState(initial?.name ?? '')
  const [exercises, setExercises] = useState<TemplateExercise[]>(
    initial?.exercises ?? [],
  )
  const [exName, setExName] = useState('')
  const [newMuscle, setNewMuscle] = useState<string>('other')
  const [slotMuscle, setSlotMuscle] = useState<string>('quads')
  const [plan, setPlan] = useState<QuickIntervalPlan>(
    initial?.sections ? planFromSections(initial.sections) : DEFAULT_PLAN,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  const exId = useId()
  const muscleId = useId()
  const slotId = useId()

  // Every way out unmounts this screen in the parent, so the sheet drops
  // first and the real callback waits for the exit to finish.
  const { open, dismiss, onExited } = useSheetDismiss()

  // Drag-to-reorder: exercise rows move as the handle crosses a neighbour's
  // midpoint. Refs to the row elements let us read live positions on the fly.
  // The live drag position lives in a ref (not just state) so the move logic
  // stays out of state updaters — React double-invokes those in StrictMode,
  // which would swap twice and cancel the reorder.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const dragFrom = useRef<number | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const lookup = useMemo(() => makeMuscleLookup(customs), [customs])

  const names = useMemo(() => {
    const base = (kind === 'speed' ? SPEED_DRILLS : EXERCISES).map(
      (e) => e.name,
    )
    return [...new Set([...base, ...customs.map((c) => c.name)])].sort()
  }, [kind, customs])

  const typedUnknown =
    exName.trim().length > 0 && lookup(exName) === undefined

  function addExercise() {
    const trimmed = exName.trim()
    if (!trimmed) return
    if (lookup(trimmed) === undefined) onSaveCustom(trimmed, newMuscle)
    setExercises([...exercises, { name: trimmed, setCount: 3 }])
    setExName('')
    setNewMuscle('other')
  }

  /** Generic slot — the concrete exercise gets picked at workout start. */
  function addSlot() {
    // Number from the max surviving suffix — a plain count would mint a
    // duplicate label after a slot is removed.
    const prefix = `${slotMuscle} exercise `
    let top = 0
    for (const e of exercises) {
      if (e.muscle !== slotMuscle || !e.name.startsWith(prefix)) continue
      const n = Number(e.name.slice(prefix.length))
      if (Number.isFinite(n)) top = Math.max(top, n)
    }
    setExercises([
      ...exercises,
      { name: `${prefix}${top + 1}`, setCount: 3, muscle: slotMuscle },
    ])
  }

  function moveExercise(from: number, to: number) {
    if (from === to) return
    setExercises((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function onHandlePointerDown(ei: number, ev: React.PointerEvent) {
    ev.preventDefault()
    // preventDefault also suppresses the focus change a press would cause,
    // so end any in-progress field edit explicitly — a Stepper draft is
    // keyed to a list POSITION and must not attach to whichever row lands
    // there after the reorder.
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
    // Swap once the pointer clears the midpoint of an adjacent row.
    const prev = rowRefs.current[from - 1]
    if (prev) {
      const r = prev.getBoundingClientRect()
      if (ev.clientY < r.top + r.height / 2) {
        moveExercise(from, from - 1)
        dragFrom.current = from - 1
        setDragIndex(from - 1)
        return
      }
    }
    const next = rowRefs.current[from + 1]
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

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the template a name.')
      return
    }
    if (kind === 'strength' && exercises.length === 0) {
      setError('Add at least one exercise.')
      return
    }
    setBusy(true)
    setError(null)
    const template: Template =
      kind === 'strength'
        ? { id: initial?.id ?? crypto.randomUUID(), name: trimmed, kind, exercises }
        : {
            id: initial?.id ?? crypto.randomUUID(),
            name: trimmed,
            kind,
            sections: buildIntervals(plan),
          }
    try {
      const res = await api.send('POST', '/api/templates', template)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`)
      dismiss(() => onSaved(template))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save the template',
      )
      setBusy(false)
    }
  }

  function remove() {
    if (!initial || !onDelete) return
    if (!window.confirm('Delete this template?')) return
    setBusy(true)
    void onDelete(initial).then((ok) => {
      if (ok) dismiss(onCancel)
      else setBusy(false)
    })
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onCancel)}
      onExited={onExited}
      title={initial ? 'Edit template' : 'New template'}
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor={nameId}>
          <TextInput
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Segment
          block
          options={KIND_OPTIONS}
          value={kind}
          onChange={setKind}
          ariaLabel="Kind"
        />

        {kind === 'strength' ? (
          <>
            {exercises.length > 0 && (
              <div className="flex flex-col">
                {exercises.map((e, i) => {
                  const muscle =
                    e.muscle !== undefined ? `${e.muscle} · slot` : lookup(e.name)
                  return (
                    <div
                      key={i}
                      ref={(el) => {
                        rowRefs.current[i] = el
                      }}
                      className={`flex flex-col gap-2 py-2 ${
                        dragIndex === i ? 'rounded-md bg-surface shadow-float' : ''
                      }`}
                    >
                      {i > 0 && dragIndex !== i && (
                        <div aria-hidden="true" className="h-px bg-hairline" />
                      )}
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body font-medium text-ink">
                            {e.name}
                          </p>
                          {muscle && (
                            <p className="text-caption text-ink-2">{muscle}</p>
                          )}
                        </div>
                        <IconButton
                          size="sm"
                          label="Reorder"
                          onPointerDown={(ev) => onHandlePointerDown(i, ev)}
                          onPointerMove={onHandlePointerMove}
                          onPointerUp={onHandlePointerUp}
                          onPointerCancel={onHandlePointerUp}
                          className="touch-none cursor-grab select-none"
                        >
                          <IconGrip />
                        </IconButton>
                        <IconButton
                          size="sm"
                          label="Remove"
                          onClick={() =>
                            setExercises(exercises.filter((_, j) => j !== i))
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
                          ariaLabel={`Sets for ${e.name}`}
                          min={1}
                          max={30}
                          value={e.setCount}
                          onChange={(n) =>
                            setExercises((prev) =>
                              prev.map((x, j) =>
                                j === i ? { ...x, setCount: n } : x,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <Field label="Exercise" htmlFor={exId}>
              <TextInput
                id={exId}
                list="template-exercise-names"
                value={exName}
                onChange={(e) => setExName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExercise()}
              />
              <datalist id="template-exercise-names">
                {names.map((n) => (
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
            <Button variant="quiet" block onClick={addExercise}>
              Add exercise
            </Button>

            <Field label="Slot" htmlFor={slotId}>
              <div className="flex gap-2">
                <select
                  id={slotId}
                  className={`${SELECT_WELL} min-w-0 flex-1`}
                  value={slotMuscle}
                  onChange={(e) => setSlotMuscle(e.target.value)}
                >
                  {MUSCLE_GROUPS.filter((m) => m !== 'other').map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <Button variant="quiet" onClick={addSlot}>
                  Add slot
                </Button>
              </div>
            </Field>
          </>
        ) : (
          <PlanFields plan={plan} onChange={setPlan} />
        )}

        {error && <Banner tone="error">{error}</Banner>}

        <Button variant="primary" block disabled={busy} onClick={save}>
          Save
        </Button>
        {initial && onDelete && (
          <Button variant="ghost-danger" block disabled={busy} onClick={remove}>
            Delete
          </Button>
        )}
        <Button variant="ghost" block onClick={() => dismiss(onCancel)}>
          Cancel
        </Button>
      </div>
    </Sheet>
  )
}
