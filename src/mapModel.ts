// Ground plan model shared by the app, the organizer console and the worker (one source of truth).

/** The map canvas is always this wide; the height follows the plan's aspect ratio. */
export const MAP_W = 1000
/** Height of the built-in demo terrain. */
export const DEFAULT_MAP_H = 940
export const MAP_H_MIN = 250
export const MAP_H_MAX = 4000
/** Characters of the plan's data: URL (~650 kB image). Keeps the festival document cacheable offline. */
export const MAP_IMAGE_MAX = 900_000
export const MAX_POIS = 300

/** Place categories an organizer can put on the map (stages come from the stage list). */
export const POI_CATS = ['entrance', 'info', 'medical', 'water', 'wc', 'food', 'bar', 'camping', 'shuttle'] as const
export type EditablePoiCat = (typeof POI_CATS)[number]
export const POI_CAT_LABEL: Record<EditablePoiCat, string> = {
  entrance: 'Eingang',
  info: 'Info',
  medical: 'Sanitäter',
  water: 'Wasser',
  wc: 'WC',
  food: 'Essen',
  bar: 'Bar',
  camping: 'Camping',
  shuttle: 'Shuttle',
}
export const POI_STATUS = ['open', 'busy', 'closed'] as const

export interface MapInfo {
  height: number
  /** data:image/... – absent means the built-in demo terrain */
  image?: string
}

export const IMAGE_DATA_URL = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/

/** Reads the stored JSON column defensively. */
export function parseMap(raw: unknown): MapInfo {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Partial<MapInfo>
  const height = typeof m.height === 'number' && m.height >= MAP_H_MIN && m.height <= MAP_H_MAX ? m.height : DEFAULT_MAP_H
  return typeof m.image === 'string' && IMAGE_DATA_URL.test(m.image) ? { height, image: m.image } : { height }
}
