// Thin client for the Realm API (worker/). Without VITE_API_URL the app runs in demo mode.
import type { MapFrame, MarkerCat } from './map'
import type { FestivalBundle, TimetableChange } from './data'

export const API_URL: string | undefined = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || undefined
export const online = !!API_URL

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** the parsed error body, e.g. the row errors of a refused import (422) */
    public data?: unknown,
  ) {
    super(message)
  }
}

let token: string | null = null
export const setToken = (t: string | null) => {
  token = t
}

/** The tenant: every festival-scoped request carries its slug in X-Festival. */
let festival: string | null = null
export const setFestival = (slug: string) => {
  festival = slug
}
const festivalHeader = (): Record<string, string> => (festival ? { 'X-Festival': festival } : {})

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new ApiError(0, 'Kein Server konfiguriert')
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { ...festivalHeader(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Keine Verbindung – bitte später erneut versuchen')
  }
  if (res.status === 204) return undefined as T
  return readJson<T>(res)
}

/** A body that cannot be read (e.g. cut off by a lost connection) is a network error, never an empty success. */
async function readJson<T>(res: Response): Promise<T> {
  let data: unknown
  try {
    data = await res.json()
  } catch {
    if (res.ok) throw new ApiError(0, 'Antwort unvollständig – bitte später erneut versuchen')
    data = {}
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Fehler ' + res.status, data)
  return data as T
}

export interface RemoteMember {
  id: string
  nickname: string | null
  color: string
  sharing: boolean
  location: string | null
  locationAt: number | null
  plan: string[]
  steps: { day: number; total: number; syncedAt: number }[]
}
export interface RemoteMeetup {
  id: string
  createdBy: string
  place: string
  poi: string | null
  actId: string | null
  day: number
  min: number
  note: string
  going: string[]
  declined: string[]
}
export interface RemoteMessage {
  id: string
  from: string
  text: string | null
  at: number
  deleted?: boolean
  hidden?: boolean
  flaggedByMe?: boolean
}
export interface CrewState {
  crew: { id: string; name: string; code: string }
  owner: string
  me: string
  serverTime: number
  members: RemoteMember[]
  messages: RemoteMessage[]
  meetups: RemoteMeetup[]
}
export interface RemoteReport {
  id: string
  title: string
  place: string | null
  poi: string | null
  severity: 'info' | 'warning'
  source: 'confirmed' | 'unconfirmed'
  confirms: number
  mine: boolean
  myVote: 'still' | 'fixed' | null
  ageMin: number
  validMin: number
}
export interface Announcement {
  id: string
  title: string
  body: string | null
  place: string | null
  poi: string | null
  severity: 'info' | 'warning' | 'critical'
  ageMin: number
  validMin: number | null
}
export type Session = { id: string; token: string; nickname: string | null; color: string }
type CrewRef = { id: string; name: string; code: string }

export const api = {
  festivals: () => call<{ slug: string; name: string; location: string | null }[]>('GET', '/api/festivals'),
  festival: (slug: string) => call<FestivalBundle>('GET', `/api/festivals/${encodeURIComponent(slug)}`),
  createGuest: (nickname: string | null, color: string) => call<Session>('POST', '/api/guests', { nickname, color }),
  me: () => call<{ id: string; nickname: string | null; color: string; secured: boolean; crews: CrewRef[]; plan: string[] }>('GET', '/api/me'),
  updateMe: (nickname: string, color: string) => call('PATCH', '/api/me', { nickname, color }),
  deleteMe: () => call<void>('DELETE', '/api/me'),
  recovery: () => call<{ code: string }>('POST', '/api/me/recovery'),
  restore: (code: string) => call<Session>('POST', '/api/restore', { code }),
  setPlan: (acts: string[]) => call('PUT', '/api/me/plan', { acts }),
  deleteSteps: () => call<void>('DELETE', '/api/me/steps'),
  createCrew: (name: string) => call<CrewRef>('POST', '/api/crews', { name }),
  joinCrew: (code: string) => call<CrewRef>('POST', '/api/crews/join', { code }),
  leaveCrew: (id: string) => call<void>('POST', `/api/crews/${id}/leave`),
  crew: (id: string, since?: number) => call<CrewState>('GET', `/api/crews/${id}${since ? `?since=${since}` : ''}`),
  setLocation: (id: string, share: boolean, location: string | null) => call('PUT', `/api/crews/${id}/location`, { share, location }),
  deleteMessage: (crewId: string, id: string) => call<void>('DELETE', `/api/crews/${crewId}/messages/${id}`),
  flagMessage: (crewId: string, id: string) => call<{ hidden: boolean }>('POST', `/api/crews/${crewId}/messages/${id}/flag`),
  removeMember: (crewId: string, guestId: string) => call<void>('DELETE', `/api/crews/${crewId}/members/${guestId}`),
  sendMessage: (crewId: string, text: string, id?: string) => call<RemoteMessage>('POST', `/api/crews/${crewId}/messages`, { id, text }),
  createMeetup: (crewId: string, m: { id?: string; place: string; poi?: string; actId?: string; day: number; min: number; note: string }) => call<RemoteMeetup>('POST', `/api/crews/${crewId}/meetups`, m),
  rsvp: (id: string, going: boolean) => call('PUT', `/api/meetups/${id}/rsvp`, { going }),
  reports: () => call<RemoteReport[]>('GET', '/api/reports'),
  announcements: () => call<Announcement[]>('GET', '/api/announcements'),
  timetableChanges: () => call<TimetableChange[]>('GET', '/api/timetable/changes'),
  report: (r: { id?: string; title: string; place?: string; poi?: string; severity: 'info' | 'warning' }) => call<RemoteReport>('POST', '/api/reports', r),
  vote: (id: string, kind: 'still' | 'fixed') => call('PUT', `/api/reports/${id}/vote`, { kind }),
}

/** Network trouble (or an overloaded server) is worth retrying; validation errors are not. */
export const retryable = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500)

