// Map geometry shared by the app, the console's map editor and the worker.
// Positions are stored in map units: the map is always MAP_W wide, its height follows the
// aspect ratio of the festival's site plan. x/MAP_W and y/height are therefore relative
// positions, so markers stay put when the plan is replaced by one with another aspect ratio.

export const POI_CATS = ['stage', 'water', 'wc', 'food', 'medical', 'bar', 'entrance', 'camping', 'info', 'shuttle'] as const
export type PoiCat = (typeof POI_CATS)[number]

export const POI_STATUS = ['open', 'busy', 'closed'] as const

export const MAP_W = 1000
/** Height of the built-in illustrated ground (and of any festival without its own plan). */
export const DEFAULT_MAP_H = 940
export const MIN_MAP_H = 300
export const MAX_MAP_H = 3000
/** Characters of the site plan's data: URL (~750 kB image); the console compresses to fit. */
export const MAP_IMAGE_MAX = 1_000_000
export const MAP_IMAGE = /^data:image\/(png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/

/** The festival's own site plan, if any. */
export interface MapConfig {
  image?: string
  height?: number
}

export const mapHeight = (m: MapConfig | undefined) => (m?.image && m.height ? m.height : DEFAULT_MAP_H)

/** Map height for a plan of the given pixel size. */
export const heightFor = (w: number, h: number) => Math.min(MAX_MAP_H, Math.max(MIN_MAP_H, Math.round((MAP_W * h) / w)))

/** Keeps a position on the map (whole map units). */
export const clampPos = (x: number, y: number, height: number) => ({
  x: Math.round(Math.min(MAP_W, Math.max(0, x))),
  y: Math.round(Math.min(height, Math.max(0, y))),
})
