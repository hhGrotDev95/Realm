// Applies a festival's branding (colour, font, logo) to the running app.
import { brandVars, checkBrand, HEX } from './contrast'

export interface Theme {
  brand?: string
  font?: FontKey
  logo?: string // data: URL (png, webp, jpeg or svg)
}

/**
 * Curated display fonts, shipped with the app (SIL Open Font License, via Fontsource) – no connection to
 * a font service (audit F14). Body text stays Inter for legibility. Each font loads only when a festival uses it.
 */
export const FONTS = {
  bricolage: { label: 'Bricolage Grotesque', family: 'Bricolage Grotesque Variable', load: () => import('@fontsource-variable/bricolage-grotesque') },
  space: { label: 'Space Grotesk', family: 'Space Grotesk Variable', load: () => import('@fontsource-variable/space-grotesk') },
  unbounded: { label: 'Unbounded', family: 'Unbounded Variable', load: () => import('@fontsource-variable/unbounded') },
  fraunces: { label: 'Fraunces (Serif)', family: 'Fraunces Variable', load: () => import('@fontsource-variable/fraunces') },
  archivo: { label: 'Archivo Black', family: 'Archivo Black', load: () => import('@fontsource/archivo-black') },
} as const
export type FontKey = keyof typeof FONTS

export const DEFAULT_BRAND = '#a58cff'

const loaded = new Set<FontKey>()
function loadFont(key: FontKey) {
  const f = FONTS[key]
  if (!loaded.has(key)) {
    loaded.add(key)
    f.load().catch(() => loaded.delete(key)) // offline before first use: the fallback font shows
  }
  return `'${f.family}', 'Inter Variable', system-ui, sans-serif`
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
