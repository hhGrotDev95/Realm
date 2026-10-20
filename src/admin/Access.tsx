import { KeyRound, LogOut, MailPlus, RefreshCw, ShieldCheck, UserMinus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApi, ApiError, authApi, type AdminMe } from '../api'

type Flash = (k: 'ok' | 'err', t: string) => void
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Fehler')
const when = (ts: number) => new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })

/** The invitation token from a link like /#admin?invite=… */
export const inviteFromUrl = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('invite')

/**
 * Sign-in for organizer accounts (audit F01): password, then the authenticator code. A first login (or an
 * accepted invitation) sets up the authenticator app before anything else works. The platform key remains
 * as a fallback for the platform operator.
 */
export function SignIn({ onReady }: { onReady: (token: string) => void }) {
  const invite = inviteFromUrl()
  const [step, setStep] = useState<{ kind: 'password' } | { kind: 'key' } | { kind: 'accept' } | { kind: 'verify' | 'setup'; token: string }>(invite ? { kind: 'accept' } : { kind: 'password' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(errText(e))
    }
    setBusy(false)
  }
  const signedIn = (r: { token: string; mfa: 'verify' | 'setup' }) => setStep({ kind: r.mfa, token: r.token })
  return (
    <div className="card admin-login">
      {step.kind === 'password' && <PasswordForm busy={busy} onSubmit={(email, pw) => run(async () => signedIn(await authApi.login(email, pw)))} />}
      {step.kind === 'accept' && (
        <AcceptForm
          busy={busy}
          onSubmit={(name, pw) =>
            run(async () => {
              const r = await authApi.accept(invite!, name, pw)
              history.replaceState(null, '', location.pathname + '#admin')
              signedIn(r)
            })
          }
        />
      )}
      {step.kind === 'verify' && <CodeForm busy={busy} onSubmit={(code) => run(async () => (await authApi.totp(step.token, code), onReady(step.token)))} />}
      {step.kind === 'setup' && <TotpSetup token={step.token} onDone={() => onReady(step.token)} />}
      {step.kind === 'key' && <KeyForm busy={busy} onSubmit={(key) => run(async () => (await adminApi(key).check(), onReady(key)))} />}
      {err && (
        <p className="small" role="alert" style={{ color: 'var(--crit)' }}>
          {err}
        </p>
      )}
      {(step.kind === 'password' || step.kind === 'key') && (
        <button type="button" className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => (setErr(null), setStep(step.kind === 'key' ? { kind: 'password' } : { kind: 'key' }))}>
          {step.kind === 'key' ? 'Mit E-Mail und Passwort anmelden' : 'Plattform-Schlüssel verwenden'}
        </button>
      )}
    </div>
  )
}

function PasswordForm({ busy, onSubmit }: { busy: boolean; onSubmit: (email: string, pw: string) => void }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  return (
    <form onSubmit={(e) => (e.preventDefault(), onSubmit(email.trim(), pw))}>
      <h1 className="h-display" style={{ fontSize: 28 }}>
        Anmelden
      </h1>
      <p className="small muted">Dein persönliches Veranstalter-Konto. Danach fragt die Konsole nach dem Code aus deiner Authenticator-App.</p>
      <label className="admin-field">
        <span>E-Mail</span>
        <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label className="admin-field">
        <span>Passwort</span>
        <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
      </label>
      <button className="btn primary block" disabled={busy || !email.trim() || !pw}>
        {busy ? 'Prüfe …' : 'Weiter'}
      </button>
    </form>
  )
}

function AcceptForm({ busy, onSubmit }: { busy: boolean; onSubmit: (name: string, pw: string) => void }) {
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const short = pw.length > 0 && pw.length < 12
  return (
    <form onSubmit={(e) => (e.preventDefault(), onSubmit(name.trim(), pw))}>
      <h1 className="h-display" style={{ fontSize: 28 }}>
        Einladung annehmen
      </h1>
      <p className="small muted">Du wurdest in die Veranstalter-Konsole eingeladen. Lege Namen und Passwort fest – hast du schon ein Konto mit dieser E-Mail, gib dessen Passwort ein.</p>
      <label className="admin-field">
        <span>Dein Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <label className="admin-field">
        <span>Passwort (mindestens 12 Zeichen)</span>
        <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" aria-invalid={short} />
      </label>
      <label className="admin-field">
        <span>Passwort wiederholen</span>
        <input className="field" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      </label>
      {pw2 && pw !== pw2 && <p className="small" style={{ color: 'var(--warn)' }}>Die Passwörter stimmen nicht überein.</p>}
      <button className="btn primary block" disabled={busy || name.trim().length < 2 || pw.length < 12 || pw !== pw2}>
        Konto anlegen
      </button>
    </form>
  )
}

