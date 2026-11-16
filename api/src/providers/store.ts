import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { TABLE_NAME, ddb } from '../db'
import { PROVIDERS, getProvider } from './registry'
import type {
  Connection,
  Credentials,
  Entity,
  ProviderId,
  StrapProvider,
} from './types'

const s3 = new S3Client({})
const RAW_BUCKET = process.env.RAW_BUCKET

// ---- connections: one item per user per band, at most one band linked ----

// An update creates the item if it is missing. A connection must only ever
// be patched while it exists: a sync that outlives a disconnect would
// otherwise write back a tokenless row that reads as a linked strap.
const CONNECTION_EXISTS = 'attribute_exists(pk)'

const connectionKey = (provider: StrapProvider, userId: string) => ({
  pk: `USER#${userId}`,
  sk: provider.storage.connectionSk,
})

async function loadFor(
  provider: StrapProvider,
  userId: string,
): Promise<Connection | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: connectionKey(provider, userId) }),
  )
  if (!res.Item) return null
  // A row without tokens is not a connection: the code before the provider
  // layer could leave one behind when a sync outlived a disconnect.
  if (typeof res.Item.refreshToken !== 'string') return null
  const alias = provider.storage.externalIdAlias
  return {
    ...res.Item,
    // Items written before the provider layer carry neither field
    provider: provider.id,
    externalUserId: res.Item.externalUserId ?? (alias ? res.Item[alias] : undefined),
  } as Connection
}

/** The user's linked band, whichever it is. */
export async function loadConnection(userId: string): Promise<Connection | null> {
  const found = await Promise.all(PROVIDERS.map((p) => loadFor(p, userId)))
  return found.find((c) => c !== null) ?? null
}

export async function saveConnection(
  userId: string,
  connection: Connection,
): Promise<void> {
  const provider = getProvider(connection.provider)
  const alias = provider.storage.externalIdAlias
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...connectionKey(provider, userId),
        type: provider.storage.connectionType,
        // Sparse GSI: only connection items carry these, so querying a
        // band's gsi1pk lists exactly its connected users.
        gsi1pk: provider.storage.gsi1pk,
        gsi1sk: userId,
        ...connection,
        ...(alias && { [alias]: connection.externalUserId }),
      },
    }),
  )
}

/**
 * Forget the strap: drops the connection row (tokens + sparse GSI attrs)
 * and the vendor-id → user mapping, so webhooks for that account are
 * 200-acked as unknown and the nightly sync skips the user. Ingested
 * SLEEP#/RECOVERY#/CYCLE#/SESSION#/STEPS# history is deliberately kept.
 */
export async function deleteConnection(userId: string): Promise<boolean> {
  const existing = await loadConnection(userId)
  if (!existing) return false
  const provider = getProvider(existing.provider)
  await ddb.send(
    new DeleteCommand({ TableName: TABLE_NAME, Key: connectionKey(provider, userId) }),
  )
  if (existing.externalUserId) {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk: provider.storage.mappingPk(existing.externalUserId), sk: 'MAPPING' },
      }),
    )
  }
  return true
}

/** `SET` every defined field of `patch` on the item at `key`. */
async function setFields(
  key: { pk: string; sk: string },
  patch: Record<string, unknown>,
  condition?: { expression: string; values?: Record<string, unknown> },
): Promise<boolean> {
  const names: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  const sets = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([field, value], i) => {
      names[`#k${i}`] = field
      values[`:v${i}`] = value
      return `#k${i} = :v${i}`
    })
  if (sets.length === 0) return true
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ...values, ...condition?.values },
        ...(condition && { ConditionExpression: condition.expression }),
      }),
    )
    return true
  } catch (err) {
    if (condition && (err as Error).name === 'ConditionalCheckFailedException') return false
    throw err
  }
}

export async function patchConnection(
  providerId: ProviderId,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await setFields(connectionKey(getProvider(providerId), userId), patch, {
    expression: CONNECTION_EXISTS,
  })
}

/** Free when no sync was asked for inside the window. */
const SYNC_SLOT_FREE =
  'attribute_exists(pk) AND (attribute_not_exists(syncRequestedAt) OR syncRequestedAt < :cutoff)'

/**
 * Takes the user's sync-on-demand slot, atomically: of any number of
 * requests arriving together, exactly one gets true. False means a sync
 * was already asked for within `minGapMs`, or the connection is gone.
 */
export function claimSyncSlot(
  providerId: ProviderId,
  userId: string,
  minGapMs: number,
): Promise<boolean> {
  const now = Date.now()
  return setFields(
    connectionKey(getProvider(providerId), userId),
    { syncRequestedAt: new Date(now).toISOString() },
    {
      expression: SYNC_SLOT_FREE,
      values: { ':cutoff': new Date(now - minGapMs).toISOString() },
    },
  )
}

/**
 * Returns a valid access token, refreshing (and persisting the result)
 * when within two minutes of expiry. On a dead refresh token the
 * connection is flagged so the UI can prompt a reconnect.
 */
