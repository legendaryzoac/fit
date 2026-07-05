import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
} from 'amazon-cognito-identity-js'
import type { CognitoUserSession } from 'amazon-cognito-identity-js'
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
      resolve(err || !session?.isValid() ? null : session)
    })
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
