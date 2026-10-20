import { m as motion } from 'framer-motion'
import { CalendarClock, Users, ArrowRight, Bus, CalendarHeart, Car, ChevronRight, CloudSun, DoorOpen, Footprints, MapPin, Navigation, PackageSearch, Share2, Sparkles, Tent, Ticket, TriangleAlert, UserPlus } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { on, dateRange, FESTIVAL, ACTS, actById, DAYS, fmt, stageById, walkMinutes, ME } from '../data'
import { conflictClusters, isMeetupActive, useApp } from '../store'
import { nowNext, planFor, status, untilLabel } from '../time'
import { AvatarStack, SourceTag, StageDot, ago, stagger } from '../ui'

function useScrollTop() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollTopSignal } = useApp()
  useEffect(() => {
    ref.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [scrollTopSignal])
  return ref
}
export { useScrollTop }

export function Home() {
  const { phase } = useApp()
  const ref = useScrollTop()
  return (
    <main className="screen" ref={ref}>
      <motion.div key={phase} className="stack" initial="initial" animate="animate">
        {phase === 'before' && <Before />}
        {phase === 'arrival' && <Arrival />}
        {phase === 'during' && <During />}
        {phase === 'departure' && <Departure />}
        {phase === 'after' && <After />}
      </motion.div>
    </main>
  )
}

function useRelevantUpdates(n = 2) {
  const { phase, updates, votes, dismissed } = useApp()
  const all = updates.filter((u) => u.phases.includes(phase) && votes[u.id] !== 'fixed' && !dismissed.includes(u.id))
  const rank = (u: (typeof all)[0]) => (u.severity === 'critical' ? 0 : u.severity === 'warning' ? 1 : 2) * 1000 + (u.source === 'app' ? 500 : 0) + u.ageMin
  return { urgent: all.filter((u) => u.severity !== 'info' && u.source === 'official').sort((a, b) => rank(a) - rank(b))[0], top: all.sort((a, b) => rank(a) - rank(b)).slice(0, n + 1), total: all.length }
}

function Urgent() {
  const { urgent } = useRelevantUpdates()
  const { openSheet } = useApp()
  if (!urgent) return null
  return (
    <motion.button {...stagger(0)} className={`alert ${urgent.severity}`} onClick={() => openSheet({ kind: 'updates' })}>
      <TriangleAlert className="a-ic" size={20} />
      <span className="grow">
        <strong>{urgent.title}</strong>
        <span className="small muted">
          Offiziell · {ago(urgent.ageMin)}
          {urgent.place ? ` · ${urgent.place}` : ''}
        </span>
      </span>
      <ChevronRight size={18} className="faint" />
    </motion.button>
  )
}

function UpdatesModule({ i, exclude }: { i: number; exclude?: string }) {
  const { top, total } = useRelevantUpdates()
  const { openSheet } = useApp()
  const items = top.filter((u) => u.id !== exclude).slice(0, 2)
  if (!items.length) return null
  return (
    <motion.section {...stagger(i)}>
      <div className="section-h">
        <h2>Updates</h2>
        <button onClick={() => openSheet({ kind: 'updates' })}>
          Alle {total} <ChevronRight size={16} />
        </button>
      </div>
      <div className="list">
        {items.map((u) => (
          <button key={u.id} className="list-item" onClick={() => openSheet(u.poi ? { kind: 'poi', id: u.poi } : { kind: 'updates' })}>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{u.title}</div>
              <div className="row tiny faint" style={{ gap: 8, marginTop: 5 }}>
                <SourceTag source={u.source} />
                <span>{ago(u.ageMin)}</span>
                {u.place && <span className="ellipsis">{u.place}</span>}
              </div>
            </div>
            <ChevronRight size={18} className="faint" />
          </button>
        ))}
      </div>
    </motion.section>
  )
}

