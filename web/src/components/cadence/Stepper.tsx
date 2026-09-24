import { useState } from 'react'
import { IconMinus, IconPlus } from '../shell/icons'
import { NO_SPINNER } from './Field'

/**
 * A number well with minus and plus. While focused the input holds
 * whatever was typed (including nothing) and commits only values that
 * parse; leaving it empty or invalid restores the last committed value.
 * The buttons clamp to min and max.
 */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  ariaLabel,
  placeholder,
  id,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  ariaLabel: string
  placeholder?: string
  id?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (n: number) =>
    Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))

  return (
    <div className="motion-quick inline-flex rounded-sm bg-surface-2 transition-[background-color,box-shadow] focus-within:bg-surface focus-within:[box-shadow:inset_0_0_0_1.5px_var(--brand)]">
      <button
        type="button"
        aria-label={`${ariaLabel} down`}
        onClick={() => onChange(clamp(value - step))}
        className="pressable flex h-11 w-11 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-3"
      >
        <IconMinus />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        placeholder={placeholder}
        min={min}
        max={max}
        value={draft ?? value}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          const n = Math.round(Number(raw))
          if (raw.trim() === '' || !Number.isFinite(n)) return
          onChange(clamp(n))
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className={`min-h-11 w-16 min-w-0 bg-transparent text-center text-title-sm font-semibold text-ink placeholder:font-medium placeholder:text-ink-4 focus-visible:outline-none ${NO_SPINNER}`}
      />
      <button
        type="button"
        aria-label={`${ariaLabel} up`}
        onClick={() => onChange(clamp(value + step))}
        className="pressable flex h-11 w-11 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-3"
      >
        <IconPlus />
      </button>
    </div>
  )
}
