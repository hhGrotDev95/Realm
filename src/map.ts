// The festival grounds: coordinate system and marker rules. Shared by app, console and worker.
//
// Coordinates are relative to the map: x runs from 0 to MAP_W (1000 = full width), y from 0 to the
// map's height in the same units (height = MAP_W × plan height / plan width). Markers therefore stay
// on the same spot of the plan whatever size it is shown at, and a replaced plan with another
// aspect ratio keeps them in place (the worker rescales y).

export const MAP_W = 1000
/** Height of the built-in demo grounds. */
export const DEFAULT_MAP_H = 940
export const MAP_H_MIN = 300
export const MAP_H_MAX = 3000
/** Characters of the plan's data: URL (~1.1 MB image). D1 allows 2 MB per value. */
export const PLAN_MAX = 1_500_000
export const POI_MAX = 300

export const POI_CATS = {
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
} as const
export type PoiCat = keyof typeof POI_CATS
/** Categories the organizer places freely; stage markers come from the stage list. */
export const PLACEABLE_CATS = (Object.keys(POI_CATS) as PoiCat[]).filter((c) => c !== 'stage')

export const POI_STATUS = { open: 'Offen', busy: 'Voll', closed: 'Geschlossen' } as const
export type PoiStatus = keyof typeof POI_STATUS

/** What the festival document says about the map. `plan` is the id of the uploaded plan image. */
export interface MapInfo {
  w: number
  h: number
  plan: string | null
  /** 'demo' draws the built-in demo grounds, 'plain' a neutral area (festival without a plan). */
  terrain: 'demo' | 'plain'
}

export const mapHeight = (imgW: number, imgH: number) => Math.min(MAP_H_MAX, Math.max(MAP_H_MIN, Math.round((MAP_W * imgH) / imgW)))

export const PLAN_TYPES = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=]+)$/

export interface PoiInput {
  id?: unknown
  cat?: unknown
  name?: unknown
  detail?: unknown
  status?: unknown
  important?: unknown
  x?: unknown
  y?: unknown
}
export interface CleanPoi {
  id: string
  cat: Exclude<PoiCat, 'stage'>
  name: string
  detail: string
  status: PoiStatus | null
  important: boolean
  x: number
  y: number
}

const inRange = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max

/** Checks one coordinate pair; returns it rounded to one decimal or an error text. */
export function checkPos(x: unknown, y: unknown, h: number): { x: number; y: number } | string {
  if (!inRange(x, MAP_W) || !inRange(y, h)) return 'Position liegt außerhalb der Karte'
  return { x: Math.round((x as number) * 10) / 10, y: Math.round((y as number) * 10) / 10 }
}

/**
 * Validates the organizer's marker list. Returns the cleaned list or the first problem per
 * marker (numbered like the console list), so console and worker report the same thing.
 */
export function validatePois(list: unknown, h: number): { ok: true; pois: CleanPoi[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(list)) return { ok: false, errors: ['pois muss eine Liste sein'] }
  if (list.length > POI_MAX) return { ok: false, errors: [`Höchstens ${POI_MAX} Punkte`] }
  const errors: string[] = []
  const pois: CleanPoi[] = []
  const ids = new Set<string>()
  list.forEach((raw, i) => {
    const p = (raw ?? {}) as PoiInput
    const label = `Punkt ${i + 1}`
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (name.length < 1 || name.length > 40) return errors.push(`${label}: Name muss 1–40 Zeichen lang sein`)
    const at = `${label} („${name}“)`
    if (typeof p.cat !== 'string' || !(PLACEABLE_CATS as string[]).includes(p.cat)) return errors.push(`${at}: Kategorie ist ungültig`)
    const detail = p.detail === undefined || p.detail === null ? '' : typeof p.detail === 'string' ? p.detail.trim() : null
    if (detail === null || detail.length > 80) return errors.push(`${at}: Beschreibung darf höchstens 80 Zeichen haben`)
    if (p.status !== undefined && p.status !== null && !(typeof p.status === 'string' && p.status in POI_STATUS)) return errors.push(`${at}: Status ist ungültig`)
    if (p.important !== undefined && typeof p.important !== 'boolean') return errors.push(`${at}: important muss true/false sein`)
    const id = p.id === undefined || p.id === null || p.id === '' ? `p-${i + 1}` : p.id
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id) || id.startsWith('stage-')) return errors.push(`${at}: id ist ungültig`)
    if (ids.has(id)) return errors.push(`${at}: id „${id}“ ist doppelt`)
    ids.add(id)
    const pos = checkPos(p.x, p.y, h)
    if (typeof pos === 'string') return errors.push(`${at}: ${pos}`)
    pois.push({ id, cat: p.cat as CleanPoi['cat'], name, detail, status: (p.status as PoiStatus | null | undefined) ?? null, important: p.important === true, ...pos })
  })
  return errors.length ? { ok: false, errors } : { ok: true, pois }
}

/** A fresh id for a new marker that does not clash with the existing ones. */
export function newPoiId(cat: string, taken: Iterable<string>) {
  const used = new Set(taken)
  for (let i = 1; ; i++) if (!used.has(`${cat}-${i}`)) return `${cat}-${i}`
}
