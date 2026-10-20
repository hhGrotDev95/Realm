// Which stage markers show their name on the map (audit D08). Markers keep their size on screen
// at every zoom level, so on a narrow phone a full stage label covers neighbouring points or slides
// under the map buttons. Labels that would do that shrink to the round stage icon; zooming in brings
// them back. Pure, so it can be tested without a browser.

export type Rect = { left: number; top: number; right: number; bottom: number }

export type LabelInput = {
  id: string
  /** marker centre on screen, px */
  x: number
  y: number
  /** stage label text; other markers have none and are always compact */
  label?: string
  /** placed first and never shrunk by later ones (selected marker, route target) */
  pinned?: boolean
}

/** Size of the round/compact marker on screen. */
export const COMPACT = 34
const GAP = 4

/** Width of a full stage pill: padding, colour dot, gap and 13 px bold text (generous estimate). */
export const pillWidth = (label: string) => 6 + 22 + 6 + Math.ceil(label.length * 8) + 12

const box = (x: number, y: number, w: number, h: number): Rect => ({ left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 })
const hits = (a: Rect, b: Rect) => a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP

/**
 * Returns the ids of markers that may show their full label.
 * `viewport` is the visible map area, `blocked` are floating controls (search, buttons) on top of it.
 */
export function fullLabels(markers: LabelInput[], viewport: Rect, blocked: Rect[] = []): Set<string> {
  // every marker occupies at least its compact footprint, labelled or not
  const placed: { id: string; r: Rect }[] = markers.map((m) => ({ id: m.id, r: box(m.x, m.y, COMPACT, COMPACT) }))
  const full = new Set<string>()
  const order = markers
    .filter((m) => m.label)
    // pinned first, then left to right so the result does not flicker while panning
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.x - b.x || a.y - b.y)
  for (const m of order) {
    const r = box(m.x, m.y, pillWidth(m.label!), COMPACT)
    const inside = r.left >= viewport.left && r.right <= viewport.right
    const free =
      m.pinned ||
      (inside &&
        !blocked.some((b) => hits(r, b)) &&
        !placed.some((p) => p.id !== m.id && hits(r, p.r)))
    if (!free) continue
    full.add(m.id)
    placed.find((p) => p.id === m.id)!.r = r
  }
  return full
}
