// Colour maths for festival branding (WCAG 2.1). Shared by app, console and worker tests.

export const HEX = /^#[0-9a-fA-F]{6}$/

function channel(c: number) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Text colour on top of the brand colour: whichever of near-black / white reads better. */
export function inkFor(brand: string) {
  return contrast(brand, '#120c2b') >= contrast(brand, '#ffffff') ? '#120c2b' : '#ffffff'
}

function mix(hex: string, with_: string, t: number) {
  const a = parseInt(hex.slice(1), 16)
  const b = parseInt(with_.slice(1), 16)
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')
}

/** App surfaces the brand colour must work on (see styles.css). */
export const SURFACES = { background: '#0a0a0d', card: '#17171d' }

export interface ThemeCheck {
  ok: boolean
  ink: string
  checks: { label: string; ratio: number; min: number; ok: boolean }[]
}

/**
 * Brand colour is used for primary buttons (text on brand), active icons and
 * labels (brand on the dark background). WCAG: 4.5:1 for text, 3:1 for UI parts.
 */
export function checkBrand(brand: string): ThemeCheck {
  const ink = inkFor(brand)
  const checks = [
    { label: 'Text auf Hauptbuttons', ratio: contrast(ink, brand), min: 4.5 },
    { label: 'Farbe als Text auf dem Hintergrund', ratio: contrast(brand, SURFACES.background), min: 4.5 },
    { label: 'Farbe auf Karten', ratio: contrast(brand, SURFACES.card), min: 3 },
  ].map((c) => ({ ...c, ratio: Math.round(c.ratio * 100) / 100, ok: c.ratio >= c.min }))
  return { ok: checks.every((c) => c.ok), ink, checks }
}

/** CSS variables derived from one brand colour. */
export function brandVars(brand: string) {
  return {
    '--brand': brand,
    '--brand-strong': mix(brand, '#000000', 0.12),
    '--brand-ink': inkFor(brand),
    '--brand-soft': `${brand}24`, // ~14 % alpha
  }
}
