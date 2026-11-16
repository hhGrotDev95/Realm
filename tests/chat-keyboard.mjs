// Crew-chat keyboard and viewport regression coverage (run after npm run build).
import { spawn } from 'node:child_process'
import { launch } from './browser.mjs'

const PORT = 4326
const url = `http://127.0.0.1:${PORT}`
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true })
let browser
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(`preview server exited with ${server.exitCode}`)
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await sleep(200)
  }
  throw new Error('preview server did not become ready')
}

async function openChat(viewport, nativeIOS = false) {
  const context = await browser.newContext({ viewport, locale: 'de-DE' })
  const page = await context.newPage()
  if (nativeIOS) {
    await page.addInitScript(() => {
      // @capacitor/core honors this platform hint before its web bundle initializes.
      window.CapacitorCustomPlatform = { name: 'ios' }
      const state = { height: window.innerHeight, offsetTop: 0, scale: 1 }
      const vv = new EventTarget()
      for (const key of ['height', 'offsetTop', 'scale']) Object.defineProperty(vv, key, { get: () => state[key] })
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
      Object.defineProperty(window, '__setFakeKeyboardViewport', {
        configurable: true,
        value: (height, scale = 1, offsetTop = 0) => {
          state.height = height
          state.scale = scale
          state.offsetTop = offsetTop
          Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
          vv.dispatchEvent(new Event('scroll'))
          vv.dispatchEvent(new Event('resize'))
          window.dispatchEvent(new Event('resize'))
        },
      })
    })
  }
  await page.goto(url)
  await page.locator('nav').getByText('Crew').click()
  await page.getByText('Crew-Chat').click()
  const composer = page.getByPlaceholder(/Nachricht/)
  await composer.waitFor()

  // Trigger the normal identity flow before behavior assertions. Its dialog replaces
  // the chat sheet, so the test draft is entered again after identity is saved.
  await composer.fill('identity setup')
  await page.getByRole('button', { name: 'Senden' }).click()
  const identity = page.getByPlaceholder('Spitzname')
  if (await identity.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) {
    await identity.fill('Keyboard Test')
    const ageNotice = page.getByLabel(/Ich bin mindestens .* Jahre alt/)
    if (await ageNotice.count()) await ageNotice.check()
    await page.getByRole('button', { name: 'Weiter' }).click()
    await page.getByRole('dialog', { name: 'Crew-Chat' }).waitFor()
  }
  return { context, page, composer: page.getByPlaceholder(/Nachricht/) }
}

async function nativeChatGeometry(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const { top, right, bottom, left, width, height } = el.getBoundingClientRect()
      return { top, right, bottom, left, width, height }
    }
    const visibleBubbles = [...document.querySelectorAll('.crew-chat-history .bubble')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
    }).length
    return {
      device: box('.device'),
      sheet: box('.sheet'),
      header: box('.sheet-head h2'),
      close: box('.sheet-close'),
      history: box('.crew-chat-history'),
      input: box('.chat-input input'),
      send: box('.chat-input button'),
      draft: document.querySelector('.chat-input input')?.value,
      visibleBubbles,
      scale: window.visualViewport?.scale,
      scrollY,
      documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
    }
  })
}

function assertVisibleInViewport(r, name, width, height) {
  if (!r || r.left < -1 || r.right > width + 1 || r.top < -1 || r.bottom > height + 1) {
    throw new Error(`${name} is not visible in the ${width}×${height} visual viewport: ${JSON.stringify(r)}`)
  }
}

async function scenario(name, run) {
  await run()
  console.log(`✓ ${name}`)
}

