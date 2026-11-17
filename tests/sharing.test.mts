import assert from 'node:assert/strict'
import { copyText, shareText } from '../src/sharing.ts'

let passed = 0
const check = async (name: string, fn: () => void | Promise<void>) => {
  await fn()
  passed++
  console.log('✓', name)
}

await check('copyText reports unavailable clipboard as false', async () => {
  assert.equal(await copyText('text'), false)
  assert.equal(await copyText('text', {}), false)
})

await check('copyText forwards the exact text and reports a resolved write', async () => {
  const texts: string[] = []
  const result = await copyText('  festival link  ', { writeText: async (text) => void texts.push(text) })
  assert.equal(result, true)
  assert.deepEqual(texts, ['  festival link  '])
})

await check('copyText reports rejected and synchronously thrown writes as false', async () => {
  assert.equal(await copyText('text', { writeText: () => Promise.reject(new Error('denied')) }), false)
  assert.equal(await copyText('text', { writeText: () => { throw new Error('denied') } }), false)
})

await check('copyText stays unresolved while the clipboard write is pending', async () => {
  let resolveWrite!: () => void
  let settled = false
  const result = copyText('delayed', { writeText: () => new Promise<void>((resolve) => { resolveWrite = resolve }) })
    .then((value) => {
      settled = true
      return value
    })

  await Promise.resolve()
  assert.equal(settled, false)
  resolveWrite()
  assert.equal(await result, true)
})

await check('shareText invokes share synchronously and forwards the exact payload', async () => {
  const payload = { title: 'Realm', text: 'Join us', url: 'https://example.test/realm' }
  let invoked = false
  let copied = false
  const result = shareText(payload, 'fallback', {
    share: async (data) => {
      invoked = true
      assert.equal(data, payload)
    },
    writeText: async () => { copied = true },
  })

  assert.equal(invoked, true, 'share must be called before shareText returns its promise')
  assert.equal(await result, 'shared')
  assert.equal(copied, false)
})

await check('shareText copies the exact fallback only when share is unavailable', async () => {
  const texts: string[] = []
  const result = await shareText({ text: 'Share payload' }, 'Exact fallback text', {
    writeText: async (text) => void texts.push(text),
  })
  assert.equal(result, 'copied')
  assert.deepEqual(texts, ['Exact fallback text'])
  assert.equal(await shareText({ text: 'Share payload' }, 'fallback', {}), 'failed')
})

await check('share cancellation does not copy the fallback', async () => {
  let copied = false
  const result = await shareText({ text: 'payload' }, 'fallback', {
    share: () => Promise.reject(Object.assign(new Error('dismissed'), { name: 'AbortError' })),
    writeText: async () => { copied = true },
  })
  assert.equal(result, 'cancelled')
  assert.equal(copied, false)
})

await check('share rejection and synchronous throw fail without clipboard fallback', async () => {
  let copied = false
  const transport = { writeText: async () => { copied = true } }
  assert.equal(await shareText({ text: 'payload' }, 'fallback', {
    ...transport,
    share: () => Promise.reject(new Error('share failed')),
  }), 'failed')
  assert.equal(await shareText({ text: 'payload' }, 'fallback', {
    ...transport,
    share: () => { throw new Error('share failed') },
  }), 'failed')
  assert.equal(copied, false)
})

console.log(`✓ ${passed} sharing checks`)
