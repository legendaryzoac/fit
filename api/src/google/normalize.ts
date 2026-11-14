/**
 * Google Health API data points → wearable-agnostic entities.
 *
 * Two layers. `parse*` reads the vendor's JSON into a small typed value
 * and is the only place that knows Google's field names; `to*Entity`
 * turns that value into what the table stores. When a real payload
 * differs from the documented shape, the fix belongs in `parse*`.
 *
 * Google sends 64-bit integers as strings, days as { year, month, day }
 * and UTC offsets as durations ("-14400s").
 */

import type {
  SleepEntity,
  StepsEntity,
  VendorRecord,
  VitalsEntity,
} from '../providers/types'
import { isoDate, toOffset, toUtcIso, type CivilDate } from '../providers/time'

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

const isCivilDate = (d: unknown): d is CivilDate =>
  typeof d === 'object' &&
  d !== null &&
  ['year', 'month', 'day'].every((k) => typeof (d as Record<string, unknown>)[k] === 'number')

// ---- sleep ----

export interface ParsedSleep {
  id: string
  start: string
  end: string
  timezoneOffset?: string
  nap: boolean
  inBedMin?: number
  asleepMin?: number
  awakeMin?: number
  lightMin?: number
  deepMin?: number
  remMin?: number
  updatedAt?: string
}

/** Minutes per stage type, from the summary or else the stage segments. */
function stageMinutes(sleep: VendorRecord): Record<string, number> {
  const minutes: Record<string, number> = {}
  const summary: VendorRecord[] = sleep.summary?.stagesSummary ?? []
  for (const stage of summary) {
    const m = num(stage.minutes)
    if (typeof stage.type === 'string' && m !== undefined) minutes[stage.type] = m
  }
  if (summary.length > 0) return minutes
  for (const stage of (sleep.stages ?? []) as VendorRecord[]) {
    const ms = Date.parse(stage.endTime) - Date.parse(stage.startTime)
    if (typeof stage.type !== 'string' || !Number.isFinite(ms)) continue
    minutes[stage.type] = (minutes[stage.type] ?? 0) + ms / 60_000
  }
  return minutes
}

export function parseSleep(point: VendorRecord): ParsedSleep | null {
  const sleep = point.sleep
  const interval = sleep?.interval
  if (!interval?.startTime || !interval?.endTime) return null
  const start = toUtcIso(interval.startTime)
  const end = toUtcIso(interval.endTime)
  const name: string | undefined = point.dataPointName ?? point.name
  const stages = stageMinutes(sleep)
  const inBed =
    num(sleep.summary?.minutesInSleepPeriod) ??
    (Date.parse(end) - Date.parse(start)) / 60_000
  const meta = sleep.metadata ?? {}
  return {
    // Identifiable data points are named …/dataPoints/<id>
    id: name?.split('/').pop() || end,
    start,
    end,
    timezoneOffset: toOffset(interval.endUtcOffset ?? interval.startUtcOffset),
    nap: meta.nap === true || meta.mainSleep === false,
    inBedMin: round1(inBed),
    asleepMin: num(sleep.summary?.minutesAsleep),
    awakeMin: num(sleep.summary?.minutesAwake) ?? stages.AWAKE,
    // Absent on "classic" logs and short naps, which have no stage split
    lightMin: stages.LIGHT,
    deepMin: stages.DEEP,
    remMin: stages.REM,
    updatedAt: sleep.updateTime,
  }
}

export function toSleepEntity(s: ParsedSleep): SleepEntity {
  const stage = (m: number | undefined) => (m === undefined ? undefined : round1(m))
  return {
    sk: `SLEEP#${s.end}#${s.id}`,
    type: 'sleep',
    source: 'google',
    id: s.id,
    start: s.start,
    end: s.end,
    timezoneOffset: s.timezoneOffset,
    nap: s.nap,
    inBedMin: s.inBedMin,
    awakeMin: stage(s.awakeMin),
    lightMin: stage(s.lightMin),
    deepMin: stage(s.deepMin),
    remMin: stage(s.remMin),
    // Google's own definition: asleep ÷ in bed
    efficiencyPct:
      s.asleepMin !== undefined && s.inBedMin
        ? Math.round((s.asleepMin / s.inBedMin) * 100)
        : undefined,
    updatedAt: s.updatedAt,
  }
}

