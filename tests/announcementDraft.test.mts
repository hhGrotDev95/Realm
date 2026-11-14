// After a cancellation or move the console prepares an announcement for everyone (src/admin/announcementDraft.ts).
import assert from 'node:assert/strict'
import { announcementDraft, announcementForm, announcementPatch, type ChangeSummary } from '../src/admin/announcementDraft.ts'

let passed = 0
const check = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log('✓', name)
}

const NOW = Date.UTC(2027, 6, 16, 18, 0)
const base: ChangeSummary = { artist: 'Maduk', dayDe: 'Freitag', dayEn: 'Friday', start: 1320, end: 1395, stage: 'Generator', cancelled: false, endsAt: NOW + 120 * 60_000 }

check('a cancellation becomes a warning naming act, day, time and stage, valid until 30 min after the set', () => {
  const d = announcementDraft({ ...base, cancelled: true, note: 'Krankheit' }, NOW)!
  assert.equal(d.severity, 'warning')
  assert.equal(d.title, 'Abgesagt: Maduk (Freitag 22:00, Generator)')
  assert.equal(d.titleEn, 'Cancelled: Maduk (Friday 22:00, Generator)')
  assert.match(d.body, /entfällt\. Grund: Krankheit$/)
  assert.doesNotMatch(d.bodyEn, /Krankheit/, 'the German note stays out of the English text')
  assert.equal(d.place, 'Generator')
  assert.equal(d.valid, '150')
})

check('a moved set is an info with old and new time; times after midnight read as clock times', () => {
  const d = announcementDraft({ ...base, newStart: 1470, newEnd: 1530 }, NOW)!
  assert.equal(d.severity, 'info')
  assert.equal(d.title, 'Verschoben: Maduk jetzt 00:30 statt 22:00')
  assert.equal(d.body, 'Maduk spielt am Freitag um 00:30–01:30 auf Generator.')
  assert.equal(d.titleEn, 'Moved: Maduk now 00:30 instead of 22:00')
})

check('a stage change names the new stage, also as the place', () => {
  const d = announcementDraft({ ...base, newStage: 'Lagoon' }, NOW)!
  assert.equal(d.title, 'Verschoben: Maduk auf Lagoon statt Generator')
  assert.equal(d.place, 'Lagoon')
  const both = announcementDraft({ ...base, newStart: 1350, newEnd: 1425, newStage: 'Lagoon' }, NOW)!
  assert.equal(both.title, 'Verschoben: Maduk jetzt 22:30 statt 22:00, auf Lagoon statt Generator')
})

check('a note-only change needs no announcement', () => {
  assert.equal(announcementDraft({ ...base, note: 'Technischer Umbau' }, NOW), null)
  assert.equal(announcementDraft({ ...base, newStart: 1320, newEnd: 1395, newStage: 'Generator' }, NOW), null)
})

check('validity: blank when the set is over or further away than the API allows (no early expiry)', () => {
  assert.equal(announcementDraft({ ...base, cancelled: true, endsAt: NOW - 60_000 }, NOW)!.valid, '')
  assert.equal(announcementDraft({ ...base, cancelled: true, endsAt: NOW + 30 * 86_400_000 }, NOW)!.valid, '')
})

check('long names are clipped to the API limits', () => {
  const d = announcementDraft({ ...base, cancelled: true, artist: 'X'.repeat(200) }, NOW)!
  assert.ok(d.title.length <= 120 && d.title.endsWith('…'))
  assert.ok(d.titleEn.length <= 120)
})

const active = { title: 'Shuttle ab 23 Uhr', body: 'Alle 5 Min.', place: 'Shuttle-Terminal', severity: 'info' as const, validMin: 42, en: { title: 'Shuttle from 11 pm', body: 'Every 5 min.' } }

check('editing: the form is prefilled with the minutes left; nothing changed means nothing to save', () => {
  const f = announcementForm(active)
  assert.deepEqual(f, { title: 'Shuttle ab 23 Uhr', body: 'Alle 5 Min.', titleEn: 'Shuttle from 11 pm', bodyEn: 'Every 5 min.', place: 'Shuttle-Terminal', severity: 'info', valid: '42' })
  assert.deepEqual(announcementPatch(f, f, 'poi-x'), {})
  assert.deepEqual(announcementPatch(f, { ...f, title: ' Shuttle ab 23 Uhr  ' }, 'poi-x'), {}, 'whitespace alone is no change')
  assert.equal(announcementForm({ ...active, validMin: null, body: null, place: null, en: undefined }).valid, '')
})

check('editing: only changed fields go out, so the expiry and map point are kept', () => {
  const f = announcementForm(active)
  assert.deepEqual(announcementPatch(f, { ...f, severity: 'warning', title: 'Shuttle ab 23 Uhr alle 10 Min.' }, 'poi-x'), { severity: 'warning', title: 'Shuttle ab 23 Uhr alle 10 Min.' })
  assert.deepEqual(announcementPatch(f, { ...f, valid: '30' }, null), { validMin: 30 })
  assert.deepEqual(announcementPatch(f, { ...f, valid: '' }, null), { validMin: null }, 'cleared validity = until removed')
})

check('editing: cleared texts are sent as null; a new place carries its map point or none', () => {
  const f = announcementForm(active)
  assert.deepEqual(announcementPatch(f, { ...f, body: '  ' }, null), { body: null })
  assert.deepEqual(announcementPatch(f, { ...f, titleEn: '', bodyEn: '' }, null), { titleEn: null })
  assert.deepEqual(announcementPatch(f, { ...f, place: 'Lagoon' }, 'stage-lagoon'), { place: 'Lagoon', poi: 'stage-lagoon' })
  assert.deepEqual(announcementPatch(f, { ...f, place: 'Parkplatz' }, null), { place: 'Parkplatz', poi: null })
  assert.deepEqual(announcementPatch(f, { ...f, place: '' }, 'stale'), { place: null, poi: null })
})

console.log(`announcement drafts: ${passed} checks passed`)
