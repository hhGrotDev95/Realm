import { ImageUp, MapPin, MousePointer2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { adminApi, type AdminMap, type AdminPlace } from '../api'
import { clampToMap, MAP_H, MAP_IMAGE_MAX, MAP_W, MAX_POIS, POI_CAT_LABEL, POI_CATS, type MapSettings, type PlaceCat } from '../map'
import { Ground } from '../screens/MapGround'
import { CAT_ICON } from '../screens/mapIcons'

type Flash = (k: 'ok' | 'err', t: string) => void
type Sel = { kind: 'stage' | 'poi'; id: string } | null
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')
const STATUS_LABEL = { '': 'Ohne Status', open: 'Geöffnet', busy: 'Viel los', closed: 'Geschlossen' } as const

/**
 * Fits an uploaded plan onto the map canvas ("contain", dark margins) and compresses it until it
 * fits the server limit. Fitting onto the exact canvas keeps marker coordinates meaningful.
 */
async function readPlan(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Bitte ein PNG-, JPEG- oder WebP-Bild wählen (PDF vorher als Bild exportieren)')
  if (file.size > 25_000_000) throw new Error('Bild ist größer als 25 MB')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    for (const scale of [2, 1.5, 1]) {
      const canvas = document.createElement('canvas')
      canvas.width = MAP_W * scale
      canvas.height = MAP_H * scale
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#14171c'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const k = Math.min(canvas.width / img.width, canvas.height / img.height)
      const w = img.width * k
      const h = img.height * k
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
      for (const q of [0.82, 0.68, 0.55]) {
        const data = canvas.toDataURL('image/jpeg', q)
        if (data.length <= MAP_IMAGE_MAX) return data
      }
    }
    throw new Error('Bild lässt sich nicht klein genug komprimieren – bitte einen einfacheren Plan wählen')
  } finally {
    URL.revokeObjectURL(url)
  }
}

const newId = (places: AdminPlace[], cat: PlaceCat) => {
  let i = places.length + 1
  while (places.some((p) => p.id === `${cat}-${i}`)) i++
  return `${cat}-${i}`
}

