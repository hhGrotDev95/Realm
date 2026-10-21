import type { ModerationFlag } from '../api'

const labels: Record<string, string> = { spam: 'Spam oder Werbung', harassment: 'Belästigung oder Drohung', hate: 'Hass oder Diskriminierung', illegal: 'Möglicherweise rechtswidriger Inhalt', other: 'Anderer Grund' }

export function FlagReasons({ reasons }: { reasons: ModerationFlag[] }) {
  if (!reasons.length) return null
  return <ul className="small muted" aria-label="Meldegründe" style={{ paddingLeft: 18 }}>
    {reasons.map((r, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{labels[r.category] ?? r.category}{r.detail ? `: ${r.detail}` : ''}</li>)}
  </ul>
}

export function DecisionReason({ value, change }: { value: string; change: (s: string) => void }) {
  return <label className="admin-field small" style={{ width: '100%', marginTop: 8 }}>
    <span>Begründung der Entscheidung</span>
    <textarea className="field" value={value} onChange={(e) => change(e.target.value)} minLength={3} maxLength={1000} rows={3} required />
    <span className="tiny muted">Pflichtfeld: Sachverhalt und zutreffende Regel oder Rechtsgrundlage nennen. Die betroffene Person sieht diese Begründung; keine Daten anderer Personen eintragen.</span>
  </label>
}
