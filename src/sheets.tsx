import { AnimatePresence, motion } from 'framer-motion'
import { Bell, BellRing, Check, ChevronRight, Copy, Fingerprint, KeyRound, MessageCircle, Navigation, Plus, Send, ShieldCheck, Swords, TriangleAlert, Users, WifiOff, RotateCcw, CalendarPlus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ACTS, actById, DAYS, FRIENDS, friendById, friendsFor, fmt, ME, PHASES, POIS, stageById, UPDATES, walkMinutes, type FestivalUpdate, type UpdateSource } from './data'
import { CAT_ICON } from './screens/MapScreen'
import { ActRow } from './screens/Lineup'
import { useApp, type SheetState } from './store'
import { status, untilLabel } from './time'
import { Avatar, AvatarStack, Segmented, Sheet, SourceTag, StageDot, ago, spring } from './ui'

export function Sheets() {
  const { sheet, closeSheet } = useApp()
  // keep last content during exit animation
  const [shown, setShown] = useState<SheetState>(sheet)
  useEffect(() => {
    if (sheet) setShown(sheet)
  }, [sheet])
  const open = !!sheet && sheet.kind !== 'wrapped'
  const s = sheet ?? shown
  const full = s?.kind === 'chat' || s?.kind === 'shared' || s?.kind === 'updates'
  return (
    <Sheet open={open} onClose={closeSheet} full={full}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={JSON.stringify(s)} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
          {s?.kind === 'act' && <ActSheet id={s.id} />}
          {s?.kind === 'poi' && <PoiSheet id={s.id} />}
          {s?.kind === 'resolver' && <Resolver ids={s.ids} k={s.key} />}
          {s?.kind === 'meetup' && <MeetupSheet id={s.id} />}
          {s?.kind === 'newMeetup' && <NewMeetup {...s} />}
          {s?.kind === 'profile' && <Profile />}
          {s?.kind === 'identity' && <Identity reason={s.reason} />}
          {s?.kind === 'updates' && <Updates />}
          {s?.kind === 'report' && <Report poi={s.poi} />}
          {s?.kind === 'secure' && <Secure />}
          {s?.kind === 'chat' && <Chat />}
          {s?.kind === 'shared' && <Shared />}
          {s?.kind === 'steps' && <Steps />}
        </motion.div>
      </AnimatePresence>
    </Sheet>
  )
}

function goRoute(poi: string, app: ReturnType<typeof useApp>) {
  app.closeSheet()
  if (app.tab === 'map') window.dispatchEvent(new CustomEvent('realm:route', { detail: poi }))
  else {
    app.setFocusPoi('route:' + poi)
    app.setTab('map')
  }
}

/* ---------------- Act ---------------- */
function ActSheet({ id }: { id: string }) {
  const app = useApp()
  const { plan, toggleFav, now, reminders, toggleReminder, openSheet, requireIdentity, attended, setAttended } = app
  const a = actById[id]
  const s = stageById[a.stage]
  const st = status(a, now)
  const inPlan = plan.includes(id)
  const friends = friendsFor(id)
  const tendency = Math.round(a.popularity * 100)
  const walk = walkMinutes(ME.x, ME.y, s.x, s.y)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className={`label ${st === 'live' ? 'live' : ''}`}>{st === 'live' ? 'Live' : st === 'past' ? 'Vorbei' : `${DAYS[a.day].label} · ${untilLabel(a, now) || fmt(a.start)}`}</span>
          <h2>{a.artist}</h2>
          <div className="row muted" style={{ gap: 8 }}>
            <StageDot id={a.stage} /> {s.name} · {fmt(a.start)}–{fmt(a.end)}
          </div>
        </div>
      </div>
      <div className="sheet-actions">
        <button className={`btn ${inPlan ? 'on' : 'primary'}`} onClick={() => toggleFav(id)}>
          {inPlan ? (
            <>
              <Check size={18} /> In deinem Plan
            </>
          ) : (
            <>
              <Plus size={18} /> Zum Plan
            </>
          )}
        </button>
        <button className="btn secondary" onClick={() => goRoute('stage-' + a.stage, app)}>
          <Navigation size={17} /> {walk} Min.
        </button>
        {st !== 'past' && (
          <button className={`icon-btn filled ${reminders[id] ? 'active' : ''}`} style={{ width: 44, height: 44 }} aria-label="Erinnerung" onClick={() => toggleReminder(id)}>
            {reminders[id] ? <BellRing size={19} /> : <Bell size={19} />}
          </button>
        )}
      </div>

      {st === 'past' && inPlan && (
        <div className="card row" style={{ marginBottom: 20, padding: 14 }}>
          <span className="grow small">Warst du dabei?</span>
          <Segmented
            id="att"
            value={attended[id] === true ? 'y' : attended[id] === false ? 'n' : ('' as string)}
            onChange={(v) => setAttended(id, v === 'y')}
            options={[
              { value: 'y', label: 'Ja' },
              { value: 'n', label: 'Nein' },
            ]}
          />
        </div>
      )}

      <section style={{ marginBottom: 22 }}>
        <div className="label" style={{ marginBottom: 10 }}>
          Aus deiner Crew {friends.length ? `· ${friends.length}` : ''}
        </div>
        {friends.length ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {friends.map((f) => (
              <span key={f} className="chip" style={{ paddingLeft: 4 }}>
                <Avatar id={f} /> {friendById[f].name}
              </span>
            ))}
          </div>
        ) : (
          <p className="small faint" style={{ margin: 0 }}>
            Noch niemand – sei die erste Person.
          </p>
        )}
        {st !== 'past' && (
          <button
            className="btn ghost sm"
            style={{ marginTop: 10, paddingLeft: 0 }}
            onClick={() => requireIdentity('Damit deine Crew weiß, wer einlädt.', () => openSheet({ kind: 'newMeetup', actId: id, poi: 'stage-' + a.stage, place: s.name }))}
          >
            <CalendarPlus size={16} /> Vor diesem Set treffen
          </button>
        )}
      </section>

      <section style={{ marginBottom: 22 }}>
        <div className="label" style={{ marginBottom: 10 }}>
          Vibe
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="tag unconfirmed">{a.genre}</span>
          <span className="tag unconfirmed">{s.vibe}</span>
        </div>
        <div className="row small" style={{ marginTop: 14, gap: 10 }}>
          <span className="muted grow">Community-Tendenz</span>
          <span style={{ fontWeight: 600 }}>{tendency}%</span>
        </div>
        <div className="bar-track" style={{ marginTop: 6 }}>
          <motion.i initial={{ width: 0 }} animate={{ width: tendency + '%' }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} style={{ background: 'var(--text-2)' }} />
        </div>
      </section>
      <section>
        <div className="label" style={{ marginBottom: 8 }}>
          Über
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {a.bio}
        </p>
      </section>
    </>
  )
}

