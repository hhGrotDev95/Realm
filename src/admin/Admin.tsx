import { CalendarClock, FileUp, LayoutGrid, Palette, ToggleRight, LogOut, Megaphone, Plus, RotateCcw, Settings2, Trash2, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApi, ApiError, online, setFestival, type Announcement } from '../api'
import { Branding } from './Branding'
import { Modules } from './Modules'
import { CreateFestival, ImportPanel, Settings, SetupWizard, StagesEditor } from './Setup'
import { currentSlug } from '../festival'
import { ACTS, DAYS, FESTIVAL, fmt, loadFestivalBundle, STAGES, stageById, type Act, type StageId, type TimetableChange } from '../data'

const KEY = 'realm.admin'
type Tab = 'setup' | 'announcements' | 'timetable' | 'import' | 'stages' | 'branding' | 'modules' | 'settings'

/** Parses "22:30" (or "01:30" after midnight) into festival-day minutes. */
function parseTime(v: string): number | null {
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return (h < 10 ? h + 24 : h) * 60 + min
}

export default function Admin() {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(KEY)
    } catch {
      return null
    }
  })
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text })
    window.setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 4000)
  }, [])

  if (!online)
    return (
      <AdminShell>
        <div className="card">
          <h2 className="h-display" style={{ fontSize: 24 }}>
            Kein Server konfiguriert
          </h2>
          <p className="muted">Die Veranstalter-Konsole braucht das Realm-Backend. Baue die App mit <code>VITE_API_URL</code>.</p>
        </div>
      </AdminShell>
    )
  if (!token)
    return (
      <AdminShell>
        <Login
          onLogin={(t) => {
            try {
              sessionStorage.setItem(KEY, t)
            } catch {}
            setToken(t)
          }}
        />
      </AdminShell>
    )
  return (
    <AdminShell
      onLogout={() => {
        try {
          sessionStorage.removeItem(KEY)
        } catch {}
        setToken(null)
      }}
      msg={msg}
    >
      <Console token={token} flash={flash} />
    </AdminShell>
  )
}

function AdminShell({ children, onLogout, msg }: { children: React.ReactNode; onLogout?: () => void; msg?: { kind: 'ok' | 'err'; text: string } | null }) {
  return (
    <div className="admin">
      <header className="admin-bar">
        <div className="logo" aria-hidden>
          R
        </div>
        <div className="grow">
          <h1 style={{ fontSize: 15, margin: 0, fontWeight: 700 }}>Realm · Veranstalter-Konsole</h1>
          <span className="tiny faint" style={{ display: 'block' }}>
            Änderungen erscheinen in der App innerhalb einer Minute
          </span>
        </div>
        {onLogout && (
          <button className="btn ghost sm" onClick={onLogout}>
            <LogOut size={16} /> Abmelden
          </button>
        )}
      </header>
      <main className="admin-main">{children}</main>
      {msg && (
        <div className={`toast admin-toast ${msg.kind}`} role="status">
          {msg.text}
        </div>
      )}
    </div>
  )
}

function Login({ onLogin }: { onLogin: (t: string) => void }) {
  const [t, setT] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="card admin-login"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setErr(null)
        try {
          await adminApi(t.trim()).check()
          onLogin(t.trim())
        } catch (e) {
          setErr(e instanceof ApiError && e.status === 401 ? 'Token ungültig' : e instanceof Error ? e.message : 'Fehler')
        }
        setBusy(false)
      }}
    >
      <h1 className="h-display" style={{ fontSize: 28 }}>
        Anmelden
      </h1>
      <p className="small muted">Admin-Token des Festivals (wird nur für diesen Browser-Tab gespeichert).</p>
      <label className="admin-field">
        <span>Admin-Token</span>
        <input className="field" type="password" value={t} onChange={(e) => setT(e.target.value)} autoComplete="current-password" />
      </label>
      {err && (
        <p className="small" role="alert" style={{ color: 'var(--crit)' }}>
          {err}
        </p>
      )}
      <button className="btn primary block" disabled={busy || !t.trim()}>
        {busy ? 'Prüfe …' : 'Anmelden'}
      </button>
    </form>
  )
}

