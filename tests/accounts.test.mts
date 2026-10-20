import assert from 'node:assert/strict'
import { base32, checkPassword, checkTotp, hashPassword, totp, unbase32 } from '../worker/src/accounts.ts'

// RFC 6238 test vector (SHA-1, secret "12345678901234567890"), 8 digits
const secret = base32(new TextEncoder().encode('12345678901234567890'))
assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
assert.deepEqual([...unbase32(secret)], [...new TextEncoder().encode('12345678901234567890')])
assert.equal(await totp(secret, Math.floor(59 / 30), 8), '94287082')
assert.equal(await totp(secret, Math.floor(1111111109 / 30), 8), '07081804')
assert.equal(await totp(secret, Math.floor(2000000000 / 30), 8), '69279037')
// drift of one step is accepted, two are not; the matching step is returned (for replay protection)
const now = 1_700_000_000_000
const code = await totp(secret, Math.floor(now / 30_000) - 1)
assert.equal(await checkTotp(secret, code, now), Math.floor(now / 30_000) - 1)
assert.equal(await checkTotp(secret, await totp(secret, Math.floor(now / 30_000) - 2), now), null)
assert.equal(await checkTotp(secret, 'abcdef', now), null)
// passwords: salted, verifiable, wrong ones fail
const h = await hashPassword('richtig-langes-passwort')
assert.match(h, /^pbkdf2\$100000\$/)
assert.notEqual(h, await hashPassword('richtig-langes-passwort'), 'salted')
assert.ok(await checkPassword('richtig-langes-passwort', h))
assert.ok(!(await checkPassword('falsch', h)))
console.log('✓ Konten: TOTP (RFC 6238), Base32 und Passwort-Hash geprüft')
