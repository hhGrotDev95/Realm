import { Archive, Check, Eye, FileUp, Plus, RotateCcw, Rocket, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminApi, type Readiness, ApiError, type ImportResult } from '../api'
import { ACTS, DAYS, FESTIVAL, STAGES, fmt } from '../data'
import { parseCsv, parseFile, parseTable, type ParseResult } from '../import/parse'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')
const PALETTE = ['#FF6B5A', '#5AC8FF', '#FFC94D', '#7BE0A0', '#E07BFF', '#4FD1C5', '#F6AD55', '#A58CFF']
const SETUP_KEY = 'realm.admin.setup'

/** Wizard progress per festival, so a half-finished setup can be resumed later. */
export function setupStep(slug: string): number {
  try {
    return (JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') as Record<string, number>)[slug] ?? 1
  } catch {
    return 1
  }
}
function saveStep(slug: string, step: number) {
  try {
    const all = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') as Record<string, number>
    localStorage.setItem(SETUP_KEY, JSON.stringify({ ...all, [slug]: step }))
  } catch {}
}

const STEPS = ['Grunddaten', 'Bühnen', 'Timetable', 'Prüfen & veröffentlichen']

function Steps({ step }: { step: number }) {
  return (
    <ol className="wizard-steps" aria-label="Fortschritt">
      {STEPS.map((s, i) => (
        <li key={s} className={i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''} aria-current={i + 1 === step ? 'step' : undefined}>
          <span>{i + 1 < step ? <Check size={14} /> : i + 1}</span> {s}
        </li>
      ))}
    </ol>
  )
}

/** Step 1 – creates the festival as a draft. */
export function CreateFestival({ token, flash, onCreated, onCancel }: { token: string; flash: Flash; onCreated: (slug: string) => void; onCancel: () => void }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [f, setF] = useState({ name: '', slug: '', location: '', startDate: '', days: '3' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const autoSlug = f.name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const slug = slugTouched ? f.slug : autoSlug
  const problems = [
    f.name.trim().length < 2 && 'Name fehlt',
    !/^[a-z0-9-]{2,40}$/.test(slug) && 'Kurzname: 2–40 Zeichen a–z, 0–9, -',
    !/^\d{4}-\d{2}-\d{2}$/.test(f.startDate) && 'Startdatum fehlt',
    !(Number(f.days) >= 1 && Number(f.days) <= 14) && 'Dauer: 1–14 Tage',
  ].filter(Boolean) as string[]
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          const created = await admin.createFestival({ name: f.name.trim(), slug, location: f.location.trim() || undefined, startDate: f.startDate, days: Number(f.days) })
          saveStep(created.slug, 2)
          flash('ok', `„${created.name}“ als Entwurf angelegt`)
          onCreated(created.slug)
        } catch (err) {
          flash('err', errText(err))
        }
        setBusy(false)
      }}
    >
      <Steps step={1} />
      <h2 className="admin-h">Neues Festival</h2>
      <div className="admin-row">
        <label className="admin-field">
          <span>Name</span>
          <input className="field" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="z. B. Sommerwiese Open Air" />
        </label>
        <label className="admin-field">
          <span>Kurzname (Adresse: ?f=…)</span>
          <input
            className="field"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setF({ ...f, slug: e.target.value.toLowerCase() })
            }}
          />
        </label>
      </div>
      <div className="admin-row">
        <label className="admin-field">
          <span>Ort (optional)</span>
          <input className="field" value={f.location} maxLength={80} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </label>
        <label className="admin-field">
          <span>Erster Tag</span>
          <input className="field" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </label>
        <label className="admin-field" style={{ maxWidth: 140 }}>
          <span>Tage</span>
          <input className="field" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, '') })} />
        </label>
      </div>
      {problems.length > 0 && f.name && <p className="small faint">Noch offen: {problems.join(' · ')}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={busy || problems.length > 0}>
          {busy ? 'Lege an …' : 'Als Entwurf anlegen'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
      <p className="tiny faint" style={{ marginTop: 12 }}>
        Entwürfe sind nur in dieser Konsole und in der Vorschau sichtbar. Du kannst jederzeit abbrechen und später weitermachen.
      </p>
    </form>
  )
}

