import { ReportAbuse, ModerationInbox } from './Moderation'
import { AnimatePresence, m as motion } from 'framer-motion'
import { Trash2, Crown, UserMinus, Bell, BellRing, Check, ChevronRight, Copy, KeyRound, MessageCircle, Navigation, Plus, Send, ShieldCheck, Swords, TriangleAlert, Users, WifiOff, RotateCcw, CalendarPlus, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { switchFestival } from './festival'
import { dropOtherBundles, usage, type StorageUsage } from './persist'
const FaqSheet = lazy(() => import('./FaqSheet').then((m) => ({ default: m.FaqSheet })))
const FestivalChat = lazy(() => import('./FestivalChat').then((m) => ({ default: m.FestivalChat })))
import { api } from './api'
import { on, FESTIVAL, ACTS, actById, DAYS, fmt, PHASES, POIS, stageById, walkMinutes, type FestivalUpdate, type UpdateSource } from './data'
import { CAT_ICON } from './screens/mapIcons'
import { downloadIcs } from './calendar/download'
import { ActRow } from './screens/Lineup'
import { useApp, type SheetState } from './store'
import { status, untilLabel } from './time'
import { t, num, setLang, LANGS, lang } from './i18n'
import { Avatar, AvatarStack, Segmented, Sheet, SourceTag, StageDot, ago, spring, LazyBoundary, Switch } from './ui'

export function Sheets() {
  const { sheet, closeSheet } = useApp()
  // keep last content during exit animation
  const [shown, setShown] = useState<SheetState>(sheet)
  useEffect(() => {
    if (sheet) setShown(sheet)
  }, [sheet])
  const open = !!sheet && sheet.kind !== 'wrapped'
  const s = sheet ?? shown
  const full = s?.kind === 'chat' || s?.kind === 'shared' || s?.kind === 'updates' || s?.kind === 'faq' || s?.kind === 'festivalChat'
  return (
    <Sheet open={open} onClose={closeSheet} full={full} label={sheetLabel(s)}>
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
          {s?.kind === 'restore' && <Restore />}
          {s?.kind === 'chat' && <Chat />}
          {s?.kind === 'shared' && <Shared />}
          {s?.kind === 'members' && <Members />}
          {s?.kind === 'faq' && (
            <LazyBoundary>
              <Suspense fallback={<p className="muted small">{t('Lade …')}</p>}>
                <FaqSheet q={s.q} />
              </Suspense>
            </LazyBoundary>
          )}
          {s?.kind === 'steps' && <Steps />}
          {s?.kind === 'place' && <PlacePicker then={s.then} />}
          {s?.kind === 'legal' && <LegalSheet doc={s.doc} />}
          {s?.kind === 'festivalChat' && (
            <LazyBoundary>
              <Suspense fallback={<p className="muted small">{t('Lade …')}</p>}>
                <FestivalChat />
              </Suspense>
            </LazyBoundary>
          )}
        </motion.div>
      </AnimatePresence>
    </Sheet>
  )
}

function sheetLabel(s: SheetState): string {
  switch (s?.kind) {
    case 'act':
      return actById[s.id]?.artist ?? t('Act')
    case 'poi':
      return POIS.find((p) => p.id === s.id)?.name ?? t('Ort')
    case 'resolver':
      return t('Überschneidung entscheiden')
    case 'meetup':
      return t('Meetup')
    case 'newMeetup':
      return t('Neues Meetup')
    case 'profile':
      return t('Profil & Einstellungen')
    case 'identity':
      return t('Name wählen')
    case 'updates':
      return t('Updates')
    case 'report':
      return t('Problem melden')
    case 'secure':
      return t('Profil sichern')
    case 'restore':
      return t('Profil wiederherstellen')
    case 'chat':
      return t('Crew-Chat')
    case 'shared':
      return t('Gemeinsame Acts')
    case 'members':
      return t('Mitglieder')
    case 'faq':
      return t('Infos & FAQ')
    case 'steps':
      return t('Step-Challenge')
    case 'festivalChat':
      return t('Festival-Chat')
    case 'place':
      return t('Wo bist du gerade?')
    case 'legal':
      return s.doc === 'imprint' ? t('Impressum') : t('Datenschutz')
    default:
      return t('Dialog')
  }
}

/** The visitor names their position; the app never guesses one. */
function PlacePicker({ then }: { then?: string }) {
  const app = useApp()
  const { set, myPlace, closeSheet, toast } = app
  const [q, setQ] = useState('')
  const places = POIS.filter((p) => (p.cat === 'stage' || p.important || p.cat === 'entrance' || p.cat === 'camping') && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2>{t('Wo bist du gerade?')}</h2>
          <div className="small muted">{t('Wähle den Ort, an dem du bist. Die App ermittelt keinen Standort – Entfernungen sind grobe Luftlinien.')}</div>
        </div>
      </div>
      <div className="search" style={{ marginBottom: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Ort suchen')} aria-label={t('Ort suchen')} />
      </div>
      <div className="list">
        {places.map((p) => {
          const I = CAT_ICON[p.cat]
          return (
            <button
              key={p.id}
              className="list-item"
              aria-pressed={myPlace === p.id}
              onClick={() => {
                set('myPlace', p.id)
                toast(t('Standort: {place}', { place: p.name }))
                closeSheet()
                // continue to the requested direction; the map picks it up together with the new place
                if (then) {
                  app.setFocusPoi('route:' + then)
                  app.setTab('map')
                }
              }}
            >
              <I size={18} className="faint" />
              <span className="grow" style={{ fontWeight: 600 }}>
                {p.name}
              </span>
              {myPlace === p.id && <Check size={18} style={{ color: 'var(--brand)' }} />}
            </button>
          )
        })}
      </div>
      {myPlace && (
        <button
          className="btn ghost sm"
          style={{ marginTop: 12 }}
          onClick={() => {
            set('myPlace', null)
            closeSheet()
          }}
        >
          {t('Standort vergessen')}
        </button>
      )}
    </>
  )
}

function goRoute(poi: string, app: ReturnType<typeof useApp>) {
  // no known position, no route: ask first, then continue (audit F04)
  if (!app.here) return app.openSheet({ kind: 'place', then: poi })
  app.closeSheet()
  if (app.tab === 'map') window.dispatchEvent(new CustomEvent('realm:route', { detail: poi }))
  else {
    app.setFocusPoi('route:' + poi)
    app.setTab('map')
  }
}

/* ---------------- Act ---------------- */
function ActSheet({ id }: { id: string }) {
  const { crew } = useApp()
  const app = useApp()
  const { plan, toggleFav, now, reminders, toggleReminder, openSheet, requireIdentity, attended, setAttended } = app
  const a = actById[id]
  const s = stageById[a.stage]
  const st = status(a, now)
  const inPlan = plan.includes(id)
  const friends = crew.friendsFor(id)
  const tendency = Math.round(a.popularity * 100)
  const walk = app.here ? walkMinutes(app.here.x, app.here.y, s.x, s.y) : null
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className={`label ${st === 'live' ? 'live' : ''}`}>{st === 'live' ? t('Live') : st === 'past' ? t('Vorbei') : `${DAYS[a.day].label} · ${untilLabel(a, now) || fmt(a.start)}`}</span>
          <h2>{a.artist}</h2>
          <div className="row muted" style={{ gap: 8 }}>
            <StageDot id={a.stage} /> {s.name} · {fmt(a.start)}–{fmt(a.end)}
          </div>
        </div>
      </div>
      {a.change && (
        <div className={`alert ${a.change.cancelled ? 'critical' : 'warning'}`} style={{ marginBottom: 16 }}>
          <TriangleAlert className="a-ic" size={20} />
          <span className="grow">
            <strong>
              {a.change.cancelled
                ? t('Dieser Auftritt wurde abgesagt')
                : [a.change.moved && t('Neue Zeit: {time} (statt {was})', { time: `${fmt(a.start)}–${fmt(a.end)}`, was: fmt(a.change.was.start) }), a.change.restaged && t('Neue Bühne: {stage}', { stage: stageById[a.stage].name })].filter(Boolean).join(' · ')}
            </strong>
            <span className="small muted">{t('Offiziell')}{a.change.note ? ` · ${a.change.note}` : ''}</span>
          </span>
        </div>
      )}
      <div className="sheet-actions">
        <button className={`btn ${inPlan ? 'on' : 'primary'}`} onClick={() => toggleFav(id)}>
          {inPlan ? (
            <>
              <Check size={18} /> {t('In deinem Plan')}
            </>
          ) : (
            <>
              <Plus size={18} /> {t('Zum Plan')}
            </>
          )}
        </button>
        <button className="btn secondary" onClick={() => goRoute('stage-' + a.stage, app)}>
          <Navigation size={17} /> {walk === null ? t('Richtung zeigen') : t('ca. {n} Min.', { n: walk })}
        </button>
        {st !== 'past' && (
          <button className={`icon-btn filled ${reminders[id] ? 'active' : ''}`} style={{ width: 44, height: 44 }} aria-label={t('Erinnerung')} aria-pressed={!!reminders[id]} onClick={() => toggleReminder(id)}>
            {reminders[id] ? <BellRing size={19} /> : <Bell size={19} />}
          </button>
        )}
        {st !== 'past' && !a.change?.cancelled && (
          <button className="icon-btn filled" style={{ width: 44, height: 44 }} aria-label={t('In den Kalender')} onClick={() => downloadIcs([a], a.artist)}>
            <CalendarPlus size={19} />
          </button>
        )}
      </div>

      {st === 'past' && inPlan && (
        <div className="card row" style={{ marginBottom: 20, padding: 14 }}>
          <span className="grow small">{t('Warst du dabei?')}</span>
          <Segmented
            id="att"
            value={attended[id] === true ? 'y' : attended[id] === false ? 'n' : ('' as string)}
            onChange={(v) => setAttended(id, v === 'y')}
            options={[
              { value: 'y', label: t('Ja') },
              { value: 'n', label: t('Nein') },
            ]}
          />
        </div>
      )}

      <section style={{ marginBottom: 22 }}>
        <div className="label" style={{ marginBottom: 10 }}>
          {t('Aus deiner Crew')} {friends.length ? `· ${friends.length}` : ''}
        </div>
        {friends.length ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {friends.map((f) => (
              <span key={f} className="chip" style={{ paddingLeft: 4 }}>
                <Avatar id={f} /> {(crew.byId[f]?.name ?? t('Gast'))}
              </span>
            ))}
          </div>
        ) : (
          <p className="small faint" style={{ margin: 0 }}>
            {t('Noch niemand – sei die erste Person.')}
          </p>
        )}
        {st !== 'past' && on('crew') && (
          <button
            className="btn ghost sm"
            style={{ marginTop: 10, paddingLeft: 0 }}
            onClick={() => requireIdentity(t('Damit deine Crew weiß, wer einlädt.'), () => openSheet({ kind: 'newMeetup', actId: id, poi: 'stage-' + a.stage, place: s.name }))}
          >
            <CalendarPlus size={16} /> {t('Vor diesem Set treffen')}
          </button>
        )}
      </section>

      <section style={{ marginBottom: 22 }}>
        <div className="label" style={{ marginBottom: 10 }}>
          {t('Vibe')}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="tag unconfirmed">{a.genre}</span>
          <span className="tag unconfirmed">{s.vibe}</span>
        </div>
        <div className="row small" style={{ marginTop: 14, gap: 10 }}>
          <span className="muted grow">{t('Community-Tendenz')}</span>
          <span style={{ fontWeight: 600 }}>{tendency}%</span>
        </div>
        <div className="bar-track" style={{ marginTop: 6 }}>
          <motion.i initial={{ width: 0 }} animate={{ width: tendency + '%' }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} style={{ background: 'var(--text-2)' }} />
        </div>
      </section>
      <section>
        <div className="label" style={{ marginBottom: 8 }}>
          {t('Über')}
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
  const { openSheet, requireIdentity, now, updates, votes, vote, plan } = app
  const p = POIS.find((x) => x.id === id)!
  const I = CAT_ICON[p.cat]
  const walk = app.here ? walkMinutes(app.here.x, app.here.y, p.x, p.y) : null
  // help points get no pseudo-precise guidance: in an emergency people need staff and signs (audit F04/D02)
  const safety = p.cat === 'medical' || p.cat === 'entrance'
  const reports = updates.filter((u) => u.poi === id && votes[u.id] !== 'fixed')
  const stageId = p.cat === 'stage' ? (p.id.replace('stage-', '') as keyof typeof stageById) : null
  const stageActs = stageId ? ACTS.filter((a) => a.stage === stageId && a.day === Math.max(0, Math.min(DAYS.length - 1, now.day)) && status(a, now) !== 'past').slice(0, 3) : []
  const statusText = p.status === 'closed' ? t('Geschlossen') : p.status === 'busy' ? t('Geöffnet · viel los') : p.status === 'open' ? t('Geöffnet') : null
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
            {p.confirmedMin !== undefined && <span> · {t('vor {n} Minuten bestätigt', { n: p.confirmedMin })}</span>}
            {!statusText && p.detail}
          </div>
          <div className="small faint" style={{ marginTop: 2 }}>
            {walk === null ? (
              <button className="link" onClick={() => openSheet({ kind: 'place' })}>
                {t('Entfernung: erst Standort wählen')}
              </button>
            ) : (
              t('ca. {n} Min. Luftlinie von {place}', { n: walk, place: app.here!.label })
            )}
            {statusText ? ` · ${p.detail}` : ''}
          </div>
        </div>
      </div>
      {p.cat === 'medical' && (
        <div className="alert critical" role="note" style={{ marginBottom: 14 }}>
          <TriangleAlert className="a-ic" size={20} />
          <span className="grow">
            <strong>{t('Im Notfall: 112')}</strong>
            <span className="small muted">{t('Sprich Personal oder Security direkt an und folge der Beschilderung vor Ort. Die Karte ist nur ein schematischer Plan.')}</span>
          </span>
        </div>
      )}
      <div className="sheet-actions">
        {safety ? (
          <button className="btn primary" onClick={() => (app.closeSheet(), app.setFocusPoi('poi:' + p.id), app.setTab('map'))}>
            <Navigation size={17} /> {t('Auf der Karte zeigen')}
          </button>
        ) : (
          <button className="btn primary" onClick={() => goRoute(p.id, app)}>
            <Navigation size={17} /> {t('Richtung')}
          </button>
        )}
        {on('crew') && (
          <button className="btn secondary" onClick={() => requireIdentity(t('Damit deine Crew weiß, wer einlädt.'), () => openSheet({ kind: 'newMeetup', poi: p.id, place: p.name }))}>
            <Users size={17} /> {t('Hier treffen')}
          </button>
        )}
        {on('reports') && (
          <button className="btn ghost" onClick={() => openSheet({ kind: 'report', poi: p.id })}>
            <TriangleAlert size={17} /> {t('Problem melden')}
          </button>
        )}
      </div>
      {stageActs.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <div className="label">{t('Auf dieser Stage')}</div>
          <div className="list">
            {stageActs.map((a) => (
              <button key={a.id} className="list-item" onClick={() => openSheet({ kind: 'act', id: a.id })}>
                <span style={{ width: 44, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: status(a, now) === 'live' ? 'var(--ok)' : undefined }}>{fmt(a.start)}</span>
                <span className="grow" style={{ fontWeight: 600 }}>
                  {a.artist}
                </span>
                {plan.includes(a.id) && <span className="tag official">{t('Im Plan')}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      {reports.length > 0 && (
        <section>
          <div className="label" style={{ marginBottom: 6 }}>
            {t('Meldungen hier')}
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
  const { crew } = useApp()
  const { resolve, closeSheet, here } = useApp()
  const acts = ids.map((i) => actById[i])
  const [pick, setPick] = useState<string | null>(null)
  const [battle, setBattle] = useState(false)
  const start = Math.min(...acts.map((a) => a.start))
  const end = Math.max(...acts.map((a) => a.end))
  const maxFriends = Math.max(1, ...acts.map((a) => crew.friendsFor(a.id).length))
  const totalPop = acts.reduce((s, a) => s + a.popularity, 0)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label" style={{ color: 'var(--warn)' }}>
            {t('Überschneidung')} · {DAYS[acts[0].day].label}
          </span>
          <h2>
            {fmt(start)}–{fmt(end)}
          </h2>
          <div className="muted">{t('{n} Acts – wofür entscheidest du dich?', { n: acts.length })}</div>
        </div>
        <button className={`icon-btn filled ${battle ? 'active' : ''}`} onClick={() => setBattle(!battle)} aria-label={t('Battle-Modus')}>
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
              const f = crew.friendsFor(a.id)
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
                    <Metric label={t('Crew')} value={`${f.length}`} pct={f.length / maxFriends} />
                    <Metric label={t('Laufweg')} value={here ? t('ca. {n} Min.', { n: walkMinutes(here.x, here.y, s.x, s.y) }) : '–'} pct={here ? 1 - walkMinutes(here.x, here.y, s.x, s.y) / 12 : 0} />
                    <Metric label={t('Community')} value={`${Math.round((a.popularity / totalPop) * 100)}%`} pct={a.popularity / totalPop} />
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
            {pick ? t('{artist} behalten', { artist: actById[pick].artist }) : t('Act auswählen')}
          </button>
          <button
            className="btn ghost block"
            onClick={() => {
              resolve(k, ids, ids)
              closeSheet()
            }}
          >
            {t('Alle behalten – ich hoppe')}
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
        {t('Bauchgefühl: Wen würdest du auf keinen Fall verpassen wollen?')}
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
        <span style={{ order: 1, fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--text-3)' }}>{t('vs')}</span>
      </div>
      <p className="tiny faint" style={{ textAlign: 'center' }}>
        {t('Runde {n} von {total}', { n: ids.length - pool.length + 1, total: ids.length - 1 })}
      </p>
    </div>
  )
}

/* ---------------- Meetups ---------------- */
function MeetupSheet({ id }: { id: string }) {
  const { crew } = useApp()
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
            {t('Meetup')} · {DAYS[m.day]?.label} {fmt(m.min)}
          </span>
          <h2>{m.place}</h2>
          {m.note && <div className="muted">{m.note}</div>}
          {m.actId && <div className="small faint" style={{ marginTop: 4 }}>{t('Vor {artist}', { artist: actById[m.actId].artist })}</div>}
        </div>
      </div>
      <div className="sheet-actions">
        <button className={`btn ${going ? 'on' : 'primary'}`} onClick={() => rsvp(id, !going)}>
          {going ? (
            <>
              <Check size={18} /> {t('Bin dabei')}
            </>
          ) : (
            t('Bin dabei')
          )}
        </button>
        {m.poi && (
          <button className="btn secondary" onClick={() => goRoute(m.poi!, app)}>
            <Navigation size={17} /> {t('Route')}
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
            {t('Absagen')}
          </button>
        )}
      </div>
      <div className="label" style={{ marginBottom: 10 }}>
        {t('{n} zugesagt', { n: m.going.length })}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {m.going.map((f) => (
          <span key={f} className="chip" style={{ paddingLeft: 4 }}>
            <Avatar id={f} /> {f === 'me' ? t('Du') : (crew.byId[f]?.name ?? t('Gast'))}
          </span>
        ))}
      </div>
      <button
        className="btn ghost sm"
        style={{ marginTop: 16, paddingLeft: 0 }}
        onClick={() => {
          sendChat(`📍 ${t('Meetup')} ${fmt(m.min)} · ${m.place}`)
          app.toast(t('Im Crew-Chat geteilt'))
        }}
      >
        <MessageCircle size={16} /> {t('Im Chat teilen')}
      </button>
      <p className="tiny faint" style={{ marginTop: 18 }}>
        {t('Meetups verschwinden 30 Minuten nach Beginn automatisch. Dafür ist keine dauerhafte Standortfreigabe nötig.')}
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
  const [note, setNote] = useState(initialNote ?? (act ? t('Gemeinsam zu {artist}', { artist: act.artist }) : ''))
  const suggestions = POIS.filter((p) => p.important && p.cat !== 'medical').slice(0, 8)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label">{t('Neues Meetup')}</span>
          <h2>{act ? t('Vor {artist}', { artist: act.artist }) : t('Wann und wo?')}</h2>
        </div>
      </div>
      <div className="label" style={{ marginBottom: 8 }}>
        {t('Uhrzeit')} · {DAYS[day]?.label ?? ''}
      </div>
      <div className="chips" style={{ marginBottom: 18 }}>
        {options.map((o) => (
          <button key={o} className={`chip ${min === o ? 'on' : ''}`} onClick={() => setMin(o)}>
            {fmt(o)}
          </button>
        ))}
      </div>
      <div className="label" style={{ marginBottom: 8 }}>
        {t('Treffpunkt')}
      </div>
      <input
        className="field"
        value={place}
        onChange={(e) => {
          setPlace(e.target.value)
          setPoi(undefined)
        }}
        placeholder={t('z. B. Archive Entrance')}
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
        {t('Notiz')}
      </div>
      <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('optional')} />
      <button
        className="btn primary block"
        style={{ marginTop: 22 }}
        disabled={!place.trim()}
        onClick={() => {
          addMeetup({ title: note || t('Meetup'), place: place.trim(), poi: poiId, actId, day, min, note })
          closeSheet()
        }}
      >
        {t('Crew einladen')}
      </button>
    </>
  )
}

/* ---------------- Updates ---------------- */
function UpdateItem({ u, vote, voted }: { u: FestivalUpdate; vote: (id: string, v: 'still' | 'fixed') => void; voted?: 'still' | 'fixed' }) {
  const community = (u.source === 'confirmed' || u.source === 'unconfirmed') && on('reports')
  // how many people reported it – a count, not a check (audit F06); your own vote does not add to your own report
  const people = (u.confirms ?? 0) + (voted === 'still' && !u.mine ? 1 : 0)
  return (
    <div className="list-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <SourceTag source={u.source} />
        {u.severity !== 'info' && <span className={`tag ${u.severity === 'critical' ? 'crit' : 'warn'}`}>{u.severity === 'critical' ? t('Kritisch') : t('Warnung')}</span>}
        <span className="tiny faint">
          {ago(u.ageMin)}
          {u.place ? ` · ${u.place}` : ''}
        </span>
      </div>
      <div style={{ fontWeight: 600 }}>{u.title}</div>
      {u.body && <div className="small muted">{u.body}</div>}
      {community && <div className="tiny faint">{people === 1 ? t('Von 1 Person gemeldet · nicht geprüft') : t('Von {n} Personen gemeldet · nicht geprüft', { n: people })}{u.fixedVotes ? ' · ' + t('{n} sagen: behoben', { n: u.fixedVotes }) : ''}</div>}
      {u.validMin !== undefined && <div className="tiny faint">{community ? t('Läuft in {n} Min. ab, wenn niemand bestätigt', { n: u.validMin }) : t('Gültig noch {n} Min.', { n: u.validMin })}</div>}
      {u.mine === false && on('reports') && <ReportAbuse label={t('Inhalt melden')} submit={(reason) => api.flagReport(u.id, reason)} />}
      {community && u.mine && (
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button className="btn ghost sm" onClick={() => vote(u.id, 'fixed')}>
            {t('Erledigt – zurückziehen')}
          </button>
        </div>
      )}
      {community && !u.mine && (
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button className={`btn sm ${voted === 'still' ? 'on' : 'secondary'}`} onClick={() => vote(u.id, 'still')}>
            {voted === 'still' && <Check size={15} />} {t('Stimmt noch')}
          </button>
          <button className={`btn sm ${voted === 'fixed' ? 'on' : 'ghost'}`} onClick={() => vote(u.id, 'fixed')}>
            {voted === 'fixed' && <Check size={15} />} {t('Behoben')}
          </button>
        </div>
      )}
    </div>
  )
}

function Updates() {
  const { phase, updates, votes, vote, openSheet } = useApp()
  const [f, setF] = useState<UpdateSource | 'all'>('all')
  const all = updates.filter((u) => u.phases.includes(phase) && votes[u.id] !== 'fixed')
  const list = all.filter((u) => f === 'all' || u.source === f)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2>{t('Updates')}</h2>
          <div className="small muted">{t('Jede Meldung mit Quelle, Alter und Gültigkeit.')}</div>
        </div>
        {on('reports') && <button className="btn secondary sm" onClick={() => openSheet({ kind: 'report' })}>
          <Plus size={16} /> {t('Melden')}
        </button>}
      </div>
      <div className="chips" style={{ marginBottom: 8 }}>
        {(
          [
            ['all', t('Alle')],
            ['official', t('Offiziell')],
            ['confirmed', t('Mehrfach gemeldet')],
            ['unconfirmed', t('Einzelmeldung')],
            ['app', t('App')],
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
            <b>{t('Alles ruhig')}</b>
            {t('Keine Meldungen in dieser Kategorie.')}
          </div>
        )}
      </div>
    </>
  )
}

const OTHER = t('Sonstiges')
const REPORT_TYPES = [t('Wasser leer'), t('Lange Schlange'), t('WC defekt'), t('Sehr voll'), OTHER]

function Report({ poi }: { poi?: string }) {
  const { report, closeSheet, requireIdentity, openSheet } = useApp()
  const help = POIS.filter((x) => x.cat === 'medical' || x.cat === 'info')
  const [type, setType] = useState<string | null>(null)
  const [where, setWhere] = useState(poi)
  const [text, setText] = useState('')
  const p = POIS.find((x) => x.id === where)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label">{t('Community-Meldung')}</span>
          <h2>{t('Was ist los?')}</h2>
          <div className="small muted">{t('Andere sehen das mit Verzögerung, niemand prüft es sofort. Meldungen laufen nach 60 Minuten ab, wenn niemand sie bestätigt.')}</div>
        </div>
      </div>
      {/* a community report is no emergency call: the way to immediate help comes first (audit D05) */}
      <div className="alert critical" role="note" style={{ marginBottom: 16 }}>
        <TriangleAlert className="a-ic" size={20} />
        <span className="grow">
          <strong>{t('Notfall? Ruf 112 – das hier ist kein Notruf.')}</strong>
          <span className="small muted">{t('Sprich Personal oder Security direkt an oder geh zur Sanität.')}</span>
          <span className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <a className="btn primary sm" href="tel:112">
              {t('112 anrufen')}
            </a>
            {help.map((x) => (
              <button key={x.id} className="btn secondary sm" onClick={() => openSheet({ kind: 'poi', id: x.id })}>
                {x.name}
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 18 }}>
        {REPORT_TYPES.map((ty) => (
          <button key={ty} className={`chip ${type === ty ? 'on' : ''}`} onClick={() => setType(ty)}>
            {ty}
          </button>
        ))}
      </div>
      <div className="label" style={{ marginBottom: 8 }}>
        {t('Ort')}
      </div>
      <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 18 }}>
        {(p ? [p] : POIS.filter((x) => x.cat !== 'stage' && x.important)).map((x) => (
          <button key={x.id} className={`chip ${where === x.id ? 'on' : ''}`} onClick={() => setWhere(where === x.id && !poi ? undefined : x.id)}>
            {x.name}
          </button>
        ))}
      </div>
      {type === OTHER && <textarea className="field" placeholder={t('Kurz beschreiben')} value={text} onChange={(e) => setText(e.target.value)} />}
      <button
        className="btn primary block"
        style={{ marginTop: 18 }}
        disabled={!type || !where}
        onClick={() =>
          requireIdentity(t('Meldungen brauchen einen Namen, damit Missbrauch erkennbar bleibt.'), () => {
            report({ title: type === OTHER && text ? text : `${type}: ${p?.name ?? POIS.find((x) => x.id === where)!.name}`, place: POIS.find((x) => x.id === where)!.name, poi: where, severity: 'info' })
            closeSheet()
          })
        }
      >
        {t('Veröffentlichen')}
      </button>
    </>
  )
}

/* ---------------- Identity & profile ---------------- */
const COLORS = ['#A58CFF', '#FF8A65', '#4FC3F7', '#FFD54F', '#81C784', '#F06292', '#4DB6AC']

function Identity({ reason }: { reason: string }) {
  const { setNickname, guest, openSheet } = useApp()
  const [name, setName] = useState(guest.nickname ?? '')
  const [color, setColor] = useState(guest.color)
  // the festival names a minimum age for the social features (Welle 7); a notice, not an age check
  const minAge = FESTIVAL.legal.minAge
  const [ageOk, setAgeOk] = useState(!minAge)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => ref.current?.focus(), 350)
    return () => clearTimeout(timer)
  }, [])
  return (
    <>
      <div style={{ display: 'grid', placeItems: 'center', margin: '8px 0 18px' }}>
        <motion.span key={color + name[0]} initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={spring} className="avatar xl" style={{ background: color, boxShadow: 'none' }}>
          {(name[0] ?? '?').toUpperCase()}
        </motion.span>
      </div>
      <h2 className="h-display" style={{ fontSize: 26, textAlign: 'center' }}>
        {t('Wie sollen dich andere nennen?')}
      </h2>
      <p className="small muted" style={{ textAlign: 'center', margin: '8px 0 20px' }}>
        {reason}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() && ageOk) setNickname(name.trim().slice(0, 20), color)
        }}
      >
        <input ref={ref} className="field" placeholder={t('Spitzname')} value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
        <div className="row" style={{ justifyContent: 'center', gap: 10, margin: '16px 0 22px' }}>
          {COLORS.map((c) => (
            <button type="button" key={c} aria-label={t('Farbe {color}', { color: c })} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 99, background: c, boxShadow: color === c ? '0 0 0 3px var(--bg-elev), 0 0 0 5px #fff' : 'none', transition: 'box-shadow .2s' }} />
          ))}
        </div>
        {minAge > 0 && (
          <label className="row small" style={{ gap: 10, marginBottom: 14, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, flex: 'none' }} />
            <span>{t('Ich bin mindestens {n} Jahre alt.', { n: minAge })}</span>
          </label>
        )}
        <button className="btn primary block" disabled={!name.trim() || !ageOk}>
          {t('Weiter')}
        </button>
      </form>
      <p className="tiny faint" style={{ textAlign: 'center', marginTop: 14 }}>
        {t('Kein Account, keine E-Mail. Du kannst dein Profil später optional sichern.')}{' '}
        <button type="button" className="link-btn" onClick={() => openSheet({ kind: 'legal', doc: 'privacy' })}>
          {t('Datenschutz')}
        </button>
      </p>
    </>
  )
}

