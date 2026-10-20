import { Check, ImageUp, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminApi } from '../api'
import { FESTIVAL } from '../data'
import { applyTheme, DEFAULT_BRAND, FONTS, type FontKey, type Theme } from '../theme/apply'
import { checkBrand, HEX } from '../theme/contrast'

type Flash = (k: 'ok' | 'err', t: string) => void
const PRESETS = ['#a58cff', '#4fd1c5', '#ffb547', '#ff8a65', '#7be0a0', '#5ac8ff', '#f06292', '#ffffff']
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

/** Scales raster logos to at most 256 px (PNG); small SVGs are kept as they are. */
async function readLogo(file: File): Promise<string> {
  const asDataUrl = (blob: Blob) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden'))
      r.readAsDataURL(blob)
    })
  if (file.type === 'image/svg+xml') {
    if (file.size > 140_000) throw new Error('SVG ist größer als 140 kB')
    return asDataUrl(file)
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Bitte PNG, JPEG, WebP oder SVG wählen')
  const img = new Image()
  img.src = await asDataUrl(file)
  await img.decode()
  const scale = Math.min(1, 256 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export function Branding({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [theme, setTheme] = useState<Theme>(() => ({ brand: DEFAULT_BRAND, font: 'bricolage', ...FESTIVAL.theme }))
  const [hex, setHex] = useState(theme.brand ?? DEFAULT_BRAND)
  const [busy, setBusy] = useState(false)
  const preview = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const valid = HEX.test(hex)
  const check = valid ? checkBrand(hex) : null

  // the preview gets the same CSS variables the app will use
  useEffect(() => {
    if (preview.current) applyTheme({ ...theme, brand: valid ? hex : undefined }, preview.current)
  }, [theme, hex, valid])

  return (
    <div className="admin-grid">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await admin.setTheme(slug, { brand: hex.toLowerCase(), font: theme.font, logo: theme.logo })
            await reload()
            flash('ok', 'Branding gespeichert – die App zeigt es beim nächsten Öffnen')
          } catch (err) {
            flash('err', errText(err))
          }
          setBusy(false)
        }}
      >
        <h2 className="admin-h">Branding</h2>
        <fieldset className="admin-field" style={{ border: 0, padding: 0 }}>
          <span>Markenfarbe</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p}
                aria-label={`Farbe ${p}`}
                aria-pressed={hex.toLowerCase() === p}
                onClick={() => setHex(p)}
                className="swatch"
                style={{ background: p, boxShadow: hex.toLowerCase() === p ? '0 0 0 3px var(--bg-elev), 0 0 0 5px #fff' : 'inset 0 0 0 1px var(--line-strong)' }}
              />
            ))}
            <input type="color" aria-label="Eigene Farbe wählen" value={valid ? hex : DEFAULT_BRAND} onChange={(e) => setHex(e.target.value)} className="swatch" style={{ padding: 0, border: 0 }} />
            <input className="field" style={{ width: 120 }} aria-label="Farbe als Hex-Wert" value={hex} onChange={(e) => setHex(e.target.value.trim())} aria-invalid={!valid} />
          </div>
        </fieldset>
        {check && (
          <ul className="contrast-list" aria-label="Kontrastprüfung">
            {check.checks.map((c) => (
              <li key={c.label} className={c.ok ? 'ok' : 'bad'}>
                {c.ok ? <Check size={15} /> : <X size={15} />} {c.label}: <b>{c.ratio.toFixed(2)}:1</b> <span className="faint">(min. {c.min}:1)</span>
              </li>
            ))}
          </ul>
        )}
        {!valid && <p className="small" style={{ color: 'var(--crit)' }}>Farbe als #RRGGBB angeben</p>}
        {check && !check.ok && <p className="small" style={{ color: 'var(--crit)' }}>Diese Farbe ist auf dem dunklen App-Hintergrund nicht gut lesbar. Wähle eine hellere oder kräftigere Farbe.</p>}

        <label className="admin-field">
          <span>Schrift für Überschriften</span>
          <select className="field" value={theme.font ?? 'bricolage'} onChange={(e) => setTheme({ ...theme, font: e.target.value as FontKey })}>
            {Object.entries(FONTS).map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-field">
          <span>Logo (PNG, JPEG, WebP oder SVG – wird auf 256 px verkleinert)</span>
          <div className="row" style={{ gap: 8 }}>
            {theme.logo && <img src={theme.logo} alt="Aktuelles Logo" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 10, background: 'var(--surface-2)' }} />}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              aria-label="Logo-Datei wählen"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  setTheme({ ...theme, logo: await readLogo(file) })
                } catch (err) {
                  flash('err', errText(err))
                }
              }}
            />
            <button type="button" className="btn secondary sm" onClick={() => fileRef.current?.click()}>
              <ImageUp size={16} /> {theme.logo ? 'Logo ersetzen' : 'Logo hochladen'}
            </button>
            {theme.logo && (
              <button type="button" className="btn ghost sm" onClick={() => setTheme({ ...theme, logo: undefined })}>
                <Trash2 size={16} /> Entfernen
              </button>
            )}
          </div>
        </div>
        <button className="btn primary" disabled={busy || !check?.ok}>
          {busy ? 'Speichere …' : 'Branding speichern'}
        </button>
      </form>

      <section className="card" aria-label="Vorschau">
        <h2 className="admin-h">Vorschau</h2>
        <div ref={preview} className="brand-preview">
          <div className="appbar" style={{ padding: '12px 14px', background: 'none' }}>
            {theme.logo ? (
              <img className="logo logo-img" src={theme.logo} alt="" />
            ) : (
              <div className="logo" aria-hidden>
                {FESTIVAL.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="title">
              <strong>{FESTIVAL.name}</strong>
              <span>Freitag · 19:52</span>
            </div>
          </div>
          <div className="hero" style={{ margin: '0 12px 12px' }}>
            <span className="label next">Als Nächstes</span>
            <h1 style={{ fontSize: 30 }}>Headliner</h1>
            <p className="meta">Mainstage · 21:00–22:30</p>
            <div className="actions">
              <span className="btn primary sm">Route · 5 Min.</span>
              <span className="btn secondary sm">Details</span>
            </div>
          </div>
          <div className="row" style={{ gap: 8, padding: '0 12px 14px' }}>
            <span className="chip on">Mein Plan</span>
            <span className="tag official">Offiziell</span>
            <span style={{ color: 'var(--brand)', fontWeight: 600, fontSize: 14 }}>Link-Farbe</span>
          </div>
        </div>
      </section>
    </div>
  )
}
