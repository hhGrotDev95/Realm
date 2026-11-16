import assert from 'node:assert/strict'
import { SessionVault, type SecureItem, type SessionState } from '../src/sessionVault.ts'
import { deleteProfiles } from '../src/profileDeletion.ts'

type Faults = { set?: (key: string, value: string) => void; remove?: (key: string) => void }

function storage(initial: Record<string, string> = {}, faults: Faults = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  const target = {
    data,
    get length() { return data.size },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      faults.set?.(key, value)
      data.set(key, String(value))
    },
    removeItem: (key: string) => {
      faults.remove?.(key)
      data.delete(key)
    },
    clear: () => data.clear(),
  }
  // Storage exposes stored keys through Object.keys(storage), which initialize uses.
  return new Proxy(target, {
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_target, key) => typeof key === 'string' && data.has(key)
      ? { configurable: true, enumerable: true, writable: true, value: data.get(key) }
      : undefined,
  }) as Storage & { data: Map<string, string> }
}

function nativeItem(raw: string | null = null, options: { readError?: Error; writeError?: Error } = {}) {
  let value = raw
  let reads = 0
  let writes = 0
  const item: SecureItem = {
    read: async () => {
      reads++
      if (options.readError) throw options.readError
      return value
    },
    write: async next => {
      writes++
      if (options.writeError) throw options.writeError
      value = next
    },
  }
  return { item, get value() { return value }, get reads() { return reads }, get writes() { return writes } }
}

const profile = (id: string, token?: string, recoveryCode?: string, extra: Record<string, unknown> = {}): SessionState => ({
  plan: ['plan-' + id],
  outbox: [{ id: 'pending-' + id }],
  ...extra,
  guest: { id, ...(recoveryCode ? { recoveryCode } : {}) },
  session: token ? { id, token } : null,
}) as SessionState

const parseVault = (raw: string | null) => JSON.parse(raw!) as { version: number; slots: Record<string, { credential: { id: string; token: string; recoveryCode?: string } | null }> }
let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log('✓', name)
}

await check('legacy migration preserves every profile and scrubs only after native credentials are stored', async () => {
  const source = {
    'realm.v2': JSON.stringify(profile('festival-one', 'one-token', 'one-recovery', { preferences: { language: 'cs' } })),
    'realm.v2:festival-two': JSON.stringify(profile('festival-two', 'two-token', 'two-recovery', { plan: ['festival-two-plan'] })),
    unrelated: 'leave me',
  }
  const local = storage(source)
  const native = nativeItem()
  await new SessionVault(native.item, local).initialize()

  assert.deepEqual(JSON.parse(local.getItem('realm.v2')!), {
    plan: ['plan-festival-one'], outbox: [{ id: 'pending-festival-one' }], preferences: { language: 'cs' },
    guest: { id: 'festival-one' }, session: { id: 'festival-one' },
  })
  assert.deepEqual(JSON.parse(local.getItem('realm.v2:festival-two')!), {
    plan: ['festival-two-plan'], outbox: [{ id: 'pending-festival-two' },], guest: { id: 'festival-two' }, session: { id: 'festival-two' },
  })
  assert.equal(local.getItem('unrelated'), 'leave me')
  assert.deepEqual(parseVault(native.value).slots['realm.v2'].credential, { id: 'festival-one', token: 'one-token', recoveryCode: 'one-recovery' })
  assert.deepEqual(parseVault(native.value).slots['realm.v2:festival-two'].credential, { id: 'festival-two', token: 'two-token', recoveryCode: 'two-recovery' })
  assert.deepEqual(new SessionVault(native.item, storage()).allTokens(), [], 'a separate vault has no in-memory credentials')
})

await check('keychain absence initializes an empty vault while a keychain read failure is fatal', async () => {
  const absent = nativeItem()
  const vault = new SessionVault(absent.item, storage())
  await vault.initialize()
  assert.deepEqual(vault.allTokens(), [])
  const failed = new SessionVault(nativeItem(null, { readError: new Error('keychain unavailable') }).item, storage())
  await assert.rejects(failed.initialize(), /keychain unavailable/)
  assert.throws(() => failed.hydrate('realm.v2', profile('guest')), /not ready/)
})

