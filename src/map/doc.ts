// The festival map: an optional site plan image plus markers. Shared by the console (to check
// before saving) and the worker (to enforce), like theme/contrast.ts.
//
// Coordinates are relative to the map width: the plan is always MAP_W units wide and
// `height` units high (height = MAP_W × image height / image width), so markers stay in
// place however the plan is scaled on screen.

export const MAP_W = 1000
export const DEFAULT_MAP_H = 940
export const MAP_H_MIN = 300
export const MAP_H_MAX = 3000
/** Characters of the data: URL (~900 kB image). The festival document is cached offline. */
export const MAP_IMAGE_MAX = 1_200_000
export const MAX_MARKERS = 300

export const POI_CATS = ['stage', 'water', 'wc', 'food', 'medical', 'bar', 'entrance', 'camping', 'info', 'shuttle'] as const
export type MapCat = (typeof POI_CATS)[number]
export const CAT_LABEL: Record<MapCat, string> = {
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
export type MapStatus = (typeof POI_STATUS)[number]

/** Stored on the festival; `terrain: 'demo'` draws the built-in demo grounds. */
export interface MapMeta {
  height: number
  image?: string
  terrain?: 'demo'
}

export interface MapMarker {
  id: string
  cat: MapCat
  name: string
  x: number
  y: number
  detail: string
  status?: MapStatus
  important: boolean
}

export const stageMarkerId = (stageId: string) => 'stage-' + stageId
const IMAGE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/
const ID = /^[a-z0-9-]{1,40}$/

export type MapCheck = { ok: true; meta: MapMeta; markers: MapMarker[] } | { ok: false; errors: string[] }

/**
 * Validates a map document. Stage markers must use the id `stage-<stageId>` of an existing
 * stage; every other marker needs a unique id. Positions must lie on the plan.
 */
export function checkMap(input: unknown, stageIds: string[]): MapCheck {
  const errors: string[] = []
  const b = (input ?? {}) as Record<string, unknown>
  const height = b.height === undefined ? DEFAULT_MAP_H : b.height
  if (typeof height !== 'number' || !Number.isFinite(height) || height < MAP_H_MIN || height > MAP_H_MAX) errors.push(`Kartenhöhe muss zwischen ${MAP_H_MIN} und ${MAP_H_MAX} liegen`)
  const h = typeof height === 'number' && Number.isFinite(height) ? Math.round(height) : DEFAULT_MAP_H
  const meta: MapMeta = { height: h }
  if (b.image !== undefined && b.image !== null) {
    if (typeof b.image !== 'string' || !IMAGE.test(b.image)) errors.push('Geländeplan muss ein PNG, WebP oder JPEG sein')
    else if (b.image.length > MAP_IMAGE_MAX) errors.push('Geländeplan ist zu groß (max. ca. 900 kB)')
    else meta.image = b.image
  }
  if (b.terrain === 'demo') meta.terrain = 'demo'

  const list = b.markers
  if (!Array.isArray(list)) return { ok: false, errors: [...errors, 'markers fehlt'] }
  if (list.length > MAX_MARKERS) errors.push(`Höchstens ${MAX_MARKERS} Orte`)
  const markers: MapMarker[] = []
  const seen = new Set<string>()
  list.slice(0, MAX_MARKERS).forEach((raw, i) => {
    const m = (raw ?? {}) as Record<string, unknown>
    const name = typeof m.name === 'string' ? m.name.trim() : ''
    const label = name ? `„${name}“` : `Ort ${i + 1}`
    const before = errors.length
    if (!name || name.length > 60) errors.push(`${label}: Name fehlt oder ist länger als 60 Zeichen`)
    const cat = m.cat as MapCat
    if (!POI_CATS.includes(cat)) errors.push(`${label}: unbekannte Kategorie`)
    const id = typeof m.id === 'string' ? m.id : ''
    if (!ID.test(id)) errors.push(`${label}: id ist ungültig`)
    else if (seen.has(id)) errors.push(`${label}: id doppelt`)
    if (cat === 'stage' && ID.test(id) && !stageIds.some((s) => stageMarkerId(s) === id)) errors.push(`${label}: gehört zu keiner Bühne`)
    if (cat !== 'stage' && id.startsWith('stage-')) errors.push(`${label}: „stage-“ ist für Bühnen reserviert`)
    const x = m.x
    const y = m.y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > MAP_W || y < 0 || y > h) errors.push(`${label}: liegt außerhalb des Plans`)
    const detail = m.detail === undefined || m.detail === null ? '' : m.detail
    if (typeof detail !== 'string' || detail.length > 120) errors.push(`${label}: Beschreibung ist länger als 120 Zeichen`)
    const status = m.status === undefined || m.status === null || m.status === '' ? undefined : m.status
    if (status !== undefined && !POI_STATUS.includes(status as MapStatus)) errors.push(`${label}: unbekannter Status`)
    seen.add(id)
    if (errors.length > before) return
    markers.push({
      id,
      cat,
      name,
      x: Math.round(x as number),
      y: Math.round(y as number),
      detail: (detail as string).trim(),
      ...(status ? { status: status as MapStatus } : {}),
      important: cat === 'stage' || !!m.important,
    })
  })
  return errors.length ? { ok: false, errors } : { ok: true, meta, markers }
}

/** Reads the stored JSON, tolerating old or broken values. */
export function parseMapMeta(raw: unknown): MapMeta {
  const m = (typeof raw === 'string' ? safeJson(raw) : raw) as Partial<MapMeta> | null
  const height = typeof m?.height === 'number' && m.height >= MAP_H_MIN && m.height <= MAP_H_MAX ? m.height : DEFAULT_MAP_H
  return { height, ...(typeof m?.image === 'string' && IMAGE.test(m.image) ? { image: m.image } : {}), ...(m?.terrain === 'demo' ? { terrain: 'demo' as const } : {}) }
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

/** Plan height for an image of the given pixel size, within the allowed range. */
export const heightForImage = (w: number, h: number) => Math.min(MAP_H_MAX, Math.max(MAP_H_MIN, Math.round((MAP_W * h) / w)))
