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
]

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
