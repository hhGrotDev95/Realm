// Migration test: data written under the old schema (0001–0004) survives the multi-tenant
// migrations (0005+) unchanged and lands in the original festival.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'

const persist = '.wrangler/migration-test'
rmSync(persist, { recursive: true, force: true })
const sql = (args) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'realm', '--local', '--persist-to', persist, '--json', ...args], { encoding: 'utf8' }))
const file = (f) => sql(['--file', `migrations/${f}`])
const q = (command) => sql(['--command', command])[0].results

const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()
const before = files.filter((f) => f < '0005')
const after = files.filter((f) => f >= '0005')

for (const f of before) file(f)
q(`INSERT INTO guests (id, token_hash, nickname, color, created_at) VALUES ('g_old', 'h', 'Alt', '#A58CFF', 1)`)
q(`INSERT INTO crews (id, code, name, created_by, created_at) VALUES ('c_old', 'AAAA-BBBB', 'Altcrew', 'g_old', 1)`)
q(`INSERT INTO crew_members (crew_id, guest_id, joined_at) VALUES ('c_old', 'g_old', 1)`)
q(`INSERT INTO plans (guest_id, act_id) VALUES ('g_old', '1-maduk'), ('g_old', '2-kairo')`)
q(`INSERT INTO steps (guest_id, day, total, synced_at) VALUES ('g_old', 1, 9000, 1)`)
q(`INSERT INTO messages (id, crew_id, guest_id, text, created_at) VALUES ('m_old', 'c_old', 'g_old', 'Hallo', 1)`)
q(`INSERT INTO reports (id, guest_id, title, created_at, expires_at) VALUES ('r_old', 'g_old', 'Alt', 1, 9999999999999)`)
q(`INSERT INTO announcements (id, title, severity, created_at) VALUES ('a_old', 'Alt', 'info', 1)`)
q(`INSERT INTO timetable_changes (act_id, cancelled, updated_at) VALUES ('1-arcturus', 1, 1)`)

for (const f of after) file(f)

assert.deepEqual(q(`SELECT festival_id FROM crews WHERE id = 'c_old'`), [{ festival_id: 'realm' }])
assert.deepEqual(q(`SELECT festival_id, act_id FROM plans WHERE guest_id = 'g_old' ORDER BY act_id`), [
  { festival_id: 'realm', act_id: '1-maduk' },
  { festival_id: 'realm', act_id: '2-kairo' },
])
assert.deepEqual(q(`SELECT festival_id, day, total FROM steps`), [{ festival_id: 'realm', day: 1, total: 9000 }])
assert.deepEqual(q(`SELECT text FROM messages WHERE id = 'm_old'`), [{ text: 'Hallo' }])
assert.deepEqual(q(`SELECT festival_id FROM reports WHERE id = 'r_old'`), [{ festival_id: 'realm' }])
assert.deepEqual(q(`SELECT festival_id FROM announcements WHERE id = 'a_old'`), [{ festival_id: 'realm' }])
assert.deepEqual(q(`SELECT festival_id, act_id, cancelled FROM timetable_changes`), [{ festival_id: 'realm', act_id: '1-arcturus', cancelled: 1 }])
assert.equal(q(`SELECT COUNT(*) AS n FROM acts WHERE festival_id = 'realm'`)[0].n, 59)
console.log(`✓ ${before.length} alte + ${after.length} neue Migrationen: alle Altdaten erhalten und dem Festival 'realm' zugeordnet`)
rmSync(persist, { recursive: true, force: true })
