import { ImageUp, MapPin, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminApi } from '../api'
import { MAP, POIS, STAGES } from '../data'
import { DEFAULT_MAP_H, MAP_H_MAX, MAP_H_MIN, MAP_IMAGE_MAX, MAP_W, MAX_POIS, POI_CAT_LABEL, POI_CATS, type EditablePoiCat } from '../mapModel'
import { CAT_ICON } from '../screens/mapIcons'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

type StagePos = { id: string; name: string; color: string; x: number; y: number }
type Place = { id: string; cat: EditablePoiCat; name: string; x: number; y: number; detail: string; status: '' | 'open' | 'busy' | 'closed'; important: boolean }
type Sel = { kind: 'stage' | 'poi'; id: string } | null

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const isPoiCat = (c: string): c is EditablePoiCat => (POI_CATS as readonly string[]).includes(c)
const STATUS_LABEL = { '': 'ohne Angabe', open: 'Geöffnet', busy: 'Viel los', closed: 'Geschlossen' } as const

/**
 * Reads a ground plan, scales it to at most 2000 px wide and re-encodes it (WebP, else JPEG)
 * until it fits the size limit. Returns the data URL and the canvas height for its aspect ratio.
 */
async function readPlan(file: File): Promise<{ image: string; height: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Bitte ein PNG, JPEG oder WebP wählen (PDF vorher als Bild exportieren)')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    if (!img.width || !img.height) throw new Error('Bild ist leer')
    const height = Math.round((MAP_W * img.height) / img.width)
    if (height < MAP_H_MIN || height > MAP_H_MAX) throw new Error('Seitenverhältnis passt nicht – der Plan darf höchstens viermal so hoch wie breit und höchstens viermal so breit wie hoch sein')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    for (const [maxW, quality] of [
      [2000, 0.85],
      [1600, 0.8],
      [1400, 0.72],
      [1200, 0.65],
      [1000, 0.6],
    ] as const) {
      const scale = Math.min(1, maxW / img.width)
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      ctx.fillStyle = '#ffffff' // transparent PNG areas would turn black in JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      let data = canvas.toDataURL('image/webp', quality)
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', quality)
      if (data.length <= MAP_IMAGE_MAX) return { image: data, height }
    }
    throw new Error('Plan ist auch verkleinert noch zu groß – bitte ein einfacheres Bild verwenden')
  } finally {
    URL.revokeObjectURL(url)
  }
}

const newId = (cat: string, taken: Set<string>) => {
  for (;;) {
    const id = `${cat}-${Math.random().toString(36).slice(2, 6)}`
    if (!taken.has(id)) return id
  }
}

