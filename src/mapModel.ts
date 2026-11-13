// The festival map model, shared by app, console and worker.
// Coordinates are map units: the map is always MAP_W wide; its height follows the ground plan's
// aspect ratio. Replacing the plan with one of another aspect rescales y, so markers keep their
// relative position on the grounds.

export const MAP_W = 1000
export const DEFAULT_MAP_H = 940
/** Allowed ground plan aspect ratios (height / width). */
export const MIN_ASPECT = 1 / 3
export const MAX_ASPECT = 3
/** Decoded size limit for an uploaded ground plan. */
export const MAX_IMAGE_BYTES = 1_000_000
export const MAX_POIS = 300

export const POI_CATS = ['water', 'wc', 'food', 'medical', 'bar', 'entrance', 'camping', 'info', 'shuttle'] as const
export const POI_CAT_LABEL: Record<(typeof POI_CATS)[number] | 'stage', string> = {
  stage: 'Bühne',
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
export const POI_STATUS = ['open', 'busy', 'closed'] as const

export interface MapInfo {
  /** 'demo' draws the demo festival's illustrated grounds, 'plain' a neutral field. */
  ground?: 'demo' | 'plain'
  /** The uploaded ground plan: version hash and pixel size. */
  image?: { v: string; w: number; h: number }
}

export const mapHeight = (m: MapInfo | undefined) => (m?.image ? Math.round((MAP_W * m.image.h) / m.image.w) : DEFAULT_MAP_H)

export const POI_ID = /^[a-z0-9-]{1,40}$/

/** URL of the uploaded ground plan, versioned so it can be cached forever (and offline). */
export const mapImageUrl = (apiUrl: string | undefined, slug: string, map: MapInfo) =>
  map.image && apiUrl ? `${apiUrl}/api/festivals/${encodeURIComponent(slug)}/map-image?v=${map.image.v}` : null