/* ---------------- POI ---------------- */
function PoiSheet({ id }: { id: string }) {
  const app = useApp()
  const { openSheet, requireIdentity, now, myUpdates, votes, vote, plan } = app
  const p = POIS.find((x) => x.id === id)!
  const I = CAT_ICON[p.cat]
  const walk = walkMinutes(ME.x, ME.y, p.x, p.y)
  const reports = [...myUpdates, ...UPDATES].filter((u) => u.poi === id && votes[u.id] !== 'fixed')
  const stageId = p.cat === 'stage' ? (p.id.replace('stage-', '') as keyof typeof stageById) : null
  const stageActs = stageId ? ACTS.filter((a) => a.stage === stageId && a.day === Math.max(0, Math.min(2, now.day)) && status(a, now) !== 'past').slice(0, 3) : []
  const statusText = p.status === 'closed' ? 'Geschlossen' : p.status === 'busy' ? 'Geöffnet · viel los' : p.status === 'open' ? 'Geöffnet' : null
  return (
    <>
      <div className="sheet-head">
        <span className="tile-icon" style={{ width: 48, height: 48, borderRadius: 14, ...(stageId ? { background: stageById[stageId].color, color: '#111' } : {}) }}>
          <I size={22} />
        </span>
        <div className="grow">
          <h2 style={{ fontSize: 24, marginTop: 0 }}>{p.name}</h2>
          <div className="small muted">
            {statusText && <span style={{ color: p.status === 'closed' ? 'var(--crit)' : p.status === 'busy' ? 'var(--warn)' : 'var(--ok)', fontWeight: 600 }}>{statusText}</span>}
            {p.confirmedMin !== undefined && <span> · vor {p.confirmedMin} Minuten bestätigt</span>}
            {!statusText && p.detail}
          </div>
          <div className="small faint" style={{ marginTop: 2 }}>
            {walk} {walk === 1 ? 'Minute' : 'Minuten'} entfernt{statusText ? ` · ${p.detail}` : ''}
          </div>
        </div>
      </div>
      <div className="sheet-actions">
        <button className="btn primary" onClick={() => goRoute(p.id, app)}>
          <Navigation size={17} /> Route
        </button>
        <button className="btn secondary" onClick={() => requireIdentity('Damit deine Crew weiß, wer einlädt.', () => openSheet({ kind: 'newMeetup', poi: p.id, place: p.name }))}>
          <Users size={17} /> Hier treffen
        </button>
        <button className="btn ghost" onClick={() => openSheet({ kind: 'report', poi: p.id })}>
          <TriangleAlert size={17} /> Problem melden
        </button>
      </div>
      {stageActs.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <div className="label">Auf dieser Stage</div>
          <div className="list">
            {stageActs.map((a) => (
              <button key={a.id} className="list-item" onClick={() => openSheet({ kind: 'act', id: a.id })}>
                <span style={{ width: 44, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: status(a, now) === 'live' ? 'var(--ok)' : undefined }}>{fmt(a.start)}</span>
                <span className="grow" style={{ fontWeight: 600 }}>
                  {a.artist}
                </span>
                {plan.includes(a.id) && <span className="tag official">Im Plan</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      {reports.length > 0 && (
        <section>
          <div className="label" style={{ marginBottom: 6 }}>
            Meldungen hier
          </div>
          {reports.map((u) => (
            <UpdateItem key={u.id} u={u} vote={vote} voted={votes[u.id]} />
          ))}
        </section>
      )}
    </>
  )
}

/* ---------------- Conflict resolver ---------------- */
function Resolver({ ids, k }: { ids: string[]; k: string }) {
  const { resolve, closeSheet } = useApp()
  const acts = ids.map((i) => actById[i])
  const [pick, setPick] = useState<string | null>(null)
  const [battle, setBattle] = useState(false)
  const start = Math.min(...acts.map((a) => a.start))
  const end = Math.max(...acts.map((a) => a.end))
  const maxFriends = Math.max(1, ...acts.map((a) => friendsFor(a.id).length))
  const totalPop = acts.reduce((s, a) => s + a.popularity, 0)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label" style={{ color: 'var(--warn)' }}>
            Überschneidung · {DAYS[acts[0].day].label}
          </span>
          <h2>
            {fmt(start)}–{fmt(end)}
          </h2>
          <div className="muted">{acts.length} Acts – wofür entscheidest du dich?</div>
        </div>
        <button className={`icon-btn filled ${battle ? 'active' : ''}`} onClick={() => setBattle(!battle)} aria-label="Battle-Modus">
          <Swords size={19} />
        </button>
      </div>
      <AnimatePresence mode="wait">
        {battle ? (
          <motion.div key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Battle
              ids={ids}
              onDone={(w) => {
                setPick(w)
                setBattle(false)
              }}
            />
          </motion.div>
        ) : (
          <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {acts.map((a) => {
              const s = stageById[a.stage]
              const f = friendsFor(a.id)
              const on = pick === a.id
              return (
                <button
                  key={a.id}
                  onClick={() => setPick(a.id)}
                  className="card"
                  style={{ textAlign: 'left', padding: 16, boxShadow: on ? 'inset 0 0 0 2px var(--brand)' : 'inset 0 0 0 1px var(--line)', transition: 'box-shadow .2s', borderLeft: `3px solid ${s.color}` }}
                >
                  <div className="row">
                    <span className="grow">
                      <span style={{ fontWeight: 700, fontSize: 17 }}>{a.artist}</span>
                      <span className="small faint" style={{ display: 'block' }}>
                        {s.name} · {fmt(a.start)}–{fmt(a.end)}
                      </span>
                    </span>
                    <span style={{ width: 24, height: 24, borderRadius: 99, display: 'grid', placeItems: 'center', background: on ? 'var(--brand)' : 'var(--surface-3)', color: 'var(--brand-ink)' }}>{on && <Check size={15} strokeWidth={3} />}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 14 }} className="tiny">
                    <Metric label="Crew" value={`${f.length}`} pct={f.length / maxFriends} />
                    <Metric label="Laufweg" value={`${walkMinutes(ME.x, ME.y, s.x, s.y)} Min.`} pct={1 - walkMinutes(ME.x, ME.y, s.x, s.y) / 12} />
                    <Metric label="Community" value={`${Math.round((a.popularity / totalPop) * 100)}%`} pct={a.popularity / totalPop} />
                  </div>
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
      {!battle && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
          <button
            className="btn primary block"
            disabled={!pick}
            onClick={() => {
              resolve(k, [pick!], ids)
              closeSheet()
            }}
          >
            {pick ? `${actById[pick].artist} behalten` : 'Act auswählen'}
          </button>
          <button
            className="btn ghost block"
            onClick={() => {
              resolve(k, ids, ids)
              closeSheet()
            }}
          >
            Alle behalten – ich hoppe
          </button>
        </div>
      )}
    </>
  )
}

function Metric({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div>
      <div className="faint">{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, margin: '2px 0 6px' }}>{value}</div>
      <div className="bar-track" style={{ height: 4 }}>
        <i style={{ width: Math.max(6, Math.min(100, pct * 100)) + '%', background: 'var(--text-2)' }} />
      </div>
    </div>
  )
}

function Battle({ ids, onDone }: { ids: string[]; onDone: (winner: string) => void }) {
  const [pool, setPool] = useState(ids)
  const [a, b] = pool
  useEffect(() => {
    if (pool.length === 1) onDone(pool[0])
  }, [pool, onDone])
  if (!b) return null
  const win = (w: string) => setPool((p) => [w, ...p.filter((x) => x !== a && x !== b)])
  return (
    <div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Bauchgefühl: Wen würdest du auf keinen Fall verpassen wollen?
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center' }}>
        {[a, b].map((id, i) => {
          const act = actById[id]
          return (
            <motion.button
              key={id + pool.length}
              initial={{ opacity: 0, x: i ? 30 : -30, rotate: i ? 3 : -3 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => win(id)}
              className="card"
              style={{ order: i * 2, minHeight: 170, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', textAlign: 'left', background: `linear-gradient(180deg, ${stageById[act.stage].color}33, var(--surface))` }}
            >
              <span className="tiny faint">{stageById[act.stage].name}</span>
              <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 21, lineHeight: 1.05, marginTop: 4 }}>{act.artist}</span>
              <span className="tiny muted" style={{ marginTop: 6 }}>
                {act.genre}
              </span>
            </motion.button>
          )
        })}
        <span style={{ order: 1, fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--text-3)' }}>vs</span>
      </div>
      <p className="tiny faint" style={{ textAlign: 'center' }}>
        Runde {ids.length - pool.length + 1} von {ids.length - 1}
      </p>
    </div>
  )
}

/* ---------------- Meetups ---------------- */
function MeetupSheet({ id }: { id: string }) {
  const app = useApp()
  const { meetups, rsvp, closeSheet, sendChat } = app
  const m = meetups.find((x) => x.id === id)
  if (!m) return null
  const going = m.going.includes('me')
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label next">
            Meetup · {DAYS[m.day]?.label} {fmt(m.min)}
          </span>
          <h2>{m.place}</h2>
          {m.note && <div className="muted">{m.note}</div>}
          {m.actId && <div className="small faint" style={{ marginTop: 4 }}>Vor {actById[m.actId].artist}</div>}
        </div>
      </div>
      <div className="sheet-actions">
        <button className={`btn ${going ? 'on' : 'primary'}`} onClick={() => rsvp(id, !going)}>
          {going ? (
            <>
              <Check size={18} /> Bin dabei
            </>
          ) : (
            'Bin dabei'
          )}
        </button>
        {m.poi && (
          <button className="btn secondary" onClick={() => goRoute(m.poi!, app)}>
            <Navigation size={17} /> Route
          </button>
        )}
        {!going && (
          <button
            className="btn ghost"
            onClick={() => {
              rsvp(id, false)
              closeSheet()
            }}
          >
            Absagen
          </button>
        )}
      </div>
      <div className="label" style={{ marginBottom: 10 }}>
        {m.going.length} zugesagt
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {m.going.map((f) => (
          <span key={f} className="chip" style={{ paddingLeft: 4 }}>
            <Avatar id={f} /> {f === 'me' ? 'Du' : friendById[f].name}
          </span>
        ))}
      </div>
      <button
        className="btn ghost sm"
        style={{ marginTop: 16, paddingLeft: 0 }}
        onClick={() => {
          sendChat(`📍 Meetup ${fmt(m.min)} · ${m.place}`)
          app.toast('Im Crew-Chat geteilt')
        }}
      >
        <MessageCircle size={16} /> Im Chat teilen
      </button>
      <p className="tiny faint" style={{ marginTop: 18 }}>
        Meetups verschwinden 30 Minuten nach Beginn automatisch. Dafür ist keine dauerhafte Standortfreigabe nötig.
      </p>
    </>
  )
}

function NewMeetup({ actId, poi, place: initialPlace, note: initialNote }: { actId?: string; poi?: string; place?: string; note?: string }) {
  const { now, phase, addMeetup, closeSheet } = useApp()
  const act = actId ? actById[actId] : undefined
  const day = act?.day ?? (phase === 'during' ? now.day : 1)
  const base = act ? act.start - 15 : phase === 'during' ? Math.ceil((now.min + 15) / 5) * 5 : 20 * 60
  const options = act ? [act.start - 30, act.start - 15, act.start - 5] : [base, base + 15, base + 30, base + 60]
  const [min, setMin] = useState(options[act ? 1 : 0])
  const [place, setPlace] = useState(initialPlace ?? '')
  const [poiId, setPoi] = useState(poi)
  const [note, setNote] = useState(initialNote ?? (act ? `Gemeinsam zu ${act.artist}` : ''))
  const suggestions = POIS.filter((p) => p.important && p.cat !== 'medical').slice(0, 8)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label">Neues Meetup</span>
          <h2>{act ? `Vor ${act.artist}` : 'Wann und wo?'}</h2>
        </div>
      </div>
      <div className="label" style={{ marginBottom: 8 }}>
        Uhrzeit · {DAYS[day]?.label ?? 'Freitag'}
      </div>
      <div className="chips" style={{ marginBottom: 18 }}>
        {options.map((o) => (
          <button key={o} className={`chip ${min === o ? 'on' : ''}`} onClick={() => setMin(o)}>
            {fmt(o)}
          </button>
        ))}
      </div>
      <div className="label" style={{ marginBottom: 8 }}>
        Treffpunkt
      </div>
      <input
        className="field"
        value={place}
        onChange={(e) => {
          setPlace(e.target.value)
          setPoi(undefined)
        }}
        placeholder="z. B. Archive Entrance"
      />
      <div className="chips" style={{ margin: '10px 0 18px' }}>
        {suggestions.map((p) => (
          <button
            key={p.id}
            className={`chip ${poiId === p.id ? 'on' : ''}`}
            onClick={() => {
              setPoi(p.id)
              setPlace(p.name)
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="label" style={{ marginBottom: 8 }}>
        Notiz
      </div>
      <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
      <button
        className="btn primary block"
        style={{ marginTop: 22 }}
        disabled={!place.trim()}
        onClick={() => {
          addMeetup({ title: note || 'Meetup', place: place.trim(), poi: poiId, actId, day, min, note })
          closeSheet()
        }}
      >
        Crew einladen
      </button>
    </>
  )
}

/* ---------------- Updates ---------------- */
function UpdateItem({ u, vote, voted }: { u: FestivalUpdate; vote: (id: string, v: 'still' | 'fixed') => void; voted?: 'still' | 'fixed' }) {
  const community = u.source === 'confirmed' || u.source === 'unconfirmed'
  return (
    <div className="list-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <SourceTag source={u.source} />
        {u.severity !== 'info' && <span className={`tag ${u.severity === 'critical' ? 'crit' : 'warn'}`}>{u.severity === 'critical' ? 'Kritisch' : 'Warnung'}</span>}
        <span className="tiny faint">
          {ago(u.ageMin)}
          {u.place ? ` · ${u.place}` : ''}
        </span>
      </div>
      <div style={{ fontWeight: 600 }}>{u.title}</div>
      {u.body && <div className="small muted">{u.body}</div>}
      {u.validMin !== undefined && <div className="tiny faint">Läuft in {u.validMin} Min. ab, wenn niemand bestätigt</div>}
      {community && (
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button className={`btn sm ${voted === 'still' ? 'on' : 'secondary'}`} onClick={() => vote(u.id, 'still')}>
            {voted === 'still' && <Check size={15} />} Stimmt noch · {(u.confirms ?? 0) + (voted === 'still' ? 1 : 0)}
          </button>
          <button className="btn ghost sm" onClick={() => vote(u.id, 'fixed')}>
            Behoben
          </button>
        </div>
      )}
    </div>
  )
}

function Updates() {
  const { phase, myUpdates, votes, vote, openSheet } = useApp()
  const [f, setF] = useState<UpdateSource | 'all'>('all')
  const all = [...myUpdates, ...UPDATES].filter((u) => u.phases.includes(phase) && votes[u.id] !== 'fixed')
  const list = all.filter((u) => f === 'all' || u.source === f)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2>Updates</h2>
          <div className="small muted">Jede Meldung mit Quelle, Alter und Gültigkeit.</div>
        </div>
        <button className="btn secondary sm" onClick={() => openSheet({ kind: 'report' })}>
          <Plus size={16} /> Melden
        </button>
      </div>
      <div className="chips" style={{ marginBottom: 8 }}>
        {(
          [
            ['all', 'Alle'],
            ['official', 'Offiziell'],
            ['confirmed', 'Bestätigt'],
            ['unconfirmed', 'Unbestätigt'],
            ['app', 'App'],
          ] as const
        ).map(([v, l]) => (
          <button key={v} className={`chip ${f === v ? 'on' : ''}`} onClick={() => setF(v)}>
            {l}
          </button>
        ))}
      </div>
      <div className="list">
        {list.map((u) => (
          <UpdateItem key={u.id} u={u} vote={vote} voted={votes[u.id]} />
        ))}
        {!list.length && (
          <div className="empty">
            <b>Alles ruhig</b>Keine Meldungen in dieser Kategorie.
          </div>
        )}
      </div>
    </>
  )
}

const REPORT_TYPES = ['Wasser leer', 'Lange Schlange', 'WC defekt', 'Sehr voll', 'Sonstiges']

function Report({ poi }: { poi?: string }) {
  const { report, closeSheet, requireIdentity } = useApp()
  const [type, setType] = useState<string | null>(null)
  const [where, setWhere] = useState(poi)
  const [text, setText] = useState('')
  const p = POIS.find((x) => x.id === where)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label">Community-Meldung</span>
          <h2>Was ist los?</h2>
          <div className="small muted">Meldungen laufen nach 60 Minuten automatisch ab, wenn niemand sie bestätigt.</div>
        </div>
      </div>
      <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 18 }}>
        {REPORT_TYPES.map((t) => (
          <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="label" style={{ marginBottom: 8 }}>
        Ort
      </div>
      <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 18 }}>
        {(p ? [p] : POIS.filter((x) => x.cat !== 'stage' && x.important)).map((x) => (
          <button key={x.id} className={`chip ${where === x.id ? 'on' : ''}`} onClick={() => setWhere(where === x.id && !poi ? undefined : x.id)}>
            {x.name}
          </button>
        ))}
      </div>
      {type === 'Sonstiges' && <textarea className="field" placeholder="Kurz beschreiben" value={text} onChange={(e) => setText(e.target.value)} />}
      <button
        className="btn primary block"
        style={{ marginTop: 18 }}
        disabled={!type || !where}
        onClick={() =>
          requireIdentity('Meldungen brauchen einen Namen, damit Missbrauch erkennbar bleibt.', () => {
            report({ title: type === 'Sonstiges' && text ? text : `${type}: ${p?.name ?? POIS.find((x) => x.id === where)!.name}`, place: POIS.find((x) => x.id === where)!.name, poi: where, severity: 'info' })
            closeSheet()
          })
        }
      >
        Veröffentlichen
      </button>
    </>
  )
}

/* ---------------- Identity & profile ---------------- */
const COLORS = ['#A58CFF', '#FF8A65', '#4FC3F7', '#FFD54F', '#81C784', '#F06292', '#4DB6AC']

function Identity({ reason }: { reason: string }) {
  const { setNickname, guest } = useApp()
  const [name, setName] = useState(guest.nickname ?? '')
  const [color, setColor] = useState(guest.color)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 350)
    return () => clearTimeout(t)
  }, [])
  return (
    <>
      <div style={{ display: 'grid', placeItems: 'center', margin: '8px 0 18px' }}>
        <motion.span key={color + name[0]} initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={spring} className="avatar xl" style={{ background: color, boxShadow: 'none' }}>
          {(name[0] ?? '?').toUpperCase()}
        </motion.span>
      </div>
      <h2 className="h-display" style={{ fontSize: 26, textAlign: 'center' }}>
        Wie soll deine Crew dich nennen?
      </h2>
      <p className="small muted" style={{ textAlign: 'center', margin: '8px 0 20px' }}>
        {reason}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) setNickname(name.trim().slice(0, 20), color)
        }}
      >
        <input ref={ref} className="field" placeholder="Spitzname" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
        <div className="row" style={{ justifyContent: 'center', gap: 10, margin: '16px 0 22px' }}>
          {COLORS.map((c) => (
            <button type="button" key={c} aria-label={'Farbe ' + c} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 99, background: c, boxShadow: color === c ? '0 0 0 3px var(--bg-elev), 0 0 0 5px #fff' : 'none', transition: 'box-shadow .2s' }} />
          ))}
        </div>
        <button className="btn primary block" disabled={!name.trim()}>
          Weiter
        </button>
      </form>
      <p className="tiny faint" style={{ textAlign: 'center', marginTop: 14 }}>
        Kein Account, keine E-Mail. Du kannst dein Profil später optional sichern.
      </p>
    </>
  )
}

