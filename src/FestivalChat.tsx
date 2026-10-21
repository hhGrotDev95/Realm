import { ReportAbuse } from './Moderation'
import { Send, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, opId, type PublicMessage } from './api'
import { FESTIVAL } from './data'
import { t } from './i18n'
import { useApp } from './store'

const POLL_MS = 8000
const time = (at: number) => new Date(at).toTimeString().slice(0, 5)

/** Public chat for everyone at the festival (opt-in module). Loaded on demand, polls while open. */
export function FestivalChat() {
  const { requireIdentity, toast } = useApp()
  const [messages, setMessages] = useState<PublicMessage[] | null>(null)
  const [text, setText] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const since = useRef(0)
  const end = useRef<HTMLDivElement>(null)

  const merge = useCallback((incoming: PublicMessage[]) => {
    setMessages((prev) => {
      const byId = new Map((prev ?? []).map((m) => [m.id, m]))
      for (const m of incoming) byId.set(m.id, m)
      return [...byId.values()].sort((a, b) => a.at - b.at).slice(-200)
    })
  }, [])

  useEffect(() => {
    let stop = false
    let timer = 0
    const poll = async () => {
      try {
        const r = await api.festivalChat(since.current || undefined)
        if (stop) return
        since.current = r.serverTime
        merge(r.messages)
      } catch {
        if (!stop) setMessages((m) => m ?? [])
      }
      if (!stop) timer = window.setTimeout(poll, POLL_MS)
    }
    poll()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [merge])

  const count = messages?.length ?? 0
  // block body: newer browsers return a Promise from scrollIntoView, which must not become the effect's cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' })
  }, [count])

  const send = () => {
    const msg = text.trim()
    if (!msg) return
    requireIdentity(t('Damit alle sehen, wer schreibt.'), async () => {
      setText('')
      try {
        merge([await api.postFestivalChat(msg, opId('fm'))])
      } catch (e) {
        setText(msg)
        toast(e instanceof ApiError ? e.message : t('Nicht gesendet'))
      }
    })
  }

  return (
    <>
      <div className="sheet-head" style={{ marginBottom: 10 }}>
        <div className="grow">
          <h2 style={{ fontSize: 24 }}>{t('Festival-Chat')}</h2>
          <div className="small muted">{t('Für alle bei {name}', { name: FESTIVAL.name })}</div>
        </div>
      </div>
      <p className="tiny faint row" style={{ gap: 6, marginTop: 0 }}>
        <ShieldCheck size={14} /> {t('Bleib freundlich. Was drei Personen melden, wird ausgeblendet; der Veranstalter moderiert.')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 300 }} aria-live="polite">
        {messages === null && <p className="muted small">{t('Lade …')}</p>}
        {messages?.length === 0 && (
          <div className="empty">
            <b>{t('Noch ruhig hier')}</b>
            {t('Schreib die erste Nachricht.')}
          </div>
        )}
        {messages?.map((m, i) => {
          const me = m.from === 'me'
          const showName = !me && messages[i - 1]?.from !== m.from
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: me ? 'flex-end' : 'flex-start' }}>
              {showName && (
                <span className="tiny faint row" style={{ margin: '8px 0 3px 4px', gap: 6 }}>
                  <span className="avatar" style={{ background: m.color, width: 16, height: 16, fontSize: 9 }} aria-hidden>
                    {m.name[0]}
                  </span>
                  {m.name} · {time(m.at)}
                </span>
              )}
              {m.text === null ? (
                <span className={`bubble ${me ? 'me' : 'them'} removed`}>{m.moderationReason ? t('Vom Veranstalter entfernt: {reason}', { reason: m.moderationReason }) : m.deleted ? t('Nachricht gelöscht') : t('Ausgeblendet – von mehreren gemeldet')}</span>
              ) : (
                <button className={`bubble ${me ? 'me' : 'them'}`} style={{ textAlign: 'left' }} onClick={() => setActive(active === m.id ? null : m.id)} aria-expanded={active === m.id}>
                  {m.text}
                </button>
              )}
              {me && m.hidden && !m.deleted && <span className="tiny faint">{t('Von mehreren gemeldet – für andere ausgeblendet')}</span>}
              {active === m.id && m.text !== null && (
                <div className="msg-actions">
                  {me ? (
                    <button
                      className="btn ghost sm"
                      onClick={async () => {
                        setActive(null)
                        if (!confirm(t('Nachricht für alle löschen?'))) return
                        await api.deleteFestivalChat(m.id).then(
                          () => merge([{ ...m, text: null, deleted: true }]),
                          () => toast(t('Etwas ist schiefgelaufen')),
                        )
                      }}
                    >
                      <Trash2 size={15} /> {t('Löschen')}
                    </button>
                  ) : (
                    !m.flaggedByMe && <ReportAbuse submit={async (reason) => {
                      const r = await api.flagFestivalChat(m.id, reason)
                      merge([{ ...m, flaggedByMe: true, hidden: r.hidden, text: r.hidden ? null : m.text }])
                    }} />
                  )}
                </div>
              )}
            </div>
          )
        })}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        style={{ position: 'sticky', bottom: 0, background: 'var(--bg-elev)', paddingBottom: 4 }}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input className="field" style={{ borderRadius: 99 }} placeholder={t('Nachricht an alle')} aria-label={t('Nachricht an alle')} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="icon-btn" style={{ background: 'var(--brand)', color: 'var(--brand-ink)', width: 48, height: 48, flex: 'none' }} aria-label={t('Senden')}>
          <Send size={19} />
        </button>
      </form>
    </>
  )
}
