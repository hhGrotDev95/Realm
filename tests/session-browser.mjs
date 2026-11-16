// Browser integration coverage for the native session boundary. The app is served by Vite;
// deterministic API and Capacitor bridge fixtures keep this independent of live user data.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer as createNetServer } from 'node:net'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { ACTS, DAYS, FESTIVAL, POIS, STAGES } from '../src/data.ts'
import { promiseScrollIntoView } from './browser.mjs'

const listenPort = async () => {
  const server = createNetServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve()))
  return port
}

const webPort = await listenPort()
const WEB = `http://127.0.0.1:${webPort}`
const API = 'https://realm-session-fixture.test'
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
  stdio: 'ignore',
  env: { ...process.env, VITE_API_URL: API },
})
const stopServer = () => { if (!server.killed) server.kill('SIGTERM') }
process.on('exit', stopServer)
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(WEB)).ok) break } catch {}
  if (i === 99) throw new Error('Vite did not start')
  await new Promise((resolve) => setTimeout(resolve, 100))
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const actData = ACTS.map(({ change, ...act }) => act)
const bundle = JSON.parse(JSON.stringify({
  festival: { ...FESTIVAL, status: 'published', updatedAt: 1, modules: { crew: true, plan: true } },
  days: DAYS,
  stages: STAGES,
  acts: actData,
  pois: POIS,
  legal: { imprint: null, privacy: null, minAge: 16, platform: { imprint: null, privacy: null } },
}))

const profile = (id, token, recoveryCode, nickname = id) => ({ id, token, recoveryCode, nickname, color: '#A58CFF', plan: ['2-kairo'] })
const oldProfile = profile('native-one', 'token-one', 'AAAA-BBBB-CCCC-DDDD', 'Mira')
const nextProfile = profile('native-two', 'token-two', 'EEEE-FFFF-GGGG-HHHH', 'Nora')
const initialState = (p, overrides = {}) => ({
  guest: { id: p.id, nickname: p.nickname, color: p.color, secured: 'code', recoveryCode: p.recoveryCode },
  phase: 'during', clockMode: 'demo', plan: ['1-maduk'], attended: {}, resolved: {}, reminders: {},
  meetups: [], declined: [], votes: {}, myUpdates: [], chat: [], shareLocation: false, myPlace: null,
  stepsOptIn: false, myPins: [{ id: 'private-pin', name: 'Only mine', x: 1, y: 2 }], dismissed: [], planNotices: [],
  session: { id: p.id, token: p.token }, signedOut: false, sessionRevision: '', crewRef: null, remote: null,
  remoteReports: [], reportsFetchedAt: 0, pendingJoin: null, outbox: [], outboxSent: [], announcements: null,
  timetableChanges: null, ...overrides,
})

const deferred = () => {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

function fixtureApi(profiles, options = {}) {
  const calls = []
  const delayedOldMe = options.delayedOldMe ? deferred() : null
  const waitOldMe = options.delayedOldMe ? deferred() : null
  return {
    calls,
    releaseOldMe: () => waitOldMe?.resolve(),
    oldMeSeen: delayedOldMe?.promise,
    handler: async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      const body = request.postDataJSON?.() ?? null
      const auth = (await request.headerValue('authorization'))?.replace(/^Bearer /, '') ?? null
      calls.push({ method: request.method(), path, auth, body })
      const send = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
      if (path === '/api/festivals') return send([{ slug: 'realm-open-air', name: 'Realm Open Air', location: 'Czechia' }])
      if (path === '/api/festivals/realm-open-air') return send(bundle)
      if (path === '/api/reports' || path === '/api/announcements' || path === '/api/timetable/changes') return send([])
      if (path === '/api/me/moderation') return send([])
      if (path === '/api/restore' && request.method() === 'POST') {
        const code = String(body?.code ?? '').replace(/[^a-z0-9]/gi, '').toUpperCase()
        const found = Object.values(profiles).find((p) => p.recoveryCode.replaceAll('-', '') === code)
        return found ? send({ id: found.id, token: found.token, nickname: found.nickname, color: found.color }) : send({ error: 'Code not found' }, 404)
      }
      if (path === '/api/me' && request.method() === 'GET') {
        if (options.delayedOldMe && auth === oldProfile.token) {
          delayedOldMe.resolve()
          await waitOldMe.promise
          return send({ error: 'Expired' }, 401)
        }
        const p = Object.values(profiles).find((entry) => entry.token === auth)
        return p ? send({ id: p.id, nickname: p.nickname, color: p.color, secured: true, crews: [], plan: p.plan }) : send({ error: 'Expired' }, 401)
      }
      if (path === '/api/me/recovery' && request.method() === 'POST') {
        const p = Object.values(profiles).find((entry) => entry.token === auth)
        return p ? send({ code: p.recoveryCode }) : send({ error: 'Expired' }, 401)
      }
      if (path === '/api/me/plan' && request.method() === 'PUT') return route.fulfill({ status: 204 })
      if (path === '/api/me/logout' && request.method() === 'POST') return route.fulfill({ status: 204 })
      if (path.startsWith('/api/crews/')) return send({ crew: { id: 'crew-1', name: 'Test Crew', code: 'AAAA-BBBB', approveJoins: false }, owner: oldProfile.id, me: oldProfile.id, serverTime: Date.now(), members: [], messages: [], meetups: [] })
      return route.fulfill({ status: 204 })
    },
  }
}