function Profile() {
  const { guest, phase, setPhase, openSheet, reset, closeSheet, setTab, plan } = useApp()
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <>
      <div className="row" style={{ gap: 14, marginBottom: 22 }}>
        <Avatar id="me" size="lg" />
        <div className="grow">
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 22 }}>{guest.nickname ?? 'Gast'}</div>
          <div className="tiny faint">
            {guest.secured ? (
              <span style={{ color: 'var(--ok)' }}>Gesichert · {guest.secured === 'passkey' ? 'Passkey' : 'Recovery-Code'}</span>
            ) : (
              'Nur auf diesem Gerät gespeichert'
            )}
          </div>
        </div>
        <button className="btn secondary sm" onClick={() => openSheet({ kind: 'identity', reason: 'Ändere deinen Namen oder deine Farbe.' })}>
          {guest.nickname ? 'Bearbeiten' : 'Name wählen'}
        </button>
      </div>
      {!guest.secured && (
        <button className="tile" style={{ marginBottom: 22 }} onClick={() => openSheet({ kind: 'secure' })}>
          <span className="tile-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <ShieldCheck size={20} />
          </span>
          <span className="grow">
            <span style={{ fontWeight: 600 }}>Profil sichern</span>
            <span className="small faint" style={{ display: 'block' }}>
              Für Gerätewechsel – Passkey, Apple/Google oder Code
            </span>
          </span>
          <ChevronRight size={18} className="faint" />
        </button>
      )}

      <div className="label" style={{ marginBottom: 10 }}>
        Demo · Festivalphase
      </div>
      <div className="list" style={{ marginBottom: 22 }}>
        {PHASES.map((p) => (
          <button
            key={p.id}
            className="list-item"
            onClick={() => {
              setPhase(p.id)
              closeSheet()
              setTab('home')
            }}
          >
            <span className="grow">
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              <span className="small faint" style={{ display: 'block' }}>
                {p.hint}
              </span>
            </span>
            {phase === p.id && <Check size={18} style={{ color: 'var(--brand)' }} />}
          </button>
        ))}
      </div>

      <div className="label" style={{ marginBottom: 6 }}>
        Gerät
      </div>
      <div className="list">
        <div className="list-item">
          <WifiOff size={18} className="faint" />
          <span className="grow small">Offline verfügbar: Timetable, Karte, {plan.length} geplante Acts</span>
        </div>
        <div className="list-item small faint">ID {guest.id.slice(0, 10)}… · pseudonym</div>
        {confirmReset ? (
          <div className="list-item">
            <span className="grow small">Alle lokalen Daten löschen?</span>
            <button className="btn danger sm" onClick={reset}>
              Löschen
            </button>
            <button className="btn ghost sm" onClick={() => setConfirmReset(false)}>
              Abbrechen
            </button>
          </div>
        ) : (
          <button className="list-item small" style={{ color: 'var(--crit)' }} onClick={() => setConfirmReset(true)}>
            <RotateCcw size={18} /> Demo zurücksetzen
          </button>
        )}
      </div>
    </>
  )
}

