import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  BlockProposal,
  CoachCard,
  DayPlanItem,
} from '../../lib/agent/types'
import type { Coach } from '../../lib/agent/useCoach'
import { CHECKIN_ITEMS } from '../../lib/checkins'
import type { Workout } from '../../lib/workouts'
import { Button } from '../cadence/Button'
import { IconButton } from '../cadence/IconButton'
import { StatusPill } from '../cadence/StatusPill'
import { IconArrowUp, IconRestart } from '../shell/icons'
import { Sheet } from '../shell/Sheet'
import { useSheetDismiss } from '../shell/useSheetDismiss'
import { BlockCard } from './BlockCard'
import type { CoachChip } from './CoachHero'
import { DayPlanCard } from './DayPlanCard'

function Thinking() {
  return (
    <div role="status" className="flex items-center gap-1.5 py-2 text-ink-3">
      <span className="sr-only">Coach is thinking</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="animate-live h-1.5 w-1.5 rounded-pill bg-current"
          style={{ animationDelay: `${i * 180}ms` }}
        />
      ))}
    </div>
  )
}

function checkinLine(saved: Record<string, unknown>): string {
  const parts = CHECKIN_ITEMS.filter((i) => saved[i.key] != null).map(
    (i) => `${i.label} ${String(saved[i.key])}/5`,
  )
  if (saved.prs != null) parts.push(`Recovery ${String(saved.prs)}/10`)
  return parts.join(' · ')
}

/**
 * The conversation with the coach. Plain text from the coach, the
 * athlete's messages in wells on the right, and the coach's proposals as
 * cards that can be acted on in place. Only the newest set of quick
 * replies is live; older ones were answers to older questions.
 */
export function CoachSheet({
  coach,
  seed,
  demo,
  chips,
  workouts,
  activeBlockName,
  onStartItem,
  onSaveBlock,
  onCustomizeBlock,
  onClose,
}: {
  coach: Coach
  /** Sent as soon as the sheet opens (a chip tapped on the home screen). */
  seed?: string
  demo: boolean
  /** Openers shown while the conversation is empty. */
  chips: CoachChip[]
  workouts: Workout[]
  activeBlockName?: string
  onStartItem: (item: DayPlanItem) => void
  onSaveBlock: (cardId: string, proposal: BlockProposal) => void
  onCustomizeBlock: (cardId: string, proposal: BlockProposal) => void
  onClose: () => void
}) {
  const { open, dismiss, onExited } = useSheetDismiss()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const { thread, busy, send } = coach

  // The seed goes out once, on the mount that carried it, and waits its
  // turn: sent while an earlier answer is still on its way it would be
  // dropped.
  const seeded = useRef(false)
  useEffect(() => {
    if (seed && !seeded.current && !busy) {
      seeded.current = true
      send(seed)
    }
  }, [seed, send, busy])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [thread.length, busy])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft.trim() || busy) return
    send(draft)
    setDraft('')
  }

  const lastIndex = thread.length - 1

  function card(c: CoachCard, isLast: boolean, key: number) {
    if (c.type === 'day-plan') {
      return (
        <div key={key} className="rounded-lg bg-surface-2 p-4">
          <DayPlanCard
            plan={c.plan}
            workouts={workouts}
            compact
            onStart={(item) => dismiss(() => onStartItem(item))}
          />
        </div>
      )
    }
    if (c.type === 'block') {
      return (
        <BlockCard
          key={key}
          proposal={c.proposal}
          saved={c.savedMesoId != null}
          replaces={activeBlockName}
          onSave={() => onSaveBlock(c.id, c.proposal)}
          onCustomize={() => dismiss(() => onCustomizeBlock(c.id, c.proposal))}
        />
      )
    }
    if (c.type === 'choices') {
      return (
        <div key={key} className="flex flex-wrap gap-2">
          {c.options.map((o) => (
            <button
              key={o}
              type="button"
              disabled={!isLast || busy}
              onClick={() => send(o)}
              className="pressable h-9 rounded-pill bg-brand-soft px-3.5 text-[14px] font-semibold text-brand-strong disabled:bg-surface-2 disabled:font-medium disabled:text-ink-3"
            >
              {o}
            </button>
          ))}
        </div>
      )
    }
    if (c.type === 'note') {
      return (
        <p key={key} className="text-caption text-ink-3">
          Remembered: {c.note.text}
        </p>
      )
    }
    return (
      <p key={key} className="text-caption text-ink-3">
        Check-in logged: {checkinLine(c.saved as Record<string, unknown>)}
      </p>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={() => dismiss(onClose)}
      onExited={onExited}
      ariaLabel="Coach"
      tall
      header={
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-title text-ink">Coach</h2>
            {(demo || coach.live === false) && (
              <StatusPill tone="neutral">{demo ? 'Demo' : 'Built-in'}</StatusPill>
            )}
          </div>
          {thread.length > 0 && (
            <IconButton
              label="Start over"
              size="sm"
              disabled={busy}
              onClick={coach.reset}
            >
              <IconRestart />
            </IconButton>
          )}
        </div>
      }
      footer={
        <form onSubmit={submit} className="flex items-center gap-2">
          <label htmlFor="coach-input" className="sr-only">
            Message the coach
          </label>
          <input
            id="coach-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tell your coach"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={2000}
            className="h-12 min-w-0 flex-1 rounded-pill bg-surface-2 px-5 text-body text-ink placeholder:text-ink-3 focus-visible:outline-none focus:[box-shadow:inset_0_0_0_1.5px_var(--brand)]"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim() || busy}
            className="pressable flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-brand text-on-brand disabled:bg-surface-2 disabled:text-ink-4"
          >
            <IconArrowUp />
          </button>
        </form>
      }
    >
      {thread.length === 0 && !busy ? (
        <div className="flex flex-col gap-4 pt-6">
          <p className="text-title-lg text-ink">Which wall today?</p>
          <p className="text-body text-ink-2">
            Say how you feel, how long you have, or what you want to build.
            Every plan is checked against your training before you see it.
          </p>
          <div className="flex flex-wrap gap-2">
            {chips
              .filter((c) => c.say)
              .map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => send(c.say)}
                  className="pressable h-9 rounded-pill bg-surface-2 px-3.5 text-[14px] font-medium text-ink-2"
                >
                  {c.label}
                </button>
              ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pt-1" aria-live="polite">
          {thread.map((e, n) =>
            e.role === 'user' ? (
              <p
                key={e.id}
                className="ml-auto max-w-[85%] rounded-lg bg-surface-2 px-4 py-2.5 text-body whitespace-pre-wrap text-ink"
              >
                <span className="sr-only">You: </span>
                {e.text}
              </p>
            ) : e.error ? (
              <div
                key={e.id}
                role="alert"
                className="flex items-center justify-between gap-3 rounded-md bg-rose-soft px-4 py-3 text-[14px] leading-5 text-rose-strong"
              >
                <span>{e.error}</span>
                {n === lastIndex && (
                  <Button
                    variant="ghost-danger"
                    size="sm"
                    className="shrink-0"
                    onClick={coach.retry}
                  >
                    Retry
                  </Button>
                )}
              </div>
            ) : (
              <div key={e.id} className="flex flex-col gap-2.5">
                {e.text && (
                  <p className="max-w-[92%] text-body whitespace-pre-wrap text-ink">
                    <span className="sr-only">Coach: </span>
                    {e.text}
                  </p>
                )}
                {e.cards?.map((c, i) => card(c, n === lastIndex, i))}
              </div>
            ),
          )}
          {busy && <Thinking />}
          <div ref={endRef} />
        </div>
      )}
    </Sheet>
  )
}
