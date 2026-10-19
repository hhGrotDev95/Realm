import { actById, type Act } from './data'

export type Clock = { day: number; min: number }

export function status(a: Act, now: Clock): 'past' | 'live' | 'upcoming' {
  if (a.day < now.day) return 'past'
  if (a.day > now.day) return 'upcoming'
  if (now.min >= a.end) return 'past'
  if (now.min >= a.start) return 'live'
  return 'upcoming'
}

export function untilLabel(a: Act, now: Clock) {
  const s = status(a, now)
  if (s === 'live') return `Läuft noch ${a.end - now.min} Min.`
  if (a.day !== now.day) return ''
  const d = a.start - now.min
  if (d < 60) return `In ${d} Minuten`
  return `In ${Math.floor(d / 60)} Std. ${d % 60 ? (d % 60) + ' Min.' : ''}`.trim()
}

export function planFor(plan: string[], day: number) {
  return plan.map((id) => actById[id]).filter((a) => a && a.day === day).sort((a, b) => a.start - b.start)
}

/** Current and next planned act relative to the clock. */
export function nowNext(plan: string[], now: Clock) {
  const today = planFor(plan, now.day)
  const live = today.find((a) => status(a, now) === 'live')
  const next = today.find((a) => status(a, now) === 'upcoming')
  return { live, next }
}
