import { AnimatePresence, m as motion } from 'framer-motion'
import { Check, Layers, LocateFixed, Search, X, MapPin, TriangleAlert, Users, Satellite, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FESTIVAL, on, POIS, stageById, walkMinutes, type Poi, type PoiCat } from '../data'
import { useApp } from '../store'
import { CAT_ICON } from './mapIcons'
import { Ground, MAP_H as H, MAP_W as W } from './MapGround'
import { AppBar } from '../App'
import { t } from '../i18n'

const CATS: { id: PoiCat; label: string }[] = [
  { id: 'stage', label: t('Stages') },
  { id: 'water', label: t('Wasser') },
  { id: 'wc', label: t('WC') },
  { id: 'food', label: t('Food') },
  { id: 'medical', label: t('Medical') },
  { id: 'bar', label: t('Bars') },
]

type View = { x: number; y: number; k: number }

export function MapScreen() {
  const { crew } = useApp()
  const { here, openSheet, focusPoi, setFocusPoi, shareLocation, myPins, updates, votes, sheet, set, toast, requireIdentity } = useApp()
  const wrap = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 0.5 })
  const [animate, setAnimate] = useState(false)
  const [cat, setCat] = useState<PoiCat | null>(null)
  const [q, setQ] = useState('')
  const [layersOpen, setLayersOpen] = useState(false)
  const [layers, setLayers] = useState({ friends: true, reports: true, pins: true, satellite: false })
  const [route, setRoute] = useState<string | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const last = useRef<{ x: number; y: number; d?: number } | null>(null)
  const moved = useRef(0)
  const press = useRef(0)

  const center = useCallback((px: number, py: number, k?: number, offsetY = 0) => {
    const el = wrap.current
    if (!el) return
    setAnimate(true)
    setView((v) => {
      const kk = k ?? v.k
      return { k: kk, x: el.clientWidth / 2 - px * kk, y: el.clientHeight / 2 - py * kk - offsetY }
    })
    window.setTimeout(() => setAnimate(false), 450)
  }, [])

  useLayoutEffect(() => {
    const el = wrap.current!
    const k = Math.max(el.clientWidth / W, (el.clientHeight * 0.8) / H) * 1.05
    const c = here ?? { x: W / 2, y: H / 2 }
    setView({ k, x: el.clientWidth / 2 - c.x * k, y: el.clientHeight / 2 - c.y * k })
  }, [])

  // handle deep links from other screens: "route:<poi>" or "poi:<poi>"
  useEffect(() => {
    if (!focusPoi) return
    const [mode, id] = focusPoi.split(':')
    const p = POIS.find((x) => x.id === id)
    setFocusPoi(null)
    if (!p) return
    if (mode === 'route') {
      // a direction needs a starting point the visitor chose; without one, ask (audit F04)
      if (!here) return openSheet({ kind: 'place', then: p.id })
      setRoute(p.id)
      center((p.x + here.x) / 2, (p.y + here.y) / 2, undefined, -40)
    } else {
      center(p.x, p.y, undefined, -120)
      openSheet({ kind: 'poi', id: p.id })
    }
  }, [focusPoi, center, openSheet, setFocusPoi, here])

  // the poi sheet can request a route via store focus; also listen to route events from sheets
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      const p = POIS.find((x) => x.id === id)
      if (!p || !here) return
      setRoute(id)
      center((p.x + here.x) / 2, (p.y + here.y) / 2, undefined, -40)
    }
    window.addEventListener('realm:route', h)
    return () => window.removeEventListener('realm:route', h)
  }, [center, here])

  const visible = useMemo(() => {
    if (cat) return POIS.filter((p) => p.cat === cat)
    return POIS.filter((p) => p.important)
  }, [cat])

  const results = q.trim() ? POIS.filter((p) => (p.name + ' ' + p.detail).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : []

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.min(2.4, Math.max(0.3, v.k * factor))
      const f = k / v.k
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }
    })

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    last.current = null
    moved.current = 0
    setLayersOpen(false)
    // long-press drops a personal pin
    window.clearTimeout(press.current)
    const rect = wrap.current!.getBoundingClientRect()
    const wx = (e.clientX - rect.left - view.x) / view.k
    const wy = (e.clientY - rect.top - view.y) / view.k
    press.current = window.setTimeout(() => {
      if (moved.current > 8 || pointers.current.size !== 1) return
      const pin = { id: 'pin' + Date.now(), name: t('Pin {n}', { n: myPins.length + 1 }), x: Math.round(wx), y: Math.round(wy) }
      set('myPins', [...myPins, pin])
      setLayers((l) => ({ ...l, pins: true }))
      navigator.vibrate?.(15)
      toast(t('{name} gesetzt', { name: pin.name }), on('crew') ? { label: t('Hier treffen'), run: () => requireIdentity(t('Damit deine Crew weiß, wer einlädt.'), () => openSheet({ kind: 'newMeetup', place: pin.name })) } : undefined)
    }, 550)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    const rect = wrap.current!.getBoundingClientRect()
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length - rect.left
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length - rect.top
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : undefined
    if (last.current) {
      const dx = cx - last.current.x
      const dy = cy - last.current.y
      moved.current += Math.abs(dx) + Math.abs(dy)
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
      if (d && last.current.d) zoomAt(d / last.current.d, cx, cy)
    }
    last.current = { x: cx, y: cy, d }
  }
  const onUp = (e: React.PointerEvent) => {
    window.clearTimeout(press.current)
    pointers.current.delete(e.pointerId)
    last.current = null
  }
  const onWheel = (e: React.WheelEvent) => {
    const rect = wrap.current!.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top)
  }

  const select = (p: Poi) => {
    setQ('')
    center(p.x, p.y, Math.max(view.k, 0.9), -120)
    openSheet({ kind: 'poi', id: p.id })
  }

  const routePoi = route ? POIS.find((p) => p.id === route) : null
  const reports = updates.filter((u) => u.poi && u.source !== 'official' && votes[u.id] !== 'fixed')
  const inv = 1 / view.k
  const selectedPoi = sheet?.kind === 'poi' ? sheet.id : null

  return (
    <main style={{ position: 'absolute', inset: 0 }} aria-label={t('Festivalkarte')}>
      <div ref={wrap} className="map-wrap" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: W,
            height: H,
            transformOrigin: '0 0',
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`,
            transition: animate ? 'transform .45s cubic-bezier(.22,1,.36,1)' : undefined,
          }}
        >
          <Ground satellite={layers.satellite} siteMap={FESTIVAL.siteMap} />
          {routePoi && here && (
            <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {/* a straight direction, not a path: the plan does not know walkable ways or closures */}
              <motion.path
                d={`M${here.x},${here.y} L${routePoi.x},${routePoi.y}`}
                fill="none"
                stroke="var(--brand)"
                strokeWidth={6 * Math.max(1, inv * 0.6)}
                strokeLinecap="round"
                strokeDasharray="2 14"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.8 }}
              />
            </svg>
          )}
          {visible.map((p) => (
            <Marker key={p.id} p={p} inv={inv} selected={selectedPoi === p.id || route === p.id} onClick={() => select(p)} />
          ))}
          {layers.reports && on('reports') &&
            reports.map((u) => {
              const p = POIS.find((x) => x.id === u.poi)!
              return (
                <button key={u.id} className="map-pin" onClick={() => openSheet({ kind: 'poi', id: p.id })} style={pinStyle(p.x + 22, p.y - 22, inv)} aria-label={u.title}>
                  <span style={{ width: 22, height: 22, borderRadius: 8, background: 'var(--warn)', color: '#2a1b00', display: 'grid', placeItems: 'center', boxShadow: '0 0 0 2px #0d0f12' }}>
                    <TriangleAlert size={13} strokeWidth={2.6} />
                  </span>
                </button>
              )
            })}
          {layers.pins &&
            myPins.map((pin) => (
              <button
                key={pin.id}
                style={pinStyle(pin.x, pin.y, inv)}
                aria-label={pin.name}
                onClick={() => toast(pin.name, { label: t('Entfernen'), run: () => set('myPins', myPins.filter((x) => x.id !== pin.id)) })}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 4px', borderRadius: 99, background: '#fff', color: '#111', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  <MapPin size={13} /> {pin.name}
                </span>
              </button>
            ))}
          {layers.friends && on('location') &&
            shareLocation &&
            crew.members.filter((f) => f.at && f.at !== 'camp').map((f, i) => {
              const s = stageById[f.at as keyof typeof stageById]
              const a = (i * 2.4) % (Math.PI * 2)
              return (
                <div key={f.id} style={{ ...pinStyle(s.x + Math.cos(a) * 46, s.y + 36 + Math.sin(a) * 22, inv), pointerEvents: 'none' }}>
                  <span className="avatar" style={{ background: f.color, width: 22, height: 22, fontSize: 10, boxShadow: '0 0 0 2px #0d0f12' }}>
                    {f.name[0]}
                  </span>
                </div>
              )
            })}
          {here && (
            <div style={{ ...pinStyle(here.x, here.y, inv), pointerEvents: 'none' }} role="img" aria-label={t('Dein gewählter Standort: {place}', { place: here.label })}>
              <span className="me-dot" />
            </div>
          )}
        </div>
      </div>

      <AppBar floating />
      <div className="map-overlay-top" style={{ top: 58 }}>
        <div className="map-search">
          <Search size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Suchen · lange drücken für Pin')} aria-label={t('Karte durchsuchen')} />
          {q && (
            <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => setQ('')} aria-label={t('Leeren')}>
              <X size={18} />
            </button>
          )}
        </div>
        <AnimatePresence>
          {results.length > 0 && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card" style={{ padding: 6, background: 'rgba(23,23,29,.96)', backdropFilter: 'blur(16px)' }}>
              {results.map((p) => {
                const I = CAT_ICON[p.cat]
                return (
                  <button key={p.id} className="tile" style={{ background: 'none', padding: 10 }} onClick={() => select(p)}>
                    <span className="tile-icon" style={{ width: 34, height: 34 }}>
                      <I size={17} />
                    </span>
                    <span className="grow">
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span className="tiny faint" style={{ display: 'block' }}>
                        {here ? `${t('ca. {n} Min.', { n: walkMinutes(here.x, here.y, p.x, p.y) })} · ` : ''}
                        {p.detail}
                      </span>
                    </span>
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
        {!q && (
          <div className="chips" style={{ margin: '0 -12px', padding: '0 12px' }}>
            {CATS.map((c) => {
              const I = CAT_ICON[c.id]
              return (
                <button key={c.id} className={`chip glass ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(cat === c.id ? null : c.id)}>
                  <I size={15} /> {c.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {routePoi && here && (
          <motion.div className="route-banner" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}>
            <span className="grow">
              <span style={{ display: 'block', fontSize: 17 }}>{t('Richtung {place}', { place: routePoi.name })}</span>
              <span style={{ fontSize: 13, opacity: 0.8 }}>{t('ca. {n} Min. Luftlinie · folge Wegen und Schildern', { n: walkMinutes(here.x, here.y, routePoi.x, routePoi.y) })}</span>
            </span>
            <button className="icon-btn" style={{ color: 'var(--brand-ink)' }} onClick={() => setRoute(null)} aria-label={t('Route beenden')}>
              <X size={20} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="map-fabs">
        <div style={{ position: 'relative' }}>
          <button className={`fab ${layersOpen ? 'active' : ''}`} aria-label={t('Ebenen')} onClick={() => setLayersOpen((v) => !v)}>
            <Layers size={21} />
          </button>
          <AnimatePresence>
            {layersOpen && (
              <motion.div className="layers-pop" initial={{ opacity: 0, scale: 0.92, x: 10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }} style={{ transformOrigin: 'right bottom' }}>
                {(
                  [
                    ['friends', t('Freunde'), Users],
                    ['reports', t('Meldungen'), TriangleAlert],
                    ['pins', t('Meine Pins'), MapPin],
                    ['satellite', t('Satellit'), Satellite],
                  ] as const
                )
                  // the satellite look only exists for the built-in illustration
                  .filter(([k]) => k !== 'satellite' || !FESTIVAL.siteMap)
                  .map(([k, label, I]) => (
                  <button key={k} onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} aria-pressed={layers[k]}>
                    <I size={18} className="faint" /> {label}
                    {layers[k] && <Check size={18} className="chk" />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button className="fab" aria-label={t('Hineinzoomen')} onClick={() => zoomAt(1.3, wrap.current!.clientWidth / 2, wrap.current!.clientHeight / 2)}>
          <Plus size={20} />
        </button>
        <button className="fab" aria-label={t('Herauszoomen')} onClick={() => zoomAt(1 / 1.3, wrap.current!.clientWidth / 2, wrap.current!.clientHeight / 2)}>
          <Minus size={20} />
        </button>
        <button className={`fab ${here ? 'active' : ''}`} aria-label={here ? t('Mein Standort: {place}', { place: here.label }) : t('Standort wählen')} onClick={() => (here ? center(here.x, here.y, Math.max(view.k, 0.9)) : openSheet({ kind: 'place' }))}>
          <LocateFixed size={21} />
        </button>
      </div>
    </main>
  )
}

function pinStyle(x: number, y: number, inv: number): React.CSSProperties {
  return { position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${inv})`, zIndex: 2 }
}



function Marker({ p, inv, selected, onClick }: { p: Poi; inv: number; selected: boolean; onClick: () => void }) {
  const I = CAT_ICON[p.cat]
  const stage = p.cat === 'stage' ? stageById[p.id.replace('stage-', '') as keyof typeof stageById] : null
  const closed = p.status === 'closed'
  return (
    <button onClick={onClick} style={{ ...pinStyle(p.x, p.y, inv), zIndex: selected ? 4 : stage ? 3 : 2 }} aria-label={p.name}>
      <motion.span
        animate={{ scale: selected ? 1.18 : 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: stage ? '6px 12px 6px 6px' : 0,
          width: stage ? undefined : 32,
          height: stage ? undefined : 32,
          justifyContent: 'center',
          borderRadius: stage ? 99 : 11,
          background: stage ? '#111116' : closed ? '#2a2a34' : '#f4f3f8',
          color: stage ? '#fff' : closed ? '#7d7c8a' : '#111',
          boxShadow: selected ? '0 0 0 3px var(--brand), 0 8px 24px rgba(0,0,0,.5)' : stage ? `0 0 0 1.5px ${stage.color}, 0 8px 24px rgba(0,0,0,.45)` : '0 0 0 2px #0d0f12, 0 4px 14px rgba(0,0,0,.4)',
          whiteSpace: 'nowrap',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {stage ? (
          <>
            <span style={{ width: 22, height: 22, borderRadius: 99, background: stage.color, color: '#111', display: 'grid', placeItems: 'center' }}>
              <I size={12} strokeWidth={2.6} />
            </span>
            {stage.name}
          </>
        ) : (
          <I size={17} strokeWidth={2.2} />
        )}
      </motion.span>
    </button>
  )
}
