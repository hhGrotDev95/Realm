import { motion } from 'framer-motion'
import { CalendarPlus, ChevronRight, Footprints, Heart, LogOut, MapPin, MessageCircle, Navigation, Share2, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { ACTS, fmt, stageById, ME, walkMinutes, type StageId } from '../data'
import { isMeetupActive, useApp } from '../store'
import { status } from '../time'
import { AvatarStack, StageDot, Switch, stagger } from '../ui'
import { useScrollTop } from './Home'

export function Crew() {
  const { crew, online, crewRef } = useApp()
  if (online && !crewRef) return <CrewOnboarding />
  return <CrewHome key={crew.name} />
}

function CrewHome() {
  const { crew, inviteLink, toast, leaveCrew } = useApp()
  const { now, plan, meetups, declined, openSheet, setTab, setFocusPoi, shareLocation, set, guest, requireIdentity, stepsOptIn, chat, phase } = useApp()
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
  const freshest = Math.min(...crew.members.filter((m) => m.at).map((m) => m.seen))
  const share = async () => {
    const url = inviteLink()
    if (!url) return
    const text = `Komm in meine Crew „${crew.name}“ bei Realm: ${url}`
    if (navigator.share) await navigator.share({ text, url }).catch(() => {})
    else {
      await navigator.clipboard?.writeText(url).catch(() => {})
      toast('Einladungslink kopiert')
    }
  }

  return (
    <main className="screen" ref={ref}>
      <div className="stack">
        {!guest.nickname && (
          <motion.button {...stagger(0)} className="alert info" onClick={() => requireIdentity('Deine Crew sieht dich mit diesem Namen.', () => {})}>
            <span className="grow">
              <strong>Wie soll deine Crew dich nennen?</strong>
              <span className="small muted">Nur ein Name und eine Farbe – kein Account, keine E-Mail.</span>
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
                {crew.members.length + 1} {crew.members.length ? 'Personen' : 'Person'} · Code {crew.code}
              </span>
            </span>
            <button className="btn secondary sm" onClick={share}>
              <Share2 size={15} /> Einladen
            </button>
          </motion.section>
        )}

        {crew.live && crew.members.length === 0 && (
          <motion.section {...stagger(1)} className="card" style={{ textAlign: 'center' }}>
            <UserPlus size={26} className="faint" />
            <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>Noch niemand da</div>
            <p className="small muted" style={{ margin: '0 0 14px' }}>
              Teile den Link oder den Code <b>{crew.code}</b> – deine Freunde brauchen keinen Account.
            </p>
            <button className="btn primary sm" onClick={share}>
              Einladungslink teilen
            </button>
          </motion.section>
        )}

        {crew.members.length > 0 && (
        <motion.section {...stagger(1)}>
          <div className="section-h">
            <h2>Wo ist meine Crew?</h2>
            <span className="tiny faint">{groups.length ? `live · ${freshest <= 1 ? 'gerade eben' : `vor ${freshest} Min.`}` : ''}</span>
          </div>
          <div className="list">
            {groups.map(([stage, ids]) => {
              const s = stageById[stage as StageId]
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
                      {ids.length} bei {s.name}
                    </span>
                    <span className="small faint row" style={{ gap: 6 }}>
                      <StageDot id={s.id} />
                      {walkMinutes(ME.x, ME.y, s.x, s.y)} Min. entfernt
                    </span>
                  </span>
                  <Navigation size={18} className="faint" />
                </button>
              )
            })}
            {hidden.length > 0 && (
              <div className="list-item small faint">
                <AvatarStack ids={hidden.map((h) => h.id)} />
                {hidden.map((h) => h.name).join(', ')} {hidden.length === 1 ? 'teilt' : 'teilen'} gerade keinen Standort
              </div>
            )}
          </div>
        </motion.section>
        )}

        {nextShared && (
          <motion.section {...stagger(2)}>
            <button className="hero" style={{ width: '100%', textAlign: 'left', padding: 20 }} onClick={() => openSheet({ kind: 'act', id: nextShared.a.id })}>
              <span className="label next">Nächster gemeinsamer Act</span>
              <h1 style={{ fontSize: 32 }}>{nextShared.a.artist}</h1>
              <div className="meta row" style={{ gap: 8 }}>
                <StageDot id={nextShared.a.stage} />
                {stageById[nextShared.a.stage].name} · {fmt(nextShared.a.start)}
              </div>
              <div className="row small muted" style={{ gap: 8, marginTop: 12 }}>
                <AvatarStack ids={nextShared.f} max={5} />
                {nextShared.f.length} aus deiner Crew
              </div>
            </button>
          </motion.section>
        )}

        <motion.section {...stagger(3)}>
          <div className="section-h">
            <h2>Meetups</h2>
            <button onClick={() => requireIdentity('Damit deine Crew weiß, wer einlädt.', () => openSheet({ kind: 'newMeetup' }))}>
              <CalendarPlus size={15} style={{ marginRight: 4 }} /> Neu
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
                  {meetup.going.length} zugesagt{meetup.note ? ` · ${meetup.note}` : ''}
                </span>
              </span>
              {meetup.going.includes('me') ? <span className="tag ok">Dabei</span> : <ChevronRight size={18} className="faint" />}
            </button>
          ) : (
            <p className="small faint" style={{ margin: 0 }}>
              Kein Meetup geplant. Erstelle eins direkt an einem Act, einem Kartenpunkt oder aus dem Chat.
            </p>
          )}
        </motion.section>

        <motion.section {...stagger(4)} className="list">
          <button className="list-item" onClick={() => openSheet({ kind: 'chat' })}>
            <span className="tile-icon">
              <MessageCircle size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>Crew-Chat</span>
              <span className="small faint ellipsis" style={{ display: 'block' }}>
                {lastMsg ? lastMsg.text : 'Noch keine Nachrichten'}
              </span>
            </span>
            <span className="tiny faint">{unread > 0 && lastMsg && fmt(lastMsg.min)}</span>
          </button>
          <button className="list-item" onClick={() => openSheet({ kind: 'members' })}>
            <span className="tile-icon">
              <Users size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>Mitglieder</span>
              <span className="small faint" style={{ display: 'block' }}>
                {crew.members.length + 1} Personen{crew.owner === 'me' ? ' · du moderierst' : ''}
              </span>
            </span>
            <ChevronRight size={18} className="faint" />
          </button>
          <button className="list-item" onClick={() => openSheet({ kind: 'shared' })}>
            <span className="tile-icon">
              <Heart size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>Gemeinsame Acts</span>
              <span className="small faint" style={{ display: 'block' }}>
                {sharedCount} deiner Acts mit Freunden
              </span>
            </span>
            <ChevronRight size={18} className="faint" />
          </button>
          <button className="list-item" onClick={() => openSheet({ kind: 'steps' })}>
            <span className="tile-icon">
              <Footprints size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>Step-Challenge</span>
              <span className="small faint" style={{ display: 'block' }}>
                {stepsOptIn ? 'Platz 3 von 10 · heute 12.840 Schritte' : 'Freiwillig · nur Tagessumme, kein Standort'}
              </span>
            </span>
            <ChevronRight size={18} className="faint" />
          </button>
          <div className="list-item">
            <span className="tile-icon" style={shareLocation ? { background: 'var(--ok-soft)', color: 'var(--ok)' } : undefined}>
              <MapPin size={20} />
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600 }}>Standort mit Crew teilen</span>
              <span className="small faint" style={{ display: 'block' }}>
                {shareLocation ? 'Nur Stage-Bereich, nur für deine Crew' : 'Aus – du siehst die anderen trotzdem'}
              </span>
            </span>
            <Switch on={shareLocation} onChange={(v) => set('shareLocation', v)} label="Standort teilen" />
          </div>
          {crew.live && (
            <button className="list-item small" style={{ color: 'var(--text-3)' }} onClick={() => confirm(`„${crew.name}“ wirklich verlassen?`) && leaveCrew()}>
              <LogOut size={18} /> Crew verlassen
            </button>
          )}
        </motion.section>
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
    requireIdentity('Deine Crew sieht dich mit diesem Namen.', async () => {
      setBusy(true)
      await fn()
      setBusy(false)
    })
  return (
    <main className="screen">
      <div className="stack">
        <motion.div {...stagger(0)} className="hero">
          <span className="label next">Crew</span>
          <h1>Wo sind meine Leute?</h1>
          <p className="meta">Seht, wer wo ist, plant Meetups und schreibt euch – ohne Account, ohne E-Mail.</p>
        </motion.div>

        {pendingJoin && (
          <motion.section {...stagger(1)} className="card">
            <span className="label next">Einladung</span>
            <div style={{ fontWeight: 600, fontSize: 17, margin: '6px 0 14px' }}>Du wurdest in eine Crew eingeladen</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" disabled={busy} onClick={() => run(() => joinCrew(pendingJoin))}>
                Beitreten
              </button>
              <button className="btn ghost" onClick={() => set('pendingJoin', null)}>
                Ignorieren
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
            <h2>Crew gründen</h2>
          </div>
          <input className="field" placeholder="z. B. Zeltplatz 14" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Crew-Name" />
          <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy || !name.trim()}>
            Crew gründen
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
            <h2>Mit Code beitreten</h2>
          </div>
          <input className="field" placeholder="ABCD-EFGH" value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" aria-label="Einladungscode" style={{ letterSpacing: '0.1em', fontWeight: 600 }} />
          <button className="btn secondary block" style={{ marginTop: 10 }} disabled={busy || code.replace(/[^a-z0-9]/gi, '').length < 8}>
            Beitreten
          </button>
        </motion.form>
      </div>
    </main>
  )
}
