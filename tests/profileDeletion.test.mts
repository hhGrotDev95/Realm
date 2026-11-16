import assert from 'node:assert/strict'
import { deleteProfiles, hasUncertainDeletion, DELETION_KEY, DELETION_PENDING_KEY, type DeletionProfile } from '../src/profileDeletion.ts'

function storage(initial: Record<string, string> = {}, onSet?: (key: string, value: string) => void): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  const target = {
    data,
    get length() { return data.size },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { onSet?.(key, String(value)); data.set(key, String(value)) },
    removeItem: (key: string) => { data.delete(key) },
    clear: () => data.clear(),
  }
  return new Proxy(target, {
    ownKeys: () => [...data.keys()],
    getOwnPropertyDescriptor: (_target, key) => typeof key === 'string' && data.has(key)
      ? { configurable: true, enumerable: true, writable: true, value: data.get(key) }
      : undefined,
  }) as Storage & { data: Map<string, string> }
}

let passed = 0
async function check(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log('✓', name)
}

await check('deduplicates aliases by identity and uses the last available token', async () => {
  const events: string[] = []
  const local = storage({}, (key, value) => {
    if (key === DELETION_KEY) events.push(`checkpoint:${value}`)
  })
  const calls: string[] = []
  const profiles: DeletionProfile[] = [
    { id: 'owner-a', token: 'stale-alias-token' },
    { id: 'owner-b', token: 'other-token' },
    { id: 'owner-a', token: 'current-token' },
  ]
  await deleteProfiles(local, profiles, async token => {
    calls.push(token)
    // A resolved remove callback represents the API's successful 204 response.
    events.push(`204:${token}`)
  })
  assert.deepEqual(calls, ['current-token', 'other-token'])
  assert.deepEqual(JSON.parse(local.getItem(DELETION_KEY)!), ['owner-a', 'owner-b'])
  assert.deepEqual(events, [
    'checkpoint:[]', '204:current-token', 'checkpoint:["owner-a"]',
    '204:other-token', 'checkpoint:["owner-a","owner-b"]',
  ])
})

await check('retry skips a completed identity and continues after a partial failure', async () => {
  const local = storage()
  const firstAttempt: string[] = []
  await assert.rejects(deleteProfiles(local, [
    { id: 'owner-a', token: 'token-a' }, { id: 'owner-b', token: 'token-b' },
  ], async token => {
    firstAttempt.push(token)
    if (token === 'token-b') throw new Error('temporary network failure')
  }), /temporary network failure/)
  assert.deepEqual(firstAttempt, ['token-a', 'token-b'])
  assert.deepEqual(JSON.parse(local.getItem(DELETION_KEY)!), ['owner-a'])

  const retry: string[] = []
  await deleteProfiles(local, [
    { id: 'owner-a', token: 'token-a' }, { id: 'owner-b', token: 'token-b' },
  ], async token => { retry.push(token) })
  assert.deepEqual(retry, ['token-b'])
  assert.deepEqual(JSON.parse(local.getItem(DELETION_KEY)!), ['owner-a', 'owner-b'])
})

await check('signed-out profiles without tokens block deletion before any request or checkpoint write', async () => {
  const local = storage()
  let requests = 0
  await assert.rejects(deleteProfiles(local, [{ id: 'signed-out-owner' }], async () => { requests++ }), /Restore required before deletion/)
  assert.equal(requests, 0)
  assert.equal(local.getItem(DELETION_KEY), null)
})

await check('401 keeps prior completed identities checkpointed and does not complete the rejected identity', async () => {
  const local = storage()
  const calls: string[] = []
  const unauthorized = Object.assign(new Error('unauthorized'), { status: 401 })
  await assert.rejects(deleteProfiles(local, [
    { id: 'owner-a', token: 'token-a' }, { id: 'owner-b', token: 'token-b' },
  ], async token => {
    calls.push(token)
    if (token === 'token-b') throw unauthorized
  }), error => error === unauthorized)
  assert.deepEqual(calls, ['token-a', 'token-b'])
  assert.deepEqual(JSON.parse(local.getItem(DELETION_KEY)!), ['owner-a'])
})

await check('lost delete response stays uncertain across restart and a retry 401 never fakes completion', async () => {
  const local = storage()
  await assert.rejects(deleteProfiles(local, [{ id: 'deleted-on-server', token: 'owner-token' }], async () => {
    // The server deleted the identity, but the response was lost before the client could know.
    throw new Error('connection reset after server deletion')
  }), /connection reset/)
  assert.deepEqual(JSON.parse(local.getItem(DELETION_KEY)!), [])
  assert.deepEqual(JSON.parse(local.getItem(DELETION_PENDING_KEY)!), ['deleted-on-server'])

  const restarted = storage(Object.fromEntries(local.data))
  assert.equal(hasUncertainDeletion(restarted), true)
  const unauthorized = Object.assign(new Error('unauthorized'), { status: 401 })
  await assert.rejects(deleteProfiles(restarted, [{ id: 'deleted-on-server', token: 'owner-token' }], async () => {
    throw unauthorized
  }), error => error === unauthorized)
  assert.deepEqual(JSON.parse(restarted.getItem(DELETION_KEY)!), [])
  assert.deepEqual(JSON.parse(restarted.getItem(DELETION_PENDING_KEY)!), ['deleted-on-server'])
  assert.equal(hasUncertainDeletion(restarted), true)
})

await check('a failed checkpoint write after a successful 204 keeps deletion intent uncertain', async () => {
  let failCompletionCheckpoint = true
  const local = storage({}, (key, value) => {
    if (failCompletionCheckpoint && key === DELETION_KEY && value.includes('owner-a')) {
      failCompletionCheckpoint = false
      throw new Error('checkpoint write failed')
    }
  })
  let responses = 0
  await assert.rejects(deleteProfiles(local, [{ id: 'owner-a', token: 'token-a' }], async () => { responses++ }), /checkpoint write failed/)
  assert.equal(responses, 1, 'the remove request succeeded before checkpoint persistence failed')
  assert.deepEqual(JSON.parse(local.getItem(DELETION_KEY)!), [])
  assert.deepEqual(JSON.parse(local.getItem(DELETION_PENDING_KEY)!), ['owner-a'])
  assert.equal(hasUncertainDeletion(local), true)
})

await check('a later profile deletion never erases another unresolved deletion intent', async () => {
  const local = storage()
  await assert.rejects(deleteProfiles(local, [{ id: 'a', token: 'a-token' }], async () => { throw new Error('lost response') }))
  await assert.rejects(deleteProfiles(local, [{ id: 'b', token: 'b-token' }], async () => {}), /Deletion uncertain/)
  assert.equal(hasUncertainDeletion(local), true)
  assert.deepEqual(JSON.parse(local.getItem(DELETION_PENDING_KEY)!), ['a'])
  assert.deepEqual(JSON.parse(local.getItem(DELETION_KEY)!), ['b'])
})

console.log(`${passed} profile deletion checks passed`)
