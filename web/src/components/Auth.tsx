import { useState } from 'react'
import type {
  CognitoUser,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'
import { completeNewPassword, signIn } from '../auth'
import { buttonClass, inputClass } from './ui'

export type AuthState =
  | { phase: 'loading' }
  | { phase: 'signed-out' }
  | { phase: 'new-password'; user: CognitoUser }
  | { phase: 'signed-in'; session: CognitoUserSession }

export function LoginCard({
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
      <button className={`${buttonClass} w-full`} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export function NewPasswordCard({
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
      <button className={`${buttonClass} w-full`} disabled={busy}>
        {busy ? 'Saving…' : 'Set password'}
      </button>
    </form>
  )
}
