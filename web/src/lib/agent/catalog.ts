// Exercise names are free text end to end, but the engine only works on
// names it can resolve: the muscle lookup, compound detection and history
// anchoring all compare exact lowercase strings. So anything a model (or a
// person typing to it) calls a lift is brought back to the catalog's own
// spelling here, or refused with the nearest names.

import { exerciseCatalog, type CustomExercise } from '../exercises'

/** Common gym shorthand for built-in lifts. */
const ALIASES: Record<string, string> = {
  squat: 'Back squat',
  barbellsquat: 'Back squat',
  rdl: 'Romanian deadlift',
  stifflegdeadlift: 'Romanian deadlift',
  ohp: 'Overhead press',
  militarypress: 'Overhead press',
  shoulderpress: 'Overhead press',
  barbellbenchpress: 'Bench press',
  flatbench: 'Bench press',
  bench: 'Bench press',
  inclinebench: 'Incline bench press',
  inclinepress: 'Incline bench press',
  dbbench: 'Dumbbell bench press',
  dumbbellbench: 'Dumbbell bench press',
  dbpress: 'Dumbbell bench press',
  inclinedbpress: 'Incline dumbbell press',
  inclinedumbbellbench: 'Incline dumbbell press',
  inclinedumbbellbenchpress: 'Incline dumbbell press',
  chestpress: 'Machine chest press',
  chestfly: 'Cable fly',
  cablecrossover: 'Cable fly',
  pecfly: 'Pec deck',
  dip: 'Dips',
  pressup: 'Push-up',
  bentoverrow: 'Barbell row',
  bbrow: 'Barbell row',
  dbrow: 'Dumbbell row',
  onearmrow: 'Dumbbell row',
  cablerow: 'Seated cable row',
  seatedrow: 'Seated cable row',
  pulldown: 'Lat pulldown',
  latpull: 'Lat pulldown',
  tricepspressdown: 'Triceps pushdown',
  triceppushdown: 'Triceps pushdown',
  pushdown: 'Triceps pushdown',
  skullcrushers: 'Skullcrusher',
  lyingtricepsextension: 'Skullcrusher',
  tricepextension: 'Overhead triceps extension',
  overheadtricepextension: 'Overhead triceps extension',
  hamstringcurl: 'Leg curl',
  lyinglegcurl: 'Leg curl',
  seatedlegcurl: 'Leg curl',
  quadextension: 'Leg extension',
  splitsquat: 'Bulgarian split squat',
  standingcalfraise: 'Calf raise',
  reardeltraise: 'Rear delt fly',
  reversefly: 'Rear delt fly',
  lateralraises: 'Lateral raise',
  sideraise: 'Lateral raise',
  bicepcurl: 'Dumbbell curl',
  bicepscurl: 'Dumbbell curl',
  bbcurl: 'Barbell curl',
  dbcurl: 'Dumbbell curl',
  ezcurl: 'EZ-bar curl',
  hyperextension: 'Back extension',
  legraise: 'Hanging leg raise',
  kbswing: 'Kettlebell swing',
  trapbar: 'Trap bar deadlift',
  hexbardeadlift: 'Trap bar deadlift',
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/** "Pull-up", "pull up" and "Pullups" all squash to "pullup". */
const stem = (w: string): string =>
  w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w

const squash = (s: string): string => stem(words(s).map(stem).join(''))

/** Aliases by squashed key, so they match however they were typed above. */
const ALIAS_BY_KEY = new Map(
  Object.entries(ALIASES).map(([k, v]) => [squash(k), v]),
)

export interface Catalog {
  /** Strength exercise names, catalog spelling. */
  names: string[]
  byMuscle: Record<string, string[]>
  /** The catalog's spelling of this name, if it is one we know. */
  resolve: (name: string) => string | undefined
  /** The closest names, best first, for an error the model can act on. */
  suggest: (name: string, count?: number) => string[]
}

export function makeCatalog(customs: CustomExercise[]): Catalog {
  const entries = exerciseCatalog(customs, 'strength')
  const names = entries.map((e) => e.name)
  const exact = new Map<string, string>()
  const squashed = new Map<string, string>()
  const byMuscle: Record<string, string[]> = {}
  for (const e of entries) {
    exact.set(e.name.trim().toLowerCase(), e.name)
    // First one wins: built-ins come before the user's own entries
    if (!squashed.has(squash(e.name))) squashed.set(squash(e.name), e.name)
    ;(byMuscle[e.muscle] ??= []).push(e.name)
  }

  const resolve = (name: string): string | undefined => {
    if (typeof name !== 'string') return undefined
    const direct = exact.get(name.trim().toLowerCase())
    if (direct) return direct
    const key = squash(name)
    if (!key) return undefined
    const bySquash = squashed.get(key)
    if (bySquash) return bySquash
    const alias = ALIAS_BY_KEY.get(key)
    return alias ? exact.get(alias.toLowerCase()) : undefined
  }

  const suggest = (name: string, count = 3): string[] => {
    const want = new Set(words(String(name)).map(stem))
    if (want.size === 0) return []
    const key = squash(String(name))
    return entries
      .map((e) => {
        const have = new Set(words(e.name).map(stem))
        let shared = 0
        for (const w of want) if (have.has(w)) shared++
        const union = new Set([...want, ...have]).size
        const other = squash(e.name)
        const contains = other.includes(key) || key.includes(other) ? 0.25 : 0
        return { name: e.name, score: shared / union + contains }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map((x) => x.name)
  }

  return { names, byMuscle, resolve, suggest }
}
