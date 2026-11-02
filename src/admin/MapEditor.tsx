import { ImageUp, MapPin, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminApi } from '../api'
import { MAP, POIS, STAGES, stageById, type Poi, type PoiCat } from '../data'
import { mapImageUrl } from '../mapImage'
import { CAT_ICON } from '../screens/mapIcons'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

const CATS: { id: Exclude<PoiCat, 'stage'>; label: string }[] = [
  { id: 'water', label: 'Wasser' },
  { id: 'wc', label: 'WC' },
  { id: 'food', label: 'Essen' },
  { id: 'bar', label: 'Bar' },
  { id: 'medical', label: 'Sanität' },
  { id: 'entrance', label: 'Eingang' },
  { id: 'camping', label: 'Camping' },
  { id: 'info', label: 'Info' },
  { id: 'shuttle', label: 'Shuttle' },
]
const MAX_SIDE = 2400
const MAX_CHARS = 1_350_000 // a little below the server limit (base64 characters)

/** Scales the plan to at most 2400 px and compresses it (WebP, else JPEG) below ~1 MB. */
async function readPlan(file: File): Promise<{ image: string; width: number; height: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Bitte ein PNG, JPEG oder WebP wählen (PDF vorher als Bild exportieren)')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const ratio = img.height / img.width
    if (ratio < 0.25 || ratio > 4) throw new Error('Seitenverhältnis des Plans ist zu extrem (max. 4 : 1)')
    for (let side = MAX_SIDE; side >= 800; side = Math.round(side * 0.8)) {
      const scale = Math.min(1, side / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff' // transparent PNGs would turn black as JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const q of [0.85, 0.72, 0.6]) {
        let data = canvas.toDataURL('image/webp', q)
        if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', q)
        if (data.length - data.indexOf(',') - 1 <= MAX_CHARS) return { image: data, width: canvas.width, height: canvas.height }
      }
    }
    throw new Error('Plan lässt sich nicht unter 1 MB komprimieren')
  } finally {
    URL.revokeObjectURL(url)
  }
}

type Draft = { id: string; cat: Exclude<PoiCat, 'stage'>; name: string; x: number; y: number; detail: string; status: '' | 'open' | 'busy' | 'closed'; important: boolean; isNew?: boolean }
type Sel = { kind: 'stage'; id: string } | { kind: 'poi'; id: string } | null

const toDraft = (p: Poi): Draft => ({ id: p.id, cat: p.cat as Draft['cat'], name: p.name, x: p.x, y: p.y, detail: p.detail, status: p.status ?? '', important: !!p.important })
const newId = (name: string, taken: Set<string>) => {
  const base =
    name
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'ort'
  let id = base.startsWith('stage-') ? 'ort-' + base : base
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  return id
}

/** Keeps the console's copy of the festival in step, so other tabs see the change without reloading. */
function syncShared(pois: Draft[], stagePos: Record<string, { x: number; y: number }>) {
  for (const s of STAGES) Object.assign(s, stagePos[s.id] ?? {})
  const stagePois = STAGES.map((s) => ({ id: 'stage-' + s.id, cat: 'stage' as const, name: s.name, x: s.x, y: s.y, detail: s.vibe, important: true }))
  POIS.splice(0, POIS.length, ...stagePois, ...pois.filter((p) => !p.isNew).map((p) => ({ id: p.id, cat: p.cat, name: p.name, x: p.x, y: p.y, detail: p.detail, status: p.status || undefined, important: p.important })))
}

