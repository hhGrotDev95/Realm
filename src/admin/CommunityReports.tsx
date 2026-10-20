import { BadgeCheck, RefreshCw, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApi } from '../api'

type Flash = (k: 'ok' | 'err', t: string) => void
type Row = Awaited<ReturnType<ReturnType<typeof adminApi>['reports']>>[number]
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

/**
 * Community reports as the organizer sees them (audit F06): visitors only count how many people reported
 * something; "official" is what the organizer checked here. Ending a report removes it for everyone.
 */
export function CommunityReports({ token, flash, slug }: { token: string; flash: Flash; slug: string }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [rows, setRows] = useState<Row[] | null>(null)
  const load = useCallback(() => admin.reports(slug).then(setRows, (e) => flash('err', errText(e))), [admin, slug, flash])
  useEffect(() => {
    load()
  }, [load])
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      flash('ok', ok)
      load()
    } catch (e) {
      flash('err', errText(e))
    }
  }
  return (
    <div className="card">
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <h2 className="admin-h grow" style={{ margin: 0 }}>
          Community-Meldungen
        </h2>
        <button type="button" className="btn ghost sm" onClick={load}>
          <RefreshCw size={15} /> Aktualisieren
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Besucher:innen sehen nur, wie viele Personen etwas gemeldet haben – Gastprofile sind leicht anzulegen, das ist keine Prüfung. Als „Offiziell“ erscheint eine Meldung erst, wenn ihr sie hier bestätigt. Beenden nimmt sie sofort aus der App.
      </p>
      {rows === null ? (
        <p className="muted small">Lade …</p>
      ) : rows.length === 0 ? (
        <p className="muted small">Gerade keine aktiven Meldungen.</p>
      ) : (
        <div className="list">
          {rows.map((r) => (
            <div key={r.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <span className="grow">
                <span className="tiny faint" style={{ display: 'block' }}>
                  {r.by} · {new Date(r.at).toLocaleTimeString('de-DE', { timeStyle: 'short' })} · von {r.reporters} {r.reporters === 1 ? 'Person' : 'Personen'} gemeldet
                  {r.fixedVotes > 0 && ` · ${r.fixedVotes} sagen behoben`}
                  {r.place && ` · ${r.place}`}
                </span>
                <span>{r.title}</span>
                {r.verified && (
                  <span className="tag official" style={{ marginLeft: 8 }}>
                    offiziell
                  </span>
                )}
              </span>
              {r.verified ? (
                <button type="button" className="btn ghost sm" onClick={() => act(() => admin.verifyReport(slug, r.id, false), 'Nicht mehr offiziell')}>
                  <Undo2 size={15} /> Zurücknehmen
                </button>
              ) : (
                <button type="button" className="btn ghost sm" aria-label={`„${r.title}“ als offiziell bestätigen`} onClick={() => act(() => admin.verifyReport(slug, r.id, true), 'Als offiziell bestätigt')}>
                  <BadgeCheck size={15} /> Bestätigen
                </button>
              )}
              <button type="button" className="btn ghost sm" aria-label={`„${r.title}“ beenden`} onClick={() => act(() => admin.endReport(slug, r.id), 'Meldung beendet')}>
                <X size={15} /> Beenden
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
