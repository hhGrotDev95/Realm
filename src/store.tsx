import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError, execute, online, opId, retryable, setToken, type Announcement, type CrewState, type OutboxOp, type RemoteReport, type Session } from './api'
import { DEFAULT_FESTIVAL } from './festival'
import { on, ACTS, actById, DAYS, FESTIVAL, applyTimetableChanges, CHAT, DEMO_CHANGES, type TimetableChange, FRIENDS, friendsFor as demoFriendsFor, ME, PHASE_CLOCK, realClock, DEMO_MS_TO_START, STAGES, UPDATES, type ChatMsg, type FestivalUpdate, type Friend, type Phase, type StageId } from './data'

export interface Meetup {
  id: string
  title: string
  place: string
  poi?: string
  actId?: string
  day: number
  min: number
  note: string
  going: string[]
  createdBy: string
}

export interface Guest {
  id: string
  nickname: string | null
  color: string
  secured: null | 'passkey' | 'code'
  recoveryCode?: string
}

interface Persisted {
  guest: Guest
  phase: Phase
  clockMode: 'demo' | 'real'
  plan: string[]
  attended: Record<string, boolean>
  resolved: Record<string, string>
  reminders: Record<string, boolean>
  meetups: Meetup[]
  declined: string[]
  votes: Record<string, 'still' | 'fixed'>
  myUpdates: FestivalUpdate[]
  chat: ChatMsg[]
  shareLocation: boolean
  stepsOptIn: boolean
  myPins: { id: string; name: string; x: number; y: number }[]
  dismissed: string[]
  // backend (only used when VITE_API_URL is set)
  session: Pick<Session, 'id' | 'token'> | null
  crewRef: { id: string; name: string; code: string } | null
  remote: { me: string; owner?: string; members: CrewState['members'] } | null
  remoteReports: RemoteReport[]
  pendingJoin: string | null
  outbox: OutboxOp[]
  announcements: { items: Announcement[]; fetchedAt: number } | null
  timetableChanges: TimetableChange[] | null
}

/** The crew as the UI sees it – demo friends or live members from the server. */
export interface CrewView {
  live: boolean
  /** owner id ('me' when it is you); the owner moderates the crew */
  owner: string | null
  name: string
  code: string | null
  members: Friend[]
  byId: Record<string, Friend>
  friendsFor: (actId: string) => string[]
  stepsSyncedMin: number | null
}

const COLORS = ['#A58CFF', '#FF8A65', '#4FC3F7', '#FFD54F', '#81C784', '#F06292']
const rid = () => Math.random().toString(36).slice(2, 10)

function initial(): Persisted {
  return {
    guest: { id: 'g_' + rid() + rid(), nickname: null, color: COLORS[Math.floor(Math.random() * COLORS.length)], secured: null },
    phase: 'during',
    clockMode: 'demo',
    plan: ['1-ilka-frost', '1-maduk', '1-satellite-lovers', '1-the-lowlights', '1-arcturus', '1-somna', '1-black-meridian', '0-orra', '0-dana-velk', '0-juno-reyes', '0-unit-47', '2-kairo', '2-grid-theory', '2-sunset-protocol', '2-linnea-vale', '2-vera-strand'],
    attended: { '0-orra': true, '0-dana-velk': true, '0-juno-reyes': false, '0-unit-47': true, '1-ilka-frost': true },
    resolved: {},
    reminders: { '1-maduk': true },
    meetups: [
      { id: 'm1', title: 'Vor Maduk treffen', place: 'Archive Entrance', poi: 'stage-archive', actId: '1-maduk', day: 1, min: 20 * 60 + 10, note: 'Gemeinsam rüber zum Generator', going: ['f2', 'f5', 'f4', 'f8', 'f1', 'f3', 'f7'], createdBy: 'f2' },
    ],
    declined: [],
    votes: {},
    myUpdates: [],
    chat: CHAT,
    shareLocation: true,
    stepsOptIn: false,
    myPins: [{ id: 'pin1', name: 'Unser Banner', x: 600, y: 170 }],
    dismissed: [],
    session: null,
    crewRef: null,
    remote: null,
    remoteReports: [],
    pendingJoin: null,
    outbox: [],
    announcements: null,
    timetableChanges: null,
  }
}

/** In live mode the demo crew, chat, meetups and plan start empty – every festival starts clean. */
function initialOnline(): Persisted {
  return { ...initial(), plan: [], reminders: {}, meetups: [], chat: [], shareLocation: false, attended: {}, phase: 'during', clockMode: 'real' }
}

