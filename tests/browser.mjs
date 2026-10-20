// Shared browser setup for the end-to-end tests.
import { chromium, firefox, webkit } from 'playwright'

/** BROWSER=chromium|firefox|webkit (default chromium; CHROMIUM_PATH points to a local build). */
export const engine = process.env.BROWSER ?? 'chromium'
export function launch() {
  if (engine === 'firefox') return firefox.launch()
  if (engine === 'webkit') return webkit.launch()
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
}

// Chrome 155+ returns a Promise from scrollIntoView (audit F07). Tests emulate it in every
// browser so an effect that implicitly returns that value (React would call it as cleanup)
// fails in CI instead of only on visitors' phones.
export const promiseScrollIntoView = () => {
  const orig = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (...args) {
    orig.apply(this, args)
    return Promise.resolve()
  }
}
