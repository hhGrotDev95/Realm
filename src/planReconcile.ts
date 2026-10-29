// What happens to a visitor's plan when the organizer removes acts or re-imports the line-up.
// Pure, tested in tests/planReconcile.test.mts.

export type ActInfo = { artist: string; day: number; start: number }

/** A notice for the visitor: a planned act left the programme, or moved to a new slot (new id). */
export type PlanNotice =
  | { kind: 'gone'; id: string; artist: string | null; day: number | null; start: number | null }
  | { kind: 'moved'; id: string; to: string; artist: string }

const norm = (s: string) => s.trim().toLocaleLowerCase()

/**
 * Splits the plan into acts the festival still has, acts that moved and acts that are gone.
 *
 * `known` is the current line-up – it must come from a copy fetched from the server just now, never
 * from an older cache, or an act planned in a newer tab would be dropped. `earlier` are line-ups
 * shown before (oldest first, may be empty). An unknown act counts as moved only when exactly one act
 * of the same artist is in the current line-up but was not in the line-up the unknown act came from –
 * an artist's second set that existed all along is never taken for a move.
 */
export function reconcilePlan(plan: string[], known: Record<string, ActInfo>, earlier: readonly ReadonlyMap<string, ActInfo>[]) {
  const next: string[] = []
  const notices: PlanNotice[] = []
  for (const id of plan) {
    if (known[id]) {
      if (!next.includes(id)) next.push(id)
      continue
    }
    const from = [...earlier].reverse().find((l) => l.has(id))
    const was = from?.get(id)
    const candidates = from && was ? Object.entries(known).filter(([kid, a]) => norm(a.artist) === norm(was.artist) && !from.has(kid)) : []
    if (was && candidates.length === 1) {
      const to = candidates[0][0]
      if (!next.includes(to)) next.push(to)
      notices.push({ kind: 'moved', id, to, artist: candidates[0][1].artist })
    } else {
      notices.push({ kind: 'gone', id, artist: was?.artist ?? null, day: was?.day ?? null, start: was?.start ?? null })
    }
  }
  return { plan: next, notices }
}

/** Moves (or drops) per-act decisions keyed by act id along with the plan. */
export function rekey<T>(map: Record<string, T>, notices: PlanNotice[]): Record<string, T> {
  const out = { ...map }
  for (const n of notices) {
    if (!(n.id in out)) continue
    if (n.kind === 'moved' && !(n.to in out)) out[n.to] = out[n.id]
    delete out[n.id]
  }
  return out
}
