import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import { TABLE_NAME, ddb } from './db'
import { json } from './http'

type Item = Record<string, any>

async function queryRange(
  userId: string,
  prefix: string,
  startIso: string,
): Promise<Item[]> {
  const items: Item[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':from': `${prefix}${startIso}`,
          // '~' sorts after every character in ISO timestamps
          ':to': `${prefix}~`,
        },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return items
}

/** GET /api/metrics?days=N — recovery/sleep/cycle series for the dashboard. */
export async function handleMetrics(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const daysRaw = Number(event.queryStringParameters?.days ?? '90')
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 90, 7), 365)
  const startIso = new Date(Date.now() - days * 86_400_000).toISOString()

  const [recoveries, sleeps, cycles] = await Promise.all([
    queryRange(userId, 'RECOVERY#', startIso),
    queryRange(userId, 'SLEEP#', startIso),
    queryRange(userId, 'CYCLE#', startIso),
  ])

  return json(200, {
    days,
    recoveries: recoveries.map((i) => ({
      // recovery items carry no timestamp field of their own — it lives in
      // the sort key (RECOVERY#<created_at>#<cycle_id>)
      date: (i.sk as string).split('#')[1],
      recoveryScore: i.recoveryScore,
      rhr: i.rhr,
      hrvMs: i.hrvMs,
      scoreState: i.scoreState,
      userCalibrating: i.userCalibrating,
    })),
    sleeps: sleeps.map((i) => ({
      end: i.end,
      timezoneOffset: i.timezoneOffset,
      nap: i.nap,
      inBedMin: i.inBedMin,
      awakeMin: i.awakeMin,
      lightMin: i.lightMin,
      deepMin: i.deepMin,
      remMin: i.remMin,
      performancePct: i.performancePct,
      efficiencyPct: i.efficiencyPct,
      consistencyPct: i.consistencyPct,
      respiratoryRate: i.respiratoryRate,
      disturbances: i.disturbances,
      scoreState: i.scoreState,
    })),
    cycles: cycles.map((i) => ({
      start: i.start,
      end: i.end,
      timezoneOffset: i.timezoneOffset,
      strain: i.strain,
      kilojoule: i.kilojoule,
      avgHr: i.avgHr,
      maxHr: i.maxHr,
      scoreState: i.scoreState,
    })),
  })
}