try {
  await waitForServer()
  browser = await launch()

  await scenario('native-like iOS keyboard keeps chat controls and history inside the visual viewport', async () => {
    const { context, page, composer } = await openChat({ width: 440, height: 956 }, true)
    try {
      await composer.fill('visible native history')
      await page.getByRole('button', { name: 'Senden' }).click()
      await page.locator('.bubble.me', { hasText: 'visible native history' }).waitFor()
      await composer.fill('draft stays through native keyboard')

      // Reproduce the iOS host pan and shortened visual viewport without claiming to
      // emulate the keyboard itself or a native device.
      await page.locator('.device').evaluate((device) => { device.style.transform = 'translateY(-415px)' })
      await page.evaluate(() => window.__setFakeKeyboardViewport(541, 1, 415))
      await composer.focus()
      await page.waitForTimeout(250)

      const withKeyboard = await nativeChatGeometry(page)
      for (const [name, selector] of [
        ['sheet', 'sheet'], ['chat heading', 'header'], ['close button', 'close'],
        ['history region', 'history'], ['composer input', 'input'], ['Send button', 'send'],
      ]) assertVisibleInViewport(withKeyboard[selector], name, 440, 541)
      if (!withKeyboard.visibleBubbles) throw new Error('chat history has no visible messages with the keyboard open')
      if (withKeyboard.draft !== 'draft stays through native keyboard') throw new Error('native keyboard opening lost the unsent draft')
      if (withKeyboard.scrollY > 1 || withKeyboard.documentScrollTop > 1) throw new Error('native keyboard simulation scrolled the outer document')

      await composer.evaluate((input) => input.blur())
      await page.waitForTimeout(120)
      const blurred = await nativeChatGeometry(page)
      for (const [name, selector] of [
        ['sheet after blur', 'sheet'], ['chat heading after blur', 'header'], ['close button after blur', 'close'],
        ['history region after blur', 'history'], ['composer after blur', 'input'], ['Send after blur', 'send'],
      ]) assertVisibleInViewport(blurred[selector], name, 440, 541)
      if (!blurred.visibleBubbles || blurred.scrollY > 1 || blurred.documentScrollTop > 1) throw new Error('blur moved chat history or the outer document while the viewport stayed short')
      if (blurred.draft !== 'draft stays through native keyboard') throw new Error('blur while the visual viewport stayed short lost the draft')

      // WebView height and pan can restore in separate events.
      await page.evaluate(() => window.__setFakeKeyboardViewport(956, 1, 0))
      await page.waitForTimeout(120)
      const stillPanned = await nativeChatGeometry(page)
      for (const [name, selector] of [['heading', 'header'], ['close', 'close'], ['input', 'input'], ['Send', 'send']]) {
        assertVisibleInViewport(stillPanned[selector], `height restored before pan: ${name}`, 440, 541)
      }

      await page.evaluate(() => {
        document.querySelector('.device').style.transform = ''
        window.__setFakeKeyboardViewport(956, 1, 0)
      })
      await page.waitForTimeout(200)
      const restored = await nativeChatGeometry(page)
      for (const [name, selector] of [['sheet', 'sheet'], ['chat heading', 'header'], ['composer input', 'input'], ['Send button', 'send']]) {
        assertVisibleInViewport(restored[selector], `restored ${name}`, 440, 956)
      }
      if (restored.draft !== 'draft stays through native keyboard') throw new Error('restoring the full viewport lost the composer draft')
      if (restored.sheet.top < -1) throw new Error(`chat sheet stayed displaced after viewport restoration: ${JSON.stringify(restored.sheet)}`)

      await page.locator('.device').evaluate((device) => { device.style.transform = 'translateY(-415px)' })
      await composer.focus()
      await page.evaluate(() => window.__setFakeKeyboardViewport(541, 1.2, 415))
      await page.waitForTimeout(150)
      const zoomed = await nativeChatGeometry(page)
      if (zoomed.scale <= 1) throw new Error('pinch-zoom simulation did not set a larger visual viewport scale')
      if (zoomed.sheet.top >= -1) throw new Error('chat applied keyboard fitting during pinch zoom')

      await page.evaluate(() => window.__setFakeKeyboardViewport(541, 1, 415))
      await page.waitForTimeout(150)
      assertVisibleInViewport((await nativeChatGeometry(page)).header, 'heading after zoom reset', 440, 541)
      await page.getByRole('button', { name: 'Schließen' }).click()
      await page.evaluate(() => {
        document.querySelector('.device').style.transform = ''
        window.__setFakeKeyboardViewport(956, 1, 0)
      })
      await page.waitForTimeout(150)
      await page.getByRole('button', { name: 'Profil & Einstellungen' }).click()
      const otherSheet = page.getByRole('dialog')
      await otherSheet.waitFor()
      await page.waitForFunction(() => {
        const r = document.querySelector('.sheet')?.getBoundingClientRect()
        return r && r.top >= -1 && r.bottom <= innerHeight + 1
      })
      const other = await page.evaluate(() => {
        const sheet = document.querySelector('.sheet')
        const r = sheet.getBoundingClientRect()
        return { className: sheet.className, top: r.top, bottom: r.bottom, inset: sheet.style.getPropertyValue('--chat-visible-top') }
      })
      if (other.className.includes('crew-chat-sheet')) throw new Error(`a different sheet inherited the chat keyboard fit: ${other.className}`)
      if (other.className.includes('keyboard-fit') || other.inset) throw new Error('chat keyboard fitting survived closing the chat')
      if (other.top < -1 || other.bottom > 957) throw new Error(`profile sheet opened outside the restored viewport: ${JSON.stringify(other)}`)
      console.log('  checked simulated iOS resize, blur retention, pinch scale, and a non-chat sheet')
    } finally {
      await context.close()
    }
  })

  await scenario('composer keeps its draft on Enter and blur; Send click and focused-button Enter each send once', async () => {
    const { context, page, composer } = await openChat({ width: 320, height: 640 })
    try {
      const send = page.getByRole('button', { name: 'Senden' })
      const sentCount = (text) => page.locator('.bubble.me').filter({ hasText: text }).count()

      await composer.fill('draft survives Enter')
      await composer.press('Enter')
      await page.waitForTimeout(250)
      if ((await composer.inputValue()) !== 'draft survives Enter') throw new Error('Enter cleared the unsent draft')
      if (await sentCount('draft survives Enter')) throw new Error('Enter sent a message')

      await composer.click()
      await composer.fill('draft survives blur')
      await page.locator('.sheet-head h2').click()
      if ((await composer.inputValue()) !== 'draft survives blur') throw new Error('blur cleared the unsent draft')
      if (await sentCount('draft survives blur')) throw new Error('blur sent a message')

      await composer.fill('sent with click')
      await send.click()
      await page.locator('.bubble.me', { hasText: 'sent with click' }).waitFor()
      await page.waitForTimeout(250)
      if (await sentCount('sent with click') !== 1) throw new Error('Send click did not create exactly one message')

      await composer.fill('sent with button Enter')
      await send.focus()
      await page.keyboard.press('Enter')
      await page.locator('.bubble.me', { hasText: 'sent with button Enter' }).waitFor()
      await page.waitForTimeout(250)
      if (await sentCount('sent with button Enter') !== 1) throw new Error('focused Send button Enter did not create exactly one message')
      console.log('  checked drafts, click activation, focused-button keyboard activation')
    } finally {
      await context.close()
    }
  })

  for (const viewport of [{ width: 320, height: 640 }, { width: 440, height: 956 }, { width: 440, height: 400 }]) {
    await scenario(`chat layout ${viewport.width}×${viewport.height} keeps controls reachable after long history`, async () => {
      const { context, page, composer } = await openChat(viewport)
      try {
        const defaultInputFontSize = await composer.evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize))
        if (defaultInputFontSize < 16) throw new Error(`composer text is smaller than 16px by default (${defaultInputFontSize}px)`)
        // Enlarge the composer parent, as a user text-size override would, and
        // check that the actual input inherits the larger size.
        await page.addStyleTag({ content: '.chat-input { font-size: 22px !important }' })
        const enlargedInputFontSize = await composer.evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize))
        if (enlargedInputFontSize < 22) throw new Error(`composer input did not inherit 22px text (${enlargedInputFontSize}px)`)
        const send = page.getByRole('button', { name: 'Senden' })
        for (let i = 1; i <= 14; i++) {
          await composer.fill(`history ${i}`)
          await send.click()
        }
        await page.locator('.bubble.me', { hasText: 'history 14' }).waitFor()
        await page.waitForTimeout(400)

        const report = await page.evaluate(() => {
          const rect = (selector) => {
            const element = document.querySelector(selector)
            if (!element) return null
            const { top, right, bottom, left, width, height } = element.getBoundingClientRect()
            return { top, right, bottom, left, width, height }
          }
          const sheet = rect('.sheet')
          const form = rect('.chat-input')
          const input = rect('.chat-input input')
          const button = rect('.chat-input button')
          const heading = rect('.sheet-head h2')
          return {
            sheet,
            form,
            input,
            button,
            heading,
            viewport: { width: innerWidth, height: innerHeight },
            documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
            documentScrollHeight: document.scrollingElement?.scrollHeight ?? 0,
          }
        })
        const insideViewport = (r) => r && r.left >= -1 && r.right <= viewport.width + 1 && r.top >= -1 && r.bottom <= viewport.height + 1
        if (!report.sheet || !report.form || !report.input || !report.button || !report.heading) throw new Error('chat controls or heading missing: ' + JSON.stringify(report))
        if (!insideViewport(report.form) || !insideViewport(report.input) || !insideViewport(report.button)) throw new Error('composer or Send is outside the viewport: ' + JSON.stringify(report))
        if (report.form.top < report.sheet.top || report.form.bottom > report.sheet.bottom + 1) throw new Error('composer is outside the chat sheet: ' + JSON.stringify(report))
        if (report.heading.bottom <= 0 || report.heading.top >= viewport.height) throw new Error('chat heading is not reachable after long history: ' + JSON.stringify(report))
        if (report.documentScrollTop > 1 || report.documentScrollHeight > viewport.height + 1) throw new Error('chat auto-scroll moved the outer document: ' + JSON.stringify(report))
        if (viewport.height >= 640) {
          const bottomGap = viewport.height - report.form.bottom
          if (bottomGap < 8 || bottomGap > 130) throw new Error(`composer is not near the bottom with safe padding (${bottomGap}px): ${JSON.stringify(report)}`)
        }
        console.log(`  composer bottom gap ${Math.round(viewport.height - report.form.bottom)}px; document scroll ${report.documentScrollTop}px`)

        if (viewport.width === 440 && viewport.height === 956) {
          await composer.fill('draft survives viewport resize')
          for (const height of [400, 956]) {
            await page.setViewportSize({ width: 440, height })
            await page.waitForTimeout(150)
            const resized = await page.evaluate(() => {
              const box = (selector) => {
                const el = document.querySelector(selector)
                if (!el) return null
                const { top, right, bottom, left } = el.getBoundingClientRect()
                return { top, right, bottom, left }
              }
              return {
                form: box('.chat-input'),
                input: box('.chat-input input'),
                button: box('.chat-input button'),
                sheet: box('.sheet'),
                heading: box('.sheet-head h2'),
                draft: document.querySelector('.chat-input input')?.value,
                scrollTop: document.scrollingElement?.scrollTop ?? 0,
                scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
                height: innerHeight,
              }
            })
            const visible = (r) => r && r.left >= -1 && r.right <= 441 && r.top >= -1 && r.bottom <= height + 1
            if (!visible(resized.form) || !visible(resized.input) || !visible(resized.button) || !visible(resized.sheet)) throw new Error(`controls moved outside viewport after resize to 440×${height}: ${JSON.stringify(resized)}`)
            if (!resized.heading || resized.heading.bottom <= 0 || resized.heading.top >= height) throw new Error(`chat heading became unreachable after resize to 440×${height}: ${JSON.stringify(resized)}`)
            if (resized.draft !== 'draft survives viewport resize') throw new Error(`resize to 440×${height} lost the composer draft`)
            if (resized.scrollTop > 1 || resized.scrollHeight > height + 1) throw new Error(`resize to 440×${height} scrolled the outer document: ${JSON.stringify(resized)}`)
          }
          console.log('  resize sequence 440×956 → 440×400 → 440×956 retained the draft and kept chat controls reachable')
        }
      } finally {
        await context.close()
      }
    })
  }
} finally {
  await browser?.close()
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {}
    await Promise.race([new Promise((resolve) => server.once('exit', resolve)), sleep(1500)])
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {}
  }
}
