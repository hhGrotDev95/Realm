// Runs with TZ=America/New_York: the phone is not in the festival's time zone.
import assert from 'node:assert/strict'
import { instant } from '../src/festivalTime.ts'
import { reminderPlan } from '../src/reminders.ts'

const days = ['2027-07-15', '2027-07-16', '2027-07-17']
const at = (day: number, min: number) => instant(days[day], min, 'Europe/Berlin')
const acts: Record<string, { id: string; artist: string; day: number; start: number; cancelled?: boolean }> = {
  today: { id: 'today', artist: 'Heute', day: 1, start: 22 * 60 },
  night: { id: 'night', artist: 'Nacht', day: 1, start: 25 * 60 + 30 },
  later: { id: 'later', artist: 'Übermorgen', day: 2, start: 20 * 60 },
  gone: { id: 'gone', artist: 'Abgesagt', day: 2, start: 21 * 60, cancelled: true },
  past: { id: 'past', artist: 'Vorbei', day: 0, start: 20 * 60 },
}
const now = Date.parse('2027-07-16T19:30:00Z') // 21:30 in Berlin, 15:30 on the phone
const plan = reminderPlan(Object.keys(acts), (id) => acts[id], at, now)
// sets on other days are reminded too (before: only the current day); cancelled and past ones are not
assert.deepEqual(plan.map((r) => r.id), ['today', 'night', 'later'])
// 15 minutes before, in festival time: 21:45 Berlin = 19:45 UTC, i.e. in 15 minutes
assert.equal(plan[0].delay, 15 * 60_000)
assert.equal(new Date(plan[1].when).toISOString(), '2027-07-16T23:15:00.000Z', '01:30 set → 01:15 Berlin')
// a set that moved (live change) is planned at its new time
acts.today.start = 22 * 60 + 30
assert.equal(reminderPlan(['today'], (id) => acts[id], at, now)[0].delay, 45 * 60_000)
// within the last 15 minutes: nothing to arm
assert.deepEqual(reminderPlan(['today'], (id) => acts[id], at, now + 46 * 60_000), [])
console.log('✓ Erinnerungen: alle Festivaltage, Festival-Zeitzone, Absagen und Verschiebungen – 5 Prüfungen')
