import { useId, useState } from 'react'
import { fromLb, toLb, type WeightUnit } from '../lib/units'
import type { WeightEntry } from '../lib/weights'
import { Button } from './cadence/Button'
import { Card } from './cadence/Card'
import { NO_SPINNER } from './cadence/Field'
import { IconButton } from './cadence/IconButton'
import { IconX } from './shell/icons'

/** Server bounds on a weight, in pounds. */
const MIN_LB = 40
const MAX_LB = 1200

/**
 * The morning weigh-in: a page with one number on it, shown in place of
 * Today before noon on a day with no entry yet. Logging it brings Today
 * back; the X waves it off until tomorrow. The field opens on the last
 * weight, so "same as yesterday" is one tap and a change is a few digits.
 */
export function WeighIn({
  last,
  unit,
  onSave,
  onDismiss,
}: {
  /** The newest entry, for the prefill and the "last" line. */
  last?: WeightEntry
  unit: WeightUnit
  /** Stored pounds, already validated. */
  onSave: (lb: number) => void
  onDismiss: () => void
}) {
  const id = useId()
  const lastShown = last ? fromLb(last.lb, unit) : undefined
  const [draft, setDraft] = useState(
    lastShown === undefined ? '' : String(lastShown),
  )
  const [error, setError] = useState<string | null>(null)

  function save() {
    const typed = Number(draft)
    const lb =
      draft.trim() !== '' && Number.isFinite(typed) ? toLb(typed, unit) : NaN
    if (!Number.isFinite(lb) || lb < MIN_LB || lb > MAX_LB) {
      setError(
        `Enter a weight between ${fromLb(MIN_LB, unit)} and ${fromLb(MAX_LB, unit)} ${unit}.`,
      )
      return
    }
    onSave(lb)
  }

  const lastDate = last
    ? new Date(`${last.date}T12:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-title-lg text-ink">Good morning</h1>
          <p className="text-caption text-ink-2">Step on the scale</p>
        </div>
        <IconButton label="Not today" onClick={onDismiss}>
          <IconX />
        </IconButton>
      </div>

      <Card hero>
        <label htmlFor={id} className="text-eyebrow text-ink-2">
          Weight
        </label>
        <div className="mt-2 flex items-baseline gap-2">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step="0.1"
            autoFocus
            value={draft}
            placeholder={lastShown === undefined ? '—' : String(lastShown)}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className={`min-w-0 flex-1 bg-transparent text-display-lg text-ink placeholder:text-ink-4 focus-visible:outline-none ${NO_SPINNER}`}
          />
          <span className="text-title-sm text-ink-2">{unit}</span>
        </div>
        <p className="mt-1 text-caption text-ink-3">
          {last ? `Last ${lastDate} · ${lastShown} ${unit}` : 'First entry'}
        </p>
        {error && <p className="mt-2 text-caption text-rose-strong">{error}</p>}
        <Button variant="primary" block className="mt-4" onClick={save}>
          Log weight
        </Button>
        <Button variant="ghost" block className="mt-1" onClick={onDismiss}>
          Not today
        </Button>
      </Card>
    </div>
  )
}
