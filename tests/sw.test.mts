// Runs public/sw.js against an in-memory Cache Storage: nothing but the app itself may ever be
// cached – above all no API answers when the API shares the app's origin (docs/DEVICE_STORAGE.md).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const ORIGIN = 'https://realm.test'
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

type Req = { url: string; method: string; mode?: string }
const keyOf = (r: string | Req) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href

function storage() {
  const stores = new Map<string, Map<string, Response>>()
  const cache = (m: Map<string, Response>) => ({
    put: async (r: string | Req, res: Response) => void m.set(keyOf(r), res),
    match: async (r: string | Req) => m.get(keyOf(r))?.clone(),
    addAll: async (urls: string[]) => urls.forEach((u) => m.set(keyOf(u), html('app'))),
    keys: async () => [...m.keys()].map((url) => ({ url, method: 'GET' })),
    delete: async (r: string | Req) => m.delete(keyOf(r)),
  })
  return {
    stores,
    caches: {
      open: async (name: string) => cache(stores.get(name) ?? stores.set(name, new Map()).get(name)!),
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (r: string | Req) => [...stores.values()].map((m) => m.get(keyOf(r))).find(Boolean)?.clone(),
    },
  }
}

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } })
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/** loads a fresh worker; `network` answers every fetch the worker makes */
function worker(network: (url: string) => Response | Promise<Response>, existing?: ReturnType<typeof storage>) {
  const store = existing ?? storage()
  const handlers: Record<string, (e: unknown) => void> = {}
  const fetched: string[] = []
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }
  const fetch = async (r: string | Req) => {
    const url = keyOf(r)
    fetched.push(url)
    return network(url)
  }
  vm.runInNewContext(source, { self, caches: store.caches, fetch, URL, Response, Promise, Set, console })

  async function lifecycle(type: 'install' | 'activate') {
    const pending: Promise<unknown>[] = []
    handlers[type]({ waitUntil: (p: Promise<unknown>) => pending.push(p) })
    await Promise.all(pending)
  }
  /** dispatches a fetch event; `null` means the worker left the request to the browser */
  async function request(path: string, mode = 'cors', method = 'GET') {
    let answer: Promise<Response> | undefined
    const pending: Promise<unknown>[] = []
    handlers.fetch({ request: { url: new URL(path, ORIGIN).href, method, mode }, respondWith: (p: Promise<Response>) => (answer = p), waitUntil: (p: Promise<unknown>) => pending.push(p) })
    const res = answer ? await answer : null
    await Promise.all(pending)
    return res
  }
  const cached = () => [...store.stores.values()].flatMap((m) => [...m.keys()].map((k) => k.replace(ORIGIN, '')))
  return { store, lifecycle, request, cached, fetched }
}

const MANIFEST = { version: 'abc123', files: ['icon.svg', 'manifest.webmanifest', 'assets/index-1.js', 'assets/Map-2.js'] }
const site = (url: string) => {
  const path = url.replace(ORIGIN, '')
  if (path === '/sw-assets.json') return json(MANIFEST)
  if (path.startsWith('/api/')) return json({ guest: 'g1', token: 'secret' })
  if (path.startsWith('/assets/')) return new Response('/* js */', { headers: { 'content-type': 'text/javascript' } })
  if (path === '/robots.txt') return new Response('User-agent: *')
  return html('<!doctype html>app')
}

let checks = 0
const check = (ok: boolean, msg: string) => (assert.ok(ok, msg), checks++)

