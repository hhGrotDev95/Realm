// Local state must survive restarts: damaged fields fall back without losing the rest, and a full
// storage first gives up re-fetchable caches before the visitor's own state (src/persist.ts).
import assert from 'node:assert/strict'
import { restore, save } from '../src/persist.ts'

let passed = 0
const check = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log('✓', name)
}

/** Storage with a size limit in characters that throws like a browser when it is exceeded */
function quotaStorage(limit: number, init: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(init))
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0)
  const s = {
    data,
    get length() {
      return data.size
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = data.get(k)
      data.set(k, v)
      if (used() > limit) {
        if (before === undefined) data.delete(k)
        else data.set(k, before)
        throw new DOMException('quota', 'QuotaExceededError')
      }
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
  return s as Storage & { data: Map<string, string> }
}

const defaults = { plan: ['a'], reminders: {} as Record<string, boolean>, session: null as null | { token: string }, phase: 'during', stepsOptIn: false }

check('stored fields replace the defaults', () => {
  const r = restore(defaults, { plan: ['x', 'y'], reminders: { x: true }, session: { token: 't' }, phase: 'after', stepsOptIn: true })
  assert.deepEqual(r, { plan: ['x', 'y'], reminders: { x: true }, session: { token: 't' }, phase: 'after', stepsOptIn: true })
})

check('a damaged field falls back alone, the rest of the plan survives', () => {
  const r = restore(defaults, { plan: ['x'], reminders: null, phase: 3, stepsOptIn: 'yes' })
  assert.deepEqual(r.plan, ['x'])
  assert.deepEqual(r.reminders, {})
  assert.equal(r.phase, 'during')
  assert.equal(r.stepsOptIn, false)
})

check('a plan stored as an object (not a list) does not crash the app', () => {
  assert.deepEqual(restore(defaults, { plan: { 0: 'x' } }).plan, ['a'])
})

check('nullable fields accept a value and null; null never replaces a list', () => {
  assert.deepEqual(restore(defaults, { session: { token: 't' } }).session, { token: 't' })
  assert.equal(restore(defaults, { session: null }).session, null)
  assert.deepEqual(restore(defaults, { plan: null }).plan, ['a'])
})

check('a stored value that is no object at all keeps the defaults', () => {
  for (const v of [null, 'x', 1, ['plan']]) assert.deepEqual(restore(defaults, v), defaults)
})

check('fields from a newer version are kept', () => {
  assert.equal((restore(defaults, { future: 1 }) as Record<string, unknown>).future, 1)
})

check('a normal save writes the state', () => {
  const ls = quotaStorage(1000)
  assert.equal(save(ls, 'state', '{"plan":["x"]}'), 'ok')
  assert.equal(ls.getItem('state'), '{"plan":["x"]}')
})

check('full storage: other festivals’ offline copies go first, the state is saved in full', () => {
  const ls = quotaStorage(300, { 'realm.bundle:other': 'b'.repeat(150), 'realm.bundle:mine': 'm'.repeat(50) })
  const value = 's'.repeat(80)
  const res = save(ls, 'state', value, { evictable: () => ['realm.bundle:other'], slim: () => 'slim' })
  assert.equal(res, 'freed')
  assert.equal(ls.getItem('state'), value)
  assert.equal(ls.getItem('realm.bundle:mine'), 'm'.repeat(50), 'the current festival’s copy stays')
  assert.equal(ls.getItem('realm.bundle:other'), null)
})

check('still full: the slim state (without re-fetchable caches) is saved', () => {
  const ls = quotaStorage(100)
  assert.equal(save(ls, 'state', 'x'.repeat(200), { evictable: () => [], slim: () => 'small' }), 'slim')
  assert.equal(ls.getItem('state'), 'small')
})

check('nothing fits: reported as failed, the previous copy is untouched', () => {
  const ls = quotaStorage(40, { state: 'old' })
  assert.equal(save(ls, 'state', 'x'.repeat(200), { slim: () => 'y'.repeat(100) }), 'failed')
  assert.equal(ls.getItem('state'), 'old')
})

check('blocked storage (any other error) is reported as failed, not thrown', () => {
  const ls = quotaStorage(1000)
  ls.setItem = () => {
    throw new DOMException('denied', 'SecurityError')
  }
  assert.equal(save(ls, 'state', 'x'), 'failed')
})

console.log(`${passed} persistence checks passed`)
