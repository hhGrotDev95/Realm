import { Scale } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../api'
import { FESTIVAL } from '../data'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')

/**
 * Legal notice, privacy information and minimum age (Welle 7). The texts are the operators' responsibility –
 * the console stores and shows them; going live needs an imprint and privacy information (festival or platform).
 */
export function LegalEditor({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [imprint, setImprint] = useState(FESTIVAL.legal.imprint ?? '')
  const [privacy, setPrivacy] = useState(FESTIVAL.legal.privacy ?? '')
  const [minAge, setMinAge] = useState(FESTIVAL.legal.minAge)
  const [platform, setPlatform] = useState<{ imprint: string; privacy: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    admin.me().then((m) => m.role === 'platform' && setPlatform({ imprint: FESTIVAL.legal.platform.imprint ?? '', privacy: FESTIVAL.legal.platform.privacy ?? '' }), () => {})
  }, [admin])
  const save = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      await reload()
      flash('ok', ok)
    } catch (e) {
      flash('err', errText(e))
    }
    setBusy(false)
  }
  const area = (label: string, value: string, set: (v: string) => void, hint: string) => (
    <label className="admin-field">
      <span>{label}</span>
      <textarea className="field" rows={8} value={value} onChange={(e) => set(e.target.value)} placeholder={hint} style={{ fontFamily: 'inherit', resize: 'vertical' }} />
    </label>
  )
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <h2 className="admin-h">
          <Scale size={18} style={{ verticalAlign: '-3px' }} /> Impressum & Datenschutz – {FESTIVAL.name}
        </h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Diese Texte verantwortet ihr als Veranstalter. Sie erscheinen in der App unter Profil → Impressum / Datenschutz, vor den Texten der Plattform. Ohne Impressum und Datenschutzhinweise (eigene oder der Plattform) lässt sich das Festival nicht veröffentlichen.
        </p>
        {area('Impressum', imprint, setImprint, 'Name, Anschrift, Kontakt, Vertretungsberechtigte …')}
        {area('Datenschutzhinweise', privacy, setPrivacy, 'Verantwortlicher, Zwecke, Rechtsgrundlagen, Speicherdauer, Rechte …')}
        <label className="admin-field" style={{ maxWidth: 260 }}>
          <span>Mindestalter für Crew & Community</span>
          <input className="field" type="number" min={0} max={21} value={minAge} onChange={(e) => setMinAge(Number(e.target.value))} />
        </label>
        <p className="tiny faint">Besucher:innen bestätigen beim ersten Namen, dass sie mindestens so alt sind (0 = kein Hinweis). Das ist ein Hinweis, keine Altersprüfung.</p>
        <button className="btn primary" disabled={busy} onClick={() => save(() => admin.setLegal(slug, { imprint: imprint.trim() || null, privacy: privacy.trim() || null, minAge }), 'Rechtstexte gespeichert')}>
          Speichern
        </button>
      </section>
      {platform && (
        <section className="card">
          <h2 className="admin-h">Plattform (für alle Festivals)</h2>
          {area('Impressum der Plattform', platform.imprint, (v) => setPlatform({ ...platform, imprint: v }), 'Betreiber der Plattform …')}
          {area('Datenschutzhinweise der Plattform', platform.privacy, (v) => setPlatform({ ...platform, privacy: v }), 'Hosting, Auftragsverarbeitung, Speicherdauer …')}
          <button className="btn secondary" disabled={busy} onClick={() => save(() => admin.setPlatformLegal({ imprint: platform.imprint.trim() || null, privacy: platform.privacy.trim() || null }), 'Plattform-Texte gespeichert')}>
            Plattform-Texte speichern
          </button>
        </section>
      )}
    </div>
  )
}
