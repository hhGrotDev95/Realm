const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

export function randomId(prefix: string, bytes = 12) {
  const b = crypto.getRandomValues(new Uint8Array(bytes))
  return prefix + '_' + base64url(b)
}

export function randomToken() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export function randomCode(groups: number, size = 4) {
  const b = crypto.getRandomValues(new Uint8Array(groups * size))
  const chars = [...b].map((x) => ALPHABET[x % ALPHABET.length])
  return Array.from({ length: groups }, (_, i) => chars.slice(i * size, (i + 1) * size).join('')).join('-')
}

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-')
}

export async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function base64url(b: Uint8Array) {
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429,
    message: string,
    /** extra fields for the error body, e.g. a sign-up challenge */
    public data?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** Tiny runtime validators: keep payloads small and well-typed without a schema library. */
export const v = {
  str(x: unknown, name: string, { min = 1, max = 200, optional = false } = {}): string | undefined {
    if (x === undefined || x === null || x === '') {
      if (optional) return undefined
      throw new HttpError(400, `${name} fehlt`)
    }
    if (typeof x !== 'string') throw new HttpError(400, `${name} muss Text sein`)
    const t = x.trim()
    if (t.length < min || t.length > max) throw new HttpError(400, `${name} muss ${min}–${max} Zeichen lang sein`)
    return t
  },
  int(x: unknown, name: string, min: number, max: number): number {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) throw new HttpError(400, `${name} ist ungültig`)
    return x
  },
  bool(x: unknown, name: string): boolean {
    if (typeof x !== 'boolean') throw new HttpError(400, `${name} muss true/false sein`)
    return x
  },
  color(x: unknown): string | undefined {
    if (x === undefined) return undefined
    if (typeof x !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(x)) throw new HttpError(400, 'Farbe ist ungültig')
    return x
  },
  oneOf<T extends string>(x: unknown, name: string, options: readonly T[]): T {
    if (!options.includes(x as T)) throw new HttpError(400, `${name} ist ungültig`)
    return x as T
  },
}
