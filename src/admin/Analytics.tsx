import { Check, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApi, type Analytics as Data } from '../api'
import { ACTS, actById, DAYS, fmt, STAGES } from '../data'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

/**
 * Organizer analytics: what visitors plan, how the community features are used and where the
 * FAQ bot had no answer. Only aggregates arrive here; the server withholds groups below minGroup.
 */
export function Analytics({ token, flash, slug }: { token: string; flash: Flash; slug: string }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    setBusy(true)
    try {
      setData(await admin.analytics(slug))
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }, [admin, slug, flash])
  useEffect(() => {
    load()
  }, [load])

  if (!data) return <p className="muted small">{busy ? 'Lade Auswertung …' : 'Keine Daten'}</p>
  const small = (n: number) => (n > 0 ? n.toLocaleString('de-DE') : `< ${data.minGroup}`)
  const kpis: [string, number][] = [
    ['Profile mit Plan', data.profiles],
    ['Crews', data.community.crews],
    ['Personen in Crews', data.community.members],
    ['Chat-Nachrichten', data.community.messages],
    ['Meetups', data.community.meetups],
    ['Step-Challenge', data.community.steps],
  ]
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <h2 className="admin-h grow" style={{ margin: 0 }}>
            Auswertung
          </h2>
          <button type="button" className="btn ghost sm" onClick={load} disabled={busy}>
            <RefreshCw size={15} /> Aktualisieren
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Nur Summen, keine Einzelpersonen: Werte unter {data.minGroup} werden nicht angezeigt. Planzahlen stammen von Besucher:innen, deren Profil auf dem Server liegt (z. B. nach dem ersten Crew-Beitritt).
        </p>
        <div className="kpis">
          {kpis.map(([label, n]) => (
            <div key={label} className="kpi">
              <div className="kpi-n">{small(n)}</div>
              <div className="tiny faint">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-grid">
        <TopActs data={data} />
        <FaqGaps data={data} onDismiss={async (q) => {
          try {
            await admin.dismissFaqMiss(slug, q)
            setData({ ...data, faq: { ...data.faq, misses: data.faq.misses.filter((m) => m.question !== q) } })
          } catch (e) {
            flash('err', errText(e))
          }
        }} />
      </div>
      <Crowd data={data} />
    </div>
  )
}

function TopActs({ data }: { data: Data }) {
  const top = data.acts
    .filter((a) => actById[a.id])
    .sort((a, b) => b.plans - a.plans)
    .slice(0, 12)
  const max = Math.max(1, ...top.map((a) => a.plans))
  return (
    <section className="card">
      <h3 className="admin-h" style={{ fontSize: 17 }}>
        Meistgeplante Acts
      </h3>
      {top.length === 0 ? (
        <p className="small muted">Noch kein Act wurde von mindestens {data.minGroup} Personen geplant.</p>
      ) : (
        <ol className="bars" aria-label="Meistgeplante Acts">
          {top.map((a) => {
            const act = actById[a.id]
            return (
              <li key={a.id} title={`${act.artist}: ${a.plans} Mal geplant`}>
                <span className="bars-label ellipsis">
                  {act.artist}
                  <span className="tiny faint"> · {DAYS[act.day]?.short} {fmt(act.start)}</span>
                </span>
                <span className="bars-track">
                  <i style={{ width: `${(a.plans / max) * 100}%` }} />
                </span>
                <span className="bars-n">{a.plans}</span>
              </li>
            )
          })}
        </ol>
      )}
      {data.withheldActs > 0 && <p className="tiny faint">{data.withheldActs} weitere Acts mit weniger als {data.minGroup} Planungen sind ausgeblendet.</p>}
    </section>
  )
}

function FaqGaps({ data, onDismiss }: { data: Data; onDismiss: (q: string) => void }) {
  return (
    <section className="card">
      <h3 className="admin-h" style={{ fontSize: 17 }}>
        FAQ-Bot
      </h3>
      <div className="label" style={{ marginBottom: 6 }}>
        Fragen ohne Antwort
      </div>
      {data.faq.misses.length === 0 ? (
        <p className="small muted">Keine offenen Fragen – angezeigt werden Fragen, die mindestens {data.minGroup}-mal gleich gestellt wurden.</p>
      ) : (
        <div className="list">
          {data.faq.misses.map((m) => (
            <div key={m.question} className="list-item">
              <span className="grow">„{m.question}“</span>
              <span className="tiny faint">{m.n}×</span>
              <button type="button" className="btn ghost sm" onClick={() => onDismiss(m.question)} aria-label={`„${m.question}“ als erledigt markieren`}>
                <Check size={15} /> Erledigt
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="label" style={{ margin: '16px 0 6px' }}>
        Häufig genutzte Antworten
      </div>
      {data.faq.hits.length === 0 ? (
        <p className="small muted">Noch keine Antwort wurde mindestens {data.minGroup}-mal genutzt.</p>
      ) : (
        <div className="list">
          {data.faq.hits.map((h) => (
            <div key={h.id} className="list-item small">
              <span className="grow">{h.question}</span>
              <span className="faint">{h.n}×</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Expected crowd: planned visitors per stage and hour (a set counts for every hour it touches). */
function Crowd({ data }: { data: Data }) {
  const [day, setDay] = useState(0)
  const plans = new Map(data.acts.map((a) => [a.id, a.plans]))
  const acts = ACTS.filter((a) => a.day === day && !a.change?.cancelled)
  if (!DAYS.length) return null
  const from = acts.length ? Math.floor(Math.min(...acts.map((a) => a.start)) / 60) : 0
  const to = acts.length ? Math.ceil(Math.max(...acts.map((a) => a.end)) / 60) : 0
  const hours = Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i)
  const cell = (stage: string, h: number) => acts.filter((a) => a.stage === stage && a.start < (h + 1) * 60 && a.end > h * 60).reduce((n, a) => n + (plans.get(a.id) ?? 0), 0)
  const grid = STAGES.map((s) => ({ s, values: hours.map((h) => cell(s.id, h)) }))
  const max = Math.max(1, ...grid.flatMap((r) => r.values))
  return (
    <section className="card">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h3 className="admin-h grow" style={{ fontSize: 17, margin: 0 }}>
          Erwarteter Andrang
        </h3>
        <div className="row" role="group" aria-label="Tag" style={{ gap: 6 }}>
          {DAYS.map((d) => (
            <button key={d.idx} type="button" className={`chip ${day === d.idx ? 'on' : ''}`} aria-pressed={day === d.idx} onClick={() => setDay(d.idx)}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {hours.length === 0 ? (
        <p className="small muted">An diesem Tag gibt es keine Acts.</p>
      ) : (
        <div className="heat-wrap">
          <table className="heat">
            <caption className="sr-only">Geplante Besucher:innen je Bühne und Stunde</caption>
            <thead>
              <tr>
                <th scope="col" />
                {hours.map((h) => (
                  <th key={h} scope="col" className="tiny faint">
                    {fmt(h * 60).slice(0, 2)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map(({ s, values }) => (
                <tr key={s.id}>
                  <th scope="row" className="small">
                    {s.name}
                  </th>
                  {values.map((n, i) => {
                    const p = n ? 18 + Math.round((n / max) * 82) : 0
                    return (
                      <td
                        key={i}
                        title={`${s.name}, ${fmt(hours[i] * 60)}–${fmt(hours[i] * 60 + 60)}: ${n} geplant`}
                        style={n ? { background: `color-mix(in oklab, var(--brand) ${p}%, var(--surface-2))`, color: p > 60 ? 'var(--brand-ink)' : 'var(--text)' } : undefined}
                      >
                        {n || ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny faint" style={{ marginBottom: 0 }}>
        Je kräftiger, desto mehr Besucher:innen haben dort Acts geplant – hilft bei Personal, Bars und Wasserstellen.
      </p>
    </section>
  )
}
