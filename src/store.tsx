import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ACTS, actById, CHAT, PHASE_CLOCK, type ChatMsg, type FestivalUpdate, type Phase } from './data'

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
}

const COLORS = ['#A58CFF', '#FF8A65', '#4FC3F7', '#FFD54F', '#81C784', '#F06292']
const rid = () => Math.random().toString(36).slice(2, 10)

function initial(): Persisted {
  return {
    guest: { id: 'g_' + rid() + rid(), nickname: null, color: COLORS[Math.floor(Math.random() * COLORS.length)], secured: null },
    phase: 'during',
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
  }
}

const KEY = 'realm.v2'
function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...initial(), ...JSON.parse(raw) }
  } catch {}
  return initial()
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
  | { kind: 'wrapped' }
  | { kind: 'chat' }
  | { kind: 'shared' }
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
  setNickname: (n: string, color: string) => void
  secure: (how: 'passkey' | 'code') => string | undefined
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
  const pending = useRef<(() => void) | null>(null)
  const toastTimer = useRef<number>(0)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
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

  const openSheet = useCallback((sh: SheetState) => setStack((st) => (sh ? [...st, sh] : st)), [])
  const closeSheet = useCallback(() => setStack((st) => st.slice(0, -1)), [])

  const value = useMemo<Ctx>(() => {
    const now = PHASE_CLOCK[s.phase]
    const set: Ctx['set'] = (k, v) => setS((p) => ({ ...p, [k]: v }))
    const requireIdentity: Ctx['requireIdentity'] = (reason, then) => {
      if (s.guest.nickname) return then()
      pending.current = then
      setStack((st) => [...st, { kind: 'identity', reason }])
    }
    return {
      ...s,
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
      setPhase: (phase) => setS((p) => ({ ...p, phase })),
      setNickname: (nickname, color) => {
        setS((p) => ({ ...p, guest: { ...p.guest, nickname, color } }))
        const fn = pending.current
        pending.current = null
        setStack((st) => st.filter((x) => x?.kind !== 'identity'))
        if (fn) setTimeout(fn, 280)
      },
      secure: (how) => {
        const code = how === 'code' ? Array.from({ length: 4 }, () => rid().slice(0, 4).toUpperCase()).join('-') : undefined
        setS((p) => ({ ...p, guest: { ...p.guest, secured: how, recoveryCode: code } }))
        return code
      },
      requireIdentity,
      addMeetup: (m) => {
        const id = 'm' + rid()
        setS((p) => ({ ...p, meetups: [...p.meetups, { ...m, id, going: ['me'], createdBy: 'me' }] }))
        toast('Meetup erstellt – deine Crew wurde benachrichtigt')
      },
      rsvp: (id, going) =>
        requireIdentity('Damit deine Crew sieht, wer kommt.', () => {
          setS((p) => ({
            ...p,
            meetups: p.meetups.map((m) => (m.id === id ? { ...m, going: going ? [...new Set([...m.going, 'me'])] : m.going.filter((x) => x !== 'me') } : m)),
            declined: going ? p.declined.filter((x) => x !== id) : [...new Set([...p.declined, id])],
          }))
          toast(going ? 'Du bist dabei' : 'Abgesagt')
        }),
      vote: (id, v) =>
        requireIdentity('Bestätigungen helfen allen – dafür brauchst du nur einen Namen.', () => {
          setS((p) => ({ ...p, votes: { ...p.votes, [id]: v } }))
          toast(v === 'still' ? 'Danke – als weiterhin gültig bestätigt' : 'Danke – als behoben gemeldet')
        }),
      report: (u) => {
        const nu: FestivalUpdate = { ...u, id: 'r' + rid(), ageMin: 0, source: 'unconfirmed', phases: ['before', 'arrival', 'during', 'departure'], validMin: 60, confirms: 1 }
        setS((p) => ({ ...p, myUpdates: [nu, ...p.myUpdates] }))
        toast('Meldung veröffentlicht · läuft in 60 Min. ab')
      },
      sendChat: (text) => setS((p) => ({ ...p, chat: [...p.chat, { id: 'c' + rid(), from: 'me', text, min: now.min }] })),
      reset: () => {
        localStorage.removeItem(KEY)
        setS(initial())
        setStack([])
        setTabRaw('home')
      },
    }
  }, [s, tab, stack, toastMsg, focusPoi, scrollTopSignal, openSheet, closeSheet, setTab, toast])

  return <C.Provider value={value}>{children}</C.Provider>
}

/** Groups overlapping planned acts per day into conflict clusters. */
export function conflictClusters(plan: string[], day: number, resolved: Record<string, string>) {
  const acts = plan.map((id) => actById[id]).filter((a) => a && a.day === day).sort((a, b) => a.start - b.start)
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
