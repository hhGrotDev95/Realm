import assert from 'node:assert/strict'
import { ageSince } from '../src/aging.ts'

const fetched = Date.UTC(2027, 6, 16, 18, 0)
const items = [
  { id: 'a', ageMin: 3, validMin: 40 },
  { id: 'b', ageMin: 10, validMin: null },
  { id: 'c', ageMin: 0, validMin: 125 },
]
assert.deepEqual(ageSince(items, fetched, fetched), items, 'right after the fetch nothing changes')
const later = ageSince(items, fetched, fetched + 30 * 60_000)
assert.deepEqual(later.map((x) => [x.id, x.ageMin, x.validMin]), [['a', 33, 10], ['b', 40, null], ['c', 30, 95]])
// two hours offline: the community report is gone, the one without expiry keeps ageing
const offline = ageSince(items, fetched, fetched + 120 * 60_000)
assert.deepEqual(offline.map((x) => [x.id, x.ageMin, x.validMin]), [['b', 130, null], ['c', 120, 5]])
assert.deepEqual(ageSince(items, fetched, fetched - 5 * 60_000), items, 'a clock that went backwards does not rejuvenate')
assert.deepEqual(ageSince([{ ageMin: 1, validMin: 30 }], undefined as unknown as number, fetched), [], 'unknown fetch time: expired, not NaN')
console.log('✓ 5 Alterungs-Prüfungen bestanden')
