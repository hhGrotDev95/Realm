// iCalendar export of planned sets. Pure functions (no DOM) so they are unit-tested in Node.
// Times are "floating" local times: a festival happens in one place, and every calendar app
// shows a floating 20:00 as 20:00 – also for visitors whose phone is set to another zone.

export interface IcsAct {
  id: string
  artist: string
  stage: string
  /** festival day index (0 = first day) */
  day: number
  /** minutes from midnight of the festival day; may exceed 1440 for sets after midnight */
  start: number
  end: number
  genre?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 20270716T233000 for day "2027-07-16" + minute 1410; minutes past midnight roll into the next date. */
export function icsTime(date: string, minutes: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + Math.floor(minutes / 1440) * 86_400_000)
  const min = ((minutes % 1440) + 1440) % 1440
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`
}

/** RFC 5545 text escaping. */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Folds content lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let cur = ''
  let len = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur)
      cur = ''
      len = 0
    }
    cur += ch
    len += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

export function buildIcs(opts: { festival: string; slug: string; location?: string | null; days: { idx: number; date: string }[]; acts: IcsAct[]; stamp?: Date }): string {
  const stamp = (opts.stamp ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const date = new Map(opts.days.map((d) => [d.idx, d.date]))
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Realm//Festival Plan//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(opts.festival)}`]
  for (const a of opts.acts) {
    const day = date.get(a.day)
    if (!day) continue
    lines.push(
      'BEGIN:VEVENT',
      // stable per festival + act, so re-importing updates instead of duplicating
      `UID:${a.id}@${opts.slug}.realm`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsTime(day, a.start)}`,
      `DTEND:${icsTime(day, a.end)}`,
      `SUMMARY:${esc(a.artist)}`,
      `LOCATION:${esc([a.stage, opts.location].filter(Boolean).join(' · '))}`,
      ...(a.genre ? [`DESCRIPTION:${esc(`${a.genre} · ${opts.festival}`)}`] : []),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(a.artist)}`,
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
