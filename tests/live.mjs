// Two-user end-to-end test against the real worker (wrangler dev, local D1) and the Vite dev server.
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { chromium } from 'playwright'

const API = 'http://127.0.0.1:8798'
const WEB = 'http://localhost:5199'
const persist = 'worker/.wrangler/e2e-state'
rmSync(persist, { recursive: true, force: true })
const procs = []
const sh = (cmd, args, opts = {}) => {
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true, ...opts })
  procs.push(p)
  return p
}
await new Promise((res, rej) => sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'realm', '--local', '--persist-to', '.wrangler/e2e-state'], { cwd: 'worker' }).on('exit', (c) => (c ? rej(new Error('migrate')) : res())))
sh('npx', ['wrangler', 'dev', '--local', '--port', '8798', '--persist-to', '.wrangler/e2e-state', '--var', 'ADMIN_TOKEN:e2e-admin'], { cwd: 'worker' })
sh('npx', ['vite', '--port', '5199', '--strictPort'], { env: { ...process.env, VITE_API_URL: API } })
const waitFor = async (url) => {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('timeout ' + url)
}
await waitFor(API + '/api/health')
await waitFor(WEB)

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const errors = []
const user = async () => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } })
  // pin the app clock to "Friday 19:52" so the scenario does not depend on today's date
  await ctx.addInitScript(() => {
    try {
      localStorage.getItem('realm.v2') || localStorage.setItem('realm.v2', JSON.stringify({ clockMode: 'demo', phase: 'during' }))
    } catch {} // browser error pages (offline reload) have no storage
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return page
}
const step = async (name, fn) => {
  await fn()
  console.log('✓', name)
}
const nav = (p, t) => p.locator('nav').getByText(t).click()
const name = async (p, n) => {
  await p.getByPlaceholder('Spitzname').fill(n)
  await p.getByRole('button', { name: 'Weiter' }).click()
}

try {
  const lea = await user()
  const ben = await user()
  let code

  await step('Lea founds a crew (name asked on first social action)', async () => {
    await lea.goto(WEB)
    await nav(lea, 'Crew')
    await lea.getByLabel('Crew-Name').fill('Zeltplatz 14')
    await lea.getByRole('button', { name: 'Crew gründen' }).click()
    await name(lea, 'Lea')
    await lea.getByText(/Person.* · Code/).waitFor()
    code = (await lea.getByText(/Person.* · Code/).textContent()).match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)[0]
  })

  await step('Ben joins via invite link', async () => {
    await ben.goto(`${WEB}/?join=${code}`)
    await nav(ben, 'Crew')
    await ben.getByText('Du wurdest in eine Crew eingeladen').waitFor()
    await ben.getByRole('button', { name: 'Beitreten' }).first().click()
    await name(ben, 'Ben')
    await ben.getByText('Zeltplatz 14', { exact: true }).waitFor()
    await ben.getByText('2 Personen', { exact: false }).waitFor()
  })

  await step('chat message reaches the other member (polling)', async () => {
    await ben.getByRole('button', { name: /^Crew-Chat/ }).click()
    await ben.getByPlaceholder(/Nachricht/).fill('Treffen am Archive?')
    await ben.getByRole('button', { name: 'Senden' }).click()
    await lea.reload()
    await nav(lea, 'Crew')
    await lea.getByRole('button', { name: /^Crew-Chat/ }).click()
    await lea.locator('.bubble.them', { hasText: 'Treffen am Archive?' }).waitFor({ timeout: 15000 })
    await lea.keyboard.press('Escape')
    await ben.keyboard.press('Escape')
  })

  await step('offline: message is queued, shown as pending and delivered after reconnect', async () => {
    await ben.context().setOffline(true)
    await ben.getByRole('button', { name: /^Crew-Chat/ }).click()
    await ben.getByPlaceholder(/Nachricht/).fill('Funkloch!')
    await ben.getByRole('button', { name: 'Senden' }).click()
    await ben.getByText('Wird gesendet …').waitFor()
    await ben.getByText(/Offline · 1 Änderung wartet/).waitFor()
    await ben.reload().catch(() => {}) // a reload while offline must not lose the queue (served from the SW cache or skipped)
    await ben.context().setOffline(false)
    if (!ben.url().startsWith(WEB)) await ben.goto(WEB)
    await ben.reload()
    await nav(ben, 'Crew')
    await ben.getByRole('button', { name: /^Crew-Chat/ }).click()
    await ben.locator('.bubble.me:not(.pending)', { hasText: 'Funkloch!' }).waitFor({ timeout: 20000 })
    await lea.reload()
    await nav(lea, 'Crew')
    await lea.getByRole('button', { name: /^Crew-Chat/ }).click()
    await lea.locator('.bubble.them', { hasText: 'Funkloch!' }).waitFor({ timeout: 20000 })
    if ((await lea.locator('.bubble', { hasText: 'Funkloch!' }).count()) !== 1) throw new Error('duplicate message after retry')
    await lea.keyboard.press('Escape')
    await ben.keyboard.press('Escape')
  })

  await step('meetup from an act; the other member says yes', async () => {
    await nav(lea, 'Line-up')
    await lea.locator('.act', { hasText: 'Maduk' }).click()
    await lea.getByText('Vor diesem Set treffen').click()
    await lea.getByRole('button', { name: 'Crew einladen' }).click()
    await lea.getByText('Meetup erstellt').waitFor()
    await ben.reload()
    await nav(ben, 'Crew')
    await ben.waitForTimeout(3000)
    if (process.env.DEBUG) console.log(await ben.locator('.device').innerHTML())
    await ben.locator('.tile', { hasText: 'zugesagt' }).click({ timeout: 15000 })
    await ben.locator('.sheet').getByRole('button', { name: 'Bin dabei' }).click()
    await ben.locator('.sheet').getByText('2 zugesagt', { exact: true }).waitFor({ timeout: 15000 })
  })

  await step('shared plans show up as avatars', async () => {
    await ben.keyboard.press('Escape')
    await nav(ben, 'Line-up')
    await ben.locator('.act .avatars').first().waitFor({ timeout: 15000 })
  })

  await step('community report is confirmed by another member', async () => {
    await lea.keyboard.press('Escape')
    await nav(lea, 'Map')
    await lea.getByRole('button', { name: 'Wasser', exact: true }).click()
    await lea.getByRole('button', { name: 'Wasserstelle Nord' }).click()
    await lea.getByRole('button', { name: 'Problem melden' }).click()
    await lea.getByRole('button', { name: 'Wasser leer' }).click()
    await lea.getByRole('button', { name: 'Veröffentlichen' }).click()
    await lea.getByText('Meldung veröffentlicht').waitFor()
    await ben.reload()
    await ben.locator('.section-h button', { hasText: 'Alle' }).click()
    await ben.locator('.sheet').getByText('Wasser leer: Wasserstelle Nord').waitFor({ timeout: 15000 })
    await ben.locator('.sheet').getByRole('button', { name: /Stimmt noch/ }).first().click()
    await ben.getByText('Danke – als weiterhin gültig bestätigt').waitFor()
  })

  await step('sync is incremental and backs off while the network is down', async () => {
    const crewCalls = []
    const onReq = (r) => /\/api\/crews\/c_/.test(r.url()) && r.method() === 'GET' && crewCalls.push({ url: r.url(), t: Date.now() })
    lea.on('request', onReq)
    await lea.waitForTimeout(17000)
    if (!crewCalls.some((c) => c.url.includes('since='))) throw new Error('expected incremental polls with ?since=')
    const online = crewCalls.length
    crewCalls.length = 0
    await lea.context().setOffline(true)
    await lea.waitForTimeout(40000)
    const offline = crewCalls.length
    await lea.context().setOffline(false)
    lea.off('request', onReq)
    // 8 s polling would try ~5 times in 40 s; with backoff (8 → 16 → 32 s) it is at most 3
    if (offline > 3) throw new Error(`no backoff: ${offline} crew requests while offline`)
    console.log(`  (${online} polls in 17 s online, ${offline} attempts in 40 s offline)`)
    await lea.locator('.bubble').first().count()
  })

  await step('new messages arrive incrementally without a reload', async () => {
    for (const p of [lea, ben]) {
      await p.keyboard.press('Escape')
      await p.keyboard.press('Escape')
      await p.waitForTimeout(400)
      await nav(p, 'Crew')
    }
    await lea.getByRole('button', { name: /^Crew-Chat/ }).click()
    await ben.getByRole('button', { name: /^Crew-Chat/ }).click()
    await ben.getByPlaceholder(/Nachricht/).fill('Inkrementell 👋')
    await ben.getByRole('button', { name: 'Senden' }).click()
    await lea.locator('.bubble.them', { hasText: 'Inkrementell 👋' }).waitFor({ timeout: 20000 })
    if ((await lea.locator('.bubble', { hasText: 'Treffen am Archive?' }).count()) !== 1) throw new Error('older messages lost or duplicated after incremental merge')
    await lea.keyboard.press('Escape')
    await ben.keyboard.press('Escape')
  })

  await step('official announcement from the organizer CLI reaches the app as an alert', async () => {
    const { execFileSync } = await import('node:child_process')
    execFileSync('node', ['worker/scripts/announce.mjs', 'add', 'Bühne Lagoon pausiert wegen Wind', '--severity', 'warning', '--place', 'Lagoon', '--valid', '30'], {
      env: { ...process.env, REALM_API: API, REALM_ADMIN_TOKEN: 'e2e-admin' },
    })
    await lea.reload()
    const alert = lea.locator('.alert.warning', { hasText: 'Bühne Lagoon pausiert wegen Wind' })
    await alert.waitFor({ timeout: 15000 })
    await alert.click()
    await lea.locator('.sheet').getByText('Gültig noch 30 Min.').waitFor()
    await lea.keyboard.press('Escape')
  })

  await step('recovery code restores Ben on a new device', async () => {
    await ben.keyboard.press('Escape')
    await ben.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await ben.getByText('Profil sichern').click()
    await ben.getByRole('button', { name: /Recovery-Code erstellen/ }).click()
    const recovery = (await ben.locator('.code').textContent()).trim()
    const fresh = await user()
    await fresh.goto(WEB)
    await fresh.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await fresh.getByText('Profil mit Code wiederherstellen').click()
    await fresh.getByPlaceholder('XXXX-XXXX-XXXX-XXXX').fill(recovery)
    await fresh.getByRole('button', { name: 'Wiederherstellen' }).click()
    await fresh.getByText('Profil wiederhergestellt').waitFor()
    await fresh.keyboard.press('Escape')
    await nav(fresh, 'Crew')
    await fresh.getByText('Zeltplatz 14', { exact: true }).waitFor({ timeout: 15000 })
  })

  if (process.env.SHOTS) {
    await lea.reload()
    await nav(lea, 'Crew')
    await lea.waitForTimeout(1500)
    await lea.screenshot({ path: `${process.env.SHOTS}/live-crew.png` })
    const newbie = await user()
    await newbie.goto(`${WEB}/?join=${code}`)
    await nav(newbie, 'Crew')
    await newbie.waitForTimeout(1200)
    await newbie.screenshot({ path: `${process.env.SHOTS}/live-onboarding.png` })
  }
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'))
  console.log('All live end-to-end tests passed')
} catch (e) {
  console.error(e, errors)
  if (process.env.SHOTS) for (const [i, p] of browser.contexts().flatMap((c) => c.pages()).entries()) await p.screenshot({ path: `${process.env.SHOTS}/fail-${i}.png` }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  for (const p of procs) {
    try {
      process.kill(-p.pid)
    } catch {}
  }
}
