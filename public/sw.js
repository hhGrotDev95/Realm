// Realm service worker.
// Install: caches the whole build listed in /sw-assets.json (written by vite.config.ts), so the
// app – including lazily loaded screens – works offline after the first visit.
// Navigations: network first, cached app shell as fallback. Assets: cache first.
// API responses (other origin) are never cached here; the app keeps its own offline copy.

const PREFIX = 'realm-'
let current = null

async function manifest() {
  const res = await fetch('/sw-assets.json', { cache: 'no-store' })
  return res.json()
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
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  if (!sameOrigin) return // API and everything else: straight to the network (fonts ship with the app)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(async (res) => {
          if (res.ok) (await caches.open((await caches.keys()).filter((k) => k.startsWith(PREFIX)).pop() ?? PREFIX + 'runtime')).put('/', res.clone())
          return res
        })
        .catch(async () => (await caches.match('/', { ignoreVary: true })) ?? Response.error()),
    )
    return
  }
  e.respondWith(
    // ignoreVary: module scripts send an Origin header the install-time requests did not have,
    // and servers answering with "Vary: Origin" would otherwise never match the cache
    caches.match(req, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then(async (res) => {
          if (res.ok || res.type === 'opaque') {
            const keys = (await caches.keys()).filter((k) => k.startsWith(PREFIX))
            ;(await caches.open(keys.pop() ?? PREFIX + 'runtime')).put(req, res.clone())
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