export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [pois, setPois] = useState<Draft[]>(() => POIS.filter((p) => p.cat !== 'stage').map(toDraft))
  const [stagePos, setStagePos] = useState<Record<string, { x: number; y: number }>>(() => Object.fromEntries(STAGES.map((s) => [s.id, { x: s.x, y: s.y }])))
  const [sel, setSel] = useState<Sel>(null)
  const [placing, setPlacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState<string | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ sel: NonNullable<Sel>; moved: boolean } | null>(null)
  const W = MAP.width
  const H = MAP.height

  useEffect(() => {
    let alive = true
    mapImageUrl()?.then(
      (u) => alive && setImg(u),
      () => alive && flash('err', 'Geländeplan konnte nicht geladen werden'),
    )
    return () => {
      alive = false
    }
  }, [flash])

  const toMap = (e: { clientX: number; clientY: number }) => {
    const r = surface.current!.getBoundingClientRect()
    const clamp = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)))
    return { x: clamp(((e.clientX - r.left) / r.width) * W, W), y: clamp(((e.clientY - r.top) / r.height) * H, H) }
  }
  const move = (s: NonNullable<Sel>, x: number, y: number) => {
    if (s.kind === 'stage') setStagePos((p) => ({ ...p, [s.id]: { x, y } }))
    else setPois((list) => list.map((p) => (p.id === s.id ? { ...p, x, y } : p)))
  }

  const saveStage = async (id: string, pos = stagePos[id]) => {
    try {
      await admin.placeStage(slug, id, pos.x, pos.y)
      syncShared(pois, { ...stagePos, [id]: pos })
      flash('ok', `${stageById[id]?.name ?? 'Bühne'} platziert`)
    } catch (e) {
      flash('err', errText(e))
    }
  }
  const savePoi = async (d: Draft) => {
    if (!d.name.trim()) return flash('err', 'Name fehlt')
    // new places get a readable id from their name ("wasser-nord")
    const id = d.isNew ? newId(d.name, new Set(pois.filter((p) => p.id !== d.id).map((p) => p.id))) : d.id
    try {
      await admin.savePoi(slug, { id, cat: d.cat, name: d.name.trim(), x: d.x, y: d.y, detail: d.detail.trim(), status: d.status || null, important: d.important })
      const next = pois.map((p) => (p.id === d.id ? { ...d, id, name: d.name.trim(), isNew: false } : p))
      setPois(next)
      if (d.isNew) setSel({ kind: 'poi', id })
      syncShared(next, stagePos)
      flash('ok', `„${d.name.trim()}“ gespeichert`)
    } catch (e) {
      flash('err', errText(e))
    }
  }
  const removePoi = async (d: Draft) => {
    try {
      if (!d.isNew) await admin.deletePoi(slug, d.id)
      const next = pois.filter((p) => p.id !== d.id)
      setPois(next)
      syncShared(next, stagePos)
      setSel(null)
      flash('ok', `„${d.name || 'Ort'}“ entfernt`)
    } catch (e) {
      flash('err', errText(e))
    }
  }

  const onSurfaceDown = (e: React.PointerEvent) => {
    if (!placing || (e.target as HTMLElement).closest('button')) return
    const { x, y } = toMap(e)
    const id = newId('ort', new Set(pois.map((p) => p.id)))
    setPois((l) => [...l, { id, cat: 'water', name: '', x, y, detail: '', status: 'open', important: true, isNew: true }])
    setSel({ kind: 'poi', id })
    setPlacing(false)
  }
  const onMarkerDown = (s: NonNullable<Sel>) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { sel: s, moved: false }
    setSel(s)
  }
  const onMarkerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current.moved = true
    const { x, y } = toMap(e)
    move(drag.current.sel, x, y)
  }
  const onMarkerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    const { x, y } = toMap(e)
    // stages are saved right away; points of interest with the form (new ones need a name first)
    if (d.sel.kind === 'stage') saveStage(d.sel.id, { x, y })
    else {
      const p = pois.find((q) => q.id === d.sel.id)
      if (p && !p.isNew) savePoi({ ...p, x, y })
    }
  }
  // arrow keys move the selected marker (Shift = 25 units); Enter saves
  const onMarkerKey = (s: NonNullable<Sel>) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 25 : 5
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const cur = s.kind === 'stage' ? stagePos[s.id] : pois.find((p) => p.id === s.id)!
    move(s, Math.min(W, Math.max(0, cur.x + d[0])), Math.min(H, Math.max(0, cur.y + d[1])))
  }

  const uploadPlan = async (file: File) => {
    setBusy(true)
    try {
      const plan = await readPlan(file)
      await admin.setMap(slug, plan)
      await reload()
      flash('ok', 'Geländeplan gespeichert – jetzt Bühnen und Orte platzieren')
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }
  const removePlan = async () => {
    if (!confirm('Geländeplan entfernen? Die Marker bleiben erhalten.')) return
    setBusy(true)
    try {
      await admin.removeMap(slug)
      await reload()
      flash('ok', 'Geländeplan entfernt')
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }

  const selPoi = sel?.kind === 'poi' ? pois.find((p) => p.id === sel.id) : undefined
  const selStage = sel?.kind === 'stage' ? STAGES.find((s) => s.id === sel.id) : undefined
  const pct = (x: number, y: number): React.CSSProperties => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` })

  return (
    <div className="admin-grid">
      <div className="card">
        <h2 className="admin-h">Karte</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            aria-label="Geländeplan hochladen"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) uploadPlan(f)
            }}
          />
          <button type="button" className="btn secondary sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <ImageUp size={16} /> {MAP.version !== null ? 'Plan ersetzen' : 'Geländeplan hochladen'}
          </button>
          {MAP.version !== null && (
            <button type="button" className="btn ghost sm" disabled={busy} onClick={removePlan}>
              <Trash2 size={16} /> Plan entfernen
            </button>
          )}
          <button type="button" className={`btn sm ${placing ? 'primary' : 'secondary'}`} aria-pressed={placing} onClick={() => setPlacing((v) => !v)}>
            <Plus size={16} /> {placing ? 'Auf die Karte tippen …' : 'Neuer Ort'}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {MAP.version !== null
            ? 'Marker ziehen zum Verschieben (oder auswählen und Pfeiltasten). Bühnen werden sofort gespeichert.'
            : 'Noch kein eigener Plan – die App zeigt das Beispielgelände. Lade ein Bild deines Geländeplans hoch (PNG, JPEG oder WebP).'}
        </p>
        <div
          ref={surface}
          className={`map-editor ${placing ? 'placing' : ''}`}
          style={{ aspectRatio: `${W} / ${H}` }}
          onPointerDown={onSurfaceDown}
          data-testid="map-editor"
        >
          {img ? <img src={img} alt="Geländeplan" draggable={false} /> : <div className="map-editor-empty" aria-hidden />}
          {STAGES.map((s) => {
            const pos = stagePos[s.id] ?? s
            const me = { kind: 'stage', id: s.id } as const
            return (
              <button
                key={'s-' + s.id}
                type="button"
                className={`map-editor-pin stage ${sel?.kind === 'stage' && sel.id === s.id ? 'on' : ''}`}
                style={{ ...pct(pos.x, pos.y), background: s.color }}
                aria-label={`Bühne ${s.name} – ziehen oder Pfeiltasten zum Verschieben`}
                onPointerDown={onMarkerDown(me)}
                onPointerMove={onMarkerMove}
                onPointerUp={onMarkerUp}
                onKeyDown={onMarkerKey(me)}
                onFocus={() => setSel(me)}
              >
                {s.name}
              </button>
            )
          })}
          {pois.map((p) => {
            const I = CAT_ICON[p.cat]
            const me = { kind: 'poi', id: p.id } as const
            return (
              <button
                key={'p-' + p.id}
                type="button"
                className={`map-editor-pin ${sel?.kind === 'poi' && sel.id === p.id ? 'on' : ''}`}
                style={pct(p.x, p.y)}
                aria-label={`${p.name || 'Neuer Ort'} – ziehen oder Pfeiltasten zum Verschieben`}
                onPointerDown={onMarkerDown(me)}
                onPointerMove={onMarkerMove}
                onPointerUp={onMarkerUp}
                onKeyDown={onMarkerKey(me)}
                onFocus={() => setSel(me)}
              >
                <I size={15} />
              </button>
            )
          })}
        </div>
      </div>

      <div className="card">
        {selStage ? (
          <>
            <h2 className="admin-h">Bühne {selStage.name}</h2>
            <Coords x={stagePos[selStage.id].x} y={stagePos[selStage.id].y} w={W} h={H} onChange={(x, y) => move({ kind: 'stage', id: selStage.id }, x, y)} />
            <p className="small muted">Name, Farbe und Beschreibung pflegst du unter „Bühnen“.</p>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn primary" onClick={() => saveStage(selStage.id)}>
                <Save size={16} /> Position speichern
              </button>
              <button type="button" className="btn ghost" onClick={() => setSel(null)}>
                Zur Liste
              </button>
            </div>
          </>
        ) : selPoi ? (
          <PoiForm key={selPoi.id} poi={selPoi} w={W} h={H} onChange={(d) => setPois((l) => l.map((p) => (p.id === d.id ? d : p)))} onSave={savePoi} onRemove={removePoi} onBack={() => setSel(null)} />
        ) : (
          <>
            <h2 className="admin-h">Orte</h2>
            <p className="small muted" style={{ marginTop: -6 }}>
              Marker auf der Karte oder hier auswählen. „Wichtig“ heißt: in der App ohne Filter sichtbar.
            </p>
            <div className="list">
              {pois.length === 0 && <p className="small faint">Noch keine Orte – „Neuer Ort“ und auf die Karte tippen.</p>}
              {pois.map((p) => {
                const I = CAT_ICON[p.cat]
                return (
                  <button key={p.id} type="button" className="list-item" style={{ textAlign: 'left', width: '100%' }} onClick={() => setSel({ kind: 'poi', id: p.id })}>
                    <I size={17} className="faint" />
                    <span className="grow">
                      <span style={{ fontWeight: 600, display: 'block' }}>{p.name || 'Neuer Ort'}</span>
                      <span className="small faint">
                        {CATS.find((c) => c.id === p.cat)?.label}
                        {p.important ? ' · wichtig' : ''}
                      </span>
                    </span>
                    <MapPin size={15} className="faint" />
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Coords({ x, y, w, h, onChange }: { x: number; y: number; w: number; h: number; onChange: (x: number, y: number) => void }) {
  const num = (v: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)))
  return (
    <div className="admin-row row" style={{ gap: 10 }}>
      <label className="admin-field">
        <span>X (0–{w})</span>
        <input className="field" type="number" min={0} max={w} value={x} onChange={(e) => onChange(num(e.target.value, w), y)} />
      </label>
      <label className="admin-field">
        <span>Y (0–{h})</span>
        <input className="field" type="number" min={0} max={h} value={y} onChange={(e) => onChange(x, num(e.target.value, h))} />
      </label>
    </div>
  )
}

function PoiForm({ poi, w, h, onChange, onSave, onRemove, onBack }: { poi: Draft; w: number; h: number; onChange: (d: Draft) => void; onSave: (d: Draft) => void; onRemove: (d: Draft) => void; onBack: () => void }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...poi, [k]: v })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave(poi)
      }}
    >
      <h2 className="admin-h">{poi.isNew ? 'Neuer Ort' : poi.name}</h2>
      <label className="admin-field">
        <span>Name</span>
        <input className="field" value={poi.name} maxLength={60} required autoFocus={poi.isNew} onChange={(e) => set('name', e.target.value)} />
      </label>
      <div className="admin-row row" style={{ gap: 10 }}>
        <label className="admin-field">
          <span>Kategorie</span>
          <select className="field" value={poi.cat} onChange={(e) => set('cat', e.target.value as Draft['cat'])}>
            {CATS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Status</span>
          <select className="field" value={poi.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
            <option value="">ohne</option>
            <option value="open">offen</option>
            <option value="busy">voll</option>
            <option value="closed">geschlossen</option>
          </select>
        </label>
      </div>
      <label className="admin-field">
        <span>Beschreibung</span>
        <input className="field" value={poi.detail} maxLength={120} onChange={(e) => set('detail', e.target.value)} />
      </label>
      <Coords x={poi.x} y={poi.y} w={w} h={h} onChange={(x, y) => onChange({ ...poi, x, y })} />
      <label className="row small" style={{ gap: 8, marginBottom: 14 }}>
        <input type="checkbox" checked={poi.important} onChange={(e) => set('important', e.target.checked)} /> Wichtig (ohne Filter sichtbar)
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary">
          <Save size={16} /> Speichern
        </button>
        <button type="button" className="btn ghost" onClick={() => onRemove(poi)}>
          <Trash2 size={16} /> {poi.isNew ? 'Verwerfen' : 'Löschen'}
        </button>
        {!poi.isNew && (
          <button type="button" className="btn ghost" onClick={onBack}>
            Zur Liste
          </button>
        )}
      </div>
    </form>
  )
}