export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [saved, setSaved] = useState<AdminMap | null>(null)
  const [data, setData] = useState<AdminMap | null>(null)
  const [sel, setSel] = useState<Sel>(null)
  const [adding, setAdding] = useState<PlaceCat | null>(null)
  const [busy, setBusy] = useState(false)
  const [k, setK] = useState(0.5)
  const canvas = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ id: string; kind: 'stage' | 'poi'; moved: boolean } | null>(null)

  const load = useCallback(
    () =>
      admin.map(slug).then(
        (m) => {
          setSaved(m)
          setData(m)
        },
        (e) => flash('err', errText(e)),
      ),
    [admin, slug, flash],
  )
  useEffect(() => {
    load()
  }, [load])

  // the canvas is drawn in map units and scaled to the available width
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const ro = new ResizeObserver(() => setK(el.clientWidth / MAP_W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [data !== null])

  const dirty = !!data && JSON.stringify(data) !== JSON.stringify(saved)
  // leaving with unsaved marker positions loses work – ask the browser to warn
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  if (!data) return <div className="card small muted">Lade Karte …</div>

  const toMap = (clientX: number, clientY: number) => {
    const r = canvas.current!.getBoundingClientRect()
    return clampToMap((clientX - r.left) / k, (clientY - r.top) / k)
  }
  const move = (kind: 'stage' | 'poi', id: string, x: number, y: number) => {
    const pos = clampToMap(x, y)
    setData((d) =>
      d && kind === 'stage'
        ? { ...d, stages: d.stages.map((s) => (s.id === id ? { ...s, ...pos } : s)) }
        : d && { ...d, pois: d.pois.map((p) => (p.id === id ? { ...p, ...pos } : p)) },
    )
  }
  const patchPoi = (id: string, patch: Partial<AdminPlace>) => setData((d) => d && { ...d, pois: d.pois.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const setMap = (map: MapSettings) => setData((d) => d && { ...d, map })

  const selStage = sel?.kind === 'stage' ? data.stages.find((s) => s.id === sel.id) : undefined
  const selPoi = sel?.kind === 'poi' ? data.pois.find((p) => p.id === sel.id) : undefined
  const ground = data.map.image ? 'image' : data.map.art === 'demo' ? 'demo' : 'plain'
  const invalid = data.pois.find((p) => p.name.trim().length < 1)

  const markerProps = (kind: 'stage' | 'poi', id: string, x: number, y: number, label: string) => ({
    className: `map-edit-marker ${sel?.kind === kind && sel.id === id ? 'on' : ''}`,
    style: { left: x * k, top: y * k },
    'aria-label': `${label} – mit Pfeiltasten verschieben`,
    'aria-pressed': sel?.kind === kind && sel.id === id,
    type: 'button' as const,
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      drag.current = { id, kind, moved: false }
      setSel({ kind, id })
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag.current?.id !== id) return
      drag.current.moved = true
      const p = toMap(e.clientX, e.clientY)
      move(kind, id, p.x, p.y)
    },
    onPointerUp: () => {
      drag.current = null
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 25 : 5
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (!d) return
      e.preventDefault()
      setSel({ kind, id })
      move(kind, id, x + d[0], y + d[1])
    },
  })

  return (
    <div className="admin-grid">
      <section className="card" aria-label="Karteneditor">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 className="admin-h">Karte</h2>
          <span className="small muted">
            {data.stages.length} Bühnen · {data.pois.length} Orte{dirty ? ' · ungespeichert' : ''}
          </span>
        </div>
        <div className="row" role="toolbar" aria-label="Werkzeug" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" className={`chip ${adding ? '' : 'on'}`} aria-pressed={!adding} onClick={() => setAdding(null)}>
            <MousePointer2 size={15} /> Auswählen & verschieben
          </button>
          <label className="chip" style={{ gap: 6 }}>
            <Plus size={15} />
            <select
              aria-label="Neuen Ort setzen: Kategorie"
              value={adding ?? ''}
              onChange={(e) => setAdding((e.target.value || null) as PlaceCat | null)}
              style={{ background: 'none', color: 'inherit', border: 0, font: 'inherit' }}
            >
              <option value="">Ort hinzufügen …</option>
              {POI_CATS.map((c) => (
                <option key={c} value={c}>
                  {POI_CAT_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {adding && <p className="small" style={{ margin: '0 0 8px', color: 'var(--brand)' }}>Tippe auf die Karte, um „{POI_CAT_LABEL[adding]}“ zu setzen.</p>}
        <div
          ref={canvas}
          className={`map-edit-canvas ${adding ? 'adding' : ''}`}
          style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}
          data-testid="map-canvas"
          onPointerDown={(e) => {
            if (!adding) return setSel(null)
            if (data.pois.length >= MAX_POIS) return flash('err', `Höchstens ${MAX_POIS} Orte pro Karte`)
            const pos = toMap(e.clientX, e.clientY)
            const id = newId(data.pois, adding)
            const place: AdminPlace = { id, cat: adding, name: `${POI_CAT_LABEL[adding]} ${data.pois.filter((p) => p.cat === adding).length + 1}`, detail: '', important: true, ...pos }
            setData({ ...data, pois: [...data.pois, place] })
            setSel({ kind: 'poi', id })
            setAdding(null)
          }}
        >
          <div style={{ position: 'absolute', left: 0, top: 0, width: MAP_W, height: MAP_H, transform: `scale(${k})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
            <Ground satellite={false} map={data.map} stages={data.stages} />
          </div>
          {data.stages.map((s) => (
            <button key={'s' + s.id} {...markerProps('stage', s.id, s.x, s.y, `Bühne ${s.name}`)}>
              <span className="map-edit-stage" style={{ boxShadow: `0 0 0 2px ${s.color}` }}>
                <span style={{ width: 10, height: 10, borderRadius: 99, background: s.color }} /> {s.name}
              </span>
            </button>
          ))}
          {data.pois.map((p) => {
            const I = CAT_ICON[p.cat]
            return (
              <button key={'p' + p.id} {...markerProps('poi', p.id, p.x, p.y, p.name || 'Ort ohne Namen')}>
                <span className={`map-edit-poi ${p.status === 'closed' ? 'closed' : ''}`}>
                  <I size={15} strokeWidth={2.3} />
                </span>
              </button>
            )
          })}
        </div>
        <p className="tiny faint" style={{ margin: '8px 0 0' }}>
          Ziehen zum Verschieben · Pfeiltasten verschieben den ausgewählten Punkt um 5 (mit Umschalt um 25) · Koordinaten in Karteneinheiten ({MAP_W} × {MAP_H})
        </p>
      </section>

      <div style={{ display: 'grid', gap: 16 }}>
        <section className="card" aria-label="Auswahl">
          {selPoi ? (
            <>
              <h2 className="admin-h">Ort bearbeiten</h2>
              <label className="admin-field">
                <span>Name</span>
                <input className="field" value={selPoi.name} maxLength={60} onChange={(e) => patchPoi(selPoi.id, { name: e.target.value })} aria-invalid={!selPoi.name.trim()} />
              </label>
              <div className="admin-row">
                <label className="admin-field">
                  <span>Kategorie</span>
                  <select className="field" value={selPoi.cat} onChange={(e) => patchPoi(selPoi.id, { cat: e.target.value as PlaceCat })}>
                    {POI_CATS.map((c) => (
                      <option key={c} value={c}>
                        {POI_CAT_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Status</span>
                  <select className="field" value={selPoi.status ?? ''} onChange={(e) => patchPoi(selPoi.id, { status: (e.target.value || undefined) as AdminPlace['status'] })}>
                    {Object.entries(STATUS_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="admin-field">
                <span>Beschreibung</span>
                <input className="field" value={selPoi.detail} maxLength={120} placeholder="z. B. Trinkwasser · kostenlos" onChange={(e) => patchPoi(selPoi.id, { detail: e.target.value })} />
              </label>
              <Coords x={selPoi.x} y={selPoi.y} onChange={(x, y) => move('poi', selPoi.id, x, y)} />
              <label className="row small" style={{ gap: 8, marginBottom: 14 }}>
                <input type="checkbox" checked={!!selPoi.important} onChange={(e) => patchPoi(selPoi.id, { important: e.target.checked })} />
                Ohne Filter auf der Karte zeigen (wichtiger Ort)
              </label>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setData({ ...data, pois: data.pois.filter((p) => p.id !== selPoi.id) })
                  setSel(null)
                }}
              >
                <Trash2 size={16} /> Ort entfernen
              </button>
            </>
          ) : selStage ? (
            <>
              <h2 className="admin-h">Bühne {selStage.name}</h2>
              <p className="small muted" style={{ marginTop: 0 }}>
                Name und Farbe pflegst du unter „Bühnen“. Hier legst du fest, wo die Bühne auf dem Gelände steht.
              </p>
              <Coords x={selStage.x} y={selStage.y} onChange={(x, y) => move('stage', selStage.id, x, y)} />
            </>
          ) : (
            <>
              <h2 className="admin-h">Nichts ausgewählt</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Wähle eine Bühne oder einen Ort auf der Karte, oder setze über „Ort hinzufügen“ einen neuen Punkt. {data.stages.length === 0 && 'Noch keine Bühnen – lege sie unter „Bühnen“ an.'}
              </p>
            </>
          )}
        </section>

        <section className="card" aria-label="Gelände">
          <h2 className="admin-h">Gelände</h2>
          <div className="row" role="radiogroup" aria-label="Hintergrund der Karte" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" role="radio" aria-checked={ground === 'plain'} className={`chip ${ground === 'plain' ? 'on' : ''}`} onClick={() => setMap({ art: 'plain' })}>
              Neutral
            </button>
            {(saved?.map.art === 'demo' || ground === 'demo') && (
              <button type="button" role="radio" aria-checked={ground === 'demo'} className={`chip ${ground === 'demo' ? 'on' : ''}`} onClick={() => setMap({ art: 'demo' })}>
                Demo-Illustration
              </button>
            )}
            <button type="button" role="radio" aria-checked={ground === 'image'} className={`chip ${ground === 'image' ? 'on' : ''}`} onClick={() => fileRef.current?.click()}>
              <ImageUp size={15} /> {data.map.image ? 'Plan ersetzen' : 'Eigener Plan …'}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Geländeplan wählen"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try {
                setMap({ image: await readPlan(file) })
              } catch (err) {
                flash('err', errText(err))
              }
            }}
          />
          <p className="small muted" style={{ margin: 0 }}>
            Der Plan wird auf die Kartenfläche eingepasst und komprimiert (max. ca. 450 kB). Er wird mit dem Festival offline gespeichert.
          </p>
        </section>

        <section className="card" aria-label="Alle Orte">
          <h2 className="admin-h">Orte ({data.pois.length})</h2>
          {data.pois.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Noch keine Orte. Wasser, WCs, Sanitäter und Eingänge helfen Besuchern am meisten.
            </p>
          ) : (
            <div className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
              {[...data.pois]
                .sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name))
                .map((p) => {
                  const I = CAT_ICON[p.cat]
                  return (
                    <button key={p.id} type="button" className="list-item" aria-pressed={sel?.id === p.id} onClick={() => setSel({ kind: 'poi', id: p.id })}>
                      <I size={16} className="faint" />
                      <span className="grow">{p.name || <i>ohne Namen</i>}</span>
                      <span className="tiny faint">{POI_CAT_LABEL[p.cat as PlaceCat]}</span>
                    </button>
                  )
                })}
            </div>
          )}
        </section>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !dirty || !!invalid}
            onClick={async () => {
              setBusy(true)
              try {
                await admin.saveMap(slug, {
                  stages: data.stages.map(({ id, x, y }) => ({ id, x, y })),
                  pois: data.pois.map((p) => ({ ...p, name: p.name.trim(), detail: p.detail.trim() })),
                  image: data.map.image ?? null,
                  art: data.map.image ? null : (data.map.art ?? 'plain'),
                })
                await reload()
                await load()
                flash('ok', 'Karte gespeichert – Besucher sehen sie beim nächsten Abgleich')
              } catch (err) {
                flash('err', errText(err))
              }
              setBusy(false)
            }}
          >
            <MapPin size={16} /> {busy ? 'Speichere …' : 'Karte speichern'}
          </button>
          {dirty && (
            <button type="button" className="btn ghost" onClick={() => (setData(saved), setSel(null))}>
              <RotateCcw size={16} /> Verwerfen
            </button>
          )}
          {invalid && <span className="small" style={{ color: 'var(--crit)' }}>Jeder Ort braucht einen Namen.</span>}
        </div>
      </div>
    </div>
  )
}

function Coords({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  return (
    <div className="admin-row">
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