// Local state is kept per festival, so plans and crews never mix between tenants.
const LEGACY_KEY = 'realm.v2'
// evaluated lazily: the festival is only known after boot
const storageKey = () => (online ? `realm.v2:${FESTIVAL.slug}` : LEGACY_KEY)
const fresh = () => (online ? initialOnline() : initial())
function load(): Persisted {
  let state = fresh()
  try {
    // the single-festival version stored everything under one key: adopt it for the default festival
    const raw = localStorage.getItem(storageKey()) ?? (online && FESTIVAL.slug === DEFAULT_FESTIVAL ? localStorage.getItem(LEGACY_KEY) : null)
    if (raw) state = { ...state, ...JSON.parse(raw) }
  } catch {}
  // invite links: /?join=ABCD-EFGH
  const join = new URLSearchParams(location.search).get('join')
  if (join) {
    state.pendingJoin = join
    history.replaceState(null, '', location.pathname)
  }
  if (state.session) setToken(state.session.token)
  return state
}

const POLL_MS = 8000
const MAX_BACKOFF_MS = 120_000

const nearestStage = (): StageId => STAGES.reduce((a, b) => (Math.hypot(a.x - ME.x, a.y - ME.y) < Math.hypot(b.x - ME.x, b.y - ME.y) ? a : b)).id

function minuteOfDay(ts: number) {
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes()
}

export type Tab = 'home' | 'lineup' | 'map' | 'crew'

export type SheetState =
  | { kind: 'act'; id: string }
  | { kind: 'poi'; id: string }
  | { kind: 'resolver'; ids: string[]; key: string }
  | { kind: 'meetup'; id: string }
  | { kind: 'newMeetup'; actId?: string; poi?: string; place?: string; note?: string }
  | { kind: 'profile' }
  | { kind: 'identity'; reason: string }
  | { kind: 'updates' }
  | { kind: 'report'; poi?: string }
  | { kind: 'secure' }
  | { kind: 'restore' }
  | { kind: 'wrapped' }
  | { kind: 'chat' }
  | { kind: 'shared' }
  | { kind: 'members' }
  | { kind: 'steps' }
  | null

interface Ctx extends Persisted {
  tab: Tab
  setTab: (t: Tab) => void
  now: { day: number; min: number }
  sheet: SheetState
  openSheet: (s: SheetState) => void
  closeSheet: () => void
  sheetStack: SheetState[]
  toggleFav: (id: string) => void
  setAttended: (id: string, v: boolean) => void
  resolve: (key: string, keep: string[], all: string[]) => void
  toggleReminder: (id: string) => void
  setPhase: (p: Phase) => void
  msToStart: number
  setNickname: (n: string, color: string) => void
  secure: (how: 'passkey' | 'code') => string | undefined | Promise<string | undefined>
  requireIdentity: (reason: string, then: () => void) => void
  addMeetup: (m: Omit<Meetup, 'id' | 'going' | 'createdBy'>) => void
  rsvp: (id: string, going: boolean) => void
  vote: (id: string, v: 'still' | 'fixed') => void
  report: (u: Omit<FestivalUpdate, 'id' | 'ageMin' | 'source' | 'phases'>) => void
  sendChat: (text: string) => void
  set: <K extends keyof Persisted>(k: K, v: Persisted[K]) => void
  toast: (msg: string, action?: { label: string; run: () => void }) => void
  toastMsg: { id: number; msg: string; action?: { label: string; run: () => void } } | null
  focusPoi: string | null
  setFocusPoi: (id: string | null) => void
  reset: () => void
  scrollTopSignal: number
  online: boolean
  crew: CrewView
  updates: FestivalUpdate[]
  createCrew: (name: string) => Promise<void>
  joinCrew: (code: string) => Promise<void>
  leaveCrew: () => Promise<void>
  restore: (code: string) => Promise<boolean>
  deleteProfile: () => Promise<void>
  inviteLink: () => string | null
  netOnline: boolean
  deleteMessage: (id: string) => void
  flagMessage: (id: string) => void
  removeMember: (id: string) => void
}

const C = createContext<Ctx>(null!)
export const useApp = () => useContext(C)

