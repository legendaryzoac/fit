import { rovingKeyDown, rovingTabIndex } from '../shell/roving'

/**
 * An integer scale as one row of equal cells: session effort and
 * perceived recovery, 0 to 10. One Tab stop, arrows move the choice.
 */
export function ScaleRow({
  label,
  low,
  high,
  value,
  onChange,
  min = 0,
  max = 10,
}: {
  label: string
  low: string
  high: string
  value: number | undefined
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => ({
    value: String(min + i),
  }))
  const current = value === undefined ? undefined : String(value)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-caption font-semibold text-ink-2">{label}</span>
        <span className="text-caption text-ink-3">
          {low} to {high}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={(e) =>
          rovingKeyDown(
            e,
            options,
            current,
            (v) => onChange(Number(v)),
            '[role="radio"]',
          )
        }
        className="grid gap-0.5 rounded-md bg-surface-2 p-1"
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        }}
      >
        {options.map((o, i) => {
          const selected = o.value === current
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${label} ${o.value}`}
              tabIndex={rovingTabIndex(options, current, i)}
              onClick={() => onChange(Number(o.value))}
              className={`motion-base h-9 min-w-0 rounded-sm text-caption tabular-nums transition-[background-color,color] ${
                selected
                  ? 'bg-brand font-semibold text-on-brand'
                  : 'font-medium text-ink-2 hover:bg-surface-3'
              }`}
            >
              {o.value}
            </button>
          )
        })}
      </div>
    </div>
  )
}
