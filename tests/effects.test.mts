// Effects must not return a value by accident: an arrow with an expression body hands its
// result to React as cleanup. Since Chrome 155, scrollIntoView returns a Promise, which
// crashed the chat ("destroy is not a function", audit F07). Effects need a block body.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []))
const offenders: string[] = []
for (const f of files('src')) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/use(Layout)?Effect\(\s*(async\s*)?\(\s*\)\s*=>\s*(?![\s{])/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`)
    })
}
assert.deepEqual(offenders, [], 'effects with an expression body (use a block body)')
console.log('✓ alle Effekte haben einen Blockrumpf')
