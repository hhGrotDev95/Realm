import { ImageUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminApi } from '../api'
import { MAP, POIS, STAGES, type Poi } from '../data'
import { MAP_IMAGE_MAX, POI_CAT_LABEL, POI_CATS, type MarkerCat } from '../map'
import { CAT_ICON } from '../screens/mapIcons'

type Flash = (k: 'ok' | 'err', t: string) => void
type Marker = { id: string; kind: 'stage' | 'poi'; cat: MarkerCat | 'stage'; name: string; x: number; y: number; detail: string; status?: Poi['status']; important: boolean; color?: string }
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')
const STATUS_LABEL = { open: 'Offen', busy: 'Voll', closed: 'Geschlossen' } as const

const asDataUrl = (blob: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden'))
    r.readAsDataURL(blob)
  })

/** Ground plans are scaled to at most 2000 px and re-encoded as JPEG until they fit the limit. */
async function readPlan(file: File): Promise<{ image: string; width: number; height: number }> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error('Bitte PNG, JPEG, WebP oder SVG wählen')
  const src = await asDataUrl(file)
  const img = new Image()
  img.src = src
  await img.decode().catch(() => {
    throw new Error('Bild konnte nicht gelesen werden')
  })
  const w = img.naturalWidth || 1000
  const h = img.naturalHeight || 940
  if (file.type === 'image/svg+xml') {
    if (src.length > MAP_IMAGE_MAX) throw new Error('SVG ist zu groß (max. ca. 900 kB)')
    return { image: src, width: w, height: h }
  }
  for (const [side, quality] of [[2000, 0.85], [1600, 0.8], [1200, 0.75], [1000, 0.7]] as const) {
    const scale = Math.min(1, side / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#14171c' // transparent areas would turn black in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const image = canvas.toDataURL('image/jpeg', quality)
    if (image.length <= MAP_IMAGE_MAX) return { image, width: canvas.width, height: canvas.height }
  }
  throw new Error('Geländeplan lässt sich nicht klein genug speichern')
}

const fromData = (): Marker[] => [
  ...STAGES.map((s) => ({ id: s.id, kind: 'stage' as const, cat: 'stage' as const, name: s.name, x: s.x, y: s.y, detail: s.vibe, important: true, color: s.color })),
  ...POIS.filter((p) => p.cat !== 'stage').map((p) => ({ id: p.id, kind: 'poi' as const, cat: p.cat as MarkerCat, name: p.name, x: p.x, y: p.y, detail: p.detail, status: p.status, important: !!p.important })),
]

/**
 * Map editor: upload a ground plan, drag stages and places to where they are, add, edit and
 * remove places. Markers can also be moved with the arrow keys (Shift = larger steps).
 */
