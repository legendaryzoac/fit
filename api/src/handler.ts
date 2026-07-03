import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { handleWhoopCallback, handleWhoopConnect } from './whoop/routes'
import { loadConnection } from './whoop/store'

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.CLIENT_ID!,
})

function json(statusCode: number, body: unknown): LambdaFunctionURLResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

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
  if (route === 'GET /api/whoop/connect') return handleWhoopConnect(userId)

  return json(404, { error: 'not found' })
}
