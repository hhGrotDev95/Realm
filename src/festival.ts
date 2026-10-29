// Which festival this app shows, and loading its data from the API (with an offline copy).
import { t } from './i18n'
import { adminApi, api, online, setFestival } from './api'
import { FESTIVAL, loadFestivalBundle as loadBundle, type FestivalBundle } from './data'
import { applyTheme } from './theme/apply'

/** Loads the data and applies the festival's branding in one go. */
const loadFestivalBundle = (b: FestivalBundle) => {
  loadBundle(b)
  applyTheme(FESTIVAL.theme)
}

export const DEFAULT_FESTIVAL = (import.meta.env.VITE_FESTIVAL as string | undefined) || 'realm-open-air'
const PICK_KEY = 'realm.festival'
const bundleKey = (slug: string) => `realm.bundle:${slug}`

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** ?f=<slug> in the URL picks a festival (and is remembered); otherwise the last one or the default. */
export function currentSlug(): string {
  const fromUrl = new URLSearchParams(location.search).get('f')
  if (fromUrl && /^[a-z0-9-]{2,40}$/.test(fromUrl)) {
    safe(() => localStorage.setItem(PICK_KEY, fromUrl), undefined)
    return fromUrl
  }
  return safe(() => localStorage.getItem(PICK_KEY), null) || DEFAULT_FESTIVAL
}

export function switchFestival(slug: string) {
  safe(() => localStorage.setItem(PICK_KEY, slug), undefined)
  location.href = `${location.pathname}?f=${encodeURIComponent(slug)}`
}

/** Guards the cache against partial or foreign documents. */
const isBundle = (b: unknown): b is FestivalBundle => {
  const x = b as FestivalBundle | null
  return !!x && typeof x.festival?.slug === 'string' && Array.isArray(x.days) && x.days.length > 0 && Array.isArray(x.stages) && Array.isArray(x.acts) && Array.isArray(x.pois)
}

/** The published festival from the server, also kept as the offline copy. */
async function fetchBundle(slug: string) {
  const b = await api.festival(slug)
  if (!isBundle(b)) throw new Error(t('Festivaldaten unvollständig'))
  safe(() => localStorage.setItem(bundleKey(slug), JSON.stringify(b)), undefined)
  return b
}

/**
 * Fetches the published festival again and applies it. Resolves false offline, in an organizer
 * preview or when the request fails – the data shown so far stays then.
 */
export async function refetchFestival(): Promise<boolean> {
  if (!online || new URLSearchParams(location.search).get('preview')) return false
  try {
    loadFestivalBundle(await fetchBundle(FESTIVAL.slug))
  } catch {
    return false
  }
  window.dispatchEvent(new Event('realm:festival-updated'))
  return true
}

export type BootResult = { ok: true; fresh: Promise<boolean> } | { ok: false; error: string }

/**
 * Loads the festival before the first render. A cached copy renders immediately (offline-first)
 * while a fresh copy is fetched; `fresh` resolves true when newer data was applied.
 */
export async function bootFestival(): Promise<BootResult> {
  if (!online) return { ok: true, fresh: Promise.resolve(false) }
  const slug = currentSlug()
  setFestival(slug)
  // organizer preview of a draft: uses the console's admin token from this tab and is never cached
  const adminToken = new URLSearchParams(location.search).get('preview') ? safe(() => sessionStorage.getItem('realm.admin'), null) : null
  if (adminToken) {
    try {
      const b = await adminApi(adminToken).bundle(slug)
      if (!isBundle(b)) throw new Error(t('Festivaldaten unvollständig'))
      loadFestivalBundle(b)
      return { ok: true, fresh: Promise.resolve(false) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : t('Vorschau nicht möglich') }
    }
  }
  const stored = safe(() => JSON.parse(localStorage.getItem(bundleKey(slug)) ?? 'null') as unknown, null)
  const cached = isBundle(stored) && stored.festival.slug === slug ? stored : null
  const fetchFresh = () => fetchBundle(slug)
  if (cached) {
    loadFestivalBundle(cached)
    const fresh = fetchFresh().then(
      (b) => {
        if (b.festival.updatedAt === cached.festival.updatedAt && JSON.stringify(b) === JSON.stringify(cached)) return false
        loadFestivalBundle(b)
        return true
      },
      () => false,
    )
    return { ok: true, fresh }
  }
  try {
    loadFestivalBundle(await fetchFresh())
    return { ok: true, fresh: Promise.resolve(false) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t('Unbekannter Fehler') }
  }
}
