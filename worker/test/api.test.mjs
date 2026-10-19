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
// a draft and an archived festival to test visibility and write protection
await run([
  'd1', 'execute', 'realm', '--local', '--persist-to', persist, '--command',
  "INSERT INTO festivals (id, slug, name, status, created_at, updated_at) VALUES ('fdraft', 'geheim', 'Geheimfestival', 'draft', 0, 0), ('farch', 'vorbei', 'Vorbei Fest', 'archived', 0, 0)",
])
const server = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(PORT), '--persist-to', persist, '--var', 'ADMIN_TOKEN:test-admin-token'], { stdio: 'ignore', detached: true })

for (let i = 0; ; i++) {
  try {
    if ((await fetch(BASE + '/api/health')).ok) break
  } catch {}
  if (i > 150) throw new Error('worker did not start')
  await new Promise((r) => setTimeout(r, 200))
}

async function api(method, path, token, body, festival = 'realm-open-air') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(festival ? { 'X-Festival': festival } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
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

  await test('moderation: delete own, flag others, owner deletes and removes', async () => {
    const eve = (await api('POST', '/api/guests', null, { nickname: 'Eve' })).data
    await api('POST', '/api/crews/join', eve.token, { code: crew.code })
    const spam = (await api('POST', `/api/crews/${crew.id}/messages`, eve.token, { text: 'Spam!' })).data
    const own = (await api('POST', `/api/crews/${crew.id}/messages`, ben.token, { text: 'Tippfehler' })).data
    const since = own.at - 1

    // authors delete their own messages, not others'
    assert.equal((await api('DELETE', `/api/crews/${crew.id}/messages/${spam.id}`, ben.token)).status, 403)
    assert.equal((await api('DELETE', `/api/crews/${crew.id}/messages/${own.id}`, ben.token)).status, 204)
    assert.equal((await api('DELETE', `/api/crews/${crew.id}/messages/${own.id}`, ben.token)).status, 404)

    // flags: not your own, idempotent per person, hidden at two
    assert.equal((await api('POST', `/api/crews/${crew.id}/messages/${spam.id}/flag`, eve.token)).status, 400)
    assert.equal((await api('POST', `/api/crews/${crew.id}/messages/${spam.id}/flag`, ben.token)).data.hidden, false)
    assert.equal((await api('POST', `/api/crews/${crew.id}/messages/${spam.id}/flag`, ben.token)).data.flags, 1)
    assert.equal((await api('POST', `/api/crews/${crew.id}/messages/${spam.id}/flag`, lea.token)).data.hidden, true)

    // incremental polls carry the deletion and the hide
    const inc = (await api('GET', `/api/crews/${crew.id}?since=${since}`, lea.token)).data.messages
    const d = inc.find((m) => m.id === own.id)
    assert.equal(d.deleted, true)
    assert.equal(d.text, null)
    const h = inc.find((m) => m.id === spam.id)
    assert.equal(h.hidden, true)
    assert.equal(h.text, null)
    assert.equal(h.flaggedByMe, true)
    // the author still sees their hidden text
    assert.equal((await api('GET', `/api/crews/${crew.id}`, eve.token)).data.messages.find((m) => m.id === spam.id).text, 'Spam!')

    // only the owner removes members; removed members cannot rejoin or read
    const state = (await api('GET', `/api/crews/${crew.id}`, lea.token)).data
    assert.equal(state.owner, lea.id)
    assert.equal((await api('DELETE', `/api/crews/${crew.id}/members/${eve.id}`, ben.token)).status, 403)
    assert.equal((await api('DELETE', `/api/crews/${crew.id}/members/${lea.id}`, lea.token)).status, 400)
    assert.equal((await api('DELETE', `/api/crews/${crew.id}/members/${eve.id}`, lea.token)).status, 204)
    assert.equal((await api('GET', `/api/crews/${crew.id}`, eve.token)).status, 404)
    assert.equal((await api('POST', '/api/crews/join', eve.token, { code: crew.code })).status, 403)
    // owner deletes someone else's message
    const m2 = (await api('POST', `/api/crews/${crew.id}/messages`, ben.token, { text: 'Bitte löschen' })).data
    assert.equal((await api('DELETE', `/api/crews/${crew.id}/messages/${m2.id}`, lea.token)).status, 204)
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
    assert.equal((await api('GET', '/api/admin/session', 'wrong')).status, 401)
    assert.equal((await api('GET', '/api/admin/session', 'test-admin-token')).status, 200)
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

  await test('timetable changes: admin-only, validated, public, revertible', async () => {
    const A = 'test-admin-token'
    assert.equal((await api('PUT', '/api/admin/timetable/1-arcturus', lea.token, { start: 1350, end: 1440 })).status, 401)
    assert.equal((await api('PUT', '/api/admin/timetable/1-arcturus', A, { start: 1350 })).status, 400)
    assert.equal((await api('PUT', '/api/admin/timetable/1-arcturus', A, { start: 1440, end: 1350 })).status, 400)
    assert.equal((await api('PUT', '/api/admin/timetable/1-arcturus', A, { stage: 'mars' })).status, 400)
    assert.equal((await api('PUT', '/api/admin/timetable/1-arcturus', A, {})).status, 400)
    assert.equal((await api('PUT', '/api/admin/timetable/..%2Fetc', A, { cancelled: true })).status, 400)
    const d = await api('PUT', '/api/admin/timetable/1-arcturus', A, { start: 1350, end: 1440, note: 'Technik' })
    assert.equal(d.status, 200)
    await api('PUT', '/api/admin/timetable/2-kairo', A, { cancelled: true })
    let list = (await api('GET', '/api/timetable/changes')).data
    assert.deepEqual(
      list.map((x) => x.actId).sort(),
      ['1-arcturus', '2-kairo'],
    )
    assert.equal(list.find((x) => x.actId === '2-kairo').cancelled, true)
    // upsert replaces the previous change
    await api('PUT', '/api/admin/timetable/1-arcturus', A, { stage: 'archive' })
    list = (await api('GET', '/api/timetable/changes')).data
    const a = list.find((x) => x.actId === '1-arcturus')
    assert.equal(a.start, null)
    assert.equal(a.stage, 'archive')
    assert.equal((await api('DELETE', '/api/admin/timetable/2-kairo', A)).status, 204)
    assert.equal((await api('DELETE', '/api/admin/timetable/2-kairo', A)).status, 404)
  })

  await test('festivals: public list and bundle, drafts hidden, header required', async () => {
    const list = (await api('GET', '/api/festivals', null, undefined, null)).data
    assert.deepEqual(
      list.map((f) => f.slug).sort(),
      ['nordlicht', 'realm-open-air'],
    )
    const b = (await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data
    assert.equal(b.festival.name, 'Nordlicht Sessions')
    assert.deepEqual(
      b.stages.map((s) => s.id),
      ['pier', 'werft'],
    )
    assert.equal(b.acts.length, 5)
    assert.equal((await api('GET', '/api/festivals/gibts-nicht', null, undefined, null)).status, 404)
    // tenant routes refuse requests without or with an unknown festival
    assert.equal((await api('GET', '/api/announcements', null, undefined, null)).status, 400)
    assert.equal((await api('GET', '/api/announcements', null, undefined, 'gibts-nicht')).status, 404)
  })

  await test('tenant isolation: data of one festival is invisible and unreachable from another', async () => {
    const A = 'test-admin-token'
    const N = 'nordlicht'
    const nina = (await api('POST', '/api/guests', null, { nickname: 'Nina' })).data
    // crews: a realm crew cannot be read, joined or written to from nordlicht – even with the right id/code
    assert.equal((await api('GET', `/api/crews/${crew.id}`, lea.token, undefined, N)).status, 404)
    assert.equal((await api('POST', `/api/crews/${crew.id}/messages`, lea.token, { text: 'falsches Festival' }, N)).status, 404)
    assert.equal((await api('POST', '/api/crews/join', nina.token, { code: crew.code }, N)).status, 404)
    // plans are stored per festival; the colliding id "1-maduk" exists in both, unknown ids are rejected
    const p = (await api('PUT', '/api/me/plan', nina.token, { acts: ['1-maduk', '0-orra', '0-tidewater'] }, N)).data
    assert.deepEqual(p.acts.sort(), ['0-tidewater', '1-maduk'])
    assert.deepEqual(p.rejected, ['0-orra'])
    assert.deepEqual((await api('GET', '/api/me', nina.token, undefined, 'realm-open-air')).data.plan, [])
    assert.deepEqual((await api('GET', '/api/me', nina.token, undefined, N)).data.plan.sort(), ['0-tidewater', '1-maduk'])
    // announcements and timetable changes stay in their festival
    const ann = (await api('POST', '/api/admin/announcements', A, { title: 'Nur Nordlicht' }, N)).data
    assert.ok(!(await api('GET', '/api/announcements')).data.some((x) => x.id === ann.id))
    assert.ok((await api('GET', '/api/announcements', null, undefined, N)).data.some((x) => x.id === ann.id))
    assert.equal((await api('DELETE', `/api/admin/announcements/${ann.id}`, A)).status, 404)
    assert.equal((await api('PUT', '/api/admin/timetable/0-orra', A, { cancelled: true }, N)).status, 404)
    assert.equal((await api('PUT', '/api/admin/timetable/1-maduk', A, { stage: 'generator' }, N)).status, 400)
    assert.equal((await api('PUT', '/api/admin/timetable/1-maduk', A, { stage: 'pier' }, N)).status, 200)
    assert.ok(!(await api('GET', '/api/timetable/changes')).data.some((x) => x.actId === '1-maduk' && x.stage === 'pier'))
    // reports and votes
    const r = (await api('POST', '/api/reports', nina.token, { title: 'Kai gesperrt' }, N)).data
    assert.ok(!(await api('GET', '/api/reports', lea.token)).data.some((x) => x.id === r.id))
    assert.equal((await api('PUT', `/api/reports/${r.id}/vote`, lea.token, { kind: 'fixed' })).status, 404)
    // locations are validated against this festival's stages
    const nc = (await api('POST', '/api/crews', nina.token, { name: 'Hafen' }, N)).data
    assert.equal((await api('PUT', `/api/crews/${nc.id}/location`, nina.token, { share: true, location: 'generator' }, N)).status, 400)
    assert.equal((await api('PUT', `/api/crews/${nc.id}/location`, nina.token, { share: true, location: 'pier' }, N)).status, 200)
    // meetups only for acts of this festival
    assert.equal((await api('POST', `/api/crews/${nc.id}/meetups`, nina.token, { place: 'Kai', day: 0, min: 1100, actId: '0-orra' }, N)).status, 400)
  })

  await test('drafts are admin-only; archived festivals are read-only', async () => {
    assert.ok(!(await api('GET', '/api/festivals', null, undefined, null)).data.some((f) => f.slug === 'geheim'))
    assert.equal((await api('GET', '/api/festivals/geheim', null, undefined, null)).status, 404)
    assert.equal((await api('GET', '/api/festivals/geheim', 'test-admin-token', undefined, null)).status, 200)
    assert.equal((await api('GET', '/api/announcements', null, undefined, 'geheim')).status, 404)
    assert.equal((await api('POST', '/api/admin/announcements', 'test-admin-token', { title: 'Vorschau-Test' }, 'geheim')).status, 201)
    // archived: reading works, writing is refused for visitors but allowed for admins
    assert.equal((await api('GET', '/api/festivals/vorbei', null, undefined, null)).status, 200)
    assert.equal((await api('GET', '/api/announcements', null, undefined, 'vorbei')).status, 200)
    assert.equal((await api('POST', '/api/crews', lea.token, { name: 'Zu spät' }, 'vorbei')).status, 403)
    assert.equal((await api('PUT', '/api/me/plan', lea.token, { acts: [] }, 'vorbei')).status, 403)
    assert.equal((await api('POST', '/api/admin/announcements', 'test-admin-token', { title: 'Danke fürs Kommen' }, 'vorbei')).status, 201)
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