function NowNextHero() {
  const { crew } = useApp()
  const { plan, now, openSheet, setTab, setFocusPoi } = useApp()
  const { live, next } = nowNext(plan, now)
  const focus = next ?? live
  if (!focus) {
    return (
      <motion.div {...stagger(1)} className="hero">
        <span className="label">Heute</span>
        <h1>Nichts mehr geplant.</h1>
        <p className="meta">Entdecke, was noch läuft – oder gönn dir eine Pause.</p>
        <div className="actions">
          <button className="btn primary" onClick={() => setTab('lineup')}>
            Line-up öffnen
          </button>
        </div>
      </motion.div>
    )
  }
  const isLive = status(focus, now) === 'live'
  const friends = crew.friendsFor(focus.id)
  const stage = stageById[focus.stage]
  const walk = walkMinutes(ME.x, ME.y, stage.x, stage.y)
  const pct = isLive ? ((now.min - focus.start) / (focus.end - focus.start)) * 100 : 0
  return (
    <motion.div {...stagger(1)} className="hero">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`label ${isLive ? 'live' : 'next'}`}>{isLive ? 'Jetzt' : 'Als Nächstes'}</span>
        {live && next && (
          <button className="tiny muted" onClick={() => openSheet({ kind: 'act', id: live.id })}>
            Gerade: {live.artist}
          </button>
        )}
      </div>
      <h1>{focus.artist}</h1>
      <div className="meta row" style={{ gap: 8 }}>
        <StageDot id={focus.stage} />
        {stage.name} · {fmt(focus.start)}–{fmt(focus.end)}
      </div>
      <div className="row small" style={{ marginTop: 12, gap: 10 }}>
        <span style={{ fontWeight: 600 }}>{untilLabel(focus, now)}</span>
        {friends.length > 0 && (
          <>
            <span className="faint">·</span>
            <AvatarStack ids={friends} />
            <span className="muted">{friends.length} Freunde gehen hin</span>
          </>
        )}
      </div>
      {isLive && (
        <div className="progress">
          <motion.i initial={{ width: 0 }} animate={{ width: pct + '%' }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
        </div>
      )}
      <div className="actions">
        <button
          className="btn primary"
          onClick={() => {
            setFocusPoi('route:stage-' + focus.stage)
            setTab('map')
          }}
        >
          <Navigation size={17} /> Route · {walk} Min.
        </button>
        <button className="btn secondary" onClick={() => openSheet({ kind: 'act', id: focus.id })}>
          Details
        </button>
      </div>
    </motion.div>
  )
}

function MeetupModule({ i }: { i: number }) {
  const { meetups, now, openSheet, rsvp, declined } = useApp()
  const m = meetups.filter((m) => m.day === now.day && isMeetupActive(m, now) && !declined.includes(m.id)).sort((a, b) => a.min - b.min)[0]
  if (!m) return null
  const going = m.going.includes('me')
  return (
    <motion.section {...stagger(i)} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <button className="grow" style={{ textAlign: 'left' }} onClick={() => openSheet({ kind: 'meetup', id: m.id })}>
        <span className="label">Meetup um {fmt(m.min)}</span>
        <div style={{ fontWeight: 600, fontSize: 17, marginTop: 4 }}>{m.place}</div>
        <div className="row small muted" style={{ marginTop: 6, gap: 8 }}>
          <AvatarStack ids={m.going} />
          {m.going.length} zugesagt
        </div>
      </button>
      {going ? (
        <span className="tag ok">Dabei</span>
      ) : (
        <button className="btn primary sm" onClick={() => rsvp(m.id, true)}>
          Bin dabei
        </button>
      )}
    </motion.section>
  )
}

function CrewPeek({ i }: { i: number }) {
  const { crew } = useApp()
  const { setTab, stepsOptIn } = useApp()
  const byStage = crew.members.filter((f) => f.at && f.at !== 'camp').reduce<Record<string, string[]>>((acc, f) => ((acc[f.at!] ??= []).push(f.id), acc), {})
  const top = Object.entries(byStage).sort((a, b) => b[1].length - a[1].length)[0]
  if (!top)
    return (
      <motion.section {...stagger(i)}>
        <button className="tile" onClick={() => setTab('crew')}>
          <span className="tile-icon">
            <Users size={20} />
          </span>
          <span className="grow">
            <span style={{ fontWeight: 600 }}>{crew.members.length ? `${crew.members.length} in deiner Crew` : 'Crew starten'}</span>
            <span className="small faint" style={{ display: 'block' }}>
              {crew.members.length ? 'Niemand teilt gerade den Standort' : 'Freunde einladen, Meetups planen'}
            </span>
          </span>
          <ChevronRight size={18} className="faint" />
        </button>
      </motion.section>
    )
  return (
    <motion.section {...stagger(i)}>
      <button className="tile" onClick={() => setTab('crew')}>
        <AvatarStack ids={top[1]} />
        <span className="grow">
          <span style={{ fontWeight: 600 }}>
            {top[1].length} Freunde bei {stageById[top[0] as keyof typeof stageById].name}
          </span>
          <span className="small faint" style={{ display: 'block' }}>
            {stepsOptIn ? 'Du liegst auf Platz 3 der Step-Challenge' : 'Crew öffnen'}
          </span>
        </span>
        <ChevronRight size={18} className="faint" />
      </button>
    </motion.section>
  )
}

