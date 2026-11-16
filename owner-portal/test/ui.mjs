// Test-only local adapter: the deployed entry point never supplies an Access identity.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { build } from '../build.mjs'
import { createHandler } from '../src/handler.mjs'

const data = JSON.parse(await readFile(await build(), 'utf8'))
const handler = createHandler(data)
const server = createServer(async (req, res) => {
  try {
    const response = await handler.fetch(new Request(`http://localhost${req.url}`),
      { OWNER_EMAIL: 'owner@example.test' },
      { access: { getIdentity: async () => ({ email: 'owner@example.test' }) } })
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(await response.text())
  } catch { res.writeHead(500); res.end('Test adapter failed') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  const url = `http://127.0.0.1:${server.address().port}`
  for (const width of [320, 390, 1280]) {
    // CSP is bypassed only to inject axe in this isolated test server.
    const page = await browser.newPage({ viewport: { width, height: 844 }, bypassCSP: true })
    const response = await page.goto(url)
    assert.equal(response.status(), 200)
    assert.equal(await page.getByRole('progressbar').getAttribute('value'), String(data.progress.done))
    assert.equal(await page.getByRole('link', { name: 'Adminportal' }).getAttribute('href'),
      'https://realm-staging.heidlhannes95.workers.dev/#admin')
    assert.equal(await page.getByRole('link', { name: 'App testen' }).getAttribute('href'),
      'https://realm-staging.heidlhannes95.workers.dev/')
    assert.equal(await page.getByRole('link', { name: 'Abmelden' }).getAttribute('href'), '/cdn-cgi/access/logout')
    await page.locator('summary').click()
    assert.equal(await page.locator('.gate:visible').count(), data.progress.total)
    await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') })
    const violations = await page.evaluate(async () => (await window.axe.run(document)).violations
      .filter(item => ['serious', 'critical'].includes(item.impact))
      .map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })))
    assert.deepEqual(violations, [], `Accessibility at ${width}px`)
    const checkOverflow = async () => {
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
      }))
      assert.ok(dimensions.scroll <= dimensions.width + 1, `Horizontal overflow at ${width}px: ${JSON.stringify(dimensions)}`)
    }
    await checkOverflow()
    if (process.env.OWNER_SCREENSHOT_DIR) {
      await page.locator('summary').click()
      await page.evaluate(() => window.scrollTo(0, 0))
      await mkdir(process.env.OWNER_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: `${process.env.OWNER_SCREENSHOT_DIR}/owner-${width}.png`, fullPage: true })
      await page.screenshot({ path: `${process.env.OWNER_SCREENSHOT_DIR}/owner-${width}-viewport.png` })
    }
    // Enlarge every computed font, including px-based type, to test text-only scaling.
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll('body *')].map(el => [el, parseFloat(getComputedStyle(el).fontSize)])
      for (const [el, size] of sizes) el.style.fontSize = `${size * 2}px`
      document.querySelector('details').open = true
    })
    await checkOverflow()
    await page.close()
    console.log(`Owner portal: ${width}px, expanded checklist, axe and 200% text passed`)
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