function Profile() {
  const { guest, phase, setPhase, openSheet, reset, closeSheet, setTab, plan, online, deleteProfile, session, set, clockMode } = useApp()
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <>
      <ModerationInbox />
      <div className="row" style={{ gap: 14, marginBottom: 22 }}>
        <Avatar id="me" size="lg" />
        <div className="grow">
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 22 }}>{guest.nickname ?? t('Gast')}</div>
          <div className="tiny faint">
            {/* where the profile lives and whether it can be restored are two different things (audit F13) */}
            {!online
              ? t('Demo · nur auf diesem Gerät gespeichert')
              : !session
                ? t('Nur auf diesem Gerät gespeichert')
                : guest.secured
                  ? <span style={{ color: 'var(--ok)' }}>{t('Auf dem Server gespeichert · mit Recovery-Code wiederherstellbar')}</span>
                  : t('Auf dem Server gespeichert · ohne Recovery-Code nicht wiederherstellbar')}
          </div>
        </div>
        <button className="btn secondary sm" onClick={() => openSheet({ kind: 'identity', reason: t('Ändere deinen Namen oder deine Farbe.') })}>
          {guest.nickname ? t('Bearbeiten') : t('Name wählen')}
        </button>
      </div>
      {!guest.secured && (
        <button className="tile" style={{ marginBottom: 22 }} onClick={() => openSheet({ kind: 'secure' })}>
          <span className="tile-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <ShieldCheck size={20} />
          </span>
          <span className="grow">
            <span style={{ fontWeight: 600 }}>{t('Profil sichern')}</span>
            <span className="small faint" style={{ display: 'block' }}>
              {t('Für Gerätewechsel – mit Recovery-Code')}
            </span>
          </span>
          <ChevronRight size={18} className="faint" />
        </button>
      )}

      {online && <FestivalPicker />}
      <div className="label" style={{ marginBottom: 10 }}>
        {t('Sprache')}
      </div>
      <div className="row" role="group" aria-label={t('Sprache')} style={{ gap: 8, marginBottom: 22 }}>
        {LANGS.map((l) => (
          <button key={l.id} type="button" className={`chip ${lang === l.id ? 'on' : ''}`} aria-pressed={lang === l.id} lang={l.id} onClick={() => lang !== l.id && setLang(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="label" style={{ marginBottom: 10 }}>
        {t('Uhrzeit & Festivalphase')}
      </div>
      <div className="list" style={{ marginBottom: 22 }}>
        <button
          className="list-item"
          onClick={() => {
            set('clockMode', 'real')
            closeSheet()
            setTab('home')
          }}
        >
          <span className="grow">
            <span style={{ fontWeight: 600 }}>{t('Echtzeit')}</span>
            <span className="small faint" style={{ display: 'block' }}>
              {t('Richtet sich nach der echten Uhr')}
            </span>
          </span>
          {clockMode === 'real' && <Check size={18} style={{ color: 'var(--brand)' }} />}
        </button>
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
              <span style={{ fontWeight: 600 }}>{t('Demo')} · {p.label}</span>
              <span className="small faint" style={{ display: 'block' }}>
                {p.hint}
              </span>
            </span>
            {clockMode === 'demo' && phase === p.id && <Check size={18} style={{ color: 'var(--brand)' }} />}
          </button>
        ))}
      </div>

      <div className="label" style={{ marginBottom: 6 }}>
        {t('Gerät')}
      </div>
      <div className="list">
        <div className="list-item">
          <WifiOff size={18} className="faint" />
          <span className="grow small">{t('Offline verfügbar: Timetable, Karte, {n} geplante Acts', { n: plan.length })}</span>
        </div>
        {online && <DeviceStorage />}
        <div className="list-item small faint">
          {online ? (session ? t('ID {id}… · pseudonym · verbunden', { id: session.id.slice(0, 10) }) : t('Noch kein Profil auf dem Server – entsteht beim ersten sozialen Feature')) : t('ID {id}… · pseudonym · Demo-Modus', { id: guest.id.slice(0, 10) })}
        </div>
        {online && (
          <button className="list-item small" onClick={() => openSheet({ kind: 'restore' })}>
            <KeyRound size={18} className="faint" /> {t('Profil mit Code wiederherstellen')}
          </button>
        )}
        {confirmReset ? (
          <div className="list-item">
            <span className="grow small">{online ? t('Profil und alle Daten auf dem Server endgültig löschen?') : t('Alle lokalen Daten löschen?')}</span>
            <button className="btn danger sm" onClick={online ? deleteProfile : reset}>
              {t('Löschen')}
            </button>
            <button className="btn ghost sm" onClick={() => setConfirmReset(false)}>
              {t('Abbrechen')}
            </button>
          </div>
        ) : (
          <button className="list-item small" style={{ color: 'var(--crit)' }} onClick={() => setConfirmReset(true)}>
            <RotateCcw size={18} /> {online ? t('Profil löschen') : t('Demo zurücksetzen')}
          </button>
        )}
        <div className="row small" style={{ gap: 16, justifyContent: 'center', padding: '10px 0 2px' }}>
          <button type="button" className="link-btn" onClick={() => openSheet({ kind: 'legal', doc: 'imprint' })}>
            {t('Impressum')}
          </button>
          <button type="button" className="link-btn" onClick={() => openSheet({ kind: 'legal', doc: 'privacy' })}>
            {t('Datenschutz')}
          </button>
        </div>
      </div>
    </>
  )
}