await check('failed migration write leaves all legacy plaintext recoverable', async () => {
  const raw = JSON.stringify(profile('legacy', 'legacy-token', 'legacy-code', { plan: ['keep'] }))
  const local = storage({ 'realm.v2:legacy': raw })
  const native = nativeItem(null, { writeError: new Error('write denied') })
  await assert.rejects(new SessionVault(native.item, local).initialize(), /write denied/)
  assert.equal(local.getItem('realm.v2:legacy'), raw)
  assert.equal(native.writes, 1)
})

await check('corrupt native vault and corrupt profile data both fail bootstrap', async () => {
  await assert.rejects(new SessionVault(nativeItem('{').item, storage()).initialize(), SyntaxError)
  await assert.rejects(new SessionVault(nativeItem('{"version":1,"slots":{"realm.v2":{}}}').item, storage()).initialize(), /Invalid vault/)
  await assert.rejects(new SessionVault(nativeItem().item, storage({ 'realm.v2': '{' })).initialize(), SyntaxError)
})

await check('credentials rehydrate after restart only for the matching profile identity', async () => {
  const local = storage()
  const native = nativeItem()
  const first = new SessionVault(native.item, local)
  await first.initialize()
  await first.commit('realm.v2:camp', profile('member-42', 'secret-token', 'recovery-42', { plan: ['saved'] }))
  const restarted = new SessionVault(native.item, local)
  await restarted.initialize()
  assert.deepEqual(restarted.hydrate('realm.v2:camp', profile('member-42', 'persisted-marker', undefined, { plan: ['saved'] })), {
    plan: ['saved'], outbox: [{ id: 'pending-member-42' }], guest: { id: 'member-42', recoveryCode: 'recovery-42' },
    session: { id: 'member-42', token: 'secret-token' },
  })
  const mismatched = restarted.hydrate('realm.v2:camp', profile('someone-else', undefined, undefined))
  assert.equal(mismatched.session, null)
  assert.equal(mismatched.signedOut, false)
})

await check('logout tombstone prevents any old plaintext copy from restoring credentials', async () => {
  const local = storage({ 'realm.v2:camp': JSON.stringify(profile('member', 'old-token', 'old-code')) })
  const native = nativeItem()
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  await vault.commit('realm.v2:camp', profile('member', undefined, undefined, { plan: ['after-logout'] }))
  local.setItem('realm.v2:camp', JSON.stringify(profile('member', 'old-token', 'old-code')))
  const restarted = new SessionVault(native.item, local)
  await restarted.initialize()
  const recovered = restarted.hydrate('realm.v2:camp', profile('member', undefined, undefined))
  assert.equal(recovered.session, null)
  assert.equal(recovered.guest.recoveryCode, undefined)
  assert.deepEqual(restarted.allTokens(), [])
})

await check('reinstall prunes orphan credentials so they cannot be adopted or included in later deletion', async () => {
  const native = nativeItem(JSON.stringify({ version: 1, slots: { 'realm.v2:old-device': { credential: { id: 'real-member', token: 'secret' }, revision: 'r1' } } }))
  const local = storage({ 'realm.v2:new-install': JSON.stringify(profile('real-member', undefined, undefined, { plan: ['fresh'] })) })
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  const state = vault.hydrate('realm.v2:new-install', profile('real-member'))
  assert.equal(state.session, null)
  assert.equal(state.signedOut, false)
  assert.deepEqual(vault.allTokens(), [], 'the unmatched reinstall-era credential is tombstoned during bootstrap')
  assert.deepEqual(vault.allCredentials(), [])
  let deletionRequests = 0
  await deleteProfiles(local, vault.allCredentials().map(({ id, token }) => ({ id, token })), async () => { deletionRequests++ })
  assert.equal(deletionRequests, 0)
})

await check('failed native commit rolls back a staged identity transition on restart', async () => {
  const old = { credential: { id: 'old-member', token: 'old-token' }, revision: 'old-revision' }
  const native = nativeItem(JSON.stringify({ version: 1, slots: { 'realm.v2:camp': old } }))
  const local = storage({ 'realm.v2:camp': JSON.stringify(profile('old-member')) })
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  const writeDenied = new Error('native write failed')
  // Fail the next write only, preserving the committed native value.
  const flaky = { read: native.item.read, write: async (_value: string) => { throw writeDenied } }
  const failedCommit = new SessionVault(flaky, local)
  await failedCommit.initialize()
  await assert.rejects(failedCommit.commit('realm.v2:camp', profile('new-member', 'new-token')), /native write failed/)
  const restarted = new SessionVault(native.item, local)
  await restarted.initialize()
  assert.equal(local.getItem('realm.session.pending:realm.v2:camp'), null)
  assert.deepEqual(restarted.hydrate('realm.v2:camp', profile('old-member', 'persisted-marker')).session, { id: 'old-member', token: 'old-token' })
})