function Secure() {
  const { secure, guest, toast, closeSheet } = useApp()
  const [code, setCode] = useState<string | undefined>(guest.recoveryCode)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label">Optional</span>
          <h2>Profil sichern</h2>
          <div className="small muted">Ohne Sicherung lässt sich dein Profil nach dem Löschen der App nicht wiederherstellen. Plan, Crew und Wrapped wären weg.</div>
        </div>
      </div>
      {code ? (
        <>
          <div className="code">{code}</div>
          <p className="small muted">Bewahre diesen Code sicher auf. Er ist der einzige Weg zurück zu deinem Profil.</p>
          <button
            className="btn secondary block"
            onClick={() => {
              navigator.clipboard?.writeText(code).catch(() => {})
              toast('Code kopiert')
            }}
          >
            <Copy size={17} /> Kopieren
          </button>
          <button className="btn ghost block" style={{ marginTop: 6 }} onClick={closeSheet}>
            Fertig
          </button>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            className="btn primary block"
            onClick={() => {
              secure('passkey')
              toast('Mit Passkey gesichert')
              closeSheet()
            }}
          >
            <Fingerprint size={18} /> Mit Passkey sichern
          </button>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn secondary grow"
              onClick={() => {
                secure('passkey')
                toast('Mit Apple gesichert')
                closeSheet()
              }}
            >
              Apple
            </button>
            <button
              className="btn secondary grow"
              onClick={() => {
                secure('passkey')
                toast('Mit Google gesichert')
                closeSheet()
              }}
            >
              Google
            </button>
          </div>
          <button className="btn ghost block" onClick={() => setCode(secure('code'))}>
            <KeyRound size={17} /> Recovery-Code erstellen
          </button>
        </div>
      )}
    </>
  )
}

