import { useId, useMemo, useState } from 'react'
import { EXERCISES, type CustomExercise } from '../lib/exercises'
import type { Template } from '../lib/templates'
import type { Workout } from '../lib/workouts'
import { Button } from './cadence/Button'
import { Card } from './cadence/Card'
import { Field, TextInput } from './cadence/Field'
import { Sheet } from './shell/Sheet'
import { useSheetDismiss } from './shell/useSheetDismiss'

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  /** Set up the session on the click (drafts, lock screen) and hand back
   * what runs once the sheet has dropped; null when the start was
   * declined and the sheet stays up. */
  onStart: (
    exercises: Array<{ name: string; setCount: number }>,
  ) => Promise<(() => void) | null>
  /** Runs once the sheet has dropped. */
  onCancel: () => void
}) {
  const entries = template.exercises ?? []
  const id = useId()
  const { open, dismiss, onExited } = useSheetDismiss()

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

  async function start() {
    const then = await onStart(
      entries.map((entry, i) => ({
        name: entry.muscle === undefined ? entry.name : picks[i].trim(),
        setCount: entry.setCount,
      })),
    )
    if (then) dismiss(then)
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onCancel)}
      onExited={onExited}
      title="Fill in"
    >
      <div className="flex flex-col gap-3">
        {entries.map((entry, i) =>
          entry.muscle === undefined ? (
            <Card key={i}>
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-body font-medium text-ink">
                  {entry.name}
                </p>
                <span className="shrink-0 text-caption text-ink-2">
                  {entry.setCount} sets
                </span>
              </div>
            </Card>
          ) : (
            <Card key={i}>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption text-ink-2">
                    {capitalise(entry.muscle)}
                  </span>
                  <span className="text-caption text-ink-2">
                    {entry.setCount} sets
                  </span>
                </div>
                <Field label="Exercise" htmlFor={`${id}-${i}`}>
                  <TextInput
                    id={`${id}-${i}`}
                    list={`${id}-choices-${i}`}
                    value={picks[i]}
                    onChange={(e) =>
                      setPicks((prev) =>
                        prev.map((p, j) => (j === i ? e.target.value : p)),
                      )
                    }
                  />
                  <datalist id={`${id}-choices-${i}`}>
                    {choices(entry.muscle).map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </Field>
              </div>
            </Card>
          ),
        )}

        <Button variant="primary" block disabled={!allFilled} onClick={start}>
          Start
        </Button>
      </div>
    </Sheet>
  )
}
