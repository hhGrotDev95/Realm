/**
 * After a cancellation or move in the console's "Live-Änderungen", the organizer can prepare an announcement
 * for everyone with one tap. The app already notifies visitors who planned the act; the announcement reaches
 * the rest (e.g. people standing at the stage). Pure: no festival globals, so it is unit-testable.
 */

export type ChangeSummary = {
  artist: string
  /** German and English weekday of the act's festival day, e.g. "Freitag" / "Friday" */
  dayDe: string
  dayEn: string
  start: number
  end: number
  stage: string
  cancelled: boolean
  /** set only when the time changed */
  newStart?: number
  newEnd?: number
  /** set only when the stage changed */
  newStage?: string
  note?: string
  /** epoch ms when the set ends – after the change if it was moved – used for the validity */
  endsAt: number
}

export type AnnouncementDraft = {
  title: string
  body: string
  titleEn: string
  bodyEn: string
  place: string
  severity: 'info' | 'warning'
  valid: string
  /** shown above the prefilled form */
  source: string
  /** the changed act; stored with the announcement so a later revert can offer to remove it */
  actId?: string
}

const TITLE_MAX = 120
const BODY_MAX = 1000
/** keep the announcement up a little after the set would have ended */
const GRACE_MIN = 30
const MAX_VALID_MIN = 7 * 24 * 60

const hhmm = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…')

/** null when nothing visitors would need an announcement for changed */
export function announcementDraft(c: ChangeSummary, now: number): AnnouncementDraft | null {
  const moved = c.newStart !== undefined && c.newEnd !== undefined && (c.newStart !== c.start || c.newEnd !== c.end)
  const restaged = !!c.newStage && c.newStage !== c.stage
  if (!c.cancelled && !moved && !restaged) return null
  const when = `${c.dayDe} ${hhmm(c.start)}`
  const whenEn = `${c.dayEn} ${hhmm(c.start)}`
  const note = c.note?.trim()
  let title: string, titleEn: string, body: string, bodyEn: string
  if (c.cancelled) {
    title = `Abgesagt: ${c.artist} (${when}, ${c.stage})`
    titleEn = `Cancelled: ${c.artist} (${whenEn}, ${c.stage})`
    body = `Der Auftritt von ${c.artist} am ${c.dayDe} um ${hhmm(c.start)} auf ${c.stage} entfällt.`
    bodyEn = `${c.artist}'s set on ${c.dayEn} at ${hhmm(c.start)} on ${c.stage} is cancelled.`
  } else {
    const at = moved ? hhmm(c.newStart!) : hhmm(c.start)
    const where = restaged ? c.newStage! : c.stage
    const parts = [moved && `jetzt ${at} statt ${hhmm(c.start)}`, restaged && `auf ${where} statt ${c.stage}`].filter(Boolean)
    const partsEn = [moved && `now ${at} instead of ${hhmm(c.start)}`, restaged && `on ${where} instead of ${c.stage}`].filter(Boolean)
    title = `Verschoben: ${c.artist} ${parts.join(', ')}`
    titleEn = `Moved: ${c.artist} ${partsEn.join(', ')}`
    body = `${c.artist} spielt am ${c.dayDe} um ${at}${moved ? `–${hhmm(c.newEnd!)}` : ''} auf ${where}.`
    bodyEn = `${c.artist} plays on ${c.dayEn} at ${at}${moved ? `–${hhmm(c.newEnd!)}` : ''} on ${where}.`
  }
  // the organizer's note is written in German; the English text leaves it out rather than mixing languages
  if (note) body += ` Grund: ${note}`
  const left = Math.ceil((c.endsAt - now) / 60_000)
  return {
    title: clip(title, TITLE_MAX),
    titleEn: clip(titleEn, TITLE_MAX),
    body: clip(body, BODY_MAX),
    bodyEn: clip(bodyEn, BODY_MAX),
    place: clip(restaged && !c.cancelled ? c.newStage! : c.stage, 60),
    // a cancellation sends people elsewhere: on top of Home for everyone; a move only in the update list
    severity: c.cancelled ? 'warning' : 'info',
    // until shortly after the set; blank (= until deleted) when it is already over or further away than the
    // API allows – a capped validity would expire before the festival even starts
    valid: left > 0 && left + GRACE_MIN <= MAX_VALID_MIN ? String(left + GRACE_MIN) : '',
    source: c.artist,
  }
}

/* ---------- editing an active announcement (backlog 5n) ---------- */

type Severity = 'info' | 'warning' | 'critical'
/** The console's announcement form; all text fields as typed, validity in minutes ('' = until removed). */
export type AnnouncementForm = { title: string; body: string; titleEn: string; bodyEn: string; place: string; severity: Severity; valid: string }
export type AnnouncementPatch = { title?: string; body?: string | null; titleEn?: string | null; bodyEn?: string | null; place?: string | null; poi?: string | null; severity?: Severity; validMin?: number | null }

/** The form prefilled from an active announcement; the validity shows the minutes left. */
export const announcementForm = (a: { title: string; body: string | null; place: string | null; severity: Severity; validMin: number | null; en?: { title: string; body: string | null } }): AnnouncementForm => ({
  title: a.title,
  body: a.body ?? '',
  titleEn: a.en?.title ?? '',
  bodyEn: a.en?.body ?? '',
  place: a.place ?? '',
  severity: a.severity,
  valid: a.validMin === null ? '' : String(a.validMin),
})

/**
 * Only what the organizer changed goes out: an untouched validity keeps its expiry instead of restarting it,
 * an untouched place keeps its map point. Cleared fields are sent as null. `poiId` is the map point the
 * (possibly new) place names, or null.
 */
export function announcementPatch(before: AnnouncementForm, after: AnnouncementForm, poiId: string | null): AnnouncementPatch {
  const p: AnnouncementPatch = {}
  const b = (k: keyof AnnouncementForm) => before[k].trim()
  const a = (k: keyof AnnouncementForm) => after[k].trim()
  if (a('title') !== b('title')) p.title = a('title')
  if (a('body') !== b('body')) p.body = a('body') || null
  if (a('titleEn') !== b('titleEn')) p.titleEn = a('titleEn') || null
  // English text only with an English title (the worker drops it otherwise)
  if (a('bodyEn') !== b('bodyEn') && a('titleEn')) p.bodyEn = a('bodyEn') || null
  if (a('place') !== b('place')) {
    p.place = a('place') || null
    p.poi = a('place') ? poiId : null
  }
  if (after.severity !== before.severity) p.severity = after.severity
  if (after.valid !== before.valid) p.validMin = after.valid ? Number(after.valid) : null
  return p
}
