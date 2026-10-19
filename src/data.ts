// Realm — demo dataset for "Realm Open Air 2027".
// Times are minutes after midnight of the festival day (values > 1440 = after midnight).

export type StageId = 'generator' | 'archive' | 'lagoon' | 'forest' | 'observatory'

export interface Stage {
  id: StageId
  name: string
  color: string
  x: number
  y: number
  vibe: string
}

export const STAGES: Stage[] = [
  { id: 'generator', name: 'Generator', color: '#FF6B5A', x: 520, y: 250, vibe: 'Mainstage · Bass' },
  { id: 'archive', name: 'Archive', color: '#5AC8FF', x: 250, y: 330, vibe: 'Techno · Warehouse' },
  { id: 'lagoon', name: 'Lagoon', color: '#FFC94D', x: 690, y: 520, vibe: 'House · Open Air' },
  { id: 'forest', name: 'Forest Hall', color: '#7BE0A0', x: 220, y: 620, vibe: 'Indie · Live' },
  { id: 'observatory', name: 'Observatory', color: '#E07BFF', x: 470, y: 760, vibe: 'Ambient · Late' },
]
export const stageById = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, Stage>

export interface FestivalDay {
  idx: number
  label: string
  short: string
  date: string // ISO date
}
export const DAYS: FestivalDay[] = [
  { idx: 0, label: 'Donnerstag', short: 'Do', date: '2027-07-15' },
  { idx: 1, label: 'Freitag', short: 'Fr', date: '2027-07-16' },
  { idx: 2, label: 'Samstag', short: 'Sa', date: '2027-07-17' },
]

export interface Act {
  id: string
  day: number
  stage: StageId
  artist: string
  start: number
  end: number
  genre: string
  bio: string
  popularity: number // 0..1 community tendency base
  /** set when the organizer changed the published slot */
  change?: { cancelled: boolean; moved: boolean; restaged: boolean; note: string | null; was: { start: number; end: number; stage: StageId } }
}

const T = (h: number, m = 0) => (h < 10 ? h + 24 : h) * 60 + m

