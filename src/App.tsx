import { AnimatePresence, m as motion } from 'framer-motion'
import { lazy, Suspense, useEffect } from 'react'
import { CircleHelp, House, ListMusic, Map as MapIcon, Users } from 'lucide-react'
import { DAYS, FESTIVAL, on, PHASES, fmt } from './data'
import { Home } from './screens/Home'
import { Lineup } from './screens/Lineup'
import { Sheets } from './sheets'
import { useApp, type Tab } from './store'
import { Avatar, LazyBoundary } from './ui'
import { t } from './i18n'

// Less-used screens load on demand; the service worker caches them at install, so they also open offline.
const loadMap = () => import('./screens/MapScreen')
const loadCrew = () => import('./screens/Crew')
const loadWrapped = () => import('./screens/Wrapped')
const MapScreen = lazy(() => loadMap().then((m) => ({ default: m.MapScreen })))
const Crew = lazy(() => loadCrew().then((m) => ({ default: m.Crew })))
const Wrapped = lazy(() => loadWrapped().then((m) => ({ default: m.Wrapped })))

const TABS: { id: Tab; label: string; icon: typeof House }[] = [
  { id: 'home', label: t('Home'), icon: House },
  { id: 'lineup', label: t('Line-up'), icon: ListMusic },
  { id: 'map', label: t('Map'), icon: MapIcon },
  { id: 'crew', label: t('Crew'), icon: Users },
]

export function AppBar({ floating }: { floating?: boolean }) {
  const { phase, now, openSheet, clockMode, msToStart } = useApp()
  const sub =
    phase === 'during' || phase === 'arrival'
      ? `${DAYS[now.day]?.label ?? ''} · ${fmt(now.min)}`
      : clockMode === 'real'
        ? phase === 'before'
          ? t('Noch {n} Tage', { n: Math.ceil(msToStart / 86_400_000) })
          : phase === 'departure'
            ? t('Abreisetag')
            : t('Bis nächstes Jahr')
        : PHASES.find((p) => p.id === phase)!.hint
  return (
    <header className={`appbar ${floating ? 'floating' : ''}`}>
      {FESTIVAL.theme.logo ? (
        <img className="logo logo-img" src={FESTIVAL.theme.logo} alt="" />
      ) : (
        <div className="logo" aria-hidden>
          {FESTIVAL.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="title">
        <h1 className="appbar-h">{FESTIVAL.name}</h1>
        <span>{sub}</span>
      </div>
      {on('faq') && (
        <button className="icon-btn" aria-label={t('Infos & FAQ')} onClick={() => openSheet({ kind: 'faq' })}>
          <CircleHelp size={22} />
        </button>
      )}
      <button className="icon-btn" aria-label={t('Profil & Einstellungen')} onClick={() => openSheet({ kind: 'profile' })}>
        <Avatar id="me" />
      </button>
    </header>
  )
}

export default function App() {
  const { tab, setTab, toastMsg, meetups, declined, now, phase, sheet, closeSheet, outbox, netOnline, online } = useApp()
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
        {t('Festival-Companion V2 – Prototyp. Über den Avatar oben rechts lassen sich die Festivalphasen (Vorher → Danach) umschalten.')}
      </div>
      <div className="device">
        {FESTIVAL.status !== 'published' && (
          <div className="preview-banner" role="status">
            {FESTIVAL.status === 'draft' ? t('Vorschau · Entwurf – für Besucher noch nicht sichtbar') : t('Archiviert – nur lesbar')}
          </div>
        )}
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
            <LazyBoundary key={tab}>
              <Suspense fallback={<div className="screen" aria-busy="true" />}>
                {tab === 'map' && <MapScreen />}
                {tab === 'crew' && <Crew />}
              </Suspense>
            </LazyBoundary>
          </motion.div>

        <AnimatePresence>
          {online && (!netOnline || outbox.length > 0) && (
            <motion.div className="net-pill" role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
              <span className={`dot ${netOnline ? 'sync' : ''}`} />
              {netOnline
                ? outbox.length === 1
                  ? t('1 Änderung wird gesendet …')
                  : t('{n} Änderungen werden gesendet …', { n: outbox.length })
                : outbox.length
                  ? outbox.length === 1
                    ? t('Offline · 1 Änderung wartet')
                    : t('Offline · {n} Änderungen warten', { n: outbox.length })
                  : t('Offline · Plan, Karte und Timetable funktionieren weiter')}
            </motion.div>
          )}
        </AnimatePresence>

        <nav className="nav" aria-label={t('Hauptnavigation')}>
          {TABS.filter((tb) => tb.id !== 'crew' || on('crew')).map((tb) => {
            const on = tab === tb.id
            return (
              <button key={tb.id} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={() => setTab(tb.id)}>
                {on && <motion.span layoutId="nav-ind" className="ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <tb.icon size={22} strokeWidth={on ? 2.3 : 1.8} />
                {tb.label}
                {tb.id === 'crew' && unread > 0 && <span className="badge">{unread}</span>}
              </button>
            )
          })}
        </nav>

        <Sheets />
        <LazyBoundary>
          <Suspense fallback={null}>
            <AnimatePresence>{sheet?.kind === 'wrapped' && <Wrapped />}</AnimatePresence>
          </Suspense>
        </LazyBoundary>

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
