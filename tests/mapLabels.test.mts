import assert from 'node:assert/strict'
import { COMPACT, fullLabels, pillWidth } from '../src/screens/mapLabels.ts'

const vp = { left: 0, top: 0, right: 320, bottom: 640 }
let n = 0
const check = (cond: boolean, msg: string) => (assert.ok(cond, msg), n++)

// room for everything: every stage shows its name, other markers never have one
check(fullLabels([{ id: 'a', x: 100, y: 100, label: 'Generator' }, { id: 'w', x: 100, y: 300 }], vp).has('a'), 'free label is shown')
check(!fullLabels([{ id: 'w', x: 100, y: 300 }], vp).has('w'), 'points without label stay compact')
// a stage pill would cover a water point next to it → icon only
const crowded = fullLabels([{ id: 'gen', x: 150, y: 200, label: 'Generator' }, { id: 'water', x: 150 + pillWidth('Generator') / 2, y: 200 }], vp)
check(!crowded.has('gen'), 'label covering a neighbour shrinks')
// cut off at the screen edge (Lagoon at the right border of a 320 px phone)
check(!fullLabels([{ id: 'l', x: 300, y: 300, label: 'Lagoon' }], vp).has('l'), 'label leaving the screen shrinks')
// under a floating control (zoom buttons on the right)
const fabs = { left: 260, top: 300, right: 308, bottom: 560 }
check(!fullLabels([{ id: 'l', x: 230, y: 340, label: 'Lagoon' }], vp, [fabs]).has('l'), 'label under the buttons shrinks')
check(fullLabels([{ id: 'l', x: 120, y: 340, label: 'Lagoon' }], vp, [fabs]).has('l'), 'label clear of the buttons stays')
// two stages close together: the left one keeps its name, the other shrinks (stable while panning)
const two = fullLabels([{ id: 'b', x: 200, y: 100, label: 'Observatory' }, { id: 'a', x: 120, y: 100, label: 'Archive' }], vp)
check(two.has('a') && !two.has('b'), 'first from the left wins')
// a selected stage always shows its name and pushes the neighbour to compact
const sel = fullLabels([{ id: 'b', x: 200, y: 100, label: 'Observatory', pinned: true }, { id: 'a', x: 120, y: 100, label: 'Archive' }], vp)
check(sel.has('b') && !sel.has('a'), 'selected label wins')
// compact markers that are far enough apart do not interfere
check(fullLabels([{ id: 'a', x: 100, y: 100, label: 'X' }, { id: 'w', x: 100, y: 100 + COMPACT + 10 }], vp).has('a'), 'vertical neighbours with space are fine')
console.log(`✓ ${n} Kartenbeschriftungs-Prüfungen bestanden`)
