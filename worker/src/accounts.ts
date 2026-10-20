/**
 * Organizer accounts (audit F01): passwords (PBKDF2) and authenticator-app codes (TOTP, RFC 6238).
 * Pure functions on WebCrypto, shared by the worker and its tests.
 */

const enc = new TextEncoder()
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))

/** Cloudflare Workers allow at most 100,000 PBKDF2 iterations. */
const ITERATIONS = 100_000

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256))
}

/** "pbkdf2$<iterations>$<salt>$<hash>" */
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`
}

export async function checkPassword(password: string, stored: string) {
  const [kind, it, salt, hash] = stored.split('$')
  if (kind !== 'pbkdf2') return false
  const got = await pbkdf2(password, unb64(salt), Number(it))
  const want = unb64(hash)
  let diff = got.length ^ want.length
  for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got[i] ^ want[i]
  return diff === 0
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function base32(bytes: Uint8Array) {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
export function unbase32(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export const newTotpSecret = () => base32(crypto.getRandomValues(new Uint8Array(20)))

/** The 6-digit code for one 30-second step (HMAC-SHA1, as every authenticator app does). */
export async function totp(secret: string, step: number, digits = 6) {
  const key = await crypto.subtle.importKey('raw', unbase32(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setBigUint64(0, BigInt(step))
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const o = h[h.length - 1] & 15
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 10 ** digits).padStart(digits, '0')
}

export const totpStep = (now = Date.now()) => Math.floor(now / 30_000)

/**
 * Checks a code against the current step ±1 (clock drift). Returns the matching step, so the caller can
 * refuse a code that was already used (replay); null when wrong.
 */
export async function checkTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null
  const step = totpStep(now)
  for (const s of [step, step - 1, step + 1]) if ((await totp(secret, s)) === code) return s
  return null
}
