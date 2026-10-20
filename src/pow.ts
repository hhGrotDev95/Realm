/**
 * Proof of work for sign-ups (audit F08). Behind a festival WLAN hundreds of visitors share one IP, so the
 * IP alone must not lock anyone out. Past a generous free quota a new guest profile costs a small amount of
 * computation instead: invisible for one visitor (well under a second on a phone), expensive for someone
 * creating thousands of profiles. Shared by the worker (verify) and the app (solve).
 */
async function hash(challenge: string, nonce: number) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${challenge}:${nonce}`)))
}

/** Number of leading zero bits. */
export function zeroBits(b: Uint8Array) {
  let n = 0
  for (const byte of b) {
    if (byte === 0) {
      n += 8
      continue
    }
    return n + Math.clz32(byte) - 24
  }
  return n
}

export async function verify(challenge: string, nonce: number, bits: number) {
  return Number.isSafeInteger(nonce) && nonce >= 0 && zeroBits(await hash(challenge, nonce)) >= bits
}

export async function solve(challenge: string, bits: number) {
  for (let nonce = 0; ; nonce++) if (zeroBits(await hash(challenge, nonce)) >= bits) return nonce
}

/** Difficulty grows with the sign-ups from one address: 12 bits (~4,000 hashes) up to 20 bits (~1 million). */
export const powBits = (signups: number, free: number) => Math.min(20, 12 + Math.max(0, Math.floor(Math.log2(signups / free))))
