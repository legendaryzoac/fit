// Built-in recovery routines. Client-side constants (like the meso
// presets) rather than saved templates: they need no account, ship with
// the app, and a user's own routines live beside them as kind 'recovery'
// templates. Every item name must exist in the stretch catalog so the
// player can show its cue text.

import { STRETCHES, stretchByName } from './stretches'
import {
  holdBaseName,
  holdSide,
  isTransition,
  routineHoldSec,
  routineToSections,
  type RoutineItem,
} from './templates'
import type { IntervalSection, WorkoutExercise } from './workouts'

export type RoutineTag = 'sleep' | 'wake' | 'pre' | 'post' | 'region' | 'desk'

export interface Routine {
  id: string
  name: string
  blurb: string
  tags: RoutineTag[]
  transitionSec: number
  items: RoutineItem[]
}

/** Shorthand: catalog defaults unless overridden. */
function it(name: string, seconds?: number): RoutineItem {
  const s = stretchByName(name)
  if (!s) throw new Error(`routine references unknown stretch: ${name}`)
  return {
    name: s.name,
    seconds: seconds ?? s.defaultSec,
    ...(s.perSide && { perSide: true }),
  }
}

export const SLEEP_ROUTINE_ID = 'sleep'

export const BUILTIN_ROUTINES: Routine[] = [
  {
    id: SLEEP_ROUTINE_ID,
    name: 'Sleep',
    blurb: 'Quiet holds before bed',
    tags: ['sleep'],
    transitionSec: 8,
    items: [
      it("Child's pose", 60),
      it('Cat-cow', 40),
      it('Supine twist', 60),
      it('Figure-4', 60),
      it('Happy baby', 60),
      it('Knees to chest', 45),
      it('Legs up the wall', 90),
      it('Box breathing', 60),
    ],
  },
  {
    id: 'wake',
    name: 'Wake up',
    blurb: 'Spine and hips',
    tags: ['wake'],
    transitionSec: 6,
    items: [
      it('Cat-cow', 40),
      it('Downward dog', 40),
      it('Low lunge', 30),
      it('Standing forward fold', 40),
      it('Deep squat hold', 30),
      it('Arm circles', 30),
    ],
  },
  {
    id: 'post-lower',
    name: 'Post-lift · lower',
    blurb: 'Lower body cooldown',
    tags: ['post'],
    transitionSec: 8,
    items: [
      it('Couch stretch', 45),
      it('Supine hamstring', 45),
      it('Figure-4', 45),
      it('Frog', 60),
      it('Wall calf stretch', 40),
      it("Child's pose", 45),
    ],
  },
  {
    id: 'post-upper',
    name: 'Post-lift · upper',
    blurb: 'Upper body cooldown',
    tags: ['post'],
    transitionSec: 8,
    items: [
      it('Doorway pec stretch', 40),
      it('Lat stretch', 40),
      it('Cross-body shoulder', 30),
      it('Thread the needle', 40),
      it('Overhead triceps', 30),
      it('Forearm flexor stretch', 30),
      it("Child's pose", 45),
    ],
  },
  {
    id: 'post-full',
    name: 'Post-lift · full body',
    blurb: 'Full-body cooldown',
    tags: ['post'],
    transitionSec: 8,
    items: [
      it('Couch stretch', 45),
      it('Supine hamstring', 45),
      it('Figure-4', 45),
      it('Doorway pec stretch', 40),
      it('Lat stretch', 40),
      it('Thread the needle', 40),
      it("Child's pose", 45),
    ],
  },
  {
    id: 'hips',
    name: 'Hips',
    blurb: 'Flexors and rotators',
    tags: ['region'],
    transitionSec: 8,
    items: [
      it('90/90', 45),
      it('Pigeon', 60),
      it('Couch stretch', 45),
      it('Adductor rock', 40),
      it('Frog', 60),
      it('Butterfly', 45),
    ],
  },
  {
    id: 'hamstrings',
    name: 'Hamstrings',
    blurb: 'Posterior chain',
    tags: ['region'],
    transitionSec: 8,
    items: [
      it('Standing forward fold', 40),
      it('Single-leg forward fold', 45),
      it('Seated straddle', 45),
      it('Supine hamstring', 45),
      it('Downward dog', 40),
      it('Legs up the wall', 60),
    ],
  },
  {
    id: 'tspine',
    name: 'Thoracic & shoulders',
    blurb: 'Upper back rotation',
    tags: ['region'],
    transitionSec: 8,
    items: [
      it('Cat-cow', 40),
      it('Thread the needle', 40),
      it('Open book', 40),
      it('Sphinx', 40),
      it('Puppy pose', 45),
      it('Doorway pec stretch', 40),
      it('Wall slides', 40),
      it('Lat stretch', 40),
    ],
  },
  {
    id: 'desk',
    name: 'Desk reset',
    blurb: 'Seated, no floor',
    tags: ['desk'],
    transitionSec: 5,
    items: [
      it('Chin tucks', 30),
      it('Neck side stretch', 30),
      it('Seated twist', 30),
      it('Seated figure-4', 40),
      it('Seated chest opener', 30),
    ],
  },
  {
    id: 'pre-lower',
    name: 'Warm-up · lower',
    blurb: 'Lower body warm-up',
    tags: ['pre'],
    transitionSec: 5,
    items: [
      it('Leg swings', 30),
      it('Hip circles', 30),
      it('Ankle rocks', 30),
      it("World's greatest stretch", 45),
      it('Walking lunge with twist', 45),
      it('Deep squat hold', 30),
    ],
  },
  {
    id: 'pre-full',
    name: 'Warm-up · full body',
    blurb: 'Full-body warm-up',
    tags: ['pre'],
    transitionSec: 5,
    items: [
      it('Cat-cow', 40),
      it('Inchworm', 45),
      it("World's greatest stretch", 45),
      it('Leg swings', 30),
      it('Deep squat hold', 30),
      it('Arm circles', 30),
      it('Scapular push-ups', 30),
    ],
  },
  {
    id: 'pre-upper',
    name: 'Warm-up · upper',
    blurb: 'Upper body warm-up',
    tags: ['pre'],
    transitionSec: 5,
    items: [
      it('Arm circles', 30),
      it('Cat-cow', 40),
      it('Scapular push-ups', 30),
      it('Wall slides', 40),
      it('Thread the needle', 30),
      it('Dead hang', 30),
    ],
  },
]

