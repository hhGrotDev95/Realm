import assert from 'node:assert/strict'
import { powBits, solve, verify, zeroBits } from '../src/pow.ts'

assert.equal(zeroBits(new Uint8Array([0, 0, 0x0f, 1])), 20)
assert.equal(zeroBits(new Uint8Array([0x80])), 0)
assert.equal(zeroBits(new Uint8Array([0, 0])), 16)
const t0 = performance.now()
const nonce = await solve('abc', 12)
const ms = performance.now() - t0
assert.ok(await verify('abc', nonce, 12))
assert.ok(!(await verify('abc', -1, 0)), 'negative nonces are refused')
assert.ok(!(await verify('abc', 1.5, 0)), 'fractional nonces are refused')
// difficulty: free quota → 12 bits, grows with volume, capped at 20
assert.deepEqual([61, 120, 300, 3000, 1e9].map((n) => powBits(n, 60)), [12, 13, 14, 17, 20])
console.log(`✓ Proof of Work: 12 Bit in ${Math.round(ms)} ms gelöst, Prüfung und Schwierigkeit stimmen`)
