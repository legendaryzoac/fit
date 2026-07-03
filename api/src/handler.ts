import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb'
import { CognitoJwtVerifier } from 'aws-jwt-verify'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.CLIENT_ID!,
})

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const TABLE_NAME = process.env.TABLE_NAME!

function json(statusCode: number, body: unknown): LambdaFunctionURLResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export async function handler(
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
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

  const route = `${event.requestContext.http.method} ${event.rawPath}`

  if (route === 'GET /api/me') {
    const key = { pk: `USER#${userId}`, sk: 'PROFILE' }
    const existing = await ddb.send(
      new GetCommand({ TableName: TABLE_NAME, Key: key }),
    )
    if (existing.Item) return json(200, existing.Item)

    const profile = {
      ...key,
      type: 'profile',
      userId,
      createdAt: new Date().toISOString(),
    }
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: profile }))
    return json(200, profile)
  }

  return json(404, { error: 'not found' })
}
