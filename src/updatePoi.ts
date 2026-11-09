// Which map point an update is about. Community reports carry a point id; the organizer types
// the place of an announcement freely ("Lagoon", "Bühne Lagoon", "Wasserstelle Nord"). We only
// link when the place names exactly one point – an ambiguous or unknown place gets no guess.
type Point = { id: string; name: string; cat: string }

const norm = (s: string) =>
  s
    .normalize('NFC')
    .toLocaleLowerCase('de')
    .replace(/[\s ]+/g, ' ')
    .trim()

// "Bühne Lagoon", "Stage Lagoon", "Lagoon Stage", "Lagoon-Bühne" all mean the stage "Lagoon"
const stageName = (s: string) => s.replace(/^(bühne|stage)\s+/, '').replace(/[\s-]+(bühne|stage)$/, '')

export function poiForUpdate<P extends Point>(u: { poi?: string; place?: string }, pois: readonly P[]): P | undefined {
  if (u.poi) {
    const own = pois.find((p) => p.id === u.poi)
    if (own) return own
  }
  if (!u.place) return undefined
  const place = norm(u.place)
  if (!place) return undefined
  const exact = pois.filter((p) => norm(p.name) === place)
  if (exact.length) return exact.length === 1 ? exact[0] : undefined
  const stage = stageName(place)
  if (stage === place) return undefined
  const stages = pois.filter((p) => p.cat === 'stage' && norm(p.name) === stage)
  return stages.length === 1 ? stages[0] : undefined
}
