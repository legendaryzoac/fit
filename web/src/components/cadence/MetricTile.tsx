import { Sparkline, type SparkTone } from './Sparkline'

export type DeltaTone = 'up' | 'down' | 'neutral'

const DELTA: Record<DeltaTone, string> = {
  up: 'text-brand-strong',
  down: 'text-rose-strong',
  neutral: 'text-ink-3',
}

/** A stat tile: label, value with unit, a delta line and a sparkline. */
export function MetricTile({
  label,
  value,
  unit,
  delta,
  deltaTone = 'neutral',
  values,
  tone = 'brand',
  onClick,
}: {
  label: string
  value: string | number
  unit?: string
  delta?: string
  deltaTone?: DeltaTone
  values: number[]
  tone?: SparkTone
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="text-eyebrow text-ink-2">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-numeric-lg text-ink">{value}</span>
        {unit && (
          <span className="text-caption font-semibold text-ink-2">{unit}</span>
        )}
      </div>
      {delta && (
        <div className={`text-caption font-semibold ${DELTA[deltaTone]}`}>
          {delta}
        </div>
      )}
      <div className="mt-2">
        <Sparkline values={values} tone={tone} />
      </div>
    </>
  )
  const cls = 'block w-full rounded-md bg-surface p-3.5 shadow-lift'
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`pressable text-left ${cls}`}
      >
        {body}
      </button>
    )
  }
  return <div className={cls}>{body}</div>
}
