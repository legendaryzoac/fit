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

function Dashboard({
  session,
  onSignOut,
}: {
  session: CognitoUserSession
  onSignOut: () => void
}) {
  const [memberSince, setMemberSince] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const email = session.getIdToken().payload.email as string

  useEffect(() => {
    fetch('/api/me', {
      headers: {
        // Not `Authorization`: CloudFront's OAC signing overwrites that header
        'x-authorization': `Bearer ${session.getAccessToken().getJwtToken()}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API responded ${res.status}`)
        const profile = await res.json()
        setMemberSince(
          new Date(profile.createdAt).toLocaleDateString(undefined, {
            dateStyle: 'medium',
          }),
        )
      })
      .catch((err: Error) => setApiError(err.message))
  }, [session])

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-4">
      <p className="text-sm text-neutral-400">
        Signed in as <span className="text-neutral-200">{email}</span>
        {memberSince && <> · member since {memberSince}</>}
      </p>
      {apiError && <p className="text-sm text-red-400">{apiError}</p>}
      <div className="rounded-full border border-teal-500/30 bg-teal-500/10 px-4 py-1.5 text-sm text-teal-300">
        M1 · accounts online
      </div>
      <p className="text-center text-sm text-neutral-500">
        WHOOP sync, recovery dashboards, and the workout logger arrive in
        M2–M5.
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
