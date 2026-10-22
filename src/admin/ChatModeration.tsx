import { DecisionReason, FlagReasons } from './ModerationReason'
import { Eye, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminApi } from '../api'

type Flash = (k: 'ok' | 'err', t: string) => void
type Row = Awaited<ReturnType<ReturnType<typeof adminApi>['chat']>>[number]
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

/** Festival chat moderation: hidden (reported) messages first; delete or restore. */
export function ChatModeration({ token, flash, slug }: { token: string; flash: Flash; slug: string }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [kind, setKind] = useState<'festival' | 'crew'>('festival')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const request = useRef(0)
  const load = useCallback(async () => {
    const sequence = ++request.current
    try {
      const result = await admin.chat(slug, kind)
      if (sequence === request.current) setRows(result)
    } catch (e) {
      if (sequence === request.current) flash('err', errText(e))
    }
  }, [admin, slug, kind, flash])
  useEffect(() => {
    load()
    return () => { request.current++ }
  }, [load])
  const act = async (fn: () => Promise<void>, ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      flash('ok', ok)
      load()
    } catch (e) {
      flash('err', errText(e))
    } finally { setBusy(false) }
  }
  const hidden = rows?.filter((r) => r.hidden).length ?? 0
  return (
    <div className="card">
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <h2 className="admin-h grow" style={{ margin: 0 }}>
          Chat-Moderation
        </h2>
        <button type="button" className="btn ghost sm" onClick={load}>
          <RefreshCw size={15} /> Aktualisieren
        </button>
      </div>
      <label className="admin-field">Bereich
        <select className="field" aria-label="Bereich" value={kind} disabled={busy} onChange={(e) => { request.current++; setRows(null); setKind(e.target.value as typeof kind) }}>
          <option value="festival">Festival-Chat</option>
          <option value="crew">Gemeldete Crew-Nachrichten</option>
        </select>
      </label>
      <p className="small muted">Crew-Nachrichten erscheinen nur nach einer Meldung. Automatisches Ausblenden ist noch keine Entscheidung. Jede Entscheidung braucht eine Begründung und wird der betroffenen Person sowie im Änderungsprotokoll angezeigt.</p>
      {rows === null ? (
        <p className="muted small">Lade …</p>
      ) : rows.length === 0 ? (
        <p className="muted small">Noch keine Nachrichten.</p>
      ) : (
        <>
          {hidden > 0 && (
            <p className="small" role="status" style={{ color: 'var(--warn)' }}>
              {hidden === 1 ? '1 ausgeblendete Nachricht wartet auf Prüfung' : `${hidden} ausgeblendete Nachrichten warten auf Prüfung`}
            </p>
          )}
          <div className="list">
            {rows.map((r) => (
              <div key={r.id} className="list-item" style={{ alignItems: 'stretch', flexDirection: 'column' }}>
                <span className="grow">
                  <span className="tiny faint" style={{ display: 'block' }}>
                    {r.name} · {new Date(r.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                    {r.flags > 0 && ` · ${r.flags}× gemeldet`}
                    {r.restored && ' · geprüft'}
                  </span>
                  <span style={{ opacity: r.hidden ? 0.75 : 1 }}>{r.text}</span>
                  {r.hidden && <span className="tag warn" style={{ marginLeft: 8 }}>ausgeblendet</span>}
                </span>
                <FlagReasons reasons={r.reasons} />
                <DecisionReason value={reasons[r.id] ?? ''} change={(v) => setReasons((p) => ({ ...p, [r.id]: v }))} />
                {r.flags > 0 && (
                  <button type="button" className="btn ghost sm" disabled={busy || (reasons[r.id]?.trim().length ?? 0) < 3} onClick={() => act(() => admin.restoreChat(slug, r.id, reasons[r.id].trim(), r.kind), 'Nachricht wiederhergestellt')}>
                    <Eye size={15} /> Wiederherstellen
                  </button>
                )}
                <button type="button" className="btn ghost sm" aria-label={`Nachricht von ${r.name} löschen`} disabled={busy || (reasons[r.id]?.trim().length ?? 0) < 3} onClick={() => confirm('Nachricht für alle löschen?') && act(() => admin.deleteChat(slug, r.id, reasons[r.id].trim(), r.kind), 'Nachricht gelöscht')}>
                  <Trash2 size={15} /> Löschen
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
