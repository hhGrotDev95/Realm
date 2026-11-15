// Map rules shared by console and worker (src/map.ts).
import assert from 'node:assert/strict'
import { DEFAULT_MAP_H, MAP_H_MAX, MAP_H_MIN, checkPos, mapHeight, newPoiId, validatePois } from '../src/map.ts'

let n = 0
const t = (name: string, fn: () => void) => {
  fn()
  n++
  console.log('✓', name)
}

t('map height follows the plan aspect ratio, within bounds', () => {
  assert.equal(mapHeight(2000, 1000), 500)
  assert.equal(mapHeight(1000, 940), DEFAULT_MAP_H)
  assert.equal(mapHeight(4000, 100), MAP_H_MIN)
  assert.equal(mapHeight(100, 4000), MAP_H_MAX)
})

t('positions must lie on the map and are rounded to 0.1', () => {
  assert.deepEqual(checkPos(100.04, 50.06, 500), { x: 100, y: 50.1 })
  assert.equal(typeof checkPos(1001, 10, 500), 'string')
  assert.equal(typeof checkPos(10, 501, 500), 'string')
  assert.equal(typeof checkPos(-1, 10, 500), 'string')
  assert.equal(typeof checkPos('5', 10, 500), 'string')
  assert.equal(typeof checkPos(NaN, 10, 500), 'string')
})

t('valid markers are cleaned; missing ids are numbered', () => {
  const r = validatePois([{ name: ' Wasser ', cat: 'water', x: 1, y: 2 }, { id: 'wc-1', name: 'WC', cat: 'wc', status: 'busy', important: true, detail: 'barrierefrei', x: 3, y: 4 }], 940)
  assert.ok(r.ok)
  assert.deepEqual(r.pois[0], { id: 'p-1', cat: 'water', name: 'Wasser', detail: '', status: null, important: false, x: 1, y: 2 })
  assert.equal(r.pois[1].status, 'busy')
})

t('problems are reported per marker, numbered like the console list', () => {
  const r = validatePois(
    [
      { name: '', cat: 'bar', x: 1, y: 1 },
      { name: 'Bühne', cat: 'stage', x: 1, y: 1 },
      { name: 'Bar', cat: 'bar', status: 'voll', x: 1, y: 1 },
      { id: 'stage-x', name: 'Fake', cat: 'bar', x: 1, y: 1 },
      { id: 'a', name: 'A', cat: 'bar', x: 1, y: 1 },
      { id: 'a', name: 'B', cat: 'bar', x: 1, y: 1 },
      { name: 'Weit weg', cat: 'bar', x: 1, y: 2000 },
    ],
    940,
  )
  assert.ok(!r.ok)
  assert.equal(r.errors.length, 6)
  assert.match(r.errors[0], /^Punkt 1: Name/)
  assert.match(r.errors[1], /Punkt 2 .*Kategorie/)
  assert.match(r.errors[2], /Status/)
  assert.match(r.errors[3], /id ist ungültig/)
  assert.match(r.errors[4], /doppelt/)
  assert.match(r.errors[5], /außerhalb/)
  assert.ok(!validatePois('nope', 940).ok)
  assert.ok(!validatePois(Array.from({ length: 301 }, () => ({ name: 'x', cat: 'bar', x: 1, y: 1 })), 940).ok)
})

t('new ids do not clash', () => {
  assert.equal(newPoiId('water', ['water-1', 'water-2', 'bar-3']), 'water-3')
  assert.equal(newPoiId('bar', []), 'bar-1')
})

console.log(`${n} Karten-Prüfungen bestanden`)