export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [image, setImage] = useState<string | undefined>(MAP.image)
  const [imageChanged, setImageChanged] = useState(false)
  const [height, setHeight] = useState(MAP.height)
  // positions created before the editor existed can lie outside the canvas: pull them in
  const [stages, setStages] = useState<StagePos[]>(() => STAGES.map((s) => ({ id: s.id, name: s.name, color: s.color, x: clamp(s.x, 0, MAP_W), y: clamp(s.y, 0, MAP.height) })))
  const [places, setPlaces] = useState<Place[]>(() =>
    POIS.filter((p) => p.cat !== 'stage' && isPoiCat(p.cat)).map((p) => ({
      id: p.id,
      cat: p.cat as EditablePoiCat,
      name: p.name,
      x: clamp(p.x, 0, MAP_W),
      y: clamp(p.y, 0, MAP.height),
      detail: p.detail ?? '',
      status: p.status ?? '',
      important: !!p.important,
    })),
  )
  const [sel, setSel] = useState<Sel>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ kind: 'stage' | 'poi'; id: string; pointer: number } | null>(null)

  // leaving with unsaved positions would silently lose them
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const move = (kind: 'stage' | 'poi', id: string, x: number, y: number) => {
    const p = { x: Math.round(clamp(x, 0, MAP_W)), y: Math.round(clamp(y, 0, height)) }
    if (kind === 'stage') setStages((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s)))
    else setPlaces((l) => l.map((s) => (s.id === id ? { ...s, ...p } : s)))
    setDirty(true)
  }
  const toCanvas = (clientX: number, clientY: number) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: ((clientX - r.left) / r.width) * MAP_W, y: ((clientY - r.top) / r.height) * height }
  }
  /** A new plan with another aspect ratio: markers keep their spot relative to the plan. */
  const rescale = (next: number) => {
    const f = next / height
    if (f !== 1) {
      setStages((l) => l.map((s) => ({ ...s, y: Math.round(s.y * f) })))
      setPlaces((l) => l.map((p) => ({ ...p, y: Math.round(p.y * f) })))
    }
    setHeight(next)
  }

  const selected = sel?.kind === 'poi' ? places.find((p) => p.id === sel.id) : sel?.kind === 'stage' ? stages.find((s) => s.id === sel.id) : undefined
  const patch = (id: string, change: Partial<Place>) => {
    setPlaces((l) => l.map((p) => (p.id === id ? { ...p, ...change } : p)))
    setDirty(true)
  }
  const addPlace = () => {
    if (places.length >= MAX_POIS) return flash('err', `Höchstens ${MAX_POIS} Orte`)
    const id = newId('info', new Set(places.map((p) => p.id)))
    setPlaces((l) => [...l, { id, cat: 'info', name: 'Neuer Ort', x: MAP_W / 2, y: Math.round(height / 2), detail: '', status: '', important: true }])
    setSel({ kind: 'poi', id })
    setDirty(true)
  }
  const invalid = places.find((p) => !p.name.trim())

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await admin.setMap(slug, {
        ...(imageChanged ? { image: image ?? null } : {}),
        height,
        stages: stages.map(({ id, x, y }) => ({ id, x, y })),
        pois: places.map((p) => ({ id: p.id, cat: p.cat, name: p.name.trim(), x: p.x, y: p.y, detail: p.detail.trim() || undefined, status: p.status || undefined, important: p.important })),
      })
      setDirty(false)
      await reload()
      flash('ok', 'Karte gespeichert – die App zeigt sie beim nächsten Abruf')
    } catch (e) {
      setErr(errText(e))
      flash('err', errText(e))
    }
    setBusy(false)
  }

  const marker = (kind: 'stage' | 'poi', id: string, x: number, y: number, label: string, body: React.ReactNode, color?: string) => {
    const on = sel?.kind === kind && sel.id === id
    return (
      <button
        key={kind + id}
        type="button"
        className={`mapedit-marker ${kind} ${on ? 'on' : ''}`}
        style={{ left: `${(x / MAP_W) * 100}%`, top: `${(y / height) * 100}%`, ...(color ? { boxShadow: `0 0 0 2px ${color}` } : {}) }}
        aria-label={`${label} – mit Pfeiltasten verschieben`}
        aria-pressed={on}
        onPointerDown={(e) => {
          e.stopPropagation()
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { kind, id, pointer: e.pointerId }
          setSel({ kind, id })
        }}
        onPointerMove={(e) => {
          if (drag.current?.pointer !== e.pointerId) return
          const p = toCanvas(e.clientX, e.clientY)
          move(kind, id, p.x, p.y)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 25 : 5
          const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
          if (!d) return
          e.preventDefault()
          move(kind, id, x + d[0], y + d[1])
        }}
      >
        {body}
      </button>
    )
  }

  return (
    <div className="admin-grid mapedit">
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 className="admin-h" style={{ margin: 0 }}>
            Karte
          </h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                try {
                  const plan = await readPlan(f)
                  rescale(plan.height)
                  setImage(plan.image)
                  setImageChanged(true)
                  setDirty(true)
                } catch (x) {
                  flash('err', errText(x))
                }
              }}
            />
            <button type="button" className="btn secondary sm" onClick={() => fileRef.current?.click()}>
              <ImageUp size={16} /> {image ? 'Plan ersetzen' : 'Geländeplan hochladen'}
            </button>
            {image && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  rescale(DEFAULT_MAP_H)
                  setImage(undefined)
                  setImageChanged(true)
                  setDirty(true)
                }}
              >
                <Trash2 size={16} /> Plan entfernen
              </button>
            )}
          </div>
        </div>
        <p className="tiny faint" style={{ marginTop: 0 }}>
          Marker ziehen oder antippen und mit den Pfeiltasten verschieben (Umschalt = größere Schritte). {image ? '' : 'Ohne eigenen Plan zeigt die App eine stilisierte Beispiel-Landschaft.'}
        </p>
        <div
          ref={canvas}
          className={`mapedit-canvas ${image ? '' : 'empty'}`}
          style={{ aspectRatio: `${MAP_W} / ${height}`, backgroundImage: image ? `url(${image})` : undefined }}
          onPointerDown={() => setSel(null)}
          role="group"
          aria-label="Kartenvorschau"
        >
          {stages.map((s) =>
            marker('stage', s.id, s.x, s.y, `Bühne ${s.name}`, (
              <>
                <span className="dot" style={{ background: s.color }} /> {s.name}
              </>
            ), s.color),
          )}
          {places.map((p) => {
            const I = CAT_ICON[p.cat]
            return marker('poi', p.id, p.x, p.y, p.name || 'Ort ohne Namen', <I size={15} />)
          })}
        </div>
        <p className="tiny faint">
          {stages.length} Bühnen · {places.length} Orte{image ? ` · Plan ${Math.round((image.length * 3) / 4 / 1024)} kB` : ''}
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 className="admin-h" style={{ margin: 0 }}>
            {sel?.kind === 'stage' ? 'Bühne' : sel?.kind === 'poi' ? 'Ort' : 'Orte'}
          </h2>
          <button type="button" className="btn secondary sm" onClick={addPlace}>
            <Plus size={16} /> Ort hinzufügen
          </button>
        </div>

        {sel?.kind === 'stage' && selected && (
          <div>
            <p className="small">
              <strong>{selected.name}</strong> · Position {selected.x} / {selected.y}
            </p>
            <p className="tiny faint">Name und Farbe der Bühne änderst du unter „Bühnen“.</p>
          </div>
        )}

        {sel?.kind === 'poi' && selected && 'cat' in selected && (
          <div>
            <div className="admin-row">
              <label className="admin-field">
                <span>Kategorie</span>
                <select className="field" value={selected.cat} onChange={(e) => patch(selected.id, { cat: e.target.value as EditablePoiCat })}>
                  {POI_CATS.map((c) => (
                    <option key={c} value={c}>
                      {POI_CAT_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>Status</span>
                <select className="field" value={selected.status} onChange={(e) => patch(selected.id, { status: e.target.value as Place['status'] })}>
                  {(Object.keys(STATUS_LABEL) as Place['status'][]).map((k) => (
                    <option key={k} value={k}>
                      {STATUS_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="admin-field">
              <span>Name</span>
              <input className="field" value={selected.name} maxLength={40} onChange={(e) => patch(selected.id, { name: e.target.value })} aria-invalid={!selected.name.trim()} />
            </label>
            <label className="admin-field">
              <span>Beschreibung (optional)</span>
              <input className="field" value={selected.detail} maxLength={120} onChange={(e) => patch(selected.id, { detail: e.target.value })} placeholder="z. B. inkl. barrierefrei" />
            </label>
            <label className="row small" style={{ gap: 8, marginBottom: 14 }}>
              <input type="checkbox" checked={selected.important} onChange={(e) => patch(selected.id, { important: e.target.checked })} />
              Ohne Filter auf der Karte zeigen
            </label>
            <div className="row" style={{ gap: 8 }}>
              <span className="tiny faint grow">
                Position {selected.x} / {selected.y}
              </span>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setPlaces((l) => l.filter((p) => p.id !== selected.id))
                  setSel(null)
                  setDirty(true)
                }}
              >
                <Trash2 size={16} /> Ort löschen
              </button>
            </div>
          </div>
        )}

        {!sel && (
          <ul className="mapedit-list">
            {places.length === 0 && <li className="small muted">Noch keine Orte. Füge Eingänge, Wasser, WCs, Sanitäter und Info hinzu.</li>}
            {places.map((p) => {
              const I = CAT_ICON[p.cat]
              return (
                <li key={p.id}>
                  <button type="button" className="tile" style={{ padding: 8, background: 'none' }} onClick={() => setSel({ kind: 'poi', id: p.id })}>
                    <span className="tile-icon" style={{ width: 30, height: 30 }}>
                      <I size={15} />
                    </span>
                    <span className="grow">
                      {p.name || 'Ohne Namen'}
                      <span className="tiny faint" style={{ display: 'block' }}>
                        {POI_CAT_LABEL[p.cat]}
                        {p.status ? ` · ${STATUS_LABEL[p.status]}` : ''}
                      </span>
                    </span>
                    <MapPin size={15} className="faint" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {err && (
          <p className="small" role="alert" style={{ color: 'var(--crit)' }}>
            {err}
          </p>
        )}
        {invalid && (
          <p className="small" role="alert" style={{ color: 'var(--warn)' }}>
            Jeder Ort braucht einen Namen.
          </p>
        )}
        <button type="button" className="btn primary block" style={{ marginTop: 12 }} disabled={busy || !dirty || !!invalid} onClick={save}>
          {busy ? 'Speichere …' : dirty ? 'Karte speichern' : 'Keine Änderungen'}
        </button>
      </div>
    </div>
  )
}
