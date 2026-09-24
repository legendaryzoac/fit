import { useId } from 'react'

/** A labelled toggle row; the label click flips it too. */
export function Switch({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  help?: string
}) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <label htmlFor={id} className="flex min-w-0 flex-col">
        <span className="text-body font-medium text-ink">{label}</span>
        {help && <span className="text-caption text-ink-3">{help}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`motion-base relative h-8 w-[52px] shrink-0 rounded-pill transition-colors ${
          checked ? 'bg-brand' : 'bg-surface-3'
        }`}
      >
        <span
          aria-hidden="true"
          className={`motion-base absolute top-1 left-1 h-6 w-6 rounded-pill bg-surface shadow-lift transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}
