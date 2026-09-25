import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Api } from '../../lib/api'
import { confirm } from '../../lib/confirm'
import {
  getThemePref,
  setThemePref,
  subscribeTheme,
  type ThemePref,
} from '../../lib/theme'
import { Banner } from '../cadence/Banner'
import { Button } from '../cadence/Button'
import { StatusPill } from '../cadence/StatusPill'
import { Segment } from './Segment'
import { Sheet } from './Sheet'

const THEMES: Array<{ value: ThemePref; label: string }> = [
  { value: 'light', label: 'Dawn' },
  { value: 'dark', label: 'Dusk' },
  { value: 'auto', label: 'Auto' },
]

type Me = {
  createdAt: string
  whoop: {
    connected: boolean
    status?: 'active' | 'error'
    lastSyncAt?: string | null
    backfillDone?: boolean
    bodyWeightLb?: number
  }
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Connect / status / disconnect for the strap, as a Settings row. */
function StrapRow({ api }: { api: Api }) {
  const [me, setMe] = useState<Me | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    try {
      const res = await api.get('/api/me')
      if (!res.ok) return
      setMe((await res.json()) as Me)
    } catch {
      // Ignored — the row just keeps showing its last known state.
    }
  }, [api])

  useEffect(() => {
    setMe(null)
    setError(null)
    refetch()
  }, [refetch])

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.get('/api/whoop/connect')
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
      const res = await api.send('DELETE', '/api/whoop')
      if (!res.ok) throw new Error(`API responded ${res.status}`)
      await refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  const isError = me?.whoop.status === 'error'
  const isConnectedActive = !!me?.whoop.connected && !isError

  let caption = 'Loading'
  if (me) {
    if (isConnectedActive) {
      caption = me.whoop.lastSyncAt
        ? `Last synced ${fmtDay(me.whoop.lastSyncAt)}`
        : 'Nothing synced yet'
    } else if (isError) {
      caption = 'Needs attention'
    } else {
      caption = 'Not connected'
    }
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
            <Button variant="tonal" size="sm" disabled={busy} onClick={connect}>
              {isError ? 'Reconnect' : 'Connect'}
            </Button>
          ))}
      </div>
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
  api,
}: {
  open: boolean
  onClose: () => void
  demo: boolean
  email: string
  onSignOut: () => void
  api: Api
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

      <div className="mt-6 h-px bg-hairline" />

      <div className="mt-6 flex flex-col gap-3">{open && <StrapRow api={api} />}</div>

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
