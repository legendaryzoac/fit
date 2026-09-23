// Stick-figure drawings for the stretch catalog. Lazy: each figure is its
// own tiny chunk, fetched when a routine shows it, so the 48 drawings never
// sit in the entry bundle. Vite-only (import.meta.glob) — keep it out of
// the pure libs.

import { poseSlug } from './stretches'

const FIGURES = import.meta.glob('../poses/*.svg', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export function loadPoseFigure(name: string): Promise<string | null> {
  const loader = FIGURES[`../poses/${poseSlug(name)}.svg`]
  return loader ? loader().catch(() => null) : Promise.resolve(null)
}