/** Steps 2–4 for an existing draft (resumable). */
export function SetupWizard({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const [step, setStepRaw] = useState(() => Math.max(2, setupStep(slug)))
  const setStep = (n: number) => {
    saveStep(slug, n)
    setStepRaw(n)
  }
  return (
    <div className="card">
      <Steps step={step} />
      {step === 2 && <StagesEditor token={token} flash={flash} slug={slug} reload={reload} onDone={() => setStep(3)} />}
      {step === 3 && (
        <>
          <ImportPanel token={token} flash={flash} slug={slug} reload={reload} />
          <div className="row" style={{ gap: 8, marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setStep(2)}>
              Zurück
            </button>
            <button className="btn primary" disabled={!ACTS.length} onClick={() => setStep(4)}>
              Weiter{ACTS.length ? ` (${ACTS.length} Acts)` : ''}
            </button>
          </div>
        </>
      )}
      {step === 4 && (
        <>
          <Settings token={token} flash={flash} slug={slug} reload={reload} />
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={() => setStep(3)}>
            Zurück zum Timetable
          </button>
        </>
      )}
    </div>
  )
}

export function StagesEditor({ token, flash, slug, reload, onDone }: { token: string; flash: Flash; slug: string; reload: () => Promise<void>; onDone?: () => void }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [rows, setRows] = useState(() => (STAGES.length ? STAGES.map((s) => ({ id: s.id as string | undefined, name: s.name, color: s.color })) : [{ id: undefined, name: '', color: PALETTE[0] }]))
  const [busy, setBusy] = useState(false)
  const valid = rows.length > 0 && rows.every((r) => r.name.trim()) && new Set(rows.map((r) => r.name.trim().toLowerCase())).size === rows.length
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await admin.setStages(slug, rows.map((r) => ({ id: r.id, name: r.name.trim(), color: r.color })))
          await reload()
          flash('ok', 'Bühnen gespeichert')
          onDone?.()
        } catch (err) {
          flash('err', errText(err))
        }
        setBusy(false)
      }}
    >
      <h2 className="admin-h">Bühnen</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Bühnen, die beim Import neu auftauchen, werden automatisch angelegt. Bühnen mit Acts lassen sich nicht löschen.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ gap: 8, marginBottom: 8 }}>
          <input type="color" aria-label={`Farbe Bühne ${i + 1}`} value={r.color} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} style={{ width: 44, height: 44, border: 0, background: 'none', padding: 0 }} />
          <input className="field" aria-label={`Name Bühne ${i + 1}`} value={r.name} maxLength={40} placeholder="z. B. Mainstage" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <button type="button" className="icon-btn" aria-label={`Bühne ${i + 1} entfernen`} onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1}>
            <Trash2 size={18} />
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button type="button" className="btn secondary sm" onClick={() => setRows([...rows, { id: undefined, name: '', color: PALETTE[rows.length % PALETTE.length] }])}>
          <Plus size={16} /> Bühne
        </button>
        <span className="grow" />
        <button className="btn primary" disabled={busy || !valid}>
          {onDone ? 'Speichern & weiter' : 'Speichern'}
        </button>
      </div>
    </form>
  )
}

const MODE_LABEL = { merge: 'Zusammenführen', replace: 'Ersetzen' }

