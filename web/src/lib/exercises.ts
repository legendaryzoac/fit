import { storageKey } from './storage'

export const EXERCISES: Array<{ name: string; muscle: string }> = [
  { name: 'Back squat', muscle: 'quads' },
  { name: 'Front squat', muscle: 'quads' },
  { name: 'Leg press', muscle: 'quads' },
  { name: 'Leg extension', muscle: 'quads' },
  { name: 'Lunge', muscle: 'quads' },
  { name: 'Bulgarian split squat', muscle: 'quads' },
  { name: 'Deadlift', muscle: 'posterior chain' },
  { name: 'Romanian deadlift', muscle: 'hamstrings' },
  { name: 'Leg curl', muscle: 'hamstrings' },
  { name: 'Hip thrust', muscle: 'glutes' },
  { name: 'Calf raise', muscle: 'calves' },
  { name: 'Bench press', muscle: 'chest' },
  { name: 'Incline bench press', muscle: 'chest' },
  { name: 'Dumbbell bench press', muscle: 'chest' },
  { name: 'Cable fly', muscle: 'chest' },
  { name: 'Dips', muscle: 'chest' },
  { name: 'Push-up', muscle: 'chest' },
  { name: 'Overhead press', muscle: 'shoulders' },
  { name: 'Push press', muscle: 'shoulders' },
  { name: 'Lateral raise', muscle: 'shoulders' },
  { name: 'Face pull', muscle: 'rear delts' },
  { name: 'Barbell row', muscle: 'back' },
  { name: 'Dumbbell row', muscle: 'back' },
  { name: 'Pull-up', muscle: 'back' },
  { name: 'Chin-up', muscle: 'back' },
  { name: 'Lat pulldown', muscle: 'back' },
  { name: 'Seated cable row', muscle: 'back' },
  { name: 'Barbell curl', muscle: 'biceps' },
  { name: 'Dumbbell curl', muscle: 'biceps' },
  { name: 'Hammer curl', muscle: 'biceps' },
  { name: 'Triceps pushdown', muscle: 'triceps' },
  { name: 'Skullcrusher', muscle: 'triceps' },
  { name: 'Overhead triceps extension', muscle: 'triceps' },
  { name: 'Plank', muscle: 'core' },
  { name: 'Ab wheel', muscle: 'core' },
  { name: 'Hanging leg raise', muscle: 'core' },
  { name: 'Farmer carry', muscle: 'full body' },
  { name: 'Sumo deadlift', muscle: 'posterior chain' },
  { name: 'Trap bar deadlift', muscle: 'posterior chain' },
  { name: 'Good morning', muscle: 'hamstrings' },
  { name: 'Nordic curl', muscle: 'hamstrings' },
  { name: 'Kettlebell swing', muscle: 'posterior chain' },
  { name: 'Glute bridge', muscle: 'glutes' },
  { name: 'Hip abduction', muscle: 'glutes' },
  { name: 'Back extension', muscle: 'posterior chain' },
  { name: 'Hack squat', muscle: 'quads' },
  { name: 'Goblet squat', muscle: 'quads' },
  { name: 'Zercher squat', muscle: 'quads' },
  { name: 'Step-up', muscle: 'quads' },
  { name: 'Walking lunge', muscle: 'quads' },
  { name: 'Reverse lunge', muscle: 'quads' },
  { name: 'Seated calf raise', muscle: 'calves' },
  { name: 'Incline dumbbell press', muscle: 'chest' },
  { name: 'Machine chest press', muscle: 'chest' },
  { name: 'Pec deck', muscle: 'chest' },
  { name: 'Close-grip bench press', muscle: 'triceps' },
  { name: 'Arnold press', muscle: 'shoulders' },
  { name: 'Landmine press', muscle: 'shoulders' },
  { name: 'Front raise', muscle: 'shoulders' },
  { name: 'Rear delt fly', muscle: 'rear delts' },
  { name: 'Upright row', muscle: 'shoulders' },
  { name: 'Shrug', muscle: 'traps' },
  { name: 'Pendlay row', muscle: 'back' },
  { name: 'T-bar row', muscle: 'back' },
  { name: 'Chest-supported row', muscle: 'back' },
  { name: 'Meadows row', muscle: 'back' },
  { name: 'Straight-arm pulldown', muscle: 'back' },
  { name: 'Cable pullover', muscle: 'back' },
  { name: 'Preacher curl', muscle: 'biceps' },
  { name: 'EZ-bar curl', muscle: 'biceps' },
  { name: 'Cable curl', muscle: 'biceps' },
  { name: 'Concentration curl', muscle: 'biceps' },
  { name: 'Cable crunch', muscle: 'core' },
  { name: 'Russian twist', muscle: 'core' },
  { name: 'Side plank', muscle: 'core' },
  { name: 'Power clean', muscle: 'full body' },
  { name: 'Hang clean', muscle: 'full body' },
  { name: 'Snatch', muscle: 'full body' },
  { name: 'Push jerk', muscle: 'full body' },
  { name: 'Thruster', muscle: 'full body' },
  { name: 'Wall ball', muscle: 'full body' },
  { name: 'Turkish get-up', muscle: 'full body' },
]