/** Every festival is its own tenant: switching reloads the app with that festival's data. */
const kb = (bytes: number) => num(Math.max(1, Math.round(bytes / 1024)))

/** How much Realm keeps on this device, and a way to give back the offline copies of other festivals. */
function DeviceStorage() {
  const { toast } = useApp()
  const read = (): StorageUsage | null => {
    try {
      return usage(localStorage, FESTIVAL.slug)
    } catch {
      return null // storage blocked: the profile already says nothing can be kept
    }
  }
  const [info, setInfo] = useState(read)
  const [confirm, setConfirm] = useState(false)
  if (!info) return null
  const othersBytes = info.others.reduce((n, o) => n + o.bytes, 0)
  const drop = () => {
    let n = 0
    try {
      n = dropOtherBundles(localStorage, FESTIVAL.slug)
    } catch {}
    setConfirm(false)
    setInfo(read())
    toast(t('{n} Offline-Kopien entfernt · deine Pläne bleiben', { n }))
  }
  return (
    <div className="list-item" data-testid="device-storage" style={{ flexWrap: 'wrap', rowGap: 8 }}>
      <span className="grow small">
        {t('Auf diesem Gerät gespeichert: {kb} kB', { kb: kb(info.bytes) })}
        {info.others.length > 0 && (
          <span className="faint" style={{ display: 'block' }}>
            {t('davon Offline-Kopien anderer Festivals: {n} · {kb} kB', { n: info.others.length, kb: kb(othersBytes) })}
          </span>
        )}
      </span>
      {info.others.length > 0 &&
        (confirm ? (
          <>
            <span className="small" style={{ flexBasis: '100%' }}>
              {t('Pläne und Profile bleiben erhalten. Die anderen Festivals brauchen danach beim nächsten Öffnen Netz.')}
            </span>
            <button type="button" className="btn danger sm" onClick={drop}>
              {t('Entfernen')}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>
              {t('Abbrechen')}
            </button>
          </>
        ) : (
          <button type="button" className="btn secondary sm" onClick={() => setConfirm(true)}>
            {t('Platz freigeben')}
          </button>
        ))}
    </div>
  )
}

