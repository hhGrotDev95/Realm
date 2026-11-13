// Console: the festival map – ground plan upload, stage positions and markers (water, WC, food …).
// Markers are dragged with the pointer or moved with the arrow keys; new ones are placed by
// picking a category and clicking the map. Everything is saved in one go.
import { ImageUp, MapPin, Plus, Save, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { adminApi } from '../api'
import { FESTIVAL, mapSize, POIS, STAGES, type Poi, type PoiCat } from '../data'
import { MAP_W, MAX_ASPECT, MAX_IMAGE_BYTES, MAX_POIS, MIN_ASPECT, POI_CAT_LABEL, POI_CATS, POI_STATUS } from '../mapModel'
import { CAT_ICON } from '../screens/mapIcons'
import { Ground } from '../screens/MapGround'

type Flash = (k: 'ok' | 'err', t: string) => void
type Marker = Omit<Poi, 'confirmedMin'>
type StagePos = { id: string; name: string; color: string; x: number; y: number }
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')
const STATUS_LABEL = { open: 'Geöffnet', busy: 'Viel los', closed: 'Geschlossen' } as const

/** Scales a ground plan to at most 2400 px and compresses it below the upload limit. */
async function readPlan(file: File): Promise<{ data: string; width: number; height: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Bitte PNG, JPEG oder WebP wählen (PDF vorher als Bild exportieren)')
  const img = new Image()
  img.src = URL.createObjectURL(file)
  try {
    await img.decode()
  } catch {
    throw new Error('Bild konnte nicht gelesen werden')
  } finally {
    URL.revokeObjectURL(img.src)
  }
  const aspect = img.height / img.width
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) throw new Error('Der Plan ist zu schmal oder zu hoch (höchstens 3:1)')
  const scale = Math.min(1, 2400 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#14171c' // transparent PNGs get the map's background instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const bytes = (d: string) => Math.floor(((d.length - d.indexOf(',') - 1) * 3) / 4)
  for (const q of [0.85, 0.75, 0.62, 0.5, 0.4]) {
    let data = canvas.toDataURL('image/webp', q)
    if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', q) // browsers without WebP encoding
    if (bytes(data) <= MAX_IMAGE_BYTES) return { data, width: canvas.width, height: canvas.height }
  }
  throw new Error('Der Plan lässt sich nicht unter 1 MB verkleinern – bitte mit weniger Details exportieren')
}

const clamp = (v: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, v)))