const STATUS: Record<string, string> = { draft: 'Entwurf', published: 'Veröffentlicht', archived: 'Archiviert' }

function Console({ token, flash }: { token: string; flash: (k: 'ok' | 'err', t: string) => void }) {
  const [tab, setTab] = useState<Tab>('announcements')
  const [festivals, setFestivals] = useState<{ slug: string; name: string; status: string }[]>([])
  const [slug, setSlug] = useState(currentSlug)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [creating, setCreating] = useState(false)
  const admin = useMemo(() => adminApi(token), [token])

  const loadList = useCallback(() => admin.festivals().then(setFestivals, (e) => flash('err', errText(e))), [admin, flash])
  useEffect(() => {
    loadList()
  }, [loadList])

  /** Re-reads the selected festival after a change (stages, import, status). */
  const reload = useCallback(async () => {
    const b = await admin.bundle(slug)
    loadFestivalBundle(b)
    setVersion((v) => v + 1)
    loadList()
  }, [admin, slug, loadList])

  // every request below is scoped to the selected festival (X-Festival)
  useEffect(() => {
    setLoaded(null)
    setFestival(slug)
    admin.bundle(slug).then(
      (b) => {
        loadFestivalBundle(b)
        setLoaded(slug)
        if (b.festival.status === 'draft') setTab('setup')
        else setTab((t) => (t === 'setup' ? 'announcements' : t))
      },
      (e) => flash('err', errText(e)),
    )
  }, [admin, slug, flash])

  if (creating)
    return (
      <CreateFestival
        token={token}
        flash={flash}
        onCancel={() => setCreating(false)}
        onCreated={(s) => {
          setCreating(false)
          loadList()
          setSlug(s)
        }}
      />
    )

  return (
    <>
      <div className="row" style={{ gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <label className="admin-field" style={{ marginBottom: 0, maxWidth: 360 }}>
          <span>Festival</span>
          <select className="field" value={slug} onChange={(e) => setSlug(e.target.value)}>
            {!festivals.some((f) => f.slug === slug) && <option value={slug}>{slug}</option>}
            {festivals.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name} · {STATUS[f.status] ?? f.status}
              </option>
            ))}
          </select>
        </label>
        <button className="btn secondary" style={{ alignSelf: 'flex-end' }} onClick={() => setCreating(true)}>
          <Plus size={17} /> Neues Festival
        </button>
      </div>
      {loaded !== slug ? (
        <p className="muted small">Lade Festival …</p>
      ) : (
        <ConsoleTabs key={`${slug}:${version}`} slug={slug} tab={tab} setTab={setTab} token={token} flash={flash} reload={reload} />
      )}
    </>
  )
}

const TABS: { id: Tab; label: string; icon: typeof Megaphone; draftOnly?: boolean }[] = [
  { id: 'setup', label: 'Einrichtung', icon: Wand2, draftOnly: true },
  { id: 'announcements', label: 'Meldungen', icon: Megaphone },
  { id: 'timetable', label: 'Live-Änderungen', icon: CalendarClock },
  { id: 'import', label: 'Import', icon: FileUp },
  { id: 'stages', label: 'Bühnen', icon: LayoutGrid },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'modules', label: 'Module', icon: ToggleRight },
  { id: 'settings', label: 'Status', icon: Settings2 },
]

