import { ImageUp, MapPin, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminApi, type PoiInput } from '../api'
import { MAP, POIS, stageById, type Poi, type PoiCat } from '../data'
import { clampPos, heightFor, MAP_IMAGE_MAX, POI_CATS } from '../map/geo'
import { Ground } from '../screens/Ground'
import { CAT_ICON } from '../screens/mapIcons'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

const CAT_LABEL: Record<PoiCat, string> = {
  stage: 'Bühne',
  water: 'Wasser',
  wc: 'WC',
  food: 'Essen',
  medical: 'Sanität',
  bar: 'Bar',
  entrance: 'Eingang',
  camping: 'Camping',
  info: 'Info',
  shuttle: 'Shuttle',
}
const PLACE_CATS = POI_CATS.filter((c) => c !== 'stage')
const STATUS_LABEL = { '': 'Kein Status', open: 'Offen', busy: 'Voll / lange Schlange', closed: 'Geschlossen' } as const

const asDataUrl = (blob: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden'))
    r.readAsDataURL(blob)
  })

/**
 * Reads a site plan. Raster images are scaled to at most 2400 px and re-encoded (WebP, else JPEG)
 * with falling quality until they fit the server limit; SVGs are kept as they are.
 */
export async function readPlan(file: File): Promise<{ image: string; height: number }> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error('Bitte PNG, JPEG, WebP oder SVG wählen')
  const img = new Image()
  img.src = await asDataUrl(file)
  await img.decode().catch(() => {
    throw new Error('Bild konnte nicht geöffnet werden')
  })
  const w = img.naturalWidth || 1000
  const h = img.naturalHeight || 940
  if (file.type === 'image/svg+xml') {
    if (img.src.length > MAP_IMAGE_MAX) throw new Error('SVG ist zu groß (max. ca. 750 kB)')
    return { image: img.src, height: heightFor(w, h) }
  }
  for (const side of [2400, 1800, 1400]) {
    const scale = Math.min(1, side / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#14171c' // transparent areas would turn black in JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const q of [0.85, 0.72, 0.6]) {
      let url = canvas.toDataURL('image/webp', q)
      if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', q)
      if (url.length <= MAP_IMAGE_MAX) return { image: url, height: heightFor(w, h) }
    }
  }
  throw new Error('Geländeplan lässt sich nicht klein genug speichern – bitte ein kleineres Bild wählen')
}

type Selection = { kind: 'poi'; id: string } | { kind: 'new'; x: number; y: number } | null
type Draft = { cat: PoiCat; name: string; detail: string; status: '' | NonNullable<Poi['status']>; important: boolean; x: string; y: string }

const draftOf = (p: Pick<Poi, 'cat' | 'name' | 'detail' | 'status' | 'important' | 'x' | 'y'>): Draft => ({
  cat: p.cat,
  name: p.name,
  detail: p.detail,
  status: p.status ?? '',
  important: !!p.important,
  x: String(Math.round(p.x)),
  y: String(Math.round(p.y)),
})