export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const { w: W, h: H } = mapSize()
  const initial = useMemo(
    () => ({
      pois: POIS.filter((p) => p.cat !== 'stage').map(({ confirmedMin: _, ...p }) => ({ ...p, x: clamp(p.x, 0, W), y: clamp(p.y, 0, H) })),
      stages: STAGES.map((s) => ({ id: s.id, name: s.name, color: s.color, x: clamp(s.x, 0, W), y: clamp(s.y, 0, H) })),
    }),
    [W, H],
  )
  const [pois, setPois] = useState<Marker[]>(initial.pois)
  const [stages, setStages] = useState<StagePos[]>(initial.stages)
  const [sel, setSel] = useState<string | null>(null) // poi id or "stage:<id>"
  const [addCat, setAddCat] = useState<PoiCat | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify({ pois, stages }) !== JSON.stringify(initial)
  const box = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [scale, setScale] = useState(0.6)
  const drag = useRef<string | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(el.clientWidth / W)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W])

  // closing the tab with unsaved markers asks first
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const toMap = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / scale, 0, W), y: clamp((e.clientY - r.top) / scale, 0, H) }
  }
  const move = (key: string, x: number, y: number) => {
    x = clamp(x, 0, W)
    y = clamp(y, 0, H)
    if (key.startsWith('stage:')) setStages((l) => l.map((s) => (s.id === key.slice(6) ? { ...s, x, y } : s)))
    else setPois((l) => l.map((p) => (p.id === key ? { ...p, x, y } : p)))
  }
  const posOf = (key: string) => (key.startsWith('stage:') ? stages.find((s) => s.id === key.slice(6)) : pois.find((p) => p.id === key))

  const addAt = (x: number, y: number, cat: PoiCat) => {
    if (pois.length >= MAX_POIS) return flash('err', `Höchstens ${MAX_POIS} Marker`)
    const n = pois.filter((p) => p.cat === cat).length + 1
    const p: Marker = { id: `${cat}-${Date.now().toString(36)}`, cat, name: `${POI_CAT_LABEL[cat]} ${n}`, detail: '', x, y, important: true }
    setPois((l) => [...l, p])
    setSel(p.id)
    setAddCat(null)
  }

  const selPoi = sel && !sel.startsWith('stage:') ? pois.find((p) => p.id === sel) : undefined
  const selStage = sel?.startsWith('stage:') ? stages.find((s) => s.id === sel.slice(6)) : undefined
  const patch = (f: Partial<Marker>) => selPoi && setPois((l) => l.map((p) => (p.id === selPoi.id ? { ...p, ...f } : p)))
  const invalid = pois.find((p) => !p.name.trim())

  const save = async () => {
    if (invalid) return flash('err', 'Jeder Marker braucht einen Namen')
    setBusy(true)
    try {
      await admin.setPois(slug, {
        pois: pois.map((p) => ({ ...p, name: p.name.trim(), detail: p.detail.trim(), status: p.status })),
        stages: stages.map(({ id, x, y }) => ({ id, x, y })),
      })
      await reload()
      flash('ok', `Karte gespeichert – ${pois.length} Marker, ${stages.length} Bühnen`)
    } catch (err) {
      flash('err', errText(err))
    }
    setBusy(false)
  }

  const setPlan = async (body: Parameters<typeof admin.setMap>[1], ok: string) => {
    setBusy(true)
    try {
      await admin.setMap(slug, body)
      await reload()
      flash('ok', ok)
    } catch (err) {
      flash('err', errText(err))
    }
    setBusy(false)
  }

  const markerKeys = (key: string) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 25 : 5
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const p = posOf(key)
    if (p) move(key, p.x + d[0], p.y + d[1])
  }
  const markerPointer = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      drag.current = key
      setSel(key)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (drag.current !== key) return
      const p = toMap(e)
      move(key, p.x, p.y)
    },
    onPointerUp: () => {
      drag.current = null
    },
  })
  const inv = Math.min(1.6, 1 / scale) * 0.75

  return (
    <div className="admin-grid map-editor">
      <section className="card" aria-label="Karte bearbeiten">
        <h2 className="admin-h">Karte</h2>
        <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 10 }} role="group" aria-label="Neuen Marker setzen">
          {POI_CATS.map((c) => {
            const I = CAT_ICON[c]
            return (
              <button key={c} type="button" className={`chip ${addCat === c ? 'on' : ''}`} aria-pressed={addCat === c} onClick={() => setAddCat(addCat === c ? null : c)}>
                <I size={15} /> {POI_CAT_LABEL[c]}
              </button>
            )
          })}
        </div>
        <p className="small muted" style={{ margin: '0 0 10px' }} aria-live="polite">
          {addCat ? `Klicke auf die Karte, um „${POI_CAT_LABEL[addCat]}“ zu setzen.` : 'Marker ziehen oder auswählen und mit den Pfeiltasten verschieben (Umschalt = größere Schritte).'}
        </p>
        <div
          ref={box}
          className="map-editor-canvas"
          style={{ height: H * scale, cursor: addCat ? 'crosshair' : 'default' }}
          onClick={(e) => {
            if (!addCat) return setSel(null)
            const p = toMap(e)
            addAt(p.x, p.y, addCat)
          }}
        >
          <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            <Ground satellite={false} map={FESTIVAL.map} slug={slug} w={W} h={H} stages={stages} />
            {stages.map((s) => {
              const key = 'stage:' + s.id
              return (
                <button
                  key={key}
                  type="button"
                  className={`me-marker stage ${sel === key ? 'sel' : ''}`}
                  style={{ left: s.x, top: s.y, transform: `translate(-50%, -50%) scale(${inv})`, boxShadow: `0 0 0 2px ${s.color}` }}
                  aria-label={`Bühne ${s.name} – mit Pfeiltasten verschieben`}
                  aria-pressed={sel === key}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={markerKeys(key)}
                  {...markerPointer(key)}
                >
                  <span className="dot" style={{ background: s.color }} /> {s.name}
                </button>
              )
            })}
            {pois.map((p) => {
              const I = CAT_ICON[p.cat]
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`me-marker ${sel === p.id ? 'sel' : ''} ${p.important ? '' : 'minor'}`}
                  style={{ left: p.x, top: p.y, transform: `translate(-50%, -50%) scale(${inv})` }}
                  aria-label={`${p.name} (${POI_CAT_LABEL[p.cat]}) – mit Pfeiltasten verschieben`}
                  aria-pressed={sel === p.id}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={markerKeys(p.id)}
                  {...markerPointer(p.id)}
                >
                  <I size={17} />
                </button>
              )
            })}
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>
            <Save size={16} /> {busy ? 'Speichere …' : dirty ? 'Karte speichern' : 'Gespeichert'}
          </button>
          {dirty && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setPois(initial.pois)
                setStages(initial.stages)
                setSel(null)
              }}
            >
              <Undo2 size={16} /> Verwerfen
            </button>
          )}
          <span className="small faint" style={{ alignSelf: 'center' }}>
            {pois.length} Marker · {stages.length} Bühnen
          </span>
        </div>
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="card" aria-label="Ausgewählter Marker">
          {selPoi ? (
            <>
              <h2 className="admin-h">Marker</h2>
              <label className="admin-field">
                <span>Name</span>
                <input className="field" value={selPoi.name} maxLength={60} onChange={(e) => patch({ name: e.target.value })} aria-invalid={!selPoi.name.trim()} />
              </label>
              <div className="admin-row">
                <label className="admin-field">
                  <span>Kategorie</span>
                  <select className="field" value={selPoi.cat} onChange={(e) => patch({ cat: e.target.value as PoiCat })}>
                    {POI_CATS.map((c) => (
                      <option key={c} value={c}>
                        {POI_CAT_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Status</span>
                  <select className="field" value={selPoi.status ?? ''} onChange={(e) => patch({ status: (e.target.value || undefined) as Marker['status'] })}>
                    <option value="">Kein Status</option>
                    {POI_STATUS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="admin-field">
                <span>Beschreibung</span>
                <input className="field" value={selPoi.detail} maxLength={140} placeholder="z. B. Trinkwasser · kostenlos" onChange={(e) => patch({ detail: e.target.value })} />
              </label>
              <label className="row small" style={{ gap: 8, marginBottom: 14 }}>
                <input type="checkbox" checked={!!selPoi.important} onChange={(e) => patch({ important: e.target.checked })} /> Immer auf der Karte zeigen (sonst nur im Kategorie-Filter)
              </label>
              <p className="small faint">
                Position {selPoi.x} / {selPoi.y}
              </p>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setPois((l) => l.filter((p) => p.id !== selPoi.id))
                  setSel(null)
                }}
              >
                <Trash2 size={16} /> Marker entfernen
              </button>
            </>
          ) : selStage ? (
            <>
              <h2 className="admin-h">Bühne {selStage.name}</h2>
              <p className="small muted">
                Position {selStage.x} / {selStage.y}. Name, Farbe und Beschreibung pflegst du unter „Bühnen“.
              </p>
            </>
          ) : (
            <>
              <h2 className="admin-h">Kein Marker gewählt</h2>
              <p className="small muted">Wähle oben eine Kategorie und klicke auf die Karte, um einen Marker zu setzen – oder wähle einen vorhandenen aus.</p>
            </>
          )}
        </section>

        <section className="card" aria-label="Geländeplan">
          <h2 className="admin-h">Geländeplan</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            Eigenes Bild des Geländes (PNG, JPEG oder WebP, wird auf 2400 px verkleinert). Bei anderem Seitenverhältnis wandern alle Marker anteilig mit.
          </p>
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
                const plan = await readPlan(file)
                await setPlan({ image: plan.data, width: plan.width, height: plan.height }, 'Geländeplan gespeichert')
              } catch (err) {
                flash('err', errText(err))
              }
            }}
          />
          {dirty && <p className="small" style={{ color: 'var(--warn)' }}>Erst die Marker speichern oder verwerfen.</p>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary sm" disabled={busy || dirty} onClick={() => fileRef.current?.click()}>
              <ImageUp size={16} /> {FESTIVAL.map.image ? 'Plan ersetzen' : 'Plan hochladen'}
            </button>
            {FESTIVAL.map.image ? (
              <button type="button" className="btn ghost sm" disabled={busy || dirty} onClick={() => setPlan({ image: null }, 'Geländeplan entfernt')}>
                <Trash2 size={16} /> Plan entfernen
              </button>
            ) : (
              <label className="admin-field" style={{ margin: 0, flex: '0 1 220px' }}>
                <span className="sr-only">Hintergrund ohne Plan</span>
                <select
                  className="field"
                  disabled={busy || dirty}
                  value={FESTIVAL.map.ground ?? 'plain'}
                  onChange={(e) => setPlan({ image: null, ground: e.target.value as 'demo' | 'plain' }, 'Hintergrund geändert')}
                  aria-label="Hintergrund ohne Plan"
                >
                  <option value="plain">Neutrales Raster</option>
                  <option value="demo">Illustriertes Demo-Gelände</option>
                </select>
              </label>
            )}
          </div>
          <p className="small faint" style={{ marginBottom: 0 }}>
            Kartengröße {MAP_W} × {H} Einheiten
          </p>
        </section>

        <section className="card" aria-label="Alle Marker">
          <h2 className="admin-h">Alle Marker</h2>
          {pois.length === 0 && <p className="small muted">Noch keine Marker. Wasser, WCs, Sanitäter und Eingänge helfen Besuchern am meisten.</p>}
          <ul className="me-list">
            {pois.map((p) => {
              const I = CAT_ICON[p.cat]
              return (
                <li key={p.id}>
                  <button type="button" aria-pressed={sel === p.id} className={sel === p.id ? 'on' : ''} onClick={() => setSel(p.id)}>
                    <I size={15} /> <span className="grow">{p.name || <em>ohne Namen</em>}</span> <span className="faint tiny">{POI_CAT_LABEL[p.cat]}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {pois.length === 0 && (
            <button type="button" className="btn secondary sm" onClick={() => setAddCat('water')}>
              <Plus size={16} /> <MapPin size={16} /> Ersten Marker setzen
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
