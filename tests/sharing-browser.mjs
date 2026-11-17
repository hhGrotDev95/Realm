// Browser integration for share and clipboard UI wiring. The browser APIs below are mocked;
// this verifies the app's response to each outcome, not native iOS/Android share sheets.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer as createNetServer } from 'node:net'
import { spawn } from 'node:child_process'
import { FESTIVAL, actById, stageById } from '../src/data.ts'
import { launch, promiseScrollIntoView } from './browser.mjs'

const listenPort = async () => {
  const server = createNetServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

const port = await listenPort()
const WEB = `http://127.0.0.1:${port}`
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const stopServer = () => { if (!server.killed) server.kill('SIGTERM') }
process.on('exit', stopServer)
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(WEB)).ok) break } catch {}
  if (i === 99) throw new Error('Vite preview did not start')
  await new Promise((resolve) => setTimeout(resolve, 100))
}

const browser = await launch()
const seed = (overrides = {}) => ({
  guest: { id: 'sharing-demo-user', nickname: 'Mira', color: '#A58CFF', secured: null, recoveryCode: 'TEST-ONLY-RECOVERY-CODE' },
  phase: 'before', clockMode: 'demo',
  ...overrides,
})

async function openApp({ state = seed(), shareMode = 'missing', clipboardMode = 'resolved' } = {}) {
  const context = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'de-DE' })
  await context.addInitScript(promiseScrollIntoView)
  await context.addInitScript(({ state: stored, shareMode: initialShareMode, clipboardMode: initialClipboardMode }) => {
    const harness = {
      shareCalls: [],
      clipboardCalls: [],
      shareMode: initialShareMode,
      clipboardMode: initialClipboardMode,
      releaseClipboard: null,
    }
    window.__sharingHarness = harness
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: initialShareMode === 'missing' ? undefined : (data) => {
        harness.shareCalls.push(JSON.parse(JSON.stringify(data)))
        if (harness.shareMode === 'cancel') return Promise.reject(Object.assign(new Error('dismissed'), { name: 'AbortError' }))
        if (harness.shareMode === 'reject') return Promise.reject(new Error('share unavailable'))
        return Promise.resolve()
      },
    })
    if (initialClipboardMode === 'missing') {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    } else {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text) => {
            harness.clipboardCalls.push(text)
            if (harness.clipboardMode === 'reject') return Promise.reject(new Error('clipboard denied'))
            if (harness.clipboardMode === 'pending') return new Promise((resolve) => { harness.releaseClipboard = resolve })
            return Promise.resolve()
          },
        },
      })
    }
    localStorage.setItem('realm.v2', JSON.stringify(stored))
  }, { state, shareMode, clipboardMode })
  const page = await context.newPage()
  page.on('pageerror', (error) => { throw error })
  await page.goto(WEB)
  await page.locator('nav').waitFor()
  return { context, page }
}

const toast = (page) => page.locator('.toast')
const inviteButton = (page) => page.getByRole('button', { name: 'Einladungslink teilen' })
const mockCalls = (page) => page.evaluate(() => window.__sharingHarness)

