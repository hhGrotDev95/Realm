// Timetable import: turns JSON, CSV or spreadsheet rows into normalized acts for the API.
// Pure and framework-free so it can be unit-tested in Node. The server validates again.
import { DAY_START, MAX_END, MAX_START } from '../festivalTime.ts'

export interface ParsedRow {
  row: number // 1-based row in the source (header = row 1 for tables)
  id?: string
  day: number
  stage: string
  artist: string
  start: number // minutes after midnight of the festival day; night sets continue past 1440
  end: number
  genre?: string
  bio?: string
}
export interface Issue {
  row: number
  message: string
}
export interface ParseResult {
  rows: ParsedRow[]
  errors: Issue[]
  warnings: Issue[]
  columns: Record<Field, string | null> // which source column fed each field
}
export interface DayInfo {
  idx: number
  date: string // YYYY-MM-DD
  label: string // e.g. "Freitag"
}

type Field = 'id' | 'artist' | 'stage' | 'day' | 'date' | 'start' | 'end' | 'time' | 'genre' | 'bio'

/** Accepted column names (German and English), compared without case, spaces or punctuation. */
const ALIASES: Record<Field, string[]> = {
  id: ['id', 'actid', 'slug', 'kennung'],
  artist: ['artist', 'act', 'name', 'kuenstler', 'künstler', 'kuenstlerin', 'künstlerin', 'band', 'performer', 'dj'],
  stage: ['stage', 'buehne', 'bühne', 'floor', 'area', 'venue', 'location', 'ort'],
  day: ['day', 'tag', 'wochentag', 'weekday', 'festivaltag'],
  date: ['date', 'datum'],
  start: ['start', 'begin', 'beginn', 'von', 'from', 'starttime', 'startzeit', 'beginnzeit'],
  end: ['end', 'ende', 'bis', 'to', 'until', 'endtime', 'endzeit', 'stop'],
  time: ['time', 'zeit', 'slot', 'uhrzeit', 'timeslot'],
  genre: ['genre', 'vibe', 'style', 'stil', 'musik', 'music', 'tags'],
  bio: ['bio', 'description', 'beschreibung', 'info', 'text', 'about'],
}
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-./()]+/g, '')

/** Hours before this belong to the previous festival night (01:30 → 25:30) – the app-wide rule (audit F15). */
export const NIGHT_UNTIL = DAY_START / 60

const WEEKDAYS: Record<string, number> = {
  sonntag: 0, so: 0, sunday: 0, sun: 0,
  montag: 1, mo: 1, monday: 1, mon: 1,
  dienstag: 2, di: 2, tuesday: 2, tue: 2,
  mittwoch: 3, mi: 3, wednesday: 3, wed: 3,
  donnerstag: 4, do: 4, thursday: 4, thu: 4,
  freitag: 5, fr: 5, friday: 5, fri: 5,
  samstag: 6, sa: 6, sonnabend: 6, saturday: 6, sat: 6,
}

type Cell = string | number | boolean | Date | null | undefined

/** Minutes after midnight from "22:15", "22.15", "2215", "24:30", 0.9375 (spreadsheet fraction) or a Date. */
export function parseTime(v: Cell): number | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes()
  if (typeof v === 'number') {
    if (v >= 0 && v < 2) return Math.round(v * 24 * 60) // spreadsheet time as fraction of a day
    return null
  }
  const s = String(v).trim().toLowerCase().replace(/\s*uhr$/, '').replace(/\s*h$/, '')
  let m = s.match(/^(\d{1,2})[:.h](\d{2})$/)
  if (!m) m = s.match(/^(\d{1,2})(\d{2})$/)
  if (!m) {
    const h = s.match(/^(\d{1,2})$/)
    if (h) m = [s, h[1], '00'] as RegExpMatchArray
  }
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 30 || min > 59) return null
  return h * 60 + min
}

/** Puts early-morning times into the night of the previous festival day (01:30 → 25:30). */
const night = (min: number) => (min < NIGHT_UNTIL * 60 ? min + 1440 : min)

function parseDate(v: Cell): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v !== 'string') return null
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/)
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : ''
    return `${y}|${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` // year may be unknown
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) // US style m/d/yyyy
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

