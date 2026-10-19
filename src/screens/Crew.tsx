import { motion } from 'framer-motion'
import { CalendarPlus, ChevronRight, Footprints, Heart, MapPin, MessageCircle, Navigation } from 'lucide-react'
import { ACTS, FRIENDS, fmt, friendsFor, stageById, ME, walkMinutes, type StageId } from '../data'
import { isMeetupActive, useApp } from '../store'
import { status } from '../time'
import { AvatarStack, StageDot, Switch, stagger } from '../ui'
import { useScrollTop } from './Home'

export function Crew() {
  const { now, plan, meetups, declined, openSheet, setTab, setFocusPoi, shareLocation, set, guest, requireIdentity, stepsOptIn, chat, phase } = useApp()
  const ref = useScrollTop()

  const groups = Object.entries(
    FRIENDS.filter((f) => f.at && f.at !== 'camp').reduce<Record<string, string[]>>((acc, f) => ((acc[f.at!] ??= []).push(f.id), acc), {}),
  ).sort((a, b) => b[1].length - a[1].length)
  const hidden = FRIENDS.filter((f) => !f.at)

  const day = phase === 'during' ? now.day : 0
  const clock = phase === 'during' ? now : { day: 0, min: 0 }
  const nextShared = ACTS.filter((a) => plan.includes(a.id) && a.day === day && status(a, clock) !== 'past')
    .map((a) => ({ a, f: friendsFor(a.id) }))
    .filter((x) => x.f.length)
    .sort((x, y) => x.a.start - y.a.start)[0]
  const sharedCount = plan.filter((id) => friendsFor(id).length > 0).length
  const meetup = meetups.filter((m) => !declined.includes(m.id) && isMeetupActive(m, clock)).sort((a, b) => a.day - b.day || a.min - b.min)[0]
  const unread = chat.filter((c) => c.from !== 'me').length

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

        <motion.section {...stagger(1)}>
          <div className="section-h">
            <h2>Wo ist meine Crew?</h2>
            <span className="tiny faint">live · vor 2 Min.</span>
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
                {hidden.map((h) => h.name).join(', ')} teilt gerade keinen Standort
              </div>
            )}
          </div>
        </motion.section>

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
                {chat[chat.length - 1].text}
              </span>
            </span>
            <span className="tiny faint">{unread > 0 && fmt(chat[chat.length - 1].min)}</span>
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
        </motion.section>
      </div>
    </main>
  )
}
