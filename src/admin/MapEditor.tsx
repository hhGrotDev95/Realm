// P6 · Karteneditor: own site plan + markers, positioned relative to the plan.
import { ImageUp, MapPin, Plus, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { adminApi } from '../api'
import { FESTIVAL, POIS, STAGES } from '../data'
import { CAT_ICON } from '../screens/mapIcons'
import { CAT_LABEL, checkMap, heightForImage, MAP_IMAGE_MAX, MAP_W, POI_CATS, stageMarkerId, type MapCat, type MapMarker, type MapMeta, type MapStatus } from '../map/doc'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')
const STATUS_LABEL: Record<MapStatus, string> = { open: 'Geöffnet', busy: 'Viel los', closed: 'Geschlossen' }
const OTHER_CATS = POI_CATS.filter((c) => c !== 'stage')

/** Downscales the plan until its data: URL fits the limit (WebP, falling back to JPEG). */
export async function readPlan(file: File): Promise<{ image: string; height: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Bitte PNG, JPEG oder WebP wählen (PDF vorher als Bild exportieren)')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (img.width < 200 || img.height < 200) throw new Error('Plan ist zu klein (mind. 200 × 200 px)')
    let edge = Math.min(2400, Math.max(img.width, img.height))
    for (let i = 0; i < 8; i++, edge = Math.round(edge * 0.8)) {
      const scale = Math.min(1, edge / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff' // transparent PNGs would turn black as JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      let data = canvas.toDataURL('image/webp', 0.8)
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.8)
      if (data.length <= MAP_IMAGE_MAX) return { image: data, height: heightForImage(img.width, img.height) }
    }
    throw new Error('Plan lässt sich nicht klein genug speichern')
  } finally {
    URL.revokeObjectURL(url)
  }
}

const initialMarkers = (): MapMarker[] =>
  POIS.map((p) => ({ id: p.id, cat: p.cat, name: p.name, x: p.x, y: p.y, detail: p.detail ?? '', important: !!p.important, ...(p.status ? { status: p.status } : {}) }))

