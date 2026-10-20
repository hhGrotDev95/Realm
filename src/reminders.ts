/**
 * Set reminders (audit F15): 15 minutes before a set, on any festival day, in the festival's time zone.
 * Without push (no server yet), a reminder can only fire while the app is open – the app says so.
 */
export const REMINDER_LEAD_MIN = 15
/** browsers cap timers at ~24.8 days; later reminders are planned when the app opens again */
const MAX_TIMER_MS = 2 ** 31 - 1

export type ReminderAct = { id: string; artist: string; day: number; start: number; cancelled?: boolean }

/** Which reminders to arm now, and when: past, cancelled and unknown sets are skipped. */
export function reminderPlan(ids: string[], acts: (id: string) => ReminderAct | undefined, at: (day: number, min: number) => number, now: number) {
  return ids.flatMap((id) => {
    const a = acts(id)
    if (!a || a.cancelled) return []
    const when = at(a.day, a.start - REMINDER_LEAD_MIN)
    const delay = when - now
    return delay > 0 && delay <= MAX_TIMER_MS ? [{ id, artist: a.artist, start: a.start, when, delay }] : []
  })
}
