import { m as motion } from 'framer-motion'
import { CalendarPlus, ChevronRight, Megaphone, Footprints, Heart, LogOut, MapPin, MessageCircle, Navigation, Share2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { on, ACTS, fmt, POIS, stageById, walkMinutes, type PoiCat, type StageId } from '../data'
import { fairMeetingPoint } from '../meet'
import { isMeetupActive, useApp } from '../store'
import { status } from '../time'
import { AvatarStack, StageDot, Switch, stagger } from '../ui'
import { useScrollTop } from './Home'
import { num, t } from '../i18n'

export function Crew() {
  const { crew, online, crewRef } = useApp()
  if (online && !crewRef) return <CrewOnboarding />
  if (online && crewRef?.pending) return <CrewPending name={crewRef.name} />
  return <CrewHome key={crew.name} />
}

function CrewHome() {
  const { crew, inviteLink, toast, leaveCrew, online } = useApp()
  const { now, plan, meetups, declined, openSheet, setTab, setFocusPoi, shareLocation, set, guest, requireIdentity, stepsOptIn, chat, phase, pendingPrivacy, here } = useApp()
  const ref = useScrollTop()

  const groups = Object.entries(
    crew.members.filter((f) => f.at && f.at !== 'camp').reduce<Record<string, string[]>>((acc, f) => ((acc[f.at!] ??= []).push(f.id), acc), {}),
  ).sort((a, b) => b[1].length - a[1].length)
  const hidden = crew.members.filter((f) => !f.at)

  const day = phase === 'during' ? now.day : 0
  const clock = phase === 'during' ? now : { day: 0, min: 0 }
  const nextShared = ACTS.filter((a) => plan.includes(a.id) && a.day === day && status(a, clock) !== 'past')
    .map((a) => ({ a, f: crew.friendsFor(a.id) }))
    .filter((x) => x.f.length)
    .sort((x, y) => x.a.start - y.a.start)[0]
  const sharedCount = plan.filter((id) => crew.friendsFor(id).length > 0).length
  const meetup = meetups.filter((m) => !declined.includes(m.id) && isMeetupActive(m, clock)).sort((a, b) => a.day - b.day || a.min - b.min)[0]
  const unread = chat.filter((c) => c.from !== 'me').length
  const lastMsg = chat[chat.length - 1]
  const share = async () => {
    const url = inviteLink()
    if (!url) return
    const text = t('Komm in meine Crew „{name}“ bei Realm: {url}', { name: crew.name, url })
    if (navigator.share) await navigator.share({ text, url }).catch(() => {})
    else {
      await navigator.clipboard?.writeText(url).catch(() => {})
      toast(t('Einladungslink kopiert'))
    }
  }

  return (
    <main className="screen" ref={ref}>
      <div className="stack">
        {!guest.nickname && (
          <motion.button {...stagger(0)} className="alert info" onClick={() => requireIdentity(t('Deine Crew sieht dich mit diesem Namen.'), () => {})}>
            <span className="grow">
              <strong>{t('Wie soll deine Crew dich nennen?')}</strong>
              <span className="small muted">{t('Nur ein Name und eine Farbe – kein Account, keine E-Mail.')}</span>
            </span>
            <ChevronRight size={18} className="faint" />
          </motion.button>
        )}

        {crew.live && (
          <motion.section {...stagger(0)} className="row">
            <span className="tile-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
              <Users size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 700, fontFamily: 'var(--display)', fontSize: 18, display: 'block' }}>{crew.name}</span>
              <span className="small faint">
                {crew.members.length ? t('{n} Personen · Code {code}', { n: crew.members.length + 1, code: crew.code ?? '' }) : t('1 Person · Code {code}', { code: crew.code ?? '' })}
              </span>
            </span>
            <button className="btn secondary sm" onClick={share}>
              <Share2 size={15} /> {t('Einladen')}
            </button>
          </motion.section>
        )}

        {crew.live && crew.owner === 'me' && crew.requests.length > 0 && (
          <motion.button {...stagger(1)} className="alert info" onClick={() => openSheet({ kind: 'members' })}>
            <UserPlus size={20} />
            <span className="grow">
              <strong>{crew.requests.length === 1 ? t('{name} möchte beitreten', { name: crew.requests[0].name }) : t('{n} Beitrittsanfragen', { n: crew.requests.length })}</strong>
              <span className="small muted">{t('Gib nur Leute frei, die du kennst.')}</span>
            </span>
            <ChevronRight size={18} className="faint" />
          </motion.button>
        )}

        {crew.live && crew.members.length === 0 && (
          <motion.section {...stagger(1)} className="card" style={{ textAlign: 'center' }}>
            <UserPlus size={26} className="faint" />
            <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>{t('Noch niemand da')}</div>
            <p className="small muted" style={{ margin: '0 0 14px' }}>
              {t('Teile den Link oder den Code')} <b>{crew.code}</b> – {t('deine Freunde brauchen keinen Account.')}
            </p>
            <button className="btn primary sm" onClick={share}>
              {t('Einladungslink teilen')}
            </button>
          </motion.section>
        )}

        {crew.members.length > 0 && (
        <motion.section {...stagger(1)}>
          <div className="section-h">
            <h2>{t('Wo ist meine Crew?')}</h2>
          </div>
          <div className="list">
            {groups.map(([stage, ids]) => {
              const s = stageById[stage as StageId]
              // how current this place is: the oldest position in the group, never the freshest one (audit D04)
              const age = Math.max(...ids.map((id) => crew.byId[id]?.seen ?? 0))
              const stale = age > 30
              return (
                <button
                  key={stage}
                  className="list-item"
                  onClick={() => {
                    setFocusPoi('route:stage-' + stage)
                    setTab('map')
                  }}
                >
                  <AvatarStack ids={ids} max={4} />
                  <span className="grow">
                    <span style={{ fontWeight: 600, fontSize: 16 }}>
                      {t('{n} bei {stage}', { n: ids.length, stage: s.name })}
                    </span>
                    <span className="small faint row" style={{ gap: 6 }}>
                      <StageDot id={s.id} />
                      {here && t('ca. {n} Min. entfernt', { n: walkMinutes(here.x, here.y, s.x, s.y) })}
                      <span style={stale ? { color: 'var(--warn)' } : undefined}>
                        {here ? '· ' : ''}{age <= 1 ? t('Stand: gerade eben') : stale ? t('Stand vor {n} Min. · veraltet', { n: age }) : t('Stand vor {n} Min.', { n: age })}
                      </span>
                    </span>
                  </span>
                  <Navigation size={18} className="faint" />
                </button>
              )
            })}
            {hidden.length > 0 && (
              <div className="list-item small faint">
                <AvatarStack ids={hidden.map((h) => h.id)} />
                {hidden.length === 1 ? t('{names} teilt gerade keinen Standort', { names: hidden[0].name }) : t('{names} teilen gerade keinen Standort', { names: hidden.map((h) => h.name).join(', ') })}
              </div>
            )}
          </div>
          <FairPoint />
        </motion.section>
        )}

        {nextShared && (
          <motion.section {...stagger(2)}>
            <button className="hero" style={{ width: '100%', textAlign: 'left', padding: 20 }} onClick={() => openSheet({ kind: 'act', id: nextShared.a.id })}>
              <span className="label next">{t('Nächster gemeinsamer Act')}</span>
              <h1 style={{ fontSize: 32 }}>{nextShared.a.artist}</h1>
              <div className="meta row" style={{ gap: 8 }}>
                <StageDot id={nextShared.a.stage} />
                {stageById[nextShared.a.stage].name} · {fmt(nextShared.a.start)}
              </div>
              <div className="row small muted" style={{ gap: 8, marginTop: 12 }}>
                <AvatarStack ids={nextShared.f} max={5} />
                {t('{n} aus deiner Crew', { n: nextShared.f.length })}
              </div>
            </button>
          </motion.section>
        )}

        <motion.section {...stagger(3)}>
          <div className="section-h">
            <h2>{t('Meetups')}</h2>
            <button onClick={() => requireIdentity(t('Damit deine Crew weiß, wer einlädt.'), () => openSheet({ kind: 'newMeetup' }))}>
              <CalendarPlus size={15} style={{ marginRight: 4 }} /> {t('Neu')}
            </button>
          </div>
          {meetup ? (
            <button className="tile" onClick={() => openSheet({ kind: 'meetup', id: meetup.id })}>
              <span className="tile-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 700, fontSize: 13 }}>
                {fmt(meetup.min)}
              </span>
              <span className="grow">
                <span style={{ fontWeight: 600 }}>{meetup.place}</span>
                <span className="small faint" style={{ display: 'block' }}>
                  {t('{n} zugesagt', { n: meetup.going.length })}
                  {meetup.note ? ` · ${meetup.note}` : ''}
                </span>
              </span>
              {meetup.going.includes('me') ? <span className="tag ok">{t('Dabei')}</span> : <ChevronRight size={18} className="faint" />}
            </button>
          ) : (
            <p className="small faint" style={{ margin: 0 }}>
              {t('Kein Meetup geplant. Erstelle eins direkt an einem Act, einem Kartenpunkt oder aus dem Chat.')}
            </p>
          )}
        </motion.section>

        <motion.section {...stagger(4)} className="list">
          {on('chat') && <button className="list-item" onClick={() => openSheet({ kind: 'chat' })}>
            <span className="tile-icon">
              <MessageCircle size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>{t('Crew-Chat')}</span>
              <span className="small faint ellipsis" style={{ display: 'block' }}>
                {lastMsg ? lastMsg.text : t('Noch keine Nachrichten')}
              </span>
            </span>
            <span className="tiny faint">{unread > 0 && lastMsg && fmt(lastMsg.min)}</span>
          </button>}
          {on('festivalchat') && (
            <button className="list-item" onClick={() => openSheet({ kind: 'festivalChat' })}>
              <span className="tile-icon">
                <Megaphone size={20} />
              </span>
              <span className="grow">
                <span style={{ fontWeight: 600 }}>{t('Festival-Chat')}</span>
                <span className="small faint" style={{ display: 'block' }}>
                  {t('Für alle auf dem Festival · moderiert')}
                </span>
              </span>
              <ChevronRight size={18} className="faint" />
            </button>
          )}
          <button className="list-item" onClick={() => openSheet({ kind: 'members' })}>
            <span className="tile-icon">
              <Users size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>{t('Mitglieder')}</span>
              <span className="small faint" style={{ display: 'block' }}>
                {crew.members.length ? t('{n} Personen', { n: crew.members.length + 1 }) : t('1 Person')}
                {crew.owner === 'me' ? ' · ' + t('du moderierst') : ''}
              </span>
            </span>
            <ChevronRight size={18} className="faint" />
          </button>
          <button className="list-item" onClick={() => openSheet({ kind: 'shared' })}>
            <span className="tile-icon">
              <Heart size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>{t('Gemeinsame Acts')}</span>
              <span className="small faint" style={{ display: 'block' }}>
                {t('{n} deiner Acts mit Freunden', { n: sharedCount })}
              </span>
            </span>
            <ChevronRight size={18} className="faint" />
          </button>
          {on('steps') && <button className="list-item" onClick={() => openSheet({ kind: 'steps' })}>
            <span className="tile-icon">
              <Footprints size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>{t('Step-Challenge')}</span>
              <span className="small faint" style={{ display: 'block' }}>
                {/* fixed numbers only in the demo – live, the sheet shows what the server has */}
                {stepsOptIn ? (online ? t('Rangliste deiner Crew ansehen') : t('Platz 3 von 10 · heute {n} Schritte', { n: num(12840) })) : t('Freiwillig · nur Tagessumme, kein Standort')}
              </span>
            </span>
            <ChevronRight size={18} className="faint" />
          </button>}
          {on('location') && (
          <div className="list-item">
            <span className="tile-icon" style={shareLocation ? { background: 'var(--ok-soft)', color: 'var(--ok)' } : undefined}>
              <MapPin size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>{t('Standort mit Crew teilen')}</span>
              <span className="small faint" style={{ display: 'block' }}>
                {shareLocation ? t('Nur Stage-Bereich, nur für deine Crew · endet 2 Std. nach der letzten Nutzung') : t('Aus – du siehst die anderen trotzdem')}
              </span>
              {pendingPrivacy.location && (
                <span className="small" role="status" style={{ display: 'block', color: 'var(--warn)', marginTop: 2 }}>
                  {pendingPrivacy.location === 'off' ? t('Freigabe wird zurückgezogen … wartet auf Verbindung') : t('Freigabe wird übertragen …')}
                </span>
              )}
            </span>
            <Switch on={shareLocation} onChange={(v) => set('shareLocation', v)} label={t('Standort teilen')} />
          </div>
          )}
          {crew.live && (
            <button className="list-item small" style={{ color: 'var(--text-3)' }} onClick={() => confirm(t('„{name}“ wirklich verlassen?', { name: crew.name })) && leaveCrew()}>
              <LogOut size={18} /> {t('Crew verlassen')}
            </button>
          )}
        </motion.section>
      </div>
    </main>
  )
}