async function contextFor({ seed, secureItem = null, failRead = false, delayRead = 0, profiles = { one: oldProfile, two: nextProfile }, apiOptions } = {}) {
  const native = { value: secureItem, reads: 0, writes: [], failRead, delayRead, delayWrite: 0 }
  const context = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'de-DE' })
  const api = fixtureApi(profiles, apiOptions)
  await context.route(`${API}/api/**`, api.handler)
  await context.exposeBinding('__realmNativeCall', async (_source, plugin, method, options) => {
    assert.equal(plugin, 'RealmSecureSession')
    if (method === 'read') {
      native.reads++
      if (native.delayRead) await new Promise((resolve) => setTimeout(resolve, native.delayRead))
      if (native.failRead) throw new Error('Keychain locked')
      return { value: native.value }
    }
    if (method === 'write') {
      if (native.delayWrite) await new Promise((resolve) => setTimeout(resolve, native.delayWrite))
      native.writes.push(options.value)
      native.value = options.value
      return
    }
    throw new Error(`Unexpected native method: ${method}`)
  })
  await context.addInitScript(promiseScrollIntoView)
  await context.addInitScript((state) => {
    window.webkit = { messageHandlers: { bridge: {} } }
    window.Capacitor = {
      PluginHeaders: [{ name: 'RealmSecureSession', methods: [{ name: 'read', rtype: 'promise' }, { name: 'write', rtype: 'promise' }] }],
      nativePromise: (plugin, method, options) => window.__realmNativeCall(plugin, method, options),
    }
    if (state) for (const [key, value] of Object.entries(state)) localStorage.setItem(key, value)
  }, seed)
  const page = await context.newPage()
  page.on('pageerror', (error) => { throw error })
  return { context, page, native, api }
}

const legacySeed = (p, overrides) => ({ 'realm.v2': JSON.stringify(initialState(p, overrides)) })
const storedState = (page, key = 'realm.v2:realm-open-air') => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key)
const openProfile = async (page) => page.getByRole('button', { name: 'Profil & Einstellungen' }).click()
const restoreWith = async (page, code) => {
  const restoreButton = page.getByRole('button', { name: 'Profil mit Code wiederherstellen' })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await openProfile(page)
  await restoreButton.waitFor({ state: 'visible', timeout: 5000 })
  await restoreButton.click()
  await page.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(code)
  await page.getByRole('button', { name: 'Wiederherstellen' }).click()
  const expectedId = code === oldProfile.recoveryCode ? oldProfile.id : nextProfile.id
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem('realm.v2:realm-open-air') ?? 'null')?.guest?.id === id, expectedId)
}

