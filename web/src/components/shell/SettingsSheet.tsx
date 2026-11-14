import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Api } from '../../lib/api'
import { confirm } from '../../lib/confirm'
import { lockScreenSupported } from '../../lib/lockScreen'
import type { ProviderId } from '@fit/shared'
import { refreshMe, strapLabel, useMe } from '../../lib/me'
import {
  getThemePref,
  setThemePref,
  subscribeTheme,
  type ThemePref,
} from '../../lib/theme'
import { getUnitPref, setUnitPref, subscribeUnit, type WeightUnit } from '../../lib/units'
import { Banner } from '../cadence/Banner'
import { Button } from '../cadence/Button'
import { ListItem } from '../cadence/ListItem'
import { StatusPill } from '../cadence/StatusPill'
import { CoachSettings } from '../coach/CoachSettings'
import { LockScreenSwitch } from '../LockScreenSwitch'
import { Segment } from './Segment'
import { Sheet } from './Sheet'

const THEMES: Array<{ value: ThemePref; label: string }> = [
  { value: 'light', label: 'Dawn' },
  { value: 'dark', label: 'Dusk' },
  { value: 'auto', label: 'Auto' },
]

const UNITS: Array<{ value: WeightUnit; label: string }> = [
  { value: 'lb', label: 'lb' },
  { value: 'kg', label: 'kg' },
]

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Connect / status / disconnect for the strap, as a Settings row. */
function StrapRow({ api }: { api: Api }) {
  // The shared profile: a disconnect here hides the strap cards on Today
  // and Trends the moment the refetch lands.
  const me = useMe()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // More than one band on offer: Connect opens the choice first
  const [choosing, setChoosing] = useState(false)

  const refetch = useCallback(async () => {
    await refreshMe(api)
  }, [api])

  useEffect(() => {
    setError(null)
    void refetch()
  }, [refetch])

  async function connect(provider: ProviderId) {
    setBusy(true)
    setError(null)
    try {
      const res = await api.get(`/api/${provider}/connect`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`)
      window.location.assign(body.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start connect')
      setBusy(false)
    }
  }

  async function disconnect() {
    const ok = await confirm({ title: 'Disconnect the strap?', action: 'Disconnect' })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      // The route forgets whichever band is linked
      const res = await api.send('DELETE', `/api/${linkedProvider ?? 'whoop'}`)
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      setChoosing(false)
      await refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  const strap = me?.strap
  const linkedProvider = strap?.provider
  const providers = me?.providers ?? []
  const isError = strap?.status === 'error'
  const isConnectedActive = !!strap?.connected && !isError
  const name = strapLabel(me)

  let caption = 'Loading'
  if (me) {
    if (isConnectedActive) {
      caption = strap?.lastSyncAt
        ? `${name} · last synced ${fmtDay(strap.lastSyncAt)}`
        : `${name} · nothing synced yet`
    } else if (isError) {
      caption = `${name} needs attention`
    } else {
      caption = 'Not connected'
    }
  }

  function startConnect() {
    // A band waiting on a re-auth reconnects as itself
    if (isError && linkedProvider) return void connect(linkedProvider)
    if (providers.length === 1) return void connect(providers[0].id)
    setChoosing((open) => !open)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-body font-medium text-ink">Strap</span>
          <p className="text-caption text-ink-3">{caption}</p>
        </div>
        {me &&
          (isConnectedActive ? (
            <div className="flex items-center gap-2">
              <StatusPill tone="good" dot>
                Connected
              </StatusPill>
              <Button
                variant="ghost-danger"
                size="sm"
                disabled={busy}
                onClick={disconnect}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {/* Switching bands means forgetting this one first */}
              {isError && (
                <Button
                  variant="ghost-danger"
                  size="sm"
                  disabled={busy}
                  onClick={disconnect}
                >
                  Disconnect
                </Button>
              )}
              <Button
                variant="tonal"
                size="sm"
                disabled={busy || providers.length === 0}
                onClick={startConnect}
              >
                {isError ? 'Reconnect' : 'Connect'}
              </Button>
            </div>
          ))}
      </div>
      {choosing && !isConnectedActive && !isError && (
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <Button
              key={p.id}
              variant="quiet"
              disabled={busy}
              onClick={() => connect(p.id)}
            >
              {p.label}
            </Button>
          ))}
          {providers.some((p) => p.id === 'google') && (
            <p className="text-caption text-ink-3">
              Fitbit Air: FIT reads your sleep, heart rate variability, resting
              heart rate, blood oxygen, skin temperature and steps from Google
              Health to show your recovery trends. Sign in to the Google Health
              app with the same Google account first.
            </p>
          )}
        </div>
      )}
      {error && <Banner tone="error">{error}</Banner>}
    </>
  )
}

export function SettingsSheet({
  open,
  onClose,
  demo,
  email,
  onSignOut,
  onExercises,
  api,
}: {
  open: boolean
  onClose: () => void
  demo: boolean
  email: string
  onSignOut: () => void
  onExercises?: () => void
  api: Api
}) {
  const pref = useSyncExternalStore(subscribeTheme, getThemePref, getThemePref)
  const unit = useSyncExternalStore(subscribeUnit, getUnitPref, getUnitPref)

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <p className="truncate text-caption text-ink-2">
        {demo ? 'Demo' : email}
      </p>
      {demo && <p className="text-caption text-ink-3">Changes stay in this browser.</p>}

      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="text-body font-medium text-ink">Theme</span>
        <Segment
          options={THEMES}
          value={pref}
          onChange={setThemePref}
          ariaLabel="Theme"
        />
      </div>

      <div className="mt-6 h-px bg-hairline" />

      <div className="mt-6 flex items-center justify-between gap-4">
        <span className="text-body font-medium text-ink">Units</span>
        <Segment
          options={UNITS}
          value={unit}
          onChange={setUnitPref}
          ariaLabel="Units"
        />
      </div>

      {lockScreenSupported() && (
        <>
          <div className="mt-6 h-px bg-hairline" />
          <div className="mt-6">
            <LockScreenSwitch />
          </div>
        </>
      )}

      <div className="mt-6 h-px bg-hairline" />

      <div className="mt-6 flex flex-col gap-3">{open && <StrapRow api={api} />}</div>

      <div className="mt-6 h-px bg-hairline" />

      <div className="mt-6">{open && <CoachSettings api={api} demo={demo} />}</div>

      <div className="mt-6 h-px bg-hairline" />

      <div className="mt-6 -mx-4">
        <ListItem
          title="Exercises"
          sub="Custom exercises and templates"
          chevron
          onClick={onExercises}
        />
      </div>

      <div className="mt-6 h-px bg-hairline" />

      <button
        type="button"
        onClick={onSignOut}
        className="pressable mt-6 flex h-touch w-full items-center justify-center rounded-pill text-body font-semibold text-ink-2 hover:bg-surface-2"
      >
        {demo ? 'Exit demo' : 'Sign out'}
      </button>
    </Sheet>
  )
}
