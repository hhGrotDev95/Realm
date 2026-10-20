import { DAYS, FESTIVAL, stageById, type Act } from '../data'
import { buildIcs } from './ics'

/** Saves the given sets as an .ics file; phones offer to add them to the calendar. */
export function downloadIcs(acts: Act[], name = FESTIVAL.name) {
  const ics = buildIcs({
    festival: FESTIVAL.name,
    slug: FESTIVAL.slug,
    location: FESTIVAL.location,
    days: DAYS,
    acts: acts.map((a) => ({ id: a.id, artist: a.artist, stage: stageById[a.stage]?.name ?? '', day: a.day, start: a.start, end: a.end, genre: a.genre })),
  })
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'plan'}.ics`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
