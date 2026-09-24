import { rovingKeyDown, rovingTabIndex } from './roving'

/** Segmented control: one pill container, the chosen option lifts. */
export function Segment<T extends string>({
  options,
  value,
  onChange,
  block = false,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>
  value: T | undefined
  onChange: (v: T) => void
  block?: boolean
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={(e) =>
        rovingKeyDown(e, options, value, onChange, '[role="radio"]')
      }
      className={`inline-flex rounded-pill bg-surface-2 p-1 ${block ? 'w-full' : ''}`}
    >
      {options.map((o, i) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={rovingTabIndex(options, value, i)}
            onClick={() => onChange(o.value)}
            className={`motion-base h-8 rounded-pill text-[14px] whitespace-nowrap transition-[background-color,color,box-shadow] ${
              block ? 'flex-1 px-2' : 'px-3.5'
            } ${
              selected
                ? 'bg-surface font-semibold text-ink shadow-lift'
                : 'font-medium text-ink-2'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
