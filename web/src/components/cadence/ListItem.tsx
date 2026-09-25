import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { IconChevronRight } from '../shell/icons'

export type LeadTone = 'neutral' | 'brand' | 'effort' | 'rest' | 'calm'

const LEAD: Record<LeadTone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  brand: 'bg-brand-soft text-brand-strong',
  effort: 'bg-ember-soft text-ember-strong',
  rest: 'bg-sky-soft text-sky-strong',
  // Recovery: amber, the calm tone
  calm: 'bg-amber-soft text-amber-strong',
}

const ROW =
  'flex min-h-16 w-full min-w-0 flex-1 items-center gap-3.5 rounded-md bg-surface px-4 py-3 text-left'

/**
 * A full-width row: an optional lead circle, a title with a sub line, and
 * a trail. It is a button when onClick is given. `action` is a control
 * rendered after the row (outside the button) so buttons never nest.
 */
export function ListItem({
  lead,
  leadTone = 'neutral',
  title,
  sub,
  trail,
  chevron = false,
  muted = false,
  onClick,
  href,
  action,
}: {
  lead?: ReactNode
  leadTone?: LeadTone
  title: ReactNode
  sub?: ReactNode
  trail?: ReactNode
  chevron?: boolean
  /** Dims the title, for rows that are already behind. */
  muted?: boolean
  onClick?: () => void
  href?: string
  action?: ReactNode
}) {
  const body = (
    <>
      {lead && (
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-pill ${LEAD[leadTone]}`}
        >
          {lead}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`block truncate text-body font-medium ${muted ? 'text-ink-3' : 'text-ink'}`}
        >
          {title}
        </span>
        {sub && <span className="block text-caption text-ink-2">{sub}</span>}
      </span>
      {trail != null && trail !== false && (
        <span className="shrink-0 text-body font-medium text-ink-2">
          {trail}
        </span>
      )}
      {chevron && <IconChevronRight className="h-5 w-5 shrink-0 text-ink-4" />}
    </>
  )

  const row = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`pressable hover:bg-surface-2 ${ROW}`}
    >
      {body}
    </button>
  ) : href ? (
    <a href={href} className={`pressable hover:bg-surface-2 ${ROW}`}>
      {body}
    </a>
  ) : (
    <div className={ROW}>{body}</div>
  )

  if (!action) return row
  return (
    <div className="flex items-center gap-1 rounded-md pr-2">
      {row}
      {action}
    </div>
  )
}

/** A card of rows; consecutive rows are parted by a hairline inset 70px. */
export function List({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const items = Children.toArray(children)
  return (
    <div className={`flex flex-col rounded-lg bg-surface p-1 ${className}`}>
      {items.map((item, i) => (
        <Fragment key={isValidElement(item) && item.key != null ? item.key : i}>
          {i > 0 && <div aria-hidden="true" className="ml-[70px] h-px bg-hairline" />}
          {item}
        </Fragment>
      ))}
    </div>
  )
}
