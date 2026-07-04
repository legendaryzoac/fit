import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { TABLE_NAME, ddb } from '../db'
import { refreshTokens, type WhoopTokens } from './client'
import type { WhoopCredentials } from './config'
import type { Entity } from './normalize'

const s3 = new S3Client({})
const RAW_BUCKET = process.env.RAW_BUCKET

export interface WhoopConnection extends WhoopTokens {
  whoopUserId: string
  status: 'active' | 'error'
  connectedAt: string
  lastSyncAt?: string
  backfillDone?: boolean
  lastSyncCounts?: Record<string, number>
}

const connectionKey = (userId: string) => ({
  pk: `USER#${userId}`,
  sk: 'WHOOP#CONNECTION',
})

export async function loadConnection(
  userId: string,
): Promise<WhoopConnection | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: connectionKey(userId) }),
  )
  return (res.Item as WhoopConnection | undefined) ?? null
}

export async function saveConnection(
  userId: string,
  connection: WhoopConnection,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...connectionKey(userId),
        type: 'whoop-connection',
        // Sparse GSI: only connection items carry these, so querying
        // gsi1pk = WHOOPCONN lists exactly the connected users.
        gsi1pk: 'WHOOPCONN',
        gsi1sk: userId,
        ...connection,
      },
    }),
  )
}

export async function patchConnection(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  const sets = Object.entries(patch).map(([key, value], i) => {
    names[`#k${i}`] = key
    values[`:v${i}`] = value
    return `#k${i} = :v${i}`
  })
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: connectionKey(userId),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  )
}

/**
 * Returns a valid access token, refreshing (and persisting the rotated pair)
 * when within two minutes of expiry. On a dead refresh token the connection
 * is flagged so the UI can prompt a reconnect.
 */
export async function getFreshAccessToken(
  creds: WhoopCredentials,
  userId: string,
  connection: WhoopConnection,
): Promise<string> {
  if (connection.expiresAt - Date.now() > 120_000) {
    return connection.accessToken
  }
  try {
    const tokens = await refreshTokens(creds, connection.refreshToken)
    await patchConnection(userId, { ...tokens, status: 'active' })
    return tokens.accessToken
  } catch (err) {
    // WHOOP refresh tokens are single-use, and sleep + recovery webhooks
    // land ~20ms apart every morning — a concurrent invocation may have
    // just rotated the tokens out from under us. Give the winner time to
    // persist its new pair, then re-read before declaring the connection
    // dead. (Reserved concurrency would prevent the race outright, but the
    // account's Lambda concurrency quota doesn't allow reservations.)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const latest = await loadConnection(userId)
    if (
      latest &&
      latest.refreshToken !== connection.refreshToken &&
      latest.expiresAt - Date.now() > 120_000
    ) {
      return latest.accessToken
    }
    await patchConnection(userId, { status: 'error' })
    throw err
  }
}

// ---- WHOOP user id → our user id (webhooks only carry theirs) ----

export async function putMapping(
  whoopUserId: string,
  userId: string,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `WHOOP#${whoopUserId}`,
        sk: 'MAPPING',
        type: 'whoop-mapping',
        userId,
      },
    }),
  )
}

export async function getMappedUserId(
  whoopUserId: string,
): Promise<string | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `WHOOP#${whoopUserId}`, sk: 'MAPPING' },
    }),
  )
  return (res.Item?.userId as string | undefined) ?? null
}

// ---- one-shot OAuth state nonces ----

export async function putOauthState(
  nonce: string,
  userId: string,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `OAUTH#${nonce}`,
        sk: 'STATE',
        type: 'oauth-state',
        userId,
        ttl: Math.floor(Date.now() / 1000) + 600,
      },
    }),
  )
}

export async function consumeOauthState(
  nonce: string,
): Promise<string | null> {
  const key = { pk: `OAUTH#${nonce}`, sk: 'STATE' }
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: key }),
  )
  if (!res.Item) return null
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }))
  // TTL deletion lags; enforce expiry ourselves
  if ((res.Item.ttl as number) < Math.floor(Date.now() / 1000)) return null
  return res.Item.userId as string
}

// ---- entity + raw archive writes ----

export async function putEntity(
  userId: string,
  entity: Entity,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: `USER#${userId}`, ...entity, syncedAt: new Date().toISOString() },
    }),
  )
}

export async function putRaw(
  userId: string,
  entityType: string,
  id: string | number,
  record: unknown,
): Promise<void> {
  if (!RAW_BUCKET) return
  await s3.send(
    new PutObjectCommand({
      Bucket: RAW_BUCKET,
      Key: `whoop/${userId}/${entityType}/${id}.json`,
      Body: JSON.stringify(record),
      ContentType: 'application/json',
    }),
  )
}
