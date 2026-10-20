// Unit tests for branding colour maths (WCAG 2.1 contrast).
import assert from 'node:assert/strict'
import { brandVars, checkBrand, contrast, inkFor } from '../src/theme/contrast.ts'

assert.equal(Math.round(contrast('#000000', '#ffffff') * 10) / 10, 21)
assert.equal(contrast('#777777', '#777777'), 1)
// the default violet passes every check with dark text on buttons
const def = checkBrand('#a58cff')
assert.equal(def.ok, true)
assert.equal(def.ink, '#120c2b')
// dark brand colours are unreadable on the dark app background
const dark = checkBrand('#1a1a6e')
assert.equal(dark.ok, false)
assert.ok(dark.checks.some((c) => c.label.includes('Hintergrund') && !c.ok))
// light colours get dark text, saturated mid tones may need white
assert.equal(inkFor('#ffd54f'), '#120c2b')
assert.equal(inkFor('#c2185b'), '#ffffff')
// derived variables
assert.deepEqual(Object.keys(brandVars('#4fd1c5')), ['--brand', '--brand-strong', '--brand-ink', '--brand-soft'])
assert.equal(brandVars('#4fd1c5')['--brand-soft'], '#4fd1c524')
console.log('✓ 9 Kontrast-/Theme-Prüfungen bestanden')
