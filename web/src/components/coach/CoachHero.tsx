import { IconArrowUp } from '../shell/icons'

export interface CoachChip {
  label: string
  /** What is sent to the coach when the chip is tapped. Empty opens the
   * conversation without sending anything. */
  say: string
}

/**
 * The top of the home screen: a greeting, then the coach in one short
 * line of its own voice, and a few answers ready to tap. The field is a
 * button: the conversation itself happens in the coach sheet.
 */
export function CoachHero({
  greeting,
  prompt,
  context,
  chips,
  busy,
  onOpen,
  onChip,
}: {
  /** "Good morning" and so on. */
  greeting: string
  /** What the coach is asking right now, a few words at most. */
  prompt: string
  /** One quiet line under the greeting, e.g. "Week 2 of 5 · 1 of 4 done". */
  context?: string
  chips: CoachChip[]
  busy: boolean
  onOpen: () => void
  onChip: (say: string) => void
}) {
  return (
    <section className="flex flex-col gap-3.5 pt-1">
      <div>
        <h1 className="text-[30px] leading-[34px] font-semibold tracking-[-0.02em] text-ink">
          {greeting}
        </h1>
        {context && <p className="mt-1.5 text-caption text-ink-2">{context}</p>}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="pressable flex h-13 w-full items-center justify-between gap-3 rounded-pill bg-surface pr-1.5 pl-5 text-left shadow-lift"
      >
        <span className="truncate text-body text-ink-2">
          {busy ? 'Coach is on it' : prompt}
        </span>
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-brand text-on-brand"
        >
          <IconArrowUp />
        </span>
      </button>

      {chips.length > 0 && (
        <div className="scroll-thin -mx-gutter flex gap-2 overflow-x-auto px-gutter">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              disabled={busy}
              onClick={() => onChip(c.say)}
              className="pressable h-9 shrink-0 rounded-pill bg-surface-2 px-3.5 text-[14px] font-medium text-ink-2 disabled:opacity-40"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
