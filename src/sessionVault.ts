/** Native credential boundary. This module has no browser/Capacitor dependency so crash
 * recovery and migration can be tested with synthetic credentials. */
export interface Credential { id: string; token: string; recoveryCode?: string }
export interface SessionState {
  session: { id: string; token?: string } | null
  guest: { id: string; recoveryCode?: string }
  signedOut?: boolean
  sessionRevision?: string
}
export interface SecureItem { read(): Promise<string | null>; write(value: string): Promise<void> }
type Slot = { credential: Credential | null; revision: string }
type Vault = { version: 1; slots: Record<string, Slot> }
const profileKey = (key: string) => key === 'realm.v2' || key.startsWith('realm.v2:')
const journalKey = (key: string) => 'realm.session.pending:' + key
const validCredential = (v: unknown): v is Credential => {
  if (!v || typeof v !== 'object') return false
  const c = v as Credential
  return typeof c.id === 'string' && !!c.id && typeof c.token === 'string' && !!c.token && (c.recoveryCode === undefined || typeof c.recoveryCode === 'string')
}
export function withoutSecrets<T extends SessionState>(state: T): T {
  const guest = { ...state.guest }
  delete guest.recoveryCode
  return { ...state, guest, session: state.session ? { id: state.session.id } : null }
}
function credentials(state: SessionState): Credential | null {
  if (!state.session) return null
  const c = { ...state.session, recoveryCode: state.guest.recoveryCode }
  if (!validCredential(c) || c.id !== state.guest.id) throw new Error('Invalid session')
  return c
}

export class SessionVault {
  private data: Vault = { version: 1, slots: {} }
  private ready = false
  private item: SecureItem
  private local: Storage
  constructor(item: SecureItem, local: Storage) { this.item = item; this.local = local }

  /** Keychain failure is fatal to bootstrap: absence and unreadability differ. */
  async initialize(legacyDestination?: string) {
    const raw = await this.item.read()
    if (raw !== null) {
      const data = JSON.parse(raw) as Vault
      if (data.version !== 1 || !data.slots || typeof data.slots !== 'object' || Array.isArray(data.slots)) throw new Error('Invalid vault')
      for (const [key, slot] of Object.entries(data.slots)) {
        if (!profileKey(key) || !slot || typeof slot.revision !== 'string' || (slot.credential !== null && !validCredential(slot.credential))) throw new Error('Invalid vault')
      }
      this.data = data
    }
    // A committed identity transition can be completed after a process termination.
    for (const key of Object.keys(this.data.slots)) {
      const pending = this.local.getItem(journalKey(key))
      if (!pending) continue
      const p = JSON.parse(pending)
      const current = this.local.getItem(key)
      if (p.revision === this.data.slots[key].revision && (!current || JSON.parse(current).sessionRevision !== p.revision)) this.local.setItem(key, JSON.stringify(withoutSecrets(p.state)))
      this.local.removeItem(journalKey(key))
    }
    const keys = Object.keys(this.local).filter(profileKey)
    const scrub: [string, string][] = []
    let changed = false
    for (const key of keys) {
      const state = JSON.parse(this.local.getItem(key)!) as SessionState
      if (!state || !state.guest || typeof state.guest.id !== 'string') throw new Error('Invalid profile')
      // An explicit null slot is a tombstone: old plaintext copies cannot revive logout.
      if (!Object.hasOwn(this.data.slots, key)) {
        // ThisDeviceOnly items do not migrate to a new phone with a device backup.
        // An id-only marker is recoverable signed-out state, never a boot failure.
        const credential = state.session?.token !== undefined ? credentials(state) : null
        if (state.session && !credential) state.signedOut = true
        this.data.slots[key] = { credential, revision: '' }
        changed = true
      }
      scrub.push([key, JSON.stringify(withoutSecrets(state))])
    }
    if (legacyDestination && !this.local.getItem(legacyDestination) && this.local.getItem('realm.v2')) {
      // The old single-festival key and its new name must share the migrated credential.
      if (!Object.hasOwn(this.data.slots, legacyDestination)) {
        this.data.slots[legacyDestination] = { ...this.data.slots['realm.v2'] }
        changed = true
      }
      scrub.push([legacyDestination, JSON.stringify(withoutSecrets(JSON.parse(this.local.getItem('realm.v2')!)))])
    }
    // Keychain may outlive an uninstall. Unmatched old credentials must neither
    // sign in nor participate in a later deletion from a fresh installation.
    for (const [key, slot] of Object.entries(this.data.slots)) {
      if (slot.credential && !this.local.getItem(key) && !scrub.some(([k]) => k === key)) {
        this.data.slots[key] = { credential: null, revision: '' }
        changed = true
      }
    }
    if (changed) await this.item.write(JSON.stringify(this.data))
    // Do not erase the only recoverable token until the native write has succeeded.
    for (const [key, clean] of scrub) this.local.setItem(key, clean)
    this.ready = true
  }

  hydrate<T extends SessionState>(key: string, state: T): T {
    if (!this.ready) throw new Error('Session vault not ready')
    const clean = withoutSecrets(state)
    const credential = this.data.slots[key]?.credential
    // Reinstall or unrelated state must never silently resurrect a Keychain identity.
    if (!credential || clean.session?.id !== credential.id || clean.guest.id !== credential.id) {
      return { ...clean, session: null, signedOut: clean.signedOut || !!clean.session }
    }
    return { ...clean, session: { id: credential.id, token: credential.token }, guest: { ...clean.guest, recoveryCode: credential.recoveryCode } }
  }

  /** Caller serializes auth operations and blocks UI writes for this short transaction.
   * Stage non-secret state first; Keychain commit is the identity commit point. */
  async commit<T extends SessionState>(key: string, state: T) {
    if (!this.ready) throw new Error('Session vault not ready')
    const revision = crypto.randomUUID()
    state.sessionRevision = revision
    const clean = withoutSecrets(state)
    this.local.setItem(journalKey(key), JSON.stringify({ revision, state: clean }))
    const slots = { ...this.data.slots }
    const credential = credentials(state)
    // A restored profile rotates its global bearer. Refresh still-active aliases.
    if (credential) for (const [otherKey, slot] of Object.entries(slots)) {
      if (slot.credential?.id === credential.id) slots[otherKey] = { ...slot, credential }
    }
    if (!state.session) for (const [otherKey, slot] of Object.entries(slots)) {
      if (slot.credential?.id === state.guest.id) slots[otherKey] = { credential: null, revision }
    }
    const next: Vault = { version: 1, slots: { ...slots, [key]: { credential, revision } } }
    await this.item.write(JSON.stringify(next))
    this.data = next
    // After the commit point, promotion failure is recoverable from the journal.
    try {
      this.local.setItem(key, JSON.stringify(clean))
      this.local.removeItem(journalKey(key))
    } catch { /* next bootstrap completes the committed journal */ }
  }

  allTokens(): string[] {
    return [...new Set(Object.values(this.data.slots).flatMap(s => s.credential ? [s.credential.token] : []))]
  }
  allCredentials(): Credential[] {
    return Object.values(this.data.slots).flatMap(s => s.credential ? [s.credential] : [])
  }

  async clear() {
    const slots = Object.fromEntries(Object.keys(this.data.slots).map(key => [key, { credential: null, revision: crypto.randomUUID() }]))
    const next: Vault = { version: 1, slots }
    await this.item.write(JSON.stringify(next))
    this.data = next
    for (const key of Object.keys(slots)) this.local.removeItem(journalKey(key))
  }
}
