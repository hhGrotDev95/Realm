/**
 * The festival's time model (audit F15), shared by app, console and worker.
 *
 * - Times are wall-clock times **at the festival** (its time zone), never the phone's.
 * - A festival day runs from 06:00 to 06:00: a set at 01:30 belongs to the evening before and is
 *   stored as minute 1530 ("25:30"). Sets start before 06:00 the next morning and end by 12:00.
 */
export const DEFAULT_TZ = 'Europe/Berlin'
/** minutes after midnight when a new festival day begins */
export const DAY_START = 6 * 60
/** latest start: 06:00 the next morning (30:00) */
export const MAX_START = 24 * 60 + DAY_START
/** latest end: 12:00 the next morning (36:00) */
export const MAX_END = 36 * 60

/** Early-morning times belong to the night of the previous festival day (01:30 → 25:30). */
export const night = (min: number) => (min < DAY_START ? min + 1440 : min)

export function validTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
/** Wall-clock date and time of an instant in a time zone. */
export function wall(date: Date, tz: string) {
  let f = fmtCache.get(tz)
  if (!f) fmtCache.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })))
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute }
}

/** The instant (epoch ms) when the festival's clock shows the given wall time; minutes may run past 24:00. */
export function instant(date: string, minute: number, tz: string) {
  const [y, m, d] = date.split('-').map(Number)
  const target = Date.UTC(y, m - 1, d, 0, minute)
  let guess = target
  // two rounds settle the zone offset, also across a daylight-saving change
  for (let i = 0; i < 2; i++) {
    const w = wall(new Date(guess), tz)
    guess += target - Date.UTC(w.y, w.m - 1, w.d, w.h, w.min)
  }
  return guess
}

/** Festival day index and minute (06:00-based) for an instant, given the festival days and time zone. */
export function festivalClock(now: Date, days: { date: string }[], tz: string) {
  const w = wall(new Date(now.getTime()), tz)
  const today = Date.UTC(w.y, w.m - 1, w.d)
  const [y, m, d] = days[0].date.split('-').map(Number)
  let day = Math.round((today - Date.UTC(y, m - 1, d)) / 86_400_000)
  let min = w.h * 60 + w.min
  if (min < DAY_START) {
    day -= 1
    min += 1440
  }
  return { day, min }
}
