import { Bot, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApi, type AdminFaq } from '../api'
import { ask } from '../faq/match'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')
const EMPTY: AdminFaq = { id: '', question: '', answer: '', category: 'Allgemein', keywords: '', source: '', status: 'draft', sort: 0, updatedAt: 0 }
const idFrom = (q: string) =>
  q.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)

export function FaqEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [items, setItems] = useState<AdminFaq[] | null>(null)
  const [edit, setEdit] = useState<AdminFaq | null>(null)
  const [busy, setBusy] = useState(false)
  const [probe, setProbe] = useState('')
  const load = useCallback(() => admin.faq(slug).then(setItems, (e) => flash('err', errText(e))), [admin, slug, flash])
  useEffect(() => {
    load()
  }, [load])
  const published = (items ?? []).filter((f) => f.status === 'published')
  const probeResult = probe.trim() ? ask(probe, published) : null
  const isNew = edit !== null && !items?.some((i) => i.id === edit.id)
  const id = edit ? edit.id || idFrom(edit.question) : ''
  const valid = !!edit && edit.question.trim().length >= 3 && edit.answer.trim().length >= 3 && /^[a-z0-9-]{1,60}$/.test(id)

  return (
    <div className="admin-grid">
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 className="admin-h" style={{ margin: 0 }}>
            FAQ ({items?.length ?? '…'})
          </h2>
          <button className="btn secondary sm" onClick={() => setEdit({ ...EMPTY })}>
            <Plus size={16} /> Neue Frage
          </button>
        </div>
        <div className="list">
          {(items ?? []).map((f) => (
            <button key={f.id} className={`list-item ${edit?.id === f.id ? 'admin-sel' : ''}`} onClick={() => setEdit({ ...f, source: f.source ?? '' })}>
              <span className="grow">
                <span style={{ fontWeight: 600, display: 'block' }}>{f.question}</span>
                <span className="small faint">
                  {f.category}
                  {f.source ? ` · ${f.source}` : ''}
                </span>
              </span>
              <span className={`tag ${f.status === 'published' ? 'ok' : 'unconfirmed'}`}>{f.status === 'published' ? 'Freigegeben' : 'Entwurf'}</span>
            </button>
          ))}
          {items?.length === 0 && <p className="small muted">Noch keine Fragen. Nur freigegebene Antworten erscheinen in der App und im Bot.</p>}
        </div>
        <div style={{ marginTop: 18 }}>
          <label className="admin-field">
            <span>
              <Bot size={14} style={{ verticalAlign: -2 }} /> Bot testen (nur freigegebene Antworten)
            </span>
            <input className="field" value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="z. B. Wo kann ich mein Handy laden?" />
          </label>
          {probeResult && (
            <p className="small" role="status">
              {probeResult.kind === 'answer' ? (
                <>
                  Antwortet mit: <b>{probeResult.faq!.question}</b>
                </>
              ) : (
                <>Keine sichere Antwort{probeResult.suggestions.length ? ` – Vorschläge: ${probeResult.suggestions.map((s) => s.question).join(' · ')}` : ' – der Bot sagt, dass er es nicht weiß.'} Tipp: Stichworte ergänzen.</>
              )}
            </p>
          )}
        </div>
      </section>

      <section className="card">
        {edit ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await admin.saveFaq(slug, { ...edit, id, source: edit.source || undefined })
                await load()
                await reload()
                flash('ok', edit.status === 'published' ? 'Antwort freigegeben' : 'Als Entwurf gespeichert')
                setEdit(null)
              } catch (err) {
                flash('err', errText(err))
              }
              setBusy(false)
            }}
          >
            <h2 className="admin-h">{isNew ? 'Neue Frage' : 'Frage bearbeiten'}</h2>
            <label className="admin-field">
              <span>Frage</span>
              <input className="field" value={edit.question} maxLength={200} onChange={(e) => setEdit({ ...edit, question: e.target.value })} />
            </label>
            <label className="admin-field">
              <span>Antwort</span>
              <textarea className="field" style={{ height: 120 }} value={edit.answer} maxLength={2000} onChange={(e) => setEdit({ ...edit, answer: e.target.value })} />
            </label>
            <div className="admin-row">
              <label className="admin-field">
                <span>Kategorie</span>
                <input className="field" value={edit.category} maxLength={40} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
              </label>
              <label className="admin-field">
                <span>Quelle (z. B. Hausordnung)</span>
                <input className="field" value={edit.source ?? ''} maxLength={80} onChange={(e) => setEdit({ ...edit, source: e.target.value })} />
              </label>
            </div>
            <label className="admin-field">
              <span>Stichworte für den Bot (Alltagswörter, kommagetrennt)</span>
              <input className="field" value={edit.keywords} maxLength={300} onChange={(e) => setEdit({ ...edit, keywords: e.target.value })} placeholder="z. B. klo, dixi, toilette" />
            </label>
            <label className="row small" style={{ gap: 10, minHeight: 44, marginBottom: 12 }}>
              <input type="checkbox" checked={edit.status === 'published'} onChange={(e) => setEdit({ ...edit, status: e.target.checked ? 'published' : 'draft' })} style={{ width: 22, height: 22 }} />
              Freigeben (in App und Bot sichtbar)
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary grow" disabled={busy || !valid}>
                Speichern
              </button>
              {!isNew && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={async () => {
                    if (!confirm('Diese Frage löschen?')) return
                    try {
                      await admin.deleteFaq(slug, edit.id)
                      await load()
                      await reload()
                      setEdit(null)
                      flash('ok', 'Gelöscht')
                    } catch (err) {
                      flash('err', errText(err))
                    }
                  }}
                >
                  <Trash2 size={16} /> Löschen
                </button>
              )}
            </div>
          </form>
        ) : (
          <p className="muted small">Wähle links eine Frage oder lege eine neue an. Der Bot antwortet ausschließlich mit freigegebenen Einträgen und nennt Quelle und Stand.</p>
        )}
      </section>
    </div>
  )
}
