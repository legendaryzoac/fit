import { useEffect, useState } from 'react'
import type {
  CognitoUser,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'
import { completeNewPassword, restoreSession, signIn, signOut } from './auth'

type AuthState =
  | { phase: 'loading' }
  | { phase: 'signed-out' }
  | { phase: 'new-password'; user: CognitoUser }
  | { phase: 'signed-in'; session: CognitoUserSession }

function PulseMark() {
  return (
    <svg viewBox="0 0 64 64" className="h-14 w-14" aria-hidden="true">
      <rect width="64" height="64" rx="14" className="fill-neutral-900" />
      <polyline
        points="8,34 20,34 26,20 34,46 40,28 44,34 56,34"
        fill="none"
        stroke="#2dd4bf"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-neutral-950 px-6 text-neutral-100">
      <PulseMark />
      <h1 className="text-5xl font-semibold tracking-tight">fit</h1>
      {children}
      <footer className="fixed bottom-6 text-xs text-neutral-600">
        a zackwithers.com project
      </footer>
    </main>
  )
}

const inputClass =
  'w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm ' +
  'text-neutral-100 placeholder-neutral-500 outline-none focus:border-teal-500'
const buttonClass =
  'w-full rounded-lg bg-teal-500 px-3 py-2 text-sm font-medium text-neutral-950 ' +
  'hover:bg-teal-400 disabled:opacity-50'

function LoginCard({
  onResult,
}: {
  onResult: (result: AuthState) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await signIn(email.trim(), password)
      onResult(
        result.kind === 'success'
          ? { phase: 'signed-in', session: result.session }
          : { phase: 'new-password', user: result.user },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
      <p className="text-center text-sm text-neutral-400">
        Training &amp; recovery, tracked properly. Accounts are invite-only.
      </p>
      <input
        className={inputClass}
        type="email"
        placeholder="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        className={inputClass}
        type="password"
        placeholder="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className={buttonClass} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

function NewPasswordCard({
  user,
  onSignedIn,
}: {
  user: CognitoUser
  onSignedIn: (session: CognitoUserSession) => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onSignedIn(await completeNewPassword(user, password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set password')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
      <p className="text-center text-sm text-neutral-400">
        Welcome — choose a password to finish setting up your account
        (12+ characters).
      </p>
      <input
        className={inputClass}
        type="password"
        placeholder="new password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={12}
        required
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className={buttonClass} disabled={busy}>
        {busy ? 'Saving…' : 'Set password'}
      </button>
    </form>
  )
}

type Me = {
  createdAt: string
  whoop: {
    connected: boolean
    status?: 'active' | 'error'
    lastSyncAt?: string | null
    backfillDone?: boolean
  }
}

function initialBanner(): string | null {
  const q = new URLSearchParams(window.location.search)
  if (q.get('whoop') === 'connected') {
    return 'WHOOP connected — your history is syncing now.'
  }
  if (q.get('whoop') === 'error') {
    return 'WHOOP connection failed — please try again.'
  }
  return null
}

function WhoopCard({
  me,
  onError,
  authFetch,
}: {
  me: Me
  onError: (message: string) => void
  authFetch: (path: string) => Promise<Response>
}) {
  const [connecting, setConnecting] = useState(false)

  async function connect() {
    setConnecting(true)
    try {
      const res = await authFetch('/api/whoop/connect')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`)
      window.location.assign(body.url)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not start connect')
      setConnecting(false)
    }
  }

  if (me.whoop.connected) {
    return (
      <p className="text-sm text-neutral-400">
        WHOOP connected ·{' '}
        {me.whoop.lastSyncAt
          ? `synced ${new Date(me.whoop.lastSyncAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}`
          : 'first sync in progress…'}
      </p>
    )
  }
  if (me.whoop.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-amber-400">
          WHOOP connection needs attention — please reconnect.
        </p>
        <button onClick={connect} disabled={connecting} className={buttonClass}>
          {connecting ? 'Redirecting…' : 'Reconnect WHOOP'}
        </button>
      </div>
    )
  }
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <button onClick={connect} disabled={connecting} className={buttonClass}>
        {connecting ? 'Redirecting…' : 'Connect WHOOP'}
      </button>
      <p className="text-center text-xs text-neutral-600">
        Optional — workout tracking works without a strap.
      </p>
    </div>
  )
}

function Dashboard({
  session,
  onSignOut,
}: {
  session: CognitoUserSession
  onSignOut: () => void
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [banner] = useState<string | null>(initialBanner)
  const email = session.getIdToken().payload.email as string

  const token = session.getAccessToken().getJwtToken()
  const authFetch = (path: string) =>
    fetch(path, {
      // Not `Authorization`: CloudFront's OAC signing overwrites that header
      headers: { 'x-authorization': `Bearer ${token}` },
    })

  useEffect(() => {
    if (banner) window.history.replaceState(null, '', '/')
  }, [banner])

  useEffect(() => {
    authFetch('/api/me')
      .then(async (res) => {
        if (!res.ok) throw new Error(`API responded ${res.status}`)
        setMe(await res.json())
      })
      .catch((err: Error) => setApiError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4">
      <p className="text-sm text-neutral-400">
        Signed in as <span className="text-neutral-200">{email}</span>
        {me && (
          <>
            {' '}
            · member since{' '}
            {new Date(me.createdAt).toLocaleDateString(undefined, {
              dateStyle: 'medium',
            })}
          </>
        )}
      </p>
      {banner && <p className="text-center text-sm text-teal-300">{banner}</p>}
      {apiError && <p className="text-sm text-red-400">{apiError}</p>}
      {me && (
        <WhoopCard me={me} onError={setApiError} authFetch={authFetch} />
      )}
      <div className="rounded-full border border-teal-500/30 bg-teal-500/10 px-4 py-1.5 text-sm text-teal-300">
        M2 · WHOOP sync online
      </div>
      <p className="text-center text-sm text-neutral-500">
        Recovery dashboards and the workout logger arrive in M3–M5.
      </p>
      <button
        onClick={onSignOut}
        className="text-sm text-neutral-500 underline-offset-4 hover:text-neutral-300 hover:underline"
      >
        Sign out
      </button>
    </div>
  )
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ phase: 'loading' })

  useEffect(() => {
    restoreSession().then((session) =>
      setAuth(
        session
          ? { phase: 'signed-in', session }
          : { phase: 'signed-out' },
      ),
    )
  }, [])

  return (
    <Shell>
      {auth.phase === 'loading' && (
        <p className="text-sm text-neutral-600">…</p>
      )}
      {auth.phase === 'signed-out' && <LoginCard onResult={setAuth} />}
      {auth.phase === 'new-password' && (
        <NewPasswordCard
          user={auth.user}
          onSignedIn={(session) => setAuth({ phase: 'signed-in', session })}
        />
      )}
      {auth.phase === 'signed-in' && (
        <Dashboard
          session={auth.session}
          onSignOut={() => {
            signOut()
            setAuth({ phase: 'signed-out' })
          }}
        />
      )}
    </Shell>
  )
}
