import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import { House, ListMusic, Map as MapIcon, Users } from 'lucide-react'
import { DAYS, PHASES, fmt } from './data'
import { Crew } from './screens/Crew'
import { Home } from './screens/Home'
import { Lineup } from './screens/Lineup'
import { MapScreen } from './screens/MapScreen'
import { Sheets } from './sheets'
import { useApp, type Tab } from './store'
import { Avatar } from './ui'
import { Wrapped } from './screens/Wrapped'

const TABS: { id: Tab; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'lineup', label: 'Line-up', icon: ListMusic },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'crew', label: 'Crew', icon: Users },
]

export function AppBar({ floating }: { floating?: boolean }) {
  const { phase, now, openSheet } = useApp()
  const sub = phase === 'during' || phase === 'arrival' ? `${DAYS[now.day]?.label ?? ''} · ${fmt(now.min)}` : PHASES.find((p) => p.id === phase)!.hint
  return (
    <header className={`appbar ${floating ? 'floating' : ''}`}>
      <div className="logo" aria-hidden>
        R
      </div>
      <div className="title">
        <strong>Realm Open Air</strong>
        <span>{sub}</span>
      </div>
      <button className="icon-btn" aria-label="Profil & Einstellungen" onClick={() => openSheet({ kind: 'profile' })}>
        <Avatar id="me" />
      </button>
    </header>
  )
}

export default function App() {
  const { tab, setTab, toastMsg, meetups, declined, now, phase, sheet, closeSheet } = useApp()
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && closeSheet()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [closeSheet])
  const unread = phase === 'during' ? meetups.filter((m) => !m.going.includes('me') && !declined.includes(m.id) && m.day === now.day && m.min > now.min).length : 0

  return (
    <div className="stagewrap">
      <div className="side-note">
        <b>Realm</b>
        Festival-Companion V2 – Prototyp. Über den Avatar oben rechts lassen sich die Festivalphasen (Vorher → Danach) umschalten.
      </div>
      <div className="device">
        {tab !== 'map' && <AppBar />}
        {/* enter-only transition: exit animations could stall while live data re-renders the old tab */}
        <motion.div
            key={tab}
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: tab === 'map' ? 'absolute' : 'relative', inset: 0 }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === 'home' && <Home />}
            {tab === 'lineup' && <Lineup />}
            {tab === 'map' && <MapScreen />}
            {tab === 'crew' && <Crew />}
          </motion.div>

        <nav className="nav" aria-label="Hauptnavigation">
          {TABS.map((t) => {
            const on = tab === t.id
            return (
              <button key={t.id} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={() => setTab(t.id)}>
                {on && <motion.span layoutId="nav-ind" className="ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <t.icon size={22} strokeWidth={on ? 2.3 : 1.8} />
                {t.label}
                {t.id === 'crew' && unread > 0 && <span className="badge">{unread}</span>}
              </button>
            )
          })}
        </nav>

        <Sheets />
        <AnimatePresence>{sheet?.kind === 'wrapped' && <Wrapped />}</AnimatePresence>

        <AnimatePresence>
          {toastMsg && (
            <motion.div
              key={toastMsg.id}
              className="toast"
              role="status"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            >
              <span className="grow">{toastMsg.msg}</span>
              {toastMsg.action && <button onClick={toastMsg.action.run}>{toastMsg.action.label}</button>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