await check('restart promotes a committed journal after local profile promotion fails', async () => {
  let failPromotion = false
  const local = storage({}, { set: key => {
    if (failPromotion && key === 'realm.v2:camp') {
      failPromotion = false
      throw new Error('local promotion failed')
    }
  } })
  const native = nativeItem()
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  failPromotion = true
  await vault.commit('realm.v2:camp', profile('member', 'token', 'code', { plan: ['committed'] }))
  assert.equal(local.getItem('realm.v2:camp'), null)
  assert.ok(local.getItem('realm.session.pending:realm.v2:camp'))
  const restarted = new SessionVault(native.item, local)
  await restarted.initialize()
  assert.equal(local.getItem('realm.session.pending:realm.v2:camp'), null)
  assert.deepEqual(JSON.parse(local.getItem('realm.v2:camp')!).plan, ['committed'])
  assert.deepEqual(restarted.hydrate('realm.v2:camp', profile('member', 'persisted-marker')).session, { id: 'member', token: 'token' })
})

await check('clear tombstones every known identity, removes journals and empties tokens', async () => {
  const local = storage()
  const native = nativeItem()
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  await vault.commit('realm.v2:first', profile('first', 'first-token'))
  await vault.commit('realm.v2:second', profile('second', 'second-token'))
  local.setItem('realm.session.pending:realm.v2:first', 'stale')
  await vault.clear()
  assert.deepEqual(vault.allTokens(), [])
  assert.equal(local.getItem('realm.session.pending:realm.v2:first'), null)
  assert.equal(local.getItem('realm.session.pending:realm.v2:second'), null)
  assert.equal(parseVault(native.value).slots['realm.v2:first'].credential, null)
  assert.equal(parseVault(native.value).slots['realm.v2:second'].credential, null)
})

await check('legacy destination alias shares migrated credentials after restart', async () => {
  const local = storage({ 'realm.v2': JSON.stringify(profile('legacy-member', 'legacy-token', 'legacy-code', { plan: ['legacy-plan'] })) })
  const native = nativeItem()
  await new SessionVault(native.item, local).initialize('realm.v2:festival')
  assert.deepEqual(JSON.parse(local.getItem('realm.v2:festival')!).plan, ['legacy-plan'])

  const restarted = new SessionVault(native.item, local)
  await restarted.initialize()
  const state = restarted.hydrate('realm.v2:festival', profile('legacy-member', 'persisted-marker'))
  assert.deepEqual(state.session, { id: 'legacy-member', token: 'legacy-token' })
  assert.equal(state.guest.recoveryCode, 'legacy-code')
})

await check('logout clears every same-identity slot including legacy while preserving other profiles', async () => {
  const local = storage({
    'realm.v2': JSON.stringify(profile('same-member', 'shared-token')),
    'realm.v2:festival': JSON.stringify(profile('same-member', 'shared-token')),
    'realm.v2:other': JSON.stringify(profile('other-member', 'other-token')),
  })
  const native = nativeItem()
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  await vault.commit('realm.v2:festival', profile('same-member'))

  const slots = parseVault(native.value).slots
  assert.equal(slots['realm.v2'].credential, null)
  assert.equal(slots['realm.v2:festival'].credential, null)
  assert.deepEqual(slots['realm.v2:other'].credential, { id: 'other-member', token: 'other-token' })
  assert.deepEqual(vault.allTokens(), ['other-token'])
})