export type OutboxOp =
  | { id: string; kind: 'message'; crewId: string; text: string; at: number }
  | { id: string; kind: 'meetup'; crewId: string; data: { place: string; poi?: string; actId?: string; day: number; min: number; note: string } }
  | { id: string; kind: 'rsvp'; meetupId: string; going: boolean }
  | { id: string; kind: 'vote'; reportId: string; vote: 'still' | 'fixed' }
  | { id: string; kind: 'report'; data: { title: string; place?: string; poi?: string; severity: 'info' | 'warning' } }

export function execute(op: OutboxOp): Promise<unknown> {
  switch (op.kind) {
    case 'message':
      return api.sendMessage(op.crewId, op.text, op.id)
    case 'meetup':
      return api.createMeetup(op.crewId, { ...op.data, id: op.id })
    case 'rsvp':
      return api.rsvp(op.meetupId, op.going)
    case 'vote':
      return api.vote(op.reportId, op.vote)
    case 'report':
      return api.report({ ...op.data, id: op.id })
  }
}

const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('')
export const opId = (prefix: string) => `${prefix}_${rand()}`

export interface AdminFaq {
  id: string
  question: string
  answer: string
  category: string
  keywords: string
  source: string | null
  status: 'draft' | 'published'
  sort: number
  updatedAt: number
}

export interface ImportResult {
  dryRun: boolean
  mode: 'merge' | 'replace'
  written: boolean
  snapshotId?: string | null
  summary: { rows: number; created: number; updated: number; unchanged: number; removed: number; stagesCreated: number }
  errors: { row: number; message: string }[]
  warnings: { row: number; message: string }[]
}

