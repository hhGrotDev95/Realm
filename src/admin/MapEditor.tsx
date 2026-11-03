// Console tab "Karte": place stages and points of interest on the festival map.
import { MapPin, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminApi, type MapPlace } from '../api'
import { POIS, STAGES } from '../data'
import { CAT_LABEL, MAP_H, MAP_W, MAX_PLACES, PLACE_CATS, type PlaceCat } from '../mapGeometry'
import { CAT_ICON } from '../screens/mapIcons'
import { Ground } from '../screens/MapGround'

type Flash = (k: 'ok' | 'err', t: string) => void
type Sel = { kind: 'stage' | 'place'; id: string } | null
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')
const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)))
const STATUS_LABEL = { '': 'Ohne Angabe', open: 'Geöffnet', busy: 'Viel los', closed: 'Geschlossen' } as const

function initialPlaces(): MapPlace[] {
  return POIS.filter((p) => p.cat !== 'stage').map((p) => ({ id: p.id, cat: p.cat as PlaceCat, name: p.name, x: p.x, y: p.y, detail: p.detail ?? '', status: p.status ?? null, important: !!p.important }))
}

/** A new, unused id such as "water-3". */
function nextId(cat: PlaceCat, places: MapPlace[]) {
  const used = new Set(places.map((p) => p.id))
  for (let n = 1; ; n++) if (!used.has(`${cat}-${n}`)) return `${cat}-${n}`
}

