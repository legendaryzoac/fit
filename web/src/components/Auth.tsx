import { useId, useState } from 'react'
import type {
  CognitoUser,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'
import { completeNewPassword, signIn } from '../auth'
import { Banner } from './cadence/Banner'
import { Button } from './cadence/Button'
import { Field, TextInput } from './cadence/Field'

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
  const emailId = useId()
  const passwordId = useId()

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
    <div className="flex w-full flex-col gap-4">
      <form onSubmit={submit} className="flex w-full flex-col gap-3">
        <Field label="Email" htmlFor={emailId}>
          <TextInput
            id={emailId}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor={passwordId}>
          <TextInput
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        <Button variant="primary" block type="submit" disabled={busy}>
          {busy ? 'Signing in' : 'Sign in'}
        </Button>
      </form>
      <p className="text-center text-caption text-ink-3">Invite only.</p>
    </div>
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
  const passwordId = useId()

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
    <form onSubmit={submit} className="flex w-full flex-col gap-3">
      <Field
        label="New password"
        htmlFor={passwordId}
        help="12 characters or more"
      >
        <TextInput
          id={passwordId}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={12}
          required
        />
      </Field>
      {error && <Banner tone="error">{error}</Banner>}
      <Button variant="primary" block type="submit" disabled={busy}>
        {busy ? 'Saving' : 'Set password'}
      </Button>
    </form>
  )
}
