import type { ReactNode } from 'react'

import { Card } from './Card'

/** A card for an empty list or section: a title, an optional caption, and
 * an optional action (e.g. a button to fill the empty state). */
export function EmptyState({
  title,
  caption,
  action,
}: {
  title: ReactNode
  caption?: ReactNode
  action?: ReactNode
}) {
  return (
    <Card>
      <p className="text-title-sm text-ink">{title}</p>
      {caption && <p className="mt-1 text-body text-ink-2">{caption}</p>}
      {action && <div className="mt-3.5">{action}</div>}
    </Card>
  )
}