function AttendPrompt({ i }: { i: number }) {
  const { plan, now, attended, setAttended } = useApp()
  const a = plan.map((id) => actById[id]).find((a) => a && status(a, now) === 'past' && attended[a.id] === undefined)
  if (!a) return null
  return (
    <motion.section {...stagger(i)} className="card" style={{ padding: 16 }}>
      <div className="small muted">Für deinen Festival-Rückblick</div>
      <div style={{ fontWeight: 600, margin: '4px 0 12px' }}>Warst du bei {a.artist}?</div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn secondary sm" onClick={() => setAttended(a.id, true)}>
          Ja, war da
        </button>
        <button className="btn ghost sm" onClick={() => setAttended(a.id, false)}>
          Nicht geschafft
        </button>
      </div>
    </motion.section>
  )
}

/** Changes to acts in your plan that still lie ahead – the one thing worth interrupting for. */
function PlanChanges({ i }: { i: number }) {
  const { plan, now, openSheet } = useApp()
  const changed = plan
    .map((id) => actById[id])
    .filter((a) => a?.change && status(a, now) !== 'past')
    .sort((a, b) => a.day - b.day || a.start - b.start)
  if (!changed.length) return null
  const a = changed[0]
  const c = a.change!
  return (
    <motion.button {...stagger(i)} className={`alert ${c.cancelled ? 'critical' : 'warning'}`} onClick={() => openSheet({ kind: 'act', id: a.id })}>
      <CalendarClock className="a-ic" size={20} />
      <span className="grow">
        <strong>
          {a.artist}: {c.cancelled ? 'abgesagt' : [c.moved && `jetzt ${fmt(a.start)}`, c.restaged && `auf ${stageById[a.stage].name}`].filter(Boolean).join(', ')}
        </strong>
        <span className="small muted">
          Änderung in deinem Plan{changed.length > 1 ? ` · +${changed.length - 1} weitere` : ''}
        </span>
      </span>
      <ChevronRight size={18} className="faint" />
    </motion.button>
  )
}

function During() {
  const { urgent } = useRelevantUpdates()
  return (
    <>
      <Urgent />
      <PlanChanges i={0} />
      <NowNextHero />
      {on('crew') && <MeetupModule i={2} />}
      <UpdatesModule i={3} exclude={urgent?.id} />
      <AttendPrompt i={4} />
      {on('crew') && <CrewPeek i={5} />}
    </>
  )
}

function Countdown() {
  const { msToStart } = useApp()
  const total = Math.max(0, Math.floor(msToStart / 60_000))
  const parts = [
    [Math.floor(total / 1440), 'Tage'],
    [Math.floor((total % 1440) / 60), 'Std.'],
    [total % 60, 'Min.'],
  ] as const
  return (
    <motion.div {...stagger(0)} className="hero">
      <span className="label next">{FESTIVAL.name}</span>
      <div className="row" style={{ gap: 18, margin: '14px 0 6px', alignItems: 'flex-end' }}>
        {parts.map(([n, l]) => (
          <div key={l}>
            <div className="h-display" style={{ fontSize: 52, fontVariantNumeric: 'tabular-nums' }}>
              {String(n).padStart(2, '0')}
            </div>
            <div className="tiny muted">{l}</div>
          </div>
        ))}
      </div>
      <p className="meta">
        {dateRange()}
        {FESTIVAL.location ? ` · ${FESTIVAL.location}` : ''}
      </p>
    </motion.div>
  )
}

