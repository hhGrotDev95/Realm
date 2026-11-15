// P6 map editor: upload a ground plan, place and move markers (stages and points of interest).
// Positions are relative to the plan (x 0–1000, y 0–height, see src/map.ts), so they stay on the
// same spot however large the map is shown in the app.
import { ImageUp, MapPin, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminApi, planUrl } from '../api'
import { FESTIVAL, MAP, POIS, STAGES } from '../data'
import { MAP_W, PLACEABLE_CATS, PLAN_MAX, POI_CATS, POI_STATUS, newPoiId, validatePois, type PoiCat, type PoiStatus } from '../map'
import { CAT_ICON } from '../screens/mapIcons'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

interface EditPoi {
  id: string
  cat: Exclude<PoiCat, 'stage'>
  name: string
  detail: string
  status: PoiStatus | null
  important: boolean
  x: number
  y: number
}
type Sel = { kind: 'stage' | 'poi'; id: string } | null

const clamp = (n: number, max: number) => Math.round(Math.min(max, Math.max(0, n)) * 10) / 10
/** "25,5 %" for people … */
const pct = (n: number, max: number) => `${(Math.round((n / max) * 1000) / 10).toLocaleString('de-DE')} %`
/** … and "25.5%" for CSS */
const cssPct = (n: number, max: number) => `${(n / max) * 100}%`

/**
 * Reads a plan image and re-encodes it (WebP, JPEG as fallback) at most 2400 px wide/high,
 * shrinking further until it fits the upload limit.
 */