type Row = [StageId, string, number, number, number, number, string]
// [stage, artist, startH, startM, endH, endM, genre]
const LINEUP: Row[][] = [
  [
    ['generator', 'Halcyon Drift', 16, 0, 17, 0, 'Melodic Bass'],
    ['generator', 'Kobalt Youth', 17, 30, 18, 45, 'Drum & Bass'],
    ['generator', 'Neon Saint', 19, 15, 20, 30, 'Future Garage'],
    ['generator', 'ORRA', 21, 0, 22, 30, 'Bass'],
    ['generator', 'Marlowe Twins', 23, 0, 0, 30, 'Big Room'],
    ['archive', 'Ferroglyph', 18, 0, 19, 30, 'Techno'],
    ['archive', 'Dana Velk', 19, 30, 21, 0, 'Hard Techno'],
    ['archive', 'Systema', 21, 0, 23, 0, 'Industrial'],
    ['archive', 'Unit 47', 23, 0, 1, 30, 'Acid'],
    ['lagoon', 'Sol Arcadia', 15, 0, 16, 30, 'Balearic'],
    ['lagoon', 'Pila & Moss', 16, 30, 18, 0, 'Deep House'],
    ['lagoon', 'Juno Reyes', 19, 45, 21, 15, 'Afro House'],
    ['lagoon', 'Coastline', 21, 15, 22, 45, 'Disco'],
    ['forest', 'The Paper Lanterns', 17, 0, 18, 0, 'Indie Folk'],
    ['forest', 'Velvet Static', 18, 30, 19, 30, 'Shoegaze'],
    ['forest', 'Mira Lindqvist', 20, 0, 21, 15, 'Art Pop'],
    ['forest', 'Ghost Orchard', 21, 45, 23, 0, 'Post-Rock'],
    ['observatory', 'Lumen Choir', 22, 0, 23, 30, 'Ambient'],
    ['observatory', 'Night Cartography', 23, 30, 1, 30, 'Downtempo'],
  ],
  [
    ['generator', 'Tessellate', 16, 0, 17, 15, 'Electronica'],
    ['generator', 'Ruby Kade', 17, 45, 19, 0, 'UK Bass'],
    ['generator', 'Maduk', 20, 20, 21, 50, 'Liquid DnB'],
    ['generator', 'Arcturus', 22, 15, 23, 45, 'Melodic Techno'],
    ['generator', 'Paragon Nine', 0, 15, 1, 45, 'Hardstyle'],
    ['archive', 'Kessel', 17, 0, 18, 30, 'Minimal'],
    ['archive', 'Ilka Frost', 18, 30, 20, 0, 'Techno'],
    ['archive', 'Hollow Engine', 20, 0, 21, 30, 'Hard Techno'],
    ['archive', 'Rave Archaeology', 21, 30, 23, 30, 'Trance Classics'],
    ['archive', 'Black Meridian', 23, 30, 2, 0, 'Techno'],
    ['lagoon', 'Palmar', 15, 30, 17, 0, 'Organic House'],
    ['lagoon', 'Nia Okafor', 17, 0, 18, 30, 'Amapiano'],
    ['lagoon', 'Satellite Lovers', 19, 30, 20, 45, 'Nu Disco'],
    ['lagoon', 'Golden Hour Club', 20, 45, 22, 15, 'House'],
    ['forest', 'Wildermuth', 16, 30, 17, 30, 'Indie Rock'],
    ['forest', 'Cassia Bloom', 18, 0, 19, 0, 'Dream Pop'],
    ['forest', 'The Lowlights', 19, 30, 20, 50, 'Alt Rock'],
    ['forest', 'Fjordlight', 21, 15, 22, 30, 'Neo-Folk'],
    ['observatory', 'Tidal Archive', 21, 0, 22, 30, 'Ambient'],
    ['observatory', 'Somna', 22, 30, 0, 0, 'Downtempo'],
    ['observatory', 'Polaris Drift', 0, 0, 2, 0, 'Deep Ambient'],
  ],
  [
    ['generator', 'Brightside Collective', 15, 0, 16, 15, 'Funk'],
    ['generator', 'Echo Vandal', 16, 45, 18, 0, 'Breakbeat'],
    ['generator', 'Saphira', 18, 30, 19, 45, 'Pop'],
    ['generator', 'Heliograph', 20, 15, 21, 45, 'Electro'],
    ['generator', 'KAIRO', 22, 15, 0, 0, 'Headliner · Bass'],
    ['archive', 'Monolith Club', 17, 0, 18, 30, 'Techno'],
    ['archive', 'Vera Strand', 18, 30, 20, 0, 'Hypnotic Techno'],
    ['archive', 'Grid Theory', 20, 0, 22, 0, 'Peak Time'],
    ['archive', 'Afterimage', 22, 0, 1, 0, 'Techno'],
    ['lagoon', 'Marea', 16, 0, 17, 30, 'Latin House'],
    ['lagoon', 'Cosmo Sinclair', 17, 30, 19, 0, 'Disco'],
    ['lagoon', 'Ola & The Tides', 19, 0, 20, 30, 'Afrobeat'],
    ['lagoon', 'Sunset Protocol', 20, 30, 22, 0, 'Melodic House'],
    ['forest', 'Paper Planets', 17, 0, 18, 0, 'Indie'],
    ['forest', 'Oskar & The Owls', 18, 30, 19, 45, 'Folk Rock'],
    ['forest', 'Linnea Vale', 20, 0, 21, 15, 'Singer-Songwriter'],
    ['forest', 'Northern Arcs', 21, 30, 23, 0, 'Post-Punk'],
    ['observatory', 'Soft Machines', 21, 30, 23, 0, 'Ambient Techno'],
    ['observatory', 'Last Light', 0, 0, 2, 0, 'Closing Ambient'],
  ],
]

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

const BIOS = [
  'Bekannt für Sets, die langsam aufbauen und dann nicht mehr loslassen.',
  'Live-Show mit eigener Lichtinstallation – früh da sein lohnt sich.',
  'Erstes Festival-Set seit zwei Jahren. Neues Album im Gepäck.',
  'Crowd-Favorit der letzten Ausgabe, damals mit Zugabe um 2 Uhr.',
  'Spielt ausschließlich Vinyl. Kein Set gleicht dem anderen.',
  'Hybrid-Set aus Synthesizern, Drums und Stimme.',
]

