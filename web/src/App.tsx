import { useEffect, useMemo, useState } from 'react'
import { restoreSession, signOut } from './auth'
import { AppShell } from './components/AppShell'
import { LoginCard, NewPasswordCard, type AuthState } from './components/Auth'
import { Shell } from './components/ui'
import { makeApi, type Api } from './lib/api'
import { makeDemoApi } from './lib/demo'
import { setDemoStorage } from './lib/storage'

type Phase = AuthState | { phase: 'demo'; api: Api }

export default function App() {
  const [auth, setAuth] = useState<Phase>({ phase: 'loading' })

  useEffect(() => {
    restoreSession().then((session) =>
      setAuth(
        session ? { phase: 'signed-in', session } : { phase: 'signed-out' },
      ),
    )
  }, [])

  const api = useMemo(() => {
    if (auth.phase === 'signed-in') {
      return makeApi(auth.session.getAccessToken().getJwtToken())
    }
    if (auth.phase === 'demo') return auth.api
    return null
  }, [auth])

  if (auth.phase === 'signed-in' && api) {
    return (
      <AppShell
        api={api}
        email={auth.session.getIdToken().payload.email as string}
        onSignOut={() => {
          signOut()
          setAuth({ phase: 'signed-out' })
        }}
      />
    )
  }

  if (auth.phase === 'demo' && api) {
    return (
      <AppShell
        api={api}
        email="demo"
        demo
        onSignOut={() => {
          setDemoStorage(false)
          setAuth({ phase: 'signed-out' })
        }}
      />
    )
  }

  return (
    <Shell>
      {auth.phase === 'loading' && <p className="text-sm text-neutral-600">…</p>}
      {auth.phase === 'signed-out' && (
        <>
          <LoginCard onResult={setAuth} />
          <button
            onClick={() => {
              setDemoStorage(true)
              setAuth({ phase: 'demo', api: makeDemoApi() })
            }}
            className="text-sm text-teal-400 underline-offset-4 hover:text-teal-300 hover:underline"
          >
            No account? Explore the live demo →
          </button>
        </>
      )}
      {auth.phase === 'new-password' && (
        <NewPasswordCard
          user={auth.user}
          onSignedIn={(session) => setAuth({ phase: 'signed-in', session })}
        />
      )}
    </Shell>
  )
}
