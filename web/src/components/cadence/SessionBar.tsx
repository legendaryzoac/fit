import type { ReactNode } from 'react'

export type ProgressTone = 'brand' | 'effort' | 'rest' | 'caution'

const FILL: Record<ProgressTone, string> = {
  brand: 'bg-brand',
  effort: 'bg-ember',
  rest: 'bg-sky',
  caution: 'bg-amber',
}

/** A thin track; value is a 0–1 fraction. */
export function Progress({
  value,
  tone = 'brand',
  label,
}: {
  value: number
  tone?: ProgressTone
  label?: string
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1 w-full overflow-hidden rounded-pill bg-surface-3"
    >
      <div
        className={`h-full rounded-pill transition-[width] duration-[320ms] ease-out ${FILL[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * The bar at the top of a session sheet, passed as the Sheet's `header`
 * so it stays put while the body scrolls: a 44px control on the left,
 * the clock or title in the middle, an action on the right. `progress`
 * rides underneath, full-bleed.
 */
export function SessionBar({
  left,
  center,
  right,
  progress,
}: {
  left?: ReactNode
  center: ReactNode
  right?: ReactNode
  progress?: ReactNode
}) {
  return (
    <div className="-mx-6">
      <div className="grid grid-cols-[44px_1fr_auto] items-center gap-3 px-4 py-2">
        <div className="flex h-11 w-11 items-center justify-center">{left}</div>
        <div className="min-w-0">{center}</div>
        <div className="flex items-center">{right}</div>
      </div>
      {progress}
    </div>
  )
}