export function ImportPanel({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [parsed, setParsed] = useState<(ParseResult & { source: string }) | null>(null)
  const [paste, setPaste] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [check, setCheck] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [snapshots, setSnapshots] = useState<{ id: string; createdAt: number; note: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const days = DAYS.map((d) => ({ idx: d.idx, date: d.date, label: d.label }))
  const loadSnapshots = () => admin.snapshots(slug).then(setSnapshots, () => {})
  useEffect(() => {
    loadSnapshots()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const runCheck = async (p: ParseResult, m = mode) => {
    setCheck(null)
    if (!p.rows.length) return
    try {
      setCheck(await admin.importTimetable(slug, { mode: m, dryRun: true, rows: p.rows }))
    } catch (e) {
      if (e instanceof ApiError && e.data && typeof e.data === 'object' && 'summary' in e.data) setCheck(e.data as ImportResult)
      else flash('err', errText(e))
    }
  }
  const take = async (p: ParseResult, source: string) => {
    setParsed({ ...p, source })
    await runCheck(p)
  }
  const issues = [...(parsed?.errors ?? []).map((i) => ({ ...i, kind: 'err' as const })), ...(check?.errors ?? []).map((i) => ({ ...i, kind: 'err' as const })), ...(parsed?.warnings ?? []).map((i) => ({ ...i, kind: 'warn' as const })), ...(check?.warnings ?? []).map((i) => ({ ...i, kind: 'warn' as const }))].sort((a, b) => a.row - b.row)
  const blocking = issues.some((i) => i.kind === 'err')

  return (
    <div>
      <h2 className="admin-h">Timetable importieren</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        JSON, CSV oder Excel (.xlsx) mit Spalten wie <b>Act/Artist</b>, <b>Bühne/Stage</b>, <b>Tag/Day</b> oder <b>Datum/Date</b>, <b>Beginn/Start</b>, <b>Ende/End</b>, optional <b>Genre</b>, <b>Beschreibung</b>, <b>ID</b>. Nachtzeiten wie 24:30 oder 01:30 zählen zur Nacht davor. Ohne ID bleibt jeder Act über „Tag + Name“ stabil – Favoriten überleben einen Neuimport.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,.tsv,.txt,.xlsx"
          aria-label="Timetable-Datei wählen"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setBusy(true)
            await take(await parseFile(file, days), file.name)
            setBusy(false)
            e.target.value = ''
          }}
        />
        <button className="btn secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileUp size={17} /> Datei wählen
        </button>
        <span className="small faint">oder Tabelle unten einfügen</span>
      </div>
      <textarea className="field" style={{ height: 110, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} aria-label="Timetable als CSV einfügen" placeholder={'Act;Bühne;Tag;Beginn;Ende\nMorgentau;Wiese;1;20:00;21:00'} value={paste} onChange={(e) => setPaste(e.target.value)} />
      <button className="btn secondary sm" style={{ marginTop: 8 }} disabled={!paste.trim() || busy} onClick={() => take(parseTable(parseCsv(paste), days), 'Einfügen')}>
        Eingefügten Text prüfen
      </button>

      {parsed && (
        <section className="import-result" aria-live="polite">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong className="grow">
              {parsed.source}: {parsed.rows.length} Acts erkannt
            </strong>
            <div className="chips" role="radiogroup" aria-label="Importmodus">
              {(['merge', 'replace'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={mode === m}
                  className={`chip ${mode === m ? 'on' : ''}`}
                  onClick={() => {
                    setMode(m)
                    runCheck(parsed, m)
                  }}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <p className="tiny faint">{mode === 'merge' ? 'Neue Acts kommen dazu, vorhandene werden aktualisiert, nichts wird gelöscht.' : 'Acts, die nicht in der Datei stehen, werden entfernt. Vorher wird automatisch ein Snapshot gespeichert.'}</p>
          {check && (
            <div className="import-summary">
              {(
                [
                  ['neu', check.summary.created],
                  ['geändert', check.summary.updated],
                  ['unverändert', check.summary.unchanged],
                  ['entfernt', check.summary.removed],
                  ['neue Bühnen', check.summary.stagesCreated],
                ] as const
              ).map(([l, n]) => (
                <div key={l} className="stat">
                  <b>{n}</b>
                  <span className="tiny faint">{l}</span>
                </div>
              ))}
            </div>
          )}
          {issues.length > 0 && (
            <ul className="import-issues">
              {issues.map((i, k) => (
                <li key={k} className={i.kind}>
                  <span className={`tag ${i.kind === 'err' ? 'crit' : 'warn'}`}>Zeile {i.row}</span> {i.message}
                </li>
              ))}
            </ul>
          )}
          {parsed.rows.length > 0 && (
            <table className="import-preview">
              <caption className="sr-only">Vorschau der ersten Acts</caption>
              <thead>
                <tr>
                  <th>Zeile</th>
                  <th>Act</th>
                  <th>Bühne</th>
                  <th>Tag</th>
                  <th>Zeit</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 8).map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.artist}</td>
                    <td>{r.stage}</td>
                    <td>{DAYS[r.day]?.short}</td>
                    <td>
                      {fmt(r.start)}–{fmt(r.end)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            className="btn primary"
            style={{ marginTop: 12 }}
            disabled={busy || blocking || !parsed.rows.length || !check}
            onClick={async () => {
              if (mode === 'replace' && check && check.summary.removed > 0 && !confirm(`${check.summary.removed} Acts werden entfernt. Ein Snapshot wird vorher gespeichert. Fortfahren?`)) return
              setBusy(true)
              try {
                const res = await admin.importTimetable(slug, { mode, dryRun: false, rows: parsed.rows })
                await reload()
                flash('ok', `Importiert: ${res.summary.created} neu, ${res.summary.updated} geändert${res.summary.removed ? `, ${res.summary.removed} entfernt` : ''}`)
                setParsed(null)
                setCheck(null)
                setPaste('')
                loadSnapshots()
              } catch (e) {
                if (e instanceof ApiError && e.data && typeof e.data === 'object' && 'summary' in e.data) setCheck(e.data as ImportResult)
                flash('err', errText(e))
              }
              setBusy(false)
            }}
          >
            <Upload size={17} /> {blocking ? 'Erst Fehler beheben' : `${MODE_LABEL[mode]} – importieren`}
          </button>
        </section>
      )}

      {snapshots.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h3 className="label" style={{ marginBottom: 6 }}>
            Snapshots vor „Ersetzen“
          </h3>
          <div className="list">
            {snapshots.map((s) => (
              <div key={s.id} className="list-item">
                <span className="grow small">
                  {new Date(s.createdAt).toLocaleString('de-DE')} · {s.note}
                </span>
                <button
                  className="btn ghost sm"
                  onClick={async () => {
                    if (!confirm('Timetable auf diesen Stand zurücksetzen? Danach importierte Acts gehen verloren.')) return
                    try {
                      const r = await admin.restoreSnapshot(slug, s.id)
                      await reload()
                      flash('ok', `${r.restored} Acts wiederhergestellt`)
                    } catch (e) {
                      flash('err', errText(e))
                    }
                  }}
                >
                  <RotateCcw size={15} /> Wiederherstellen
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

const STATUS_TEXT: Record<string, string> = {
  draft: 'Entwurf – nur in Konsole und Vorschau sichtbar',
  published: 'Veröffentlicht – für alle sichtbar',
  archived: 'Archiviert – sichtbar, aber schreibgeschützt',
}

/**
 * Going live (audit D10): the server's checklist – data that must exist for what is switched on, and the
 * confirmations only the organizer can give. Publishing stays locked until every line is ticked.
 */
export function Settings({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [status, setStatus] = useState(FESTIVAL.status)
  const [busy, setBusy] = useState(false)
  const [checks, setChecks] = useState<Readiness[] | null>(null)
  const [confirmed, setConfirmed] = useState<string[]>([])
  const [previewed, setPreviewed] = useState(false)
  const check = useCallback(() => admin.readiness(slug).then((r) => setChecks(r.checks), (e) => flash('err', errText(e))), [admin, slug, flash])
  useEffect(() => {
    check()
  }, [check, status])
  const set = async (next: 'draft' | 'published' | 'archived', okText: string) => {
    setBusy(true)
    try {
      await admin.updateFestival(slug, { status: next, ...(next === 'published' ? { confirm: confirmed } : {}) })
      setStatus(next)
      setConfirmed([])
      await reload()
      flash('ok', okText)
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }
  const data = checks?.filter((c) => c.kind === 'data') ?? []
  const confirms = checks?.filter((c) => c.kind === 'confirm') ?? []
  const ready = !!checks && data.every((c) => c.ok) && confirms.every((c) => confirmed.includes(c.id))
  const toggle = (id: string, on: boolean) => setConfirmed((cur) => (on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)))
  return (
    <div>
      <h2 className="admin-h">Prüfen & veröffentlichen</h2>
      <p className="small">
        Status: <b>{STATUS_TEXT[status] ?? status}</b>
      </p>
      {status !== 'published' && (
        <>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <div className="label grow">Was Besucher:innen brauchen</div>
            <button type="button" className="btn ghost sm" onClick={check}>
              Erneut prüfen
            </button>
          </div>
          <ul className="list" aria-label="Datenprüfung" style={{ margin: '8px 0 14px', padding: 0, listStyle: 'none' }}>
            {data.map((c) => (
              <li key={c.id} className="list-item small">
                {c.ok ? <Check size={16} style={{ color: 'var(--ok)' }} aria-label="erfüllt" /> : <span style={{ color: 'var(--crit)' }} aria-label="fehlt">✕</span>} {c.text}
              </li>
            ))}
          </ul>
          <div className="label">Das bestätigt ihr als Veranstalter</div>
          <div className="list" style={{ margin: '8px 0 14px' }}>
            {confirms.map((c) => (
              <label key={c.id} className="list-item small" style={{ alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={confirmed.includes(c.id)}
                  disabled={c.id === 'preview' && !previewed}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                  style={{ marginTop: 3, width: 18, height: 18 }}
                />
                <span>
                  {c.text}
                  {c.id === 'preview' && !previewed && <span className="faint"> – erst „Vorschau öffnen“</span>}
                </span>
              </label>
            ))}
          </div>
          <p className="tiny faint">Die Karte in der App ist ein schematischer Plan und ersetzt keine Beschilderung; Notfallkommunikation verantwortet ihr. Die Bestätigung wird mit eurem Namen im Änderungsprotokoll gespeichert.</p>
        </>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn secondary"
          onClick={() => {
            // the preview tab inherits this tab's sessionStorage (admin token), so drafts load there
            window.open(`/?f=${encodeURIComponent(slug)}&preview=1`, '_blank')
            setPreviewed(true)
          }}
        >
          <Eye size={17} /> Vorschau öffnen
        </button>
        {status !== 'published' && (
          <button className="btn primary" disabled={busy || !ready} onClick={() => set('published', 'Festival ist veröffentlicht')}>
            <Rocket size={17} /> {status === 'archived' ? 'Reaktivieren' : 'Veröffentlichen'}
          </button>
        )}
        {status === 'published' && (
          <button className="btn secondary" disabled={busy} onClick={() => confirm('Festival archivieren? Besucher können dann nur noch lesen.') && set('archived', 'Festival archiviert')}>
            <Archive size={17} /> Archivieren
          </button>
        )}
        {status === 'published' && (
          <button className="btn ghost" disabled={busy} onClick={() => confirm('Zurück auf Entwurf? Das Festival verschwindet für Besucher.') && set('draft', 'Festival ist wieder ein Entwurf')}>
            Zurück auf Entwurf
          </button>
        )}
      </div>
    </div>
  )
}
