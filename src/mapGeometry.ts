// Shared geometry of the festival map: the visitor map, the console's map editor and the API
// all use the same coordinate space (map units on a 1000 × 940 canvas).

export const MAP_W = 1000
export const MAP_H = 940

/** Place categories an organizer can create; stages are positioned via their stage entry. */
export const PLACE_CATS = ['water', 'wc', 'food', 'medical', 'bar', 'entrance', 'camping', 'info', 'shuttle'] as const
export type PlaceCat = (typeof PLACE_CATS)[number]
export type PoiCat = 'stage' | PlaceCat

export const CAT_LABEL: Record<PoiCat, string> = {
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

export const PLACE_STATUS = ['open', 'busy', 'closed'] as const
export const MAX_PLACES = 200
