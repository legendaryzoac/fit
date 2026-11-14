import { CognitoJwtVerifier } from 'aws-jwt-verify'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { handleAgent, handleAgentStatus } from './agent/handler'
import {
  handleDeleteCheckin,
  handleListCheckins,
  handleSaveCheckin,
} from './checkins'
import {
  handleDeleteExercise,
  handleListExercises,
  handleSaveExercise,
} from './exercises'
import { json } from './http'
import {
  handleDeleteMeso,
  handleListMesos,
  handleSaveMeso,
} from './mesos'
import { handleMetrics, handleSessions } from './metrics'
import {
  handleDeleteRomTest,
  handleListRomTests,
  handleSaveRomTest,
} from './romtests'
import { handleListWeights, handleSaveWeight } from './weights'
import {
  handleDeleteTemplate,
  handleListTemplates,
  handleSaveTemplate,
} from './templates'
import {
  handleDeleteWorkout,
  handleListWorkouts,
  handleSaveWorkout,
} from './workouts'
import { getMe } from './me'
import { getProvider, isProviderId } from './providers/registry'
import {
  handleCallback,
  handleConnect,
  handleDisconnect,
} from './providers/routes'

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.CLIENT_ID!,
})

export async function handler(
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const route = `${event.requestContext.http.method} ${event.rawPath}`

  // /api/<band>/connect, /api/<band>/callback and DELETE /api/<band>
  const strapRoute = /^(GET|DELETE) \/api\/([a-z]+)(\/connect|\/callback)?$/.exec(route)
  const strap =
    strapRoute && isProviderId(strapRoute[2])
      ? { provider: getProvider(strapRoute[2]), action: `${strapRoute[1]}${strapRoute[3] ?? ''}` }
      : null

  // The browser redirect from the vendor can't carry our JWT; this route
  // authenticates by its one-shot OAuth state nonce instead. (The WHOOP
  // webhook lives on its own function URL — see webhook.ts.)
  if (strap?.action === 'GET/callback') return handleCallback(strap.provider, event)

  // The app token rides in x-authorization: CloudFront's OAC signing owns the
  // real Authorization header on origin requests. (Function URLs lowercase
  // all header names.)
  const authHeader = event.headers?.['x-authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'missing bearer token' })
  }

  let userId: string
  try {
    const claims = await verifier.verify(authHeader.slice('Bearer '.length))
    userId = claims.sub
  } catch {
    return json(401, { error: 'invalid token' })
  }

  if (route === 'GET /api/me') return getMe(userId)
  if (route === 'GET /api/metrics') return handleMetrics(userId, event)
  if (route === 'GET /api/sessions') return handleSessions(userId, event)
  if (route === 'GET /api/workouts') return handleListWorkouts(userId, event)
  if (route === 'POST /api/workouts') return handleSaveWorkout(userId, event)
  if (route === 'DELETE /api/workouts') return handleDeleteWorkout(userId, event)
  if (route === 'GET /api/templates') return handleListTemplates(userId)
  if (route === 'POST /api/templates') return handleSaveTemplate(userId, event)
  if (route === 'DELETE /api/templates') return handleDeleteTemplate(userId, event)
  if (route === 'GET /api/mesos') return handleListMesos(userId)
  if (route === 'POST /api/mesos') return handleSaveMeso(userId, event)
  if (route === 'DELETE /api/mesos') return handleDeleteMeso(userId, event)
  if (route === 'GET /api/weights') return handleListWeights(userId)
  if (route === 'POST /api/weights') return handleSaveWeight(userId, event)
  if (route === 'GET /api/checkins') return handleListCheckins(userId, event)
  if (route === 'POST /api/checkins') return handleSaveCheckin(userId, event)
  if (route === 'DELETE /api/checkins') return handleDeleteCheckin(userId, event)
  if (route === 'GET /api/romtests') return handleListRomTests(userId)
  if (route === 'POST /api/romtests') return handleSaveRomTest(userId, event)
  if (route === 'DELETE /api/romtests') return handleDeleteRomTest(userId, event)
  if (route === 'GET /api/exercises') return handleListExercises(userId)
  if (route === 'POST /api/exercises') return handleSaveExercise(userId, event)
  if (route === 'DELETE /api/exercises') return handleDeleteExercise(userId, event)
  if (route === 'GET /api/agent') return handleAgentStatus(userId)
  if (route === 'POST /api/agent') return handleAgent(userId, event)
  if (strap?.action === 'GET/connect') return handleConnect(strap.provider, userId)
  if (strap?.action === 'DELETE') return handleDisconnect(userId)

  return json(404, { error: 'not found' })
}