/** Exercises loaded by the athlete's own body weight — default the weight
 * field to their WHOOP-measured mass so 1RM and volume math stay honest. */
export const BODYWEIGHT_EXERCISES = new Set([
  'Pull-up',
  'Chin-up',
  'Dips',
  'Push-up',
  'Hanging leg raise',
  'Nordic curl',
  'Ab wheel',
  'Plank',
])

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'kettlebell'
  | 'machine'
  | 'cable'
  | 'band'
  | 'bodyweight'
  | 'weighted'
  | 'other'

export const EQUIPMENT: Array<{ value: Equipment; label: string }> = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
  { value: 'band', label: 'Band' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'weighted', label: 'Weighted bodyweight' },
  { value: 'other', label: 'Other' },
]

export function equipmentLabel(eq: Equipment): string {
  return EQUIPMENT.find((o) => o.value === eq)?.label ?? eq
}

/** True when `v` is one of the nine equipment values. */
export function isEquipment(v: unknown): v is Equipment {
  return EQUIPMENT.some((o) => o.value === v)
}

function inBodyweightSet(name: string): boolean {
  const lower = name.trim().toLowerCase()
  for (const n of BODYWEIGHT_EXERCISES) {
    if (n.toLowerCase() === lower) return true
  }
  return false
}

const EQUIPMENT_KEYWORDS: Array<[string, Equipment]> = [
  ['dumbbell', 'dumbbell'],
  ['barbell', 'barbell'],
  ['kettlebell', 'kettlebell'],
  ['cable', 'cable'],
  ['machine', 'machine'],
  ['band', 'band'],
]

/** Best guess at equipment from the name alone; undefined when unclear. */
export function inferEquipment(name: string): Equipment | undefined {
  if (inBodyweightSet(name)) return 'bodyweight'
  const lower = name.trim().toLowerCase()
  for (const [kw, eq] of EQUIPMENT_KEYWORDS) {
    if (lower.includes(kw)) return eq
  }
  return undefined
}

/** The user's own equipment choices, keyed by lowercase exercise name. Kept
 * at module level so lib code (prescriptions) sees them without threading. */
let equipmentOverrides = new Map<string, Equipment>()

export function registerEquipmentOverrides(customs: CustomExercise[]): void {
  const next = new Map<string, Equipment>()
  for (const c of customs) {
    if (c.equipment && isEquipment(c.equipment)) {
      next.set(c.name.trim().toLowerCase(), c.equipment)
    }
  }
  equipmentOverrides = next
}

export function equipmentOf(name: string): Equipment | undefined {
  return (
    equipmentOverrides.get(name.trim().toLowerCase()) ?? inferEquipment(name)
  )
}

/** Bodyweight moves default the weight field to body mass. An explicit
 * equipment choice wins over the built-in name list. */
export function isBodyweight(name: string): boolean {
  const override = equipmentOverrides.get(name.trim().toLowerCase())
  if (override) return override === 'bodyweight'
  return inBodyweightSet(name)
}

/** Options offered when the user names an exercise we don't know. */
export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'full body',
  'other',
] as const

