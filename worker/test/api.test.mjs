// Integration tests: run against `wrangler dev --local` with a fresh local D1.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'

const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`
const persist = '.wrangler/test-state'
rmSync(persist, { recursive: true, force: true })

const run = (args) =>
  new Promise((res, rej) => {
    const p = spawn('npx', ['wrangler', ...args], { stdio: 'ignore' })
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error('wrangler ' + args.join(' ') + ' failed'))))
  })
await run(['d1', 'migrations', 'apply', 'realm', '--local', '--persist-to', persist])
const server = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', persist, '--var', 'ADMIN_TOKEN:test-admin-token'], { stdio: 'ignore', detached: true })

for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE + '/api/health')).ok) break
  } catch {}
  if (i > 150) throw new Error('worker did not start')
  await new Promise((r) => setTimeout(r, 200))
}

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null }
}

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log('✓', name)
}

try {
  let lea, ben, crew

  await test('creates guests; nickname is optional', async () => {
    const a = await api('POST', '/api/guests', null, { nickname: 'Lea', color: '#FF8A65' })
    assert.equal(a.status, 201)
    assert.match(a.data.token, /^[\w-]{40,}$/)
    lea = a.data
    const b = await api('POST', '/api/guests', null, {})
    assert.equal(b.data.nickname, null)
    ben = b.data
  })

  await test('rejects missing or wrong tokens', async () => {
    assert.equal((await api('GET', '/api/me')).status, 401)
    assert.equal((await api('GET', '/api/me', 'nope')).status, 401)
  })

  await test('social actions require a name', async () => {
    const r = await api('POST', '/api/crews', ben.token, { name: 'X' })
    assert.equal(r.status, 403)
    const p = await api('PATCH', '/api/me', ben.token, { nickname: 'Ben' })
    assert.equal(p.data.nickname, 'Ben')
  })

  await test('validates input', async () => {
    assert.equal((await api('PATCH', '/api/me', lea.token, { color: 'red' })).status, 400)
    assert.equal((await api('POST', '/api/crews', lea.token, { name: 'x'.repeat(41) })).status, 400)
    assert.equal((await api('PUT', '/api/me/plan', lea.token, { acts: 'nope' })).status, 400)
  })

  await test('creates a crew and joins it by code (case/format-insensitive)', async () => {
    const c = await api('POST', '/api/crews', lea.token, { name: 'Zeltplatz 14' })
    assert.equal(c.status, 201)
    crew = c.data
    const j = await api('POST', '/api/crews/join', ben.token, { code: crew.code.toLowerCase().replace('-', ' ') })
    assert.equal(j.status, 200)
    assert.equal(j.data.id, crew.id)
    assert.equal((await api('POST', '/api/crews/join', ben.token, { code: 'ZZZZ-ZZZZ' })).status, 404)
  })

  await test('non-members cannot read a crew', async () => {
    const outsider = (await api('POST', '/api/guests', null, { nickname: 'Eve' })).data
    assert.equal((await api('GET', `/api/crews/${crew.id}`, outsider.token)).status, 404)
  })

  await test('plans are shared within the crew', async () => {
    await api('PUT', '/api/me/plan', lea.token, { acts: ['1-maduk', '1-arcturus', '1-maduk'] })
    await api('PUT', '/api/me/plan', ben.token, { acts: ['1-maduk'] })
    const s = (await api('GET', `/api/crews/${crew.id}`, ben.token)).data
    const l = s.members.find((m) => m.id === lea.id)
    assert.deepEqual(l.plan.sort(), ['1-arcturus', '1-maduk'])
  })

  await test('location is hidden unless shared', async () => {
    await api('PUT', `/api/crews/${crew.id}/location`, lea.token, { share: false, location: 'generator' })
    let s = (await api('GET', `/api/crews/${crew.id}`, ben.token)).data
    assert.equal(s.members.find((m) => m.id === lea.id).location, null)
    await api('PUT', `/api/crews/${crew.id}/location`, lea.token, { share: true, location: 'generator' })
    s = (await api('GET', `/api/crews/${crew.id}`, ben.token)).data
    assert.equal(s.members.find((m) => m.id === lea.id).location, 'generator')
    assert.equal((await api('PUT', `/api/crews/${crew.id}/location`, lea.token, { share: true, location: 'mars' })).status, 400)
  })

  await test('chat messages and incremental polling', async () => {
    const m1 = await api('POST', `/api/crews/${crew.id}/messages`, lea.token, { text: 'Wer kommt zu Maduk?' })
    assert.equal(m1.status, 201)
    await new Promise((r) => setTimeout(r, 5))
    await api('POST', `/api/crews/${crew.id}/messages`, ben.token, { text: 'Ich!' })
    const all = (await api('GET', `/api/crews/${crew.id}`, lea.token)).data.messages
    assert.equal(all.length, 2)
    const fresh = (await api('GET', `/api/crews/${crew.id}?since=${m1.data.at}`, lea.token)).data.messages
    assert.deepEqual(
      fresh.map((m) => m.text),
      ['Ich!'],
    )
  })

  await test('client ids make retries idempotent', async () => {
    const id = 'm_retry0000001'
    const a = await api('POST', `/api/crews/${crew.id}/messages`, ben.token, { id, text: 'Doppelt?' })
    const b = await api('POST', `/api/crews/${crew.id}/messages`, ben.token, { id, text: 'Doppelt?' })
    assert.equal(a.status, 201)
    assert.equal(b.status, 200)
    const msgs = (await api('GET', `/api/crews/${crew.id}`, lea.token)).data.messages.filter((m) => m.id === id)
    assert.equal(msgs.length, 1)
    assert.equal((await api('POST', `/api/crews/${crew.id}/messages`, lea.token, { id, text: 'Kapern' })).status, 409)
    assert.equal((await api('POST', `/api/crews/${crew.id}/messages`, lea.token, { id: 'x', text: 'kaputt' })).status, 400)
    const mt = { id: 'mt_retry000001', place: 'Bar', day: 1, min: 1200 }
    assert.equal((await api('POST', `/api/crews/${crew.id}/meetups`, lea.token, mt)).status, 201)
    assert.equal((await api('POST', `/api/crews/${crew.id}/meetups`, lea.token, mt)).status, 200)
    await api('DELETE', `/api/meetups/${mt.id}`, lea.token)
  })

  await test('meetups with RSVPs; only the creator can cancel', async () => {
    const m = await api('POST', `/api/crews/${crew.id}/meetups`, lea.token, { place: 'Archive Entrance', poi: 'stage-archive', actId: '1-maduk', day: 1, min: 1210, note: 'Zusammen rüber' })
    assert.equal(m.status, 201)
    assert.deepEqual(m.data.going, [lea.id])
    await api('PUT', `/api/meetups/${m.data.id}/rsvp`, ben.token, { going: true })
    let s = (await api('GET', `/api/crews/${crew.id}`, lea.token)).data
    assert.deepEqual(s.meetups[0].going.sort(), [lea.id, ben.id].sort())
    await api('PUT', `/api/meetups/${m.data.id}/rsvp`, ben.token, { going: false })
    s = (await api('GET', `/api/crews/${crew.id}`, lea.token)).data
    assert.deepEqual(s.meetups[0].declined, [ben.id])
    assert.equal((await api('DELETE', `/api/meetups/${m.data.id}`, ben.token)).status, 403)
    assert.equal((await api('DELETE', `/api/meetups/${m.data.id}`, lea.token)).status, 204)
  })

  await test('steps: daily totals only, deletable', async () => {
    await api('PUT', '/api/me/steps', ben.token, { day: 1, total: 12840 })
    let s = (await api('GET', `/api/crews/${crew.id}`, lea.token)).data
    assert.equal(s.members.find((m) => m.id === ben.id).steps[0].total, 12840)
    assert.equal((await api('PUT', '/api/me/steps', ben.token, { day: 1, total: -5 })).status, 400)
    await api('DELETE', '/api/me/steps', ben.token)
    s = (await api('GET', `/api/crews/${crew.id}`, lea.token)).data
    assert.deepEqual(s.members.find((m) => m.id === ben.id).steps, [])
  })

  await test('reports: confirm, extend and retire', async () => {
    const r = await api('POST', '/api/reports', lea.token, { title: 'Wasser leer: Lagoon', place: 'Lagoon', poi: 'w2' })
    assert.equal(r.status, 201)
    assert.equal(r.data.validMin, 60)
    const v = await api('PUT', `/api/reports/${r.data.id}/vote`, ben.token, { kind: 'still' })
    assert.equal(v.status, 200)
    let list = (await api('GET', '/api/reports', ben.token)).data
    const mine = list.find((x) => x.id === r.data.id)
    assert.equal(mine.confirms, 2)
    assert.equal(mine.myVote, 'still')
    // one "fixed" from someone else is not enough …
    await api('PUT', `/api/reports/${r.data.id}/vote`, ben.token, { kind: 'fixed' })
    list = (await api('GET', '/api/reports', ben.token)).data
    assert.ok(list.some((x) => x.id === r.data.id))
    // … but the reporter can retire it
    await api('PUT', `/api/reports/${r.data.id}/vote`, lea.token, { kind: 'fixed' })
    list = (await api('GET', '/api/reports', ben.token)).data
    assert.ok(!list.some((x) => x.id === r.data.id))
  })

  await test('reports are rate limited', async () => {
    let last
    for (let i = 0; i < 6; i++) last = await api('POST', '/api/reports', ben.token, { title: 'Spam ' + i })
    assert.equal(last.status, 429)
  })

  await test('recovery code restores the profile and rotates the token', async () => {
    const { code } = (await api('POST', '/api/me/recovery', lea.token)).data
    assert.match(code, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/)
    const r = await api('POST', '/api/restore', null, { code: code.toLowerCase() })
    assert.equal(r.data.id, lea.id)
    assert.equal((await api('GET', '/api/me', lea.token)).status, 401)
    lea.token = r.data.token
    const me = (await api('GET', '/api/me', lea.token)).data
    assert.equal(me.secured, true)
    assert.equal(me.crews[0].id, crew.id)
  })

  await test('deleting the profile removes the guest and their data', async () => {
    assert.equal((await api('DELETE', '/api/me', ben.token)).status, 204)
    assert.equal((await api('GET', '/api/me', ben.token)).status, 401)
    const s = (await api('GET', `/api/crews/${crew.id}`, lea.token)).data
    assert.equal(s.members.length, 1)
    assert.ok(!s.messages.some((m) => m.from === ben.id))
  })

  await test('announcements: admin-only writes, public reads, expiry', async () => {
    const draft = { title: 'Gewitterwarnung ab 22:30', body: 'Open-Air-Bühnen pausieren kurz.', place: 'Gelände', severity: 'warning', validMin: 180 }
    assert.equal((await api('POST', '/api/admin/announcements', null, draft)).status, 401)
    assert.equal((await api('POST', '/api/admin/announcements', lea.token, draft)).status, 401)
    assert.equal((await api('POST', '/api/admin/announcements', 'test-admin-token', { ...draft, severity: 'panic' })).status, 400)
    const a = await api('POST', '/api/admin/announcements', 'test-admin-token', draft)
    assert.equal(a.status, 201)
    assert.equal(a.data.validMin, 180)
    const pub = await api('GET', '/api/announcements')
    assert.equal(pub.status, 200)
    assert.ok(pub.data.some((x) => x.id === a.data.id && x.severity === 'warning'))
    const p = await api('PATCH', `/api/admin/announcements/${a.data.id}`, 'test-admin-token', { severity: 'critical', validMin: null })
    assert.equal(p.data.severity, 'critical')
    assert.equal(p.data.validMin, null)
    assert.equal(p.data.title, draft.title)
    assert.equal((await api('DELETE', `/api/admin/announcements/${a.data.id}`, 'test-admin-token')).status, 204)
    assert.ok(!(await api('GET', '/api/announcements')).data.some((x) => x.id === a.data.id))
    assert.equal((await api('DELETE', `/api/admin/announcements/${a.data.id}`, 'test-admin-token')).status, 404)
  })

  await test('CORS preflight is answered', async () => {
    const r = await fetch(BASE + '/api/me', { method: 'OPTIONS', headers: { Origin: 'https://realm.app', 'Access-Control-Request-Method': 'GET' } })
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://realm.app')
  })

  console.log(`\n${passed} API tests passed`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  try {
    process.kill(-server.pid)
  } catch {}
}