function CodeForm({ busy, onSubmit, label = 'Bestätigen' }: { busy: boolean; onSubmit: (code: string) => void; label?: string }) {
  const [code, setCode] = useState('')
  return (
    <form onSubmit={(e) => (e.preventDefault(), onSubmit(code.replace(/\s/g, '')))}>
      <h2 className="admin-h">Code aus der Authenticator-App</h2>
      <label className="admin-field">
        <span>6-stelliger Code</span>
        <input className="field" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} style={{ letterSpacing: '0.2em', fontWeight: 600 }} />
      </label>
      <button className="btn primary block" disabled={busy || code.replace(/\s/g, '').length !== 6}>
        {label}
      </button>
    </form>
  )
}

/** First login: connect an authenticator app (secret shown once), confirm with its first code. */
function TotpSetup({ token, onDone }: { token: string; onDone: () => void }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [s, setS] = useState<{ secret: string; uri: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    admin.totpSetup().then(setS, (e) => setErr(errText(e)))
  }, [admin])
  return (
    <div>
      <h1 className="h-display" style={{ fontSize: 26 }}>
        Zwei-Faktor einrichten
      </h1>
      <p className="small muted">Ohne zweiten Faktor bleibt die Konsole gesperrt. Füge in deiner Authenticator-App (z. B. Aegis, 2FAS, Google oder Microsoft Authenticator) ein Konto mit diesem Schlüssel hinzu:</p>
      {s && (
        <>
          <code className="card" style={{ display: 'block', wordBreak: 'break-all', fontSize: 15, letterSpacing: '0.08em' }} aria-label="Geheimer Schlüssel">
            {s.secret.match(/.{1,4}/g)!.join(' ')}
          </code>
          <p className="tiny faint" style={{ wordBreak: 'break-all' }}>
            Oder auf dem Handy öffnen: <a href={s.uri}>{s.uri}</a>
          </p>
          <CodeForm
            busy={busy}
            label="Einrichtung abschließen"
            onSubmit={async (code) => {
              setBusy(true)
              setErr(null)
              try {
                await admin.totpEnable(code)
                onDone()
              } catch (e) {
                setErr(errText(e))
              }
              setBusy(false)
            }}
          />
        </>
      )}
      {err && (
        <p className="small" role="alert" style={{ color: 'var(--crit)' }}>
          {err}
        </p>
      )}
    </div>
  )
}

function KeyForm({ busy, onSubmit }: { busy: boolean; onSubmit: (key: string) => void }) {
  const [t, setT] = useState('')
  return (
    <form onSubmit={(e) => (e.preventDefault(), onSubmit(t.trim()))}>
      <h1 className="h-display" style={{ fontSize: 28 }}>
        Plattform-Schlüssel
      </h1>
      <p className="small muted">Nur für die Plattform-Verwaltung, z. B. um das erste Konto einzuladen. Veranstalter:innen melden sich mit ihrem eigenen Konto an.</p>
      <label className="admin-field">
        <span>Schlüssel</span>
        <input className="field" type="password" value={t} onChange={(e) => setT(e.target.value)} autoComplete="current-password" />
      </label>
      <button className="btn primary block" disabled={busy || !t.trim()}>
        Anmelden
      </button>
    </form>
  )
}

/** Checks a stored token on load: still valid and unlocked? */
export async function sessionState(token: string): Promise<'ready' | 'gone'> {
  try {
    const me = await adminApi(token).me()
    return me.mfa ? 'ready' : 'gone'
  } catch (e) {
    return e instanceof ApiError && e.status === 0 ? 'ready' : 'gone'
  }
}