export function AppProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Persisted>(load)
  const [tab, setTabRaw] = useState<Tab>('home')
  const [stack, setStack] = useState<SheetState[]>([])
  const [toastMsg, setToast] = useState<Ctx['toastMsg']>(null)
  const [focusPoi, setFocusPoi] = useState<string | null>(null)
  const [scrollTopSignal, setScrollTop] = useState(0)
  const [tick, setTick] = useState(() => Date.now())
  // fresher festival data was loaded after the first render (see main.tsx)
  useEffect(() => {
    const h = () => setTick(Date.now())
    window.addEventListener('realm:festival-updated', h)
    return () => window.removeEventListener('realm:festival-updated', h)
  }, [])
  // the real clock ticks every 30 s
  useEffect(() => {
    if (s.clockMode !== 'real') return
    const id = window.setInterval(() => setTick(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [s.clockMode])
  const pending = useRef<(() => void) | null>(null)
  const toastTimer = useRef<number>(0)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(s))
    } catch {}
  }, [s])

  const toast: Ctx['toast'] = useCallback((msg, action) => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), msg, action: action && { label: action.label, run: () => (action.run(), setToast(null)) } })
    toastTimer.current = window.setTimeout(() => setToast(null), 3800)
  }, [])

  const setTab = useCallback(
    (t: Tab) => {
      setTabRaw((cur) => {
        if (cur === t) setScrollTop((n) => n + 1)
        return t
      })
      setStack([])
    },
    [],
  )

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'Etwas ist schiefgelaufen'), [toast])

  /** Maps a server crew snapshot onto the local view model ('me' stands for the current guest). */
  const applyCrew = useCallback((cs: CrewState, incremental = false) => {
    const me = (id: string) => (id === cs.me ? 'me' : id)
    setS((p) => {
      // queued writes stay visible until the server has them
      const known = new Set([...cs.messages.map((m) => m.id), ...(incremental ? p.chat.filter((m) => !m.pending).map((m) => m.id) : []), ...cs.meetups.map((m) => m.id)])
      const queued = p.outbox.filter((o) => !known.has(o.id))
      const rsvps = new Map(queued.flatMap((o) => (o.kind === 'rsvp' ? [[o.meetupId, o.going] as const] : [])))
      return {
        ...p,
        crewRef: cs.crew,
        remote: { me: cs.me, owner: cs.owner, members: cs.members },
        chat: [
          // incremental polls only carry new messages: keep the ones we already have
          ...(incremental && p.crewRef?.id === cs.crew.id ? p.chat.filter((m) => !m.pending && !cs.messages.some((n) => n.id === m.id)) : []),
          ...cs.messages.map((m) => ({ id: m.id, from: me(m.from), text: m.text ?? '', min: minuteOfDay(m.at), at: m.at, deleted: m.deleted, hidden: m.hidden, flaggedByMe: m.flaggedByMe })),
          ...queued.flatMap((o) => (o.kind === 'message' && o.crewId === cs.crew.id ? [{ id: o.id, from: 'me', text: o.text, min: minuteOfDay(o.at), pending: true }] : [])),
        ],
        meetups: [
          ...cs.meetups.map((m) => {
            const going = m.going.map(me).filter((g) => g !== 'me' || rsvps.get(m.id) !== false)
            if (rsvps.get(m.id) && !going.includes('me')) going.push('me')
            return { id: m.id, title: m.note || 'Meetup', place: m.place, poi: m.poi ?? undefined, actId: m.actId ?? undefined, day: m.day, min: m.min, note: m.note, going, createdBy: me(m.createdBy) }
          }),
          ...queued.flatMap((o) => (o.kind === 'meetup' && o.crewId === cs.crew.id ? [{ id: o.id, title: o.data.note || 'Meetup', ...o.data, going: ['me'], createdBy: 'me' }] : [])),
        ],
        declined: cs.meetups.filter((m) => (rsvps.has(m.id) ? rsvps.get(m.id) === false : m.declined.includes(cs.me))).map((m) => m.id),
      }
    })
  }, [])

  // chat cursor: after the first full snapshot only newer messages are fetched; every 15th poll reconciles fully
  const cursor = useRef({ crewId: '', at: 0, polls: 0 })

  /** One sync round. Returns false when the network or server failed (caller backs off). */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!online || !sRef.current.session) return true
    const crewId = sRef.current.crewRef?.id
    if (cursor.current.crewId !== (crewId ?? '')) cursor.current = { crewId: crewId ?? '', at: 0, polls: 0 }
    const c = cursor.current
    const incremental = c.at > 0 && c.polls % 15 !== 0
    try {
      const [cs, reports] = await Promise.all([crewId && on('crew') ? api.crew(crewId, incremental ? c.at - 1 : undefined) : null, on('reports') ? api.reports() : []])
      if (cs) {
        applyCrew(cs, incremental)
        c.at = Math.max(incremental ? c.at : 0, ...cs.messages.map((m) => m.at))
        c.polls++
      }
      setS((p) => ({ ...p, remoteReports: reports, votes: { ...p.votes, ...Object.fromEntries(reports.filter((r) => r.myVote).map((r) => [r.id, r.myVote!])) } }))
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setS((p) => ({ ...p, session: null, crewRef: null, remote: null }))
      if (e instanceof ApiError && e.status === 404 && crewId) {
        setS((p) => ({ ...p, crewRef: null, remote: null, chat: [], meetups: [], declined: [] }))
        toast('Du bist nicht mehr Mitglied dieser Crew')
      }
      return !retryable(e)
    }
  }, [applyCrew, toast])

  const sRef = useRef(s)
  sRef.current = s

  const [netOnline, setNetOnline] = useState(() => navigator.onLine)
  const flushing = useRef(false)

  /** Sends queued writes in order; stops at the first one that should be retried later. */
  const flush = useCallback(async () => {
    if (!online || flushing.current || !sRef.current.session) return
    flushing.current = true
    let sent = 0
    try {
      for (const op of sRef.current.outbox) {
        try {
          await execute(op)
          sent++
        } catch (e) {
          if (retryable(e)) break
          sent++
          toast(e instanceof ApiError ? `Nicht gesendet: ${e.message}` : 'Nicht gesendet')
        }
        const done = op.id
        setS((p) => ({ ...p, outbox: p.outbox.filter((o) => o.id !== done) }))
        sRef.current = { ...sRef.current, outbox: sRef.current.outbox.filter((o) => o.id !== done) }
      }
    } finally {
      flushing.current = false
    }
    if (sent) await refresh()
  }, [toast]) // refresh is stable enough via its own deps; see below

  useEffect(() => {
    const up = () => {
      setNetOnline(true)
      flush()
    }
    const down = () => setNetOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [flush])

  // verify the session once and pick up crews joined on another device
  useEffect(() => {
    if (!online || !s.session) return
    api
      .me()
      .then((me) => setS((p) => ({ ...p, crewRef: p.crewRef ?? me.crews[0] ?? null, guest: { ...p.guest, nickname: me.nickname, color: me.color, secured: me.secured ? p.guest.secured ?? 'code' : null } })))
      .catch((e) => e instanceof ApiError && e.status === 401 && setS((p) => ({ ...p, session: null, crewRef: null, remote: null })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.session?.id])

  // polling while visible: every 8 s, backing off exponentially (up to 2 min) while requests fail
  useEffect(() => {
    if (!online || !s.session) return
    let timer = 0
    let delay = POLL_MS
    let stopped = false
    const tick = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        await flush()
        delay = (await refresh()) ? POLL_MS : Math.min(delay * 2, MAX_BACKOFF_MS)
      }
      if (!stopped) timer = window.setTimeout(tick, delay)
    }
    const wake = () => {
      // coming back (tab visible or network up) syncs immediately and resets the backoff
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(timer)
      delay = POLL_MS
      tick()
    }
    tick()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [s.session?.id, s.crewRef?.id, refresh, flush])

  // official announcements are public: fetched for everyone, cached for offline use
  useEffect(() => {
    if (!online) return
    const load = () => {
      api
        .announcements()
        .then((items) => setS((p) => ({ ...p, announcements: { items, fetchedAt: Date.now() } })))
        .catch(() => {})
      api
        .timetableChanges()
        .then((timetableChanges) => setS((p) => ({ ...p, timetableChanges })))
        .catch(() => {})
    }
    load()
    const id = window.setInterval(() => document.visibilityState === 'visible' && load(), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // plan sync (debounced)
  useEffect(() => {
    if (!online || !s.session) return
    const t = window.setTimeout(() => api.setPlan(s.plan).catch(() => {}), 800)
    return () => window.clearTimeout(t)
  }, [s.plan, s.session?.id])

  // coarse location sync: only the nearest stage area, only while sharing
  useEffect(() => {
    if (!online || !s.session || !s.crewRef) return
    if (on('location')) api.setLocation(s.crewRef.id, s.shareLocation, s.shareLocation ? nearestStage() : null).catch(() => {})
  }, [s.shareLocation, s.crewRef?.id, s.session?.id])

  // leaving the step challenge deletes the synced totals
  useEffect(() => {
    if (online && s.session && !s.stepsOptIn && on('steps')) api.deleteSteps().catch(() => {})
  }, [s.stepsOptIn, s.session?.id])

  const ensureSession = useCallback(async (nickname: string | null, color: string) => {
    if (sRef.current.session) return
    const g = await api.createGuest(nickname, color)
    setToken(g.token)
    setS((p) => ({ ...p, session: { id: g.id, token: g.token }, guest: { ...p.guest, id: g.id } }))
    sRef.current = { ...sRef.current, session: { id: g.id, token: g.token } }
  }, [])

  const openSheet = useCallback((sh: SheetState) => setStack((st) => (sh ? [...st, sh] : st)), [])
  const closeSheet = useCallback(() => setStack((st) => st.slice(0, -1)), [])

  // the timetable everyone sees: published slots plus the organizer's changes (cached offline)
  applyTimetableChanges(online ? (s.timetableChanges ?? []) : DEMO_CHANGES)

  const value = useMemo<Ctx>(() => {
    const real = s.clockMode === 'real' ? realClock(new Date(tick)) : null
    const phase = real ? real.phase : s.phase
    const now = real ? { day: real.day, min: real.min } : PHASE_CLOCK[s.phase]
    const msToStart = real ? real.msToStart : DEMO_MS_TO_START
    const set: Ctx['set'] = (k, v) => setS((p) => ({ ...p, [k]: v }))
    const requireIdentity: Ctx['requireIdentity'] = (reason, then) => {
      if (s.guest.nickname && (!online || s.session)) return then()
      pending.current = then
      setStack((st) => [...st, { kind: 'identity', reason }])
    }
    const crewId = s.crewRef?.id
    const live = online && !!s.remote
    const crew: CrewView = !on('crew')
      ? { live: false, owner: null, name: '', code: null, members: [], byId: {}, friendsFor: () => [], stepsSyncedMin: null }
      : live
      ? (() => {
          const members: Friend[] = s.remote!.members
            .filter((m) => m.id !== s.remote!.me)
            .map((m) => ({
              id: m.id,
              name: m.nickname ?? 'Gast',
              color: m.color,
              at: (m.location as Friend['at']) ?? null,
              seen: m.locationAt ? Math.max(0, Math.round((Date.now() - m.locationAt) / 60000)) : 0,
              steps: m.steps.find((x) => x.day === Math.max(0, Math.min(DAYS.length - 1, now.day)))?.total ?? 0,
            }))
          const plans = Object.fromEntries(s.remote!.members.map((m) => [m.id, m.plan]))
          const synced = s.remote!.members.flatMap((m) => m.steps.map((x) => x.syncedAt))
          return {
            live: true,
            owner: s.remote!.owner === s.remote!.me ? 'me' : (s.remote!.owner ?? null),
            name: s.crewRef!.name,
            code: s.crewRef!.code,
            members,
            byId: Object.fromEntries(members.map((m) => [m.id, m])),
            friendsFor: (actId: string) => members.filter((m) => plans[m.id]?.includes(actId)).map((m) => m.id),
            stepsSyncedMin: synced.length ? Math.round((Date.now() - Math.max(...synced)) / 60000) : null,
          }
        })()
      : {
          live: false,
          owner: online ? null : 'me', // the demo crew is yours to try moderation
          name: online ? 'Noch keine Crew' : 'Demo-Crew',
          code: null,
          members: online ? [] : FRIENDS,
          byId: online ? {} : Object.fromEntries(FRIENDS.map((f) => [f.id, f])),
          friendsFor: online ? () => [] : demoFriendsFor,
          stepsSyncedMin: online ? null : 4,
        }

    // official and app notices come from the festival; community reports from the server when online
    const remoteUpdates: FestivalUpdate[] = s.remoteReports.map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      place: r.place ?? undefined,
      poi: r.poi ?? undefined,
      ageMin: r.ageMin,
      validMin: r.validMin,
      severity: r.severity,
      confirms: r.confirms - (r.myVote === 'still' ? 1 : 0),
      phases: ['before', 'arrival', 'during', 'departure'],
    }))
    // ages are relative to the last fetch so cached notices keep counting up offline
    const sinceFetch = s.announcements ? Math.floor((Date.now() - s.announcements.fetchedAt) / 60000) : 0
    const official: FestivalUpdate[] = (s.announcements?.items ?? [])
      .map((a) => ({
        id: a.id,
        source: 'official' as const,
        title: a.title,
        body: a.body ?? undefined,
        place: a.place ?? undefined,
        poi: a.poi ?? undefined,
        severity: a.severity,
        ageMin: a.ageMin + sinceFetch,
        validMin: a.validMin === null ? undefined : a.validMin - sinceFetch,
        phases: ['before', 'arrival', 'during', 'departure', 'after'] as Phase[],
      }))
      .filter((a) => a.validMin === undefined || a.validMin > 0)
    const updates = online ? [...official, ...remoteUpdates, ...UPDATES.filter((u) => u.source === 'app')] : [...s.myUpdates, ...UPDATES]

    /** Queue a write locally first; it is sent now or as soon as the network is back. */
    const enqueue = (op: OutboxOp, sentMsg?: string) => {
      setS((p) => ({ ...p, outbox: [...p.outbox, op] }))
      sRef.current = { ...sRef.current, outbox: [...sRef.current.outbox, op] }
      if (!navigator.onLine) toast('Offline – wird gesendet, sobald du wieder Netz hast')
      else if (sentMsg) toast(sentMsg)
      void flush()
    }

    return {
      ...s,
      phase,
      msToStart,
      online,
      netOnline,
      crew,
      updates,
      inviteLink: () => (s.crewRef ? `${location.origin}/?join=${s.crewRef.code}` : null),
      deleteMessage: (id) => {
        const mark = () => setS((p) => ({ ...p, chat: p.chat.map((m) => (m.id === id ? { ...m, deleted: true, text: '' } : m)) }))
        if (!online) return mark()
        if (!crewId) return
        api.deleteMessage(crewId, id).then(() => (mark(), refresh()), fail)
      },
      flagMessage: (id) =>
        requireIdentity('Meldungen brauchen einen Namen, damit Missbrauch erkennbar bleibt.', () => {
          const mark = (hidden: boolean) => setS((p) => ({ ...p, chat: p.chat.map((m) => (m.id === id ? { ...m, flaggedByMe: true, hidden: m.hidden || hidden } : m)) }))
          if (!online) {
            mark(true)
            return toast('Gemeldet – die Nachricht ist ausgeblendet')
          }
          if (!crewId) return
          api.flagMessage(crewId, id).then((r) => {
            mark(r.hidden)
            toast(r.hidden ? 'Gemeldet – die Nachricht ist jetzt ausgeblendet' : 'Gemeldet – danke')
          }, fail)
        }),
      removeMember: (id) => {
        if (!online || !crewId) return toast('Im Demo-Modus können keine Mitglieder entfernt werden')
        api.removeMember(crewId, id).then(() => {
          toast('Mitglied entfernt')
          refresh()
        }, fail)
      },
      createCrew: async (name) => {
        try {
          const c = await api.createCrew(name)
          setS((p) => ({ ...p, crewRef: c }))
          sRef.current = { ...sRef.current, crewRef: c }
          await refresh()
          toast(`Crew „${c.name}“ gegründet`)
        } catch (e) {
          fail(e)
        }
      },
      joinCrew: async (code) => {
        try {
          const c = await api.joinCrew(code)
          setS((p) => ({ ...p, crewRef: c, pendingJoin: null }))
          sRef.current = { ...sRef.current, crewRef: c }
          await refresh()
          toast(`Willkommen bei „${c.name}“`)
        } catch (e) {
          fail(e)
        }
      },
      leaveCrew: async () => {
        if (!crewId) return
        try {
          await api.leaveCrew(crewId)
          setS((p) => ({ ...p, crewRef: null, remote: null, chat: [], meetups: [], declined: [] }))
          toast('Crew verlassen')
        } catch (e) {
          fail(e)
        }
      },
      restore: async (code) => {
        try {
          const g = await api.restore(code)
          setToken(g.token)
          setS((p) => ({ ...p, session: { id: g.id, token: g.token }, crewRef: null, remote: null, guest: { ...p.guest, id: g.id, nickname: g.nickname, color: g.color, secured: 'code' } }))
          const me = await api.me()
          setS((p) => ({ ...p, crewRef: me.crews[0] ?? null, plan: me.plan.length ? me.plan : p.plan }))
          toast('Profil wiederhergestellt')
          return true
        } catch (e) {
          fail(e)
          return false
        }
      },
      deleteProfile: async () => {
        try {
          if (s.session) await api.deleteMe()
          setToken(null)
          localStorage.removeItem(storageKey())
          setS(fresh())
          setStack([])
          setTabRaw('home')
          toast('Profil und alle Daten gelöscht')
        } catch (e) {
          fail(e)
        }
      },
      tab,
      setTab,
      now,
      sheet: stack[stack.length - 1] ?? null,
      sheetStack: stack,
      openSheet,
      closeSheet,
      toast,
      toastMsg,
      focusPoi,
      setFocusPoi,
      scrollTopSignal,
      set,
      toggleFav: (id) => {
        const inPlan = s.plan.includes(id)
        setS((p) => ({ ...p, plan: inPlan ? p.plan.filter((x) => x !== id) : [...p.plan, id] }))
        toast(inPlan ? `${actById[id].artist} aus deinem Plan entfernt` : `${actById[id].artist} ist in deinem Plan`, {
          label: 'Rückgängig',
          run: () => setS((p) => ({ ...p, plan: inPlan ? [...p.plan, id] : p.plan.filter((x) => x !== id) })),
        })
      },
      setAttended: (id, v) => setS((p) => ({ ...p, attended: { ...p.attended, [id]: v } })),
      resolve: (key, keep, all) => {
        setS((p) => ({
          ...p,
          plan: p.plan.filter((x) => !all.includes(x) || keep.includes(x)),
          resolved: { ...p.resolved, [key]: keep.join(',') },
        }))
        toast(keep.length > 1 ? 'Hopping geplant – beide bleiben im Plan' : `Entschieden: ${actById[keep[0]].artist}`)
      },
      toggleReminder: (id) => {
        const on = !s.reminders[id]
        setS((p) => ({ ...p, reminders: { ...p.reminders, [id]: on } }))
        if (on) scheduleReminder(id, now)
        toast(on ? 'Erinnerung 15 Min. vorher' : 'Erinnerung entfernt')
      },
      setPhase: (phase) => setS((p) => ({ ...p, phase, clockMode: 'demo' })),
      setNickname: async (nickname, color) => {
        if (online) {
          try {
            if (s.session) await api.updateMe(nickname, color)
            else await ensureSession(nickname, color)
          } catch (e) {
            return fail(e)
          }
        }
        setS((p) => ({ ...p, guest: { ...p.guest, nickname, color } }))
        const fn = pending.current
        pending.current = null
        setStack((st) => st.filter((x) => x?.kind !== 'identity'))
        if (fn) setTimeout(fn, 280)
      },
      secure: (how) => {
        if (online && how === 'code')
          return api.recovery().then(
            ({ code }) => (setS((p) => ({ ...p, guest: { ...p.guest, secured: 'code', recoveryCode: code } })), code),
            (e) => (fail(e), undefined),
          )
        const code = how === 'code' ? Array.from({ length: 4 }, () => rid().slice(0, 4).toUpperCase()).join('-') : undefined
        setS((p) => ({ ...p, guest: { ...p.guest, secured: how, recoveryCode: code } }))
        return code
      },
      requireIdentity,
      addMeetup: (m) => {
        if (online) {
          if (!crewId) return toast('Gründe zuerst eine Crew oder tritt einer bei')
          const op: OutboxOp = { id: opId('mt'), kind: 'meetup', crewId, data: { place: m.place, poi: m.poi, actId: m.actId, day: m.day, min: m.min, note: m.note } }
          setS((p) => ({ ...p, meetups: [...p.meetups, { ...m, id: op.id, going: ['me'], createdBy: 'me' }] }))
          return enqueue(op, 'Meetup erstellt – deine Crew sieht es gleich')
        }
        const id = 'm' + rid()
        setS((p) => ({ ...p, meetups: [...p.meetups, { ...m, id, going: ['me'], createdBy: 'me' }] }))
        toast('Meetup erstellt – deine Crew wurde benachrichtigt')
      },
      rsvp: (id, going) =>
        requireIdentity('Damit deine Crew sieht, wer kommt.', () => {
          if (online) enqueue({ id: opId('rs'), kind: 'rsvp', meetupId: id, going })
          setS((p) => ({
            ...p,
            meetups: p.meetups.map((m) => (m.id === id ? { ...m, going: going ? [...new Set([...m.going, 'me'])] : m.going.filter((x) => x !== 'me') } : m)),
            declined: going ? p.declined.filter((x) => x !== id) : [...new Set([...p.declined, id])],
          }))
          toast(going ? 'Du bist dabei' : 'Abgesagt')
        }),
      vote: (id, v) =>
        requireIdentity('Bestätigungen helfen allen – dafür brauchst du nur einen Namen.', () => {
          if (online && s.remoteReports.some((r) => r.id === id)) enqueue({ id: opId('vo'), kind: 'vote', reportId: id, vote: v })
          setS((p) => ({ ...p, votes: { ...p.votes, [id]: v } }))
          toast(v === 'still' ? 'Danke – als weiterhin gültig bestätigt' : 'Danke – als behoben gemeldet')
        }),
      report: (u) => {
        if (online) {
          return enqueue({ id: opId('r'), kind: 'report', data: { title: u.title, place: u.place, poi: u.poi, severity: u.severity === 'critical' ? 'warning' : u.severity } }, 'Meldung veröffentlicht · läuft in 60 Min. ab')
        }
        const nu: FestivalUpdate = { ...u, id: 'r' + rid(), ageMin: 0, source: 'unconfirmed', phases: ['before', 'arrival', 'during', 'departure'], validMin: 60, confirms: 1 }
        setS((p) => ({ ...p, myUpdates: [nu, ...p.myUpdates] }))
        toast('Meldung veröffentlicht · läuft in 60 Min. ab')
      },
      sendChat: (text) => {
        if (online) {
          if (!crewId) return toast('Gründe zuerst eine Crew oder tritt einer bei')
          const op: OutboxOp = { id: opId('m'), kind: 'message', crewId, text, at: Date.now() }
          setS((p) => ({ ...p, chat: [...p.chat, { id: op.id, from: 'me', text, min: minuteOfDay(op.at), pending: true }] }))
          return enqueue(op)
        }
        setS((p) => ({ ...p, chat: [...p.chat, { id: 'c' + rid(), from: 'me', text, min: now.min }] }))
      },
      reset: () => {
        localStorage.removeItem(storageKey())
        setS(fresh())
        setStack([])
        setTabRaw('home')
      },
    }
  }, [s, tick, tab, stack, toastMsg, focusPoi, scrollTopSignal, openSheet, closeSheet, setTab, toast, fail, refresh, ensureSession, flush, netOnline])

  return <C.Provider value={value}>{children}</C.Provider>
}

/** Groups overlapping planned acts per day into conflict clusters. */
export function conflictClusters(plan: string[], day: number, resolved: Record<string, string>) {
  const acts = plan.map((id) => actById[id]).filter((a) => a && a.day === day && !a.change?.cancelled).sort((a, b) => a.start - b.start)
  const clusters: (typeof ACTS)[] = []
  let cur: typeof ACTS = []
  let curEnd = -1
  for (const a of acts) {
    // an act joins a cluster only if it overlaps every act in it (tolerating 10 min of walking time)
    if (cur.length && a.start < curEnd - 10) {
      cur.push(a)
      curEnd = Math.min(curEnd, a.end)
    } else {
      if (cur.length > 1) clusters.push(cur)
      cur = [a]
      curEnd = a.end
    }
  }
  if (cur.length > 1) clusters.push(cur)
  return clusters
    .map((c) => ({ key: c.map((a) => a.id).sort().join('|'), acts: c, start: Math.min(...c.map((a) => a.start)), end: Math.max(...c.map((a) => a.end)) }))
    .filter((c) => !resolved[c.key])
}

/** Meetups disappear 30 minutes after they started. */
export function isMeetupActive(m: Meetup, now: { day: number; min: number }) {
  return m.day > now.day || (m.day === now.day && m.min + 30 >= now.min)
}

const timers: Record<string, number> = {}

/** Asks for notification permission and fires a local notification 15 min before the set (relative to the app clock). */
async function scheduleReminder(id: string, now: { day: number; min: number }) {
  if (!('Notification' in window)) return
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (perm !== 'granted') return
  const a = actById[id]
  if (a.day !== now.day) return
  const delay = Math.max(0, a.start - 15 - now.min) * 60_000
  window.clearTimeout(timers[id])
  timers[id] = window.setTimeout(async () => {
    const reg = await navigator.serviceWorker?.getRegistration()
    const body = `${a.artist} beginnt um ${String(Math.floor((a.start % 1440) / 60)).padStart(2, '0')}:${String(a.start % 60).padStart(2, '0')}`
    if (reg) reg.showNotification('Gleich geht’s los', { body, icon: '/icon.svg', tag: id })
    else new Notification('Gleich geht’s los', { body, icon: '/icon.svg', tag: id })
  }, delay)
}