/** Resolves a day given as 1-based number, date, weekday name or label. */
export function resolveDay(dayCell: Cell, dateCell: Cell, days: DayInfo[]): number | null {
  const byDate = (d: string | null) => {
    if (!d) return null
    if (d.includes('|')) {
      const [y, md] = d.split('|')
      const hit = days.find((x) => x.date.slice(5) === md && (!y || x.date.startsWith(y)))
      return hit ? hit.idx : null
    }
    const hit = days.find((x) => x.date === d)
    return hit ? hit.idx : null
  }
  const fromDate = byDate(parseDate(dateCell))
  if (fromDate !== null) return fromDate
  if (dayCell === null || dayCell === undefined || dayCell === '') return null
  if (typeof dayCell === 'number' && Number.isInteger(dayCell)) return days.some((d) => d.idx === dayCell - 1) ? dayCell - 1 : null
  if (dayCell instanceof Date) return byDate(parseDate(dayCell))
  const s = String(dayCell).trim()
  if (/^\d{1,2}$/.test(s)) return days.some((d) => d.idx === Number(s) - 1) ? Number(s) - 1 : null
  const asDate = byDate(parseDate(s))
  if (asDate !== null) return asDate
  const key = norm(s).replace(/^tag/, '')
  if (/^\d+$/.test(key)) return days.some((d) => d.idx === Number(key) - 1) ? Number(key) - 1 : null
  const label = days.find((d) => norm(d.label) === norm(s))
  if (label) return label.idx
  const wd = WEEKDAYS[key]
  if (wd !== undefined) {
    const hits = days.filter((d) => new Date(d.date + 'T12:00:00Z').getUTCDay() === wd)
    return hits.length === 1 ? hits[0].idx : null
  }
  return null
}

function mapColumns(headers: string[]): Record<Field, number | null> {
  const result = {} as Record<Field, number | null>
  const used = new Set<number>()
  for (const field of Object.keys(ALIASES) as Field[]) {
    const idx = headers.findIndex((h, i) => !used.has(i) && ALIASES[field].map(norm).includes(norm(h)))
    result[field] = idx >= 0 ? idx : null
    if (idx >= 0) used.add(idx)
  }
  return result
}

/** Core: rows of cells with a header row → normalized acts with row-numbered issues. */
export function parseTable(table: Cell[][], days: DayInfo[]): ParseResult {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const nonEmpty = table.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))
  if (!nonEmpty.length) return { rows: [], errors: [{ row: 1, message: 'Die Datei ist leer' }], warnings, columns: {} as ParseResult['columns'] }
  const headerRowIndex = table.indexOf(nonEmpty[0])
  const headers = nonEmpty[0].map((c) => String(c ?? '').trim())
  const col = mapColumns(headers)
  const columns = Object.fromEntries(Object.entries(col).map(([k, i]) => [k, i === null ? null : headers[i]])) as ParseResult['columns']
  if (col.artist === null) errors.push({ row: headerRowIndex + 1, message: `Keine Spalte für den Act gefunden (erwartet z. B. „Act“, „Artist“ oder „Künstler“). Gefunden: ${headers.join(', ')}` })
  if (col.stage === null) errors.push({ row: headerRowIndex + 1, message: 'Keine Spalte für die Bühne gefunden (z. B. „Bühne“ oder „Stage“)' })
  if (col.day === null && col.date === null) errors.push({ row: headerRowIndex + 1, message: 'Keine Spalte für den Tag gefunden (z. B. „Tag“, „Day“ oder „Datum“)' })
  if (col.start === null && col.time === null) errors.push({ row: headerRowIndex + 1, message: 'Keine Spalte für die Startzeit gefunden (z. B. „Beginn“, „Start“ oder „Zeit“)' })
  if (errors.length) return { rows: [], errors, warnings, columns }

  const rows: ParsedRow[] = []
  table.forEach((cells, i) => {
    if (i <= headerRowIndex) return
    const rowNo = i + 1
    const get = (f: Field): Cell => (col[f] === null ? null : cells[col[f]!])
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === '')) return
    const artist = String(get('artist') ?? '').trim()
    if (!artist) return void errors.push({ row: rowNo, message: 'Act/Künstler fehlt' })
    const stage = String(get('stage') ?? '').trim()
    if (!stage) return void errors.push({ row: rowNo, message: `${artist}: Bühne fehlt` })
    const day = resolveDay(get('day'), get('date'), days)
    if (day === null) {
      const given = [get('day'), get('date')].filter((x) => x !== null && x !== undefined && x !== '').map((x) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x)))
      return void errors.push({ row: rowNo, message: given.length ? `${artist}: Tag „${given.join(' / ')}“ passt zu keinem Festivaltag (${days.map((d) => `${d.label} ${d.date}`).join(', ')})` : `${artist}: Tag fehlt` })
    }
    let startRaw: Cell = get('start')
    let endRaw: Cell = get('end')
    const slot = get('time')
    if ((startRaw === null || startRaw === undefined || startRaw === '') && typeof slot === 'string') {
      const parts = slot.split(/\s*(?:-|–|—|bis|to)\s*/i)
      startRaw = parts[0]
      if ((endRaw === null || endRaw === undefined || endRaw === '') && parts[1]) endRaw = parts[1]
    } else if ((startRaw === null || startRaw === undefined || startRaw === '') && slot !== null && slot !== undefined) startRaw = slot
    const s0 = parseTime(startRaw)
    if (s0 === null) return void errors.push({ row: rowNo, message: `${artist}: Beginn „${String(startRaw ?? '')}“ ist keine Uhrzeit (z. B. 22:30 oder 24:30)` })
    const start = night(s0)
    let end: number
    const e0 = parseTime(endRaw)
    if (endRaw !== null && endRaw !== undefined && endRaw !== '' && e0 === null) return void errors.push({ row: rowNo, message: `${artist}: Ende „${String(endRaw)}“ ist keine Uhrzeit` })
    if (e0 === null) {
      end = start + 60
      warnings.push({ row: rowNo, message: `${artist}: Ende fehlt – 60 Minuten angenommen` })
    } else {
      end = night(e0)
      if (end <= start) end += 1440 // e.g. 23:00–23:00 next day is impossible, 23:00–00:30 handled by night()
      if (end - start > 12 * 60) return void errors.push({ row: rowNo, message: `${artist}: Auftritt wäre länger als 12 Stunden – Zeiten prüfen` })
    }
    if (start >= MAX_START || end > MAX_END) return void errors.push({ row: rowNo, message: `${artist}: Sets beginnen vor 06:00 und enden bis 12:00 am Folgemorgen` })
    const id = String(get('id') ?? '').trim() || undefined
    const genre = String(get('genre') ?? '').trim() || undefined
    const bio = String(get('bio') ?? '').trim() || undefined
    rows.push({ row: rowNo, id, day, stage, artist, start, end, genre, bio })
  })
  return { rows, errors, warnings, columns }
}