export async function getFreshAccessToken(
  provider: StrapProvider,
  creds: Credentials,
  userId: string,
  connection: Connection,
): Promise<string> {
  if (connection.expiresAt - Date.now() > 120_000) {
    return connection.accessToken
  }
  try {
    const tokens = await provider.refresh(creds, connection.refreshToken)
    await patchConnection(provider.id, userId, { ...tokens, status: 'active' })
    return tokens.accessToken
  } catch (err) {
    if (provider.rotatesRefreshToken) {
      // Single-use refresh tokens, and WHOOP's sleep + recovery webhooks
      // land ~20ms apart every morning — a concurrent invocation may have
      // just rotated the tokens out from under us. Give the winner time to
      // persist its new pair, then re-read before declaring the connection
      // dead. (Reserved concurrency would prevent the race outright, but the
      // account's Lambda concurrency quota doesn't allow reservations.)
      await new Promise((resolve) => setTimeout(resolve, 2500))
      const latest = await loadFor(provider, userId)
      if (
        latest &&
        latest.refreshToken !== connection.refreshToken &&
        latest.expiresAt - Date.now() > 120_000
      ) {
        return latest.accessToken
      }
    }
    // A transient vendor error is not a reason to make the user reconnect
    if (provider.isAuthDead(err)) {
      await patchConnection(provider.id, userId, { status: 'error' })
    }
    throw err
  }
}

// ---- vendor user id → our user id (webhooks only carry theirs) ----

export async function putMapping(
  provider: StrapProvider,
  externalUserId: string,
  userId: string,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: provider.storage.mappingPk(externalUserId),
        sk: 'MAPPING',
        type: provider.storage.mappingType,
        userId,
      },
    }),
  )
}

export async function getMappedUserId(
  provider: StrapProvider,
  externalUserId: string,
): Promise<string | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: provider.storage.mappingPk(externalUserId), sk: 'MAPPING' },
    }),
  )
  return (res.Item?.userId as string | undefined) ?? null
}

// ---- one-shot OAuth state nonces ----

export async function putOauthState(
  nonce: string,
  userId: string,
  provider: ProviderId,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `OAUTH#${nonce}`,
        sk: 'STATE',
        type: 'oauth-state',
        userId,
        provider,
        ttl: Math.floor(Date.now() / 1000) + 600,
      },
    }),
  )
}

export async function consumeOauthState(
  nonce: string,
): Promise<{ userId: string; provider: ProviderId } | null> {
  const key = { pk: `OAUTH#${nonce}`, sk: 'STATE' }
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: key }),
  )
  if (!res.Item) return null
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }))
  // TTL deletion lags; enforce expiry ourselves
  if ((res.Item.ttl as number) < Math.floor(Date.now() / 1000)) return null
  return {
    userId: res.Item.userId as string,
    // A nonce issued just before the provider layer shipped has no band
    provider: (res.Item.provider as ProviderId | undefined) ?? 'whoop',
  }
}

// ---- entity + raw archive writes ----

export async function putEntity(userId: string, entity: Entity): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: `USER#${userId}`, ...entity, syncedAt: new Date().toISOString() },
    }),
  )
}

const DAY_MS = 86_400_000

/**
 * Stores an entity whose sort key can change when the vendor revises it
 * (a sleep whose wake time was corrected keeps its id but moves in time),
 * and removes the copy left at the old key. It looks two days either
 * side, which is further than any correction moves a record.
 */
export async function replaceEntity(userId: string, entity: Entity): Promise<void> {
  await putEntity(userId, entity)
  const [prefix, at] = entity.sk.split('#')
  const when = Date.parse(at)
  if (entity.id == null || !Number.isFinite(when)) return
  const pk = `USER#${userId}`
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':from': `${prefix}#${new Date(when - 2 * DAY_MS).toISOString()}`,
        ':to': `${prefix}#${new Date(when + 2 * DAY_MS).toISOString()}`,
      },
    }),
  )
  const moved = (res.Items ?? []).filter(
    (item) => item.id === entity.id && item.source === entity.source && item.sk !== entity.sk,
  )
  await Promise.all(
    moved.map((item) =>
      ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk, sk: item.sk } })),
    ),
  )
}

/**
 * Sets only the fields the entity carries, leaving the rest of the item
 * as it is: several collections can each contribute part of one day's
 * record, and a score we compute later survives the next re-sync.
 */
export async function mergeEntity(userId: string, entity: Entity): Promise<void> {
  const { sk, ...fields } = entity
  await setFields(
    { pk: `USER#${userId}`, sk },
    { ...fields, syncedAt: new Date().toISOString() },
  )
}

export async function putRaw(
  provider: StrapProvider,
  userId: string,
  entityType: string,
  id: string | number,
  record: unknown,
): Promise<void> {
  if (!RAW_BUCKET) return
  await s3.send(
    new PutObjectCommand({
      Bucket: RAW_BUCKET,
      Key: `${provider.storage.rawPrefix}/${userId}/${entityType}/${id}.json`,
      Body: JSON.stringify(record),
      ContentType: 'application/json',
    }),
  )
}
