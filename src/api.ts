// Thin client for the Realm API (worker/). Without VITE_API_URL the app runs in demo mode.

export const API_URL: string | undefined = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || undefined
export const online = !!API_URL

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

let token: string | null = null
export const setToken = (t: string | null) => {
  token = t
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new ApiError(0, 'Kein Server konfiguriert')
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Keine Verbindung – bitte später erneut versuchen')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Fehler ' + res.status)
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
  text: string
  at: number
}
export interface CrewState {
  crew: { id: string; name: string; code: string }
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
export type Session = { id: string; token: string; nickname: string | null; color: string }
type CrewRef = { id: string; name: string; code: string }

export const api = {
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
  crew: (id: string) => call<CrewState>('GET', `/api/crews/${id}`),
  setLocation: (id: string, share: boolean, location: string | null) => call('PUT', `/api/crews/${id}/location`, { share, location }),
  sendMessage: (id: string, text: string) => call<RemoteMessage>('POST', `/api/crews/${id}/messages`, { text }),
  createMeetup: (id: string, m: { place: string; poi?: string; actId?: string; day: number; min: number; note: string }) => call<RemoteMeetup>('POST', `/api/crews/${id}/meetups`, m),
  rsvp: (id: string, going: boolean) => call('PUT', `/api/meetups/${id}/rsvp`, { going }),
  reports: () => call<RemoteReport[]>('GET', '/api/reports'),
  report: (r: { title: string; place?: string; poi?: string; severity: 'info' | 'warning' }) => call<RemoteReport>('POST', '/api/reports', r),
  vote: (id: string, kind: 'still' | 'fixed') => call('PUT', `/api/reports/${id}/vote`, { kind }),
}
