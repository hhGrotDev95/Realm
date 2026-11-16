// Unit tests for the map document (P6): validation shared by console and worker.
import assert from 'node:assert/strict'
import { checkMap, heightForImage, parseMapMeta, MAP_IMAGE_MAX } from '../src/map/doc.ts'

let n = 0
const t = (fn: () => void) => {
  fn()
  n++
}
const stages = ['main', 'tent']
const water = { id: 'w1', cat: 'water', name: 'Wasser Nord', x: 100, y: 200, detail: 'Trinkwasser', status: 'open', important: true }
const ok = (input: unknown) => {
  const r = checkMap(input, stages)
  if (!r.ok) assert.fail(r.errors.join('; '))
  return r
}
const errors = (input: unknown) => {
  const r = checkMap(input, stages)
  assert.equal(r.ok, false)
  return r.ok ? [] : r.errors
}

t(() => {
  const r = ok({ height: 700.4, markers: [water, { id: 'stage-main', cat: 'stage', name: 'Main', x: 500, y: 300 }] })
  assert.equal(r.meta.height, 700)
  assert.equal(r.markers[1].important, true) // stages are always shown
  assert.equal(r.markers[0].status, 'open')
})
t(() => assert.equal(ok({ markers: [] }).meta.height, 940)) // default height
t(() => assert.match(errors({ markers: [{ ...water, y: 800 }], height: 700 })[0], /außerhalb/))
t(() => assert.match(errors({ markers: [{ ...water, x: -1 }] })[0], /außerhalb/))
t(() => assert.match(errors({ markers: [water, { ...water, name: 'Zweite' }] })[0], /doppelt/))
t(() => assert.match(errors({ markers: [{ ...water, cat: 'kiosk' }] })[0], /Kategorie/))
t(() => assert.match(errors({ markers: [{ id: 'stage-gone', cat: 'stage', name: 'Weg', x: 1, y: 1 }] })[0], /keiner Bühne/))
t(() => assert.match(errors({ markers: [{ ...water, id: 'stage-main' }] })[0], /reserviert/))
t(() => assert.match(errors({ markers: [{ ...water, name: '  ' }] })[0], /Name/))
t(() => assert.match(errors({ markers: [{ ...water, status: 'kaputt' }] })[0], /Status/))
t(() => assert.match(errors({ height: 50, markers: [] })[0], /Kartenhöhe/))
t(() => assert.match(errors({ image: 'https://example.com/plan.png', markers: [] })[0], /PNG, WebP oder JPEG/))
t(() => assert.match(errors({ image: 'data:image/svg+xml;base64,PHN2Zz4=', markers: [] })[0], /PNG, WebP oder JPEG/)) // no SVG: could carry scripts
t(() => assert.match(errors({ image: 'data:image/webp;base64,' + 'A'.repeat(MAP_IMAGE_MAX), markers: [] })[0], /zu groß/))
t(() => assert.equal(ok({ image: 'data:image/webp;base64,AAAA', markers: [] }).meta.image, 'data:image/webp;base64,AAAA'))
t(() => assert.match(errors({})[0], /markers/))
t(() => assert.deepEqual(parseMapMeta('{"height":940,"terrain":"demo"}'), { height: 940, terrain: 'demo' }))
t(() => assert.deepEqual(parseMapMeta('kaputt'), { height: 940 }))
t(() => assert.deepEqual(parseMapMeta('{}'), { height: 940 }))
t(() => assert.equal(heightForImage(2000, 1000), 500))
t(() => assert.equal(heightForImage(500, 5000), 3000)) // clamped
console.log(`✓ ${n} Karten-Prüfungen bestanden`)
