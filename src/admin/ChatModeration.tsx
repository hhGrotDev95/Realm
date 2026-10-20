import { Eye, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApi } from '../api'

type Flash = (k: 'ok' | 'err', t: string) => void
type Row = Awaited<ReturnType<ReturnType<typeof adminApi>['chat']>>[number]
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

/** Festival chat moderation: hidden (reported) messages first; delete or restore. */
export function ChatModeration({ token, flash, slug }: { token: string; flash: Flash; slug: string }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [rows, setRows] = useState<Row[] | null>(null)
  const load = useCallback(() => admin.chat(slug).then(setRows, (e) => flash('err', errText(e))), [admin, slug, flash])
  useEffect(() => {
    load()
  }, [load])
  const act = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn()
      flash('ok', ok)
      load()
    } catch (e) {
      flash('err', errText(e))
    }
  }
  const hidden = rows?.filter((r) => r.hidden).length ?? 0
  return (
    <div className="card">
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <h2 className="admin-h grow" style={{ margin: 0 }}>
          Festival-Chat
        </h2>
        <button type="button" className="btn ghost sm" onClick={load}>
          <RefreshCw size={15} /> Aktualisieren
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Nachrichten, die drei Besucher:innen melden, sind automatisch ausgeblendet und stehen oben. Wiederherstellen zeigt sie dauerhaft wieder an, Löschen entfernt den Text für alle. Nachrichten werden 30 Tage nach der letzten Änderung gelöscht.
      </p>
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
              <div key={r.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <span className="grow">
                  <span className="tiny faint" style={{ display: 'block' }}>
                    {r.name} · {new Date(r.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                    {r.flags > 0 && ` · ${r.flags}× gemeldet`}
                    {r.restored && ' · geprüft'}
                  </span>
                  <span style={{ opacity: r.hidden ? 0.75 : 1 }}>{r.text}</span>
                  {r.hidden && <span className="tag warn" style={{ marginLeft: 8 }}>ausgeblendet</span>}
                </span>
                {r.hidden && (
                  <button type="button" className="btn ghost sm" onClick={() => act(() => admin.restoreChat(slug, r.id), 'Nachricht wiederhergestellt')}>
                    <Eye size={15} /> Wiederherstellen
                  </button>
                )}
                <button type="button" className="btn ghost sm" aria-label={`Nachricht von ${r.name} löschen`} onClick={() => confirm('Nachricht für alle löschen?') && act(() => admin.deleteChat(slug, r.id), 'Nachricht gelöscht')}>
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