export interface CustomExercise {
  name: string
  muscle: string
  equipment?: Equipment
  /** Set when this entry is the user's edit of a built-in: the built-in's
   * name. The built-in leaves this user's lists and this entry stands in
   * for it — for them alone; the shared list is untouched. */
  builtin?: string
}

/** Every built-in lift and drill. A function: SPEED_DRILLS is declared below. */
function builtins(): Array<{ name: string; muscle: string }> {
  return [...EXERCISES, ...SPEED_DRILLS]
}

/** The built-in with this name, if there is one. */
export function builtinExercise(
  name: string,
): { name: string; muscle: string } | undefined {
  const lower = name.trim().toLowerCase()
  return builtins().find((e) => e.name.toLowerCase() === lower)
}

/** Lowercase names of the built-ins this user has edited: by `builtin`,
 * or the older way, a custom saved under a built-in's own name. */
export function overriddenBuiltins(customs: CustomExercise[]): Set<string> {
  const out = new Set<string>()
  for (const c of customs) {
    if (c.builtin) out.add(c.builtin.trim().toLowerCase())
    if (builtinExercise(c.name)) out.add(c.name.trim().toLowerCase())
  }
  return out
}

/** The user's edit of a built-in, if they made one. */
export function overrideFor(
  builtin: string,
  customs: CustomExercise[],
): CustomExercise | undefined {
  const lower = builtin.trim().toLowerCase()
  return (
    customs.find((c) => c.builtin?.trim().toLowerCase() === lower) ??
    customs.find((c) => c.name.trim().toLowerCase() === lower)
  )
}

export interface CatalogExercise {
  name: string
  muscle: string
  equipment?: Equipment
}

/**
 * What a picker lists: the built-ins of the kind (lifts, drills, or both
 * when no kind is given), minus the ones this user edited away, then the
 * user's own entries — edits of built-ins included, under their names.
 */
export function exerciseCatalog(
  customs: CustomExercise[],
  kind?: 'strength' | 'speed',
): CatalogExercise[] {
  const base =
    kind === 'speed'
      ? SPEED_DRILLS
      : kind === 'strength'
        ? EXERCISES
        : builtins()
  const gone = overriddenBuiltins(customs)
  const seen = new Set<string>()
  const out: CatalogExercise[] = []
  for (const e of base) {
    const key = e.name.toLowerCase()
    if (gone.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ name: e.name, muscle: e.muscle })
  }
  for (const c of customs) {
    const key = c.name.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(
      c.equipment
        ? { name: c.name, muscle: c.muscle, equipment: c.equipment }
        : { name: c.name, muscle: c.muscle },
    )
  }
  return out
}

const CUSTOM_KEY = 'fit.customExercises'

export function loadCustomExercises(): CustomExercise[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(CUSTOM_KEY)) ?? '[]')
  } catch {
    return []
  }
}

export function saveCustomExercises(list: CustomExercise[]): void {
  localStorage.setItem(storageKey(CUSTOM_KEY), JSON.stringify(list))
}

/** Muscle resolver over built-ins, drills, and the user's own exercises. */
export function makeMuscleLookup(
  customs: CustomExercise[],
): (name: string) => string | undefined {
  const map = new Map<string, string>()
  for (const e of [...EXERCISES, ...SPEED_DRILLS]) {
    map.set(e.name.toLowerCase(), e.muscle)
  }
  for (const e of customs) map.set(e.name.toLowerCase(), e.muscle)
  return (name) => map.get(name.trim().toLowerCase())
}

export const SPEED_DRILLS: Array<{ name: string; muscle: string }> = [
  { name: '10 yd sprint', muscle: 'speed' },
  { name: '40 yd sprint', muscle: 'speed' },
  { name: '100 m sprint', muscle: 'speed' },
  { name: 'Flying 30', muscle: 'speed' },
  { name: 'Hill sprint', muscle: 'speed' },
  { name: 'Sled push', muscle: 'speed' },
  { name: 'Shuttle run', muscle: 'speed' },
  { name: 'Broad jump', muscle: 'power' },
]

export function muscleFor(name: string): string | undefined {
  const lower = name.toLowerCase()
  return [...EXERCISES, ...SPEED_DRILLS].find(
    (e) => e.name.toLowerCase() === lower,
  )?.muscle
}