const MEET_AT: PoiCat[] = ['stage', 'bar', 'food', 'info', 'water', 'entrance']

/** Suggests the place where the longest walk for anyone in the crew is shortest. */
function FairPoint() {
  const { crew, setFocusPoi, setTab, openSheet, requireIdentity, here } = useApp()
  // only positions people actually gave: the visitor's chosen place (if any) and crew members' shared stages
  const people = [...(here ? [here] : []), ...crew.members.filter((m) => m.at && m.at !== 'camp' && stageById[m.at as StageId]).map((m) => stageById[m.at as StageId])]
  const best = fairMeetingPoint(
    people,
    POIS.filter((p) => MEET_AT.includes(p.cat) && p.status !== 'closed'),
  )
  if (!best) return null
  return (
    <div className="card fair" style={{ marginTop: 10 }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="tile-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
          <Users size={20} />
        </span>
        <span className="grow">
          <span className="tiny faint" style={{ display: 'block' }}>
            {t('Fairer Treffpunkt für alle')}
          </span>
          <span style={{ fontWeight: 600 }}>{best.spot.name}</span>
          <span className="small faint" style={{ display: 'block' }}>
            {t('Höchstens {n} Min. Weg für jede:n', { n: best.max })}
          </span>
        </span>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button
          className="btn secondary sm"
          onClick={() => {
            setFocusPoi('route:' + best.spot.id)
            setTab('map')
          }}
        >
          <Navigation size={15} /> {t('Richtung')}
        </button>
        {on('crew') && (
          <button className="btn ghost sm" onClick={() => requireIdentity(t('Damit deine Crew weiß, wer einlädt.'), () => openSheet({ kind: 'newMeetup', poi: best.spot.id, place: best.spot.name }))}>
            <CalendarPlus size={15} /> {t('Hier treffen')}
          </button>
        )}
      </div>
    </div>
  )
}

/** A join request waits for the crew's owner (audit F05): until then nothing of the crew is visible. */
function CrewPending({ name }: { name: string }) {
  const { leaveCrew } = useApp()
  return (
    <main className="screen">
      <div className="stack">
        <motion.div {...stagger(0)} className="hero">
          <span className="label next">{t('Crew')}</span>
          <h1>{t('Anfrage gesendet')}</h1>
          <p className="meta">{t('Wer „{name}“ verantwortet, muss dich erst freigeben. Bis dahin siehst du weder Chat noch Pläne oder Standorte – und die Crew sieht nur deinen Namen.', { name })}</p>
        </motion.div>
        <motion.div {...stagger(1)} className="card small muted" role="status">
          {t('Die App prüft regelmäßig, ob du freigegeben wurdest.')}
        </motion.div>
        <motion.button {...stagger(2)} className="btn ghost" onClick={() => leaveCrew()}>
          <LogOut size={16} /> {t('Anfrage zurückziehen')}
        </motion.button>
      </div>
    </main>
  )
}

function CrewOnboarding() {
  const { createCrew, joinCrew, requireIdentity, pendingJoin, set } = useApp()
  const [name, setName] = useState('')
  const [code, setCode] = useState(pendingJoin ?? '')
  const [busy, setBusy] = useState(false)
  const run = (fn: () => Promise<void>) =>
    requireIdentity(t('Deine Crew sieht dich mit diesem Namen.'), async () => {
      setBusy(true)
      await fn()
      setBusy(false)
    })
  return (
    <main className="screen">
      <div className="stack">
        <motion.div {...stagger(0)} className="hero">
          <span className="label next">{t('Crew')}</span>
          <h1>{t('Wo sind meine Leute?')}</h1>
          <p className="meta">{t('Seht, wer wo ist, plant Meetups und schreibt euch – ohne Account, ohne E-Mail.')}</p>
        </motion.div>

        {pendingJoin && (
          <motion.section {...stagger(1)} className="card">
            <span className="label next">{t('Einladung')}</span>
            <div style={{ fontWeight: 600, fontSize: 17, margin: '6px 0 14px' }}>{t('Du wurdest in eine Crew eingeladen')}</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" disabled={busy} onClick={() => run(() => joinCrew(pendingJoin))}>
                {t('Beitreten')}
              </button>
              <button className="btn ghost" onClick={() => set('pendingJoin', null)}>
                {t('Ignorieren')}
              </button>
            </div>
          </motion.section>
        )}

        <motion.form
          {...stagger(2)}
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) run(() => createCrew(name.trim()))
          }}
        >
          <div className="section-h">
            <h2>{t('Crew gründen')}</h2>
          </div>
          <input className="field" placeholder={t('z. B. Zeltplatz 14')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label={t('Crew-Name')} />
          <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy || !name.trim()}>
            {t('Crew gründen')}
          </button>
        </motion.form>

        <motion.form
          {...stagger(3)}
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) run(() => joinCrew(code.trim()))
          }}
        >
          <div className="section-h">
            <h2>{t('Mit Code beitreten')}</h2>
          </div>
          <input className="field" placeholder="ABCD-EFGH" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" aria-label={t('Einladungscode')} style={{ letterSpacing: '0.1em', fontWeight: 600 }} />
          <button className="btn secondary block" style={{ marginTop: 10 }} disabled={busy || code.replace(/[^a-z0-9]/gi, '').length < 8}>
            {t('Beitreten')}
          </button>
        </motion.form>
      </div>
    </main>
  )
}
