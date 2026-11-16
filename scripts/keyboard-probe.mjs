import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.resolve(root, 'dist-ios')
const metadataPath = path.join(output, 'native-build.json')
const htmlPath = path.join(output, 'index.html')
const probePath = path.join(output, 'keyboard-probe.js')
const marker = 'id="realm-keyboard-probe"'

if (process.argv.length !== 2) {
  throw new Error('Usage: node scripts/keyboard-probe.mjs (after npm run build:ios)')
}

let metadata
try {
  metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
} catch (error) {
  throw new Error(`No valid iOS build metadata at ${metadataPath}. Run npm run build:ios first.`, { cause: error })
}
if (metadata?.target !== 'ios') {
  throw new Error(`Refusing to modify ${output}: native-build.json target must be "ios".`)
}

let html
try {
  html = await readFile(htmlPath, 'utf8')
} catch (error) {
  throw new Error(`Generated iOS index.html is missing at ${htmlPath}. Run npm run build:ios first.`, { cause: error })
}

const probe = String.raw`(() => {
  'use strict'

  const STORAGE_KEY = 'realm.debug.keyboard.v1'
  const MAX_SAMPLES = 300
  const SAMPLE_DELAY_MS = 350
  const EVENTS = new Set([
    'focus', 'focus-settled', 'blur', 'blur-settled', 'keydown', 'submit',
    'viewport-resize', 'window-scroll', 'visual-viewport-resize', 'visual-viewport-scroll',
  ])
  const CATEGORIES = new Set(['chat-input', 'search-input', 'map-search-input'])
  const KEY_CATEGORIES = new Set(['Enter', 'Tab', 'Escape', 'Unidentified', 'Other'])
  const SUBMITTER_TAGS = new Set(['button', 'input'])
  const SUBMITTER_TYPES = new Set([
    'submit', 'button', 'reset', 'text', 'search', 'email', 'password', 'number',
    'tel', 'url', 'checkbox', 'radio', 'file', 'date', 'time', 'hidden', 'image',
    'color', 'month', 'week', 'datetime-local',
  ])
  const samples = []
  let scrollTimer = 0
  let focusTimer = 0

  const boundedNumber = (value, limit = 1000000) => (
    typeof value === 'number' && Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : null
  )
  const safeTime = (value) => {
    const time = typeof value === 'number' ? value : (typeof value === 'string' ? Date.parse(value) : NaN)
    return Number.isFinite(time) && time >= 0 && time <= 8640000000000000 ? time : null
  }
  const safeFontSize = (value) => {
    const size = typeof value === 'number'
      ? value
      : (typeof value === 'string' && /^\s*\d+(?:\.\d+)?px\s*$/.test(value) ? Number.parseFloat(value) : NaN)
    return Number.isFinite(size) && size >= 0 && size <= 200 ? size : null
  }
  const safeRect = (value) => {
    if (!value || typeof value !== 'object') return null
    const rect = {}
    for (const key of ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left']) {
      rect[key] = boundedNumber(value[key])
    }
    return rect
  }
  const sanitizeEntry = (value) => {
    if (!value || typeof value !== 'object' || !EVENTS.has(value.event)) return null
    const viewport = value.viewport && typeof value.viewport === 'object' ? value.viewport : {}
    const rects = value.rects && typeof value.rects === 'object' ? value.rects : {}
    const element = CATEGORIES.has(value.element) ? value.element : null
    const entry = {
      at: safeTime(value.at),
      event: value.event,
      element,
      viewport: {
        innerHeight: boundedNumber(viewport.innerHeight),
        innerWidth: boundedNumber(viewport.innerWidth),
        scrollX: boundedNumber(viewport.scrollX),
        scrollY: boundedNumber(viewport.scrollY),
        visualHeight: boundedNumber(viewport.visualHeight),
        visualWidth: boundedNumber(viewport.visualWidth),
        offsetTop: boundedNumber(viewport.offsetTop),
        offsetLeft: boundedNumber(viewport.offsetLeft),
        scale: boundedNumber(viewport.scale, 1000),
      },
      rects: {
        device: safeRect(rects.device),
        sheet: safeRect(rects.sheet),
        sheetBody: safeRect(rects.sheetBody),
        chatInput: safeRect(rects.chatInput),
        chatButton: safeRect(rects.chatButton),
        focusedField: safeRect(rects.focusedField),
      },
      fieldFontSize: safeFontSize(value.fieldFontSize),
    }
    if (value.event === 'keydown') {
      entry.keyCategory = KEY_CATEGORIES.has(value.keyCategory) ? value.keyCategory : 'Other'
      entry.isComposing = value.isComposing === true
    }
    if (value.event === 'submit') {
      entry.submitterTag = SUBMITTER_TAGS.has(value.submitterTag) ? value.submitterTag : null
      entry.submitterType = SUBMITTER_TYPES.has(value.submitterType) ? value.submitterType : null
    }
    return entry
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (Array.isArray(saved)) {
      samples.push(...saved.slice(-MAX_SAMPLES).map(sanitizeEntry).filter(Boolean))
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(samples))
      } catch {}
      for (const entry of samples) {
        try {
          console.debug('[realm keyboard history]', entry)
        } catch {}
      }
    }
  } catch {}

  const categoryOf = (element) => {
    if (!(element instanceof HTMLInputElement)) return null
    if (element.matches('.chat-input input')) return 'chat-input'
    if (element.matches('.search input')) return 'search-input'
    if (element.matches('.map-search input')) return 'map-search-input'
    return null
  }
  const isWatched = (element) => !!categoryOf(element)

  const rectOf = (element) => {
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height),
      top: Math.round(rect.top), right: Math.round(rect.right),
      bottom: Math.round(rect.bottom), left: Math.round(rect.left),
    }
  }

  const sample = (event, element, extra = {}) => {
    const field = isWatched(element) ? element : null
    const chat = document.querySelector('.chat-input')
    const focusedField = field || (isWatched(document.activeElement) ? document.activeElement : null)
    const button = chat?.querySelector('button') || null
    const viewport = window.visualViewport
    const entry = {
      at: Date.now(),
      event,
      element: categoryOf(field || focusedField),
      viewport: {
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        visualHeight: viewport ? Math.round(viewport.height) : null,
        visualWidth: viewport ? Math.round(viewport.width) : null,
        offsetTop: viewport ? Math.round(viewport.offsetTop) : null,
        offsetLeft: viewport ? Math.round(viewport.offsetLeft) : null,
        scale: viewport ? viewport.scale : null,
      },
      rects: {
        device: rectOf(document.querySelector('.device')),
        sheet: rectOf(document.querySelector('.sheet')),
        sheetBody: rectOf(document.querySelector('.sheet-body')),
        chatInput: rectOf(chat),
        chatButton: rectOf(button),
        focusedField: rectOf(focusedField),
      },
      fieldFontSize: focusedField ? Number.parseFloat(getComputedStyle(focusedField).fontSize) : null,
      ...extra,
    }
    const safeEntry = sanitizeEntry(entry)
    if (!safeEntry) return
    samples.push(safeEntry)
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(samples))
    } catch {}
    try {
      console.debug('[realm keyboard probe]', safeEntry)
    } catch {}
  }

  const deferredSample = (event, element) => {
    window.clearTimeout(focusTimer)
    focusTimer = window.setTimeout(() => sample(event, element), SAMPLE_DELAY_MS)
  }

  document.addEventListener('focusin', (event) => {
    if (!isWatched(event.target)) return
    sample('focus', event.target)
    deferredSample('focus-settled', event.target)
  }, true)

  document.addEventListener('focusout', (event) => {
    if (!isWatched(event.target)) return
    sample('blur', event.target)
    deferredSample('blur-settled', null)
  }, true)

  document.addEventListener('keydown', (event) => {
    if (!isWatched(event.target)) return
    const keyCategory = ['Enter', 'Tab', 'Escape', 'Unidentified'].includes(event.key) ? event.key : 'Other'
    sample('keydown', event.target, { keyCategory, isComposing: !!event.isComposing })
  }, true)

  document.addEventListener('submit', (event) => {
    if (!event.target.querySelector('.chat-input input')) return
    const submitter = event.submitter
    sample('submit', isWatched(document.activeElement) ? document.activeElement : null, {
      submitterTag: submitter ? submitter.tagName.toLowerCase() : null,
      submitterType: submitter?.getAttribute('type') || null,
    })
  }, true)

  const onViewportChange = (event) => {
    window.clearTimeout(scrollTimer)
    scrollTimer = window.setTimeout(() => sample(event), 120)
  }
  window.addEventListener('resize', () => onViewportChange('viewport-resize'), { passive: true })
  window.addEventListener('scroll', () => onViewportChange('window-scroll'), { passive: true, capture: true })
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => onViewportChange('visual-viewport-resize'), { passive: true })
    window.visualViewport.addEventListener('scroll', () => onViewportChange('visual-viewport-scroll'), { passive: true })
  }
})()
`

if (!/<\/body\s*>/i.test(html)) {
  throw new Error(`Cannot inject keyboard probe: no closing body tag in ${htmlPath}.`)
}

await writeFile(probePath, probe)
if (!html.includes(marker)) {
  html = html.replace(/<\/body\s*>/i, `  <script src="./keyboard-probe.js" defer ${marker}></script>\n</body>`)
  await writeFile(htmlPath, html)
}

console.log(`Keyboard probe injected into ${output}. Start the iOS app and reproduce the input issue; diagnostics are bounded to localStorage key realm.debug.keyboard.v1.`)