try {
  // Legacy plaintext credentials migrate to the simulated native vault, and a new WebView
  // instance hydrates the same account without putting token or recovery code back in storage.
  {
    const { context, page, native } = await contextFor({ seed: legacySeed(oldProfile) })
    await page.goto(WEB)
    await page.locator('nav').waitFor()
    const raw = await page.evaluate(() => [localStorage.getItem('realm.v2'), localStorage.getItem('realm.v2:realm-open-air')])
    assert(raw.every((value) => value && !value.includes(oldProfile.token) && !value.includes(oldProfile.recoveryCode)), 'migration left a credential in localStorage')
    const vault = JSON.parse(native.value)
    assert.equal(vault.slots['realm.v2:realm-open-air'].credential.token, oldProfile.token)
    assert.equal((await storedState(page)).plan[0], '1-maduk')
    await page.reload()
    await page.locator('nav').waitFor()
    const afterReload = await storedState(page)
    assert.deepEqual(afterReload.session, { id: oldProfile.id }, 'local state should retain the identity marker without its token')
    assert.equal(afterReload.guest.recoveryCode, undefined)
    assert.equal(afterReload.guest.id, oldProfile.id)
    await context.close()
  }

  // A recovered account keeps its own favorites. Restoring a different account loads that
  // account's remote plan and never carries over the previous account's local private values.
  {
    const withPrivateOptIns = initialState(oldProfile, {
      shareLocation: true,
      stepsOptIn: true,
      crewRef: { id: 'crew-1', name: 'Test Crew', code: 'AAAA-BBBB' },
    })
    const { context, page, native, api } = await contextFor({ seed: legacySeed(oldProfile, withPrivateOptIns) })
    await page.goto(WEB)
    await page.locator('nav').waitFor()
    await restoreWith(page, oldProfile.recoveryCode)
    assert.equal((await storedState(page)).plan[0], '1-maduk', 'same-profile restore lost the local favorites')
    await restoreWith(page, nextProfile.recoveryCode)
    const state = await storedState(page)
    assert.equal(state.guest.id, nextProfile.id)
    assert.deepEqual(state.plan, nextProfile.plan, 'new account inherited the previous profile plan')
    assert.equal(state.myPins.some((pin) => pin.id === 'private-pin'), false, 'new account inherited private map pins')
    assert.equal(state.stepsOptIn, false)
    assert.equal(state.shareLocation, false)
    assert.equal(state.outbox.length, 0)
    assert.equal(api.calls.some((call) => call.auth === nextProfile.token && (call.path === '/api/me/steps' || call.path === '/api/crews/crew-1/location')), false, 'old profile privacy settings were sent to the restored profile')
    const vault = JSON.parse(native.value)
    assert.equal(vault.slots['realm.v2:realm-open-air'].credential.id, nextProfile.id)
    await context.close()
  }

  // Logout is explicit, keeps favorites, tombstones the native credential, and does not
  // silently create a guest after restart.
  {
    const { context, page, native, api } = await contextFor({ seed: legacySeed(oldProfile) })
    await page.goto(WEB)
    await page.locator('nav').waitFor()
    await openProfile(page)
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click()
    const confirm = page.getByText('Sichere deinen Recovery-Code, bevor du dich abmeldest.')
    await confirm.waitFor()
    const checkbox = page.getByLabel('Ich habe meinen Recovery-Code sicher gespeichert.')
    assert.equal(await checkbox.isChecked(), false)
    const confirmLogout = page.getByRole('button', { name: 'Abmelden', exact: true }).last()
    assert.equal(await confirmLogout.isDisabled(), true, 'logout bypassed the recovery-code confirmation')
    await checkbox.check()
    await confirmLogout.click()
    await page.getByRole('status').getByText('Abgemeldet', { exact: true }).waitFor()
    assert.equal((await storedState(page)).plan[0], '1-maduk')
    assert.equal(JSON.parse(native.value).slots['realm.v2:realm-open-air'].credential, null)
    await page.reload()
    await page.locator('nav').waitFor()
    assert.equal((await storedState(page)).signedOut, true)
    assert.equal((await storedState(page)).session, null)
    assert.equal(api.calls.filter((call) => call.method === 'POST' && call.path === '/api/guests').length, 0)
    await context.close()
  }

  // An old profile's delayed 401 must not sign out the profile restored while that request waited.
  {
    const { context, page, native, api } = await contextFor({ seed: legacySeed(oldProfile), apiOptions: { delayedOldMe: true } })
    await page.goto(WEB)
    await page.locator('nav').waitFor()
    await api.oldMeSeen
    await restoreWith(page, nextProfile.recoveryCode)
    api.releaseOldMe()
    await page.waitForTimeout(150)
    const state = await storedState(page)
    assert.equal(state.guest.id, nextProfile.id)
    assert.equal(state.signedOut, false)
    assert.equal(JSON.parse(native.value).slots['realm.v2:realm-open-air'].credential.id, nextProfile.id)
    await context.close()
  }

  // Locked Keychain is a bootstrap failure before festival/auth API traffic starts.
  {
    const { context, page, api } = await contextFor({ failRead: true })
    await page.goto(WEB)
    await page.getByRole('alert').getByRole('heading', { name: 'Sitzung nicht verfügbar' }).waitFor()
    assert.equal(api.calls.length, 0, 'app made API requests after secure-store bootstrap failed')
    await context.close()
  }

  // While logout waits for a native secure-store write, an accelerated location interval may
  // run, but its stale identity cannot enqueue a write for the next account.
  {
    const withCrew = initialState(oldProfile, {
      clockMode: 'real',
      shareLocation: true,
      crewRef: { id: 'crew-1', name: 'Test Crew', code: 'AAAA-BBBB' },
    })
    const { context, page, native, api } = await contextFor({ seed: legacySeed(oldProfile, withCrew) })
    await context.addInitScript(() => {
      const original = window.setInterval.bind(window)
      window.setInterval = (callback, delay, ...args) => original(callback, delay === 30 * 60_000 ? 60 : delay, ...args)
    })
    await page.goto(WEB)
    await page.locator('nav').waitFor()
    await page.waitForTimeout(250)
    assert(api.calls.some((call) => call.path === '/api/crews/crew-1/location'), 'share setup did not reach the API fixture')
    native.delayWrite = 600
    await openProfile(page)
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click()
    await page.getByLabel('Ich habe meinen Recovery-Code sicher gespeichert.').check()
    await page.getByRole('button', { name: 'Abmelden', exact: true }).last().click()
    await page.waitForTimeout(180)
    const whileWaiting = await storedState(page)
    assert.equal(whileWaiting.outbox.length, 0, 'timer added an operation during the Keychain commit')
    await page.getByRole('status').getByText('Abgemeldet', { exact: true }).waitFor()
    await page.waitForTimeout(120)
    assert.equal((await storedState(page)).outbox.length, 0)
    await context.close()
  }

  console.log('Native session browser integration checks passed')
} finally {
  await browser.close()
  stopServer()
}