{
  const w = worker(site)
  await w.lifecycle('install')
  await w.lifecycle('activate')
  check(w.cached().sort().join() === ['/', '/assets/Map-2.js', '/assets/index-1.js', '/icon.svg', '/manifest.webmanifest'].join(), `install precaches the whole build: ${w.cached()}`)

  // same-origin API: answered by the network, never stored – also not as navigation or offline shell
  const api = await w.request('/api/festivals/realm/crew')
  check(api === null, 'same-origin API requests bypass the worker')
  check((await w.request('/api/session', 'navigate')) === null, 'a navigation to the API bypasses the worker')
  check(!w.cached().some((k) => k.startsWith('/api')), 'no API answer in Cache Storage')

  // other same-origin files: network only
  check((await w.request('/robots.txt')) === null && !w.cached().includes('/robots.txt'), 'files outside the build are not cached')

  // app files: cache first, without asking the network again
  const before = w.fetched.length
  const js = await w.request('/assets/index-1.js')
  check(js !== null && (await js.text()) === 'app' && w.fetched.length === before, 'precached app files come from the cache')
  // a build file that was not precached (e.g. a non-Latin font subset) is kept for offline use
  await w.request('/assets/inter-cyrillic.woff2')
  check(w.cached().includes('/assets/inter-cyrillic.woff2'), 'build files fetched later are cached')

  // navigations: an HTML page refreshes the shell, an error page or JSON never replaces it
  await w.request('/?f=realm', 'navigate')
  const shell = async () => (await w.store.caches.match('/'))!.text()
  check((await shell()) === '<!doctype html>app', 'a successful navigation refreshes the offline shell')
  const failing = worker((url) => (url.endsWith('/') || url.includes('?') ? new Response('down', { status: 503, headers: { 'content-type': 'text/html' } }) : site(url)), w.store)
  await failing.request('/', 'navigate')
  const jsonPage = worker((url) => (url.includes('/fest') ? json({ not: 'html' }) : site(url)), w.store)
  await jsonPage.request('/festival', 'navigate')
  check((await shell()) === '<!doctype html>app', 'neither a 503 nor a JSON answer becomes the offline shell')

  // the development status is a separate HTML document, never the visitor app's offline shell
  const progress = worker((url) => url.includes('/development') ? html('development status') : site(url), w.store)
  check((await progress.request('/development', 'navigate')) === null, 'the canonical development page bypasses the app worker')
  check((await progress.request('/development.html', 'navigate')) === null, 'the development page bypasses the app worker')
  check((await shell()) === '<!doctype html>app', 'visiting another HTML page cannot replace the offline app shell')

  // offline: the shell still opens
  const offline = worker(() => Promise.reject(new TypeError('offline')), w.store)
  const res = await offline.request('/?f=realm', 'navigate')
  check(res !== null && (await res.text()) === '<!doctype html>app', 'offline navigations get the cached shell')

  check((await w.request('/api/reports', 'cors', 'POST')) === null, 'non-GET requests are never touched')
}

{
  // update from an older worker that stored every same-origin GET: the build (and so the cache
  // name) is unchanged, yet the API answers already in that cache must go
  const old = storage()
  const legacy = await old.caches.open('realm-abc123')
  await legacy.put('/', html('<!doctype html>app'))
  await legacy.put('/assets/index-1.js', new Response('js'))
  await legacy.put('/api/festivals/realm/crew', json({ chat: ['private'] }))
  await legacy.put('/api/session', json({ token: 'secret' }))
  await legacy.put('/robots.txt', new Response('x'))
  await (await old.caches.open('realm-runtime')).put('/api/me', json({ token: 'old' }))
  await (await old.caches.open('other-app')).put('/data', json({ keep: true }))

  const w = worker(site, old)
  await w.lifecycle('install')
  await w.lifecycle('activate')
  check(!w.cached().some((k) => k.startsWith('/api') || k === '/robots.txt'), `activation removes old non-app entries: ${w.cached()}`)
  check(!old.stores.has('realm-runtime'), 'the old runtime cache is deleted')
  check(old.stores.get('other-app')?.has(`${ORIGIN}/data`) === true, 'caches of other apps on the origin stay untouched')
  check(w.cached().includes('/assets/index-1.js') && w.cached().includes('/'), 'the app itself stays available offline')
}

console.log(`✓ ${checks} Service-Worker-Prüfungen bestanden`)
