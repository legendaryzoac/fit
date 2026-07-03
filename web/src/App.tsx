import { useEffect, useState } from 'react'
import { restoreSession, signOut } from './auth'
import { AppShell } from './components/AppShell'
import { LoginCard, NewPasswordCard, type AuthState } from './components/Auth'
import { Shell } from './components/ui'

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ phase: 'loading' })

  useEffect(() => {
    restoreSession().then((session) =>
      setAuth(
        session ? { phase: 'signed-in', session } : { phase: 'signed-out' },
      ),
    )
  }, [])

  if (auth.phase === 'signed-in') {
    return (
      <AppShell
        session={auth.session}
        onSignOut={() => {
          signOut()
          setAuth({ phase: 'signed-out' })
        }}
      />
    )
  }

  return (
    <Shell>
      {auth.phase === 'loading' && <p className="text-sm text-neutral-600">…</p>}
      {auth.phase === 'signed-out' && <LoginCard onResult={setAuth} />}
      {auth.phase === 'new-password' && (
        <NewPasswordCard
          user={auth.user}
          onSignedIn={(session) => setAuth({ phase: 'signed-in', session })}
        />
      )}
    </Shell>
  )
}
