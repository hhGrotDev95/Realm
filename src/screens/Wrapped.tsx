import { AnimatePresence, m as motion } from 'framer-motion'
import { Share2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FESTIVAL, actById, DAYS, fmt, stageById, STAGES, type StageId } from '../data'
import { useApp } from '../store'

const DURATION = 5200

export function Wrapped() {
  const { crew } = useApp()
  const { plan, attended, closeSheet, guest, toast, online } = useApp()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)

  const data = useMemo(() => {
    const planned = plan.map((id) => actById[id]).filter(Boolean)
    const seen = planned.filter((a) => attended[a.id] !== false)
    const confirmed = planned.filter((a) => attended[a.id] === true).length
    const stageCount = seen.reduce<Record<string, number>>((acc, a) => ((acc[a.stage] = (acc[a.stage] ?? 0) + 1), acc), {})
    const fav = (Object.entries(stageCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? STAGES[0]?.id ?? '') as StageId
    const minutes = seen.reduce((s, a) => s + (a.end - a.start), 0)
    const latest = [...seen].sort((a, b) => b.end - a.end)[0]
    const earliest = [...seen].sort((a, b) => a.start - b.start)[0]
    const buddy = crew.members.map((f) => ({ f, n: seen.filter((a) => crew.friendsFor(a.id).includes(f.id)).length })).sort((a, b) => b.n - a.n)[0] as { f: { name: string; color: string }; n: number } | undefined
    return { planned, seen, confirmed, fav, minutes, latest, earliest, buddy, stageCount }
  }, [plan, attended])

  const slides = [
    {
      bg: 'linear-gradient(160deg,#6b4dff,#1b0f4a)',
      body: (
        <>
          <div className="label" style={{ color: 'rgba(255,255,255,.7)' }}>
            {FESTIVAL.name}
          </div>
          <h3 style={{ fontSize: 48 }}>{guest.nickname ? `${guest.nickname},` : 'Hey,'} das war dein Festival.</h3>
          <p style={{ opacity: 0.8 }}>Drei Tage. Fünf Stages. Eine Crew.</p>
        </>
      ),
    },
    {
      bg: 'linear-gradient(160deg,#ff6b5a,#4a0f1b)',
      body: (
        <>
          <p style={{ opacity: 0.8 }}>Du hast gesehen</p>
          <div className="big">{data.seen.length} Sets</div>
          <h3>{Math.round(data.minutes / 60)} Stunden Musik.</h3>
          <p style={{ opacity: 0.7, fontSize: 14 }}>
            {data.confirmed} davon hast du bestätigt, der Rest stand in deinem Plan.
          </p>
        </>
      ),
    },
    {
      bg: `linear-gradient(160deg, ${stageById[data.fav].color}, #101014 80%)`,
      body: (
        <>
          <p style={{ opacity: 0.8 }}>Dein Zuhause war die</p>
          <div className="big" style={{ fontSize: 64 }}>
            {stageById[data.fav].name}
          </div>
          <h3>{stageById[data.fav].vibe}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
            {STAGES.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ width: 86 }}>{s.name}</span>
                <motion.span initial={{ width: 0 }} animate={{ width: `${((data.stageCount[s.id] ?? 0) / Math.max(1, ...Object.values(data.stageCount))) * 60}%` }} transition={{ delay: 0.3, duration: 0.8 }} style={{ height: 8, borderRadius: 4, background: '#fff' }} />
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      bg: 'linear-gradient(160deg,#0f3a4a,#0a0a0d)',
      body: (
        <>
          <p style={{ opacity: 0.8 }}>Früh dran & lang wach</p>
          {data.earliest && (
            <h3>
              {fmt(data.earliest.start)} · {data.earliest.artist}
            </h3>
          )}
          {data.latest && (
            <div className="big" style={{ fontSize: 64 }}>
              {fmt(data.latest.end)}
            </div>
          )}
          <p style={{ opacity: 0.8 }}>{data.latest ? `Letzter Ton bei ${data.latest.artist}, ${DAYS[data.latest.day].label}.` : ''}</p>
        </>
      ),
    },
    data.buddy && {
      bg: `linear-gradient(160deg, ${data.buddy.f.color}, #101014 85%)`,
      body: (
        <>
          <p style={{ opacity: 0.8 }}>Dein Festival-Buddy</p>
          <div className="big">{data.buddy?.f.name}</div>
          <h3>{data.buddy?.n} gemeinsame Sets.</h3>
          {!online && <p style={{ opacity: 0.8 }}>Und {(12840 * 3 + 4200).toLocaleString('de-DE')} Schritte von dir – Platz 3 in der Crew.</p>}
        </>
      ),
    },
    {
      bg: 'linear-gradient(160deg, var(--brand), #ff6b5a)',
      body: (
        <>
          <h3 style={{ fontSize: 40 }}>Bis nächstes Jahr.</h3>
          <p style={{ opacity: 0.85 }}>Teile deinen Rückblick mit deiner Crew.</p>
          <button
            className="btn"
            style={{ background: '#fff', color: '#111', alignSelf: 'flex-start', marginTop: 12 }}
            onClick={(e) => {
              e.stopPropagation()
              const text = `Mein ${FESTIVAL.name}: ${data.seen.length} Sets, Lieblingsstage ${stageById[data.fav]?.name ?? '–'}.`
              if (navigator.share) navigator.share({ text }).catch(() => {})
              else {
                navigator.clipboard?.writeText(text).catch(() => {})
                toast('In die Zwischenablage kopiert')
              }
            }}
          >
            <Share2 size={17} /> Teilen
          </button>
        </>
      ),
    },
  ].filter((x): x is { bg: string; body: React.ReactElement } => !!x)

  useEffect(() => {
    if (paused) return
    const t = setTimeout(() => (i < slides.length - 1 ? setI(i + 1) : undefined), DURATION)
    return () => clearTimeout(t)
  }, [i, paused, slides.length])

  return (
    <motion.div className="wrapped" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.3 }}>
      <AnimatePresence initial={false}>
        <motion.div key={'bg' + i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }} style={{ position: 'absolute', inset: 0, background: slides[i].bg }} />
      </AnimatePresence>
      <div className="bars">
        {slides.map((_, k) => (
          <i key={k}>
            {k < i && <b style={{ width: '100%' }} />}
            {k === i && <motion.b key={i + String(paused)} initial={{ width: paused ? undefined : '0%' }} animate={{ width: paused ? undefined : '100%' }} transition={{ duration: DURATION / 1000, ease: 'linear' }} />}
          </i>
        ))}
      </div>
      <button className="icon-btn" style={{ position: 'absolute', top: 30, right: 10, zIndex: 3, color: '#fff' }} onClick={closeSheet} aria-label="Schließen">
        <X size={22} />
      </button>
      <div
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
        onPointerDown={() => setPaused(true)}
        onPointerUp={(e) => {
          setPaused(false)
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          if (e.clientX - r.left < r.width / 3) setI(Math.max(0, i - 1))
          else setI(Math.min(slides.length - 1, i + 1))
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={i} className="slide" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
            {slides[i].body}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
