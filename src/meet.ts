// Fair meeting point for a group: the place where the longest walk of anyone is shortest
// (minimax), ties broken by the total walk. Pure, so it is unit-tested in Node.

export interface Spot {
  id: string
  x: number
  y: number
}

/** Walking minutes on the site plan (same scale as the rest of the app). */
export const walk = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(1, Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 38))

export function fairMeetingPoint<T extends Spot>(people: { x: number; y: number }[], candidates: T[]): { spot: T; max: number; total: number } | null {
  if (people.length < 2 || !candidates.length) return null
  let best: { spot: T; max: number; total: number } | null = null
  for (const spot of candidates) {
    const times = people.map((p) => walk(p, spot))
    const max = Math.max(...times)
    const total = times.reduce((a, b) => a + b, 0)
    if (!best || max < best.max || (max === best.max && total < best.total)) best = { spot, max, total }
  }
  return best
}