async function readPlan(file: File): Promise<{ plan: string; width: number; height: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Bitte ein PNG-, JPEG- oder WebP-Bild wählen (PDF vorher als Bild exportieren)')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode().catch(() => {
      throw new Error('Bild konnte nicht gelesen werden')
    })
    if (img.naturalWidth < 100 || img.naturalHeight < 100) throw new Error('Plan ist zu klein (mindestens 100 × 100 Pixel)')
    let scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight))
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      let plan = canvas.toDataURL('image/webp', 0.82)
      if (!plan.startsWith('data:image/webp')) plan = canvas.toDataURL('image/jpeg', 0.82)
      if (plan.length <= PLAN_MAX) return { plan, width: canvas.width, height: canvas.height }
      scale *= 0.75
    }
    throw new Error('Plan ist auch verkleinert noch zu groß')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const H = MAP.h
  const [stages, setStages] = useState(() => STAGES.map((s) => ({ id: s.id, name: s.name, color: s.color, x: clamp(s.x, MAP_W), y: clamp(s.y, H) })))
  const [pois, setPois] = useState<EditPoi[]>(() =>
    POIS.filter((p) => p.cat !== 'stage').map((p) => ({ id: p.id, cat: p.cat as EditPoi['cat'], name: p.name, detail: p.detail ?? '', status: p.status ?? null, important: !!p.important, x: clamp(p.x, MAP_W), y: clamp(p.y, H) })),
  )
  const [sel, setSel] = useState<Sel>(null)
  const [newCat, setNewCat] = useState<EditPoi['cat']>('water')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; kind: 'stage' | 'poi'; moved: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // unsaved marker changes are not lost by closing the tab by accident
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const check = validatePois(pois, H)
  const selPoi = sel?.kind === 'poi' ? pois.find((p) => p.id === sel.id) : undefined
  const selStage = sel?.kind === 'stage' ? stages.find((s) => s.id === sel.id) : undefined

  const move = (kind: 'stage' | 'poi', id: string, x: number, y: number) => {
    const pos = { x: clamp(x, MAP_W), y: clamp(y, H) }
    if (kind === 'stage') setStages((l) => l.map((s) => (s.id === id ? { ...s, ...pos } : s)))
    else setPois((l) => l.map((p) => (p.id === id ? { ...p, ...pos } : p)))
    setDirty(true)
  }
  const editPoi = (patch: Partial<EditPoi>) => {
    if (!selPoi) return
    setPois((l) => l.map((p) => (p.id === selPoi.id ? { ...p, ...patch } : p)))
    setDirty(true)
  }
  const toMap = (clientX: number, clientY: number) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: ((clientX - r.left) / r.width) * MAP_W, y: ((clientY - r.top) / r.height) * H }
  }
  const addPoi = (at?: { x: number; y: number }) => {
    const id = newPoiId(newCat, pois.map((p) => p.id))
    const p: EditPoi = { id, cat: newCat, name: `${POI_CATS[newCat]} ${pois.filter((x) => x.cat === newCat).length + 1}`, detail: '', status: null, important: true, x: clamp(at?.x ?? MAP_W / 2, MAP_W), y: clamp(at?.y ?? H / 2, H) }
    setPois((l) => [...l, p])
    setSel({ kind: 'poi', id })
    setDirty(true)
  }

  const save = async () => {
    if (!check.ok) return flash('err', check.errors[0])
    setBusy(true)
    try {
      await admin.setPois(slug, { pois: check.pois, stages: stages.map(({ id, x, y }) => ({ id, x, y })) })
      setDirty(false)
      await reload()
      flash('ok', 'Karte gespeichert – die App zeigt sie beim nächsten Öffnen')
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }

  const uploadPlan = async (file: File) => {
    setBusy(true)
    try {
      await admin.setMap(slug, await readPlan(file))
      await reload()
      flash('ok', 'Geländeplan gespeichert')
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }
  const removePlan = async () => {
    if (!window.confirm('Geländeplan entfernen? Die Punkte bleiben an ihrer relativen Position.')) return
    setBusy(true)
    try {
      await admin.setMap(slug, { plan: null })
      await reload()
      flash('ok', 'Geländeplan entfernt')
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }

  const markerProps = (kind: 'stage' | 'poi', id: string, x: number, y: number, label: string) => ({
    type: 'button' as const,
    className: `map-ed-marker ${sel?.kind === kind && sel.id === id ? 'on' : ''}`,
    style: { left: cssPct(x, MAP_W), top: cssPct(y, H) },
    'aria-label': `${label} – Position ${pct(x, MAP_W)} / ${pct(y, H)}. Pfeiltasten verschieben`,
    'aria-pressed': sel?.kind === kind && sel.id === id,
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
    <div className="admin-grid map-ed">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 className="admin-h" style={{ margin: 0 }}>
            Karte
          </h2>
          <span className="tiny muted">{sel ? 'Auf die Karte tippen setzt den gewählten Punkt dorthin' : 'Punkt ziehen, oder wählen und auf die Karte tippen'}</span>
        </div>
        <div
          ref={canvas}
          className="map-ed-canvas"
          style={{ aspectRatio: `${MAP_W} / ${H}` }}
          onPointerDown={(e) => {
            if (!sel) return
            const p = toMap(e.clientX, e.clientY)
            move(sel.kind, sel.id, p.x, p.y)
          }}
        >
          {MAP.plan ? <img src={planUrl(slug, MAP.plan)} alt={`Geländeplan ${FESTIVAL.name}`} draggable={false} /> : <div className="map-ed-empty small muted">Noch kein Geländeplan – Punkte lassen sich trotzdem setzen.</div>}
          {stages.map((s) => (
            <button key={'s:' + s.id} {...markerProps('stage', s.id, s.x, s.y, `Bühne ${s.name}`)}>
              <span className="map-ed-stage" style={{ boxShadow: `0 0 0 2px ${s.color}` }}>
                <span style={{ background: s.color }} />
                {s.name}
              </span>
            </button>
          ))}
          {pois.map((p) => {
            const I = CAT_ICON[p.cat]
            return (
              <button key={'p:' + p.id} {...markerProps('poi', p.id, p.x, p.y, p.name)}>
                <span className={`map-ed-poi ${p.important ? '' : 'minor'}`}>
                  <I size={15} />
                </span>
              </button>
            )
          })}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            aria-label="Geländeplan auswählen"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) uploadPlan(f)
            }}
          />
          <button type="button" className="btn secondary" disabled={busy || dirty} onClick={() => fileRef.current?.click()}>
            <ImageUp size={17} /> {MAP.plan ? 'Plan ersetzen' : 'Geländeplan hochladen'}
          </button>
          {MAP.plan && (
            <button type="button" className="btn ghost" disabled={busy || dirty} onClick={removePlan}>
              <Trash2 size={17} /> Plan entfernen
            </button>
          )}
          {dirty && <span className="tiny muted" style={{ alignSelf: 'center' }}>Erst Punkte speichern, dann den Plan ändern.</span>}
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          PNG, JPEG oder WebP (z. B. ein exportierter Lageplan); große Bilder werden verkleinert. Beim Ersetzen durch ein Bild mit anderem Seitenverhältnis bleiben die Punkte an derselben relativen Stelle.
        </p>
      </div>

      <div className="card">
        {selPoi ? (
          <form onSubmit={(e) => e.preventDefault()} aria-label="Punkt bearbeiten">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 className="admin-h">Punkt bearbeiten</h3>
              <button type="button" className="icon-btn" aria-label="Auswahl aufheben" onClick={() => setSel(null)}>
                <X size={18} />
              </button>
            </div>
            <label className="admin-field">
              <span>Name</span>
              <input className="field" value={selPoi.name} maxLength={40} onChange={(e) => editPoi({ name: e.target.value })} />
            </label>
            <div className="admin-row row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <label className="admin-field">
                <span>Kategorie</span>
                <select className="field" value={selPoi.cat} onChange={(e) => editPoi({ cat: e.target.value as EditPoi['cat'] })}>
                  {PLACEABLE_CATS.map((c) => (
                    <option key={c} value={c}>
                      {POI_CATS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>Status</span>
                <select className="field" value={selPoi.status ?? ''} onChange={(e) => editPoi({ status: (e.target.value || null) as PoiStatus | null })}>
                  <option value="">ohne</option>
                  {(Object.keys(POI_STATUS) as PoiStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {POI_STATUS[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="admin-field">
              <span>Beschreibung</span>
              <input className="field" value={selPoi.detail} maxLength={80} placeholder="z. B. Trinkwasser · kostenlos" onChange={(e) => editPoi({ detail: e.target.value })} />
            </label>
            <label className="row small" style={{ gap: 8, marginBottom: 14 }}>
              <input type="checkbox" checked={selPoi.important} onChange={(e) => editPoi({ important: e.target.checked })} />
              Immer auf der Karte zeigen (sonst nur über Filter und Suche)
            </label>
            <p className="tiny muted">
              Position {pct(selPoi.x, MAP_W)} von links, {pct(selPoi.y, H)} von oben
            </p>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setPois((l) => l.filter((p) => p.id !== selPoi.id))
                setSel(null)
                setDirty(true)
              }}
            >
              <Trash2 size={17} /> Punkt löschen
            </button>
          </form>
        ) : selStage ? (
          <div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 className="admin-h">Bühne {selStage.name}</h3>
              <button type="button" className="icon-btn" aria-label="Auswahl aufheben" onClick={() => setSel(null)}>
                <X size={18} />
              </button>
            </div>
            <p className="small muted">
              Position {pct(selStage.x, MAP_W)} von links, {pct(selStage.y, H)} von oben. Name und Farbe änderst du unter „Bühnen“.
            </p>
          </div>
        ) : (
          <>
            <h3 className="admin-h">Punkt hinzufügen</h3>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="admin-field" style={{ marginBottom: 0 }}>
                <span>Kategorie</span>
                <select className="field" value={newCat} onChange={(e) => setNewCat(e.target.value as EditPoi['cat'])}>
                  {PLACEABLE_CATS.map((c) => (
                    <option key={c} value={c}>
                      {POI_CATS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn secondary" onClick={() => addPoi()}>
                <Plus size={17} /> Hinzufügen
              </button>
            </div>
            <p className="tiny muted">Der neue Punkt erscheint in der Kartenmitte und ist ausgewählt – dann auf die richtige Stelle tippen oder ziehen.</p>
          </>
        )}

        <h3 className="admin-h" style={{ marginTop: 18 }}>
          Alle Punkte ({stages.length + pois.length})
        </h3>
        <div className="map-ed-list">
          {stages.map((s) => (
            <button type="button" key={'s:' + s.id} className={`list-item ${selStage?.id === s.id ? 'on' : ''}`} onClick={() => setSel({ kind: 'stage', id: s.id })}>
              <span className="dot" style={{ background: s.color }} /> <span className="grow">{s.name}</span> <span className="tiny muted">Bühne</span>
            </button>
          ))}
          {pois.map((p) => {
            const I = CAT_ICON[p.cat]
            return (
              <button type="button" key={'p:' + p.id} className={`list-item ${selPoi?.id === p.id ? 'on' : ''}`} onClick={() => setSel({ kind: 'poi', id: p.id })}>
                <I size={16} /> <span className="grow">{p.name || <em>ohne Namen</em>}</span> <span className="tiny muted">{POI_CATS[p.cat]}</span>
              </button>
            )
          })}
          {!stages.length && !pois.length && (
            <p className="small muted">
              <MapPin size={15} /> Noch keine Punkte. Bühnen legst du unter „Bühnen“ an.
            </p>
          )}
        </div>

        {!check.ok && (
          <p className="small" role="alert" style={{ color: 'var(--crit)' }}>
            {check.errors[0]}
          </p>
        )}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button type="button" className="btn primary" disabled={busy || !dirty || !check.ok} onClick={save}>
            <Save size={17} /> {busy ? 'Speichere …' : 'Karte speichern'}
          </button>
          {dirty && <span className="tiny muted">Ungespeicherte Änderungen</span>}
        </div>
      </div>
    </div>
  )
}
