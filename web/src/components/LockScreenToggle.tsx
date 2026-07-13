import { useSyncExternalStore } from 'react'
import {
  isLockScreenActive,
  lockScreenSupported,
  setLockScreenEnabled,
  subscribeLockScreen,
} from '../lib/lockScreen'

/**
 * Opt-in switch for the lock-screen session widget. Off by default because
 * turning it on plays a silent keep-alive track, which takes audio focus
 * (it will pause whatever music is playing).
 */
export function LockScreenToggle({ className }: { className?: string }) {
  // External-store read: the controller flips on asynchronously (after its
  // play() promise), so a plain useState snapshot could miss the change.
  const on = useSyncExternalStore(subscribeLockScreen, isLockScreenActive)

  // Owns its wrapper so unsupported browsers get no phantom spacing div
  if (!lockScreenSupported()) return null

  return (
    <div className={className}>
      <button
        onClick={() => void setLockScreenEnabled(!on)}
        aria-pressed={on}
        title="Show this session on the lock screen (plays a silent track, so it pauses other audio)"
        className={`rounded-full border px-3 py-1 text-xs font-medium ${
          on
            ? 'border-teal-500/60 bg-teal-500/10 text-teal-300'
            : 'border-neutral-700 text-neutral-500 hover:text-neutral-300'
        }`}
      >
        {on ? '● Lock screen on' : '○ Lock screen'}
      </button>
    </div>
  )
}
