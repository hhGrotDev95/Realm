// Realm service worker.
// Install: caches the whole build listed in /sw-assets.json (written by vite.config.ts), so the
// app – including lazily loaded screens – works offline after the first visit.
// Navigations: network first, cached app shell as fallback. App files: cache first.
// Only the app itself may enter the cache (see appFile). API responses are never stored here –
// not even when the API shares this origin; the app keeps its own offline copy.

const PREFIX = 'realm-'
let current = null

/** the app shell, the build output and the two static files – nothing else is ever cached */
const STATIC = new Set(['/', '/icon.svg', '/manifest.webmanifest'])
const appFile = (url) => url.origin === self.location.origin && (STATIC.has(url.pathname) || url.pathname.startsWith('/assets/'))
const isApi = (url) => url.pathname === '/api' || url.pathname.startsWith('/api/')

async function manifest() {
  const res = await fetch('/sw-assets.json', { cache: 'no-store' })
  return res.json()
}

async function latestCache() {
  const keys = (await caches.keys()).filter((k) => k.startsWith(PREFIX))
  return caches.open(current ?? keys.pop() ?? PREFIX + 'runtime')
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    manifest().then(async ({ version, files }) => {
      const cache = await caches.open(PREFIX + version)
      await cache.addAll(['/', ...files.map((f) => '/' + f)])
      current = PREFIX + version
      await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const latest = current ?? keys.filter((k) => k.startsWith(PREFIX)).pop()
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== latest).map((k) => caches.delete(k)))
      // earlier versions stored every same-origin GET; an unchanged build keeps its cache name,
      // so remove whatever is not an app file (API answers above all) from the kept cache too
      if (latest) {
        const cache = await caches.open(latest)
        const stale = (await cache.keys()).filter((req) => !appFile(new URL(req.url)))
        await Promise.all(stale.map((req) => cache.delete(req)))
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // other origins: straight to the network (fonts ship with the app)
  if (isApi(url)) return // API on this origin: network only, never cached
  if (req.mode === 'navigate') {
    // All app screens use root + query/hash. Other HTML documents (e.g. the build-status
    // page) must never replace '/' or receive its offline fallback.
    if (url.pathname !== '/') return
    e.respondWith(
      fetch(req)
        .then((res) => {
          // only an HTML page may become the offline shell – never an error page or JSON
          if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) {
            const copy = res.clone()
            e.waitUntil(latestCache().then((c) => c.put('/', copy)))
          }
          return res
        })
        .catch(async () => (await caches.match('/', { ignoreVary: true })) ?? Response.error()),
    )
    return
  }
  if (!appFile(url)) return // anything else on this origin: network only
  e.respondWith(
    // ignoreVary: module scripts send an Origin header the install-time requests did not have,
    // and servers answering with "Vary: Origin" would otherwise never match the cache
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // e.g. a font subset that is not precached; build files are content-hashed
          if (res.ok) {
            const copy = res.clone()
            e.waitUntil(latestCache().then((c) => c.put(req, copy)))
          }
          return res
        }),
    ),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('/'))))
})
