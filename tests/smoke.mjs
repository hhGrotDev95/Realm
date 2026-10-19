// End-to-end smoke test: builds must already exist (npm run build).
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4321
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true })
const url = `http://localhost:${PORT}`
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(url)).ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 200))
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await browser.newPage({ viewport: { width: 400, height: 860 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const step = async (name, fn) => {
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
  await step('line-up resolves a conflict', async () => {
    await page.locator('nav').getByText('Line-up').click()
    await page.locator('.conflict').first().click()
    await page.locator('.sheet .card').first().click()
    await page.getByRole('button', { name: /behalten$/ }).click()
    await page.getByText(/^Entschieden:/).waitFor()
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
  await step('crew chat sends a message', async () => {
    await page.locator('nav').getByText('Crew').click()
    await page.getByText('Crew-Chat').click()
    await page.getByPlaceholder(/Nachricht/).fill('Hallo Crew')
    await page.getByRole('button', { name: 'Senden' }).click()
    await page.locator('.bubble.me', { hasText: 'Hallo Crew' }).waitFor()
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
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'))
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