function FestivalPicker() {
  const [list, setList] = useState<{ slug: string; name: string; location: string | null }[] | null>(null)
  useEffect(() => {
    api.festivals().then(setList, () => setList([]))
  }, [])
  if (!list || list.length < 2) return null
  return (
    <>
      <div className="label" style={{ marginBottom: 10 }}>
        {t('Festival')}
      </div>
      <div className="list" style={{ marginBottom: 22 }}>
        {list.map((f) => (
          <button key={f.slug} className="list-item" onClick={() => f.slug !== FESTIVAL.slug && switchFestival(f.slug)} aria-current={f.slug === FESTIVAL.slug}>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>{f.name}</span>
              {f.location && (
                <span className="small faint" style={{ display: 'block' }}>
                  {f.location}
                </span>
              )}
            </span>
            {f.slug === FESTIVAL.slug && <Check size={18} style={{ color: 'var(--brand)' }} />}
          </button>
        ))}
      </div>
    </>
  )
}

function Secure() {
  const { secure, guest, toast, closeSheet, online, requireIdentity } = useApp()
  const [code, setCode] = useState<string | undefined>(guest.recoveryCode)
  const [busy, setBusy] = useState(false)
  const makeCode = () =>
    requireIdentity(t('Dein Profil braucht einen Namen, bevor es gesichert wird.'), async () => {
      setBusy(true)
      setCode(await secure('code'))
      setBusy(false)
    })
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label">{t('Optional')}</span>
          <h2>{t('Profil sichern')}</h2>
          <div className="small muted">{t('Ohne Sicherung lässt sich dein Profil nach dem Löschen der App nicht wiederherstellen. Plan, Crew und Wrapped wären weg.')}</div>
        </div>
      </div>
      {code ? (
        <>
          <div className="code">{code}</div>
          <p className="small muted">
            {online
              ? t('Bewahre diesen Code sicher auf. Er ist der einzige Weg zurück zu deinem Profil – auch auf einem neuen Gerät. Ein neuer Code macht den alten ungültig.')
              : t('Bewahre diesen Code sicher auf. Er ist der einzige Weg zurück zu deinem Profil. Ein neuer Code macht den alten ungültig.')}
          </p>
          <button
            className="btn secondary block"
            onClick={() => {
              navigator.clipboard?.writeText(code).catch(() => {})
              toast(t('Code kopiert'))
            }}
          >
            <Copy size={17} /> {t('Kopieren')}
          </button>
          <button className="btn ghost block" style={{ marginTop: 6 }} onClick={closeSheet}>
            {t('Fertig')}
          </button>
        </>
      ) : online ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn primary block" disabled={busy} onClick={makeCode}>
            <KeyRound size={17} /> {busy ? t('Wird erstellt …') : t('Recovery-Code erstellen')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn primary block" onClick={makeCode}>
            <KeyRound size={17} /> {t('Recovery-Code erstellen')}
          </button>
          <p className="tiny faint" style={{ textAlign: 'center' }}>
            {t('Demo-Modus: Die Sicherung wird nur simuliert.')}
          </p>
        </div>
      )}
    </>
  )
}