/** Console tab "Zugang": own account and sessions, who else manages this festival, invitations, change log. */
export function AccessPanel({ token, flash, slug }: { token: string; flash: Flash; slug: string }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [me, setMe] = useState<AdminMe | null>(null)
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof admin.sessions>>>([])
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof admin.accounts>>>([])
  const [log, setLog] = useState<Awaited<ReturnType<typeof admin.audit>>>([])
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const m = await admin.me()
      setMe(m)
      const [s, a, l] = await Promise.all([m.personal ? admin.sessions() : Promise.resolve([]), admin.accounts(slug), admin.audit(slug)])
      setSessions(s)
      setAccounts(a)
      setLog(l)
    } catch (e) {
      flash('err', errText(e))
    }
  }, [admin, slug, flash])
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
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ gap: 10 }}>
          <h2 className="admin-h grow" style={{ margin: 0 }}>
            Dein Zugang
          </h2>
          <button type="button" className="btn ghost sm" onClick={load}>
            <RefreshCw size={15} /> Aktualisieren
          </button>
        </div>
        {me && (
          <p className="small" style={{ marginBottom: 0 }}>
            <b>{me.name}</b>
            {me.email ? ` · ${me.email}` : ''} · {me.role === 'platform' ? 'Plattform-Verwaltung (alle Festivals)' : `Veranstalter:in für ${me.festivals.length} Festival${me.festivals.length === 1 ? '' : 's'}`}
            {me.personal && (
              <span className="tag ok" style={{ marginLeft: 8 }}>
                <ShieldCheck size={12} /> Zwei-Faktor aktiv
              </span>
            )}
          </p>
        )}
        {me && !me.personal && <p className="small" style={{ color: 'var(--warn)' }}>Du nutzt den gemeinsamen Plattform-Schlüssel. Lade dich selbst mit einem persönlichen Konto ein und nutze den Schlüssel nur im Notfall.</p>}
        {sessions.length > 0 && (
          <>
            <div className="label" style={{ margin: '14px 0 6px' }}>
              Angemeldete Geräte
            </div>
            <div className="list">
              {sessions.map((x) => (
                <div key={x.id} className="list-item small">
                  <span className="grow">
                    {x.agent?.slice(0, 60) || 'Unbekanntes Gerät'}
                    <span className="tiny faint" style={{ display: 'block' }}>
                      zuletzt {when(x.lastSeen)} · läuft ab {when(x.expiresAt)}
                      {x.current ? ' · dieses Gerät' : ''}
                    </span>
                  </span>
                  {!x.current && (
                    <button type="button" className="btn ghost sm" onClick={() => act(() => admin.revokeSession(x.id), 'Sitzung beendet')}>
                      <LogOut size={15} /> Abmelden
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="admin-h">Wer dieses Festival verwaltet</h2>
        <div className="list">
          {accounts.map((a) => (
            <div key={a.id} className="list-item small">
              <span className="grow">
                {a.name} <span className="faint">· {a.email}</span>
                {!a.totp && <span className="tag warn" style={{ marginLeft: 8 }}>2FA fehlt</span>}
                {a.disabled && <span className="tag warn" style={{ marginLeft: 8 }}>deaktiviert</span>}
              </span>
              <button type="button" className="btn ghost sm" aria-label={`${a.name} den Zugang entziehen`} onClick={() => confirm(`${a.name} den Zugang zu diesem Festival entziehen?`) && act(() => admin.removeAccess(a.id, slug), 'Zugang entzogen')}>
                <UserMinus size={15} /> Entziehen
              </button>
            </div>
          ))}
          {!accounts.length && <p className="small muted">Noch keine persönlichen Konten für dieses Festival.</p>}
        </div>
        <form
          className="row"
          style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault()
            act(async () => {
              const inv = await admin.invite(email.trim(), slug)
              setLink(`${location.origin}${location.pathname}#admin?invite=${inv.token}`)
              setEmail('')
            }, 'Einladung erstellt')
          }}
        >
          <input className="field grow" type="email" placeholder="E-Mail der Person" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-Mail für die Einladung" style={{ minWidth: 200 }} />
          <button className="btn secondary" disabled={!email.includes('@')}>
            <MailPlus size={16} /> Einladen
          </button>
        </form>
        {link && (
          <div className="alert info" style={{ marginTop: 10 }} role="status">
            <KeyRound size={18} />
            <span className="grow">
              <strong>Einmal-Link (7 Tage gültig) – sicher weitergeben:</strong>
              <code className="small" style={{ display: 'block', wordBreak: 'break-all' }} data-invite-link>
                {link}
              </code>
            </span>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="admin-h">Änderungsprotokoll</h2>
        {log.length === 0 ? (
          <p className="small muted">Noch keine Änderungen protokolliert.</p>
        ) : (
          <div className="list" aria-label="Änderungsprotokoll">
            {log.map((l, i) => (
              <div key={i} className="list-item small">
                <span className="faint" style={{ minWidth: 110 }}>
                  {when(l.at)}
                </span>
                <span style={{ minWidth: 90, fontWeight: 600 }}>{l.by}</span>
                <span className="grow" style={{ wordBreak: 'break-all' }}>
                  {l.action}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
