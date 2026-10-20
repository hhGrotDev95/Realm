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

/** join by code and have the crew owner approve the request (new crews ask before anyone joins) */
async function joinApproved(owner, joiner, crew, festival) {
  const j = await api('POST', '/api/crews/join', joiner.token, { code: crew.code }, festival)
  if (j.data?.pending) await api('POST', `/api/crews/${crew.id}/members/${joiner.id}/approve`, owner.token, undefined, festival)
  return j
}

/** guests for the later tests come from their own address, so the per-IP signup limit does not get in the way */
let ipN = 0
async function newGuest(nickname) {
  const res = await fetch(BASE + '/api/guests', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${++ipN}` }, body: JSON.stringify({ nickname }) })
  return res.json()
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
    // new crews ask the owner first; until then the joiner sees nothing but the name
    assert.equal(j.data.pending, true)
    assert.equal(j.data.code, '')
    assert.deepEqual((await api('GET', `/api/crews/${crew.id}`, ben.token)).data, { pending: true, crew: { id: crew.id, name: 'Zeltplatz 14', code: '' } })
    assert.equal((await api('POST', `/api/crews/${crew.id}/messages`, ben.token, { text: 'Hallo?' })).status, 403)
    assert.equal((await api('POST', `/api/crews/${crew.id}/members/${ben.id}/approve`, ben.token)).status, 403)
    assert.equal((await api('POST', `/api/crews/${crew.id}/members/${ben.id}/approve`, lea.token)).status, 204)
    assert.equal((await api('GET', `/api/crews/${crew.id}`, ben.token)).data.crew.code, crew.code)
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
    await joinApproved(lea, eve, crew)
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
    const removed = await api('DELETE', `/api/crews/${crew.id}/members/${eve.id}`, lea.token)
    assert.equal(removed.status, 200)
    assert.equal((await api('GET', `/api/crews/${crew.id}`, eve.token)).status, 404)
    assert.equal((await api('POST', '/api/crews/join', eve.token, { code: removed.data.code })).status, 403)
    crew.code = removed.data.code
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
    // the reporter's own "still" does not count again (audit F06)
    assert.equal((await api('PUT', `/api/reports/${r.data.id}/vote`, lea.token, { kind: 'still' })).status, 400)
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

  await test('festival setup: create draft, stages, import (dry run, errors, merge, replace, restore), publish', async () => {
    const A = 'test-admin-token'
    assert.equal((await api('POST', '/api/admin/festivals', lea.token, { name: 'Sommerwiese', startDate: '2027-06-04', days: 2 }, null)).status, 401)
    assert.equal((await api('POST', '/api/admin/festivals', A, { name: 'Sommerwiese', startDate: '4.6.2027', days: 2 }, null)).status, 400)
    const f = await api('POST', '/api/admin/festivals', A, { name: 'Sommerwiese Open Air', startDate: '2027-06-04', days: 2, location: 'Kiel' }, null)
    assert.equal(f.status, 201)
    assert.equal(f.data.slug, 'sommerwiese-open-air')
    assert.equal(f.data.status, 'draft')
    assert.equal((await api('POST', '/api/admin/festivals', A, { name: 'Sommerwiese Open Air', startDate: '2027-06-04', days: 2 }, null)).status, 409)
    const slug = f.data.slug
    let b = (await api('GET', `/api/festivals/${slug}`, A, undefined, null)).data
    assert.deepEqual(
      b.days.map((d) => [d.date, d.label]),
      [
        ['2027-06-04', 'Freitag'],
        ['2027-06-05', 'Samstag'],
      ],
    )
    // publishing an empty festival is refused
    assert.equal((await api('PATCH', `/api/admin/festivals/${slug}`, A, { status: 'published' }, null)).status, 400)
    assert.equal((await api('PUT', `/api/admin/festivals/${slug}/stages`, A, { stages: [{ name: 'Wiese' }, { name: 'Zelt', color: '#123456' }] }, null)).status, 200)

    const rows = [
      { row: 2, artist: 'Morgentau', stage: 'Wiese', day: 0, start: 1200, end: 1260 },
      { row: 3, artist: 'Nachtfalter', stage: 'Zelt', day: 0, start: 1440, end: 1530, genre: 'Techno' },
      { row: 4, artist: 'Morgentau', stage: 'Wiese', day: 0, start: 1200, end: 1260 },
      { row: 5, artist: 'Überlapp', stage: 'Wiese', day: 0, start: 1230, end: 1290 },
      { row: 6, artist: 'Neue Bühne', stage: 'Strand', day: 1, start: 1100, end: 1160 },
    ]
    const dry = (await api('POST', `/api/admin/festivals/${slug}/import`, A, { mode: 'merge', dryRun: true, rows }, null)).data
    assert.equal(dry.written, false)
    assert.deepEqual(dry.summary, { rows: 5, created: 4, updated: 0, unchanged: 0, removed: 0, stagesCreated: 1 })
    assert.deepEqual(
      dry.warnings.map((w) => w.row),
      [4, 5, 6],
    )
    assert.match(dry.warnings[0].message, /Doppelt \(wie Zeile 2\)/)
    assert.equal((await api('GET', `/api/festivals/${slug}`, A, undefined, null)).data.acts.length, 0)

    // errors block the whole import and carry row numbers
    const bad = await api('POST', `/api/admin/festivals/${slug}/import`, A, { mode: 'merge', rows: [...rows, { row: 7, artist: 'Falsch', stage: 'Wiese', day: 5, start: 1200, end: 1260 }, { row: 8, artist: 'Rückwärts', stage: 'Wiese', day: 0, start: 1300, end: 1200 }] }, null)
    assert.equal(bad.status, 422)
    assert.deepEqual(
      bad.data.errors.map((e) => e.row),
      [7, 8],
    )
    assert.equal((await api('GET', `/api/festivals/${slug}`, A, undefined, null)).data.acts.length, 0)

    const ok = (await api('POST', `/api/admin/festivals/${slug}/import`, A, { mode: 'merge', rows }, null)).data
    assert.equal(ok.written, true)
    b = (await api('GET', `/api/festivals/${slug}`, A, undefined, null)).data
    assert.deepEqual(
      b.acts.map((a) => a.id).sort(),
      ['0-morgentau', '0-nachtfalter', '0-ueberlapp', '1-neue-buehne'],
    )
    assert.ok(b.stages.some((st) => st.id === 'strand'))

    // a visitor favourites an act; re-importing with a new time keeps the id (and the favourite)
    await api('PATCH', '/api/admin/festivals/' + slug, A, { status: 'published' }, null)
    const fan = (await api('POST', '/api/guests', null, { nickname: 'Fan' })).data
    assert.deepEqual((await api('PUT', '/api/me/plan', fan.token, { acts: ['0-nachtfalter'] }, slug)).data.acts, ['0-nachtfalter'])
    const re = (await api('POST', `/api/admin/festivals/${slug}/import`, A, { mode: 'merge', rows: [{ row: 2, artist: 'Nachtfalter', stage: 'Zelt', day: 0, start: 1470, end: 1560, genre: 'Techno' }] }, null)).data
    assert.deepEqual(re.summary, { rows: 1, created: 0, updated: 1, unchanged: 0, removed: 0, stagesCreated: 0 })
    assert.deepEqual((await api('GET', '/api/me', fan.token, undefined, slug)).data.plan, ['0-nachtfalter'])

    // replace removes acts missing from the file – after a snapshot that can be restored
    const rep = (await api('POST', `/api/admin/festivals/${slug}/import`, A, { mode: 'replace', rows: [{ row: 2, artist: 'Nachtfalter', stage: 'Zelt', day: 0, start: 1470, end: 1560, genre: 'Techno' }] }, null)).data
    assert.equal(rep.summary.removed, 3)
    assert.ok(rep.snapshotId)
    assert.equal((await api('GET', `/api/festivals/${slug}`, null, undefined, null)).data.acts.length, 1)
    const snaps = (await api('GET', `/api/admin/festivals/${slug}/snapshots`, A, undefined, null)).data
    assert.equal(snaps[0].id, rep.snapshotId)
    assert.equal((await api('POST', `/api/admin/festivals/${slug}/snapshots/${rep.snapshotId}/restore`, A, undefined, null)).data.restored, 4)
    assert.equal((await api('GET', `/api/festivals/${slug}`, null, undefined, null)).data.acts.length, 4)
    // stages that still have acts cannot be removed
    assert.equal((await api('PUT', `/api/admin/festivals/${slug}/stages`, A, { stages: [{ name: 'Wiese' }] }, null)).status, 409)
    // archive and reactivate
    assert.equal((await api('PATCH', `/api/admin/festivals/${slug}`, A, { status: 'archived' }, null)).data.status, 'archived')
    assert.equal((await api('PUT', '/api/me/plan', fan.token, { acts: [] }, slug)).status, 403)
    assert.equal((await api('PATCH', `/api/admin/festivals/${slug}`, A, { status: 'published' }, null)).data.status, 'published')
  })

  await test('branding: validated colour (WCAG), font and logo; published in the festival document', async () => {
    const A = 'test-admin-token'
    const put = (body) => api('PUT', '/api/admin/festivals/nordlicht/theme', A, body, null)
    assert.equal((await api('PUT', '/api/admin/festivals/nordlicht/theme', lea.token, { brand: '#4fd1c5' }, null)).status, 401)
    assert.equal((await put({ brand: 'teal' })).status, 400)
    const dark = await put({ brand: '#1a1a6e' }) // dark blue: unreadable on the dark app background
    assert.equal(dark.status, 400)
    assert.match(dark.data.error, /Kontrast zu gering/)
    assert.equal((await put({ font: 'comic-sans' })).status, 400)
    assert.equal((await put({ logo: 'https://example.com/logo.png' })).status, 400)
    assert.equal((await put({ logo: 'data:image/png;base64,' + 'A'.repeat(200_001) })).status, 400)
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const ok = await put({ brand: '#4FD1C5', font: 'space', logo: png })
    assert.equal(ok.status, 200)
    const t = (await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data.festival.theme
    assert.deepEqual(t, { brand: '#4fd1c5', font: 'space', logo: png })
  })

  await test('map editor: site plan, stage positions and pins; stage pins derive from stages', async () => {
    const A = 'test-admin-token'
    const put = (body) => api('PUT', '/api/admin/festivals/nordlicht/map', A, body, null)
    const doc = () => api('GET', '/api/festivals/nordlicht', null, undefined, null).then((r) => r.data)
    assert.equal((await api('PUT', '/api/admin/festivals/nordlicht/map', lea.token, { pois: [] }, null)).status, 401)
    const before = await doc()
    assert.equal(before.festival.siteMap, null)
    assert.equal(before.pois.filter((p) => p.cat === 'stage').length, before.stages.length)
    assert.equal((await put({ pois: [{ id: 'x', cat: 'stage', name: 'Fake', x: 1, y: 1 }] })).status, 400)
    assert.equal((await put({ pois: [{ id: 'x', cat: 'water', name: 'W', x: 1001, y: 1 }] })).status, 400)
    assert.equal((await put({ pois: [{ id: 'stage-pier', cat: 'water', name: 'W', x: 1, y: 1 }] })).status, 400)
    assert.equal((await put({ stages: [{ id: 'nope', x: 1, y: 1 }] })).status, 400)
    assert.equal((await put({ siteMap: 'data:image/svg+xml;base64,AAAA' })).status, 400)
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const pois = [
      { id: 'w1', cat: 'water', name: 'Wasser Hafen', detail: 'kostenlos', status: 'open', important: true, x: 100.4, y: 200 },
      { id: 'in1', cat: 'info', name: 'Info', x: 500, y: 900 },
    ]
    const ok = await put({ siteMap: png, stages: [{ id: 'pier', x: 120, y: 130 }], pois })
    assert.equal(ok.status, 200)
    const after = await doc()
    assert.equal(after.festival.siteMap, png)
    assert.deepEqual(after.stages.find((s) => s.id === 'pier'), { ...before.stages.find((s) => s.id === 'pier'), x: 120, y: 130 })
    assert.deepEqual(after.pois.find((p) => p.id === 'stage-pier'), { id: 'stage-pier', cat: 'stage', name: 'Pier', x: 120, y: 130, detail: 'Electronic · Waterfront', important: true })
    assert.deepEqual(after.pois.filter((p) => p.cat !== 'stage'), [
      { id: 'w1', cat: 'water', name: 'Wasser Hafen', x: 100, y: 200, detail: 'kostenlos', status: 'open', important: true },
      { id: 'in1', cat: 'info', name: 'Info', x: 500, y: 900, detail: '', important: false },
    ])
    // omitted fields stay as they are; null removes the plan
    assert.equal((await put({ siteMap: null })).status, 200)
    const cleared = await doc()
    assert.equal(cleared.festival.siteMap, null)
    assert.equal(cleared.pois.length, after.pois.length)
  })

  await test('analytics: plan interest, community counts and FAQ-bot gaps – aggregated, small groups withheld', async () => {
    const A = 'test-admin-token'
    const N = 'nordlicht'
    const stats = () => api('GET', '/api/admin/festivals/nordlicht/analytics', A, undefined, null).then((r) => r.data)
    assert.equal((await api('GET', '/api/admin/festivals/nordlicht/analytics', lea.token, undefined, null)).status, 401)
    const before = await stats()
    // three visitors plan the same act, one plans another: only the first is reported
    const fans = []
    for (const name of ['Ana', 'Ben', 'Cem']) fans.push((await api('POST', '/api/guests', null, { nickname: name })).data)
    for (const g of fans) assert.equal((await api('PUT', '/api/me/plan', g.token, { acts: ['1-north-signal'] }, N)).status, 200)
    await api('PUT', '/api/me/plan', fans[0].token, { acts: ['1-north-signal', '0-tidewater'] }, N)
    const s = await stats()
    assert.equal(s.minGroup, 3)
    assert.deepEqual(s.acts.find((a) => a.id === '1-north-signal'), { id: '1-north-signal', plans: 3 })
    assert.equal(s.acts.find((a) => a.id === '0-tidewater'), undefined, 'a single planner must not be visible')
    assert.ok(s.withheldActs >= 1)
    assert.ok(s.profiles >= 3 && s.profiles >= before.profiles)
    // FAQ bot: anonymous events, no session; misses only show once several people asked the same
    const ev = (body) => api('POST', '/api/faq/events', null, body, N)
    assert.equal((await ev({ kind: 'miss', question: 'x' })).status, 400)
    assert.equal((await ev({ kind: 'hit', faqId: 'does-not-exist' })).status, 404)
    for (const q of ['Gibt es Duschen?', 'gibt es  duschen', 'GIBT ES DUSCHEN?!']) assert.equal((await ev({ kind: 'miss', question: q })).status, 204)
    assert.equal((await ev({ kind: 'miss', question: 'Wo finde ich Max Mustermann?' })).status, 204)
    const f = await stats()
    assert.deepEqual(f.faq.misses.map((m) => [m.question, m.n]), [['gibt es duschen', 3]])
    assert.equal((await api('DELETE', '/api/admin/festivals/nordlicht/analytics/faq-misses', A, { question: 'Gibt es Duschen?' }, null)).status, 204)
    assert.deepEqual((await stats()).faq.misses, [])
    // the module switch also covers the bot statistics
    await api('PUT', '/api/admin/festivals/nordlicht/modules', A, { faqbot: false }, null)
    assert.equal((await ev({ kind: 'miss', question: 'Gibt es Duschen?' })).status, 403)
    await api('PUT', '/api/admin/festivals/nordlicht/modules', A, { faqbot: true }, null)
  })

  await test('festival chat: opt-in module, three flags hide, organizer deletes or restores', async () => {
    const A = 'test-admin-token'
    const N = 'nordlicht'
    const say = (g, text) => api('POST', '/api/festival-chat', g.token, { text }, N)
    const read = (g, since) => api('GET', '/api/festival-chat' + (since ? '?since=' + since : ''), g.token, undefined, N).then((r) => r.data)
    const people = []
    for (const name of ['Ola', 'Pia', 'Quinn', 'Rex']) people.push((await api('POST', '/api/guests', null, { nickname: name })).data)
    const [ola, pia, quinn, rex] = people
    // off until the organizer switches it on
    assert.equal((await say(ola, 'Hallo?')).status, 403)
    assert.equal((await api('PUT', '/api/admin/festivals/nordlicht/modules', A, { festivalchat: true }, null)).status, 200)
    assert.equal((await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data.festival.modules.festivalchat, true)
    const nameless = (await api('POST', '/api/guests', null, {})).data
    assert.equal((await say(nameless, 'anon')).status, 403, 'a name is required to write')
    assert.equal((await say(ola, 'x'.repeat(301))).status, 400)
    const hello = (await say(ola, 'Wer kommt mit zum Pier?')).data
    const spam = (await say(rex, 'Kauft Tickets bei mir!!!')).data
    assert.equal(hello.from, 'me')
    const t0 = (await read(pia)).serverTime
    assert.deepEqual((await read(pia)).messages.map((m) => [m.name, m.text]), [['Ola', 'Wer kommt mit zum Pier?'], ['Rex', 'Kauft Tickets bei mir!!!']])
    // two flags are not enough in public, the third hides it from everyone but the author
    assert.equal((await api('POST', `/api/festival-chat/${spam.id}/flag`, ola.token, undefined, N)).data.hidden, false)
    assert.equal((await api('POST', `/api/festival-chat/${spam.id}/flag`, pia.token, undefined, N)).data.hidden, false)
    assert.equal((await api('POST', `/api/festival-chat/${spam.id}/flag`, quinn.token, undefined, N)).data.hidden, true)
    assert.equal((await api('POST', `/api/festival-chat/${spam.id}/flag`, rex.token, undefined, N)).status, 400, 'no flagging of own messages')
    const changed = (await read(pia, t0)).messages
    assert.deepEqual(changed.map((m) => [m.id, m.text, m.hidden]), [[spam.id, null, true]], 'incremental poll delivers the hide')
    assert.equal((await read(rex)).messages.find((m) => m.id === spam.id).text, 'Kauft Tickets bei mir!!!', 'the author still sees it')
    // organizer: hidden messages first; restore keeps it visible, delete removes the text for all
    const mod = (await api('GET', '/api/admin/festivals/nordlicht/chat', A, undefined, null)).data
    assert.deepEqual([mod[0].id, mod[0].flags, mod[0].hidden], [spam.id, 3, true])
    assert.equal((await api('POST', `/api/admin/festivals/nordlicht/chat/${spam.id}/restore`, A, undefined, null)).status, 204)
    assert.equal((await read(pia)).messages.find((m) => m.id === spam.id).text, 'Kauft Tickets bei mir!!!')
    assert.equal((await api('DELETE', `/api/admin/festivals/nordlicht/chat/${spam.id}`, A, undefined, null)).status, 204)
    const gone = (await read(rex)).messages.find((m) => m.id === spam.id)
    assert.deepEqual([gone.text, gone.deleted], [null, true])
    // authors delete their own, not others'
    assert.equal((await api('DELETE', `/api/festival-chat/${hello.id}`, pia.token, undefined, N)).status, 403)
    assert.equal((await api('DELETE', `/api/festival-chat/${hello.id}`, ola.token, undefined, N)).status, 204)
    // another festival never sees it
    assert.equal((await api('GET', '/api/festival-chat', ola.token, undefined, 'realm-open-air')).status, 403)
    await api('PUT', '/api/admin/festivals/nordlicht/modules', A, {}, null)
    assert.equal((await say(ola, 'noch da?')).status, 403, 'switching it off again closes the chat')
  })

  await test('English content: FAQ and announcements carry an optional English version', async () => {
    const A = 'test-admin-token'
    const put = (id, b) => api('PUT', `/api/admin/festivals/nordlicht/faq/${id}`, A, b, null)
    const de = { question: 'Gibt es Duschen?', answer: 'Ja, am Camping Nord, 2 € pro Dusche.', status: 'published' }
    assert.equal((await put('duschen', { ...de, en: { question: 'Are there showers?' } })).status, 400, 'question without answer')
    const ok = await put('duschen', { ...de, en: { question: 'Are there showers?', answer: 'Yes, at camping north, €2 per shower.', keywords: 'shower wash' } })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.data.en, { question: 'Are there showers?', answer: 'Yes, at camping north, €2 per shower.', keywords: 'shower wash' })
    const doc = (await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data
    assert.equal(doc.faq.find((f) => f.id === 'duschen').en.question, 'Are there showers?')
    // German-only entries stay without `en`; clearing the English version removes it
    await put('duschen', de)
    assert.equal((await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data.faq.find((f) => f.id === 'duschen').en, undefined)
    await api('DELETE', '/api/admin/festivals/nordlicht/faq/duschen', A, undefined, null)
    // announcements
    const a = (await api('POST', '/api/admin/announcements', A, { title: 'Einlass verschoben', titleEn: 'Entry delayed', bodyEn: 'Gates open at 13:00.' }, 'nordlicht')).data
    assert.deepEqual(a.en, { title: 'Entry delayed', body: 'Gates open at 13:00.' })
    const pub = (await api('GET', '/api/announcements', null, undefined, 'nordlicht')).data.find((x) => x.id === a.id)
    assert.deepEqual([pub.title, pub.en.title], ['Einlass verschoben', 'Entry delayed'])
    const patched = (await api('PATCH', `/api/admin/announcements/${a.id}`, A, { titleEn: null }, 'nordlicht')).data
    assert.equal(patched.en, undefined)
    await api('DELETE', `/api/admin/announcements/${a.id}`, A, undefined, 'nordlicht')
  })

  await test('privacy (audit F03): revoking and deleting always works – module off or festival archived; old consent never revives', async () => {
    const A = 'test-admin-token'
    const N = 'nordlicht'
    const mods = (m) => api('PUT', '/api/admin/festivals/nordlicht/modules', A, m, null)
    const owner = (await api('POST', '/api/guests', null, { nickname: 'Owner' })).data
    const mate = (await api('POST', '/api/guests', null, { nickname: 'Mate' })).data
    const c = (await api('POST', '/api/crews', owner.token, { name: 'Privat' }, N)).data
    await joinApproved(owner, mate, c, N)
    const share = (g, on) => api('PUT', `/api/crews/${c.id}/location`, g.token, { share: on, location: on ? 'pier' : null }, N)
    const sharing = async () => (await api('GET', `/api/crews/${c.id}`, owner.token, undefined, N)).data.members.find((m) => m.nickname === 'Mate').sharing
    assert.equal((await share(mate, true)).status, 200)
    assert.equal(await sharing(), true)
    assert.equal((await api('PUT', '/api/me/steps', mate.token, { day: 0, total: 9000 }, N)).status, 200)

    // module off: revoking and deleting still work, sharing anew does not
    assert.equal((await mods({ location: false, steps: false })).status, 200)
    assert.equal((await share(mate, false)).status, 200, 'share:false must work with the module off')
    assert.equal((await share(mate, true)).status, 403)
    assert.equal((await api('DELETE', '/api/me/steps', mate.token, undefined, N)).status, 204, 'deleting steps must work with the module off')
    // switching a module off ends existing consent: share again, switch off, switch on → not sharing
    await mods({})
    await share(mate, true)
    await api('PUT', '/api/me/steps', mate.token, { day: 0, total: 1234 }, N)
    await mods({ location: false, steps: false })
    await mods({})
    assert.equal(await sharing(), false, 'reactivating the module must not revive the old consent')
    const steps = (await api('GET', `/api/crews/${c.id}`, owner.token, undefined, N)).data.members.find((m) => m.nickname === 'Mate').steps
    assert.deepEqual(steps, [], 'step totals are deleted when the module is switched off')

    // archived festival: revoke and leave still work, sharing does not
    await share(mate, true)
    assert.equal((await api('PATCH', '/api/admin/festivals/nordlicht', A, { status: 'archived' }, null)).status, 200)
    assert.equal((await share(mate, true)).status, 403)
    assert.equal((await share(mate, false)).status, 200, 'share:false must work in an archived festival')
    assert.equal((await api('DELETE', '/api/me/steps', mate.token, undefined, N)).status, 204)
    assert.equal((await api('POST', `/api/crews/${c.id}/leave`, mate.token, undefined, N)).status, 204, 'leaving must work in an archived festival')
    assert.equal((await api('PATCH', '/api/admin/festivals/nordlicht', A, { status: 'published' }, null)).status, 200)
  })

  await test('crew safety (audit F05): a removed person cannot get back in with a fresh profile and the old code', async () => {
    const N = 'nordlicht'
    const guest = newGuest
    const [owner, mate, troll] = [await guest('Ole'), await guest('Mia'), await guest('Tom')]
    const c = (await api('POST', '/api/crews', owner.token, { name: 'Sicher' }, N)).data
    await joinApproved(owner, mate, c, N)
    await joinApproved(owner, troll, c, N)
    const removed = await api('DELETE', `/api/crews/${c.id}/members/${troll.id}`, owner.token, undefined, N)
    assert.equal(removed.status, 200)
    assert.notEqual(removed.data.code, c.code, 'removing someone renews the invite code')
    // the same person with a brand-new profile and the old link: not found
    const again = await guest('Tom2')
    assert.equal((await api('POST', '/api/crews/join', again.token, { code: c.code }, N)).status, 404)
    // with approval switched off and the code leaked anyway, the owner can still renew it by hand
    assert.equal((await api('PATCH', `/api/crews/${c.id}`, mate.token, { approveJoins: false }, N)).status, 403)
    assert.equal((await api('PATCH', `/api/crews/${c.id}`, owner.token, { approveJoins: false }, N)).status, 200)
    const direct = await api('POST', '/api/crews/join', again.token, { code: removed.data.code }, N)
    assert.equal(direct.data.pending, false)
    const fresh = (await api('POST', `/api/crews/${c.id}/code`, owner.token, undefined, N)).data.code
    assert.equal((await api('POST', '/api/crews/join', troll.token, { code: removed.data.code }, N)).status, 404)
    // join requests: only the owner sees them, without plan or location; declining bans and renews
    await api('PATCH', `/api/crews/${c.id}`, owner.token, { approveJoins: true }, N)
    const stranger = await guest('Fremd')
    assert.equal((await api('POST', '/api/crews/join', stranger.token, { code: fresh }, N)).data.pending, true)
    const seenBy = async (g) => (await api('GET', `/api/crews/${c.id}`, g.token, undefined, N)).data.members.find((m) => m.id === stranger.id)
    assert.equal(await seenBy(mate), undefined)
    assert.deepEqual(await seenBy(owner), { id: stranger.id, nickname: 'Fremd', color: stranger.color, pending: true, sharing: false, location: null, locationAt: null, plan: [], steps: [] })
    assert.equal((await api('DELETE', `/api/crews/${c.id}/members/${stranger.id}`, owner.token, undefined, N)).status, 200)
    assert.equal((await api('POST', '/api/crews/join', stranger.token, { code: fresh }, N)).status, 404)
  })

  await test('crew safety (audit F09): when the owner leaves or deletes the profile, the longest member takes over', async () => {
    const N = 'nordlicht'
    const guest = newGuest
    const [a, b, d, p] = [await guest('Ann'), await guest('Bo'), await guest('Dan'), await guest('Pia')]
    const c = (await api('POST', '/api/crews', a.token, { name: 'Erbe' }, N)).data
    await joinApproved(a, b, c, N)
    await joinApproved(a, d, c, N)
    await api('POST', '/api/crews/join', p.token, { code: c.code }, N) // still pending: never becomes owner
    assert.equal((await api('POST', `/api/crews/${c.id}/leave`, a.token, undefined, N)).status, 204)
    const s = (await api('GET', `/api/crews/${c.id}`, b.token, undefined, N)).data
    assert.equal(s.owner, b.id)
    // the new owner can moderate; deleting the profile hands over again
    assert.equal((await api('POST', `/api/crews/${c.id}/members/${p.id}/approve`, b.token, undefined, N)).status, 204)
    assert.equal((await api('DELETE', '/api/me', b.token, undefined, N)).status, 204)
    assert.equal((await api('GET', `/api/crews/${c.id}`, d.token, undefined, N)).data.owner, d.id)
    // a pending request alone does not keep a crew alive
    const solo = (await api('POST', '/api/crews', d.token, { name: 'Allein' }, N)).data
    const q = await guest('Quinn')
    await api('POST', '/api/crews/join', q.token, { code: solo.code }, N)
    await api('POST', `/api/crews/${solo.id}/leave`, d.token, undefined, N)
    assert.equal((await api('GET', `/api/crews/${solo.id}`, q.token, undefined, N)).status, 404)
  })

  await test('community reports (audit F06): own votes do not count, others cannot retire a report, only the organizer verifies', async () => {
    const A = 'test-admin-token'
    const N = 'nordlicht'
    const guest = newGuest
    const [rep, x, y] = [await guest('Rita'), await guest('Xa'), await guest('Yo')]
    const r = (await api('POST', '/api/reports', rep.token, { title: 'Sanität überlastet' }, N)).data
    const get = async () => (await api('GET', '/api/reports', x.token, undefined, N)).data.find((z) => z.id === r.id)
    // the old trick: reporter + own vote + one more profile looked "confirmed"
    await api('PUT', `/api/reports/${r.id}/vote`, rep.token, { kind: 'still' }, N)
    await api('PUT', `/api/reports/${r.id}/vote`, x.token, { kind: 'still' }, N)
    assert.deepEqual([(await get()).confirms, (await get()).source], [2, 'unconfirmed'])
    // two other profiles saying "fixed" no longer end someone else's report
    await api('PUT', `/api/reports/${r.id}/vote`, x.token, { kind: 'fixed' }, N)
    await api('PUT', `/api/reports/${r.id}/vote`, y.token, { kind: 'fixed' }, N)
    assert.equal((await get()).fixedVotes, 2)
    // the organizer verifies (→ official) or ends it
    assert.equal((await api('PUT', `/api/admin/festivals/nordlicht/reports/${r.id}`, x.token, { verified: true }, null)).status, 401)
    assert.equal((await api('PUT', `/api/admin/festivals/nordlicht/reports/${r.id}`, A, { verified: true }, null)).status, 200)
    assert.equal((await get()).source, 'official')
    const list = (await api('GET', '/api/admin/festivals/nordlicht/reports', A, undefined, null)).data
    assert.deepEqual(list.find((z) => z.id === r.id).verified, true)
    assert.equal((await api('DELETE', `/api/admin/festivals/nordlicht/reports/${r.id}`, A, undefined, null)).status, 204)
    assert.equal(await get(), undefined)
  })

  await test('privacy: a location share expires on the server 2 h after it was last confirmed', async () => {
    const N = 'nordlicht'
    const a = (await api('POST', '/api/guests', null, { nickname: 'Tia' })).data
    const b = (await api('POST', '/api/guests', null, { nickname: 'Udo' })).data
    const c = (await api('POST', '/api/crews', a.token, { name: 'Ablauf' }, N)).data
    await joinApproved(a, b, c, N)
    await api('PUT', `/api/crews/${c.id}/location`, b.token, { share: true, location: 'werft' }, N)
    const udo = async () => (await api('GET', `/api/crews/${c.id}`, a.token, undefined, N)).data.members.find((m) => m.nickname === 'Udo')
    assert.deepEqual([(await udo()).sharing, (await udo()).location], [true, 'werft'])
    // age the share beyond 2 h directly in the local database
    await run(['d1', 'execute', 'realm', '--local', '--persist-to', persist, '--command', `UPDATE crew_members SET location_at = ${Date.now() - 121 * 60_000} WHERE crew_id = '${c.id}'`])
    assert.deepEqual([(await udo()).sharing, (await udo()).location], [false, null])
  })

  await test('modules: switched-off features are refused by the API, dependencies enforced', async () => {
    const A = 'test-admin-token'
    const N = 'nordlicht'
    const put = (body) => api('PUT', '/api/admin/festivals/nordlicht/modules', A, body, null)
    const nils = (await api('POST', '/api/guests', null, { nickname: 'Nils' })).data
    const nc = (await api('POST', '/api/crews', nils.token, { name: 'Kai' }, N)).data
    await api('POST', `/api/crews/${nc.id}/messages`, nils.token, { text: 'vorher' }, N)
    assert.equal((await put({ teleport: false })).status, 400)
    const conflict = await put({ crew: false, chat: true })
    assert.equal(conflict.status, 400)
    assert.match(conflict.data.error, /braucht „Crew & Freunde“/)
    // chat off: posting is refused and the snapshot carries no messages
    assert.deepEqual((await put({ chat: false })).data, { chat: false })
    assert.equal((await api('POST', `/api/crews/${nc.id}/messages`, nils.token, { text: 'nachher' }, N)).status, 403)
    assert.deepEqual((await api('GET', `/api/crews/${nc.id}`, nils.token, undefined, N)).data.messages, [])
    assert.equal((await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data.festival.modules.chat, false)
    // crew off: everything crew-related is refused (chat/location/steps follow)
    await put({ crew: false, chat: false, location: false, steps: false, reports: false })
    assert.equal((await api('POST', '/api/crews', nils.token, { name: 'Neu' }, N)).status, 403)
    assert.equal((await api('PUT', '/api/me/steps', nils.token, { day: 0, total: 5 }, N)).status, 403)
    assert.equal((await api('GET', '/api/reports', nils.token, undefined, N)).status, 403)
    // the other festival is unaffected
    assert.equal((await api('GET', '/api/reports', nils.token)).status, 200)
    // back on: the old message is still there
    await put({})
    assert.equal((await api('GET', `/api/crews/${nc.id}`, nils.token, undefined, N)).data.messages[0].text, 'vorher')
  })

  await test('FAQ: drafts stay private, published entries travel with the festival, module switch', async () => {
    const A = 'test-admin-token'
    const base = '/api/admin/festivals/nordlicht/faq'
    assert.equal((await api('PUT', `${base}/einlass`, lea.token, { question: 'Wann ist Einlass?', answer: 'Ab 12 Uhr.' }, null)).status, 401)
    assert.equal((await api('PUT', `${base}/Einlass Nord`, A, { question: 'Wann?', answer: 'Ab 12 Uhr.' }, null)).status, 400)
    assert.equal((await api('PUT', `${base}/einlass`, A, { question: 'Wann ist Einlass?' }, null)).status, 400)
    const d = await api('PUT', `${base}/einlass`, A, { question: 'Wann ist Einlass?', answer: 'Ab 12 Uhr am Hafentor.', category: 'Einlass', source: 'Infoseite', status: 'draft' }, null)
    assert.equal(d.status, 200)
    let pub = (await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data.faq
    assert.deepEqual(pub, [])
    await api('PUT', `${base}/einlass`, A, { question: 'Wann ist Einlass?', answer: 'Ab 12 Uhr am Hafentor.', category: 'Einlass', source: 'Infoseite', status: 'published' }, null)
    pub = (await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data.faq
    assert.equal(pub.length, 1)
    assert.equal(pub[0].source, 'Infoseite')
    assert.ok(pub[0].updatedAt > 0)
    // the other festival keeps its own FAQ
    assert.ok(!(await api('GET', '/api/festivals/realm-open-air', null, undefined, null)).data.faq.some((f) => f.answer.includes('Hafentor')))
    // module off → no FAQ delivered
    await api('PUT', '/api/admin/festivals/nordlicht/modules', A, { faq: false, faqbot: false }, null)
    assert.deepEqual((await api('GET', '/api/festivals/nordlicht', null, undefined, null)).data.faq, [])
    await api('PUT', '/api/admin/festivals/nordlicht/modules', A, {}, null)
    assert.equal((await api('DELETE', `${base}/einlass`, A, undefined, null)).status, 204)
    assert.equal((await api('GET', `${base}`, A, undefined, null)).data.length, 0)
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
