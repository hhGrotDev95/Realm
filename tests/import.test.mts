// Unit tests for the timetable import parser (node --experimental-strip-types).
import assert from 'node:assert/strict'
import { readSheet } from 'read-excel-file/node'
import writeXlsxFile from 'write-excel-file/node'
import { parseCsv, parseJson, parseTable, parseTime, resolveDay, type DayInfo } from '../src/import/parse.ts'

const DAYS: DayInfo[] = [
  { idx: 0, date: '2027-07-15', label: 'Donnerstag' },
  { idx: 1, date: '2027-07-16', label: 'Freitag' },
  { idx: 2, date: '2027-07-17', label: 'Samstag' },
]
let n = 0
const test = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  n++
  console.log('✓', name)
}

await test('times: formats, night hours and spreadsheet fractions', () => {
  assert.equal(parseTime('22:15'), 1335)
  assert.equal(parseTime('22.15'), 1335)
  assert.equal(parseTime('2215'), 1335)
  assert.equal(parseTime('22 Uhr'), 1320)
  assert.equal(parseTime('24:30'), 1470)
  assert.equal(parseTime(0.9375), 1350)
  assert.equal(parseTime(new Date(Date.UTC(1899, 11, 30, 23, 45))), 1425)
  assert.equal(parseTime('25:99'), null)
  assert.equal(parseTime('abends'), null)
})

await test('days: number, date (ISO and German), weekday DE/EN, label', () => {
  assert.equal(resolveDay(2, null, DAYS), 1)
  assert.equal(resolveDay('Tag 3', null, DAYS), 2)
  assert.equal(resolveDay(null, '2027-07-16', DAYS), 1)
  assert.equal(resolveDay(null, '17.07.2027', DAYS), 2)
  assert.equal(resolveDay('16.7.', null, DAYS), 1)
  assert.equal(resolveDay('Fr', null, DAYS), 1)
  assert.equal(resolveDay('saturday', null, DAYS), 2)
  assert.equal(resolveDay('Donnerstag', null, DAYS), 0)
  assert.equal(resolveDay('Montag', null, DAYS), null)
  assert.equal(resolveDay(7, null, DAYS), null)
})

await test('German CSV with semicolons, quotes, BOM and night times', () => {
  const csv = '﻿Künstler;Bühne;Tag;Beginn;Ende;Genre\n"Neon Saint";Generator;Freitag;23:00;00:30;"Bass; Garage"\nUnit 47;Archive;Fr;24:30;02:00;Acid\n'
  const r = parseTable(parseCsv(csv), DAYS)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.rows, [
    { row: 2, id: undefined, day: 1, stage: 'Generator', artist: 'Neon Saint', start: 1380, end: 1470, genre: 'Bass; Garage', bio: undefined },
    { row: 3, id: undefined, day: 1, stage: 'Archive', artist: 'Unit 47', start: 1470, end: 1560, genre: 'Acid', bio: undefined },
  ])
  assert.equal(r.columns.artist, 'Künstler')
})

await test('English CSV with a combined time column and date', () => {
  const csv = 'Artist,Stage,Date,Time\nKAIRO,Mainstage,2027-07-17,22:15 - 00:00\n'
  const r = parseTable(parseCsv(csv), DAYS)
  assert.deepEqual(r.errors, [])
  assert.equal(r.rows[0].day, 2)
  assert.equal(r.rows[0].start, 1335)
  assert.equal(r.rows[0].end, 1440)
})

await test('missing values and bad cells are reported with row numbers', () => {
  const csv = 'Act,Bühne,Tag,Beginn,Ende\nOhne Ende,Lagoon,1,20:00,\n,Lagoon,1,21:00,22:00\nKeine Bühne,,1,21:00,22:00\nFalscher Tag,Lagoon,Montag,21:00,22:00\nKaputt,Lagoon,1,abends,22:00\n'
  const r = parseTable(parseCsv(csv), DAYS)
  assert.deepEqual(r.warnings, [{ row: 2, message: 'Ohne Ende: Ende fehlt – 60 Minuten angenommen' }])
  assert.deepEqual(
    r.errors.map((e) => e.row),
    [3, 4, 5, 6],
  )
  assert.match(r.errors[2].message, /Montag.*passt zu keinem Festivaltag/)
  assert.match(r.errors[3].message, /„abends“ ist keine Uhrzeit/)
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].end, 1260)
})

await test('missing required columns are named', () => {
  const r = parseTable(parseCsv('Name;Uhrzeit\nX;20:00\n'), DAYS)
  assert.equal(r.rows.length, 0)
  assert.ok(r.errors.some((e) => /Bühne/.test(e.message)))
  assert.ok(r.errors.some((e) => /Tag/.test(e.message)))
})

await test('JSON: array or { acts }, numbered entries, explicit ids kept', () => {
  const r = parseJson(JSON.stringify({ acts: [{ id: '1-maduk', artist: 'Maduk', stage: 'Generator', day: 2, start: '20:20', end: '21:50' }, { artist: 'Kein Tag', stage: 'X', start: '20:00' }] }), DAYS)
  assert.equal(r.rows[0].id, '1-maduk')
  assert.equal(r.rows[0].row, 1)
  assert.deepEqual(r.errors, [{ row: 2, message: 'Kein Tag: Tag fehlt' }])
  assert.match(parseJson('{kaputt', DAYS).errors[0].message, /Ungültiges JSON/)
})

await test('XLSX with real time cells and a date column', async () => {
  const header = ['Act', 'Bühne', 'Datum', 'Beginn', 'Ende'].map((value) => ({ value }))
  const row = [
    { value: 'Satellite Lovers' },
    { value: 'Lagoon' },
    { value: new Date(Date.UTC(2027, 6, 16)), type: Date, format: 'dd.mm.yyyy' },
    { value: 19.5 / 24, type: Number, format: 'hh:mm' },
    { value: 20.75 / 24, type: Number, format: 'hh:mm' },
  ]
  const buf = await writeXlsxFile([header, row]).toBuffer()
  const sheet = await readSheet(buf)
  const r = parseTable(sheet as never, DAYS)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(
    { day: r.rows[0].day, start: r.rows[0].start, end: r.rows[0].end, row: r.rows[0].row },
    { day: 1, start: 1170, end: 1245, row: 2 },
  )
})

console.log(`\n${n} Import-Parser-Tests bestanden`)
