// Where this morning's reading sits against its ideal range, for the
// rings on Home. Bands that publish no recovery score still say plenty:
// HRV and resting heart rate mean something against the wearer's own
// recent baseline, and sleep against the hours an adult needs.
//
// These are status indicators, not a recovery score: each reading is
// judged on its own, and nothing here combines them.

export type RangeStatus = 'good' | 'fading' | 'bad'

export interface RangeReading {
  value: number
  /** null while there is too little history to judge against. */
  status: RangeStatus | null
  /** One or two words for the status, so colour never stands alone. */
  caption: string
  /** Where the value sits along the gauge, 0 (low end) to 1 (high end). */
  at: number
  /** The ideal range along the same gauge, or null without a baseline. */
  ideal: [number, number] | null
}

/** Readings needed before a personal baseline means anything. */
const MIN_BASELINE = 7
/** The gauge spans the baseline ± this many standard deviations. */
const SPAN_SD = 3
/** Inside this many SDs on the wrong side is still in range… */
const GOOD_SD = 0.5
/** …and inside this many is fading; beyond it is bad. */
const FADING_SD = 1.5

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function stats(xs: number[]): { mean: number; sd: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
  return { mean, sd: Math.sqrt(variance) }
}

/**
 * A reading against the wearer's own baseline: the mean and spread of
 * the readings before it (up to 30). `better` says which direction is
 * the healthy one. A very steady history would make any wobble look
 * extreme, so the spread never counts as less than `minSpread` of the
 * mean.
 */
function againstBaseline(
  series: number[],
  better: 'higher' | 'lower',
  minSpread: number,
  captions: { fading: string; bad: string },
): RangeReading | null {
  const value = series.at(-1)
  if (value === undefined) return null
  const history = series.slice(0, -1).slice(-30)
  if (history.length < MIN_BASELINE) {
    return { value, status: null, caption: 'Building baseline', at: 0.5, ideal: null }
  }
  const { mean, sd: rawSd } = stats(history)
  const sd = Math.max(rawSd, mean * minSpread)
  const z = (value - mean) / sd
  // How far onto the unhealthy side the reading sits, in SDs
  const off = better === 'higher' ? -z : z
  const status: RangeStatus = off <= GOOD_SD ? 'good' : off <= FADING_SD ? 'fading' : 'bad'
  const position = (zScore: number) => clamp01((zScore + SPAN_SD) / (2 * SPAN_SD))
  return {
    value,
    status,
    caption: status === 'good' ? 'In range' : captions[status],
    at: position(z),
    ideal:
      better === 'higher' ? [position(-GOOD_SD), 1] : [0, position(GOOD_SD)],
  }
}

/** HRV, oldest first, ending with this morning's. Higher is better. */
export function hrvReading(series: number[]): RangeReading | null {
  return againstBaseline(series, 'higher', 0.05, { fading: 'Fading', bad: 'Low' })
}

/** Resting heart rate, oldest first, ending with this morning's. Lower is better. */
export function rhrReading(series: number[]): RangeReading | null {
  return againstBaseline(series, 'lower', 0.05, { fading: 'Fading', bad: 'High' })
}

/** The gauge runs from four hours to ten. */
const SLEEP_MIN_H = 4
const SLEEP_MAX_H = 10
/** Seven hours or more is the adult guideline; under six is short. */
const SLEEP_GOOD_H = 7
const SLEEP_FADING_H = 6

/** Last night's time in bed, in minutes, against the hours an adult needs. */
export function sleepReading(inBedMin: number | null | undefined): RangeReading | null {
  if (inBedMin == null) return null
  const hours = inBedMin / 60
  const position = (h: number) => clamp01((h - SLEEP_MIN_H) / (SLEEP_MAX_H - SLEEP_MIN_H))
  const status: RangeStatus =
    hours >= SLEEP_GOOD_H ? 'good' : hours >= SLEEP_FADING_H ? 'fading' : 'bad'
  return {
    value: inBedMin,
    status,
    caption: status === 'good' ? 'In range' : status === 'fading' ? 'Fading' : 'Short',
    at: position(hours),
    ideal: [position(SLEEP_GOOD_H), 1],
  }
}
