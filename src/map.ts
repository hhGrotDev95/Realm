// The festival's ground plan, shared by the app, the console and the worker.
// Marker coordinates are in frame units: the frame is always MAP_WIDTH wide and as tall as the
// ground plan's aspect ratio requires, so markers keep their place relative to the image.

export const MAP_WIDTH = 1000
export const DEFAULT_MAP_HEIGHT = 940
export const MAP_MIN_HEIGHT = 300
export const MAP_MAX_HEIGHT = 3000
/** Characters of the data: URL (~900 kB image); keeps the festival document cacheable offline. */
export const MAP_IMAGE_MAX = 1_200_000

export type MapGround = 'demo' | 'plain' | 'image'

export interface MapFrame {
  width: number
  height: number
  /** demo = the drawn demo grounds, plain = neutral field, image = uploaded ground plan */
  ground: MapGround
  image?: string
}

/** Categories a marker can have; stage markers come from the stages themselves. */
export const POI_CATS = ['water', 'wc', 'food', 'medical', 'bar', 'entrance', 'camping', 'info', 'shuttle'] as const
export type MarkerCat = (typeof POI_CATS)[number]
export const POI_CAT_LABEL: Record<MarkerCat, string> = {
  water: 'Wasser',
  wc: 'WC',
  food: 'Essen',
  medical: 'Sanitäter',
  bar: 'Bar',
  entrance: 'Eingang',
  camping: 'Camping',
  info: 'Info',
  shuttle: 'Shuttle',
}

/** Frame height for an image of w × h pixels. */
export function frameHeight(w: number, h: number) {
  if (!(w > 0 && h > 0)) return DEFAULT_MAP_HEIGHT
  return Math.min(MAP_MAX_HEIGHT, Math.max(MAP_MIN_HEIGHT, Math.round((MAP_WIDTH * h) / w)))
}

/** Reads the stored map JSON; anything unexpected falls back to a plain default frame. */
export function parseMap(raw: unknown): MapFrame {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Partial<MapFrame>
  const height = typeof m.height === 'number' && m.height >= MAP_MIN_HEIGHT && m.height <= MAP_MAX_HEIGHT ? m.height : DEFAULT_MAP_HEIGHT
  if (typeof m.image === 'string' && m.image.startsWith('data:image/')) return { width: MAP_WIDTH, height, ground: 'image', image: m.image }
  return { width: MAP_WIDTH, height, ground: m.ground === 'demo' ? 'demo' : 'plain' }
}

/** Default spot for the i-th stage that has never been placed, inside a frame of this height. */
export function defaultStagePos(i: number, height: number) {
  const rows = Math.max(1, Math.floor((height - 100) / 200))
  return { x: 200 + (i % 4) * 180, y: Math.min(height - 60, 220 + (Math.floor(i / 4) % rows) * 200) }
}