function Before() {
  const { plan, resolved, setTab, openSheet, requireIdentity, toast, online, inviteLink } = useApp()
  const conflicts = DAYS.flatMap((d) => conflictClusters(plan, d.idx, resolved))
  return (
    <>
      <Countdown />
      <PlanChanges i={1} />
      <motion.section {...stagger(1)}>
        <button className="tile" onClick={() => setTab('lineup')}>
          <span className="tile-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <CalendarHeart size={20} />
          </span>
          <span className="grow">
            <span style={{ fontWeight: 600 }}>Plan fortsetzen</span>
            <span className="small faint" style={{ display: 'block' }}>
              {plan.length} Acts gemerkt · {ACTS.length - plan.length} noch zu entdecken
            </span>
          </span>
          <ChevronRight size={18} className="faint" />
        </button>
      </motion.section>
      {conflicts.length > 0 && (
        <motion.section {...stagger(2)}>
          <button className="conflict" onClick={() => openSheet({ kind: 'resolver', ids: conflicts[0].acts.map((a) => a.id), key: conflicts[0].key })}>
            <TriangleAlert className="a-ic" size={20} />
            <span className="grow">
              <strong>{conflicts.length} Überschneidungen</strong> in deinem Plan
              <span className="small muted" style={{ display: 'block' }}>
                {DAYS[conflicts[0].acts[0].day].short} {fmt(conflicts[0].start)}–{fmt(conflicts[0].end)} · {conflicts[0].acts.length} Acts
              </span>
            </span>
            <span className="go">Entscheiden</span>
          </button>
        </motion.section>
      )}
      <UpdatesModule i={3} />
      {on('crew') && (
      <motion.section {...stagger(4)} className="card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className="tile-icon">
            <UserPlus size={20} />
          </span>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Crew einladen</div>
            <div className="small muted" style={{ marginTop: 2 }}>
              Seht, wer wo hingeht, und plant Meetups. Kein Account nötig.
            </div>
          </div>
        </div>
        <button
          className="btn secondary block"
          style={{ marginTop: 14 }}
          onClick={() =>
            requireIdentity('Damit deine Freunde wissen, von wem die Einladung kommt.', () => {
              const link = online ? inviteLink() : `${location.origin}/?join=DEMO-CREW`
              if (!link) return setTab('crew')
              navigator.clipboard?.writeText(link).catch(() => {})
              toast('Einladungslink kopiert')
            })
          }
        >
          <Share2 size={17} /> Einladungslink teilen
        </button>
      </motion.section>
      )}
    </>
  )
}

function InfoTile({ icon: Icon, title, sub, onClick, i, tone }: { icon: typeof Bus; title: string; sub: string; onClick?: () => void; i: number; tone?: 'ok' | 'warn' }) {
  return (
    <motion.button {...stagger(i)} className="tile" onClick={onClick}>
      <span className="tile-icon" style={tone ? { background: `var(--${tone}-soft)`, color: `var(--${tone})` } : undefined}>
        <Icon size={20} />
      </span>
      <span className="grow">
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span className="small faint" style={{ display: 'block' }}>
          {sub}
        </span>
      </span>
      <ChevronRight size={18} className="faint" />
    </motion.button>
  )
}

function Arrival() {
  const { setTab, setFocusPoi, openSheet } = useApp()
  const go = (poi: string) => {
    setFocusPoi('route:' + poi)
    setTab('map')
  }
  return (
    <>
      <motion.div {...stagger(0)} className="hero">
        <span className="label next">Anreise · Tag 1</span>
        <h1>Willkommen, die Tore sind offen.</h1>
        <p className="meta">Erster Act: Sol Arcadia um 15:00 · Lagoon</p>
        <div className="actions">
          <button className="btn primary" onClick={() => go('en1')}>
            <Navigation size={17} /> Zum Eingang
          </button>
          <button className="btn secondary" onClick={() => openSheet({ kind: 'poi', id: 'en1' })}>
            <Ticket size={17} /> Einlass-Infos
          </button>
        </div>
      </motion.div>
      <div className="list" style={{ gap: 8 }}>
        <InfoTile i={1} icon={Bus} title="Shuttle ab Bahnhof" sub="Nächste Abfahrt 11:50 · alle 10 Min." onClick={() => openSheet({ kind: 'poi', id: 'sh1' })} tone="ok" />
        <InfoTile i={2} icon={DoorOpen} title="Eingang Nord · ca. 25 Min." sub="Eingang Süd ist gerade schneller (5 Min.)" onClick={() => go('en2')} tone="warn" />
        <InfoTile i={3} icon={Tent} title="Camping B · Reihe 14" sub="Dein Zeltplatz · 9 Min. vom Eingang" onClick={() => go('cp1')} />
        <InfoTile i={4} icon={CloudSun} title="24° und sonnig" sub="Ab 22:30 Gewitter möglich – Regenjacke einpacken" />
      </div>
      <UpdatesModule i={5} />
    </>
  )
}

