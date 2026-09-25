import { BrandMark } from './BrandMark'
import { IconSettings } from './icons'

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/** Sticky brand bar: mark and wordmark, today's date, settings. */
export function TopBar({
  demo,
  onSettings,
}: {
  demo: boolean
  onSettings: () => void
}) {
  return (
    <header className="backdrop-bar sticky top-0 z-40 flex h-topbar items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <BrandMark className="h-6 w-6" />
        <span className="text-[15px] font-semibold text-ink">FIT</span>
      </div>
      <span className="text-caption font-semibold text-ink-2">
        {todayLabel()}
      </span>
      <div className="flex items-center gap-1">
        {demo && (
          <span className="inline-flex h-7 items-center rounded-pill bg-brand-soft px-2.5 text-caption font-semibold text-brand-strong">
            Demo
          </span>
        )}
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className="pressable flex h-touch w-touch items-center justify-center rounded-pill text-ink-2 hover:bg-surface-2"
        >
          <IconSettings />
        </button>
      </div>
    </header>
  )
}