await check('absent keychain preserves an id-only signed-out profile and its outbox', async () => {
  const original = {
    plan: ['offline-plan'], outbox: [{ id: 'queued-work' }],
    guest: { id: 'known-member' }, session: { id: 'known-member' },
  }
  const local = storage({ 'realm.v2:camp': JSON.stringify(original) })
  const vault = new SessionVault(nativeItem().item, local)
  await vault.initialize()

  const saved = JSON.parse(local.getItem('realm.v2:camp')!)
  assert.equal(saved.signedOut, true)
  assert.deepEqual(saved.outbox, original.outbox)
  const hydrated = vault.hydrate('realm.v2:camp', saved)
  assert.equal(hydrated.session, null)
  assert.equal(hydrated.signedOut, true)
  assert.deepEqual(hydrated.outbox, original.outbox)
})

await check('a failed journal removal does not overwrite the already promoted profile on restart', async () => {
  let failRemoval = false
  const journal = 'realm.session.pending:realm.v2:camp'
  const local = storage({}, { remove: key => {
    if (failRemoval && key === journal) {
      failRemoval = false
      throw new Error('journal removal failed')
    }
  } })
  const native = nativeItem()
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  failRemoval = true
  await vault.commit('realm.v2:camp', profile('member', 'token', undefined, { plan: ['saved-plan'], outbox: [{ id: 'saved-job' }] }))
  assert.ok(local.getItem(journal))
  const committed = JSON.parse(local.getItem('realm.v2:camp')!)
  assert.ok(committed.sessionRevision)

  const restarted = new SessionVault(native.item, local)
  await restarted.initialize()
  assert.equal(local.getItem(journal), null)
  assert.deepEqual(JSON.parse(local.getItem('realm.v2:camp')!).plan, ['saved-plan'])
  assert.deepEqual(JSON.parse(local.getItem('realm.v2:camp')!).outbox, [{ id: 'saved-job' }])
  assert.deepEqual(restarted.hydrate('realm.v2:camp', profile('member', 'persisted-marker')).session, { id: 'member', token: 'token' })
})

await check('normal saves after a failed first promotion keep newer plan and outbox through restart', async () => {
  let failPromotion = false
  const local = storage({}, { set: (key) => {
    if (failPromotion && key === 'realm.v2:camp') {
      failPromotion = false
      throw new Error('first profile promotion failed')
    }
  } })
  const native = nativeItem()
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  failPromotion = true
  await vault.commit('realm.v2:camp', profile('member', 'token', undefined, { plan: ['initial-plan'], outbox: [{ id: 'initial-job' }] }))
  const pending = JSON.parse(local.getItem('realm.session.pending:realm.v2:camp')!)
  assert.ok(pending.revision)

  // The app's next ordinary persistence pass adds newer offline work while retaining the
  // committed session marker so recovery can distinguish it from the staged profile.
  const savedLater = { ...pending.state, plan: ['newer-plan'], outbox: [{ id: 'newer-job' }], sessionRevision: pending.revision }
  local.setItem('realm.v2:camp', JSON.stringify(savedLater))
  const restarted = new SessionVault(native.item, local)
  await restarted.initialize()

  const saved = JSON.parse(local.getItem('realm.v2:camp')!)
  assert.equal(saved.sessionRevision, pending.revision)
  assert.deepEqual(saved.plan, ['newer-plan'])
  assert.deepEqual(saved.outbox, [{ id: 'newer-job' }])
  assert.equal(local.getItem('realm.session.pending:realm.v2:camp'), null)
  assert.deepEqual(restarted.hydrate('realm.v2:camp', { ...saved, session: { id: 'member' } }).session, { id: 'member', token: 'token' })
})

await check('restoring the same owner rotates credentials in every active festival alias', async () => {
  const local = storage({
    'realm.v2': JSON.stringify(profile('same-owner', 'legacy-token')),
    'realm.v2:festival-one': JSON.stringify(profile('same-owner', 'older-token')),
    'realm.v2:festival-other': JSON.stringify(profile('other-owner', 'other-token')),
  })
  const native = nativeItem()
  const vault = new SessionVault(native.item, local)
  await vault.initialize()
  await vault.commit('realm.v2:festival-two', profile('same-owner', 'restored-token', 'recovery-code'))

  const credentials = vault.allCredentials()
  const sameOwnerCredentials = credentials.filter(c => c.id === 'same-owner')
  assert.equal(sameOwnerCredentials.length, 3)
  assert.ok(sameOwnerCredentials.every(c => c.token === 'restored-token'))
  assert.deepEqual(credentials.filter(c => c.id === 'other-owner').map(c => c.token), ['other-token'])
})

console.log(`${passed} session vault checks passed`)
