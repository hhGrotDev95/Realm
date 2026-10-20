// Server notices carry ages relative to the moment they were fetched. Shown later – offline,
// after hours – they must keep ageing and expire, or "3 min ago, valid 40 min" stays on screen
// forever (audit F10). Pure, so it is unit-tested in Node.

export interface Relative {
  ageMin: number
  /** minutes left; null/undefined = no expiry */
  validMin?: number | null
}

/** Ages notices by the time since `fetchedAt` and drops the ones that expired meanwhile. */
export function ageSince<T extends Relative>(items: T[], fetchedAt: number, now: number): T[] {
  // unknown fetch time (data saved by an older version) counts as very old: such notices expire
  const since = Number.isFinite(fetchedAt) ? Math.max(0, Math.floor((now - fetchedAt) / 60_000)) : Number.MAX_SAFE_INTEGER
  return items
    .map((x) => ({ ...x, ageMin: x.ageMin + since, validMin: x.validMin === null || x.validMin === undefined ? x.validMin : x.validMin - since }))
    .filter((x) => x.validMin === null || x.validMin === undefined || x.validMin > 0)
}