export function routineById(id: string): Routine | undefined {
  return BUILTIN_ROUTINES.find((r) => r.id === id)
}

export function routineSections(r: Routine): IntervalSection[] {
  return routineToSections(r.items, r.transitionSec)
}

/** Wall-clock length including lead-ins and side swaps, in whole minutes. */
export function routineMinutes(r: Routine): number {
  const total = routineSections(r).reduce((s, x) => s + x.durationSec, 0)
  return Math.max(1, Math.round(total / 60))
}

/** Hold minutes only — the number that means "how much stretching". */
export function routineHoldMinutes(r: Routine): number {
  return Math.max(1, Math.round(routineHoldSec(r.items) / 60))
}

/**
 * Turn an executed section list back into per-stretch sets so a saved
 * recovery session has structure (history rows, minutes per region) and
 * not just a duration. Lead-ins and swaps are dropped; per-side holds
 * become two sets on one exercise.
 */
export function recoveryExercisesFromSections(
  sections: IntervalSection[],
): WorkoutExercise[] {
  const out: WorkoutExercise[] = []
  const index = new Map<string, number>()
  for (const s of sections) {
    if (isTransition(s.label)) continue
    const name = holdBaseName(s.label)
    const side = holdSide(s.label)
    const set = { durationSec: s.durationSec, ...(side && { side }) }
    const i = index.get(name)
    if (i === undefined) {
      index.set(name, out.length)
      out.push({ name, sets: [set] })
    } else {
      out[i].sets.push(set)
    }
  }
  return out
}

/** Catalog names, for datalists. */
export const STRETCH_NAMES = STRETCHES.map((s) => s.name)
