import { ImageUp, MapPin, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { adminApi } from '../api'
import { FESTIVAL, POIS, STAGES, type Poi, type PoiCat } from '../data'
import { Ground, MAP_H, MAP_W } from '../screens/MapGround'
import { CAT_ICON } from '../screens/mapIcons'

type Flash = (k: 'ok' | 'err', t: string) => void
type Pin = { x: number; y: number }
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

export const CAT_LABEL: Record<Exclude<PoiCat, 'stage'>, string> = {
  water: 'Wasser',
  wc: 'WC',
  food: 'Essen',
  bar: 'Bar',
  medical: 'Sanitäter',
  entrance: 'Eingang',
  camping: 'Camping',
  info: 'Info',
  shuttle: 'Shuttle',
}
const SITE_MAP_MAX = 900_000
const clamp = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)))

/** Scales a photo or scan of the site plan to at most 1600 px and re-encodes it as JPEG. */
async function readSiteMap(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Bitte PNG, JPEG oder WebP wählen')
  const img = new Image()
  img.src = URL.createObjectURL(file)
  try {
    await img.decode()
  } finally {
    URL.revokeObjectURL(img.src)
  }
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#14171c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  for (const q of [0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', q)
    if (url.length <= SITE_MAP_MAX) return url
  }
  throw new Error('Geländeplan ist auch komprimiert zu groß')
}

/**
 * Map editor: upload the site plan, drag stages and points into place, add points with a
 * click on the map. Arrow keys move the selected pin (Shift = larger steps).
 */
