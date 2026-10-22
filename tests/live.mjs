// Two-user end-to-end test against the real worker (wrangler dev, local D1) and the Vite dev server.
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { launch, promiseScrollIntoView } from './browser.mjs'

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
// the platform's legal texts (Welle 7) – without them no festival can go live
await fetch(`${API}/api/admin/platform/legal`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-admin' }, body: JSON.stringify({ imprint: 'Realm Test GmbH, Musterstraße 1, 12345 Musterstadt', privacy: 'Datenschutzhinweise der Plattform (Test)' }) })

const browser = await launch()
const errors = []
const user = async () => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'de-DE' })
  await ctx.addInitScript(promiseScrollIntoView)
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
/** the current code of an authenticator app for a base32 secret (RFC 6238) */
const totpCode = (secret, step = Math.floor(Date.now() / 30000)) => {
  let bits = 0, val = 0
  const key = []
  for (const ch of secret.replace(/\s/g, '')) {
    val = (val << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch)
    bits += 5
    if (bits >= 8) key.push((val >>> (bits -= 8)) & 255)
  }
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', Buffer.from(key)).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0')
}
const nav = (p, t) => p.locator('nav').getByText(t).click()
const name = async (p, n) => {
  await p.getByPlaceholder('Spitzname').fill(n)
  if (await p.getByRole('button', { name: 'Weiter', exact: true }).isEnabled()) throw new Error('age notice must be confirmed before continuing')
  await p.getByLabel(/Ich bin mindestens \d+ Jahre alt/).check()
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

  await step('profile tells the truth about storage (audit F13): on the server, not recoverable without a code', async () => {
    await lea.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    // legal notice from the profile (Welle 7)
    await lea.locator('.sheet').getByRole('button', { name: 'Impressum' }).click()
    await lea.locator('.sheet').getByText('Realm Test GmbH, Musterstraße 1, 12345 Musterstadt').waitFor()
    await lea.keyboard.press('Escape') // back to the profile underneath
    await lea.locator('.sheet').getByText('Auf dem Server gespeichert · ohne Recovery-Code nicht wiederherstellbar').waitFor()
    if (await lea.locator('.sheet').getByText('Nur auf diesem Gerät gespeichert').count()) throw new Error('profile claims device-only storage')
    if (await lea.locator('.sheet').getByText(/Passkey|Apple|Google/).count()) throw new Error('profile announces sign-in methods that do not exist')
    await lea.keyboard.press('Escape')
  })

  await step('Lea plans her acts (every live festival starts with an empty plan)', async () => {
    await nav(lea, 'Line-up')
    for (const artist of ['Maduk', 'Arcturus']) await lea.locator('.act', { hasText: artist }).getByRole('button', { name: 'Zum Plan hinzufügen' }).click()
    await lea.waitForTimeout(1200) // plan upload is debounced
    await nav(lea, 'Crew')
  })

  let invite
  await step('the invite link names the festival (audit F11)', async () => {
    await lea.evaluate(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (x) => void (window.__copied = x) }, configurable: true })
    })
    await lea.getByRole('button', { name: 'Einladen' }).click()
    await lea.getByText('Einladungslink kopiert').waitFor()
    invite = await lea.evaluate(() => window.__copied)
    if (invite !== `${WEB}/?f=realm-open-air&join=${code}`) throw new Error('invite link without festival: ' + invite)
  })

  await step('Ben asks to join via the invite link; Lea approves him (audit F05)', async () => {
    await ben.goto(invite)
    await nav(ben, 'Crew')
    await ben.getByText('Du wurdest in eine Crew eingeladen').waitFor()
    await ben.getByRole('button', { name: 'Beitreten' }).first().click()
    await name(ben, 'Ben')
    // until approved, Ben sees nothing of the crew
    await ben.getByRole('heading', { name: 'Anfrage gesendet' }).waitFor()
    if (await ben.getByText(/Personen · Code|Crew-Chat/).count()) throw new Error('pending member sees the crew')
    await lea.reload()
    await nav(lea, 'Crew')
    await lea.getByText('Ben möchte beitreten').click({ timeout: 15000 })
    await lea.locator('.sheet').getByRole('button', { name: 'Freigeben' }).click()
    await lea.getByText('Beitritt freigegeben').waitFor()
    await lea.keyboard.press('Escape')
    await ben.getByText(/2 Personen · Code/).waitFor({ timeout: 15000 })
    await ben.getByText('Zeltplatz 14', { exact: true }).waitFor()
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

  await step('a hanging request times out and does not block the outbox (audit F17)', async () => {
    // the first send hangs forever (a stalled festival network); the old client waited endlessly and sent nothing after it
    let hung = false
    await ben.route('**/api/crews/*/messages', (route) => {
      if (route.request().method() === 'POST' && !hung) {
        hung = true
        return // never answered
      }
      return route.continue()
    })
    await ben.getByRole('button', { name: /^Crew-Chat/ }).click()
    for (const text of ['Hängt das?', 'Und danach']) {
      await ben.getByPlaceholder(/Nachricht/).fill(text)
      await ben.getByRole('button', { name: 'Senden' }).click()
    }
    await ben.locator('.bubble.me:not(.pending)', { hasText: 'Und danach' }).waitFor({ timeout: 45000 })
    await ben.locator('.bubble.me:not(.pending)', { hasText: 'Hängt das?' }).waitFor()
    await ben.unroute('**/api/crews/*/messages')
    await ben.keyboard.press('Escape')
    await lea.reload()
    await nav(lea, 'Crew')
    await lea.getByRole('button', { name: /^Crew-Chat/ }).click()
    const texts = await lea.locator('.bubble.them').allInnerTexts()
    const a = texts.findIndex((x) => x.includes('Hängt das?'))
    const b = texts.findIndex((x) => x.includes('Und danach'))
    if (a < 0 || b < a) throw new Error('messages missing or out of order: ' + JSON.stringify(texts.slice(-4)))
    await lea.keyboard.press('Escape')
  })

  await step('privacy (audit F02): a location share switched off while offline ends on the server after reconnect – without reload', async () => {
    const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('realm.v2:realm-open-air') ?? '{}'))
    const { session, crewRef } = await stored(lea)
    const benShares = async () => {
      const r = await fetch(`${API}/api/crews/${crewRef.id}`, { headers: { Authorization: 'Bearer ' + session.token, 'X-Festival': 'realm-open-air' } })
      return (await r.json()).members.find((m) => m.nickname === 'Ben')?.sharing
    }
    const until = async (want, ms = 20000) => {
      for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) if ((await benShares()) === want) return
      throw new Error(`server still reports sharing=${!want} after ${ms} ms`)
    }
    await nav(ben, 'Crew')
    const toggle = ben.getByRole('switch', { name: 'Standort teilen' })
    await toggle.click()
    await until(true)
    await ben.context().setOffline(true)
    await toggle.click()
    if ((await toggle.getAttribute('aria-checked')) !== 'false') throw new Error('switch did not turn off')
    await ben.getByText(/wird zurückgezogen/).waitFor() // the app does not pretend it is already done
    await ben.waitForTimeout(1500)
    if ((await benShares()) !== true) throw new Error('precondition: server should not know yet')
    await ben.context().setOffline(false)
    await until(false)
    await ben.getByText(/wird zurückgezogen/).waitFor({ state: 'detached', timeout: 15000 })
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
    // the way to immediate help comes before the form (audit D05)
    const sos = lea.locator('.sheet .alert.critical', { hasText: 'Notfall? Ruf 112 – das hier ist kein Notruf.' })
    if ((await sos.getByRole('link', { name: '112 anrufen' }).getAttribute('href')) !== 'tel:112') throw new Error('no direct 112 call')
    await sos.getByRole('button', { name: 'Sanitätszelt' }).waitFor()
    await lea.getByRole('button', { name: 'Wasser leer' }).click()
    await lea.getByRole('button', { name: 'Veröffentlichen' }).click()
    await lea.getByText('Meldung veröffentlicht').waitFor()
    await ben.reload()
    await ben.locator('.section-h button', { hasText: 'Alle' }).click()
    await ben.locator('.sheet').getByText('Wasser leer: Wasserstelle Nord').waitFor({ timeout: 15000 })
    // a count of people, never a check (audit F06); the reporter cannot confirm her own report
    const item = ben.locator('.sheet .list-item', { hasText: 'Wasser leer: Wasserstelle Nord' })
    await item.getByText('Von 1 Person gemeldet · nicht geprüft').waitFor()
    await item.getByRole('button', { name: /Stimmt noch/ }).click()
    await ben.getByText('Danke – als weiterhin gültig bestätigt').waitFor()
    await item.getByText('Von 2 Personen gemeldet · nicht geprüft').waitFor()
    await item.getByRole('button', { name: 'Inhalt melden', exact: true }).click()
    await item.getByLabel('Meldegrund', { exact: true }).selectOption('other')
    await item.getByLabel('Erläuterung (optional)').fill('Wasser ist wieder vorhanden')
    await item.getByRole('button', { name: 'Meldung absenden' }).click()
    await ben.getByText('Gemeldet – danke').first().waitFor()
    await ben.keyboard.press('Escape')
    await lea.reload()
    await lea.locator('.section-h button', { hasText: 'Alle' }).click()
    const own = lea.locator('.sheet .list-item', { hasText: 'Wasser leer: Wasserstelle Nord' })
    await own.getByRole('button', { name: 'Erledigt – zurückziehen' }).waitFor()
    if (await own.getByRole('button', { name: /Stimmt noch/ }).count()) throw new Error('reporter can confirm her own report')
    await lea.keyboard.press('Escape')
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
    const polls = []
    const observe = async (r) => {
      if (r.request().method() === 'GET' && /\/api\/crews\/[^/?]+(?:\?|$)/.test(r.url())) {
        const data = await r.json().catch(() => ({}))
        polls.push({ at: Date.now(), status: r.status(), messages: data.messages?.map((m) => ({ id: m.id, text: m.text })) })
      }
    }
    lea.on('response', observe)
    for (const p of [lea, ben]) {
      await p.keyboard.press('Escape')
      await p.keyboard.press('Escape')
      await p.waitForTimeout(400)
      await nav(p, 'Crew')
    }
    await lea.getByRole('button', { name: /^Crew-Chat/ }).click()
    await ben.getByRole('button', { name: /^Crew-Chat/ }).click()
    await ben.getByPlaceholder(/Nachricht/).fill('Inkrementell 👋')
    const sent = ben.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/crews\/[^/]+\/messages$/.test(r.url()))
    await ben.getByRole('button', { name: 'Senden' }).click()
    const response = await sent
    if (!response.ok()) throw new Error(`incremental message rejected: ${response.status()} ${await response.text()}`)
    await ben.locator('.bubble.me', { hasText: 'Inkrementell 👋' }).waitFor()
    try {
      await lea.locator('.bubble.them', { hasText: 'Inkrementell 👋' }).waitFor({ timeout: 20000 })
    } catch (e) {
      console.error('Incremental receiver diagnostics', { polls, browser: await lea.evaluate(() => ({
        online: navigator.onLine, visibility: document.visibilityState,
        bubbles: [...document.querySelectorAll('.bubble')].map((el) => el.textContent),
      })) })
      throw e
    } finally {
      lea.off('response', observe)
    }
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

  await step('honest navigation (audit F04/D02): no invented position, no route without a chosen place, no guidance to help points', async () => {
    await nav(lea, 'Map')
    if (await lea.locator('.me-dot').count()) throw new Error('map shows a position nobody gave')
    await lea.getByRole('button', { name: 'Standort wählen' }).waitFor()
    await lea.getByRole('button', { name: 'Bars' }).click()
    await lea.getByRole('button', { name: 'Red Bull Bar' }).click()
    await lea.locator('.sheet').getByText('Entfernung: erst Standort wählen').waitFor()
    await lea.locator('.sheet').getByRole('button', { name: 'Richtung', exact: true }).click()
    // no position known: the app asks instead of guessing, then continues to the direction
    await lea.locator('.sheet').getByRole('heading', { name: 'Wo bist du gerade?' }).waitFor()
    await lea.locator('.sheet').getByRole('button', { name: 'Food Court' }).click()
    await lea.locator('.route-banner').getByText('Richtung Red Bull Bar').waitFor()
    await lea.locator('.route-banner').getByText(/Luftlinie · folge Wegen und Schildern/).waitFor()
    await lea.locator('.me-dot').waitFor()
    await lea.getByRole('button', { name: 'Route beenden' }).click()
    // the medical tent: emergency number and staff, no pseudo-precise way
    await lea.getByRole('button', { name: 'Medical' }).click()
    await lea.getByRole('button', { name: 'Sanitätszelt' }).click()
    await lea.locator('.sheet').getByText('Im Notfall: 112').waitFor()
    if (await lea.locator('.sheet').getByRole('button', { name: 'Richtung', exact: true }).count()) throw new Error('help point offers a direction')
    await lea.keyboard.press('Escape')
  })

  await step('live content (audit D01/D03): arrival shows only published data, the official warning stays on top', async () => {
    await lea.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await lea.locator('.sheet').getByText('Demo · Anreise').click()
    await lea.getByRole('heading', { name: 'Willkommen bei Realm Open Air.' }).waitFor()
    for (const invented of ['Shuttle ab Bahnhof', '24° und sonnig', 'Camping B · Reihe 14', 'Eingang Nord · ca. 25 Min.', 'Demo-Beispiel'])
      if (await lea.getByText(invented).count()) throw new Error('invented demo card in live mode: ' + invented)
    const first = lea.locator('.stack > *').first()
    if (!(await first.evaluate((el) => el.classList.contains('alert')))) throw new Error('official warning is not the first thing on Home during arrival')
    await first.getByText('Bühne Lagoon pausiert wegen Wind').waitFor()
    await lea.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await lea.locator('.sheet').getByText('Demo · Festival').click()
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
    // personal account (audit F01): the platform invites Olga for this one festival; she sets password and 2FA
    const inv = await (await fetch(`${API}/api/admin/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-admin' }, body: JSON.stringify({ email: 'olga@realm.test', festival: 'realm-open-air' }) })).json()
    await org.goto(`${WEB}/#admin?invite=${inv.token}`)
    await org.getByLabel('Dein Name').fill('Olga')
    await org.getByLabel('Passwort (mindestens 12 Zeichen)').fill('olgas-langes-passwort')
    await org.getByLabel('Passwort wiederholen').fill('olgas-langes-passwort')
    await org.getByRole('button', { name: 'Konto anlegen' }).click()
    const secret = await org.getByLabel('Geheimer Schlüssel').innerText()
    await org.getByLabel('6-stelliger Code').fill(totpCode(secret))
    await org.getByRole('button', { name: 'Einrichtung abschließen' }).click()
    // only her festival is in the list
    await org.getByLabel('Festival').locator('option', { hasText: 'Realm Open Air' }).waitFor({ state: 'attached' })
    const options = await org.getByLabel('Festival').locator('option').allInnerTexts()
    if (options.length !== 1 || !options[0].startsWith('Realm Open Air')) throw new Error('organizer sees other festivals: ' + options.join(', '))
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
    // the change log names Olga for each change
    await org.getByRole('tab', { name: 'Zugang' }).click()
    const log = org.getByLabel('Änderungsprotokoll')
    await log.locator('.list-item', { hasText: 'POST /api/admin/announcements' }).getByText('Olga').waitFor()
    await log.locator('.list-item', { hasText: 'PUT /api/admin/timetable/' }).first().getByText('Olga').waitFor()
    // 320 px (audit D09): one compact area picker instead of rows of tabs; status one tap away
    await org.setViewportSize({ width: 320, height: 700 })
    if (await org.locator('.admin-tabs').isVisible()) throw new Error('tab rows still shown on a narrow phone')
    const picker = org.locator('.admin-picker')
    const box = await picker.boundingBox()
    if (!box || box.height > 90) throw new Error('area picker too tall: ' + JSON.stringify(box))
    await picker.getByLabel('Bereich').selectOption({ label: 'Meldungen' })
    await org.getByPlaceholder('z. B. Gewitterwarnung ab 22:30').waitFor()
    await picker.getByRole('button', { name: 'Status' }).click()
    await org.getByRole('heading', { name: 'Prüfen & veröffentlichen' }).waitFor()
    if ((await org.evaluate(() => document.documentElement.scrollWidth - innerWidth)) > 0) throw new Error('console scrolls sideways at 320 px')
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
    if (await ben.getByRole('button', { name: 'Meldung absenden' }).isEnabled()) throw new Error('a report requires a reason category')
    await ben.getByLabel('Meldegrund', { exact: true }).selectOption('harassment')
    await ben.getByLabel('Erläuterung (optional)').fill('Bitte durch den Veranstalter prüfen')
    await ben.getByRole('button', { name: 'Meldung absenden' }).click()
    await ben.getByText('Gemeldet – danke').first().waitFor()
    const mod = await user()
    await mod.setViewportSize({ width: 1200, height: 900 })
    await mod.goto(`${WEB}/#admin`)
    await mod.getByRole('button', { name: 'Plattform-Schlüssel verwenden' }).click()
    await mod.getByLabel('Schlüssel').fill('e2e-admin')
    await mod.getByRole('button', { name: 'Anmelden', exact: true }).click()
    await mod.getByRole('combobox', { name: 'Festival', exact: true }).selectOption('realm-open-air')
    // Deliver the old festival response after the selected crew response. It must not
    // replace the current list or erase the decision form.
    const oldChatPattern = '**/api/admin/festivals/realm-open-air/chat?kind=festival'
    let releaseOldChat
    const oldChatGate = new Promise((resolve) => { releaseOldChat = resolve })
    let oldChatStarted
    const oldChatRequest = new Promise((resolve) => { oldChatStarted = resolve })
    await mod.route(oldChatPattern, async (route) => {
      const response = await route.fetch()
      oldChatStarted()
      await oldChatGate
      await route.fulfill({ response })
    })
    await mod.getByRole('tab', { name: 'Chat-Moderation' }).click()
    await oldChatRequest
    await mod.locator('.card').getByLabel('Bereich', { exact: true }).selectOption('crew')
    const reported = mod.locator('.list-item', { hasText: 'Bitte melden' })
    await reported.getByText('Belästigung oder Drohung: Bitte durch den Veranstalter prüfen').waitFor()
    const decision = 'Verstoß gegen die Crew-Regeln nach Prüfung.'
    await reported.getByLabel('Begründung der Entscheidung').fill(decision)
    const oldChatResponse = mod.waitForResponse((r) => r.url().endsWith('/chat?kind=festival'))
    releaseOldChat()
    await (await oldChatResponse).finished()
    await mod.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await mod.unroute(oldChatPattern)
    if (await mod.locator('.card').getByLabel('Bereich', { exact: true }).inputValue() !== 'crew' ||
        await reported.getByLabel('Begründung der Entscheidung').inputValue() !== decision) {
      throw new Error('late festival response replaced the crew decision draft')
    }
    if (await mod.getByText('Wir treffen uns').count()) throw new Error('unreported crew text exposed in moderation')
    mod.once('dialog', (d) => d.accept())
    await reported.getByRole('button', { name: /löschen/ }).click()
    await lea.getByText('Vom Veranstalter entfernt: Verstoß gegen die Crew-Regeln nach Prüfung.').waitFor({ timeout: 20000 })
    await lea.keyboard.press('Escape')
    await ben.keyboard.press('Escape')
    await mod.getByRole('tab', { name: 'Meldungen', exact: true }).click()
    const reportRow = mod.locator('.list-item', { hasText: 'Wasser leer: Wasserstelle Nord' })
    await reportRow.getByText('Anderer Grund: Wasser ist wieder vorhanden').waitFor()
    if (await reportRow.getByRole('button', { name: /beenden/ }).isEnabled()) throw new Error('ending a report requires a reason')
    await reportRow.getByLabel('Begründung der Entscheidung').fill('Vor Ort geprüft: Wasser ist wieder vorhanden.')
    await reportRow.getByRole('button', { name: /beenden/ }).click()
    await reportRow.waitFor({ state: 'detached' })
    await lea.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await lea.getByText('Vom Veranstalter entfernt: Vor Ort geprüft: Wasser ist wieder vorhanden.').waitFor()
    await lea.keyboard.press('Escape')
    await mod.getByRole('tab', { name: 'Zugang' }).click()
    await mod.getByLabel('Änderungsprotokoll').getByText('Vor Ort geprüft: Wasser ist wieder vorhanden.').waitFor()
    await mod.close()
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
    await org.getByRole('button', { name: 'Plattform-Schlüssel verwenden' }).click()
    await org.getByLabel('Schlüssel').fill('falsch')
    await org.getByRole('button', { name: 'Anmelden', exact: true }).click()
    await org.getByRole('alert').waitFor()
    await org.getByLabel('Schlüssel').fill('e2e-admin')
    await org.getByRole('button', { name: 'Anmelden', exact: true }).click()
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
    // step 4 (audit D10): the checklist follows what is switched on – no entrance, no medical point, no FAQ for the bot
    const publishBtn = org.getByRole('button', { name: 'Veröffentlichen', exact: true })
    const dataChecks = org.getByLabel('Datenprüfung')
    for (const t of ['Mindestens ein Eingang auf der Karte', 'Sanität auf der Karte', 'Freigegebene FAQ für den FAQ-Bot']) await dataChecks.locator('li', { hasText: t }).getByLabel('fehlt').waitFor()
    if (await publishBtn.isEnabled()) throw new Error('publishing possible without entrance/medical point')
    const AH = { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-admin' }
    await fetch(`${API}/api/admin/festivals/testwiese-festival/map`, { method: 'PUT', headers: AH, body: JSON.stringify({ pois: [{ id: 'ein', cat: 'entrance', name: 'Haupteingang', x: 100, y: 100 }, { id: 'san', cat: 'medical', name: 'Sanität', x: 200, y: 200 }] }) })
    await fetch(`${API}/api/admin/festivals/testwiese-festival/faq/notfall`, { method: 'PUT', headers: AH, body: JSON.stringify({ question: 'Wo ist die Sanität?', answer: 'Neben dem Haupteingang.', category: 'Sicherheit', status: 'published' }) })
    await org.getByRole('button', { name: 'Erneut prüfen' }).click()
    await dataChecks.locator('li', { hasText: 'Sanität auf der Karte' }).getByLabel('erfüllt').waitFor()
    // the organizer's confirmations; the preview one only after the preview was opened
    for (const t of [/stimmen mit dem Gelände überein/, /offizielle Warnungen/, /Nur diese Funktionen/, /Moderation der Community-Funktionen/]) await org.getByLabel(t).check()
    if (await publishBtn.isEnabled()) throw new Error('publishing possible without preview')
    const [preview] = await Promise.all([org.context().waitForEvent('page'), org.getByRole('button', { name: 'Vorschau öffnen' }).click()])
    await preview.getByText('Vorschau · Entwurf').waitFor()
    await preview.getByRole('heading', { name: 'Testwiese Festival' }).waitFor()
    await preview.close()
    await org.getByLabel(/Besucher-Vorschau wurde angesehen/).check()
    // visitors cannot see the draft yet
    if ((await fetch(`${API}/api/festivals/testwiese-festival`)).status !== 404) throw new Error('draft visible to visitors')
    await publishBtn.click()
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

    // festival chat: opt-in; three reports hide spam; the organizer deletes it
    await org.getByRole('tab', { name: 'Module' }).click()
    await org.getByRole('switch', { name: 'Festival-Chat' }).click()
    await org.getByRole('button', { name: 'Module speichern' }).click()
    await org.getByText('Module gespeichert').waitFor()
    await visitor.reload()
    await visitor.getByRole('heading', { name: 'Testwiese Festival' }).waitFor()
    await visitor.getByRole('button', { name: /Festival-Chat/ }).first().click()
    await visitor.getByText('Noch ruhig hier').waitFor()
    await visitor.getByLabel('Nachricht an alle').fill('Wer teilt sich ein Taxi zum Bahnhof?')
    await visitor.getByRole('button', { name: 'Senden' }).click()
    // first social action on this device: the app asks for a name, then sends
    await name(visitor, 'Uma')
    await visitor.locator('.bubble.me', { hasText: 'Taxi zum Bahnhof' }).waitFor()
    const T = (token) => ({ ...H(token) })
    const spammer = await (await fetch(`${API}/api/guests`, { method: 'POST', headers: H(), body: JSON.stringify({ nickname: 'Spam' }) })).json()
    const spam = await (await fetch(`${API}/api/festival-chat`, { method: 'POST', headers: T(spammer.token), body: JSON.stringify({ text: 'Billige Tickets hier!!!' }) })).json()
    await visitor.locator('.bubble.them', { hasText: 'Billige Tickets' }).waitFor({ timeout: 15000 }) // arrives by polling
    // Reading festival chat requires a guest session. An unnamed guest must retain the
    // selected report reason through the first named action's identity dialog.
    const unnamedResponse = await fetch(`${API}/api/guests`, { method: 'POST', headers: H(), body: '{}' })
    if (!unnamedResponse.ok) throw new Error('unnamed reporter setup failed: ' + unnamedResponse.status)
    const unnamed = await unnamedResponse.json()
    const firstReporter = await user()
    await firstReporter.addInitScript(({ id, token }) => {
      localStorage.setItem('realm.v2:testwiese-festival', JSON.stringify({
        session: { id, token }, guest: { id, nickname: null, color: '#A58CFF', secured: null },
        clockMode: 'demo', phase: 'during',
      }))
    }, { id: unnamed.id, token: unnamed.token })
    await firstReporter.goto(`${WEB}/?f=testwiese-festival`)
    await firstReporter.getByRole('button', { name: /Festival-Chat/ }).first().click()
    await firstReporter.locator('.bubble.them', { hasText: 'Billige Tickets' }).click()
    await firstReporter.getByRole('button', { name: 'Melden', exact: true }).click()
    await firstReporter.getByLabel('Meldegrund', { exact: true }).selectOption('spam')
    await firstReporter.getByLabel('Erläuterung (optional)').fill('Unverlangte Ticketwerbung')
    await firstReporter.getByRole('button', { name: 'Meldung absenden' }).click()
    await name(firstReporter, 'Erstmeldung')
    await firstReporter.getByText('Gemeldet – danke').first().waitFor()
    await firstReporter.context().close()
    for (const name of ['V1', 'V2', 'V3']) {
      const g = await (await fetch(`${API}/api/guests`, { method: 'POST', headers: H(), body: JSON.stringify({ nickname: name }) })).json()
      const r = await fetch(`${API}/api/festival-chat/${spam.id}/flag`, { method: 'POST', headers: T(g.token), body: JSON.stringify({ category: 'spam', detail: 'Unverlangte Ticketwerbung' }) })
      if (!r.ok) throw new Error('flag failed: ' + r.status)
    }
    await visitor.getByText('Ausgeblendet – von mehreren gemeldet').waitFor({ timeout: 15000 })
    if (await visitor.getByText('Billige Tickets').count()) throw new Error('hidden spam still visible')
    await visitor.keyboard.press('Escape')
    await org.reload()
    await org.getByRole('tab', { name: 'Chat-Moderation' }).click()
    const row = org.locator('.list-item', { hasText: 'Billige Tickets' })
    await row.getByText('ausgeblendet', { exact: true }).waitFor()
    if (process.env.SHOTS) await org.screenshot({ path: `${process.env.SHOTS}/chat-moderation.png`, fullPage: true })
    await row.getByText('Spam oder Werbung: Unverlangte Ticketwerbung').first().waitFor()
    if (await row.getByRole('button', { name: /löschen/ }).isEnabled()) throw new Error('moderation requires a reason')
    await row.getByLabel('Begründung der Entscheidung').fill('Unverlangte Ticketwerbung verstößt gegen die Chatregeln.')
    org.once('dialog', (d) => d.accept())
    await row.getByRole('button', { name: /löschen/ }).click()
    await org.getByText('Nachricht gelöscht').waitFor()
    // the toast can appear before the list re-renders: wait for the row to go, not a one-shot count
    await row.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {
      throw new Error('deleted message still listed')
    })
    const ownRow = org.locator('.list-item', { hasText: 'Wer teilt sich ein Taxi zum Bahnhof?' })
    await ownRow.getByLabel('Begründung der Entscheidung').fill('Testentscheidung: Beitrag entfernt.')
    org.once('dialog', (d) => d.accept())
    await ownRow.getByRole('button', { name: /löschen/ }).click()
    await visitor.getByRole('button', { name: /Festival-Chat/ }).first().click()
    await visitor.getByText('Vom Veranstalter entfernt: Testentscheidung: Beitrag entfernt.').waitFor({ timeout: 15000 })
    await visitor.keyboard.press('Escape')
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

    // the owner removes Ben; his device notices on the next poll; the old code is dead – for any profile (audit F05)
    await lea.keyboard.press('Escape')
    await nav(lea, 'Crew')
    await lea.getByRole('button', { name: /^Mitglieder/ }).click()
    lea.once('dialog', (d) => d.accept())
    await lea.getByRole('button', { name: 'Ben entfernen' }).click()
    await lea.getByText(/Entfernt · neuer Einladungscode/).waitFor()
    await fresh.getByText('Du bist nicht mehr Mitglied dieser Crew').waitFor({ timeout: 20000 })
    await fresh.getByPlaceholder('ABCD-EFGH').fill(code)
    await fresh.getByRole('button', { name: 'Beitreten' }).last().click()
    await fresh.getByText('Einladung nicht gefunden').waitFor()
    const other = await user()
    await other.goto(invite)
    await nav(other, 'Crew')
    await other.getByRole('button', { name: 'Beitreten' }).first().click()
    await name(other, 'Ben2')
    await other.getByText('Einladung nicht gefunden').waitFor()
  })

  await step('busy festival WLAN (audit F08): past the free quota the app solves the sign-up challenge on its own', async () => {
    // fill this address's free quota from the test (same address as the browser: localhost)
    for (let i = 0; i < 80; i++) {
      const r = await fetch(`${API}/api/guests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (r.status === 429) break
    }
    const late = await user()
    await late.goto(WEB)
    await nav(late, 'Crew')
    await late.getByLabel('Crew-Name').fill('Späte Crew')
    await late.getByRole('button', { name: 'Crew gründen' }).click()
    await name(late, 'Spät')
    await late.getByText(/Person.* · Code/).waitFor({ timeout: 20000 })
  })

  await step('deleting the profile removes every local copy and every server profile, across festivals (audit F12)', async () => {
    const p = await user()
    const found = async (url, crew, nick) => {
      await p.goto(url)
      await nav(p, 'Crew')
      await p.getByLabel('Crew-Name').fill(crew)
      await p.getByRole('button', { name: 'Crew gründen' }).click()
      if (nick) await name(p, nick)
      await p.getByText(/Person.* · Code/).waitFor({ timeout: 20000 })
    }
    await found(WEB, 'Erstes Festival', 'Lösch')
    await found(`${WEB}/?f=nordlicht`, 'Zweites Festival', 'Lösch2')
    const stored = () => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('realm.v2')).map((k) => [k, JSON.parse(localStorage.getItem(k)).session?.token ?? null]))
    const tokens = (await stored()).map(([, t]) => t).filter(Boolean)
    if (tokens.length < 2) throw new Error('expected a session per festival: ' + JSON.stringify(await stored()))
    await p.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await p.getByRole('button', { name: 'Profil löschen' }).click()
    await p.getByRole('button', { name: 'Löschen', exact: true }).click()
    await p.getByText('Profil und alle Daten gelöscht').waitFor()
    const left = (await stored()).filter(([, t]) => t)
    if (left.length) throw new Error('identity copies left in the browser: ' + JSON.stringify(left))
    for (const t of tokens) {
      const r = await fetch(`${API}/api/me`, { headers: { Authorization: 'Bearer ' + t, 'X-Festival': 'realm-open-air' } })
      if (r.status !== 401) throw new Error('server profile still exists: ' + r.status)
    }
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
