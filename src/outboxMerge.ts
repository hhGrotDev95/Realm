/**
 * Two tabs of the app share one stored state. When the other tab saves, this tab adopts that
 * state – but the other tab may have saved a state from *before* this tab queued a write
 * (e.g. right after one of its polls). Adopting it wholesale silently dropped that write from
 * this tab's outbox and, on the next save, from storage.
 *
 * Every write queued in this tab is tracked until the other tab has seen it:
 * - in the adopted outbox → the other tab knows it (from now on its absence means "sent");
 * - missing and never seen there → the adopted state is stale: keep the write;
 * - missing after it was seen, or listed as sent by the other tab → it was sent: forget it.
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
  opts: { key?: (op: T) => string | null; sentThere?: readonly string[]; sentHere?: readonly string[] } = {},
): T[] {
  const key = opts.key ?? (() => null)
  const done = new Set([...(opts.sentThere ?? []), ...(opts.sentHere ?? [])])
  incoming = incoming.filter((o) => !done.has(o.id))
  const ids = new Set(incoming.map((o) => o.id))
  const keys = new Set(incoming.map(key).filter((k) => k !== null))
  const keep: T[] = []
  for (const [id, seen] of tracked) {
    if (ids.has(id)) tracked.set(id, true)
    else if (seen || done.has(id)) tracked.delete(id)
  }
  for (const op of own) {
    if (ids.has(op.id) || tracked.get(op.id) !== false) continue
    // privacy decisions replace each other: the adopted state already carries one for this target
    const k = key(op)
    if (k !== null && keys.has(k)) {
      tracked.delete(op.id)
      continue
    }
    keep.push(op)
  }
  // a tracked write that is in neither list is gone for good (sent or replaced here)
  for (const [id, seen] of tracked) if (!seen && !own.some((o) => o.id === id)) tracked.delete(id)
  return keep.length ? [...incoming, ...keep] : [...incoming]
}
