import { useMemo, useState } from 'react'
import { EXERCISES, type CustomExercise } from '../lib/exercises'
import type { Template } from '../lib/templates'
import type { Workout } from '../lib/workouts'
import { buttonClass, inputClass } from './ui'

/**
 * Pre-session picker for templates with generic slots ("quads exercise 1"):
 * each slot offers the exercises of its muscle group, defaulting to the one
 * most recently trained, and free-typing anything else is allowed.
 */
export function SlotFill({
  template,
  customs,
  lookup,
  history,
  onStart,
  onCancel,
}: {
  template: Template
  customs: CustomExercise[]
  lookup: (name: string) => string | undefined
  /** Sorted newest-first — used for choices and most-recent defaults. */
  history: Workout[]
  onStart: (exercises: Array<{ name: string; setCount: number }>) => void
  onCancel: () => void
}) {
  const entries = template.exercises ?? []

  const choices = useMemo(() => {
    const byMuscle = new Map<string, Set<string>>()
    const add = (muscle: string | undefined, name: string) => {
      if (!muscle) return
      let set = byMuscle.get(muscle)
      if (!set) byMuscle.set(muscle, (set = new Set()))
      set.add(name)
    }
    for (const e of EXERCISES) add(e.muscle, e.name)
    for (const c of customs) add(c.muscle, c.name)
    for (const w of history) {
      if (w.kind !== 'strength') continue
      for (const e of w.exercises) add(lookup(e.name), e.name)
    }
    return (muscle: string) => [...(byMuscle.get(muscle) ?? [])].sort()
  }, [customs, history, lookup])

  const [picks, setPicks] = useState<string[]>(() => {
    // Two slots of the same muscle must not default to the same lift —
    // walk history newest-first handing out distinct recent exercises.
    const taken = new Set<string>()
    return entries.map((entry) => {
      if (entry.muscle === undefined) return entry.name
      for (const w of history) {
        if (w.kind !== 'strength') continue
        for (const e of w.exercises) {
          if (lookup(e.name) === entry.muscle && !taken.has(e.name)) {
            taken.add(e.name)
            return e.name
          }
        }
      }
      return ''
    })
  })

  const allFilled = picks.every((p) => p.trim().length > 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          {template.name} — pick today’s exercises
        </h1>
        <button
          onClick={onCancel}
          className="text-[10px] font-semibold uppercase tracking-widest text-ink/45 hover:text-ink"
        >
          Cancel
        </button>
      </div>

      {entries.map((entry, i) =>
        entry.muscle === undefined ? (
          <div
            key={i}
            className="flex items-baseline justify-between border border-ink/40 p-3"
          >
            <span className="text-sm font-semibold text-ink">{entry.name}</span>
            <span className="text-xs text-ink/55">{entry.setCount} sets</span>
          </div>
        ) : (
          <label
            key={i}
            className="flex flex-col gap-1.5 border border-ink/40 p-3"
          >
            <span className="flex items-baseline justify-between text-xs text-ink/55">
              <span>
                <span className="mr-1.5 bg-accent-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-800">
                  {entry.muscle}
                </span>
                {entry.name}
              </span>
              <span>{entry.setCount} sets</span>
            </span>
            <input
              className={inputClass}
              list={`slot-choices-${i}`}
              placeholder={`pick a ${entry.muscle} exercise…`}
              value={picks[i]}
              onChange={(e) =>
                setPicks((prev) =>
                  prev.map((p, j) => (j === i ? e.target.value : p)),
                )
              }
            />
            <datalist id={`slot-choices-${i}`}>
              {choices(entry.muscle).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
        ),
      )}

      <button
        disabled={!allFilled}
        onClick={() =>
          onStart(
            entries.map((entry, i) => ({
              name: entry.muscle === undefined ? entry.name : picks[i].trim(),
              setCount: entry.setCount,
            })),
          )
        }
        className={`${buttonClass} w-full justify-between`}
      >
        Start workout<span>→</span>
      </button>
    </div>
  )
}