function Departure() {
  const { setTab, setFocusPoi, openSheet } = useApp()
  return (
    <>
      <motion.div {...stagger(0)} className="hero">
        <span className="label next">Abreise</span>
        <h1>Komm gut nach Hause.</h1>
        <p className="meta">Letztes Shuttle zum Bahnhof: 18:30</p>
        <div className="actions">
          <button
            className="btn primary"
            onClick={() => {
              setFocusPoi('route:sh1')
              setTab('map')
            }}
          >
            <Navigation size={17} /> Zum Shuttle
          </button>
        </div>
      </motion.div>
      <div className="list" style={{ gap: 8 }}>
        <InfoTile i={1} icon={Bus} title="Shuttle 11:25" sub="In 10 Min. · Terminal Süd-Ost · Takt erhöht" tone="ok" onClick={() => openSheet({ kind: 'poi', id: 'sh1' })} />
        <InfoTile i={2} icon={Car} title="A7 Richtung Hamburg" sub="+35 Min. Verzögerung · Community bestätigt" tone="warn" onClick={() => openSheet({ kind: 'updates' })} />
        <InfoTile i={3} icon={PackageSearch} title="Lost & Found" sub="Bis Montag 14 Uhr im Info-Zelt" onClick={() => openSheet({ kind: 'poi', id: 'in1' })} />
      </div>
      <motion.section {...stagger(4)} className="card">
        <span className="label">Bald verfügbar</span>
        <div style={{ fontWeight: 600, marginTop: 6 }}>Dein Festival Wrapped</div>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Bestätige noch kurz, welche Sets du wirklich gesehen hast – damit dein Rückblick stimmt.
        </p>
      </motion.section>
      <AttendPrompt i={5} />
    </>
  )
}

function After() {
  const { openSheet, plan, attended } = useApp()
  const seen = Object.values(attended).filter(Boolean).length
  return (
    <>
      {on('wrapped') && (
      <motion.button
        {...stagger(0)}
        onClick={() => openSheet({ kind: 'wrapped' })}
        className="hero"
        style={{ textAlign: 'left', background: 'linear-gradient(150deg, #6b4dff 0%, #ff6b5a 100%)', boxShadow: 'none', minHeight: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
      >
        <Sparkles size={28} style={{ position: 'absolute', top: 22, right: 22 }} />
        <span className="label" style={{ color: 'rgba(255,255,255,.75)' }}>
          Festival Wrapped
        </span>
        <h1 style={{ fontSize: 46 }}>Dein {FESTIVAL.name}.</h1>
        <p className="meta" style={{ color: 'rgba(255,255,255,.85)' }}>
          {seen} Sets gesehen · {plan.length} im Plan · 3 Tage
        </p>
        <span className="btn" style={{ background: '#fff', color: '#111', alignSelf: 'flex-start', marginTop: 16 }}>
          Ansehen <ArrowRight size={17} />
        </span>
      </motion.button>
      )}
      <motion.section {...stagger(1)}>
        <div className="section-h">
          <h2>Deine Timeline</h2>
        </div>
        <div className="list">
          {DAYS.map((d) => {
            const acts = planFor(plan, d.idx)
            return (
              <div key={d.idx} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 34, fontWeight: 700 }}>{d.short}</div>
                <div className="grow small muted">
                  {acts.map((a) => (
                    <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 10, opacity: attended[a.id] === false ? 0.4 : 1, textDecoration: attended[a.id] === false ? 'line-through' : undefined }}>
                      <StageDot id={a.stage} />
                      {a.artist}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </motion.section>
      <motion.section {...stagger(2)}>
        <button className="tile" onClick={() => openSheet({ kind: 'secure' })}>
          <span className="tile-icon">
            <MapPin size={20} />
          </span>
          <span className="grow">
            <span style={{ fontWeight: 600 }}>Erinnerungen sichern</span>
            <span className="small faint" style={{ display: 'block' }}>
              Ohne Sicherung geht dein Profil beim Gerätewechsel verloren.
            </span>
          </span>
          <ChevronRight size={18} className="faint" />
        </button>
      </motion.section>
      <motion.section {...stagger(3)} className="card row">
        <Footprints size={20} className="faint" />
        <span className="small muted grow">Bis zum nächsten {FESTIVAL.name}!</span>
      </motion.section>
    </>
  )
}
