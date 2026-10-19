// Applies a festival's branding (colour, font, logo) to the running app.
import { brandVars, checkBrand, HEX } from './contrast'

export interface Theme {
  brand?: string
  font?: FontKey
  logo?: string // data: URL (png, webp, jpeg or svg)
}

/** Curated display fonts (Google Fonts). Body text stays Inter for legibility. */
export const FONTS = {
  bricolage: { label: 'Bricolage Grotesque', family: 'Bricolage Grotesque', css: 'Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800' },
  space: { label: 'Space Grotesk', family: 'Space Grotesk', css: 'Space+Grotesk:wght@600;700' },
  unbounded: { label: 'Unbounded', family: 'Unbounded', css: 'Unbounded:wght@600;800' },
  fraunces: { label: 'Fraunces (Serif)', family: 'Fraunces', css: 'Fraunces:opsz,wght@9..144,700;9..144,800' },
  archivo: { label: 'Archivo Black', family: 'Archivo Black', css: 'Archivo+Black' },
} as const
export type FontKey = keyof typeof FONTS

export const DEFAULT_BRAND = '#a58cff'

function loadFont(key: FontKey) {
  const f = FONTS[key]
  const id = `font-${key}`
  if (!document.getElementById(id)) {
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${f.css}&display=swap`
    document.head.appendChild(link)
  }
  return `'${f.family}', 'Inter', system-ui, sans-serif`
}

/**
 * Sets the brand variables on an element (the document for the app, a preview box in the
 * console). Colours that fail the contrast check fall back to the default brand.
 */
export function applyTheme(theme: Theme | undefined, el: HTMLElement = document.documentElement) {
  const brand = theme?.brand && HEX.test(theme.brand) && checkBrand(theme.brand).ok ? theme.brand : DEFAULT_BRAND
  for (const [k, v] of Object.entries(brandVars(brand))) el.style.setProperty(k, v)
  if (theme?.font && theme.font in FONTS) el.style.setProperty('--display', loadFont(theme.font))
  else el.style.removeProperty('--display')
  if (el === document.documentElement) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0a0a0d')
}
