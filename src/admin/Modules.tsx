import { useMemo, useState } from 'react'
import { adminApi } from '../api'
import { FESTIVAL } from '../data'
import { isEnabled, MODULE_KEYS, MODULES, type ModuleKey, type ModuleState } from '../modules'
import { Switch } from '../ui'

type Flash = (k: 'ok' | 'err', t: string) => void

export function Modules({ token, flash, slug, reload }: { token: string; flash: Flash; slug: string; reload: () => Promise<void> }) {
  const admin = useMemo(() => adminApi(token), [token])
  const [state, setState] = useState<ModuleState>(() => ({ ...FESTIVAL.modules }))
  const [busy, setBusy] = useState(false)
  const toggle = (k: ModuleKey, value: boolean) => {
    const next: ModuleState = { ...state, [k]: value }
    // switching a module off also switches off what depends on it; switching on turns on its requirements
    for (const other of MODULE_KEYS) {
      const needs = MODULES[other].requires as readonly ModuleKey[]
      if (!value && needs.includes(k)) next[other] = false
      if (value && other !== k && (MODULES[k].requires as readonly ModuleKey[]).includes(other)) next[other] = true
    }
    setState(next)
  }
  const dirty = MODULE_KEYS.some((k) => isEnabled(state, k) !== isEnabled(FESTIVAL.modules, k))
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await admin.setModules(slug, Object.fromEntries(MODULE_KEYS.map((k) => [k, isEnabled(state, k)])) as Record<ModuleKey, boolean>)
          await reload()
          flash('ok', 'Module gespeichert')
        } catch (err) {
          flash('err', err instanceof Error ? err.message : 'Fehler')
        }
        setBusy(false)
      }}
    >
      <h2 className="admin-h">Module</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Timetable, Plan, Karte und offizielle Meldungen sind immer dabei. Alles hier ist optional – ausgeschaltete Module verschwinden aus der App und werden auch vom Server abgelehnt.
      </p>
      <div className="list">
        {MODULE_KEYS.map((k) => {
          const m = MODULES[k]
          const enabled = isEnabled(state, k)
          const blockedBy = (m.requires as readonly ModuleKey[]).filter((r) => !isEnabled(state, r))
          return (
            <div key={k} className="list-item">
              <span className="grow">
                <span style={{ fontWeight: 600, display: 'block' }}>{m.label}</span>
                <span className="small faint">
                  {m.hint}
                  {blockedBy.length ? ` · braucht ${blockedBy.map((r) => MODULES[r].label).join(', ')}` : ''}
                </span>
              </span>
              <Switch on={enabled} onChange={(v) => toggle(k, v)} label={m.label} />
            </div>
          )
        })}
      </div>
      <button className="btn primary" style={{ marginTop: 14 }} disabled={busy || !dirty}>
        {dirty ? 'Module speichern' : 'Keine Änderungen'}
      </button>
    </form>
  )
}
