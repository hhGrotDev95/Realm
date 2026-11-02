// The festival's own site plan. The image is fetched once per version and kept in the Cache API,
// so the map works offline even if the visitor never opened it while connected.
import { API_URL } from './api'
import { FESTIVAL, MAP } from './data'

// not "realm-…": the service worker deletes those caches on every app update
const CACHE = 'site-plans'
const urlFor = (slug: string, version: number) => `${API_URL}/api/festivals/${encodeURIComponent(slug)}/map/${version}`
const prefix = (slug: string) => `${API_URL}/api/festivals/${encodeURIComponent(slug)}/map/`

const adminToken = () => {
  try {
    return sessionStorage.getItem('realm.admin')
  } catch {
    return null
  }
}

const objectUrls = new Map<string, Promise<string>>()

async function fetchBlob(url: string, adminToken: string | null): Promise<Blob> {
  const res = await fetch(url, adminToken ? { headers: { Authorization: 'Bearer ' + adminToken } } : undefined)
  if (!res.ok) throw new Error('Geländeplan konnte nicht geladen werden')
  return res.blob()
}

/**
 * Returns an object URL for the current festival's plan: cache first, then network. Old
 * versions of the same festival are removed from the cache once a newer one is stored.
 * Drafts (organizer preview) go through the admin token and are never cached.
 */
export function mapImageUrl(): Promise<string> | null {
  if (!API_URL || MAP.version === null) return null
  const slug = FESTIVAL.slug
  const url = urlFor(slug, MAP.version)
  const hit = objectUrls.get(url)
  if (hit) return hit
  const p = (async () => {
    const draft = FESTIVAL.status === 'draft'
    const cache = !draft && 'caches' in window ? await caches.open(CACHE).catch(() => null) : null
    const cached = await cache?.match(url)
    if (cached) return URL.createObjectURL(await cached.blob())
    const blob = await fetchBlob(url, draft ? adminToken() : null)
    if (cache) {
      await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type } })).catch(() => undefined)
      for (const req of await cache.keys()) if (req.url.startsWith(prefix(slug)) && req.url !== url) await cache.delete(req)
    }
    return URL.createObjectURL(blob)
  })()
  // a failed attempt must not stick: the next call (e.g. after reconnecting) tries again
  p.catch(() => objectUrls.delete(url))
  objectUrls.set(url, p)
  return p
}

/** Fetches the plan in the background right after the festival loads. */
export function prefetchMapImage() {
  mapImageUrl()?.catch(() => undefined)
}