function Restore() {
  const { restore, closeSheet } = useApp()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2>{t('Profil wiederherstellen')}</h2>
          <div className="small muted">{t('Gib den Recovery-Code ein, den du beim Sichern erhalten hast. Dein aktuelles Gastprofil auf diesem Gerät wird ersetzt.')}</div>
        </div>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          if (await restore(code)) closeSheet()
          setBusy(false)
        }}
      >
        <input className="field code" style={{ height: 'auto' }} placeholder="XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="one-time-code" />
        <button className="btn primary block" style={{ marginTop: 14 }} disabled={busy || code.replace(/[^a-z0-9]/gi, '').length < 16}>
          {busy ? t('Wird geprüft …') : t('Wiederherstellen')}
        </button>
      </form>
    </>
  )
}

/* ---------------- Crew sub pages ---------------- */
function Chat() {
  const { crew } = useApp()
  const { chat, sendChat, requireIdentity, openSheet, now, deleteMessage, flagMessage } = useApp()
  const [text, setText] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  // block body: newer browsers return a Promise from scrollIntoView, which must not become the effect's cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.length])
  return (
    <>
      <div className="sheet-head" style={{ marginBottom: 10 }}>
        <div className="grow">
          <h2 style={{ fontSize: 24 }}>{t('Crew-Chat')}</h2>
          <div className="row small muted" style={{ gap: 8 }}>
            <AvatarStack ids={crew.members.map((f) => f.id)} max={5} /> {t('{n} Personen', { n: crew.members.length + 1 })}
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
                  {(crew.byId[m.from]?.name ?? t('Gast'))} · {fmt(m.min)}
                </span>
              )}
              {m.deleted || (m.hidden && !me) ? (
                <span className={`bubble ${me ? 'me' : 'them'} removed`}>{m.moderationReason ? t('Vom Veranstalter entfernt: {reason}', { reason: m.moderationReason }) : m.deleted ? t('Nachricht gelöscht') : t('Ausgeblendet – von der Crew gemeldet')}</span>
              ) : (
                <button className={`bubble ${me ? 'me' : 'them'} ${m.pending ? 'pending' : ''}`} style={{ textAlign: 'left' }} onClick={() => setActive(active === m.id ? null : m.id)} aria-expanded={active === m.id}>
                  {m.text}
                </button>
              )}
              {m.pending && <span className="tiny faint" style={{ marginTop: 2 }}>{t('Wird gesendet …')}</span>}
              {me && m.hidden && !m.deleted && <span className="tiny faint" style={{ marginTop: 2 }}>{t('Von der Crew gemeldet – für andere ausgeblendet')}</span>}
              <AnimatePresence>
                {active === m.id && !m.pending && !m.deleted && !(m.hidden && !me) && (
                  <motion.div className="msg-actions" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    <button
                      className="btn ghost sm"
                      style={{ color: 'var(--brand)' }}
                      onClick={() => {
                        setActive(null)
                        requireIdentity(t('Damit deine Crew weiß, wer einlädt.'), () =>
                          openSheet({ kind: 'newMeetup', note: m.text.slice(0, 60), place: /archive/i.test(m.text) ? 'Archive Entrance' : undefined, poi: /archive/i.test(m.text) ? 'stage-archive' : undefined }),
                        )
                      }}
                    >
                      <CalendarPlus size={15} /> {t('In Meetup umwandeln')}
                    </button>
                    {(me || crew.owner === 'me') && (
                      <button
                        className="btn ghost sm"
                        onClick={() => {
                          setActive(null)
                          if (confirm(me ? t('Nachricht für alle löschen?') : t('Nachricht als Crew-Gründer:in für alle löschen?'))) deleteMessage(m.id)
                        }}
                      >
                        <Trash2 size={15} /> {t('Löschen')}
                      </button>
                    )}
                    {!me && !m.flaggedByMe && <ReportAbuse submit={async (reason) => { await flagMessage(m.id, reason); setActive(null) }} />}
                  </motion.div>
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
          const msg = text.trim()
          if (!msg) return
          requireIdentity(t('Damit deine Crew sieht, wer schreibt.'), () => {
            sendChat(msg)
            setText('')
          })
        }}
      >
        <input className="field" style={{ borderRadius: 99 }} placeholder={t('Nachricht · {time}', { time: fmt(now.min) })} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="icon-btn" style={{ background: 'var(--brand)', color: 'var(--brand-ink)', width: 48, height: 48, flex: 'none' }} aria-label={t('Senden')}>
          <Send size={19} />
        </button>
      </form>
    </>
  )
}

