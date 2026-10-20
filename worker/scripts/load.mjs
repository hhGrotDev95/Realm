// Local load script (audit F17): N visitors in crews of 5 poll like the app does (crew + reports) and
// now and then write a chat message. Measures latency and errors against a running worker.
//
//   npx wrangler dev --local --port 8797          (in worker/)
//   node scripts/load.mjs --users 200 --seconds 60 --api http://127.0.0.1:8797
//
// Local numbers say nothing about Cloudflare's limits: they only show that the request mix works and
// how it scales on one machine. The real test needs a staging deployment (see docs/CAPACITY.md).
import { createHash } from 'node:crypto'

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k)
  return i > 0 ? process.argv[i + 1] : d
}
const API = arg('api', 'http://127.0.0.1:8797')
const USERS = Number(arg('users', 100))
const SECONDS = Number(arg('seconds', 30))
const FESTIVAL = arg('festival', 'realm-open-air')
const POLL_MS = Number(arg('poll', 8000))

const lat = []
const errors = {}
const req = async (method, path, token, body, ip) => {
  const t = performance.now()
  try {
    const r = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Festival': FESTIVAL, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
    lat.push(performance.now() - t)
    const data = r.status === 204 ? null : await r.json().catch(() => null)
    if (!r.ok) errors[r.status] = (errors[r.status] ?? 0) + 1
    return { status: r.status, data }
  } catch (e) {
    errors[e.name] = (errors[e.name] ?? 0) + 1
    return { status: 0, data: null }
  }
}
const zero = (buf) => {
  let n = 0
  for (const b of buf) {
    if (b === 0) { n += 8; continue }
    return n + Math.clz32(b) - 24
  }
  return n
}
const solve = ({ id, bits }) => {
  for (let nonce = 0; ; nonce++) if (zero(createHash('sha256').update(`${id}:${nonce}`).digest()) >= bits) return nonce
}

// everyone behind one festival WLAN address, like the real thing
const ip = '192.0.2.1'
console.log(`${USERS} Besucher:innen, ${SECONDS} s, Poll alle ${POLL_MS} ms gegen ${API}`)
const users = []
for (let i = 0; i < USERS; i++) {
  let r = await req('POST', '/api/guests', null, { nickname: 'Last' + i }, ip)
  if (r.status === 429 && r.data?.challenge) r = await req('POST', '/api/guests', null, { nickname: 'Last' + i, challenge: { id: r.data.challenge.id, nonce: solve(r.data.challenge) } }, ip)
  if (r.status !== 201) throw new Error('sign-up failed: ' + r.status)
  users.push(r.data)
}
for (let i = 0; i < users.length; i += 5) {
  const owner = users[i]
  const crew = (await req('POST', '/api/crews', owner.token, { name: 'Last ' + i })).data
  await req('PATCH', `/api/crews/${crew.id}`, owner.token, { approveJoins: false })
  for (const u of users.slice(i, i + 5)) {
    u.crew = crew.id
    if (u !== owner) await req('POST', '/api/crews/join', u.token, { code: crew.code })
  }
}
lat.length = 0
for (const k in errors) delete errors[k]

const end = Date.now() + SECONDS * 1000
let polls = 0
await Promise.all(
  users.map(async (u) => {
    await new Promise((r) => setTimeout(r, Math.random() * POLL_MS))
    while (Date.now() < end) {
      await Promise.all([req('GET', `/api/crews/${u.crew}`, u.token), req('GET', '/api/reports', u.token)])
      polls++
      if (Math.random() < 0.05) await req('POST', `/api/crews/${u.crew}/messages`, u.token, { text: 'Last-Test' })
      await new Promise((r) => setTimeout(r, POLL_MS * (0.8 + 0.4 * Math.random())))
    }
  }),
)
lat.sort((a, b) => a - b)
const q = (p) => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] ?? 0)
console.log(`${lat.length} Anfragen (${Math.round(lat.length / SECONDS)}/s), ${polls} Poll-Runden`)
console.log(`Latenz p50 ${q(0.5)} ms · p95 ${q(0.95)} ms · p99 ${q(0.99)} ms`)
console.log('Fehler:', Object.keys(errors).length ? errors : 'keine')