export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [meta, setMeta] = useState<MapMeta>(() => ({ ...FESTIVAL.map }))
  const [markers, setMarkers] = useState<MapMarker[]>(initialMarkers)
  const [sel, setSel] = useState<string | null>(null)
  const [placing, setPlacing] = useState<MapMarker | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newCat, setNewCat] = useState<MapCat>('water')
  const plan = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<string | null>(null)
  // the click that ends a press on a pin bubbles to the plan; it must not deselect or place
  const pinPress = useRef(false)

  const H = meta.height
  const stageName = (id: string) => STAGES.find((s) => stageMarkerId(s.id) === id)?.name
  const unplaced = STAGES.filter((s) => !markers.some((m) => m.id === stageMarkerId(s.id)))
  const current = markers.find((m) => m.id === sel) ?? null
  const check = useMemo(() => checkMap({ ...meta, markers }, STAGES.map((s) => s.id)), [meta, markers])

  const change = (fn: (ms: MapMarker[]) => MapMarker[]) => {
    setMarkers(fn)
    setDirty(true)
  }
  const patch = (id: string, p: Partial<MapMarker>) => change((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)))

  /** Plan coordinates of a pointer event, clamped to the plan. */
  const toPlan = (e: { clientX: number; clientY: number }) => {
    const r = plan.current!.getBoundingClientRect()
    const k = r.width / MAP_W
    return { x: Math.round(Math.min(MAP_W, Math.max(0, (e.clientX - r.left) / k))), y: Math.round(Math.min(H, Math.max(0, (e.clientY - r.top) / k))) }
  }

  const startPlacing = (m: MapMarker) => {
    setPlacing(m)
    setSel(null)
  }
  const place = (e: React.MouseEvent) => {
    if (pinPress.current) {
      pinPress.current = false
      return
    }
    if (!placing) {
      setSel(null)
      return
    }
    const pos = toPlan(e)
    const m = { ...placing, ...pos }
    change((ms) => [...ms.filter((x) => x.id !== m.id), m])
    setPlacing(null)
    setSel(m.id)
  }

  const onKey = (e: React.KeyboardEvent, m: MapMarker) => {
    const step = e.shiftKey ? 25 : 5
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (d) {
      e.preventDefault()
      patch(m.id, { x: Math.min(MAP_W, Math.max(0, m.x + d[0])), y: Math.min(H, Math.max(0, m.y + d[1])) })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(m.id)
    }
  }

  const remove = (id: string) => {
    change((ms) => ms.filter((m) => m.id !== id))
    setSel(null)
  }

  const save = async () => {
    if (!check.ok) return
    setBusy(true)
    try {
      await admin.setMap(slug, { height: meta.height, image: meta.image ?? null, terrain: meta.terrain, markers: check.markers })
      setDirty(false)
      await reload()
      flash('ok', 'Karte gespeichert – die App zeigt sie beim nächsten Öffnen')
    } catch (err) {
      flash('err', errText(err))
    }
    setBusy(false)
  }

  const setPlan = (next: MapMeta) => {
    // markers below a shorter plan are moved onto its edge instead of being lost
    setMarkers((ms) => ms.map((m) => (m.y > next.height ? { ...m, y: next.height } : m)))
    setMeta(next)
    setDirty(true)
  }

  return (
    <div className="admin-grid map-editor">
      <section className="card" aria-label="Geländeplan">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 className="admin-h grow" style={{ margin: 0 }}>
            Karte
          </h2>
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
                const p = await readPlan(file)
                setPlan({ height: p.height, image: p.image })
                flash('ok', 'Plan geladen – Orte prüfen und speichern')
              } catch (err) {
                flash('err', errText(err))
              }
            }}
          />
          <button type="button" className="btn secondary sm" onClick={() => fileRef.current?.click()}>
            <ImageUp size={16} /> {meta.image ? 'Plan ersetzen' : 'Geländeplan hochladen'}
          </button>
          {meta.image && (
            <button type="button" className="btn ghost sm" onClick={() => setPlan({ height: meta.height })}>
              <Trash2 size={16} /> Plan entfernen
            </button>
          )}
        </div>
        {/* fixed height: switching to placement mode must not move the plan under the pointer */}
        <p className="tiny faint" style={{ margin: '0 0 10px', minHeight: '3em' }} aria-live="polite">
          {placing ? (
            <b style={{ color: 'var(--text)' }}>Auf den Plan klicken, um „{placing.name}“ zu setzen.</b>
          ) : (
            'Orte ziehen zum Verschieben · auswählen und Pfeiltasten (Umschalt = größere Schritte) · Entf löscht.'
          )}
        </p>
        <div
          ref={plan}
          className={`map-edit-plan ${placing ? 'placing' : ''}`}
          style={{ aspectRatio: `${MAP_W} / ${H}` }}
          onClick={place}
          onPointerMove={(e) => {
            const id = drag.current
            if (!id || !e.buttons) return
            const pos = toPlan(e)
            setMarkers((ms) => ms.map((m) => (m.id === id ? { ...m, ...pos } : m)))
            setDirty(true)
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          data-testid="map-plan"
        >
          {meta.image ? (
            <img src={meta.image} alt="Geländeplan" draggable={false} />
          ) : (
            <div className="map-edit-empty">
              {meta.terrain === 'demo' ? 'Demo-Gelände (gezeichnet)' : 'Noch kein Geländeplan – Orte lassen sich trotzdem setzen.'}
            </div>
          )}
          {markers.map((m) => {
            const I = CAT_ICON[m.cat]
            const stage = m.cat === 'stage' ? STAGES.find((s) => stageMarkerId(s.id) === m.id) : null
            return (
              <button
                key={m.id}
                type="button"
                className={`map-edit-pin ${sel === m.id ? 'on' : ''}`}
                style={{ left: `${(m.x / MAP_W) * 100}%`, top: `${(m.y / H) * 100}%`, ...(stage ? { boxShadow: `0 0 0 2px ${stage.color}` } : {}) }}
                aria-label={`${stage?.name ?? m.name} (${CAT_LABEL[m.cat]})`}
                aria-pressed={sel === m.id}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  ;(e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId)
                  drag.current = m.id
                  pinPress.current = true
                  setSel(m.id)
                  setPlacing(null)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  pinPress.current = false
                }}
                onKeyDown={(e) => onKey(e, m)}
              >
                <I size={14} strokeWidth={2.4} />
              </button>
            )
          })}
        </div>
        <p className="tiny faint" style={{ marginTop: 8 }}>
          Positionen werden relativ zum Plan gespeichert ({MAP_W} × {H} Einheiten) und passen auf jede Bildschirmgröße.
        </p>
      </section>

      <section className="card" aria-label="Orte">
        {current ? (
          <MarkerForm
            key={current.id}
            m={current}
            stageName={stageName(current.id)}
            onChange={(p) => patch(current.id, p)}
            onRemove={() => remove(current.id)}
            onDone={() => setSel(null)}
          />
        ) : (
          <>
            <h2 className="admin-h">Ort hinzufügen</h2>
            <div className="row" style={{ gap: 8, marginBottom: 16 }}>
              <select className="field" aria-label="Kategorie für neuen Ort" value={newCat} onChange={(e) => setNewCat(e.target.value as MapCat)}>
                {OTHER_CATS.map((c) => (
                  <option key={c} value={c}>
                    {CAT_LABEL[c]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn secondary"
                onClick={() => startPlacing({ id: `${newCat}-${Date.now().toString(36)}`, cat: newCat, name: `${CAT_LABEL[newCat]} ${markers.filter((m) => m.cat === newCat).length + 1}`, x: 0, y: 0, detail: '', important: true })}
              >
                <Plus size={17} /> Auf Plan setzen
              </button>
            </div>
            {unplaced.length > 0 && (
              <>
                <h3 className="small" style={{ margin: '0 0 6px' }}>
                  Bühnen ohne Position
                </h3>
                <ul className="list" style={{ marginBottom: 16 }}>
                  {unplaced.map((s) => (
                    <li key={s.id} className="list-item">
                      <span className="grow">{s.name}</span>
                      <button type="button" className="btn ghost sm" onClick={() => startPlacing({ id: stageMarkerId(s.id), cat: 'stage', name: s.name, x: 0, y: 0, detail: s.vibe ?? '', important: true })}>
                        <MapPin size={15} /> Platzieren
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h3 className="small" style={{ margin: '0 0 6px' }}>
              Orte auf der Karte ({markers.length})
            </h3>
            {markers.length === 0 ? (
              <p className="small muted">Noch keine Orte. Bühnen platzieren und Wasser, WCs, Sanitäter und Eingänge ergänzen.</p>
            ) : (
              <ul className="list" style={{ maxHeight: 340, overflow: 'auto' }}>
                {[...markers]
                  .sort((a, b) => POI_CATS.indexOf(a.cat) - POI_CATS.indexOf(b.cat) || a.name.localeCompare(b.name))
                  .map((m) => {
                    const I = CAT_ICON[m.cat]
                    return (
                      <li key={m.id}>
                        <button type="button" className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => setSel(m.id)}>
                          <I size={16} className="faint" />
                          <span className="grow">{stageName(m.id) ?? m.name}</span>
                          <span className="tiny faint">{CAT_LABEL[m.cat]}</span>
                        </button>
                      </li>
                    )
                  })}
              </ul>
            )}
          </>
        )}
        {placing && (
          <button type="button" className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setPlacing(null)}>
            <Undo2 size={15} /> Setzen abbrechen
          </button>
        )}
        {!check.ok && (
          <ul className="small" role="alert" style={{ color: 'var(--crit)', paddingLeft: 18 }}>
            {check.errors.slice(0, 5).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="row" style={{ gap: 10, marginTop: 14, alignItems: 'center' }}>
          <button type="button" className="btn primary" disabled={busy || !dirty || !check.ok} onClick={save}>
            {busy ? 'Speichere …' : 'Karte speichern'}
          </button>
          {dirty && <span className="tiny faint">Ungespeicherte Änderungen</span>}
        </div>
      </section>
    </div>
  )
}

function MarkerForm({ m, stageName, onChange, onRemove, onDone }: { m: MapMarker; stageName?: string; onChange: (p: Partial<MapMarker>) => void; onRemove: () => void; onDone: () => void }) {
  const isStage = m.cat === 'stage'
  return (
    <div>
      <h2 className="admin-h">{isStage ? `Bühne ${stageName ?? m.name}` : 'Ort bearbeiten'}</h2>
      {!isStage && (
        <div className="admin-row">
          <label className="admin-field">
            <span>Name</span>
            <input className="field" value={m.name} maxLength={60} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <label className="admin-field">
            <span>Kategorie</span>
            <select className="field" value={m.cat} onChange={(e) => onChange({ cat: e.target.value as MapCat })}>
              {OTHER_CATS.map((c) => (
                <option key={c} value={c}>
                  {CAT_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {isStage && <p className="tiny faint">Name und Farbe der Bühne änderst du im Bereich „Bühnen“.</p>}
      <label className="admin-field">
        <span>Beschreibung (optional)</span>
        <input className="field" value={m.detail} maxLength={120} placeholder="z. B. Trinkwasser · kostenlos" onChange={(e) => onChange({ detail: e.target.value })} />
      </label>
      {!isStage && (
        <div className="admin-row">
          <label className="admin-field">
            <span>Status</span>
            <select className="field" value={m.status ?? ''} onChange={(e) => onChange({ status: (e.target.value || undefined) as MapStatus | undefined })}>
              <option value="">Kein Status</option>
              {(Object.keys(STATUS_LABEL) as MapStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22 }}>
            <input type="checkbox" checked={m.important} onChange={(e) => onChange({ important: e.target.checked })} />
            <span>Immer auf der Karte zeigen</span>
          </label>
        </div>
      )}
      <p className="tiny faint">
        Position: {m.x} / {m.y}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn secondary sm" onClick={onDone}>
          Fertig
        </button>
        <button type="button" className="btn danger sm" onClick={onRemove}>
          <Trash2 size={15} /> {isStage ? 'Von Karte nehmen' : 'Ort löschen'}
        </button>
      </div>
    </div>
  )
}