function Members() {
  const { crew, guest, removeMember, approveMember, setApproveJoins, renewCode } = useApp()
  const rows = [{ id: 'me', name: guest.nickname ?? t('Du'), color: guest.color }, ...crew.members]
  const canModerate = crew.owner === 'me' && crew.live
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2 style={{ fontSize: 24 }}>{t('Mitglieder')}</h2>
          <div className="small muted">
            {rows.length === 1 ? t('1 Person in {crew}', { crew: crew.name }) : t('{n} Personen in {crew}', { n: rows.length, crew: crew.name })}
          </div>
        </div>
      </div>
      {canModerate && crew.requests.length > 0 && (
        <>
          <div className="label" style={{ marginBottom: 8 }}>
            {t('Beitrittsanfragen')}
          </div>
          <div className="list" style={{ marginBottom: 18 }}>
            {crew.requests.map((r) => (
              <div key={r.id} className="list-item">
                <span className="avatar" style={{ background: r.color }}>
                  {r.name[0]?.toUpperCase()}
                </span>
                <span className="grow" style={{ fontWeight: 500 }}>
                  {r.name}
                </span>
                <button className="btn primary sm" onClick={() => approveMember(r.id)}>
                  {t('Freigeben')}
                </button>
                <button className="btn ghost sm" aria-label={t('{name} ablehnen', { name: r.name })} onClick={() => removeMember(r.id)}>
                  {t('Ablehnen')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="list">
        {rows.map((m) => (
          <div key={m.id} className="list-item">
            <Avatar id={m.id} />
            <span className="grow" style={{ fontWeight: 500 }}>
              {m.id === 'me' ? t('{name} (du)', { name: m.name }) : m.name}
            </span>
            {crew.owner === m.id && (
              <span className="tag official">
                <Crown size={12} /> {t('Verantwortlich')}
              </span>
            )}
            {canModerate && m.id !== 'me' && (
              <button
                className="btn ghost sm"
                aria-label={t('{name} entfernen', { name: m.name })}
                onClick={() => confirm(t('{name} aus der Crew entfernen? Der Einladungscode wird dabei erneuert – der alte Link funktioniert für niemanden mehr.', { name: m.name })) && removeMember(m.id)}
              >
                <UserMinus size={16} /> {t('Entfernen')}
              </button>
            )}
          </div>
        ))}
      </div>
      {canModerate && (
        <div className="list" style={{ marginTop: 18 }}>
          <div className="list-item">
            <span className="grow">
              <span style={{ fontWeight: 600, display: 'block' }}>{t('Beitritt bestätigen')}</span>
              <span className="small faint">{t('Neue Mitglieder warten, bis du sie freigibst.')}</span>
            </span>
            <Switch on={crew.approveJoins} onChange={setApproveJoins} label={t('Beitritt bestätigen')} />
          </div>
          <button className="list-item" onClick={() => confirm(t('Neuen Code erzeugen? Der bisherige Link funktioniert dann nicht mehr.')) && renewCode()}>
            <span className="grow" style={{ fontWeight: 600 }}>
              {t('Einladungscode erneuern')}
            </span>
            <span className="small faint">{crew.code}</span>
          </button>
        </div>
      )}
      <p className="tiny faint" style={{ marginTop: 14 }}>
        {t('Nachrichten, die zwei Mitglieder melden, werden für alle außer der verfassenden Person ausgeblendet.')}{' '}
        {canModerate ? t('Als Verantwortliche:r kannst du Nachrichten löschen und Mitglieder entfernen.') : t('Verlässt die verantwortliche Person die Crew, übernimmt das am längsten dabei gewesene Mitglied.')}
      </p>
    </>
  )
}

function Shared() {
  const { crew } = useApp()
  const { plan } = useApp()
  const [day, setDay] = useState<number | 'all'>('all')
  const [friend, setFriend] = useState<string | null>(null)
  const acts = useMemo(
    () => ACTS.filter((a) => plan.includes(a.id) && (day === 'all' || a.day === day)).filter((a) => (friend ? crew.friendsFor(a.id).includes(friend) : crew.friendsFor(a.id).length > 0)),
    [plan, day, friend],
  )
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2 style={{ fontSize: 24 }}>{t('Gemeinsame Acts')}</h2>
          <div className="small muted">{t('Acts in deinem Plan, zu denen auch Freunde gehen.')}</div>
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 8 }}>
        <button className={`chip ${day === 'all' ? 'on' : ''}`} onClick={() => setDay('all')}>
          {t('Alle Tage')}
        </button>
        {DAYS.map((d) => (
          <button key={d.idx} className={`chip ${day === d.idx ? 'on' : ''}`} onClick={() => setDay(d.idx)}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="chips" style={{ marginBottom: 6 }}>
        {crew.members.map((f) => (
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
            <b>{t('Keine Überschneidung')}</b>
            {t('Mit dieser Auswahl teilt ihr keinen Act.')}
          </div>
        )}
      </div>
    </>
  )
}

function Steps() {
  const { crew } = useApp()
  const { stepsOptIn, set, guest, requireIdentity, toast, online, remote, now } = useApp()
  const day = Math.max(0, Math.min(DAYS.length - 1, now.day))
  const [scope, setScope] = useState<'day' | 'fest'>('day')
  // demo: festival total is extrapolated; live: the server only has what native apps synced
  const myLive = remote?.members.find((m) => m.id === remote.me)?.steps ?? []
  const liveTotal = (steps: { day: number; total: number }[]) => (scope === 'day' ? (steps.find((x) => x.day === day)?.total ?? 0) : steps.reduce((n, x) => n + x.total, 0))
  const meSteps = online ? liveTotal(myLive) : scope === 'day' ? 12840 : 12840 * 2 + 2400
  const rows = [
    ...crew.members.map((f) => ({
      id: f.id,
      name: f.name,
      steps: online ? liveTotal(remote?.members.find((m) => m.id === f.id)?.steps ?? []) : scope === 'day' ? f.steps : f.steps * 2 + 3100,
    })),
    { id: 'me', name: guest.nickname ?? t('Du'), steps: meSteps },
  ].sort((a, b) => b.steps - a.steps)
  const max = Math.max(1, rows[0].steps)
  if (!stepsOptIn)
    return (
      <>
        <div className="sheet-head">
          <div className="grow">
            <span className="label">{t('Crew-Challenge · Beta')}</span>
            <h2>{t('Wer läuft am meisten?')}</h2>
          </div>
        </div>
        <div className="list" style={{ marginBottom: 20 }}>
          {[t('Nur deine Tagessumme wird übertragen'), t('Kein Schrittverlauf, kein Standort'), t('Nur innerhalb deiner Crew sichtbar'), t('Jederzeit deaktivierbar – Daten werden gelöscht'), t('Keine Nutzung für Werbung oder Sponsoren')].map((line) => (
            <div key={line} className="list-item small">
              <Check size={17} style={{ color: 'var(--ok)' }} /> {line}
            </div>
          ))}
        </div>
        <button
          className="btn primary block"
          onClick={() =>
            requireIdentity(t('Damit deine Crew dich im Ranking sieht.'), () => {
              set('stepsOptIn', true)
              toast(t('Step-Challenge aktiviert'))
            })
          }
        >
          {t('Mitmachen')}
        </button>
        <p className="tiny faint" style={{ textAlign: 'center', marginTop: 12 }}>
          {t('Automatische Schritte gibt es in der iOS- und Android-App (HealthKit / Health Connect). Im Browser siehst du das Ranking.')}
        </p>
      </>
    )
  const myRank = rows.findIndex((r) => r.id === 'me') + 1
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <span className="label">{t('Step-Challenge')}</span>
          <h2>{t('Platz {n}', { n: myRank })}</h2>
          <div className="small muted">
            {t('von {n} in deiner Crew', { n: rows.length })}
            {online ? '' : ' · ' + t('Top 10 % aller {n} Teilnehmenden', { n: 842 })}
          </div>
        </div>
      </div>
      <Segmented
        id="steps"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'day', label: t('Heute') },
          { value: 'fest', label: t('Festival') },
        ]}
      />
      <div className="list" style={{ marginTop: 14 }}>
        {rows.map((r, i) => (
          <motion.div layout key={r.id} className="list-item" transition={spring}>
            <span style={{ width: 20, fontWeight: 700, color: i < 3 ? 'var(--text)' : 'var(--text-3)' }}>{i + 1}</span>
            <Avatar id={r.id} />
            <span className="grow">
              <span className="row small" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontWeight: r.id === 'me' ? 700 : 500 }}>{r.id === 'me' ? t('{name} (du)', { name: r.name }) : r.name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.steps)}</span>
              </span>
              <span className="bar-track" style={{ display: 'block', marginTop: 6, height: 4 }}>
                <motion.i initial={{ width: 0 }} animate={{ width: (r.steps / max) * 100 + '%' }} transition={{ duration: 0.7, delay: i * 0.03 }} style={{ background: r.id === 'me' ? 'var(--brand)' : 'var(--surface-3)', filter: r.id === 'me' ? undefined : 'brightness(1.6)' }} />
              </span>
            </span>
          </motion.div>
        ))}
      </div>
      <div className="row tiny faint" style={{ marginTop: 14 }}>
        <Sparkles size={14} />{' '}
        <span className="grow">
          {online ? (myLive.length ? t('Letzter Sync vor {n} Min.', { n: Math.round((Date.now() - Math.max(...myLive.map((x) => x.syncedAt))) / 60000) }) : t('Deine Schritte kommen aus der iOS-/Android-App')) : t('Letzter Sync vor {n} Min.', { n: 4 })} · {t('keine Preise, nur Ehre')}
        </span>
        <button className="btn ghost sm" onClick={() => set('stepsOptIn', false)}>
          {t('Beenden')}
        </button>
      </div>
    </>
  )
}

/** Legal notice or privacy information (Welle 7): the festival's text, then the platform's. Texts come from the operators. */
function LegalSheet({ doc }: { doc: 'imprint' | 'privacy' }) {
  const { openSheet, online } = useApp()
  const own = FESTIVAL.legal[doc]
  const platform = FESTIVAL.legal.platform[doc]
  const title = doc === 'imprint' ? t('Impressum') : t('Datenschutz')
  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2>{title}</h2>
        </div>
      </div>
      {!own && !platform && <p className="small muted">{online ? t('Noch nicht hinterlegt.') : t('Demo-Modus: hier stehen später die Texte des Veranstalters und der Plattform.')}</p>}
      {own && (
        <section style={{ marginBottom: 18 }}>
          <div className="label">{FESTIVAL.name}</div>
          <div className="small legal-text">{own}</div>
        </section>
      )}
      {platform && (
        <section>
          <div className="label">{t('Plattform')}</div>
          <div className="small legal-text">{platform}</div>
        </section>
      )}
      <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={() => openSheet({ kind: 'legal', doc: doc === 'imprint' ? 'privacy' : 'imprint' })}>
        {doc === 'imprint' ? t('Datenschutz') : t('Impressum')}
      </button>
    </>
  )
}
