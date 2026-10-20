import assert from 'node:assert/strict'
import { pollDelay, POLL_ACTIVE_MS, POLL_AWAY_MS, POLL_IDLE_MS } from '../src/sync.ts'

const mid = () => 0.5
assert.equal(pollDelay(0, mid), POLL_ACTIVE_MS, 'in use: every 8 s')
assert.equal(pollDelay(5 * 60_000, mid), POLL_IDLE_MS, 'untouched for minutes: every 30 s')
assert.equal(pollDelay(60 * 60_000, mid), POLL_AWAY_MS, 'in the pocket: every minute')
// jitter: ±20 %, so thousands of phones do not hit the server in the same second
assert.equal(pollDelay(0, () => 0), 6400)
assert.equal(pollDelay(0, () => 0.999999), 9600)
// requests per second for 10,000 active visitors (crew + reports per poll), as in docs/CAPACITY.md
const rps = (users: number, ms: number) => Math.round((users * 2) / (ms / 1000))
assert.equal(rps(10_000, POLL_ACTIVE_MS), 2500)
assert.equal(rps(10_000, POLL_IDLE_MS), 667)
console.log('✓ 4 Poll-Intervall-Prüfungen bestanden')
