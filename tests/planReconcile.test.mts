// A planned act that leaves the line-up must not vanish silently, and one the organizer moved to
// another day by re-importing must follow – without guessing between two sets (src/planReconcile.ts).
import assert from 'node:assert/strict'
import { reconcilePlan, rekey, type ActInfo } from '../src/planReconcile.ts'

let passed = 0
const check = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log('✓', name)
}

const act = (artist: string, day: number, start: number): ActInfo => ({ artist, day, start })
const before = [new Map([
  ['1-maduk', act('Maduk', 1, 1320)],
  ['1-somna', act('Somna', 1, 1260)],
  ['0-orra', act('Orra', 0, 1200)],
  ['2-orra', act('Orra', 2, 1200)],
])]

check('known acts stay, in order, without duplicates', () => {
  const known = { '1-maduk': act('Maduk', 1, 1320), '1-somna': act('Somna', 1, 1260) }
  const r = reconcilePlan(['1-somna', '1-maduk', '1-somna'], known, before)
  assert.deepEqual(r, { plan: ['1-somna', '1-maduk'], notices: [] })
})

check('a removed act is named with its former slot', () => {
  const r = reconcilePlan(['1-maduk', '1-somna'], { '1-maduk': act('Maduk', 1, 1320) }, before)
  assert.deepEqual(r.plan, ['1-maduk'])
  assert.deepEqual(r.notices, [{ kind: 'gone', id: '1-somna', artist: 'Somna', day: 1, start: 1260 }])
})

check('an act moved to another day (new id) follows into the plan', () => {
  const r = reconcilePlan(['1-maduk'], { '2-maduk': act('Maduk ', 2, 1380) }, before)
  assert.deepEqual(r.plan, ['2-maduk'])
  assert.deepEqual(r.notices, [{ kind: 'moved', id: '1-maduk', to: '2-maduk', artist: 'Maduk ' }])
})

check('the artist match ignores case', () => {
  const r = reconcilePlan(['1-somna'], { 'x-1': act('SOMNA', 2, 1300) }, before)
  assert.equal(r.notices[0].kind, 'moved')
})

check('an artist with another, older set is not guessed – the removed one is gone', () => {
  // Orra played Thu and Sat; Thu is removed, Sat existed before → not a move
  const r = reconcilePlan(['0-orra'], { '2-orra': act('Orra', 2, 1200) }, before)
  assert.deepEqual(r.plan, [])
  assert.equal(r.notices[0].kind, 'gone')
})

check('two new sets of the same artist are not guessed either', () => {
  const r = reconcilePlan(['1-maduk'], { '2-maduk': act('Maduk', 2, 1200), '3-maduk': act('Maduk', 3, 1200) }, before)
  assert.deepEqual(r.plan, [])
  assert.equal(r.notices[0].kind, 'gone')
})

check('without an earlier copy the act is gone, unnamed', () => {
  const r = reconcilePlan(['9-who'], { '2-maduk': act('Maduk', 2, 1380) }, [])
  assert.deepEqual(r.notices, [{ kind: 'gone', id: '9-who', artist: null, day: null, start: null }])
})

check('a later fetch of the same new line-up still sees the move', () => {
  // the app may load the new line-up twice (boot, then the check itself): the move must survive that
  const now = { '2-maduk': act('Maduk', 2, 1380) }
  const r = reconcilePlan(['1-maduk'], now, [...before, new Map(Object.entries(now))])
  assert.deepEqual(r.plan, ['2-maduk'])
})

check('a move onto an act already planned keeps it once', () => {
  const r = reconcilePlan(['2-maduk', '1-maduk'], { '2-maduk': act('Maduk', 2, 1380) }, before)
  assert.deepEqual(r.plan, ['2-maduk'])
})

check('reminders and "were you there?" answers move with the act or are dropped', () => {
  const notices = reconcilePlan(['1-maduk', '1-somna'], { '2-maduk': act('Maduk', 2, 1380) }, before).notices
  assert.deepEqual(rekey({ '1-maduk': true, '1-somna': false, '0-orra': true }, notices), { '2-maduk': true, '0-orra': true })
  // an answer already given for the new id wins
  assert.deepEqual(rekey({ '1-maduk': true, '2-maduk': false }, notices), { '2-maduk': false })
})

console.log(`${passed} Plan-Abgleich-Prüfungen bestanden`)