export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const initial = useMemo(fromData, [])
  const [markers, setMarkers] = useState<Marker[]>(initial)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState<MarkerCat | null>(null)
  const [busy, setBusy] = useState(false)
  const plan = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<string | null>(null)
  const { width: W, height: H } = MAP
  const dirty = JSON.stringify(markers) !== JSON.stringify(initial)
  const sel = markers.find((m) => m.id === selected) ?? null

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const patch = (id: string, p: Partial<Marker>) => setMarkers((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)))
  const clamp = (x: number, y: number) => ({ x: Math.round(Math.min(W, Math.max(0, x))), y: Math.round(Math.min(H, Math.max(0, y))) })
  const toFrame = (clientX: number, clientY: number) => {
    const r = plan.current!.getBoundingClientRect()
    return clamp(((clientX - r.left) / r.width) * W, ((clientY - r.top) / r.height) * H)
  }

  const saveMarkers = async () => {
    await admin.setMapMarkers(slug, {
      stages: markers.filter((m) => m.kind === 'stage').map(({ id, x, y }) => ({ id, x, y })),
      pois: markers.filter((m) => m.kind === 'poi').map(({ id, cat, name, x, y, detail, status, important }) => ({ id, cat: cat as MarkerCat, name, x, y, detail, status, important })),
    })
  }

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      await reload()
      flash('ok', ok)
    } catch (err) {
      flash('err', errText(err))
    }
    setBusy(false)
  }

  const addAt = (cat: MarkerCat, x: number, y: number) => {
    let n = 1
    while (markers.some((m) => m.id === `${cat}-${n}`)) n++
    const m: Marker = { id: `${cat}-${n}`, kind: 'poi', cat, name: `${POI_CAT_LABEL[cat]} ${n}`, ...clamp(x, y), detail: '', important: true }
    setMarkers((ms) => [...ms, m])
    setSelected(m.id)
    setAdding(null)
  }

  return (
    <div className="admin-grid">
      <section className="card" aria-label="Geländeplan">
        <h2 className="admin-h">Karte</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            aria-label="Geländeplan wählen"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              await run(async () => {
                const p = await readPlan(file)
                // positions are rescaled on the server, so unsaved moves go first
                if (dirty) await saveMarkers()
                await admin.setMapImage(slug, p)
              }, 'Geländeplan gespeichert – Marker wurden mit verschoben')
            }}
          />
          <button type="button" className="btn secondary sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <ImageUp size={16} /> {MAP.ground === 'image' ? 'Geländeplan ersetzen' : 'Geländeplan hochladen'}
          </button>
          {MAP.ground === 'image' && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (dirty) await saveMarkers()
                  await admin.setMapImage(slug, { image: null })
                }, 'Geländeplan entfernt')
              }
            >
              <Trash2 size={16} /> Plan entfernen
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {adding ? `Tippe auf den Plan, um „${POI_CAT_LABEL[adding]}“ zu setzen.` : 'Marker ziehen oder auswählen und mit den Pfeiltasten verschieben (Umschalt = große Schritte).'}
        </p>
        <div
          ref={plan}
          className={`plan-edit ${adding ? 'adding' : ''} ${MAP.ground === 'image' ? '' : 'plain'}`}
          style={{ aspectRatio: `${W} / ${H}`, backgroundImage: MAP.ground === 'image' ? `url("${MAP.image}")` : undefined }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return
            if (adding) {
              const p = toFrame(e.clientX, e.clientY)
              addAt(adding, p.x, p.y)
            } else setSelected(null)
          }}
          data-testid="plan"
        >
          {markers.map((m) => {
            const I = CAT_ICON[m.cat]
            return (
              <button
                key={m.kind + ':' + m.id}
                type="button"
                className={`plan-marker ${m.kind} ${selected === m.id ? 'on' : ''}`}
                style={{ left: `${(m.x / W) * 100}%`, top: `${(m.y / H) * 100}%`, ...(m.color ? { boxShadow: `0 0 0 2px ${m.color}` } : null) }}
                aria-label={`${m.name}, ${Math.round((m.x / W) * 100)} % von links, ${Math.round((m.y / H) * 100)} % von oben`}
                aria-pressed={selected === m.id}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  drag.current = m.id
                  setSelected(m.id)
                }}
                onPointerMove={(e) => {
                  if (drag.current !== m.id || !e.currentTarget.hasPointerCapture(e.pointerId)) return
                  patch(m.id, toFrame(e.clientX, e.clientY))
                }}
                onPointerUp={() => (drag.current = null)}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 25 : 5
                  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
                  if (!d) return
                  e.preventDefault()
                  patch(m.id, clamp(m.x + d[0], m.y + d[1]))
                }}
              >
                <I size={14} strokeWidth={2.4} />
                {m.kind === 'stage' && <span>{m.name}</span>}
              </button>
            )
          })}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }} role="group" aria-label="Ort hinzufügen">
          {POI_CATS.map((c) => {
            const I = CAT_ICON[c]
            return (
              <button key={c} type="button" className={`chip ${adding === c ? 'on' : ''}`} aria-pressed={adding === c} onClick={() => setAdding(adding === c ? null : c)}>
                <Plus size={13} /> <I size={14} /> {POI_CAT_LABEL[c]}
              </button>
            )
          })}
        </div>
      </section>

      <section className="card" aria-label="Marker bearbeiten">
        {sel ? (
          <MarkerForm key={sel.id} m={sel} onChange={(p) => patch(sel.id, p)} onRemove={() => (setMarkers((ms) => ms.filter((x) => x.id !== sel.id)), setSelected(null))} />
        ) : (
          <p className="small muted" style={{ marginTop: 0 }}>
            Wähle einen Marker auf dem Plan. Bühnen legst du unter „Bühnen“ an – hier bestimmst du nur, wo sie stehen.
          </p>
        )}
        <h3 className="admin-h" style={{ fontSize: 16, marginTop: 18 }}>
          Alle Orte ({markers.length})
        </h3>
        <div className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
          {markers.map((m) => {
            const I = CAT_ICON[m.cat]
            return (
              <button key={m.kind + ':' + m.id} type="button" className={`list-item ${selected === m.id ? 'admin-sel' : ''}`} onClick={() => setSelected(m.id)}>
                <I size={16} className="faint" />
                <span className="grow" style={{ textAlign: 'left' }}>
                  {m.name}
                  {!m.important && <span className="tiny faint"> · nur im Filter</span>}
                </span>
              </button>
            )
          })}
        </div>
        <button type="button" className="btn primary block" style={{ marginTop: 14 }} disabled={busy || !dirty} onClick={() => run(saveMarkers, 'Karte gespeichert')}>
          {busy ? 'Speichere …' : dirty ? 'Karte speichern' : 'Keine Änderungen'}
        </button>
      </section>
    </div>
  )
}

function MarkerForm({ m, onChange, onRemove }: { m: Marker; onChange: (p: Partial<Marker>) => void; onRemove: () => void }) {
  if (m.kind === 'stage')
    return (
      <>
        <h3 className="admin-h" style={{ fontSize: 16 }}>
          Bühne „{m.name}“
        </h3>
        <p className="small muted">Name, Farbe und Beschreibung pflegst du unter „Bühnen“. Position: ziehen oder Pfeiltasten.</p>
      </>
    )
  return (
    <>
      <h3 className="admin-h" style={{ fontSize: 16 }}>
        Ort bearbeiten
      </h3>
      <div className="admin-row">
        <label className="admin-field">
          <span>Name</span>
          <input className="field" value={m.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} aria-invalid={!m.name.trim()} />
        </label>
        <label className="admin-field">
          <span>Kategorie</span>
          <select className="field" value={m.cat} onChange={(e) => onChange({ cat: e.target.value as MarkerCat })}>
            {POI_CATS.map((c) => (
              <option key={c} value={c}>
                {POI_CAT_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="admin-field">
        <span>Beschreibung</span>
        <input className="field" value={m.detail} maxLength={120} placeholder="z. B. Trinkwasser · kostenlos" onChange={(e) => onChange({ detail: e.target.value })} />
      </label>
      <div className="admin-row">
        <label className="admin-field">
          <span>Status</span>
          <select className="field" value={m.status ?? ''} onChange={(e) => onChange({ status: (e.target.value || undefined) as Marker['status'] })}>
            <option value="">Ohne Status</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-end', minHeight: 48 }}>
          <input type="checkbox" checked={m.important} onChange={(e) => onChange({ important: e.target.checked })} />
          <span>Immer auf der Karte zeigen</span>
        </label>
      </div>
      <button type="button" className="btn danger sm" onClick={onRemove}>
        <Trash2 size={16} /> Ort entfernen
      </button>
    </>
  )
}
