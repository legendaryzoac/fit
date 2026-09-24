import { IconCheck, IconPlus, IconX } from '../shell/icons'
import { NO_SPINNER, WELL_FOCUS } from './Field'

export interface SetField {
  key: string
  value: number | undefined
  placeholder: string
  ariaLabel: string
  inputMode: 'numeric' | 'decimal'
  onChange: (value: number | undefined) => void
}

// [number, fields..., check, remove]; the check column drops when the row
// has no done state (rep logging after a timer). Static strings so
// Tailwind sees every template.
const GRID: Record<'check' | 'plain', Record<number, string>> = {
  check: {
    2: 'grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_44px_36px]',
    3: 'grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_44px_36px]',
  },
  plain: {
    2: 'grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_36px]',
    3: 'grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_36px]',
  },
}

function grid(n: number, check: boolean): string {
  return `grid items-center gap-2 ${GRID[check ? 'check' : 'plain'][n]}`
}

const CELL =
  'motion-quick min-h-11 w-full min-w-0 rounded-sm bg-surface-2 text-center text-title-sm font-semibold text-ink ' +
  `placeholder:font-medium placeholder:text-ink-4 transition-[background-color,box-shadow] ${WELL_FOCUS} ${NO_SPINNER}`

/** One logged set: number circle, the fields, a check and a remove. */
export function SetRow({
  index,
  fields,
  done = false,
  onToggleDone,
  onRemove,
  ghost,
}: {
  /** 1-based */
  index: number
  fields: SetField[]
  done?: boolean
  /** Absent: the row has no done state and shows no check. */
  onToggleDone?: () => void
  onRemove: () => void
  /** e.g. "Last time 185 × 7 @ 9.5" */
  ghost?: string
}) {
  const check = onToggleDone !== undefined
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className={grid(fields.length, check)}>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-pill text-caption font-semibold ${
            done ? 'bg-brand-soft text-brand-strong' : 'bg-surface-2 text-ink-2'
          }`}
        >
          {index}
        </span>
        {fields.map((f) => (
          <input
            key={f.key}
            type="number"
            inputMode={f.inputMode}
            aria-label={f.ariaLabel}
            placeholder={f.placeholder}
            value={f.value ?? ''}
            onChange={(e) =>
              f.onChange(e.target.value === '' ? undefined : Number(e.target.value))
            }
            className={CELL}
          />
        ))}
        {check && (
          <button
            type="button"
            onClick={onToggleDone}
            aria-pressed={done}
            aria-label={`Set ${index} done`}
            className={`pressable motion-base flex h-11 w-11 items-center justify-center rounded-pill transition-[background-color,color] ${
              done
                ? 'bg-brand text-on-brand'
                : 'bg-surface-2 text-ink-4 hover:bg-surface-3'
            }`}
          >
            <IconCheck />
          </button>
        )}
        {done ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove set ${index}`}
            className="pressable flex h-9 w-9 items-center justify-center rounded-pill text-ink-3 hover:bg-surface-2"
          >
            <IconX className="h-4 w-4" />
          </button>
        )}
      </div>
      {ghost && <p className="ml-9 text-micro text-ink-3">{ghost}</p>}
    </div>
  )
}

/** Column labels over the fields, on the same grid as the rows. */
export function SetHeader({
  labels,
  check = true,
}: {
  labels: string[]
  check?: boolean
}) {
  return (
    <div className={grid(labels.length, check)} aria-hidden="true">
      <span />
      {labels.map((l) => (
        <span key={l} className="text-center text-micro text-ink-3">
          {l}
        </span>
      ))}
      {check && <span />}
      <span />
    </div>
  )
}

export function AddSetButton({
  onClick,
  label = 'Add set',
}: {
  onClick: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 text-caption font-semibold text-brand-strong hover:bg-brand-soft"
    >
      <IconPlus className="h-4 w-4" />
      {label}
    </button>
  )
}
