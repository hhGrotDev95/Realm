import { registerPlugin } from '@capacitor/core'
import { API_URL } from './api'
import { isNativeApp } from './platform'
import { DEFAULT_FESTIVAL } from './festival'
import { SessionVault, withoutSecrets, type SessionState } from './sessionVault'

interface NativeSession {
  read(options: { namespace: string }): Promise<{ value: string | null }>
  write(options: { namespace: string; value: string }): Promise<void>
}
const plugin = registerPlugin<NativeSession>('RealmSecureSession')
// Production native builds require an API URL (scripts/ios-config.mjs).
// The API-less browser demo also exercises native-shaped keyboard geometry.
const nativeCredentials = isNativeApp && !!API_URL
let vault: SessionVault | null = null
export async function bootSecureSession() {
  if (!nativeCredentials) return
  if (!API_URL) throw new Error('Native backend missing')
  const namespace = new URL(API_URL).origin
  vault = new SessionVault({
    read: async () => (await plugin.read({ namespace })).value,
    write: async value => { await plugin.write({ namespace, value }) },
  }, localStorage)
  await vault.initialize(`realm.v2:${DEFAULT_FESTIVAL}`)
}
export function hydrateSession<T extends SessionState>(key: string, state: T): T {
  if (!nativeCredentials) return state
  if (!vault) throw new Error('Session vault not ready')
  return vault.hydrate(key, state)
}
export const serializeSession = <T extends SessionState>(state: T) => JSON.stringify(nativeCredentials ? withoutSecrets(state) : state)
export async function commitSession<T extends SessionState>(key: string, state: T) {
  if (nativeCredentials) {
    if (!vault) throw new Error('Session vault not ready')
    await vault.commit(key, state)
  } else localStorage.setItem(key, JSON.stringify(state))
}
export const nativeSessionCredentials = () => vault?.allCredentials() ?? []
export async function clearSecureSessions() { if (vault) await vault.clear() }
