// Every German UI text passed to t() in the visitor app has an English translation with the
// same {placeholders}; t() calls use plain string literals so this scan sees all of them.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EN } from '../src/i18n/en.ts'
import { t, useLangForTest } from '../src/i18n/index.ts'

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'admin' || f === 'i18n' ? [] : files(p)
    return /\.tsx?$/.test(f) ? [p] : []
  })

const keys = new Map<string, string>()
const dynamic: string[] = []
for (const f of files('src')) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) keys.set(m[2].replace(/\\(['"\\])/g, '$1'), f)
  for (const m of src.matchAll(/\bt\(\s*`/g)) dynamic.push(`${f}@${m.index}`)
}
assert.deepEqual(dynamic, [], 't() must get a plain string literal, not a template')
assert.ok(keys.size > 150, `only ${keys.size} translated texts found`)

const missing = [...keys].filter(([k]) => !(k in EN)).map(([k, f]) => `${f}: ${k}`)
assert.deepEqual(missing, [], 'texts without English translation')
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const wrong = [...keys.keys()].filter((k) => ph(k) !== ph(EN[k]))
assert.deepEqual(wrong, [], 'placeholders differ between German and English')
const unused = Object.keys(EN).filter((k) => !keys.has(k))
assert.deepEqual(unused, [], 'English entries nobody uses')

useLangForTest('en')
assert.equal(t('Noch {n} Min.', { n: 5 }), EN['Noch {n} Min.']?.replace('{n}', '5') ?? 'Noch 5 Min.')
useLangForTest('de')
assert.equal(t('Gibt es nicht {x}', { x: 1 }), 'Gibt es nicht 1')
console.log(`✓ ${keys.size} UI-Texte, alle mit englischer Übersetzung`)
