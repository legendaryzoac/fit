import { useEffect, useMemo, useState } from 'react'
import { getFreshToken, restoreSession, signOut } from './auth'
import { AppShell } from './components/AppShell'
import { LoginCard, NewPasswordCard, type AuthState } from './components/Auth'
import { Button } from './components/cadence/Button'
import { Card } from './components/cadence/Card'
import { BrandMark } from './components/shell/BrandMark'
import { makeApi, type Api } from './lib/api'
import { makeDemoApi } from './lib/demo'
import { stopLockScreen } from './lib/lockScreen'
import { saveMesoCache } from './lib/mesocycle'
import { setDemoStorage } from './lib/storage'

type Phase = AuthState | { phase: 'demo'; api: Api }

/** Sign-in layout: brand row, a hero card holding the form, then the demo
 * escape hatch and a footer credit. */
function SignInShell({ children }: { children?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-gutter text-ink">
      <div className="flex items-center gap-3">
        <BrandMark className="h-12 w-12" />
        <h1 className="text-title-lg">FIT</h1>
      </div>
      {children && (
        <Card hero className="w-full max-w-[22rem]">
          {children}
        </Card>
      )}
      <p className="mt-2 text-micro text-ink-3">a zackwithers.com project</p>
    </main>
  )
}

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
      return makeApi(getFreshToken)
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
          stopLockScreen() // don't leave the widget ticking on the login page
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
          stopLockScreen() // widget must not cross the storage namespace
          setDemoStorage(false)
          setAuth({ phase: 'signed-out' })
        }}
      />
    )
  }

  if (auth.phase === 'loading') {
    return <SignInShell />
  }

  return (
    <SignInShell>
      {auth.phase === 'signed-out' && (
        <div className="flex flex-col gap-4">
          <LoginCard onResult={setAuth} />
          <Button
            variant="ghost"
            onClick={() => {
              setDemoStorage(true)
              // The demo API regenerates from scratch — a meso cached by
              // a previous demo visit would flash back then vanish.
              saveMesoCache([])
              setAuth({ phase: 'demo', api: makeDemoApi() })
            }}
          >
            No account? Try the demo
          </Button>
        </div>
      )}
      {auth.phase === 'new-password' && (
        <NewPasswordCard
          user={auth.user}
          onSignedIn={(session) => setAuth({ phase: 'signed-in', session })}
        />
      )}
    </SignInShell>
  )
}