export function normalizeSleep(point: VendorRecord): SleepEntity | null {
  const parsed = parseSleep(point)
  return parsed && toSleepEntity(parsed)
}

// ---- daily vitals: four data types, one stored row per civil date ----

export interface ParsedDaily {
  date: string
  hrvMs?: number
  hrvDeepSleepMs?: number
  rhr?: number
  spo2Pct?: number
  skinTempC?: number
  skinTempDeviationC?: number
}

/** The data type's payload inside a data point, whichever it is. */
const DAILY_KEYS = [
  'dailyHeartRateVariability',
  'dailyRestingHeartRate',
  'dailyOxygenSaturation',
  'dailySleepTemperatureDerivations',
] as const

export function parseDaily(point: VendorRecord): ParsedDaily | null {
  const key = DAILY_KEYS.find((k) => point[k])
  if (!key) return null
  const value = point[key]
  if (!isCivilDate(value.date)) return null
  const date = isoDate(value.date)
  switch (key) {
    case 'dailyHeartRateVariability':
      return {
        date,
        hrvMs: num(value.averageHeartRateVariabilityMilliseconds),
        hrvDeepSleepMs: num(value.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
      }
    case 'dailyRestingHeartRate':
      return { date, rhr: num(value.beatsPerMinute) }
    case 'dailyOxygenSaturation':
      return { date, spo2Pct: num(value.averagePercentage) }
    case 'dailySleepTemperatureDerivations': {
      const nightly = num(value.nightlyTemperatureCelsius)
      const baseline = num(value.baselineTemperatureCelsius)
      return {
        date,
        skinTempC: nightly,
        skinTempDeviationC:
          nightly !== undefined && baseline !== undefined
            ? round2(nightly - baseline)
            : undefined,
      }
    }
  }
}

export function toDailyEntity(d: ParsedDaily): VitalsEntity {
  return {
    // One row per civil date whichever data type arrives first; the others
    // merge into it. Sorts with WHOOP's RECOVERY#<timestamp>#<cycle> rows.
    sk: `RECOVERY#${d.date}#google`,
    type: 'recovery',
    source: 'google',
    date: d.date,
    hrvMs: d.hrvMs,
    hrvDeepSleepMs: d.hrvDeepSleepMs,
    rhr: d.rhr,
    spo2Pct: d.spo2Pct,
    skinTempC: d.skinTempC,
    skinTempDeviationC: d.skinTempDeviationC,
  }
}

export function normalizeDaily(point: VendorRecord): VitalsEntity | null {
  const parsed = parseDaily(point)
  return parsed && toDailyEntity(parsed)
}

/** The civil date a daily data point is for, for its raw-archive name. */
export function dailyDateOf(point: VendorRecord): string {
  return parseDaily(point)?.date ?? 'unknown'
}

// ---- steps: one roll-up window per civil day ----

export interface ParsedSteps {
  date: string
  steps: number
}

/** null for a day the band was not worn (the roll-up carries no value). */
export function parseStepsRollup(point: VendorRecord): ParsedSteps | null {
  const date = point.civilStartTime?.date
  const steps = num(point.steps?.countSum)
  if (!isCivilDate(date) || steps === undefined) return null
  return { date: isoDate(date), steps }
}

export function toStepsEntity(s: ParsedSteps): StepsEntity {
  return { sk: `STEPS#${s.date}`, type: 'steps', source: 'google', date: s.date, steps: s.steps }
}

export function normalizeSteps(point: VendorRecord): StepsEntity | null {
  const parsed = parseStepsRollup(point)
  return parsed && toStepsEntity(parsed)
}

export function stepsDateOf(point: VendorRecord): string {
  const date = point.civilStartTime?.date
  return isCivilDate(date) ? isoDate(date) : 'unknown'
}