export function MapEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [siteMap, setSiteMap] = useState<string | null>(FESTIVAL.siteMap)
  const [stages, setStages] = useState<Record<string, Pin>>(() => Object.fromEntries(STAGES.map((s) => [s.id, { x: s.x, y: s.y }])))
  const [pois, setPois] = useState<Poi[]>(() => POIS.filter((p) => p.cat !== 'stage').map((p) => ({ ...p })))
  const [sel, setSel] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)

  const toMap = (e: { clientX: number; clientY: number }): Pin => {
    const r = svg.current!.getBoundingClientRect()
    return { x: clamp(((e.clientX - r.left) / r.width) * MAP_W, MAP_W), y: clamp(((e.clientY - r.top) / r.height) * MAP_H, MAP_H) }
  }
  const pos = (id: string): Pin | undefined => (id.startsWith('stage:') ? stages[id.slice(6)] : pois.find((p) => p.id === id))
  const move = (id: string, p: Pin) => {
    setDirty(true)
    if (id.startsWith('stage:')) setStages((s) => ({ ...s, [id.slice(6)]: p }))
    else setPois((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)))
  }
  const patch = (id: string, change: Partial<Poi>) => {
    setDirty(true)
    setPois((list) => list.map((x) => (x.id === id ? { ...x, ...change } : x)))
  }
  const add = (p: Pin) => {
    let n = pois.length + 1
    while (pois.some((x) => x.id === `p${n}`)) n++
    const poi: Poi = { id: `p${n}`, cat: 'info', name: 'Neuer Punkt', detail: '', x: p.x, y: p.y }
    setPois((list) => [...list, poi])
    setSel(poi.id)
    setDirty(true)
  }
  const selected = sel && !sel.startsWith('stage:') ? pois.find((p) => p.id === sel) : undefined
  const selectedStage = sel?.startsWith('stage:') ? STAGES.find((s) => s.id === sel.slice(6)) : undefined
  const invalid = pois.find((p) => !p.name.trim())

  const save = async () => {
    setBusy(true)
    try {
      await admin.saveMap(slug, {
        siteMap: siteMap === FESTIVAL.siteMap ? undefined : siteMap,
        stages: Object.entries(stages).map(([id, p]) => ({ id, ...p })),
        pois: pois.map(({ confirmedMin: _c, ...p }) => ({ ...p, name: p.name.trim(), detail: p.detail.trim() })),
      })
      setDirty(false)
      flash('ok', 'Karte gespeichert')
      await reload()
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }

  const pinProps = (id: string, label: string) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': `${label} – mit Pfeiltasten verschieben`,
    'aria-pressed': sel === id,
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation()
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      drag.current = { id, moved: false }
      setSel(id)
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      const p = pos(id)
      if (!d || !p) return
      e.preventDefault()
      const step = e.shiftKey ? 25 : 5
      move(id, { x: clamp(p.x + d[0] * step, MAP_W), y: clamp(p.y + d[1] * step, MAP_H) })
    },
    onFocus: () => setSel(id),
  })

  return (
    <div className="admin-grid map-editor">
      <div className="card">
        <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 className="admin-h grow" style={{ margin: 0 }}>
            Geländekarte
          </h2>
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
                setSiteMap(await readSiteMap(f))
                setDirty(true)
              } catch (err) {
                flash('err', errText(err))
              }
            }}
          />
          <button type="button" className="btn secondary sm" onClick={() => fileRef.current?.click()}>
            <ImageUp size={16} /> {siteMap ? 'Plan ersetzen' : 'Geländeplan hochladen'}
          </button>
          {siteMap && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setSiteMap(null)
                setDirty(true)
              }}
            >
              <X size={16} /> Plan entfernen
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Punkte ziehen zum Verschieben, auf eine freie Stelle klicken für einen neuen Punkt.
        </p>
        <svg
          ref={svg}
          className="map-editor-canvas"
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          onPointerMove={(e) => {
            if (!drag.current) return
            drag.current.moved = true
            move(drag.current.id, toMap(e))
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onClick={(e) => {
            if (e.target === e.currentTarget || (e.target as Element).closest('[data-ground]')) add(toMap(e))
          }}
          aria-label="Karte bearbeiten"
        >
          <g data-ground>
            <Ground satellite={false} siteMap={siteMap} />
          </g>
          {STAGES.map((s) => {
            const p = stages[s.id]
            const id = 'stage:' + s.id
            return (
              <g key={id} transform={`translate(${p.x} ${p.y})`} className={'ed-pin' + (sel === id ? ' on' : '')} {...pinProps(id, `Bühne ${s.name}`)}>
                <circle r="20" fill={s.color} stroke="#0d0f12" strokeWidth="4" />
                <text y="44" textAnchor="middle" className="ed-label">
                  {s.name}
                </text>
              </g>
            )
          })}
          {pois.map((p) => {
            const I = CAT_ICON[p.cat] ?? MapPin
            return (
              <g key={p.id} transform={`translate(${p.x} ${p.y})`} className={'ed-pin' + (sel === p.id ? ' on' : '')} {...pinProps(p.id, p.name || 'Punkt ohne Namen')}>
                <circle r="16" fill="#e9ecf1" stroke="#0d0f12" strokeWidth="4" />
                <I x={-9} y={-9} width={18} height={18} color="#111" />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="card">
        {selectedStage && (
          <>
            <h2 className="admin-h">Bühne {selectedStage.name}</h2>
            <p className="small muted">
              Position {stages[selectedStage.id].x} / {stages[selectedStage.id].y}. Name und Farbe änderst du unter „Bühnen“.
            </p>
          </>
        )}
        {selected && (
          <>
            <h2 className="admin-h">Punkt bearbeiten</h2>
            <label className="admin-field">
              <span>Name</span>
              <input className="field" value={selected.name} maxLength={40} onChange={(e) => patch(selected.id, { name: e.target.value })} />
            </label>
            <div className="admin-row">
              <label className="admin-field">
                <span>Kategorie</span>
                <select className="field" value={selected.cat} onChange={(e) => patch(selected.id, { cat: e.target.value as PoiCat })}>
                  {Object.entries(CAT_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-field">
                <span>Status</span>
                <select className="field" value={selected.status ?? ''} onChange={(e) => patch(selected.id, { status: (e.target.value || undefined) as Poi['status'] })}>
                  <option value="">ohne</option>
                  <option value="open">offen</option>
                  <option value="busy">voll</option>
                  <option value="closed">geschlossen</option>
                </select>
              </label>
            </div>
            <label className="admin-field">
              <span>Beschreibung</span>
              <input className="field" value={selected.detail} maxLength={80} onChange={(e) => patch(selected.id, { detail: e.target.value })} />
            </label>
            <label className="row small" style={{ gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={!!selected.important} onChange={(e) => patch(selected.id, { important: e.target.checked })} />
              Wichtig (auch herausgezoomt sichtbar)
            </label>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setPois((list) => list.filter((x) => x.id !== selected.id))
                setSel(null)
                setDirty(true)
              }}
            >
              <Trash2 size={16} /> Punkt löschen
            </button>
          </>
        )}
        {!sel && (
          <>
            <h2 className="admin-h">Punkte</h2>
            <p className="small muted">
              {STAGES.length} Bühnen · {pois.length} Punkte. Wähle einen Punkt auf der Karte aus oder setze einen neuen.
            </p>
            <button type="button" className="btn secondary sm" onClick={() => add({ x: MAP_W / 2, y: MAP_H / 2 })}>
              <Plus size={16} /> Punkt in der Mitte setzen
            </button>
          </>
        )}
        <hr className="admin-sep" />
        {invalid && (
          <p className="small" role="alert" style={{ color: 'var(--crit)' }}>
            Jeder Punkt braucht einen Namen.
          </p>
        )}
        <div className="row" style={{ gap: 8 }}>
          {sel && (
            <button type="button" className="btn ghost" onClick={() => setSel(null)}>
              Auswahl aufheben
            </button>
          )}
          <button type="button" className="btn primary grow" disabled={!dirty || busy || !!invalid} onClick={save}>
            {busy ? 'Speichere …' : dirty ? 'Karte speichern' : 'Gespeichert'}
          </button>
        </div>
      </div>
    </div>
  )
}
