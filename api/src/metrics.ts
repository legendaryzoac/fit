import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import type {
  LambdaFunctionURLEvent,
  LambdaFunctionURLResult,
} from 'aws-lambda'
import type { MetricsResponse, SessionsResponse } from '@fit/shared'
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

/** GET /api/sessions?days=N — workouts the band captured itself, for linking. */
export async function handleSessions(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const daysRaw = Number(event.queryStringParameters?.days ?? '120')
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 120, 7), 730)
  const startIso = new Date(Date.now() - days * 86_400_000).toISOString()
  const sessions = await queryRange(userId, 'SESSION#', startIso)
  const body: SessionsResponse = {
    sessions: sessions.map((i) => ({
      sk: i.sk,
      source: i.source,
      sport: i.sport,
      start: i.start,
      end: i.end,
      timezoneOffset: i.timezoneOffset,
      strain: i.strain,
      avgHr: i.avgHr,
      maxHr: i.maxHr,
      kilojoule: i.kilojoule,
      distanceM: i.distanceM,
      zoneMin: i.zoneMin,
      scoreState: i.scoreState,
    })),
  }
  return json(200, body)
}

/** GET /api/metrics?days=N — vitals/sleep/load/steps series for the dashboard. */
export async function handleMetrics(
  userId: string,
  event: LambdaFunctionURLEvent,
): Promise<LambdaFunctionURLResult> {
  const daysRaw = Number(event.queryStringParameters?.days ?? '90')
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : 90, 7), 365)
  const startIso = new Date(Date.now() - days * 86_400_000).toISOString()

  const [recoveries, sleeps, cycles, steps] = await Promise.all([
    queryRange(userId, 'RECOVERY#', startIso),
    queryRange(userId, 'SLEEP#', startIso),
    queryRange(userId, 'CYCLE#', startIso),
    // Day-keyed (STEPS#YYYY-MM-DD), so the range starts on a whole day
    queryRange(userId, 'STEPS#', startIso.slice(0, 10)),
  ])

  const body: MetricsResponse = {
    days,
    recoveries: recoveries.map((i) => ({
      source: i.source,
      // Bands that report per day store a civil date; WHOOP rows carry
      // their timestamp in the sort key (RECOVERY#<created_at>#<cycle_id>)
      date: i.date ?? (i.sk as string).split('#')[1],
      recoveryScore: i.recoveryScore,
      scoreSource: i.scoreSource,
      rhr: i.rhr,
      hrvMs: i.hrvMs,
      hrvDeepSleepMs: i.hrvDeepSleepMs,
      spo2Pct: i.spo2Pct,
      skinTempC: i.skinTempC,
      skinTempDeviationC: i.skinTempDeviationC,
      scoreState: i.scoreState,
      userCalibrating: i.userCalibrating,
    })),
    sleeps: sleeps.map((i) => ({
      source: i.source,
      start: i.start,
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
      source: i.source,
      start: i.start,
      end: i.end,
      timezoneOffset: i.timezoneOffset,
      strain: i.strain,
      kilojoule: i.kilojoule,
      avgHr: i.avgHr,
      maxHr: i.maxHr,
      scoreState: i.scoreState,
    })),
    steps: steps.map((i) => ({ source: i.source, date: i.date, steps: i.steps })),
  }
  return json(200, body)
}
