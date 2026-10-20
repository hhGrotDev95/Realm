// End-to-end smoke test: builds must already exist (npm run build).
import { spawn } from 'node:child_process'
import { launch, promiseScrollIntoView } from './browser.mjs'

const PORT = 4321
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true })
const url = `http://localhost:${PORT}`
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(url)).ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 200))
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, locale: 'de-DE' })
await page.addInitScript(promiseScrollIntoView)
const errors = []
/** set when the offline step takes the server down: network errors after that are expected */
let serverDownAt = Infinity
let currentStep = 'start'
/** every page error with the step and page it happened on, plus failed requests – engines word errors differently */
const watch = (pg, tag) => {
  pg.on('pageerror', (e) => errors.push({ message: e.message, at: Date.now(), where: `${currentStep} [${tag}]` }))
  pg.on('requestfailed', (r) => failed.push(`${currentStep} [${tag}] ${r.url()} – ${r.failure()?.errorText}`))
}
const failed = []
watch(page, 'main')
const step = async (name, fn) => {
  currentStep = name
  await fn()
  await page.waitForTimeout(350)
  console.log('✓', name)
}

try {
  await page.goto(url)
  await step('home shows next act', () => page.getByText('Als Nächstes').waitFor())
  await step('rsvp asks for a name first', async () => {
    await page.getByRole('button', { name: 'Bin dabei' }).click()
    await page.getByPlaceholder('Spitzname').fill('Test')
    await page.getByRole('button', { name: 'Weiter' }).click()
    await page.getByText('Du bist dabei').waitFor()
  })
  await step('timetable change is shown on Home and in the line-up', async () => {
    await page.locator('.alert', { hasText: 'Arcturus: jetzt 22:30' }).waitFor()
    await page.locator('nav').getByText('Line-up').click()
    await page.locator('.act', { hasText: 'Arcturus' }).getByText('Neu 22:30 statt 22:15').waitFor()
    await page.locator('nav').getByText('Home').click()
  })
  await step('FAQ bot answers from approved FAQ with source, admits what it does not know', async () => {
    await page.getByRole('button', { name: 'Infos & FAQ' }).click()
    await page.getByLabel('Frage an den Festival-Bot').fill('Akku leer – wo kann ich mein Handy laden?')
    await page.getByRole('button', { name: 'Fragen' }).click()
    await page.getByText('Quelle: Service-Seite').waitFor()
    await page.getByLabel('Frage an den Festival-Bot').fill('Wer ist der Headliner am Samstag?')
    await page.getByRole('button', { name: 'Fragen' }).click()
    await page.getByText(/keine freigegebene Antwort/).waitFor()
    await page.keyboard.press('Escape')
  })
  await step('line-up resolves a conflict', async () => {
    await page.locator('nav').getByText('Line-up').click()
    await page.locator('.conflict').first().click()
    await page.locator('.sheet .card').first().click()
    await page.getByRole('button', { name: /behalten$/ }).click()
    await page.getByText(/^Entschieden:/).waitFor()
  })
  await step('my plan shows walking time between sets and exports to the calendar', async () => {
    await page.getByRole('tab', { name: 'Mein Plan' }).click()
    await page.locator('.gap').filter({ hasText: /Laufweg zur|gleiche Stage/ }).first().waitFor()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Plan in den Kalender' }).click()])
    const ics = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8')
    const planned = await page.evaluate(() => JSON.parse(localStorage.getItem('realm.v2') ?? '{}').plan?.length ?? 0)
    const events = ics.split('BEGIN:VEVENT').length - 1
    if (!ics.startsWith('BEGIN:VCALENDAR') || events < 1 || events > planned) throw new Error(`calendar export: ${events} events for ${planned} planned acts`)
    if (!download.suggestedFilename().endsWith('.ics')) throw new Error('not an .ics file: ' + download.suggestedFilename())
  })
  await step('timeline view renders', async () => {
    await page.getByRole('button', { name: 'Timeline-Ansicht' }).click()
    await page.locator('.tl-act').first().waitFor()
  })
  await step('map opens poi sheet and routes', async () => {
    await page.locator('nav').getByText('Map').click()
    await page.getByRole('button', { name: 'Bars' }).click()
    await page.getByRole('button', { name: 'Red Bull Bar' }).click()
    await page.locator('.sheet').getByRole('button', { name: 'Route' }).click()
    await page.getByText('zu Fuß').waitFor()
  })
  await step('crew suggests a fair meeting point and routes there', async () => {
    await page.locator('nav').getByText('Crew').click()
    const card = page.locator('.fair')
    await card.getByText('Fairer Treffpunkt für alle').waitFor()
    const place = (await card.locator('span[style*="font-weight: 600"]').innerText()).trim()
    await card.getByRole('button', { name: 'Route' }).click()
    await page.locator('.route-banner').getByText('bis ' + place).waitFor()
  })
  await step('crew chat sends a message', async () => {
    await page.locator('nav').getByText('Crew').click()
    await page.getByText('Crew-Chat').click()
    await page.getByPlaceholder(/Nachricht/).fill('Hallo Crew')
    await page.getByRole('button', { name: 'Senden' }).click()
    await page.locator('.bubble.me', { hasText: 'Hallo Crew' }).waitFor()
    // moderation: report someone else's message, delete your own
    await page.locator('.bubble.them', { hasText: 'Klingt gut' }).click()
    await page.getByRole('button', { name: 'Melden', exact: true }).click()
    await page.getByText('Ausgeblendet – von der Crew gemeldet').waitFor()
    page.once('dialog', (d) => d.accept())
    await page.locator('.bubble.me', { hasText: 'Hallo Crew' }).click()
    await page.getByRole('button', { name: 'Löschen', exact: true }).click()
    await page.getByText('Nachricht gelöscht').waitFor()
    await page.keyboard.press('Escape')
  })
  await step('wrapped opens after the festival', async () => {
    await page.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await page.locator('.sheet').getByText('Danach').click()
    await page.getByText('Ansehen').click()
    await page.locator('.wrapped').waitFor()
  })
  await step('real-time clock shows the actual countdown', async () => {
    await page.locator('.wrapped [aria-label="Schließen"]').click()
    await page.getByRole('button', { name: 'Profil & Einstellungen' }).click()
    await page.locator('.sheet').getByText('Echtzeit').click()
    const days = Math.ceil((new Date(2027, 6, 15, 10).getTime() - Date.now()) / 86_400_000)
    if (days > 0) await page.getByText(`Noch ${days} Tage`).waitFor()
  })
  await step('English browser gets the English app; the language can be switched in the profile', async () => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'en-US' })
    const p = await ctx.newPage()
    watch(p, 'second')
    await p.goto(url)
    await p.getByText('Up next').waitFor()
    if ((await p.evaluate(() => document.documentElement.lang)) !== 'en') throw new Error('html lang not set to en')
    await p.locator('nav').getByText('Line-up').click()
    await p.getByRole('tab', { name: 'All', exact: true }).click()
    await p.locator('.day-btn', { hasText: 'Fri' }).waitFor() // day names derived from the date
    await p.locator('.act', { hasText: 'Arcturus' }).getByText('Now 22:30 instead of 22:15').waitFor()
    await p.getByRole('button', { name: 'Profile & settings' }).click()
    // switching the language reloads the page; let lazy chunks finish first, or WebKit reports
    // the request the reload cancels ("Importing a module script failed") as a page error
    await p.waitForLoadState('networkidle')
    await p.getByRole('button', { name: 'Deutsch' }).click()
    await p.getByText('Als Nächstes').waitFor() // reloaded in German, choice remembered over the browser language
    await p.reload()
    await p.getByText('Als Nächstes').waitFor()
    await ctx.close()
  })
  await step('narrow phone (320 px) with larger text: line-up toolbar fits, no clipped labels, no sideways scroll', async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 700 }, locale: 'de-DE' })
    const p = await ctx.newPage()
    await p.goto(url)
    // fonts differ between machines; scale the labels up so wrapping shows up everywhere (users with larger text)
    await p.addStyleTag({ content: '.seg button, .nav button { font-size: 16px !important }' })
    await p.locator('nav').getByText('Line-up').click()
    const report = await p.evaluate(() => ({
      clipped: [...document.querySelectorAll('.seg button, .nav button')].filter((b) => b.scrollHeight > b.clientHeight + 1 || (b.closest('.seg') && b.getBoundingClientRect().height > 44)).map((b) => b.textContent),
      toolbarRight: document.querySelector('.toolbar').getBoundingClientRect().right,
      overflow: document.documentElement.scrollWidth - innerWidth,
    }))
    if (report.clipped.length || report.toolbarRight > 320 || report.overflow > 0) throw new Error('narrow layout: ' + JSON.stringify(report))
    await ctx.close()
  })
  await step('offline: after ONE online visit the app and lazily loaded screens open with the server down', async () => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: 'de-DE' })
    const p = await ctx.newPage()
    watch(p, 'second')
    await p.goto(url)
    await p.getByText('Als Nächstes').waitFor()
    await p.evaluate(() => navigator.serviceWorker.ready)
    await p.waitForTimeout(1500) // let the service worker finish installing (it caches the whole build)
    // Playwright's setOffline does not cover service-worker fetches, so take the server down instead:
    // from here on there is really no network, only what the service worker cached.
    try {
      serverDownAt = Date.now()
      process.kill(-server.pid)
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
    if (process.env.DEBUG_OFFLINE) p.on('requestfailed', (r) => console.log('  failed offline:', r.url().replace(url, '')))
    await p.reload()
    await p.getByText('Als Nächstes').waitFor()
    await p.locator('nav').getByText('Map').click()
    await p.getByPlaceholder(/Suchen/).waitFor()
    await p.locator('nav').getByText('Crew').click()
    await p.getByText('Wo ist meine Crew?').waitFor()
    await p.getByRole('button', { name: 'Infos & FAQ' }).click()
    await p.getByLabel('Frage an den Festival-Bot').waitFor()
    await ctx.close()
  })
  // a fetch failing while the server is down is expected; real page errors are not
  // a request failing once the server is down is expected (wording differs per engine: Chromium,
  // Firefox, WebKit incl. a lazy module that could not be fetched); before that, every error counts
  const network = /Failed to fetch|NetworkError|Load failed|Importing a module script failed/
  errors.splice(0, errors.length, ...errors.filter((e) => !(e.at >= serverDownAt && network.test(e.message))))
  if (errors.length) throw new Error('Page errors:\n' + errors.map((e) => `${e.where}: ${e.message}`).join('\n') + '\nFailed requests:\n' + failed.join('\n'))
  console.log('All smoke tests passed')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
  try {
    process.kill(-server.pid)
  } catch {}
}
