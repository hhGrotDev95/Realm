// An update links to the map only when its place names exactly one point (src/updatePoi.ts).
import assert from 'node:assert/strict'
import { poiForUpdate } from '../src/updatePoi.ts'

let passed = 0
const check = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log('✓', name)
}

const POIS = [
  { id: 'stage-lagoon', cat: 'stage', name: 'Lagoon' },
  { id: 'w2', cat: 'water', name: 'Wasserstelle Lagoon' },
  { id: 'w1', cat: 'water', name: 'Wasserstelle Nord' },
  { id: 'in1', cat: 'info', name: 'Info-Zelt' },
  { id: 'x1', cat: 'bar', name: 'Bar' },
  { id: 'x2', cat: 'food', name: 'Bar' },
]
const id = (u: { poi?: string; place?: string }) => poiForUpdate(u, POIS)?.id

check('a known point id wins over the place text', () => {
  assert.equal(id({ poi: 'w1', place: 'Lagoon' }), 'w1')
})
check('an unknown point id falls back to the place', () => {
  assert.equal(id({ poi: 'gone', place: 'Lagoon' }), 'stage-lagoon')
})
check('the place matches a point name regardless of case and spacing', () => {
  assert.equal(id({ place: '  lagoon ' }), 'stage-lagoon')
  assert.equal(id({ place: 'wasserstelle   NORD' }), 'w1')
  assert.equal(id({ place: 'Info-Zelt' }), 'in1')
})
check('"Bühne X" and "X Stage" name the stage X', () => {
  assert.equal(id({ place: 'Bühne Lagoon' }), 'stage-lagoon')
  assert.equal(id({ place: 'Lagoon Stage' }), 'stage-lagoon')
  assert.equal(id({ place: 'Lagoon-Bühne' }), 'stage-lagoon')
  assert.equal(id({ place: 'Stage Nord' }), undefined) // "Nord" is no stage
})
check('a partial or unknown place gets no guess', () => {
  assert.equal(id({ place: 'Nord' }), undefined)
  assert.equal(id({ place: 'Haupteingang' }), undefined)
  assert.equal(id({ place: '' }), undefined)
  assert.equal(id({}), undefined)
})
check('a place naming two points is ambiguous and gets no link', () => {
  assert.equal(id({ place: 'Bar' }), undefined)
})

console.log(`${passed} update-place checks passed`)
