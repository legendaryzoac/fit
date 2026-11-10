import { isSession, planItemDone } from '../../lib/agent/dayplan'
import type { DayPlan, DayPlanItem } from '../../lib/agent/types'
import { localToday } from '../../lib/weights'
import type { Workout } from '../../lib/workouts'
import { Button } from '../cadence/Button'
import { IconCheck } from '../shell/icons'

function itemLine(item: DayPlanItem): string | null {
  if (!('exercises' in item) || item.exercises.length === 0) return null
  const sets = item.exercises.reduce((n, e) => n + e.sets, 0)
  return `${item.exercises.length} exercises · ${sets} sets`
}

function detailLine(item: DayPlanItem): string | null {
  if (!('exercises' in item) || item.exercises.length === 0) return null
  return item.exercises
    .slice(0, 3)
    .map((e) => (e.target ? `${e.name} ${e.target}` : `${e.name} ${e.sets}`))
    .join(' · ')
}

function trimLine(item: DayPlanItem): string | null {
  if (!('trim' in item) || !item.trim) return null
  const t = item.trim
  const parts: string[] = []
  if (t.keepFirst) parts.push(`first ${t.keepFirst} lifts`)
  if (t.dropSets) parts.push(`${t.dropSets} set${t.dropSets > 1 ? 's' : ''} off each`)
  if (t.holdLoad) parts.push('loads hold')
  for (const s of t.swaps ?? []) {
    parts.push(s.to ? `${s.to} for ${s.from}` : `no ${s.from}`)
  }
  return parts.length ? parts.join(' · ') : null
}

/**
 * The coach's plan for the day: a headline, the reason, then the items in
 * order with a start on each. The first session not yet done carries the
 * primary button; everything logged today is checked off.
 */
export function DayPlanCard({
  plan,
  workouts,
  onStart,
  onAdjust,
  compact = false,
}: {
  plan: DayPlan
  workouts: Workout[]
  onStart: (item: DayPlanItem) => void
  /** Opens the coach to change the plan. */
  onAdjust?: () => void
  /** Inside the conversation: no eyebrow row, tighter. */
  compact?: boolean
}) {
  const today = localToday()
  const stale = plan.date !== today
  const done = plan.items.map((i) => planItemDone(i, workouts, today))
  const mainIndex = plan.items.findIndex((i, n) => isSession(i) && !done[n])
  const time = new Date(plan.createdAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div>
      {!compact && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-eyebrow text-ink-2">Coach plan · {time}</p>
          {onAdjust && (
            <Button variant="ghost" size="sm" onClick={onAdjust}>
              Adjust
            </Button>
          )}
        </div>
      )}
      <h2 className={`text-title text-ink ${compact ? '' : 'mt-0.5'}`}>
        {plan.headline}
      </h2>
      {plan.rationale && (
        <p className="mt-1 text-caption text-ink-2">{plan.rationale}</p>
      )}

      {plan.items.length === 0 ? (
        <p className="mt-3 text-body text-ink-2">Nothing to start. Recover.</p>
      ) : (
        <ol className="mt-3.5 flex flex-col">
          {plan.items.map((item, n) => {
            const isDone = done[n]
            const main = n === mainIndex
            const sub = [
              item.minutes != null ? `${item.minutes} min` : null,
              itemLine(item),
            ]
              .filter(Boolean)
              .join(' · ')
            const trim = trimLine(item)
            return (
              <li key={item.key}>
                {n > 0 && <div aria-hidden="true" className="h-px bg-hairline" />}
                <div className="flex items-center gap-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-pill ${
                      isDone
                        ? 'bg-brand text-on-brand'
                        : main
                          ? 'border-2 border-brand'
                          : 'border-2 border-surface-3'
                    }`}
                  >
                    {isDone && <IconCheck className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-body font-medium ${
                        isDone ? 'text-ink-3' : 'text-ink'
                      }`}
                    >
                      {item.title}
                      {isDone && <span className="sr-only"> (done)</span>}
                    </div>
                    {sub && <div className="text-caption text-ink-2">{sub}</div>}
                    {main && detailLine(item) && (
                      <div className="truncate text-caption text-ink-3">
                        {detailLine(item)}
                      </div>
                    )}
                    {trim && (
                      <div className="text-caption text-brand-strong">{trim}</div>
                    )}
                    {item.note && (
                      <div className="text-caption text-ink-3">{item.note}</div>
                    )}
                  </div>
                  {!isDone && !stale && !main && (
                    <Button
                      variant="quiet"
                      size="sm"
                      className="shrink-0"
                      aria-label={`Start ${item.title}`}
                      onClick={() => onStart(item)}
                    >
                      Start
                    </Button>
                  )}
                </div>
                {main && !stale && (
                  <Button
                    variant="primary"
                    block
                    className="mb-2.5"
                    aria-label={`Start session: ${item.title}`}
                    onClick={() => onStart(item)}
                  >
                    Start session
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {plan.adjustments.length > 0 && (
        <p className="mt-2 text-caption text-ink-3">
          Engine: {plan.adjustments.join(' ')}
        </p>
      )}
    </div>
  )
}
