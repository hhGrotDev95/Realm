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
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'de-DE' })
  // pin the app clock to "Friday 19:52" so the scenario does not depend on today's date
  await ctx.addInitScript(() => {
    try {
      localStorage.getItem('realm.v2') || localStorage.setItem('realm.v2', JSON.stringify({ clockMode: 'demo', phase: 'during' }))
    } catch {} // browser error pages (offline reload) have no storage
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message))
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

  await step('Lea plans her acts (every live festival starts with an empty plan)', async () => {
    await nav(lea, 'Line-up')
    for (const artist of ['Maduk', 'Arcturus']) await lea.locator('.act', { hasText: artist }).getByRole('button', { name: 'Zum Plan hinzufügen' }).click()
    await lea.waitForTimeout(1200) // plan upload is debounced
    await nav(lea, 'Crew')
  })

  await step('Ben joins via invite link', async () => {
    await ben.goto(`${WEB}/?join=${code}`)
    await nav(ben, 'Crew')
    await ben.getByText('Du wurdest in eine Crew eingeladen').waitFor()
    await ben.getByRole('button', { name: 'Beitreten' }).first().click()
    await name(ben, 'Ben')
    await ben.getByText('Zeltplatz 14', { exact: true }).waitFor()
    await ben.getByText(/2 Personen · Code/).waitFor()
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

  await step('organizer cancels an act: plan alert and struck-through row', async () => {
    const res = await fetch(`${API}/api/admin/timetable/1-maduk`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-admin', 'X-Festival': 'realm-open-air' }, body: JSON.stringify({ cancelled: true, note: 'Krankheit' }) })
    if (!res.ok) throw new Error('admin PUT failed ' + res.status)
    await lea.reload()
    await lea.locator('.alert.critical', { hasText: 'Maduk: abgesagt' }).waitFor({ timeout: 15000 })
    await nav(lea, 'Line-up')
    await lea.locator('.act.cancelled', { hasText: 'Maduk' }).getByText('Abgesagt').waitFor()
    await fetch(`${API}/api/admin/timetable/1-maduk`, { method: 'DELETE', headers: { Authorization: 'Bearer e2e-admin', 'X-Festival': 'realm-open-air' } })
    await nav(lea, 'Home')
  })

  await step('organizer console: login, announcement, timetable change reach the app', async () => {
    const org = await user()
    await org.setViewportSize({ width: 1200, height: 900 })
    await org.goto(`${WEB}/#admin`)
    await org.getByLabel('Admin-Token').fill('falsch')
    await org.getByRole('button', { name: 'Anmelden' }).click()
    await org.getByRole('alert').filter({ hasText: 'Token ungültig' }).waitFor()
    await org.getByLabel('Admin-Token').fill('e2e-admin')
    await org.getByRole('button', { name: 'Anmelden' }).click()
    await org.getByPlaceholder('z. B. Gewitterwarnung ab 22:30').fill('Shuttle fährt ab 23 Uhr alle 5 Min.')
    await org.getByRole('button', { name: 'Veröffentlichen' }).click()
    await org.getByText('Meldung veröffentlicht').waitFor()
    await org.locator('.list-item', { hasText: 'Shuttle fährt ab 23 Uhr alle 5 Min.' }).waitFor()
    await org.getByRole('tab', { name: /Live-Änderungen/ }).click()
    await org.getByRole('button', { name: 'Freitag' }).click()
    await org.locator('.list-item', { hasText: 'Ruby Kade' }).click()
    await org.getByRole('button', { name: '+30 Min.' }).click()
    await org.getByPlaceholder('z. B. Technischer Umbau').fill('Anreise verspätet')
    await org.getByRole('button', { name: 'Änderung veröffentlichen' }).click()
    await org.locator('.list-item', { hasText: 'Ruby Kade' }).getByText('→ 18:15').waitFor()
    if (process.env.SHOTS) await org.screenshot({ path: `${process.env.SHOTS}/admin.png` })
    await lea.reload()
    await lea.getByText('Shuttle fährt ab 23 Uhr alle 5 Min.').first().waitFor({ timeout: 15000 })
    await nav(lea, 'Line-up')
    await lea.getByRole('tab', { name: 'Alle', exact: true }).click()
    await lea.locator('.act', { hasText: 'Ruby Kade' }).getByText('Neu 18:15 statt 17:45').waitFor({ timeout: 15000 })
    await org.getByRole('button', { name: 'Zurücksetzen' }).click()
    await org.getByText('Originalzeit wiederhergestellt').waitFor()
    await nav(lea, 'Home')
  })

  await step('moderation: owner deletes a message, member reports one', async () => {
    for (const p of [lea, ben]) {
      await p.keyboard.press('Escape')
      await p.waitForTimeout(300)
      await nav(p, 'Crew')
      await p.getByRole('button', { name: /^Crew-Chat/ }).click()
    }
    lea.once('dialog', (d) => d.accept())
    await lea.locator('.bubble.them', { hasText: 'Inkrementell 👋' }).click()
    await lea.getByRole('button', { name: 'Löschen', exact: true }).click()
    await ben.locator('.bubble.removed', { hasText: 'Nachricht gelöscht' }).waitFor({ timeout: 20000 })
    await lea.getByPlaceholder(/Nachricht/).fill('Bitte melden')
    await lea.getByRole('button', { name: 'Senden' }).click()
    await ben.locator('.bubble.them', { hasText: 'Bitte melden' }).click({ timeout: 20000 })
    await ben.getByRole('button', { name: 'Melden', exact: true }).click()
    await ben.getByText('Gemeldet – danke').waitFor()
    await lea.keyboard.press('Escape')
    await ben.keyboard.press('Escape')
  })

  await step('tenants: switching festival shows other data and keeps crews apart', async () => {
    await lea.keyboard.press('Escape')
    await lea.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await lea.locator('.sheet').getByRole('button', { name: /Nordlicht Sessions/ }).click()
    await lea.getByRole('heading', { name: 'Nordlicht Sessions' }).waitFor()
    await nav(lea, 'Line-up')
    await lea.getByRole('tab', { name: 'Alle', exact: true }).click()
    await lea.locator('.act', { hasText: 'Tidewater' }).waitFor()
    if (await lea.locator('.act', { hasText: 'Maduk' }).count()) throw new Error('acts of another festival leaked')
    await nav(lea, 'Crew')
    await lea.getByRole('heading', { name: 'Crew gründen' }).waitFor() // no crew here yet
    await lea.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await lea.locator('.sheet').getByRole('button', { name: /Realm Open Air/ }).click()
    await lea.getByRole('heading', { name: 'Realm Open Air' }).waitFor()
    await nav(lea, 'Crew')
    await lea.getByText('Zeltplatz 14', { exact: true }).waitFor({ timeout: 15000 })
  })

  await step('organizer sets up a new festival: wizard, xlsx import with row errors, preview, publish', async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/node')
    const org = await user()
    await org.setViewportSize({ width: 1200, height: 900 })
    await org.goto(`${WEB}/#admin`)
    await org.getByLabel('Admin-Token').fill('e2e-admin')
    await org.getByRole('button', { name: 'Anmelden' }).click()
    await org.getByRole('button', { name: 'Neues Festival' }).click()
    await org.getByPlaceholder('z. B. Sommerwiese Open Air').fill('Testwiese Festival')
    await org.getByLabel('Erster Tag').fill('2027-06-04')
    await org.getByLabel('Tage', { exact: true }).fill('2')
    await org.getByRole('button', { name: 'Als Entwurf anlegen' }).click()
    await org.getByText('„Testwiese Festival“ als Entwurf angelegt').waitFor()
    // step 2: stages
    await org.getByLabel('Name Bühne 1').fill('Wiese')
    await org.getByRole('button', { name: 'Speichern & weiter' }).click()
    await org.getByRole('heading', { name: 'Timetable importieren' }).waitFor()
    // step 3: xlsx with one bad row → blocked with row number
    const header = ['Act', 'Bühne', 'Tag', 'Beginn', 'Ende'].map((value) => ({ value }))
    const r = (a, st, d, b, e) => [a, st, d, b, e].map((value) => ({ value }))
    const xlsx = async (rows) => writeXlsxFile([header, ...rows]).toBuffer()
    const file = (buffer) => ({ name: 'timetable.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
    await org.getByLabel('Timetable-Datei wählen').setInputFiles(file(await xlsx([r('Morgentau', 'Wiese', 'Freitag', '20:00', '21:00'), r('Nachtfalter', 'Zelt', 'Fr', '24:30', '02:00'), r('Geist', 'Wiese', 'Montag', '20:00', '21:00')])))
    await org.getByText('Zeile 4').waitFor()
    await org.getByRole('button', { name: 'Erst Fehler beheben' }).waitFor()
    await org.getByLabel('Timetable-Datei wählen').setInputFiles(file(await xlsx([r('Morgentau', 'Wiese', 'Freitag', '20:00', '21:00'), r('Nachtfalter', 'Zelt', 'Fr', '24:30', '02:00')])))
    await org.getByText('Neue Bühne „Zelt“ wird angelegt').waitFor()
    await org.getByRole('button', { name: /Zusammenführen – importieren/ }).click()
    await org.getByText('Importiert: 2 neu, 0 geändert').waitFor()
    await org.getByRole('button', { name: 'Weiter (2 Acts)' }).click()
    // step 4: preview the draft in a new tab, then publish
    const [preview] = await Promise.all([org.context().waitForEvent('page'), org.getByRole('button', { name: 'Vorschau öffnen' }).click()])
    await preview.getByText('Vorschau · Entwurf').waitFor()
    await preview.getByRole('heading', { name: 'Testwiese Festival' }).waitFor()
    await preview.close()
    // visitors cannot see the draft yet
    if ((await fetch(`${API}/api/festivals/testwiese-festival`)).status !== 404) throw new Error('draft visible to visitors')
    await org.getByRole('button', { name: 'Veröffentlichen' }).click()
    await org.getByText('Festival ist veröffentlicht').waitFor()
    await org.getByRole('tab', { name: 'Status', selected: true }).waitFor() // wizard gives way to the status view
    // a visitor opens it: night set sorted into Friday night
    const visitor = await user()
    await visitor.goto(`${WEB}/?f=testwiese-festival`)
    await visitor.getByRole('heading', { name: 'Testwiese Festival' }).waitFor()
    await nav(visitor, 'Line-up')
    await visitor.getByRole('tab', { name: 'Alle', exact: true }).click()
    await visitor.locator('.act', { hasText: 'Nachtfalter' }).getByText('00:30').waitFor()
    if (process.env.SHOTS) await org.screenshot({ path: `${process.env.SHOTS}/wizard.png`, fullPage: true })

    // branding: an unreadable colour is refused, a good one with logo and font reaches visitors
    await org.getByRole('tab', { name: 'Branding' }).click()
    await org.getByLabel('Farbe als Hex-Wert').fill('#1a1a6e')
    await org.getByText(/nicht gut lesbar/).waitFor()
    if (await org.getByRole('button', { name: 'Branding speichern' }).isEnabled()) throw new Error('low-contrast colour could be saved')
    await org.getByRole('button', { name: 'Farbe #4fd1c5' }).click()
    await org.getByLabel('Schrift für Überschriften').selectOption('space')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAGUlEQVR42mNk+M9QzwAEjDAGjEEBNCEWAABxPQX1o6VMmQAAAABJRU5ErkJggg==', 'base64')
    await org.getByLabel('Logo-Datei wählen').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
    await org.getByAltText('Aktuelles Logo').waitFor()
    if (process.env.SHOTS) await org.screenshot({ path: `${process.env.SHOTS}/branding.png`, fullPage: true })
    await org.getByRole('button', { name: 'Branding speichern' }).click()
    await org.getByText('Branding gespeichert').waitFor()
    await visitor.reload()
    await visitor.getByRole('heading', { name: 'Testwiese Festival' }).waitFor()
    const brand = await visitor.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim())
    if (brand !== '#4fd1c5') throw new Error('brand colour not applied: ' + brand)
    const display = await visitor.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--display'))
    if (!display.includes('Space Grotesk')) throw new Error('font not applied: ' + display)
    await visitor.locator('.appbar img.logo-img').waitFor()

    // modules: switching off "Crew & Freunde" removes the crew tab for visitors and the API refuses it
    await org.getByRole('tab', { name: 'Module' }).click()
    await org.getByRole('switch', { name: 'Crew & Freunde' }).click()
    if ((await org.getByRole('switch', { name: 'Crew-Chat' }).getAttribute('aria-checked')) !== 'false') throw new Error('dependent module stayed on')
    await org.getByRole('button', { name: 'Module speichern' }).click()
    await org.getByText('Module gespeichert').waitFor()
    await visitor.reload()
    await visitor.getByRole('heading', { name: 'Testwiese Festival' }).waitFor()
    if (await visitor.locator('nav').getByText('Crew').count()) throw new Error('crew tab still visible')
    await visitor.locator('nav').getByText('Map').waitFor()
    const guest = await (await fetch(`${API}/api/guests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Test' }) })).json()
    const refused = await fetch(`${API}/api/crews`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + guest.token, 'X-Festival': 'testwiese-festival' }, body: JSON.stringify({ name: 'X' }) })
    if (refused.status !== 403) throw new Error('crew API not refused: ' + refused.status)

    // FAQ: a draft stays invisible; once published the bot answers with source – also offline
    await org.getByRole('tab', { name: 'FAQ' }).click()
    await org.getByRole('button', { name: 'Neue Frage' }).click()
    await org.getByLabel('Frage', { exact: true }).fill('Gibt es Schließfächer?')
    await org.getByLabel('Antwort', { exact: true }).fill('Ja, am Eingang Wiese gibt es Schließfächer für 5 € pro Tag.')
    await org.getByLabel('Quelle (z. B. Hausordnung)').fill('Service-Infos')
    await org.getByLabel(/Stichworte für den Bot/).fill('locker, wertsachen, aufbewahren')
    await org.getByRole('button', { name: 'Speichern' }).click()
    await org.getByText('Als Entwurf gespeichert').waitFor()
    await visitor.reload()
    await visitor.getByRole('button', { name: 'Infos & FAQ' }).click()
    await visitor.getByLabel('Frage an den Festival-Bot').fill('Wo kann ich Wertsachen aufbewahren?')
    await visitor.getByRole('button', { name: 'Fragen' }).click()
    await visitor.getByText(/keine freigegebene Antwort/).waitFor()
    await org.locator('.list-item', { hasText: 'Gibt es Schließfächer?' }).click()
    await org.getByLabel(/Freigeben/).check()
    await org.getByRole('button', { name: 'Speichern' }).click()
    await org.getByText('Antwort freigegeben').waitFor()
    await visitor.reload()
    await visitor.getByRole('heading', { name: 'Testwiese Festival' }).waitFor()
    // the dev server has no service worker: load the FAQ chunk once online (production precaches it, see smoke test)
    await visitor.getByRole('button', { name: 'Infos & FAQ' }).click()
    await visitor.getByLabel('Frage an den Festival-Bot').waitFor()
    await visitor.keyboard.press('Escape')
    await visitor.context().setOffline(true)
    await visitor.getByRole('button', { name: 'Infos & FAQ' }).click()
    await visitor.getByLabel('Frage an den Festival-Bot').fill('Wo kann ich Wertsachen aufbewahren?')
    await visitor.getByRole('button', { name: 'Fragen' }).click()
    await visitor.getByText('Quelle: Service-Infos').waitFor()
    await visitor.context().setOffline(false)

    // map editor: upload a site plan, place a new point by clicking, name it; visitors find it on the map
    await visitor.keyboard.press('Escape')
    await org.getByRole('tab', { name: 'Karte' }).click()
    await org.getByLabel('Bühne Wiese – mit Pfeiltasten verschieben').waitFor() // stages are on the map from the start
    await org.locator('input[type=file][accept^="image/png"]').setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: png })
    await org.getByRole('button', { name: 'Plan entfernen' }).waitFor()
    const canvas = await org.getByLabel('Karte bearbeiten').boundingBox()
    await org.mouse.click(canvas.x + canvas.width * 0.8, canvas.y + canvas.height * 0.2)
    await org.getByLabel('Name', { exact: true }).fill('Schließfächer')
    await org.getByLabel('Kategorie').selectOption('info')
    await org.getByLabel('Schließfächer – mit Pfeiltasten verschieben').press('Shift+ArrowLeft')
    if (process.env.SHOTS) await org.screenshot({ path: `${process.env.SHOTS}/map-editor.png`, fullPage: true })
    await org.getByRole('button', { name: 'Karte speichern' }).click()
    await org.getByText('Karte gespeichert').waitFor()
    const doc = await (await fetch(`${API}/api/festivals/testwiese-festival`)).json()
    const locker = doc.pois.find((p) => p.name === 'Schließfächer')
    if (!locker || Math.abs(locker.x - 775) > 15 || Math.abs(locker.y - 188) > 15) throw new Error('point not saved where it was placed: ' + JSON.stringify(locker))
    if (!doc.festival.siteMap?.startsWith('data:image/jpeg')) throw new Error('site plan not saved')
    await visitor.reload()
    await visitor.getByRole('heading', { name: 'Testwiese Festival' }).waitFor()
    await nav(visitor, 'Map')
    await visitor.locator('.map-wrap image').waitFor({ state: 'attached' })
    await visitor.getByLabel('Karte durchsuchen').fill('Schließ')
    await visitor.getByRole('button', { name: /Schließfächer/ }).first().waitFor()

    // analytics: three visitors plan the same act, the bot misses the same question three times
    const bundle = await (await fetch(`${API}/api/festivals/testwiese-festival`)).json()
    const falter = bundle.acts.find((a) => a.artist === 'Nachtfalter').id
    const H = (token) => ({ 'Content-Type': 'application/json', 'X-Festival': 'testwiese-festival', ...(token ? { Authorization: 'Bearer ' + token } : {}) })
    for (const name of ['Ida', 'Jan', 'Kim']) {
      const g = await (await fetch(`${API}/api/guests`, { method: 'POST', headers: H(), body: JSON.stringify({ nickname: name }) })).json()
      const r = await fetch(`${API}/api/me/plan`, { method: 'PUT', headers: H(g.token), body: JSON.stringify({ acts: [falter] }) })
      if (!r.ok) throw new Error('plan not saved: ' + r.status)
    }
    await visitor.getByRole('button', { name: 'Infos & FAQ' }).click()
    for (let i = 0; i < 3; i++) {
      await visitor.getByLabel('Frage an den Festival-Bot').fill(i ? 'Gibt es Duschen' : 'Gibt es Duschen?')
      await visitor.getByRole('button', { name: 'Fragen' }).click()
      await visitor.getByText(/keine freigegebene Antwort/).waitFor()
    }
    await org.getByRole('tab', { name: 'Auswertung' }).click()
    await org.locator('.bars li', { hasText: 'Nachtfalter' }).getByText('3', { exact: true }).waitFor()
    await org.getByText('„gibt es duschen“').waitFor()
    await org.locator('.heat td', { hasText: '3' }).first().waitFor()
    if (process.env.SHOTS) await org.screenshot({ path: `${process.env.SHOTS}/analytics.png`, fullPage: true })
    await org.getByRole('button', { name: '„gibt es duschen“ als erledigt markieren' }).click()
    await org.getByText('Keine offenen Fragen', { exact: false }).waitFor()

    // English content: an English visitor gets the organizer's English FAQ and announcement
    await org.getByRole('tab', { name: 'FAQ' }).click()
    await org.locator('.list-item', { hasText: 'Gibt es Schließfächer?' }).click()
    await org.getByText('Englische Fassung (optional)').click()
    await org.getByLabel('Frage (Englisch)').fill('Are there lockers?')
    if (await org.getByRole('button', { name: 'Speichern' }).isEnabled()) throw new Error('half an English version could be saved')
    await org.getByLabel('Antwort (Englisch)').fill('Yes, lockers at the meadow entrance, €5 per day.')
    await org.getByLabel('Stichworte (Englisch)').fill('valuables, store, safe')
    await org.getByRole('button', { name: 'Speichern' }).click()
    await org.getByText('Antwort freigegeben').waitFor()
    await org.getByRole('tab', { name: 'Meldungen' }).click()
    await org.getByPlaceholder('z. B. Gewitterwarnung ab 22:30').fill('Wiese schließt um 1 Uhr')
    await org.getByText('Englische Fassung (optional)').click()
    await org.getByLabel('Titel (Englisch)').fill('Meadow closes at 1 am')
    await org.getByRole('button', { name: 'Veröffentlichen' }).click()
    await org.getByText('Meldung veröffentlicht').waitFor()
    const enCtx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'en-US' })
    const en = await enCtx.newPage()
    await en.goto(`${WEB}/?f=testwiese-festival`)
    await en.getByText('Meadow closes at 1 am').first().waitFor()
    await en.getByRole('button', { name: 'Info & FAQ' }).click()
    await en.getByText('Are there lockers?').waitFor()
    await en.getByLabel('Question for the festival bot').fill('Where can I store my valuables?')
    await en.getByRole('button', { name: 'Ask', exact: true }).click()
    await en.locator('.faq-answer').getByText('Yes, lockers at the meadow entrance, €5 per day.').waitFor()
    await enCtx.close()
  })

  await step('recovery code restores Ben on a new device; the owner removes him', async () => {
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

    // the owner removes Ben; his device notices on the next poll and cannot rejoin
    await lea.keyboard.press('Escape')
    await nav(lea, 'Crew')
    await lea.getByRole('button', { name: /^Mitglieder/ }).click()
    lea.once('dialog', (d) => d.accept())
    await lea.getByRole('button', { name: 'Ben entfernen' }).click()
    await lea.getByText('Mitglied entfernt').waitFor()
    await fresh.getByText('Du bist nicht mehr Mitglied dieser Crew').waitFor({ timeout: 20000 })
    await fresh.getByPlaceholder('ABCD-EFGH').fill(code)
    await fresh.getByRole('button', { name: 'Beitreten' }).last().click()
    await fresh.getByText('Du wurdest aus dieser Crew entfernt').waitFor()
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
