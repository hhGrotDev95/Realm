// Shared by the app, the console and the worker: the map canvas and what may be placed on it.
// Coordinates are canvas units (0…MAP_W × 0…MAP_H); an uploaded ground image is fitted onto
// exactly this canvas, so markers stay where the organizer put them on every screen size.

export const MAP_W = 1000
export const MAP_H = 940

export const POI_CATS = ['water', 'wc', 'food', 'bar', 'medical', 'entrance', 'camping', 'info', 'shuttle'] as const
export type PlaceCat = (typeof POI_CATS)[number]
export const POI_CAT_LABEL: Record<PlaceCat, string> = {
  water: 'Wasser',
  wc: 'WC',
  food: 'Essen',
  bar: 'Bar',
  medical: 'Sanitäter',
  entrance: 'Eingang',
  camping: 'Camping',
  info: 'Info',
  shuttle: 'Shuttle',
}
export const POI_STATUSES = ['open', 'busy', 'closed'] as const
export const MAX_POIS = 300
/** Characters of the ground image data: URL (~450 kB JPEG/PNG/WebP). */
export const MAP_IMAGE_MAX = 600_000
export const MAP_IMAGE_RE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/

/** demo = the built-in illustrated grounds of the demo festival; plain = neutral ground. */
export type MapArt = 'demo' | 'plain'
export interface MapSettings {
  image?: string
  art?: MapArt
}

export const clampToMap = (x: number, y: number) => ({
  x: Math.round(Math.min(MAP_W, Math.max(0, x))),
  y: Math.round(Math.min(MAP_H, Math.max(0, y))),
})
