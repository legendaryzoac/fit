import { useMemo, useRef, useState } from 'react'
import type { Api } from '../lib/api'
import {
  EXERCISES,
  MUSCLE_GROUPS,
  SPEED_DRILLS,
  makeMuscleLookup,
  type CustomExercise,
} from '../lib/exercises'
import { BUILTIN_ROUTINES, STRETCH_NAMES } from '../lib/routines'
import { stretchByName } from '../lib/stretches'
import {
  buildIntervals,
  DEFAULT_PLAN,
  DEFAULT_TRANSITION_SEC,
  fmtSec,
  planFromSections,
  routineToSections,
  totalSec,
  type QuickIntervalPlan,
  type RoutineItem,
  type Template,
  type TemplateExercise,
} from '../lib/templates'
import type { WorkoutKind } from '../lib/workouts'
import { buttonClass, inputClass, NumberField } from './ui'

export const KIND_STYLE: Record<WorkoutKind, string> = {
  strength: 'bg-accent-100 text-accent-800',
  speed: 'bg-ink text-paper',
  cardio: 'bg-accent2-100 text-accent2-800',
  recovery: 'bg-gold-500/25 text-gold-700',
}

const PLAN_FIELDS: Array<{
  key: keyof QuickIntervalPlan
  label: string
  min: number
  max: number
}> = [
  { key: 'warmupSec', label: 'Warm up (sec)', min: 0, max: 7200 },
  { key: 'workSec', label: 'Work (sec)', min: 1, max: 7200 },
  { key: 'restSec', label: 'Rest (sec)', min: 0, max: 7200 },
  { key: 'sets', label: 'Sets', min: 1, max: 99 },
  { key: 'cooldownSec', label: 'Cool down (sec)', min: 0, max: 7200 },
]

