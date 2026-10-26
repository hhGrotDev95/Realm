// Keeping the visitor's local state safe on the device: plans, reminders and decisions must survive
// restarts, a second open tab and a full storage quota. Pure helpers, tested in tests/persist.test.mts.

const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

/**
 * Merges stored state over the defaults field by field. A field whose stored value has the wrong
 * type (left by an older version or a damaged copy) falls back to its default instead of crashing
 * the app; every other field is kept. Fields that default to null accept any value.
 */
export function restore<T extends object>(defaults: T, stored: unknown): T {
  if (kind(stored) !== 'object') return defaults
  const out = { ...defaults } as Record<string, unknown>
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    const d = (defaults as Record<string, unknown>)[k]
    if (d === undefined || d === null || kind(v) === kind(d)) out[k] = v
  }
  return out as T
}

export const isQuotaError = (e: unknown) =>
  e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014)

export type SaveResult = 'ok' | 'freed' | 'slim' | 'failed'

/**
 * Writes `value` under `key`. When the storage is full it first drops `evictable` cache keys
 * (offline copies that can be fetched again) and retries, then retries with `slim` (the state
 * without re-fetchable caches). 'failed' means the state is NOT saved – the caller must tell the visitor.
 */
export function save(storage: Storage, key: string, value: string, opts: { evictable?: () => string[]; slim?: () => string } = {}): SaveResult {
  const attempt = (v: string) => {
    try {
      storage.setItem(key, v)
      return true
    } catch (e) {
      if (!isQuotaError(e)) throw e
      return false
    }
  }
  try {
    if (attempt(value)) return 'ok'
    const evict = opts.evictable?.() ?? []
    for (const k of evict) storage.removeItem(k)
    if (evict.length && attempt(value)) return 'freed'
    if (opts.slim && attempt(opts.slim())) return 'slim'
  } catch {
    // storage disabled (private mode, blocked site data): nothing can be kept
  }
  return 'failed'
}

const BUNDLE_PREFIX = 'realm.bundle:'

const keysOf = (storage: Storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k): k is string => k !== null)

/** Offline copies of festivals other than `current`. They are fetched again when the visitor switches back. */
export const otherBundleKeys = (storage: Storage, current: string) =>
  keysOf(storage).filter((k) => k.startsWith(BUNDLE_PREFIX) && k !== BUNDLE_PREFIX + current)

export type StorageUsage = { bytes: number; others: { slug: string; bytes: number }[] }

/**
 * What Realm keeps on this device: all of its keys, and the offline copies of other festivals that
 * can be removed without losing anything of the visitor's own. Browsers store strings as UTF-16 and
 * count key and value against the quota, so a character is two bytes.
 */
export function usage(storage: Storage, current: string): StorageUsage {
  const size = (k: string) => (k.length + (storage.getItem(k)?.length ?? 0)) * 2
  const bytes = keysOf(storage)
    .filter((k) => k.startsWith('realm.'))
    .reduce((n, k) => n + size(k), 0)
  const others = otherBundleKeys(storage, current).map((k) => ({ slug: k.slice(BUNDLE_PREFIX.length), bytes: size(k) }))
  return { bytes, others }
}

/** Removes the offline copies of other festivals; plans, sessions and settings of every festival stay. */
export function dropOtherBundles(storage: Storage, current: string): number {
  const keys = otherBundleKeys(storage, current)
  for (const k of keys) storage.removeItem(k)
  return keys.length
}