export const ACTS: Act[] = LINEUP.flatMap((rows, day) =>
  rows.map(([stage, artist, sh, sm, eh, em, genre]) => {
    const id = `${day}-${artist.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    const r = hash(id)
    return {
      id,
      day,
      stage,
      artist,
      start: T(sh, sm),
      end: T(eh, em),
      genre,
      bio: BIOS[Math.floor(r * BIOS.length)],
      popularity: 0.25 + r * 0.75,
    }
  }),
).sort((a, b) => a.day - b.day || a.start - b.start)

export const actById = Object.fromEntries(ACTS.map((a) => [a.id, a])) as Record<string, Act>

export interface Friend {
  id: string
  name: string
  color: string
  at: StageId | 'camp' | null // last shared location
  seen: number // minutes ago
  steps: number
}

export const FRIENDS: Friend[] = [
  { id: 'f1', name: 'Lea', color: '#FF8A65', at: 'generator', seen: 2, steps: 14210 },
  { id: 'f2', name: 'Jonas', color: '#4FC3F7', at: 'generator', seen: 4, steps: 11980 },
  { id: 'f3', name: 'Mara', color: '#FFD54F', at: 'generator', seen: 1, steps: 16502 },
  { id: 'f4', name: 'Tim', color: '#81C784', at: 'archive', seen: 6, steps: 9120 },
  { id: 'f5', name: 'Selin', color: '#BA68C8', at: 'archive', seen: 3, steps: 12733 },
  { id: 'f6', name: 'Noah', color: '#F06292', at: 'generator', seen: 9, steps: 8045 },
  { id: 'f7', name: 'Ida', color: '#4DB6AC', at: 'lagoon', seen: 12, steps: 10388 },
  { id: 'f8', name: 'Ben', color: '#9575CD', at: 'archive', seen: 5, steps: 13377 },
  { id: 'f9', name: 'Zoe', color: '#E57373', at: null, seen: 0, steps: 7701 },
]
export const friendById = Object.fromEntries(FRIENDS.map((f) => [f.id, f])) as Record<string, Friend>

/** Deterministic: which friends plan to see an act. */
export function friendsFor(actId: string): string[] {
  const a = actById[actId]
  return FRIENDS.filter((f) => hash(f.id + actId) < 0.1 + a.popularity * 0.6).map((f) => f.id)
}

export type PoiCat = 'stage' | 'water' | 'wc' | 'food' | 'medical' | 'bar' | 'entrance' | 'camping' | 'info' | 'shuttle'

export interface Poi {
  id: string
  cat: PoiCat
  name: string
  x: number
  y: number
  detail: string
  status?: 'open' | 'busy' | 'closed'
  confirmedMin?: number
  important?: boolean
}

export const POIS: Poi[] = [
  ...STAGES.map((s) => ({ id: 'stage-' + s.id, cat: 'stage' as const, name: s.name, x: s.x, y: s.y, detail: s.vibe, important: true })),
  { id: 'w1', cat: 'water', name: 'Wasserstelle Nord', x: 400, y: 200, detail: 'Trinkwasser · kostenlos', status: 'open', confirmedMin: 6, important: true },
  { id: 'w2', cat: 'water', name: 'Wasserstelle Lagoon', x: 610, y: 600, detail: 'Trinkwasser · kostenlos', status: 'closed', confirmedMin: 14, important: true },
  { id: 'w3', cat: 'water', name: 'Wasserstelle Forest', x: 320, y: 560, detail: 'Trinkwasser · kostenlos', status: 'open', confirmedMin: 22, important: true },
  { id: 'wc1', cat: 'wc', name: 'WC Generator', x: 640, y: 330, detail: 'inkl. barrierefrei', status: 'busy', confirmedMin: 4, important: true },
  { id: 'wc2', cat: 'wc', name: 'WC Archive', x: 150, y: 420, detail: 'Spülkabinen', status: 'open', confirmedMin: 11, important: true },
  { id: 'wc3', cat: 'wc', name: 'WC Observatory', x: 590, y: 760, detail: 'Komposttoiletten', status: 'open', confirmedMin: 31 },
  { id: 'fd1', cat: 'food', name: 'Food Court', x: 420, y: 470, detail: 'Burger, Bowls, Vegan, Crêpes', status: 'busy', confirmedMin: 3, important: true },
  { id: 'fd2', cat: 'food', name: 'Lagoon Kitchen', x: 790, y: 440, detail: 'Tacos & Mango-Lassi', status: 'open', confirmedMin: 18 },
  { id: 'b1', cat: 'bar', name: 'Red Bull Bar', x: 370, y: 380, detail: 'Getränke · Kartenzahlung', status: 'open', confirmedMin: 8 },
  { id: 'b2', cat: 'bar', name: 'Archive Bar', x: 120, y: 290, detail: 'Getränke · Pfand-Rückgabe', status: 'open', confirmedMin: 25 },
  { id: 'md1', cat: 'medical', name: 'Sanitätszelt', x: 470, y: 600, detail: 'Rund um die Uhr besetzt · Notruf 112', status: 'open', important: true },
  { id: 'en1', cat: 'entrance', name: 'Eingang Nord', x: 470, y: 70, detail: 'Tickets & Bändchen', status: 'busy', confirmedMin: 7, important: true },
  { id: 'en2', cat: 'entrance', name: 'Eingang Süd', x: 280, y: 860, detail: 'Nur mit Bändchen', status: 'open', confirmedMin: 19 },
  { id: 'cp1', cat: 'camping', name: 'Camping B', x: 820, y: 140, detail: 'Dein Zeltplatz · Reihe 14', important: true },
  { id: 'in1', cat: 'info', name: 'Info & Lost and Found', x: 560, y: 140, detail: 'Fundsachen, Akku-Verleih, Awareness', status: 'open', important: true },
  { id: 'sh1', cat: 'shuttle', name: 'Shuttle-Terminal', x: 860, y: 860, detail: 'Bahnhof · alle 15 Min.', status: 'open', important: true },
]

/** Your simulated position on the grounds. */
export const ME = { x: 440, y: 420 }

export function walkMinutes(ax: number, ay: number, bx: number, by: number) {
  return Math.max(1, Math.round(Math.hypot(ax - bx, ay - by) / 38))
}

export type UpdateSource = 'official' | 'confirmed' | 'unconfirmed' | 'app'

export interface FestivalUpdate {
  id: string
  source: UpdateSource
  title: string
  body?: string
  place?: string
  poi?: string
  ageMin: number
  validMin?: number // remaining validity
  severity: 'info' | 'warning' | 'critical'
  confirms?: number
  phases: Phase[]
}

export type Phase = 'before' | 'arrival' | 'during' | 'departure' | 'after'

export const UPDATES: FestivalUpdate[] = [
  { id: 'u1', source: 'official', severity: 'warning', title: 'Gewitterwarnung ab 22:30', body: 'Bei Blitzschlag werden die Open-Air-Bühnen kurz pausiert. Folge den Hinweisen des Personals.', place: 'Gesamtes Gelände', ageMin: 9, validMin: 180, phases: ['during'] },
  { id: 'u2', source: 'confirmed', severity: 'info', title: 'Wasserstelle Lagoon leer', place: 'Lagoon', poi: 'w2', ageMin: 14, validMin: 46, confirms: 12, phases: ['during'] },
  { id: 'u3', source: 'unconfirmed', severity: 'info', title: 'Nord-Eingang ca. 25 Min. Wartezeit', place: 'Eingang Nord', poi: 'en1', ageMin: 7, validMin: 23, confirms: 2, phases: ['during', 'arrival'] },
  { id: 'u4', source: 'official', severity: 'info', title: 'Arcturus startet 15 Minuten später', body: 'Neue Startzeit: 22:30 Uhr auf der Generator Stage.', place: 'Generator', ageMin: 32, phases: ['during'] },
  { id: 'u5', source: 'app', severity: 'info', title: 'Offline-Modus aktiv', body: 'Timetable, Karte und dein Plan funktionieren auch ohne Netz.', ageMin: 120, phases: ['before', 'arrival', 'during'] },
  { id: 'u6', source: 'official', severity: 'info', title: 'Shuttle-Takt erhöht auf 10 Minuten', place: 'Shuttle-Terminal', poi: 'sh1', ageMin: 40, phases: ['arrival', 'departure'] },
  { id: 'u7', source: 'official', severity: 'info', title: 'Timetable ist final', body: 'Zwei Änderungen seit deinem letzten Besuch: Somna und Fjordlight haben getauscht.', ageMin: 60 * 26, phases: ['before'] },
  { id: 'u8', source: 'confirmed', severity: 'warning', title: 'Stau auf der A7 Richtung Hamburg', place: 'Abreise', ageMin: 18, validMin: 60, confirms: 31, phases: ['departure'] },
  { id: 'u9', source: 'official', severity: 'info', title: 'Lost & Found bis Montag 14 Uhr geöffnet', place: 'Info-Zelt', poi: 'in1', ageMin: 90, phases: ['departure', 'after'] },
]

export interface ChatMsg {
  id: string
  from: string // friend id or 'me'
  text: string
  min: number // minute of day
  pending?: boolean // queued offline, not yet on the server
  at?: number // server timestamp (live mode)
}

export const CHAT: ChatMsg[] = [
  { id: 'c1', from: 'f3', text: 'Wer ist bei Maduk dabei? 🔥', min: T(19, 12) },
  { id: 'c2', from: 'f1', text: 'Ich! Sind gerade am Generator, links vom FOH', min: T(19, 14) },
  { id: 'c3', from: 'f4', text: 'Selin und ich bleiben noch bei Ilka Frost im Archive', min: T(19, 21) },
  { id: 'c4', from: 'f2', text: 'Treffen wir uns 20:10 am Archive-Eingang und laufen zusammen rüber?', min: T(19, 33) },
  { id: 'c5', from: 'f5', text: 'Klingt gut 👍', min: T(19, 35) },
]

export const PHASES: { id: Phase; label: string; hint: string }[] = [
  { id: 'before', label: 'Vorher', hint: '9 Tage bis zum Festival' },
  { id: 'arrival', label: 'Anreise', hint: 'Donnerstag, 11:40' },
  { id: 'during', label: 'Festival', hint: 'Freitag, 19:52' },
  { id: 'departure', label: 'Abreise', hint: 'Sonntag, 11:15' },
  { id: 'after', label: 'Danach', hint: 'Eine Woche später' },
]

/** Simulated clock per phase: [day index, minute of day]. */
export const PHASE_CLOCK: Record<Phase, { day: number; min: number }> = {
  before: { day: -9, min: T(18, 0) },
  arrival: { day: 0, min: T(11, 40) },
  during: { day: 1, min: T(19, 52) },
  departure: { day: 3, min: T(11, 15) },
  after: { day: 10, min: T(12, 0) },
}

export function fmt(min: number) {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Doors open on day 0 at 10:00 local time. */
export const FESTIVAL_START = new Date(2027, 6, 15, 10, 0)
const DAY_MS = 86_400_000

/**
 * Real-time clock. A festival day runs from 06:00 to 06:00, so a set at 01:30
 * still belongs to the previous day (minute 1530), matching the timetable.
 */
export function realClock(date = new Date()): { phase: Phase; day: number; min: number; msToStart: number } {
  const shifted = new Date(date.getTime() - 6 * 3_600_000)
  const day0 = new Date(FESTIVAL_START.getFullYear(), FESTIVAL_START.getMonth(), FESTIVAL_START.getDate())
  const today = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate())
  const day = Math.round((today.getTime() - day0.getTime()) / DAY_MS)
  const min = shifted.getHours() * 60 + shifted.getMinutes() + 360
  const msToStart = FESTIVAL_START.getTime() - date.getTime()
  const phase: Phase = day < 0 ? 'before' : day === 0 && min < 14 * 60 ? (msToStart > 0 ? 'before' : 'arrival') : day <= 2 ? 'during' : day <= 3 ? 'departure' : 'after'
  return { phase, day, min, msToStart }
}

/** Countdown shown in the "before" phase of the demo. */
export const DEMO_MS_TO_START = ((9 * 24 + 14) * 60 + 22) * 60_000

export interface TimetableChange {
  actId: string
  start: number | null
  end: number | null
  stage: StageId | null
  cancelled: boolean
  note: string | null
}

/** Demo stand-in for the organizer's timetable changes (matches the demo notice "Arcturus +15 Min."). */
export const DEMO_CHANGES: TimetableChange[] = [{ actId: '1-arcturus', start: 22 * 60 + 30, end: 24 * 60, stage: null, cancelled: false, note: 'Technischer Umbau' }]

const ORIGINAL = new Map(ACTS.map((a) => [a.id, { start: a.start, end: a.end, stage: a.stage }]))
let applied = ''

/**
 * Applies organizer changes to the shared ACTS objects in place, so every screen
 * (lists, timeline, conflicts, map sheets) sees the same, current timetable.
 * Idempotent; passing an empty list restores the published timetable.
 */
export function applyTimetableChanges(changes: TimetableChange[]) {
  const key = JSON.stringify(changes)
  if (key === applied) return
  applied = key
  const byId = new Map(changes.map((c) => [c.actId, c]))
  for (const a of ACTS) {
    const was = ORIGINAL.get(a.id)!
    const c = byId.get(a.id)
    a.start = c?.start ?? was.start
    a.end = c?.end ?? was.end
    a.stage = c?.stage ?? was.stage
    a.change = c
      ? { cancelled: c.cancelled, moved: c.start !== null && c.start !== was.start, restaged: c.stage !== null && c.stage !== was.stage, note: c.note, was }
      : undefined
  }
  ACTS.sort((x, y) => x.day - y.day || x.start - y.start)
}
