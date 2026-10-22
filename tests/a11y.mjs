// Accessibility audit with axe-core across all screens and key sheets (demo mode).
// Fails on "serious" and "critical" violations; lists "moderate" ones as warnings.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { launch, promiseScrollIntoView } from './browser.mjs'

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

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, reducedMotion: 'reduce', locale: 'de-DE' })
await page.addInitScript(promiseScrollIntoView)
const results = []
/**
 * Waits until nothing moves any more: contrast is only meaningful once fade-ins (inline opacity
 * and transforms set by the animation library) have settled – a fixed delay raced lazy screens.
 */
async function settled() {
  let last = ''
  for (let stable = 0, i = 0; stable < 3 && i < 100; i++) {
    await page.waitForTimeout(100)
    const now = await page.evaluate(
      () => [...document.querySelectorAll('[style]')].map((e) => e.getAttribute('style')).join('|') + document.getAnimations().filter((a) => a.playState === 'running').length,
    )
    stable = now === last ? stable + 1 : 0
    last = now
  }
}
async function audit(name) {
  await settled()
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
  // D06: the previous day consists of past (dimmed) and cancelled acts – their text must stay readable
  await page.getByRole('tab', { name: 'Alle', exact: true }).click()
  await page.locator('.day-btn').first().click()
  await page.locator('.act.past').first().waitFor()
  await audit('Line-up · Vortag (vergangene Acts)')
  await page.locator('.day-btn').nth(1).click()
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
  await page.getByRole('button', { name: 'Melden', exact: true }).click()
  await page.getByLabel('Meldegrund', { exact: true }).selectOption('harassment')
  await audit('Crew-Chat · begründete Inhaltsmeldung')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Mitglieder/ }).click()
  await audit('Mitglieder')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Profil & Einstellungen' }).click()
  await audit('Profil')
  // D07: a modal keeps keyboard focus inside – Tab never reaches the page behind it
  const escaped = []
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const where = await page.evaluate(() => {
      const el = document.activeElement
      return el?.closest('.sheet') ? null : `${el?.tagName}${el?.getAttribute('aria-label') ? ` "${el.getAttribute('aria-label')}"` : ''}`
    })
    if (where) escaped.push(where)
  }
  results.push({ name: 'Profil · Tastaturfokus bleibt im Dialog', violations: escaped.length ? [{ id: 'focus-escape', impact: 'serious', help: 'Tab verlässt den modalen Dialog', nodes: [...new Set(escaped)].slice(0, 3), count: escaped.length }] : [] })
  await page.locator('.sheet').getByRole('button', { name: 'Schließen' }).click()
  await page.locator('.sheet').waitFor({ state: 'detached' })
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
