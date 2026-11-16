// Two tabs share one stored state: adopting the other tab's (possibly stale) save must never
// drop a write this tab queued, and must not resend one the other tab already delivered (src/outboxMerge.ts).
import assert from 'node:assert/strict'
import { mergeConfirmedChat, mergeOutbox } from '../src/outboxMerge.ts'

let passed = 0
const check = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log('✓', name)
}

type Op = { id: string; key?: string }
const op = (id: string, key?: string): Op => ({ id, key })
const key = (o: Op) => o.key ?? null
const ids = (l: Op[]) => l.map((o) => o.id)

check('a stale save from the other tab keeps the write queued here', () => {
  const tracked = new Map([['m2', false]])
  assert.deepEqual(ids(mergeOutbox([op('m1'), op('m2')], [op('m1')], tracked)), ['m1', 'm2'])
  assert.equal(tracked.get('m2'), false)
})

check('a previously seen write survives an older save until explicitly acknowledged', () => {
  const tracked = new Map([['m2', false]])
  mergeOutbox([op('m2')], [op('m2')], tracked)
  assert.equal(tracked.get('m2'), true)
  assert.deepEqual(ids(mergeOutbox([op('m2')], [], tracked)), ['m2'])
  assert.equal(tracked.has('m2'), true)
  assert.deepEqual(ids(mergeOutbox([op('m2')], [], tracked, { sentThere: ['m2'] })), [])
  assert.equal(tracked.has('m2'), false)
})

check('out-of-order saves cannot lose either concurrently queued message', () => {
  const trackedA = new Map([['a', false]])
  const trackedB = new Map([['b', false]])
  const bothA = mergeOutbox([op('a')], [op('b')], trackedA)
  const bothB = mergeOutbox([op('b')], bothA, trackedB)
  const afterStale = mergeOutbox(bothB, [op('a')], trackedB)
  assert.deepEqual(ids(afterStale), ['a', 'b'])
  assert.deepEqual(ids(mergeOutbox(afterStale, [], trackedB, { sentThere: ['a', 'b'] })), [])
})

check('the other tab’s own writes are adopted, in its order, before ours', () => {
  const tracked = new Map([['a', false]])
  assert.deepEqual(ids(mergeOutbox([op('a')], [op('x'), op('y')], tracked)), ['x', 'y', 'a'])
})

check('writes this tab did not queue follow the adopted state (no resurrection)', () => {
  assert.deepEqual(ids(mergeOutbox([op('old')], [], new Map())), [])
})

check('a tracked write that left this tab’s outbox (sent here) is forgotten', () => {
  const tracked = new Map([['gone', false]])
  assert.deepEqual(ids(mergeOutbox([], [], tracked)), [])
  assert.equal(tracked.size, 0)
})

check('privacy decisions: the adopted one for the same target wins, no duplicate', () => {
  const tracked = new Map([['loc-mine', false]])
  const r = mergeOutbox([op('loc-mine', 'location:c1')], [op('loc-other', 'location:c1')], tracked, { key })
  assert.deepEqual(ids(r), ['loc-other'])
  assert.equal(tracked.has('loc-mine'), false)
})

check('a privacy decision for another target is kept', () => {
  const tracked = new Map([['steps', false]])
  const r = mergeOutbox([op('steps', 'deleteSteps')], [op('loc', 'location:c1')], tracked, { key })
  assert.deepEqual(ids(r), ['loc', 'steps'])
})

check('a write the other tab sent without ever saving it queued is not queued again', () => {
  const tracked = new Map([['m1', false]])
  assert.deepEqual(ids(mergeOutbox([op('m1')], [], tracked, { key, sentThere: ['m1'] })), [])
  assert.equal(tracked.has('m1'), false)
})

check('a stale state still listing a write this tab already sent does not queue it again', () => {
  assert.deepEqual(ids(mergeOutbox([], [op('x'), op('y')], new Map(), { sentHere: ['x'] })), ['y'])
})

check('another identity adopts only its own queue and acknowledgements', () => {
  const tracked = new Map([['old-profile', true]])
  const next = mergeOutbox([op('old-profile')], [op('new-profile')], tracked, { sameOwner: false, sentHere: ['new-profile'] })
  assert.deepEqual(ids(next), ['new-profile'])
  assert.equal(tracked.size, 0)
})

check('stale pending chat cannot erase an acknowledged delivery', () => {
  const confirmed = { id: 'sent', text: 'delivered', pending: false }
  const incoming = [{ id: 'sent', text: 'delivered', pending: true }, { id: 'waiting', text: 'queued', pending: true }]
  assert.deepEqual(mergeConfirmedChat([confirmed], incoming, ['sent']), [confirmed, incoming[1]])
  assert.deepEqual(mergeConfirmedChat([confirmed], [], ['sent']), [confirmed])
})

check('fresh moderation wins and old unrelated history is not resurrected', () => {
  const own = [{ id: 'sent', text: 'delivered' }, { id: 'old', text: 'old history' }]
  const deleted = { id: 'sent', text: '', deleted: true }
  assert.deepEqual(mergeConfirmedChat(own, [deleted], ['sent']), [deleted])
})

console.log(`${passed} outbox merge checks passed`)
