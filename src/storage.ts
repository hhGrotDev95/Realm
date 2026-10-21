/**
 * Writes to localStorage that survive a full quota. The visitor's own state (plan, reminders, outbox) is
 * what must outlive a restart; cached festival documents can always be fetched again. So when the
 * browser refuses a write, caches give way in this order and the write is tried again:
 *   1. cached documents of other festivals,
 *   2. the site plan image in the current festival's cached document (up to ~650 kB).
 * Pure and storage-injectable, so it runs in unit tests without a browser.
 */
export const BUNDLE_PREFIX = 'realm.bundle:'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const tryWrite = (store: Store, key: string, value: string) => {
  try {
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function otherBundles(store: Store, keep: string) {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k && k.startsWith(BUNDLE_PREFIX) && k !== BUNDLE_PREFIX + keep) keys.push(k)
  }
  return keys
}

/** Drops the site plan image from the cached document of `slug`; true when that freed anything. */
function stripSiteMap(store: Store, slug: string) {
  try {
    const raw = store.getItem(BUNDLE_PREFIX + slug)
    if (!raw) return false
    const b = JSON.parse(raw) as { festival?: { siteMap?: string | null } }
    if (!b.festival?.siteMap) return false
    b.festival.siteMap = null
    store.setItem(BUNDLE_PREFIX + slug, JSON.stringify(b))
    return true
  } catch {
    return false
  }
}

/**
 * Saves `value` under `key`, making room from caches if needed. `slug` is the festival in use (its cached
 * document is kept, at most without its site plan image). Returns false only if nothing helped.
 */
export function saveLocal(key: string, value: string, slug: string, store: Store | undefined = globalThis.localStorage): boolean {
  if (!store) return false
  if (tryWrite(store, key, value)) return true
  for (const k of otherBundles(store, slug)) {
    try {
      store.removeItem(k)
    } catch {}
  }
  if (tryWrite(store, key, value)) return true
  // the document itself is being written: store it without the image rather than not at all
  if (key === BUNDLE_PREFIX + slug) {
    try {
      const b = JSON.parse(value) as { festival?: { siteMap?: string | null } }
      if (b.festival?.siteMap) return tryWrite(store, key, JSON.stringify({ ...b, festival: { ...b.festival, siteMap: null } }))
    } catch {}
    return false
  }
  return stripSiteMap(store, slug) && tryWrite(store, key, value)
}

/**
 * Asks the browser to keep this site's storage under storage pressure instead of evicting it
 * (Safari and Chrome may otherwise clear it). Asked once per page load; no prompt in current browsers.
 */
let asked = false
export function askPersistentStorage() {
  if (asked) return
  asked = true
  try {
    void navigator.storage?.persist?.().catch(() => {})
  } catch {}
}