/** Organizer endpoints; the admin token is passed explicitly and never stored with the guest session. */
export const adminApi = (adminToken: string) => {
  const req = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    if (!API_URL) throw new ApiError(0, 'Kein Server konfiguriert')
    let res: Response
    try {
      res = await fetch(API_URL + path, {
        method,
        headers: { ...festivalHeader(), Authorization: 'Bearer ' + adminToken, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, 'Keine Verbindung zum Server')
    }
    if (res.status === 204) return undefined as T
    return readJson<T>(res)
  }
  return {
    check: () => req<{ ok: true }>('GET', '/api/admin/session'),
    festivals: () => req<{ slug: string; name: string; status: string }[]>('GET', '/api/admin/festivals'),
    bundle: (slug: string) => req<FestivalBundle>('GET', `/api/festivals/${encodeURIComponent(slug)}`),
    // reads go through the admin token too, so drafts work
    announcements: () => req<Announcement[]>('GET', '/api/announcements'),
    timetableChanges: () => req<TimetableChange[]>('GET', '/api/timetable/changes'),
    createFestival: (f: { name: string; slug?: string; location?: string; startDate: string; days: number }) => req<{ slug: string; name: string; status: string }>('POST', '/api/admin/festivals', f),
    updateFestival: (slug: string, f: { name?: string; location?: string; status?: 'draft' | 'published' | 'archived' }) => req<{ slug: string; name: string; status: string }>('PATCH', `/api/admin/festivals/${slug}`, f),
    setStages: (slug: string, stages: { id?: string; name: string; color?: string; vibe?: string }[]) => req<{ stages: { id: string; name: string; color: string }[] }>('PUT', `/api/admin/festivals/${slug}/stages`, { stages }),
    importTimetable: (slug: string, body: { mode: 'merge' | 'replace'; dryRun: boolean; rows: unknown[] }) => req<ImportResult>('POST', `/api/admin/festivals/${slug}/import`, body),
    faq: (slug: string) => req<AdminFaq[]>('GET', `/api/admin/festivals/${slug}/faq`),
    saveFaq: (slug: string, f: Omit<AdminFaq, 'updatedAt' | 'source'> & { source?: string }) => req<AdminFaq>('PUT', `/api/admin/festivals/${slug}/faq/${f.id}`, f),
    deleteFaq: (slug: string, id: string) => req<void>('DELETE', `/api/admin/festivals/${slug}/faq/${id}`),
    setModules: (slug: string, modules: Record<string, boolean>) => req<Record<string, boolean>>('PUT', `/api/admin/festivals/${slug}/modules`, modules),
    setMapImage: (slug: string, plan: { image: string; width: number; height: number } | { image: null }) => req<MapFrame>('PUT', `/api/admin/festivals/${slug}/map/image`, plan),
    setMapMarkers: (slug: string, m: { stages: { id: string; x: number; y: number }[]; pois: { id: string; cat: MarkerCat; name: string; x: number; y: number; detail: string; status?: string; important: boolean }[] }) => req<unknown>('PUT', `/api/admin/festivals/${slug}/map/markers`, m),
    setTheme: (slug: string, theme: { brand?: string; font?: string; logo?: string }) => req<Record<string, string>>('PUT', `/api/admin/festivals/${slug}/theme`, theme),
    snapshots: (slug: string) => req<{ id: string; createdAt: number; note: string }[]>('GET', `/api/admin/festivals/${slug}/snapshots`),
    restoreSnapshot: (slug: string, id: string) => req<{ restored: number }>('POST', `/api/admin/festivals/${slug}/snapshots/${id}/restore`),
    announce: (a: { title: string; body?: string; place?: string; severity: Announcement['severity']; validMin?: number }) => req<Announcement>('POST', '/api/admin/announcements', a),
    removeAnnouncement: (id: string) => req<void>('DELETE', `/api/admin/announcements/${id}`),
    setChange: (actId: string, c: { start?: number; end?: number; stage?: string; cancelled?: boolean; note?: string }) => req<TimetableChange>('PUT', `/api/admin/timetable/${actId}`, c),
    revertChange: (actId: string) => req<void>('DELETE', `/api/admin/timetable/${actId}`),
  }
}
