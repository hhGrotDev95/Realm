/**
 * How often the app asks the server for news (audit F17). Active visitors get crew chat and reports within
 * seconds; a phone lying untouched in a pocket asks rarely; hidden tabs do not ask at all (see store).
 * The jitter spreads thousands of phones over the interval instead of letting them hit the server together.
 */
export const POLL_ACTIVE_MS = 8_000
export const POLL_IDLE_MS = 30_000
export const POLL_AWAY_MS = 60_000

export function pollDelay(idleMs: number, random = Math.random) {
  const base = idleMs < 2 * 60_000 ? POLL_ACTIVE_MS : idleMs < 15 * 60_000 ? POLL_IDLE_MS : POLL_AWAY_MS
  return Math.round(base * (0.8 + 0.4 * random()))
}

/** Every request gives up after this long, so one hanging request cannot block the outbox (audit F17). */
export const REQUEST_TIMEOUT_MS = 15_000
