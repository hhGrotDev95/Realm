import { AnimatePresence, motion } from 'framer-motion'
import { GanttChart, Heart, LayoutList, Search, SlidersHorizontal, TriangleAlert, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ACTS, DAYS, fmt, STAGES, stageById, type Act, type StageId } from '../data'
import { conflictClusters, useApp } from '../store'
import { status } from '../time'
import { AvatarStack, FavButton, Segmented, StageDot, spring } from '../ui'
import { useScrollTop } from './Home'

type Mode = 'plan' | 'all'

export function Lineup() {
  const app = useApp()
  const { plan, now, phase, resolved, openSheet } = app
  const live = phase === 'during' || phase === 'arrival'
  const [day, setDay] = useState(live ? Math.max(0, Math.min(DAYS.length - 1, now.day)) : 0)
  const [mode, setMode] = useState<Mode>(plan.length ? 'plan' : 'all')
  const [view, setView] = useState<'list' | 'timeline'>('list')
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [stages, setStages] = useState<StageId[]>([])
  const [groupByStage, setGroup] = useState(false)
  const ref = useScrollTop()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  const acts = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return ACTS.filter(
      (a) =>
        (ql ? true : a.day === day) &&
        (mode === 'all' || plan.includes(a.id)) &&
        (!stages.length || stages.includes(a.stage)) &&
        (!ql || a.artist.toLowerCase().includes(ql) || a.genre.toLowerCase().includes(ql) || stageById[a.stage].name.toLowerCase().includes(ql)),
    )
  }, [day, mode, plan, stages, q])

  const clusters = mode === 'plan' && !q ? conflictClusters(plan, day, resolved) : []
  const clusterStart = new Map(clusters.map((c) => [c.acts[0].id, c]))
  const filterCount = stages.length + (groupByStage ? 1 : 0)
  const dayIsToday = (d: number) => live && now.day === d

  return (
    <main className="screen" ref={ref}>
      <div className="sticky-top">
        <AnimatePresence initial={false} mode="popLayout">
          {searchOpen ? (
            <motion.div key="s" className="search" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Search size={18} />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist, Genre oder Stage" aria-label="Suche" />
              <button
                className="icon-btn"
                style={{ width: 32, height: 32 }}
                aria-label="Suche schließen"
                onClick={() => {
                  setQ('')
                  setSearchOpen(false)
                }}
              >
                <X size={18} />
              </button>
            </motion.div>
          ) : (
            <motion.div key="d" className="days" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {DAYS.map((d) => (
                <button key={d.idx} className={`day-btn ${day === d.idx ? 'on' : ''}`} onClick={() => setDay(d.idx)} aria-pressed={day === d.idx}>
                  {day === d.idx && <motion.span layoutId="day-pill" className="pill" transition={spring} />}
                  {dayIsToday(d.idx) && <span className="today" aria-label="heute" />}
                  <b>{d.short}</b>
                  <span>{d.date.slice(8)}.07.</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="toolbar">
          <Segmented
            id="mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'plan', label: `Mein Plan` },
              { value: 'all', label: 'Alle' },
            ]}
          />
          <span className="grow" />
          <button className={`icon-btn ${searchOpen ? 'active' : ''}`} aria-label="Suche" onClick={() => setSearchOpen((v) => !v)}>
            <Search size={20} />
          </button>
          <button className={`icon-btn ${filterOpen || filterCount ? 'active' : ''}`} aria-label="Filter" onClick={() => setFilterOpen((v) => !v)}>
            <SlidersHorizontal size={20} />
            {filterCount > 0 && !filterOpen && <span className="dot" />}
          </button>
          <button className="icon-btn" aria-label={view === 'list' ? 'Timeline-Ansicht' : 'Listen-Ansicht'} onClick={() => setView((v) => (v === 'list' ? 'timeline' : 'list'))}>
            {view === 'list' ? <GanttChart size={20} /> : <LayoutList size={20} />}
          </button>
        </div>
        <AnimatePresence initial={false}>
          {filterOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: 'hidden' }}>
              <div className="chips" style={{ paddingTop: 10 }}>
                {STAGES.map((s) => {
                  const on = stages.includes(s.id)
                  return (
                    <button key={s.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setStages(on ? stages.filter((x) => x !== s.id) : [...stages, s.id])}>
                      <StageDot id={s.id} />
                      {s.name}
                    </button>
                  )
                })}
              </div>
              <div className="row small" style={{ paddingTop: 10, justifyContent: 'space-between' }}>
                <button className={`chip ${groupByStage ? 'on' : ''}`} onClick={() => setGroup(!groupByStage)}>
                  Nach Stage gruppieren
                </button>
                {filterCount > 0 && (
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setStages([])
                      setGroup(false)
                    }}
                  >
                    Zurücksetzen
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {q && (
        <div className="small faint" style={{ margin: '6px 0' }}>
          {acts.length} Treffer an allen Tagen
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${day}-${mode}-${view}-${groupByStage}`} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}>
          {acts.length === 0 ? (
            <Empty mode={mode} q={q} onAll={() => setMode('all')} />
          ) : view === 'timeline' && !q ? (
            <Timeline acts={acts} day={day} onOpen={(id) => openSheet({ kind: 'act', id })} />
          ) : groupByStage ? (
            STAGES.filter((s) => acts.some((a) => a.stage === s.id)).map((s) => (
              <section key={s.id} style={{ marginTop: 18 }}>
                <div className="label row" style={{ gap: 6 }}>
                  <StageDot id={s.id} /> {s.name}
                </div>
                {acts
                  .filter((a) => a.stage === s.id)
                  .map((a) => (
                    <ActRow key={a.id} a={a} showDay={!!q} />
                  ))}
              </section>
            ))
          ) : (
            <div className="list">
              {acts.map((a) => {
                const c = clusterStart.get(a.id)
                return (
                  <Fragment key={a.id}>
                    {c && (
                      <button className="conflict" onClick={() => openSheet({ kind: 'resolver', ids: c.acts.map((x) => x.id), key: c.key })}>
                        <TriangleAlert className="a-ic" size={19} />
                        <span className="grow small">
                          <strong>
                            {fmt(c.start)}–{fmt(c.end)}
                          </strong>{' '}
                          · {c.acts.length} Acts überschneiden sich
                        </span>
                        <span className="go">Entscheiden</span>
                      </button>
                    )}
                    <ActRow a={a} showDay={!!q} />
                  </Fragment>
                )
              })}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  )
}

function Empty({ mode, q, onAll }: { mode: Mode; q: string; onAll: () => void }) {
  if (q)
    return (
      <div className="empty">
        <b>Nichts gefunden</b>Versuch es mit einem Genre wie „Techno“ oder einer Stage.
      </div>
    )
  return (
    <div className="empty">
      <Heart size={28} style={{ marginBottom: 10 }} />
      <b>{mode === 'plan' ? 'Noch nichts geplant' : 'Keine Acts'}</b>
      {mode === 'plan' && (
        <>
          Tippe auf das Herz bei einem Act, um ihn zu deinem Plan hinzuzufügen.
          <div style={{ marginTop: 16 }}>
            <button className="btn primary sm" onClick={onAll}>
              Alle Acts ansehen
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function ActRow({ a, showDay }: { a: Act; showDay?: boolean }) {
  const { crew } = useApp()
  const { now, openSheet } = useApp()
  const st = status(a, now)
  const friends = crew.friendsFor(a.id)
  return (
    <motion.div layout="position" className={`act ${st} ${a.change?.cancelled ? 'cancelled' : ''}`}>
      {/* the row and the heart are sibling controls – never nest interactive elements */}
      <button className="act-main" onClick={() => openSheet({ kind: 'act', id: a.id })}>
      <div className="time">
        {fmt(a.start)}
        <small>{showDay ? DAYS[a.day].short : st === 'live' ? 'live' : fmt(a.end)}</small>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="name ellipsis">{a.artist}</div>
        {a.change && <ChangeTag a={a} />}
        <div className="sub">
          <StageDot id={a.stage} />
          <span className="ellipsis">{stageById[a.stage].name}</span>
          {friends.length > 0 && (
            <span style={{ marginLeft: 6 }}>
              <AvatarStack ids={friends} />
            </span>
          )}
        </div>
      </div>
      </button>
      <FavButton id={a.id} />
    </motion.div>
  )
}

/** Short, colour-coded hint when the organizer changed a slot. */
export function ChangeTag({ a }: { a: Act }) {
  const c = a.change!
  if (c.cancelled) return <span className="tag crit" style={{ marginTop: 3 }}>Abgesagt</span>
  return (
    <span className="tag warn" style={{ marginTop: 3 }}>
      {c.moved ? `Neu ${fmt(a.start)} statt ${fmt(c.was.start)}` : ''}
      {c.moved && c.restaged ? ' · ' : ''}
      {c.restaged ? `jetzt ${stageById[a.stage].name}` : ''}
    </span>
  )
}

const PX = 2.4 // px per minute
const LANE = 64

function Timeline({ acts, day, onOpen }: { acts: Act[]; day: number; onOpen: (id: string) => void }) {
  const { plan, now, phase } = useApp()
  const start = Math.floor(Math.min(...acts.map((a) => a.start)) / 60) * 60
  const end = Math.ceil(Math.max(...acts.map((a) => a.end)) / 60) * 60
  const lanes = STAGES.filter((s) => acts.some((a) => a.stage === s.id))
  const width = (end - start) * PX
  const scroller = useRef<HTMLDivElement>(null)
  const showNow = phase === 'during' && now.day === day && now.min > start && now.min < end
  useEffect(() => {
    if (showNow && scroller.current) scroller.current.scrollLeft = (now.min - start) * PX - 80
  }, [showNow, now.min, start])
  return (
    <div className="timeline" ref={scroller} style={{ marginTop: 8 }}>
      <div className="tl-grid" style={{ width: width + 24, height: 26 + lanes.length * (LANE + 22) }}>
        {Array.from({ length: (end - start) / 60 + 1 }, (_, i) => (
          <div key={i} className="tl-hour" style={{ left: i * 60 * PX }}>
            <span>{fmt(start + i * 60)}</span>
          </div>
        ))}
        {showNow && <div className="tl-now" style={{ left: (now.min - start) * PX }} />}
        {lanes.map((s, li) => (
          <div key={s.id} className="tl-lane" style={{ top: 26 + li * (LANE + 22) }}>
            <span className="tl-lane-label">
              <StageDot id={s.id} />
              {s.name}
            </span>
            {acts
              .filter((a) => a.stage === s.id)
              .map((a) => (
                <button key={a.id} className={`tl-act ${plan.includes(a.id) ? 'on' : ''} ${a.change?.cancelled ? 'cancelled' : ''}`} style={{ top: 18, left: (a.start - start) * PX, width: (a.end - a.start) * PX - 4, borderColor: s.color }} onClick={() => onOpen(a.id)}>
                  <b>{a.artist}</b>
                  <span>
                    {fmt(a.start)}–{fmt(a.end)}
                  </span>
                  {plan.includes(a.id) && <Heart className="heart" size={12} fill="currentColor" />}
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
