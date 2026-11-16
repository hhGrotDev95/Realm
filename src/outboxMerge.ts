/**
 * Two tabs of the app share one stored state. When the other tab saves, this tab adopts that
 * state – but the other tab may have saved a state from *before* this tab queued a write
 * (e.g. right after one of its polls). Adopting it wholesale silently dropped that write from
 * this tab's outbox and, on the next save, from storage.
 *
 * Every write queued in this tab is tracked until it is explicitly acknowledged:
 * - in the adopted outbox → the other tab knows it;
 * - missing without a sent ID → the adopted state may be stale: keep the write,
 *   even if an earlier snapshot already contained it;
 * - listed as sent by either tab → it was completed: forget it.
 *   (The other tab may send a write it adopted without ever saving a state that contains it,
 *   so "sent" travels along explicitly; otherwise this tab would queue it again.)
 * The reverse also happens: a stale state still lists a write this tab has sent – it is dropped.
 * Retries are idempotent on the server (client ids), so a rare second send is harmless.
 */
export type QueuedOp = { id: string }

export function mergeOutbox<T extends QueuedOp>(
  own: readonly T[],
  incoming: readonly T[],
  tracked: Map<string, boolean>,
  opts: { key?: (op: T) => string | null; sentThere?: readonly string[]; sentHere?: readonly string[]; sameOwner?: boolean } = {},
): T[] {
  if (opts.sameOwner === false) {
    tracked.clear()
    const done = new Set(opts.sentThere ?? [])
    return incoming.filter((o) => !done.has(o.id))
  }
  const key = opts.key ?? (() => null)
  const done = new Set([...(opts.sentThere ?? []), ...(opts.sentHere ?? [])])
  incoming = incoming.filter((o) => !done.has(o.id))
  const ids = new Set(incoming.map((o) => o.id))
  const keys = new Set(incoming.map(key).filter((k) => k !== null))
  const keep: T[] = []
  for (const [id] of tracked) {
    if (ids.has(id)) tracked.set(id, true)
    else if (done.has(id)) tracked.delete(id)
  }
  for (const op of own) {
    if (ids.has(op.id) || !tracked.has(op.id)) continue
    // privacy decisions replace each other: the adopted state already carries one for this target
    const k = key(op)
    if (k !== null && keys.has(k)) {
      tracked.delete(op.id)
      continue
    }
    keep.push(op)
  }
  // a tracked write that is in neither list is gone for good (sent or replaced here)
  for (const [id] of tracked) if (!ids.has(id) && !own.some((o) => o.id === id)) tracked.delete(id)
  return keep.length ? [...incoming, ...keep] : [...incoming]
}

/** A stale tab must not turn a confirmed delivery back into a pending bubble. */
export function mergeConfirmedChat<T extends { id: string; pending?: boolean }>(own: readonly T[], incoming: readonly T[], sentHere: readonly string[]): T[] {
  const confirmed = new Map(own.filter((m) => !m.pending).map((m) => [m.id, m]))
  const incomingIds = new Set(incoming.map((m) => m.id))
  const sent = new Set(sentHere)
  return [
    // Fresh server versions, including deletions/moderation, always win over local ones.
    ...incoming.map((m) => (m.pending ? confirmed.get(m.id) ?? m : m)),
    // Keep recently completed own messages omitted by a stale snapshot. Do not union
    // the whole history: full server snapshots remain authoritative for older content.
    ...own.filter((m) => !m.pending && sent.has(m.id) && !incomingIds.has(m.id)),
  ]
}
