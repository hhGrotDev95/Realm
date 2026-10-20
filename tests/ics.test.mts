import assert from 'node:assert/strict'
import { buildIcs, icsTime } from '../src/calendar/ics.ts'

assert.equal(icsTime('2027-07-16', 20 * 60 + 15), '20270716T201500')
assert.equal(icsTime('2027-07-16', 24 * 60 + 90), '20270717T013000', 'sets after midnight land on the next date')
assert.equal(icsTime('2027-07-31', 25 * 60), '20270801T010000', 'month rollover')

const ics = buildIcs({
  festival: 'Realm Open Air',
  slug: 'realm-open-air',
  location: 'Lüneburger Heide',
  days: [{ idx: 1, date: '2027-07-16' }],
  acts: [
    { id: '1-maduk', artist: 'Maduk', stage: 'Generator', day: 1, start: 20 * 60 + 20, end: 21 * 60 + 50, genre: 'Liquid DnB' },
    { id: '1-x', artist: 'Semi;colon, Comma', stage: 'Archive', day: 1, start: 1410, end: 1530 },
    { id: '9-ghost', artist: 'Ghost', stage: 'Nowhere', day: 9, start: 0, end: 60 },
  ],
  stamp: new Date(Date.UTC(2027, 0, 1)),
})
assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'))
assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2, 'acts on unknown days are skipped')
assert.match(ics, /UID:1-maduk@realm-open-air\.realm\r\n/)
assert.match(ics, /DTSTART:20270716T202000\r\nDTEND:20270716T215000/)
assert.match(ics, /DTSTART:20270716T233000\r\nDTEND:20270717T013000/)
assert.match(ics, /SUMMARY:Semi\;colon\\, Comma/)
assert.match(ics, /LOCATION:Generator · Lüneburger Heide/)
assert.match(ics, /TRIGGER:-PT15M/)
assert.match(ics, /DTSTAMP:20270101T000000Z/)
for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, 'line too long: ' + line)
const long = buildIcs({ festival: 'F', slug: 's', days: [{ idx: 0, date: '2027-01-01' }], acts: [{ id: 'a', artist: 'Ä'.repeat(80), stage: 'S', day: 0, start: 0, end: 1 }] })
assert.ok(long.includes('\r\n '), 'long lines are folded')
assert.ok(long.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75))
console.log('✓ 14 Kalender-Export-Prüfungen bestanden')
