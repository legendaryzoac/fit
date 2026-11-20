import {
  AuthenticationDetails,
  CognitoAccessToken,
  CognitoIdToken,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'
import { COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID } from './config'

let cachedPool: CognitoUserPool | null = null
function pool(): CognitoUserPool {
  cachedPool ??= new CognitoUserPool({
    UserPoolId: COGNITO_USER_POOL_ID,
    ClientId: COGNITO_CLIENT_ID,
  })
  return cachedPool
}

export type SignInResult =
  | { kind: 'success'; session: CognitoUserSession }
  | { kind: 'new-password-required'; user: CognitoUser }

export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: pool() })
  return new Promise((resolve, reject) => {
    user.authenticateUser(
      new AuthenticationDetails({ Username: email, Password: password }),
      {
        onSuccess: (session) => resolve({ kind: 'success', session }),
        onFailure: reject,
        newPasswordRequired: () =>
          resolve({ kind: 'new-password-required', user }),
      },
    )
  })
}

export function completeNewPassword(
  user: CognitoUser,
  newPassword: string,
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: resolve,
      onFailure: reject,
    })
  })
}

export function restoreSession(): Promise<CognitoUserSession | null> {
  let user: CognitoUser | null
  try {
    user = pool().getCurrentUser()
  } catch {
    return Promise.resolve(null) // unconfigured pool ids
  }
  if (!user) return Promise.resolve(null)
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (!err && session?.isValid()) {
        resolve(session)
        return
      }
      // Tokens last an hour, so a relaunch mid-workout usually has to
      // refresh, and at the gym that often fails for want of signal.
      // Bouncing to sign-in there strands the live draft behind a form
      // that can't be submitted offline. The library clears its cache only
      // when Cognito actually rejects the refresh token; while the tokens
      // are still cached, open the app on them. API calls refresh per
      // request and the offline queue holds anything that 401s meanwhile.
      resolve(cachedSession())
    })
  })
}

/** The last session's tokens as stored by the library, expired or not. */
function cachedSession(): CognitoUserSession | null {
  let user: CognitoUser | null
  try {
    user = pool().getCurrentUser()
  } catch {
    return null
  }
  if (!user) return null // signed out, or the refresh token was rejected
  const prefix = `CognitoIdentityServiceProvider.${COGNITO_CLIENT_ID}.${user.getUsername()}`
  const id = localStorage.getItem(`${prefix}.idToken`)
  const access = localStorage.getItem(`${prefix}.accessToken`)
  const refresh = localStorage.getItem(`${prefix}.refreshToken`)
  if (!id || !access || !refresh) return null
  return new CognitoUserSession({
    IdToken: new CognitoIdToken({ IdToken: id }),
    AccessToken: new CognitoAccessToken({ AccessToken: access }),
    RefreshToken: new CognitoRefreshToken({ RefreshToken: refresh }),
  })
}

export function getFreshToken(): Promise<string | null> {
  let user: CognitoUser | null
  try {
    user = pool().getCurrentUser()
  } catch {
    return Promise.resolve(null) // unconfigured pool ids
  }
  if (!user) return Promise.resolve(null)
  return new Promise((resolve) => {
    // getSession transparently refreshes an expired access token from the
    // refresh token when the network allows; offline it errors -> null.
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      resolve(err || !session ? null : session.getAccessToken().getJwtToken())
    })
  })
}

export function signOut(): void {
  pool().getCurrentUser()?.signOut()
}
