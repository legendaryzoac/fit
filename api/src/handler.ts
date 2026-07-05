import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import {
  handleDeleteExercise,
  handleListExercises,
  handleSaveExercise,
} from './exercises'
import { json } from './http'
import { handleMetrics, handleSessions } from './metrics'
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
import { handleWhoopCallback, handleWhoopConnect } from './whoop/routes'
import { loadConnection } from './whoop/store'

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.CLIENT_ID!,
})

async function getMe(userId: string): Promise<LambdaFunctionURLResult> {
  const key = { pk: `USER#${userId}`, sk: 'PROFILE' }
  const existing = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: key }),
  )
  let profile = existing.Item
  if (!profile) {
    profile = {
      ...key,
      type: 'profile',
      userId,
      createdAt: new Date().toISOString(),
    }
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: profile }))
  }

  const connection = await loadConnection(userId)
  return json(200, {
    userId,
    createdAt: profile.createdAt,
    // Never the tokens — only presentation state
    whoop: connection
      ? {
          connected: connection.status === 'active',
          status: connection.status,
          lastSyncAt: connection.lastSyncAt ?? null,
          backfillDone: connection.backfillDone ?? false,
          bodyWeightLb:
            typeof connection.bodyWeightKg === 'number'
              ? Math.round(connection.bodyWeightKg * 2.20462 * 10) / 10
              : undefined,
        }
      : { connected: false },
  })
}

export async function handler(
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const route = `${event.requestContext.http.method} ${event.rawPath}`

  // The browser redirect from WHOOP can't carry our JWT; this route
  // authenticates by its one-shot OAuth state nonce instead. (The WHOOP
  // webhook lives on its own function URL — see webhook.ts.)
  if (route === 'GET /api/whoop/callback') return handleWhoopCallback(event)

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
  if (route === 'GET /api/exercises') return handleListExercises(userId)
  if (route === 'POST /api/exercises') return handleSaveExercise(userId, event)
  if (route === 'DELETE /api/exercises') return handleDeleteExercise(userId, event)
  if (route === 'GET /api/whoop/connect') return handleWhoopConnect(userId)

  return json(404, { error: 'not found' })
}
