import { rovingKeyDown, rovingTabIndex } from './roving'

/** A sideways-scrolling row of pill chips; the selected one is brand-soft. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={(e) =>
        rovingKeyDown(e, options, value, onChange, '[role="tab"]')
      }
      className="scroll-thin -mx-gutter flex gap-2 overflow-x-auto px-gutter"
    >
      {options.map((o, i) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={rovingTabIndex(options, value, i)}
            onClick={() => onChange(o.value)}
            className={`pressable h-9 shrink-0 rounded-pill px-3.5 text-[14px] ${
              selected
                ? 'bg-brand-soft font-semibold text-brand-strong'
                : 'bg-surface-2 font-medium text-ink-2'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
