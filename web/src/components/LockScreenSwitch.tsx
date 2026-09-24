import { useSyncExternalStore } from 'react'
import {
  isLockScreenActive,
  lockScreenSupported,
  setLockScreenEnabled,
  subscribeLockScreen,
} from '../lib/lockScreen'
import { Switch } from './cadence/Switch'

/**
 * Opt-in switch for the lock-screen session widget. Off by default because
 * turning it on plays a silent keep-alive track, which takes audio focus
 * (it will pause whatever music is playing). Renders nothing where the
 * Media Session API is missing.
 */
export function LockScreenSwitch() {
  // External-store read: the controller flips on asynchronously (after its
  // play() promise), so a plain useState snapshot could miss the change.
  const on = useSyncExternalStore(
    subscribeLockScreen,
    isLockScreenActive,
    isLockScreenActive,
  )
  if (!lockScreenSupported()) return null
  return (
    <Switch
      checked={on}
      onChange={(next) => void setLockScreenEnabled(next)}
      label="Lock screen"
      help="Pauses other audio"
    />
  )
}
