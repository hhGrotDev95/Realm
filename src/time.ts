import { actById, type Act } from './data'
import { t } from './i18n'

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
  if (s === 'live') return t('Läuft noch {n} Min.', { n: a.end - now.min })
  if (a.day !== now.day) return ''
  const d = a.start - now.min
  if (d < 60) return t('In {n} Minuten', { n: d })
  return d % 60 ? t('In {h} Std. {m} Min.', { h: Math.floor(d / 60), m: d % 60 }) : t('In {h} Std.', { h: Math.floor(d / 60) })
}

export function planFor(plan: string[], day: number) {
  return plan.map((id) => actById[id]).filter((a) => a && a.day === day && !a.change?.cancelled).sort((a, b) => a.start - b.start)
}

/** Current and next planned act relative to the clock. */
export function nowNext(plan: string[], now: Clock) {
  const today = planFor(plan, now.day)
  const live = today.find((a) => status(a, now) === 'live')
  const next = today.find((a) => status(a, now) === 'upcoming')
  return { live, next }
}