function ConsoleTabs({ slug, tab, setTab, token, flash, reload }: { slug: string; tab: Tab; setTab: (t: Tab) => void; token: string; flash: (k: 'ok' | 'err', t: string) => void; reload: () => Promise<void> }) {
  const draft = FESTIVAL.status === 'draft'
  // the setup wizard only exists for drafts; once published the same place shows the status
  if (tab === 'setup' && !draft) tab = 'settings'
  return (
    <>
      <nav className="admin-tabs" role="tablist" aria-label="Bereiche">
        {TABS.filter((t) => !t.draftOnly || draft).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <t.icon size={17} /> {t.label}
          </button>
        ))}
      </nav>
      {tab === 'setup' && <SetupWizard token={token} flash={flash} slug={slug} reload={reload} />}
      {tab === 'announcements' && <Announcements token={token} flash={flash} />}
      {tab === 'timetable' && <Timetable token={token} flash={flash} />}
      {tab === 'import' && (
        <div className="card">
          <ImportPanel token={token} flash={flash} slug={slug} reload={reload} />
        </div>
      )}
      {tab === 'stages' && (
        <div className="card">
          <StagesEditor token={token} flash={flash} slug={slug} reload={reload} />
        </div>
      )}
      {tab === 'branding' && <Branding token={token} flash={flash} slug={slug} reload={reload} />}
      {tab === 'modules' && <Modules token={token} flash={flash} slug={slug} reload={reload} />}
      {tab === 'settings' && (
        <div className="card">
          <Settings token={token} flash={flash} slug={slug} reload={reload} />
        </div>
      )}
    </>
  )
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

