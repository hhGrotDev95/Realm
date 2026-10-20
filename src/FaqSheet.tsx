import { AnimatePresence, m as motion } from 'framer-motion'
import { Bot, ChevronDown, Info, Search, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FAQS, on, POIS } from './data'
import { ask, type BotAnswer, type Faq } from './faq/match'
import { useApp } from './store'
import { locale, t } from './i18n'

const stand = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' })

function Source({ f }: { f: Faq }) {
  return (
    <span className="tiny faint">
      {t('Quelle: {source} · Stand {date}', { source: f.source || t('Veranstalter'), date: stand(f.updatedAt) })}
    </span>
  )
}

/** Infos & FAQ with the FAQ bot. The bot only ever shows approved answers. */
export function FaqSheet({ q: initial }: { q?: string }) {
  const { openSheet } = useApp()
  const [q, setQ] = useState(initial ?? '')
  const [result, setResult] = useState<(BotAnswer & { q: string }) | null>(() => (initial ? { ...ask(initial, FAQS), q: initial } : null))
  const [cat, setCat] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const bot = on('faqbot')
  const cats = useMemo(() => [...new Set(FAQS.map((f) => f.category))], [])
  const info = POIS.find((p) => p.cat === 'info')
  const list = FAQS.filter((f) => (!cat || f.category === cat) && (!filter || (f.question + ' ' + f.answer + ' ' + (f.keywords ?? '')).toLowerCase().includes(filter.toLowerCase())))

  return (
    <>
      <div className="sheet-head">
        <div className="grow">
          <h2 style={{ fontSize: 26 }}>{t('Infos & FAQ')}</h2>
          <div className="small muted">{t('{n} Antworten vom Veranstalter', { n: FAQS.length })}</div>
        </div>
      </div>

      {bot && (
        <section className="faq-bot" aria-label={t('Festival-Bot')}>
          <form
            className="chat-input"
            style={{ paddingTop: 0 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (q.trim()) setResult({ ...ask(q, FAQS), q: q.trim() })
            }}
          >
            <input className="field" style={{ borderRadius: 99 }} placeholder={t('Frag den Festival-Bot, z. B. „Wo kann ich mein Handy laden?“')} aria-label={t('Frage an den Festival-Bot')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="icon-btn" style={{ background: 'var(--brand)', color: 'var(--brand-ink)', width: 48, height: 48, flex: 'none' }} aria-label={t('Fragen')}>
              <Send size={19} />
            </button>
          </form>
          <AnimatePresence mode="wait">
            {result && (
              <motion.div key={result.q} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="faq-answer" role="status" aria-live="polite">
                <div className="row small faint" style={{ gap: 6, marginBottom: 6 }}>
                  <Bot size={15} /> {t('Festival-Bot')}
                </div>
                {result.kind === 'answer' && result.faq ? (
                  <>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{result.faq.question}</div>
                    <p style={{ margin: '0 0 8px' }}>{result.faq.answer}</p>
                    <Source f={result.faq} />
                  </>
                ) : (
                  <>
                    <p style={{ margin: '0 0 8px' }}>
                      {t('Dazu habe ich keine freigegebene Antwort – und raten will ich nicht.')}
                      {result.suggestions.length ? ' ' + t('Meintest du vielleicht:') : ''}
                    </p>
                    {!result.suggestions.length && info && (
                      <button className="btn ghost sm" style={{ paddingLeft: 0 }} onClick={() => openSheet({ kind: 'poi', id: info.id })}>
                        <Info size={15} /> {t('Frag am {place}', { place: info.name })}
                      </button>
                    )}
                  </>
                )}
                {result.suggestions.length > 0 && (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {result.suggestions.map((s) => (
                      <button key={s.id} className="chip" onClick={() => setResult({ kind: 'answer', faq: s, suggestions: [], score: 0, q: s.question })}>
                        {s.question}
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      <div className="search" style={{ margin: '18px 0 10px' }}>
        <Search size={18} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('FAQ durchsuchen')} aria-label={t('FAQ durchsuchen')} />
      </div>
      <div className="chips" style={{ marginBottom: 8 }}>
        <button className={`chip ${!cat ? 'on' : ''}`} aria-pressed={!cat} onClick={() => setCat(null)}>
          {t('Alle')}
        </button>
        {cats.map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="list">
        {list.map((f) => (
          <div key={f.id} className="faq-item">
            <button className="list-item" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>
              <span className="grow" style={{ fontWeight: 600 }}>
                {f.question}
              </span>
              <ChevronDown size={18} className="faint" style={{ transform: open === f.id ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
            </button>
            {open === f.id && (
              <div style={{ padding: '0 0 14px' }}>
                <p className="muted" style={{ margin: '0 0 6px' }}>
                  {f.answer}
                </p>
                <Source f={f} />
              </div>
            )}
          </div>
        ))}
        {!list.length && (
          <div className="empty">
            <b>{t('Nichts gefunden')}</b>
            {FAQS.length ? t('Versuch es mit einem anderen Begriff.') : t('Der Veranstalter hat noch keine FAQ veröffentlicht.')}
          </div>
        )}
      </div>
    </>
  )
}