/** Places markers on the festival's own site plan: click to add, drag to move, edit on the side. */
export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [pois, setPois] = useState<Poi[]>(() => POIS.map((p) => ({ ...p })))
  const [sel, setSel] = useState<Selection>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [width, setWidth] = useState(600)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { w: W, h: H } = MAP
  const k = width / W

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 600))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const selected = sel?.kind === 'poi' ? pois.find((p) => p.id === sel.id) : undefined
  const isStage = selected?.cat === 'stage'
  const select = (s: Selection) => {
    setSel(s)
    if (!s) return setDraft(null)
    if (s.kind === 'new') return setDraft({ cat: 'water', name: '', detail: '', status: '', important: true, x: String(s.x), y: String(s.y) })
    const p = pois.find((x) => x.id === s.id)
    setDraft(p ? draftOf(p) : null)
  }

  const toMap = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect()
    return clampPos((clientX - r.left) / k, (clientY - r.top) / k, H)
  }

  /** Saves a marker's position (stages through their own route). */
  const savePosition = async (p: Poi, pos: { x: number; y: number }) => {
    const before = pois
    setPois((list) => list.map((x) => (x.id === p.id ? { ...x, ...pos } : x)))
    if (sel?.kind === 'poi' && sel.id === p.id) setDraft((d) => d && { ...d, x: String(pos.x), y: String(pos.y) })
    try {
      if (p.cat === 'stage') {
        await admin.moveStage(slug, p.id.replace(/^stage-/, ''), pos)
        const st = stageById[p.id.replace(/^stage-/, '')]
        if (st) Object.assign(st, pos)
      } else await admin.updatePoi(slug, p.id, { cat: p.cat, name: p.name, detail: p.detail, status: p.status, important: !!p.important, ...pos })
      const live = POIS.find((x) => x.id === p.id)
      if (live) Object.assign(live, pos)
    } catch (e) {
      setPois(before)
      flash('err', errText(e))
    }
  }

  const x = Number(draft?.x)
  const y = Number(draft?.y)
  const posValid = draft !== null && /^\d+$/.test(draft.x) && /^\d+$/.test(draft.y) && x <= W && y <= H
  const valid = draft !== null && posValid && (isStage || draft.name.trim().length > 0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft || !valid) return
    setBusy(true)
    try {
      if (isStage && selected) {
        await savePosition(selected, { x, y })
      } else {
        const input: PoiInput = { cat: draft.cat, name: draft.name.trim(), detail: draft.detail.trim(), status: draft.status || undefined, important: draft.important, x, y }
        if (sel?.kind === 'new') {
          const created = await admin.createPoi(slug, input)
          setPois((list) => [...list, created])
          POIS.push({ ...created })
          select(null)
          flash('ok', `„${created.name}“ steht jetzt auf der Karte`)
        } else if (selected) {
          const saved = await admin.updatePoi(slug, selected.id, input)
          setPois((list) => list.map((p) => (p.id === saved.id ? saved : p)))
          const live = POIS.find((p) => p.id === saved.id)
          if (live) Object.assign(live, saved)
          flash('ok', 'Ort gespeichert')
        }
      }
    } catch (err) {
      flash('err', errText(err))
    }
    setBusy(false)
  }

  const remove = async () => {
    if (!selected || isStage || !confirm(`„${selected.name}“ von der Karte entfernen?`)) return
    try {
      await admin.deletePoi(slug, selected.id)
      setPois((list) => list.filter((p) => p.id !== selected.id))
      POIS.splice(POIS.findIndex((p) => p.id === selected.id), 1)
      select(null)
      flash('ok', 'Ort entfernt')
    } catch (e) {
      flash('err', errText(e))
    }
  }

  const uploadPlan = async (file: File) => {
    setBusy(true)
    try {
      const plan = await readPlan(file)
      await admin.setMap(slug, plan)
      await reload()
      flash('ok', 'Geländeplan gespeichert – Marker behalten ihre relative Position')
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }

  const removePlan = async () => {
    if (!confirm('Eigenen Geländeplan entfernen? Die App zeigt dann wieder die Beispielgrafik.')) return
    setBusy(true)
    try {
      await admin.setMap(slug, { image: null })
      await reload()
      flash('ok', 'Geländeplan entfernt')
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }

  return (
    <div className="admin-grid">
      <section className="card" aria-label="Karte bearbeiten">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <h2 className="admin-h grow" style={{ margin: 0 }}>
            Karte
          </h2>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            aria-label="Geländeplan wählen"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) uploadPlan(file)
            }}
          />
          <button type="button" className="btn secondary sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <ImageUp size={16} /> {MAP.image ? 'Plan ersetzen' : 'Geländeplan hochladen'}
          </button>
          {MAP.image && (
            <button type="button" className="btn ghost sm" disabled={busy} onClick={removePlan}>
              <Trash2 size={16} /> Plan entfernen
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {MAP.image ? 'Klicke auf eine freie Stelle, um einen Ort anzulegen. Marker lassen sich verschieben.' : 'Noch kein eigener Plan – die App zeigt eine Beispielgrafik. Lade euren Geländeplan hoch (PNG, JPEG, WebP oder SVG).'}
        </p>
        <div
          ref={box}
          className="map-editor"
          style={{ height: H * k }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return
            select({ kind: 'new', ...toMap(e.clientX, e.clientY) })
          }}
        >
          <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${k})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
            {MAP.image ? <img src={MAP.image} alt="" width={W} height={H} draggable={false} style={{ display: 'block', width: W, height: H }} /> : <Ground satellite={false} />}
          </div>
          {pois.map((p) => {
            const I = CAT_ICON[p.cat] ?? MapPin
            const pos = drag?.id === p.id ? drag : p
            const on = sel?.kind === 'poi' && sel.id === p.id
            const stage = p.cat === 'stage' ? stageById[p.id.replace(/^stage-/, '')] : undefined
            return (
              <button
                key={p.id}
                type="button"
                className={`map-editor-pin ${on ? 'on' : ''} ${stage ? 'stage' : ''}`}
                style={{ left: pos.x * k, top: pos.y * k, ...(stage ? { boxShadow: `0 0 0 2px ${stage.color}` } : {}) }}
                aria-label={`${p.name} (${CAT_LABEL[p.cat]}) – zum Bearbeiten wählen`}
                aria-pressed={on}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setDrag({ id: p.id, x: p.x, y: p.y, moved: false })
                }}
                onPointerMove={(e) => {
                  if (drag?.id !== p.id) return
                  const next = toMap(e.clientX, e.clientY)
                  if (drag.moved || Math.hypot(next.x - p.x, next.y - p.y) * k > 4) setDrag({ id: p.id, ...next, moved: true })
                }}
                onPointerUp={() => {
                  if (drag?.id !== p.id) return
                  setDrag(null)
                  if (drag.moved) savePosition(p, { x: drag.x, y: drag.y })
                  else select({ kind: 'poi', id: p.id })
                }}
                onPointerCancel={() => setDrag(null)}
                onClick={(e) => {
                  // keyboard activation (pointer clicks are handled on pointer up)
                  if (e.detail === 0) select({ kind: 'poi', id: p.id })
                }}
              >
                <I size={14} strokeWidth={2.4} />
                {stage && <span>{p.name}</span>}
              </button>
            )
          })}
          {sel?.kind === 'new' && (
            <span className="map-editor-pin new" style={{ left: sel.x * k, top: sel.y * k }} aria-hidden>
              <Plus size={14} />
            </span>
          )}
        </div>
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          {pois.length} Orte · Positionen in Karteneinheiten (Breite {W}, Höhe {H})
        </p>
      </section>

      <section className="card" aria-label="Ort bearbeiten">
        {!draft ? (
          <>
            <h2 className="admin-h">Orte</h2>
            <p className="small muted">Wähle einen Marker auf der Karte oder in der Liste – oder klicke auf eine freie Stelle für einen neuen Ort.</p>
            <div className="list">
              {pois.map((p) => {
                const I = CAT_ICON[p.cat] ?? MapPin
                return (
                  <button key={p.id} type="button" className="list-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => select({ kind: 'poi', id: p.id })}>
                    <I size={17} className="faint" />
                    <span className="grow">
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span className="tiny faint" style={{ display: 'block' }}>
                        {CAT_LABEL[p.cat]}
                        {p.detail ? ` · ${p.detail}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="row" style={{ gap: 8 }}>
              <h2 className="admin-h grow" style={{ margin: 0 }}>
                {sel?.kind === 'new' ? 'Neuer Ort' : isStage ? `Bühne ${selected?.name}` : 'Ort bearbeiten'}
              </h2>
              <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => select(null)}>
                <X size={18} />
              </button>
            </div>
            {isStage ? (
              <p className="small muted">Name, Farbe und Beschreibung der Bühne pflegst du unter „Bühnen“. Hier legst du nur fest, wo sie auf der Karte steht.</p>
            ) : (
              <>
                <label className="admin-field" style={{ marginTop: 12 }}>
                  <span>Name</span>
                  <input className="field" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Wasserstelle Nord" autoFocus />
                </label>
                <label className="admin-field">
                  <span>Kategorie</span>
                  <select className="field" value={draft.cat} onChange={(e) => setDraft({ ...draft, cat: e.target.value as PoiCat })}>
                    {PLACE_CATS.map((c) => (
                      <option key={c} value={c}>
                        {CAT_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Beschreibung (optional)</span>
                  <input className="field" value={draft.detail} maxLength={120} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} placeholder="z. B. Trinkwasser · kostenlos" />
                </label>
                <label className="admin-field">
                  <span>Status</span>
                  <select className="field" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft['status'] })}>
                    {Object.entries(STATUS_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row" style={{ gap: 8, marginBottom: 14, fontSize: 14 }}>
                  <input type="checkbox" checked={draft.important} onChange={(e) => setDraft({ ...draft, important: e.target.checked })} />
                  Immer auf der Karte zeigen (sonst nur im passenden Filter)
                </label>
              </>
            )}
            <div className="admin-row">
              <label className="admin-field">
                <span>X (0–{W})</span>
                <input className="field" inputMode="numeric" value={draft.x} onChange={(e) => setDraft({ ...draft, x: e.target.value.replace(/\D/g, '') })} aria-invalid={!posValid} />
              </label>
              <label className="admin-field">
                <span>Y (0–{H})</span>
                <input className="field" inputMode="numeric" value={draft.y} onChange={(e) => setDraft({ ...draft, y: e.target.value.replace(/\D/g, '') })} aria-invalid={!posValid} />
              </label>
            </div>
            {!posValid && <p className="small" style={{ color: 'var(--crit)', marginTop: 0 }}>Position liegt außerhalb der Karte</p>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary grow" disabled={busy || !valid}>
                {busy ? 'Speichere …' : sel?.kind === 'new' ? 'Ort anlegen' : 'Speichern'}
              </button>
              {selected && !isStage && (
                <button type="button" className="btn ghost" onClick={remove}>
                  <Trash2 size={16} /> Entfernen
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
