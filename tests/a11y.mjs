// Accessibility audit with axe-core across all screens and key sheets (demo mode).
// Fails on "serious" and "critical" violations; lists "moderate" ones as warnings.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const AXE = require.resolve('axe-core/axe.min.js')
const PORT = 4322
const url = `http://localhost:${PORT}`
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true })
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(url)).ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 200))
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, reducedMotion: 'reduce' })
const results = []
async function audit(name) {
  await page.waitForTimeout(500)
  await page.addScriptTag({ path: AXE })
  const r = await page.evaluate(async () => {
    // @ts-ignore
    const res = await window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) , count: v.nodes.length }))
  })
  results.push({ name, violations: r })
}
const nav = (t) => page.locator('nav').getByText(t).click()

let exitCode = 0
try {
  await page.goto(url)
  await audit('Home')
  await page.getByRole('button', { name: 'Details' }).click()
  await audit('Act-Sheet')
  await page.keyboard.press('Escape')
  await nav('Line-up')
  await audit('Line-up · Liste')
  await page.getByRole('button', { name: 'Filter' }).click()
  await audit('Line-up · Filter offen')
  await page.getByRole('button', { name: 'Timeline-Ansicht' }).click()
  await audit('Line-up · Timeline')
  await page.locator('.conflict').first().click().catch(() => {})
  await audit('Konflikt-Resolver')
  await page.keyboard.press('Escape')
  await nav('Map')
  await audit('Karte')
  await page.getByRole('button', { name: 'Wasserstelle Nord' }).click()
  await audit('Karte · Ort-Sheet')
  await page.keyboard.press('Escape')
  await nav('Crew')
  await audit('Crew')
  await page.getByRole('button', { name: /^Crew-Chat/ }).click()
  await page.locator('.bubble.them').first().click()
  await audit('Crew-Chat · Nachrichtenaktionen')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Mitglieder/ }).click()
  await audit('Mitglieder')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Profil & Einstellungen' }).click()
  await audit('Profil')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Infos & FAQ' }).click()
  await page.getByLabel('Frage an den Festival-Bot').fill('Wo ist das Fundbüro?')
  await page.getByRole('button', { name: 'Fragen' }).click()
  await page.locator('.faq-item button').first().click()
  await audit('Infos & FAQ mit Bot-Antwort')
  await page.keyboard.press('Escape')
  await page.goto(url + '/#admin').catch(() => {}) // the hash change triggers a reload into the console
  await page.waitForLoadState('load')
  await page.getByText('Kein Server konfiguriert').waitFor()
  await audit('Admin (ohne Server)')

  let serious = 0
  for (const { name, violations } of results) {
    const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    serious += bad.length
    console.log(`${bad.length ? '✗' : '✓'} ${name}${violations.length ? ` – ${violations.length} Befund(e)` : ''}`)
    for (const v of violations) console.log(`    [${v.impact}] ${v.id}: ${v.help} (${v.count}×) ${v.nodes.join(' | ')}`)
  }
  if (serious) {
    console.error(`\n${serious} schwerwiegende Barrierefreiheits-Befunde`)
    exitCode = 1
  } else console.log('\nKeine schwerwiegenden Barrierefreiheits-Befunde')
} catch (e) {
  console.error(e)
  exitCode = 1
} finally {
  await browser.close()
  try {
    process.kill(-server.pid)
  } catch {}
  process.exitCode = exitCode
}
