import { useEffect, useState } from 'react'
import { coachStatus } from '../../lib/agent/client'
import { removeNote, useNotes } from '../../lib/agent/store'
import type { Api } from '../../lib/api'
import { IconButton } from '../cadence/IconButton'
import { StatusPill } from '../cadence/StatusPill'
import { IconX } from '../shell/icons'

/**
 * The coach, as a Settings section: which coach is answering, and the
 * facts it was asked to remember. Every note is the athlete's to remove;
 * a removed note stops shaping plans from the next message on.
 */
export function CoachSettings({ api, demo }: { api: Api; demo: boolean }) {
  const notes = useNotes()
  const [status, setStatus] = useState<{ live: boolean; remaining?: number } | null>(
    null,
  )
  useEffect(() => {
    let alive = true
    void coachStatus(api).then((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [api])

  const caption = demo
    ? 'The demo runs on the built-in coach.'
    : status === null
      ? 'Checking'
      : status.live
        ? status.remaining != null
          ? `${status.remaining} replies left today`
          : 'Ready'
        : 'Built-in coach. The live one is not set up here.'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-body font-medium text-ink">Coach</span>
          <p className="text-caption text-ink-3">{caption}</p>
        </div>
        {status?.live && !demo && (
          <StatusPill tone="good" dot>
            Live
          </StatusPill>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="text-caption text-ink-3">
          Nothing remembered yet. Tell the coach your schedule, your
          equipment, or what to work around, and it stays here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {notes.map((n, i) => (
            <li key={n.id}>
              {i > 0 && <div aria-hidden="true" className="h-px bg-hairline" />}
              <div className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-body text-ink">{n.text}</p>
                  <p className="text-caption text-ink-3 capitalize">{n.category}</p>
                </div>
                <IconButton
                  label={`Forget: ${n.text}`}
                  size="sm"
                  onClick={() => removeNote(n.id)}
                >
                  <IconX className="h-4 w-4" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
