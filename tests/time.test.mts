// Runs with TZ=America/New_York (see package.json): the phone is on a different continent than the festival.
import assert from 'node:assert/strict'
import { DAY_START, festivalClock, instant, MAX_END, MAX_START, night, wall } from '../src/festivalTime.ts'

assert.equal(new Date(2027, 6, 16, 12).getTimezoneOffset(), 240, 'test must run in New York time')
const days = [{ date: '2027-07-15' }, { date: '2027-07-16' }, { date: '2027-07-17' }]
const tz = 'Europe/Berlin'
// a set at 22:30 Berlin time on day 1 is 20:30 UTC (summer time), whatever the phone's zone
assert.equal(new Date(instant('2027-07-16', 22 * 60 + 30, tz)).toISOString(), '2027-07-16T20:30:00.000Z')
// 01:30 after day 1 is minute 25:30 of day 1 and lies on the calendar day after
assert.equal(new Date(instant('2027-07-16', 25 * 60 + 30, tz)).toISOString(), '2027-07-16T23:30:00.000Z')
// the clock: 00:15 Berlin on 17 July still belongs to day 1 (minute 1455), 06:00 starts day 2
assert.deepEqual(festivalClock(new Date('2027-07-16T22:15:00Z'), days, tz), { day: 1, min: 24 * 60 + 15 })
assert.deepEqual(festivalClock(new Date('2027-07-17T04:00:00Z'), days, tz), { day: 2, min: DAY_START })
// winter time and a daylight-saving night: 02:30 on the last Sunday of March does not exist; 03:30 does
assert.equal(new Date(instant('2027-03-28', 3 * 60 + 30, tz)).toISOString(), '2027-03-28T01:30:00.000Z')
assert.equal(new Date(instant('2027-12-01', 20 * 60, tz)).toISOString(), '2027-12-01T19:00:00.000Z')
assert.deepEqual(wall(new Date('2027-07-16T20:30:00Z'), 'Europe/Lisbon'), { y: 2027, m: 7, d: 16, h: 21, min: 30 })
// one rule for night times everywhere
assert.deepEqual([night(90), night(DAY_START - 1), night(DAY_START), night(23 * 60)], [1530, 1799, 360, 1380])
assert.deepEqual([MAX_START, MAX_END], [1800, 2160])
console.log('✓ Zeitmodell: Festival-Zeitzone statt Handy, Nacht bis 06:00, Sommerzeit – 9 Prüfungen')