export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [stages, setStages] = useState(() => STAGES.map((s) => ({ id: s.id, name: s.name, color: s.color, x: s.x, y: s.y })))
  const [places, setPlaces] = useState(initialPlaces)
  const [sel, setSel] = useState<Sel>(null)
  const [adding, setAdding] = useState<PlaceCat | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<{ sel: NonNullable<Sel>; moved: boolean; cx: number; cy: number; x: number; y: number } | null>(null)

  // unsaved positions are easy to lose by closing the tab
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const toMap = (clientX: number, clientY: number) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: clamp(((clientX - r.left) / r.width) * MAP_W, MAP_W), y: clamp(((clientY - r.top) / r.height) * MAP_H, MAP_H) }
  }
  const move = (s: NonNullable<Sel>, x: number, y: number) => {
    setDirty(true)
    if (s.kind === 'stage') setStages((l) => l.map((st) => (st.id === s.id ? { ...st, x: clamp(x, MAP_W), y: clamp(y, MAP_H) } : st)))
    else setPlaces((l) => l.map((p) => (p.id === s.id ? { ...p, x: clamp(x, MAP_W), y: clamp(y, MAP_H) } : p)))
  }
  const patch = (id: string, change: Partial<MapPlace>) => {
    setDirty(true)
    setPlaces((l) => l.map((p) => (p.id === id ? { ...p, ...change } : p)))
  }
  const addAt = (cat: PlaceCat, x: number, y: number) => {
    if (places.length >= MAX_PLACES) return flash('err', `Höchstens ${MAX_PLACES} Orte`)
    const id = nextId(cat, places)
    const n = places.filter((p) => p.cat === cat).length + 1
    setPlaces((l) => [...l, { id, cat, name: `${CAT_LABEL[cat]} ${n}`, x, y, detail: '', status: null, important: true }])
    setSel({ kind: 'place', id })
    setAdding(null)
    setDirty(true)
  }

  const selStage = sel?.kind === 'stage' ? stages.find((s) => s.id === sel.id) : undefined
  const selPlace = sel?.kind === 'place' ? places.find((p) => p.id === sel.id) : undefined
  const invalid = places.find((p) => !p.name.trim())

  const markerHandlers = (s: NonNullable<Sel>, x: number, y: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      drag.current = { sel: s, moved: false, cx: e.clientX, cy: e.clientY, x, y }
      setSel(s)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      if (!d || d.sel.id !== s.id || d.sel.kind !== s.kind) return
      const dx = e.clientX - d.cx
      const dy = e.clientY - d.cy
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
      d.moved = true
      // keep the grab offset: move by the pointer delta, not to the pointer
      const r = canvas.current!.getBoundingClientRect()
      move(s, d.x + (dx / r.width) * MAP_W, d.y + (dy / r.height) * MAP_H)
    },
    onPointerUp: () => {
      drag.current = null
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 25 : 5
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (!d) return
      e.preventDefault()
      setSel(s)
      move(s, x + d[0], y + d[1])
    },
  })

  return (
    <div className="admin-grid">
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
          <h2 className="admin-h" style={{ margin: 0 }}>
            Karte
          </h2>
          <span className="small muted">{dirty ? 'Ungespeicherte Änderungen' : 'Alles gespeichert'}</span>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Marker ziehen oder auswählen und mit den Pfeiltasten verschieben (Umschalt = größere Schritte). Neuen Ort: Kategorie wählen, dann auf die Karte tippen.
        </p>
        <div className="chips" role="group" aria-label="Neuen Ort hinzufügen" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          {PLACE_CATS.map((c) => {
            const I = CAT_ICON[c]
            return (
              <button key={c} type="button" className={`chip ${adding === c ? 'on' : ''}`} aria-pressed={adding === c} onClick={() => setAdding(adding === c ? null : c)}>
                <Plus size={14} /> <I size={14} /> {CAT_LABEL[c]}
              </button>
            )
          })}
        </div>
        {adding && (
          <p className="small" role="status" style={{ margin: '0 0 8px' }}>
            Tippe auf die Karte, um „{CAT_LABEL[adding]}“ zu setzen.{' '}
            <button type="button" className="btn ghost sm" onClick={() => addAt(adding, MAP_W / 2, MAP_H / 2)}>
              In der Mitte einfügen
            </button>
          </p>
        )}
        <div
          ref={canvas}
          className={`map-editor ${adding ? 'adding' : ''}`}
          aria-label="Kartenfläche"
          role="group"
          onPointerDown={(e) => {
            if (adding) {
              const p = toMap(e.clientX, e.clientY)
              addAt(adding, p.x, p.y)
            } else setSel(null)
          }}
        >
          <Ground satellite={false} stages={stages} fluid />
          {stages.map((s) => (
            <button
              key={'s' + s.id}
              type="button"
              className={`me-marker stage ${sel?.kind === 'stage' && sel.id === s.id ? 'sel' : ''}`}
              style={{ left: `${(s.x / MAP_W) * 100}%`, top: `${(s.y / MAP_H) * 100}%`, borderColor: s.color }}
              aria-label={`Bühne ${s.name} (${s.x}, ${s.y})`}
              {...markerHandlers({ kind: 'stage', id: s.id }, s.x, s.y)}
            >
              <span className="dot" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
          {places.map((p) => {
            const I = CAT_ICON[p.cat]
            return (
              <button
                key={'p' + p.id}
                type="button"
                className={`me-marker ${sel?.kind === 'place' && sel.id === p.id ? 'sel' : ''} ${p.important ? '' : 'minor'}`}
                style={{ left: `${(p.x / MAP_W) * 100}%`, top: `${(p.y / MAP_H) * 100}%` }}
                aria-label={`${p.name} (${p.x}, ${p.y})`}
                title={p.name}
                {...markerHandlers({ kind: 'place', id: p.id }, p.x, p.y)}
              >
                <I size={15} strokeWidth={2.2} />
              </button>
            )
          })}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <span className="small faint grow">
            {stages.length} {stages.length === 1 ? 'Bühne' : 'Bühnen'} · {places.length} {places.length === 1 ? 'Ort' : 'Orte'}
          </span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={!dirty || busy}
            onClick={() => {
              setStages(STAGES.map((s) => ({ id: s.id, name: s.name, color: s.color, x: s.x, y: s.y })))
              setPlaces(initialPlaces())
              setSel(null)
              setDirty(false)
            }}
          >
            <RotateCcw size={15} /> Verwerfen
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || busy || !!invalid}
            title={invalid ? 'Jeder Ort braucht einen Namen' : undefined}
            onClick={async () => {
              setBusy(true)
              try {
                await admin.saveMap(slug, { stages: stages.map(({ id, x, y }) => ({ id, x, y })), pois: places.map((p) => ({ ...p, name: p.name.trim(), detail: p.detail.trim() })) })
                setDirty(false)
                flash('ok', 'Karte gespeichert – Besucher sehen sie beim nächsten Laden')
                await reload()
              } catch (e) {
                flash('err', errText(e))
              }
              setBusy(false)
            }}
          >
            {busy ? 'Speichere …' : 'Karte speichern'}
          </button>
        </div>
      </section>

      <section className="card">
        {selStage ? (
          <>
            <h2 className="admin-h">Bühne {selStage.name}</h2>
            <p className="small muted" style={{ marginTop: -6 }}>
              Name und Farbe pflegst du im Tab „Bühnen“.
            </p>
            <Coords x={selStage.x} y={selStage.y} onChange={(x, y) => move({ kind: 'stage', id: selStage.id }, x, y)} />
          </>
        ) : selPlace ? (
          <PlaceForm
            key={selPlace.id}
            place={selPlace}
            onChange={(c) => patch(selPlace.id, c)}
            onMove={(x, y) => move({ kind: 'place', id: selPlace.id }, x, y)}
            onDelete={() => {
              setPlaces((l) => l.filter((p) => p.id !== selPlace.id))
              setSel(null)
              setDirty(true)
            }}
          />
        ) : (
          <>
            <h2 className="admin-h">Orte</h2>
            <div className="list">
              {places.map((p) => {
                const I = CAT_ICON[p.cat]
                return (
                  <button key={p.id} type="button" className="list-item" onClick={() => setSel({ kind: 'place', id: p.id })}>
                    <I size={17} className="faint" />
                    <span className="grow">
                      <span style={{ fontWeight: 600, display: 'block' }}>{p.name || '(ohne Namen)'}</span>
                      <span className="small faint">
                        {CAT_LABEL[p.cat]}
                        {p.detail ? ` · ${p.detail}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
              {places.length === 0 && (
                <p className="small muted">
                  <MapPin size={14} style={{ verticalAlign: -2 }} /> Noch keine Orte. Wasserstellen, WCs, Sanitäter und Eingänge helfen Besuchern am meisten.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function Coords({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  return (
    <div className="row admin-row" style={{ gap: 10 }}>
      <label className="admin-field">
        <span>X (0–{MAP_W})</span>
        <input className="field" type="number" min={0} max={MAP_W} value={x} onChange={(e) => onChange(Number(e.target.value) || 0, y)} />
      </label>
      <label className="admin-field">
        <span>Y (0–{MAP_H})</span>
        <input className="field" type="number" min={0} max={MAP_H} value={y} onChange={(e) => onChange(x, Number(e.target.value) || 0)} />
      </label>
    </div>
  )
}

function PlaceForm({ place, onChange, onMove, onDelete }: { place: MapPlace; onChange: (c: Partial<MapPlace>) => void; onMove: (x: number, y: number) => void; onDelete: () => void }) {
  return (
    <>
      <h2 className="admin-h">Ort bearbeiten</h2>
      <label className="admin-field">
        <span>Name</span>
        <input className="field" value={place.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={!place.name.trim()} />
      </label>
      <div className="row admin-row" style={{ gap: 10 }}>
        <label className="admin-field">
          <span>Kategorie</span>
          <select className="field" value={place.cat} onChange={(e) => onChange({ cat: e.target.value as PlaceCat })}>
            {PLACE_CATS.map((c) => (
              <option key={c} value={c}>
                {CAT_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Status</span>
          <select className="field" value={place.status ?? ''} onChange={(e) => onChange({ status: (e.target.value || null) as MapPlace['status'] })}>
            {Object.entries(STATUS_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="admin-field">
        <span>Beschreibung</span>
        <input className="field" value={place.detail} maxLength={80} placeholder="z. B. Trinkwasser · kostenlos" onChange={(e) => onChange({ detail: e.target.value })} />
      </label>
      <label className="row small" style={{ gap: 8, marginBottom: 14 }}>
        <input type="checkbox" checked={place.important} onChange={(e) => onChange({ important: e.target.checked })} />
        Immer auf der Karte zeigen (sonst nur beim Filtern nach Kategorie)
      </label>
      <Coords x={place.x} y={place.y} onChange={onMove} />
      <button type="button" className="btn danger sm" onClick={onDelete}>
        <Trash2 size={15} /> Ort entfernen
      </button>
    </>
  )
}