/** RFC 4180-style CSV with auto-detected delimiter (, ; or tab), quotes and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = [';', '\t', ','].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      out.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    out.push(row)
  }
  return out
}

/** JSON: an array of objects, or { acts: [...] }. Keys use the same aliases as table columns. */
export function parseJson(text: string, days: DayInfo[]): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { rows: [], errors: [{ row: 1, message: `Ungültiges JSON: ${(e as Error).message}` }], warnings: [], columns: {} as ParseResult['columns'] }
  }
  const list = Array.isArray(data) ? data : Array.isArray((data as { acts?: unknown })?.acts) ? (data as { acts: unknown[] }).acts : null
  if (!list) return { rows: [], errors: [{ row: 1, message: 'Erwartet wird eine Liste von Acts oder { "acts": [...] }' }], warnings: [], columns: {} as ParseResult['columns'] }
  const keys = [...new Set(list.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))]
  const table: Cell[][] = [keys, ...list.map((o) => keys.map((k) => ((o ?? {}) as Record<string, Cell>)[k] ?? null))]
  // JSON entries are numbered from 1 like rows (the synthetic header is not a source row)
  const res = parseTable(table, days)
  const shift = (i: Issue) => ({ ...i, row: Math.max(1, i.row - 1) })
  return { ...res, rows: res.rows.map((r) => ({ ...r, row: r.row - 1 })), errors: res.errors.map(shift), warnings: res.warnings.map(shift) }
}

/** Entry point for files: picks the parser by extension. XLSX is loaded lazily. */
export async function parseFile(file: File, days: DayInfo[]): Promise<ParseResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.json')) return parseJson(await file.text(), days)
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return parseTable(parseCsv(await file.text()), days)
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser')
    const sheet = (await readSheet(file)) as Cell[][] // first sheet
    return parseTable(sheet, days)
  }
  return { rows: [], errors: [{ row: 1, message: 'Unterstützt werden .json, .csv und .xlsx' }], warnings: [], columns: {} as ParseResult['columns'] }
}
