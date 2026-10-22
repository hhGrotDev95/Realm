import { useEffect, useState } from 'react'
import { api, type FlagReason } from './api'
import { t } from './i18n'
import { useApp } from './store'

export function ReportAbuse({ submit, label }: { submit: (reason: FlagReason) => Promise<unknown>; label?: string }) {
  const { requireIdentity, toast } = useApp()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<FlagReason['category'] | ''>('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  if (sent) return <span className="small muted" role="status">{t('Gemeldet – danke')}</span>
  if (!open) return <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>{label ?? t('Melden')}</button>
  return (
    <form className="stack" aria-label={t('Inhalt melden')} style={{ gap: 8, width: '100%', minWidth: 0 }} onSubmit={async (e) => {
      e.preventDefault()
      if (!category || busy) return
      const reason: FlagReason = { category, detail: detail.trim() }
      requireIdentity(t('Meldungen brauchen einen Namen, damit Missbrauch erkennbar bleibt.'), async () => {
      setBusy(true)
      try {
        await submit(reason)
        setSent(true)
        toast(t('Gemeldet – danke'))
      } catch (err) {
        toast(err instanceof Error ? err.message : t('Etwas ist schiefgelaufen'))
      } finally {
        setBusy(false)
      }
      })
    }}>
      <label className="small">{t('Meldegrund')}
        <select className="field" aria-label={t('Meldegrund')} required value={category} onChange={(e) => setCategory(e.target.value as FlagReason['category'])}>
          <option value="">{t('Bitte auswählen')}</option>
          <option value="spam">{t('Spam oder Werbung')}</option>
          <option value="harassment">{t('Belästigung oder Drohung')}</option>
          <option value="hate">{t('Hass oder Diskriminierung')}</option>
          <option value="illegal">{t('Möglicherweise rechtswidriger Inhalt')}</option>
          <option value="other">{t('Anderer Grund')}</option>
        </select>
      </label>
      <label className="small">{t('Erläuterung (optional)')}
        <textarea className="field" maxLength={1000} rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <p className="tiny muted" style={{ margin: 0 }}>{t('Der Veranstalter erhält diesen Inhalt und deinen Meldegrund zur Prüfung. Das ist kein Notruf.')}</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn secondary sm" disabled={!category || busy}>{t('Meldung absenden')}</button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setOpen(false)}>{t('Abbrechen')}</button>
      </div>
    </form>
  )
}

export function ModerationInbox() {
  const { online, session } = useApp()
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.moderation>>>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!online || !session) return
    let stopped = false
    api.moderation().then((r) => { if (!stopped) setRows(r) }, () => { if (!stopped) setFailed(true) })
    return () => { stopped = true }
  }, [online, session?.id])
  if (!online || !session || (!rows.length && !failed)) return null
  return <section aria-label={t('Moderationsentscheidungen')} style={{ margin: '16px 0' }}>
    <h3>{t('Moderationsentscheidungen')}</h3>
    {failed && <p role="status">{t('Moderationsentscheidungen konnten nicht geladen werden. Öffne das Profil später erneut.')}</p>}
    {rows.map((r, i) => <div key={`${r.targetId}:${r.at}:${i}`} className="card small" style={{ marginBottom: 8, overflowWrap: 'anywhere' }}>
      <div className="tiny faint">{new Date(r.at).toLocaleString()} · {r.kind === 'report' ? t('Community-Meldung') : r.kind === 'crew' ? t('Crew-Chat') : t('Festival-Chat')}</div>
      {r.action === 'remove' ? t('Vom Veranstalter entfernt: {reason}', { reason: r.reason }) : t('Vom Veranstalter geprüft und beibehalten: {reason}', { reason: r.reason })}
    </div>)}
  </section>
}