function Announcements({ token, flash }: { token: string; flash: (k: 'ok' | 'err', t: string) => void }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [form, setForm] = useState({ title: '', body: '', place: '', severity: 'info' as Announcement['severity'], valid: '' })
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => admin.announcements().then(setItems, (e) => flash('err', errText(e))), [admin, flash])
  useEffect(() => {
    load()
  }, [load])
  const validMin = form.valid ? Number(form.valid) : undefined
  const invalid = form.title.trim().length < 3 || (validMin !== undefined && (!Number.isInteger(validMin) || validMin < 1))
  return (
    <div className="admin-grid">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await admin.announce({ title: form.title.trim(), body: form.body.trim() || undefined, place: form.place.trim() || undefined, severity: form.severity, validMin })
            setForm({ title: '', body: '', place: '', severity: 'info', valid: '' })
            flash('ok', 'Meldung veröffentlicht')
            load()
          } catch (e) {
            flash('err', errText(e))
          }
          setBusy(false)
        }}
      >
        <h2 className="admin-h">Neue Meldung</h2>
        <label className="admin-field">
          <span>Titel</span>
          <input className="field" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="z. B. Gewitterwarnung ab 22:30" />
        </label>
        <label className="admin-field">
          <span>Text (optional)</span>
          <textarea className="field" value={form.body} maxLength={1000} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
        <div className="admin-row">
          <label className="admin-field">
            <span>Ort (optional)</span>
            <input className="field" value={form.place} maxLength={60} onChange={(e) => setForm({ ...form, place: e.target.value })} />
          </label>
          <label className="admin-field">
            <span>Gültig (Min., leer = bis gelöscht)</span>
            <input className="field" inputMode="numeric" value={form.valid} onChange={(e) => setForm({ ...form, valid: e.target.value.replace(/\D/g, '') })} />
          </label>
        </div>
        <fieldset className="admin-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Stufe</span>
          <div className="chips">
            {(
              [
                ['info', 'Info'],
                ['warning', 'Warnung'],
                ['critical', 'Kritisch'],
              ] as const
            ).map(([v, l]) => (
              <button type="button" key={v} className={`chip ${form.severity === v ? 'on' : ''}`} aria-pressed={form.severity === v} onClick={() => setForm({ ...form, severity: v })}>
                {l}
              </button>
            ))}
          </div>
          <span className="tiny faint">Warnung und Kritisch erscheinen oben auf dem Home-Screen aller Besucher.</span>
        </fieldset>
        <button className="btn primary block" disabled={busy || invalid}>
          {busy ? 'Veröffentliche …' : 'Veröffentlichen'}
        </button>
      </form>

      <section className="card">
        <h2 className="admin-h">Aktiv ({items?.length ?? '…'})</h2>
        {items === null ? (
          <p className="muted small">Lade …</p>
        ) : items.length === 0 ? (
          <p className="muted small">Keine aktiven Meldungen.</p>
        ) : (
          <div className="list">
            {items.map((a) => (
              <div key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`tag ${a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'official'}`}>{a.severity === 'critical' ? 'Kritisch' : a.severity === 'warning' ? 'Warnung' : 'Info'}</span>
                    <span className="tiny faint">
                      vor {a.ageMin} Min.{a.validMin !== null ? ` · noch ${a.validMin} Min.` : ''}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>{a.title}</div>
                  {a.body && <div className="small muted">{a.body}</div>}
                </div>
                <button
                  className="icon-btn"
                  aria-label={`„${a.title}“ entfernen`}
                  onClick={async () => {
                    if (!confirm(`„${a.title}“ entfernen?`)) return
                    try {
                      await admin.removeAnnouncement(a.id)
                      flash('ok', 'Meldung entfernt')
                      load()
                    } catch (e) {
                      flash('err', errText(e))
                    }
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Timetable({ token, flash }: { token: string; flash: (k: 'ok' | 'err', t: string) => void }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [day, setDay] = useState(0)
  const [changes, setChanges] = useState<TimetableChange[] | null>(null)
  const [edit, setEdit] = useState<Act | null>(null)
  const load = useCallback(() => admin.timetableChanges().then(setChanges, (e) => flash('err', errText(e))), [admin, flash])
  useEffect(() => {
    load()
  }, [load])
  const byId = new Map((changes ?? []).map((c) => [c.actId, c]))
  return (
    <div className="admin-grid">
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 className="admin-h" style={{ margin: 0 }}>
            Timetable
          </h2>
          <div className="chips">
            {DAYS.map((d) => (
              <button key={d.idx} className={`chip ${day === d.idx ? 'on' : ''}`} aria-pressed={day === d.idx} onClick={() => setDay(d.idx)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="list">
          {ACTS.filter((a) => a.day === day).map((a) => {
            const c = byId.get(a.id)
            return (
              <button key={a.id} className={`list-item ${edit?.id === a.id ? 'admin-sel' : ''}`} onClick={() => setEdit(a)}>
                <span style={{ width: 110, flex: 'none', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmt(a.start)}–{fmt(a.end)}
                </span>
                <span className="grow">
                  <span style={{ fontWeight: 600 }}>{a.artist}</span>
                  <span className="small faint" style={{ display: 'block' }}>
                    {stageById[a.stage].name}
                  </span>
                </span>
                {c && <span className={`tag ${c.cancelled ? 'crit' : 'warn'}`}>{c.cancelled ? 'Abgesagt' : [c.start !== null && `→ ${fmt(c.start)}`, c.stage && `→ ${stageById[c.stage].name}`].filter(Boolean).join(' ')}</span>}
              </button>
            )
          })}
        </div>
      </section>
      <section className="card">
        {edit ? (
          <ChangeForm
            key={edit.id + (byId.get(edit.id)?.note ?? '') + JSON.stringify(byId.get(edit.id) ?? null)}
            act={edit}
            change={byId.get(edit.id)}
            onSave={async (c) => {
              try {
                await admin.setChange(edit.id, c)
                flash('ok', `${edit.artist}: Änderung veröffentlicht`)
                load()
              } catch (e) {
                flash('err', errText(e))
              }
            }}
            onRevert={async () => {
              try {
                await admin.revertChange(edit.id)
                flash('ok', `${edit.artist}: Originalzeit wiederhergestellt`)
                load()
              } catch (e) {
                flash('err', errText(e))
              }
            }}
          />
        ) : (
          <p className="muted small">Wähle links einen Act, um ihn zu verschieben, die Bühne zu ändern oder ihn abzusagen.</p>
        )}
      </section>
    </div>
  )
}

function ChangeForm({ act, change, onSave, onRevert }: { act: Act; change?: TimetableChange; onSave: (c: { start?: number; end?: number; stage?: StageId; cancelled?: boolean; note?: string }) => Promise<void>; onRevert: () => Promise<void> }) {
  const [start, setStart] = useState(fmt(change?.start ?? act.start))
  const [end, setEnd] = useState(fmt(change?.end ?? act.end))
  const [stage, setStage] = useState<StageId>(change?.stage ?? act.stage)
  const [cancelled, setCancelled] = useState(change?.cancelled ?? false)
  const [note, setNote] = useState(change?.note ?? '')
  const [busy, setBusy] = useState(false)
  const s = parseTime(start)
  const e = parseTime(end)
  const timeErr = s === null || e === null ? 'Zeit im Format HH:MM' : e <= s ? 'Ende muss nach dem Beginn liegen' : null
  const moved = s !== act.start || e !== act.end
  const restaged = stage !== act.stage
  const nothing = !moved && !restaged && !cancelled
  const shift = (d: number) => {
    if (s === null || e === null) return
    setStart(fmt(s + d))
    setEnd(fmt(e + d))
  }
  return (
    <form
      onSubmit={async (ev) => {
        ev.preventDefault()
        setBusy(true)
        await onSave({ ...(moved ? { start: s!, end: e! } : {}), ...(restaged ? { stage } : {}), cancelled, note: note.trim() || undefined })
        setBusy(false)
      }}
    >
      <h2 className="admin-h">{act.artist}</h2>
      <p className="small faint" style={{ marginTop: -6 }}>
        Veröffentlicht: {DAYS[act.day].label} {fmt(act.start)}–{fmt(act.end)} · {stageById[act.stage].name}
      </p>
      <div className="admin-row">
        <label className="admin-field">
          <span>Beginn</span>
          <input className="field" value={start} onChange={(ev) => setStart(ev.target.value)} inputMode="numeric" aria-invalid={!!timeErr} />
        </label>
        <label className="admin-field">
          <span>Ende</span>
          <input className="field" value={end} onChange={(ev) => setEnd(ev.target.value)} inputMode="numeric" aria-invalid={!!timeErr} />
        </label>
      </div>
      <div className="chips" style={{ marginBottom: 6 }}>
        {[-15, -5, 5, 15, 30].map((d) => (
          <button type="button" key={d} className="chip" onClick={() => shift(d)}>
            {d > 0 ? '+' : '−'}
            {Math.abs(d)} Min.
          </button>
        ))}
      </div>
      {timeErr && (
        <p className="small" role="alert" style={{ color: 'var(--crit)', margin: '4px 0 10px' }}>
          {timeErr}
        </p>
      )}
      <label className="admin-field">
        <span>Bühne</span>
        <select className="field" value={stage} onChange={(ev) => setStage(ev.target.value as StageId)}>
          {STAGES.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      </label>
      <label className="row small" style={{ gap: 10, margin: '6px 0 14px', minHeight: 44 }}>
        <input type="checkbox" checked={cancelled} onChange={(ev) => setCancelled(ev.target.checked)} style={{ width: 22, height: 22 }} />
        Auftritt absagen
      </label>
      <label className="admin-field">
        <span>Hinweis für Besucher (optional)</span>
        <input className="field" value={note} maxLength={140} onChange={(ev) => setNote(ev.target.value)} placeholder="z. B. Technischer Umbau" />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary grow" disabled={busy || !!timeErr || nothing}>
          {nothing ? 'Keine Änderung' : busy ? 'Speichere …' : 'Änderung veröffentlichen'}
        </button>
        {change && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onRevert()
              setBusy(false)
            }}
          >
            <RotateCcw size={16} /> Zurücksetzen
          </button>
        )}
      </div>
    </form>
  )
}