/* ---------------- Crew sub pages ---------------- */
function Chat() {
  const { chat, sendChat, requireIdentity, openSheet, now } = useApp()
  const [text, setText] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [chat.length])
  return (
    <>
      <div className="sheet-head" style={{ marginBottom: 10 }}>
        <div className="grow">
          <h2 style={{ fontSize: 24 }}>Crew-Chat</h2>
          <div className="row small muted" style={{ gap: 8 }}>
            <AvatarStack ids={FRIENDS.map((f) => f.id)} max={5} /> {FRIENDS.length + 1} Personen
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 300 }}>
        {chat.map((m, i) => {
          const me = m.from === 'me'
          const showName = !me && chat[i - 1]?.from !== m.from
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', flexDirection: 'column', alignItems: me ? 'flex-end' : 'flex-start' }}>
              {showName && (
                <span className="tiny faint" style={{ margin: '8px 0 3px 4px' }}>
                  {friendById[m.from].name} · {fmt(m.min)}
                </span>
              )}
              <button className={`bubble ${me ? 'me' : 'them'}`} style={{ textAlign: 'left' }} onClick={() => setActive(active === m.id ? null : m.id)}>
                {m.text}
              </button>
              <AnimatePresence>
                {active === m.id && (
                  <motion.button
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="btn ghost sm"
                    style={{ color: 'var(--brand)' }}
                    onClick={() => {
                      setActive(null)
                      requireIdentity('Damit deine Crew weiß, wer einlädt.', () =>
                        openSheet({ kind: 'newMeetup', note: m.text.slice(0, 60), place: /archive/i.test(m.text) ? 'Archive Entrance' : undefined, poi: /archive/i.test(m.text) ? 'stage-archive' : undefined }),
                      )
                    }}
                  >
                    <CalendarPlus size={15} /> In Meetup umwandeln
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        style={{ position: 'sticky', bottom: 0, background: 'var(--bg-elev)', paddingBottom: 4 }}
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (!t) return
          requireIdentity('Damit deine Crew sieht, wer schreibt.', () => {
            sendChat(t)
            setText('')
          })
        }}
      >
        <input className="field" style={{ borderRadius: 99 }} placeholder={`Nachricht · ${fmt(now.min)}`} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="icon-btn" style={{ background: 'var(--brand)', color: 'var(--brand-ink)', width: 48, height: 48, flex: 'none' }} aria-label="Senden">
          <Send size={19} />
        </button>
      </form>
    </>
  )
}

function Shared() {
  const { plan } = useApp()
  const [day, setDay] = useState<number | 'all'>('all')
  const [friend, setFriend] = useState<string | null>(null)
  const acts = useMemo(
    () => ACTS.filter((a) => plan.includes(a.id) && (day === 'all' || a.day === day)).filter((a) => (friend ? friendsFor(a.id).includes(friend) : friendsFor(a.id).length > 0)),
    [plan, day, friend],
  )
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2 style={{ fontSize: 24 }}>Gemeinsame Acts</h2>
          <div className="small muted">Acts in deinem Plan, zu denen auch Freunde gehen.</div>
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 8 }}>
        <button className={`chip ${day === 'all' ? 'on' : ''}`} onClick={() => setDay('all')}>
          Alle Tage
        </button>
        {DAYS.map((d) => (
          <button key={d.idx} className={`chip ${day === d.idx ? 'on' : ''}`} onClick={() => setDay(d.idx)}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="chips" style={{ marginBottom: 6 }}>
        {FRIENDS.map((f) => (
          <button key={f.id} className={`chip ${friend === f.id ? 'on' : ''}`} style={{ paddingLeft: 4 }} onClick={() => setFriend(friend === f.id ? null : f.id)}>
            <Avatar id={f.id} /> {f.name}
          </button>
        ))}
      </div>
      <div className="list">
        {acts.map((a) => (
          <ActRow key={a.id} a={a} showDay={day === 'all'} />
        ))}
        {!acts.length && (
          <div className="empty">
            <b>Keine Überschneidung</b>Mit dieser Auswahl teilt ihr keinen Act.
          </div>
        )}
      </div>
    </>
  )
}

function Steps() {
  const { stepsOptIn, set, guest, requireIdentity, toast } = useApp()
  const [scope, setScope] = useState<'day' | 'fest'>('day')
  const me = { id: 'me', name: guest.nickname ?? 'Du', steps: 12840 }
  const rows = [...FRIENDS.map((f) => ({ id: f.id, name: f.name, steps: scope === 'day' ? f.steps : f.steps * 2 + 3100 })), { ...me, steps: scope === 'day' ? me.steps : me.steps * 2 + 2400 }].sort((a, b) => b.steps - a.steps)
  const max = rows[0].steps
  if (!stepsOptIn)
    return (
      <>
        <div className="sheet-head">
          <div className="grow">
            <span className="label">Crew-Challenge · Beta</span>
            <h2>Wer läuft am meisten?</h2>
          </div>
        </div>
        <div className="list" style={{ marginBottom: 20 }}>
          {['Nur deine Tagessumme wird übertragen', 'Kein Schrittverlauf, kein Standort', 'Nur innerhalb deiner Crew sichtbar', 'Jederzeit deaktivierbar – Daten werden gelöscht', 'Keine Nutzung für Werbung oder Sponsoren'].map((t) => (
            <div key={t} className="list-item small">
              <Check size={17} style={{ color: 'var(--ok)' }} /> {t}
            </div>
          ))}
        </div>
        <button
          className="btn primary block"
          onClick={() =>
            requireIdentity('Damit deine Crew dich im Ranking sieht.', () => {
              set('stepsOptIn', true)
              toast('Step-Challenge aktiviert')
            })
          }
        >
          Mitmachen
        </button>
        <p className="tiny faint" style={{ textAlign: 'center', marginTop: 12 }}>
          Automatische Schritte gibt es in der iOS- und Android-App (HealthKit / Health Connect). Im Browser siehst du das Ranking.
        </p>
      </>
    )
  const myRank = rows.findIndex((r) => r.id === 'me') + 1
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label">Step-Challenge</span>
          <h2>Platz {myRank}</h2>
          <div className="small muted">von {rows.length} in deiner Crew · Top 10 % aller 842 Teilnehmenden</div>
        </div>
      </div>
      <Segmented
        id="steps"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'day', label: 'Heute' },
          { value: 'fest', label: 'Festival' },
        ]}
      />
      <div className="list" style={{ marginTop: 14 }}>
        {rows.map((r, i) => (
          <motion.div layout key={r.id} className="list-item" transition={spring}>
            <span style={{ width: 20, fontWeight: 700, color: i < 3 ? 'var(--text)' : 'var(--text-3)' }}>{i + 1}</span>
            <Avatar id={r.id} />
            <span className="grow">
              <span className="row small" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontWeight: r.id === 'me' ? 700 : 500 }}>{r.id === 'me' ? `${r.name} (du)` : r.name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.steps.toLocaleString('de-DE')}</span>
              </span>
              <span className="bar-track" style={{ display: 'block', marginTop: 6, height: 4 }}>
                <motion.i initial={{ width: 0 }} animate={{ width: (r.steps / max) * 100 + '%' }} transition={{ duration: 0.7, delay: i * 0.03 }} style={{ background: r.id === 'me' ? 'var(--brand)' : 'var(--surface-3)', filter: r.id === 'me' ? undefined : 'brightness(1.6)' }} />
              </span>
            </span>
          </motion.div>
        ))}
      </div>
      <div className="row tiny faint" style={{ marginTop: 14 }}>
        <Sparkles size={14} /> <span className="grow">Letzter Sync vor 4 Min. · keine Preise, nur Ehre</span>
        <button className="btn ghost sm" onClick={() => set('stepsOptIn', false)}>
          Beenden
        </button>
      </div>
    </>
  )
}
