import assert from 'node:assert/strict'
import { saveLocal } from '../src/storage.ts'

/** localStorage with a quota in characters, like a browser's (~5 M). */
function fakeStore(quota: number) {
  const m = new Map<string, string>()
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0)
  return {
    m,
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem(k: string, v: string) {
      const before = m.get(k)
      m.set(k, v)
      if (used() > quota) {
        before === undefined ? m.delete(k) : m.set(k, before)
        throw new DOMException('quota', 'QuotaExceededError')
      }
    },
  }
}
const bundle = (slug: string, siteMap: string | null) => JSON.stringify({ festival: { slug, siteMap }, days: [1], stages: [], acts: [], pois: [] })
const state = (n: number) => JSON.stringify({ plan: Array.from({ length: n }, (_, i) => 'act-' + i) })

// 1. plenty of room: written as is
let s = fakeStore(10_000)
assert.ok(saveLocal('realm.v2:a', state(3), 'a', s))
assert.equal(s.getItem('realm.v2:a'), state(3))

// 2. another festival's cached document gives way for the visitor's plan
s = fakeStore(3_000)
s.setItem('realm.bundle:old', bundle('old', 'x'.repeat(2_000)))
s.setItem('realm.bundle:a', bundle('a', null))
assert.ok(saveLocal('realm.v2:a', state(120), 'a', s), 'plan saved after evicting the other festival')
assert.equal(s.getItem('realm.bundle:old'), null)
assert.ok(s.getItem('realm.bundle:a'), 'the current festival stays cached')

// 3. still too full: the current festival's site plan image goes, its timetable stays
s = fakeStore(3_000)
s.setItem('realm.bundle:a', bundle('a', 'x'.repeat(2_200)))
assert.ok(saveLocal('realm.v2:a', state(120), 'a', s))
const kept = JSON.parse(s.getItem('realm.bundle:a')!)
assert.equal(kept.festival.siteMap, null)
assert.equal(kept.festival.slug, 'a')

// 4. a festival document too big with its image is cached without it rather than not at all
s = fakeStore(1_000)
assert.ok(saveLocal('realm.bundle:a', bundle('a', 'x'.repeat(2_000)), 'a', s))
assert.equal(JSON.parse(s.getItem('realm.bundle:a')!).festival.siteMap, null)

// 5. nothing left to free: honest false, nothing else touched
s = fakeStore(100)
s.setItem('realm.v2:a', '{}')
assert.equal(saveLocal('realm.v2:a', state(60), 'a', s), false)
assert.equal(s.getItem('realm.v2:a'), '{}', 'the previous state is not destroyed')

// 6. no storage at all (private mode, blocked): false instead of a crash
assert.equal(saveLocal('k', 'v', 'a', undefined), false)

console.log('✓ 6 Speicher-Prüfungen bestanden')