try {
  // An invitation is not reported as copied until the write resolves. The busy state also
  // prevents another user action from starting a second share while that write is pending.
  {
    const { context, page } = await openApp({ clipboardMode: 'pending' })
    try {
      await inviteButton(page).click()
      await page.waitForFunction(() => document.querySelector('button') !== null && [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Einladungslink teilen') && button.disabled))
      assert.equal(await toast(page).count(), 0, 'pending write showed a success toast too early')
      await inviteButton(page).click({ force: true })
      assert.equal((await mockCalls(page)).clipboardCalls.length, 1, 'pending write started a duplicate clipboard action')
      const calls = await mockCalls(page)
      const link = calls.clipboardCalls[0]
      assert.equal(link, `${WEB}/?join=DEMO-CREW`)
      await page.evaluate(() => window.__sharingHarness.releaseClipboard())
      await page.getByRole('status').getByText('Einladungslink kopiert', { exact: true }).waitFor()
    } finally {
      await context.close()
    }
  }

  // Both rejected and missing clipboard APIs produce the translated share failure message.
  for (const mode of ['reject', 'missing']) {
    const { context, page } = await openApp({ clipboardMode: mode })
    try {
      await inviteButton(page).click()
      await page.getByRole('status').getByText('Teilen nicht möglich. Bitte versuche es erneut.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('status').getByText('Einladungslink kopiert', { exact: true }).count(), 0)
    } finally {
      await context.close()
    }
  }

  // Share API cancellation stays silent and does not attempt the clipboard fallback.
  {
    const { context, page } = await openApp({ shareMode: 'cancel' })
    try {
      await inviteButton(page).click()
      await page.waitForTimeout(100)
      const calls = await mockCalls(page)
      assert.equal(calls.shareCalls.length, 1)
      assert.deepEqual(calls.shareCalls[0], {
        text: 'Komm in meine Crew „Demo-Crew“ bei Realm.',
        url: `${WEB}/?join=DEMO-CREW`,
      })
      assert.deepEqual(calls.clipboardCalls, [])
      assert.equal(await toast(page).count(), 0, 'cancelled share showed a toast')
    } finally {
      await context.close()
    }
  }

  // A successful share API call receives the app's exact payload and never copies it too.
  {
    const { context, page } = await openApp({ shareMode: 'resolve' })
    try {
      await inviteButton(page).click()
      const expected = {
        text: 'Komm in meine Crew „Demo-Crew“ bei Realm.',
        url: `${WEB}/?join=DEMO-CREW`,
      }
      await page.waitForFunction((payload) => JSON.stringify(window.__sharingHarness.shareCalls[0]) === JSON.stringify(payload), expected)
      assert.deepEqual((await mockCalls(page)).shareCalls, [expected])
      assert.deepEqual((await mockCalls(page)).clipboardCalls, [])
    } finally {
      await context.close()
    }
  }

  // Secure's recovery code uses clipboard copy only. The code is synthetic test state.
  {
    const { context, page } = await openApp({ clipboardMode: 'resolved', shareMode: 'resolve' })
    try {
      await page.getByRole('button', { name: 'Profil & Einstellungen' }).click()
      await page.getByRole('button', { name: 'Profil sichern' }).click()
      await page.getByText('TEST-ONLY-RECOVERY-CODE', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Kopieren' }).click()
      await page.getByRole('status').getByText('Code kopiert', { exact: true }).waitFor()
      const calls = await mockCalls(page)
      assert.deepEqual(calls.clipboardCalls, ['TEST-ONLY-RECOVERY-CODE'])
      assert.deepEqual(calls.shareCalls, [], 'recovery code was passed to the share API')
    } finally {
      await context.close()
    }
  }

  // Wrapped's last slide uses the share API with its generated text, without clipboard fallback.
  {
    const { context, page } = await openApp({ state: seed({ phase: 'after', plan: ['1-maduk'], attended: {} }), shareMode: 'resolve' })
    try {
      await page.getByRole('button', { name: /Festival Wrapped/ }).click()
      const advance = page.locator('.wrapped > div[style*="z-index: 1"]')
      await advance.waitFor()
      for (let i = 0; i < 6; i++) {
        if (await page.getByRole('button', { name: 'Teilen' }).count()) break
        const bounds = await advance.boundingBox()
        assert(bounds, 'Wrapped slide navigation overlay is missing')
        await advance.dispatchEvent('pointerdown', { clientX: bounds.x + bounds.width - 8, clientY: bounds.y + bounds.height / 2 })
        await advance.dispatchEvent('pointerup', { clientX: bounds.x + bounds.width - 8, clientY: bounds.y + bounds.height / 2 })
        await page.waitForTimeout(60)
      }
      await page.getByRole('button', { name: 'Teilen' }).waitFor()
      await page.getByRole('button', { name: 'Teilen' }).click()
      const act = actById['1-maduk']
      const expected = {
        text: `Mein ${FESTIVAL.name}: 1 Sets, Lieblingsstage ${stageById[act.stage].name}.`,
      }
      await page.waitForFunction((payload) => JSON.stringify(window.__sharingHarness.shareCalls[0]) === JSON.stringify(payload), expected)
      assert.deepEqual((await mockCalls(page)).shareCalls, [expected])
      assert.deepEqual((await mockCalls(page)).clipboardCalls, [])
    } finally {
      await context.close()
    }
  }

  console.log('Share and clipboard browser integration passed')
} finally {
  await browser.close()
  stopServer()
}
