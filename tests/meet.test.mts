import assert from 'node:assert/strict'
import { fairMeetingPoint, walk } from '../src/meet.ts'

const spots = [
  { id: 'west', x: 0, y: 0 },
  { id: 'middle', x: 380, y: 0 },
  { id: 'east', x: 760, y: 0 },
]
assert.equal(walk({ x: 0, y: 0 }, { x: 380, y: 0 }), 10)
assert.equal(fairMeetingPoint([{ x: 0, y: 0 }], spots), null, 'one person needs no meeting point')
assert.equal(fairMeetingPoint([{ x: 0, y: 0 }, { x: 1, y: 1 }], []), null)
// two people at both ends: the middle is fair, even though "west" has the same total
const r = fairMeetingPoint([{ x: 0, y: 0 }, { x: 760, y: 0 }], spots)!
assert.equal(r.spot.id, 'middle')
assert.equal(r.max, 10)
// three people, two of them in the east: minimax still protects the one in the west
assert.equal(fairMeetingPoint([{ x: 0, y: 0 }, { x: 760, y: 0 }, { x: 760, y: 0 }], spots)!.spot.id, 'middle')
// equal longest walk → the smaller total wins
const tie = fairMeetingPoint([{ x: 380, y: 0 }, { x: 380, y: 0 }], [{ id: 'a', x: 380, y: 380 }, { id: 'b', x: 380, y: 10 }])!
assert.equal(tie.spot.id, 'b')
console.log('✓ 7 Treffpunkt-Prüfungen bestanden')