export function PlanFields({
  plan,
  onChange,
}: {
  plan: QuickIntervalPlan
  onChange: (plan: QuickIntervalPlan) => void
}) {
  const sections = useMemo(() => buildIntervals(plan), [plan])
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PLAN_FIELDS.map(({ key, label, min, max }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink/55">
              {label}
            </span>
            <NumberField
              aria-label={label}
              min={min}
              max={max}
              value={plan[key]}
              onCommit={(n) => onChange({ ...plan, [key]: n })}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-ink/55">
        {sections.length} sections · {fmtSec(totalSec(sections))} total ·{' '}
        {sections.map((s) => s.label[0]).join('·')}
      </p>
    </div>
  )
}

export function TemplateBuilder({
  api,
  customs,
  initial,
  onSaveCustom,
  onSaved,
  onCancel,
}: {
  api: Api
  customs: CustomExercise[]
  initial?: Template
  onSaveCustom: (name: string, muscle: string) => void
  onSaved: (t: Template) => void
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
  // Recovery routines: an ordered list of holds/drills, edited in place
  const [items, setItems] = useState<RoutineItem[]>(initial?.items ?? [])
  const [transitionSec, setTransitionSec] = useState(
    initial?.transitionSec ?? DEFAULT_TRANSITION_SEC,
  )
  const [stretchName, setStretchName] = useState('')
  const [scaleMin, setScaleMin] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  function reorder<T>(prev: T[], from: number, to: number): T[] {
    const next = [...prev]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }

  /** The drag handles serve whichever list the current kind edits. */
  function moveExercise(from: number, to: number) {
    if (from === to) return
    if (kind === 'recovery') setItems((prev) => reorder(prev, from, to))
    else setExercises((prev) => reorder(prev, from, to))
  }

  function addStretch() {
    const trimmed = stretchName.trim()
    if (!trimmed) return
    const s = stretchByName(trimmed)
    setItems([
      ...items,
      {
        name: s?.name ?? trimmed,
        seconds: s?.defaultSec ?? 30,
        ...(s?.perSide && { perSide: true }),
      },
    ])
    setStretchName('')
  }

  function patchItem(i: number, patch: Partial<RoutineItem>) {
    setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  }

  /** Stretch or shrink every hold so the whole routine lands on N minutes. */
  function scaleTo(minutes: number) {
    const current = totalSec(routineToSections(items, transitionSec))
    if (current === 0) return
    const overhead = current - items.reduce((s, it) => s + it.seconds * (it.perSide ? 2 : 1), 0)
    const holdBudget = Math.max(60, minutes * 60 - overhead)
    const holdNow = current - overhead
    const factor = holdBudget / holdNow
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        seconds: Math.min(300, Math.max(10, Math.round((it.seconds * factor) / 5) * 5)),
      })),
    )
  }

  const routineTotal = totalSec(routineToSections(items, transitionSec))

  function onHandlePointerDown(ei: number, ev: React.PointerEvent) {
    ev.preventDefault()
    // preventDefault also suppresses the focus change a press would cause,
    // so end any in-progress field edit explicitly — a NumberField draft is
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
    if (kind === 'recovery' && items.length === 0) {
      setError('Add at least one stretch.')
      return
    }
    setBusy(true)
    setError(null)
    const id = initial?.id ?? crypto.randomUUID()
    const template: Template =
      kind === 'strength'
        ? { id, name: trimmed, kind, exercises }
        : kind === 'recovery'
          ? { id, name: trimmed, kind, items, transitionSec }
          : { id, name: trimmed, kind, sections: buildIntervals(plan) }
    try {
      const res = await api.send('POST', '/api/templates', template)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`)
      onSaved(template)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save the template',
      )
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          {initial ? 'Edit template' : 'New template'}
        </h1>
        <button
          onClick={onCancel}
          className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <div className="flex border border-ink/40">
        {(['strength', 'speed', 'cardio', 'recovery'] as const).map((k, ki) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${
              ki > 0 ? 'border-l border-ink/40 ' : ''
            }${
              kind === k
                ? `font-extrabold ${KIND_STYLE[k]}`
                : 'text-ink/60 hover:bg-ink/5'
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <input
        className={inputClass}
        placeholder={
          kind === 'recovery'
            ? 'routine name (e.g. Evening hips)'
            : 'template name (e.g. Upper A, Track Tuesday)'
        }
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {kind === 'strength' ? (
        <>
          {exercises.map((e, i) => (
            <div
              key={i}
              ref={(el) => {
                rowRefs.current[i] = el
              }}
              className={`flex items-center gap-2 border p-1 ${
                dragIndex === i
                  ? 'border-accent opacity-60'
                  : 'border-transparent'
              }`}
            >
              <button
                onPointerDown={(ev) => onHandlePointerDown(i, ev)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                aria-label={`reorder ${e.name}`}
                className="touch-none cursor-grab select-none px-1 text-base leading-none text-ink/45 hover:text-ink"
              >
                ≡
              </button>
              <span className="flex-1 truncate text-sm text-ink">
                {e.muscle !== undefined && (
                  <span className="mr-1.5 bg-accent-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-800">
                    slot
                  </span>
                )}
                {e.name}
              </span>
              <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/55">
                sets
                <NumberField
                  className={`${inputClass} w-16 text-center`}
                  aria-label={`sets for ${e.name}`}
                  min={1}
                  max={30}
                  value={e.setCount}
                  onCommit={(n) =>
                    setExercises((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, setCount: n } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                onClick={() => setExercises(exercises.filter((_, j) => j !== i))}
                className="text-ink/45 hover:text-accent-700"
                aria-label="remove exercise"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              className={inputClass}
              list="template-exercise-names"
              placeholder="add exercise…"
              value={exName}
              onChange={(e) => setExName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addExercise()}
            />
            <datalist id="template-exercise-names">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button onClick={addExercise} className={`${buttonClass} shrink-0`}>
              Add
            </button>
          </div>
          {typedUnknown && (
            <label className="flex items-center gap-2 text-xs text-ink/55">
              new exercise — muscle group:
              <select
                className={`${inputClass} w-auto py-1.5`}
                value={newMuscle}
                onChange={(e) => setNewMuscle(e.target.value)}
              >
                {MUSCLE_GROUPS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-ink/55">
            or a generic slot:
            <select
              className={`${inputClass} w-auto py-1.5`}
              value={slotMuscle}
              onChange={(e) => setSlotMuscle(e.target.value)}
            >
              {MUSCLE_GROUPS.filter((m) => m !== 'other').map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              onClick={addSlot}
              className="border border-ink/40 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-ink/5"
            >
              Add slot
            </button>
          </label>
        </>
      ) : kind === 'recovery' ? (
        <>
          {items.length === 0 && (
            <label className="flex items-center gap-2 text-xs text-ink/55">
              start from a built-in routine:
              <select
                className={`${inputClass} w-auto py-1.5`}
                defaultValue=""
                onChange={(e) => {
                  const r = BUILTIN_ROUTINES.find((x) => x.id === e.target.value)
                  if (!r) return
                  setItems(r.items.map((it) => ({ ...it })))
                  setTransitionSec(r.transitionSec)
                  if (!name) setName(`${r.name} (mine)`)
                }}
              >
                <option value="">choose…</option>
                {BUILTIN_ROUTINES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {items.map((it, i) => (
            <div
              key={i}
              ref={(el) => {
                rowRefs.current[i] = el
              }}
              className={`flex items-center gap-2 border p-1 ${
                dragIndex === i
                  ? 'border-accent opacity-60'
                  : 'border-transparent'
              }`}
            >
              <button
                onPointerDown={(ev) => onHandlePointerDown(i, ev)}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                aria-label={`reorder ${it.name}`}
                className="touch-none cursor-grab select-none px-1 text-base leading-none text-ink/45 hover:text-ink"
              >
                ≡
              </button>
              <span className="flex-1 truncate text-sm text-ink">{it.name}</span>
              <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/55">
                sec
                <NumberField
                  className={`${inputClass} w-16 text-center`}
                  aria-label={`seconds for ${it.name}`}
                  min={5}
                  max={600}
                  value={it.seconds}
                  onCommit={(n) => patchItem(i, { seconds: n })}
                />
              </label>
              <button
                onClick={() => patchItem(i, { perSide: !it.perSide || undefined })}
                aria-label={`per side for ${it.name}`}
                title="Each side separately"
                className={`px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
                  it.perSide
                    ? 'bg-gold-500 text-ink'
                    : 'border border-ink/40 text-ink/50 hover:bg-ink/5'
                }`}
              >
                L/R
              </button>
              <button
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="text-ink/45 hover:text-accent-700"
                aria-label="remove stretch"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              className={inputClass}
              list="template-stretch-names"
              placeholder="add stretch…"
              value={stretchName}
              onChange={(e) => setStretchName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStretch()}
            />
            <datalist id="template-stretch-names">
              {STRETCH_NAMES.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button onClick={addStretch} className={`${buttonClass} shrink-0`}>
              Add
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink/55">
            <label className="flex items-center gap-1.5">
              lead-in
              <NumberField
                className={`${inputClass} w-16 text-center`}
                aria-label="seconds between stretches"
                min={0}
                max={30}
                value={transitionSec}
                onCommit={setTransitionSec}
              />
              sec
            </label>
            <label className="flex items-center gap-1.5">
              scale to
              <NumberField
                className={`${inputClass} w-16 text-center`}
                aria-label="target minutes"
                min={2}
                max={60}
                value={scaleMin}
                onCommit={setScaleMin}
              />
              min
              <button
                onClick={() => scaleTo(scaleMin)}
                disabled={items.length === 0}
                className="border border-ink/40 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-ink/5 disabled:opacity-45"
              >
                Apply
              </button>
            </label>
            <span>
              {items.length} stretches · {fmtSec(routineTotal)} total
            </span>
          </div>
        </>
      ) : (
        <PlanFields plan={plan} onChange={setPlan} />
      )}

      {error && <p className="text-sm font-semibold text-accent-700">{error}</p>}

      <button
        onClick={save}
        disabled={busy}
        className={`${buttonClass} w-full justify-between`}
      >
        <span>{busy ? 'Saving…' : 'Save template'}</span>
        <span>→</span>
      </button>
    </div>
  )
}
