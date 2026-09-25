import { IconCheck } from '../shell/icons'

export interface WeekDay {
  label: string
  num: number
  done: boolean
  planned: boolean
  today: boolean
  /** A recovery session was logged this day — a quiet amber dot, never
   * a face change (a stretch is not a training day). */
  recovered?: boolean
}

/** Seven day circles: rest, planned or done, with a ring on today. */
export function WeekStrip({ days }: { days: WeekDay[] }) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((d, i) => {
        const face = d.done
          ? 'bg-brand text-on-brand'
          : d.planned
            ? 'bg-brand-soft text-brand-strong'
            : 'bg-surface-2 text-ink-3'
        return (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <span className="text-micro text-ink-3">{d.label}</span>
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-pill text-caption font-semibold ${face}`}
              style={
                d.today
                  ? {
                      boxShadow:
                        '0 0 0 2px var(--surface), 0 0 0 4px var(--brand)',
                    }
                  : undefined
              }
            >
              {d.done ? (
                <IconCheck className="h-4 w-4 [stroke-width:2.5]" />
              ) : (
                d.num
              )}
            </span>
            {/* Slot always reserved so the row never jumps on a recovered day */}
            <span
              aria-hidden="true"
              className={`h-1 w-1 rounded-pill ${d.recovered ? 'bg-amber' : 'bg-transparent'}`}
            />
          </div>
        )
      })}
    </div>
  )
}
