import { useSyncExternalStore } from 'react'
import {
  getThemePref,
  setThemePref,
  subscribeTheme,
  type ThemePref,
} from '../../lib/theme'
import { Segment } from './Segment'
import { Sheet } from './Sheet'

const THEMES: Array<{ value: ThemePref; label: string }> = [
  { value: 'light', label: 'Dawn' },
  { value: 'dark', label: 'Dusk' },
  { value: 'auto', label: 'Auto' },
]

export function SettingsSheet({
  open,
  onClose,
  demo,
  email,
  onSignOut,
}: {
  open: boolean
  onClose: () => void
  demo: boolean
  email: string
  onSignOut: () => void
}) {
  const pref = useSyncExternalStore(subscribeTheme, getThemePref, getThemePref)

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <p className="truncate text-caption text-ink-2">
        {demo ? 'Demo' : email}
      </p>

      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="text-body font-medium text-ink">Theme</span>
        <Segment
          options={THEMES}
          value={pref}
          onChange={setThemePref}
          ariaLabel="Theme"
        />
      </div>

      <button
        type="button"
        onClick={onSignOut}
        className="pressable mt-8 flex h-touch w-full items-center justify-center rounded-pill text-body font-semibold text-ink-2 hover:bg-surface-2"
      >
        {demo ? 'Exit demo' : 'Sign out'}
      </button>
    </Sheet>
  )
}
